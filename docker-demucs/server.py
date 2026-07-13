"""JAAD Stem-Separation Sidecar — Demucs (htdemucs) behind a small job API.

Suno-grade source separation, self-hosted. The browser uploads a WAV, we run
Meta's Demucs model (GPU when available), and it downloads real stems.

Security posture mirrors the DSP sidecar:
- Optional shared token (JAAD_STEMS_TOKEN) — required unless
  JAAD_STEMS_ALLOW_NO_AUTH=1 is explicitly set.
- CORS restricted to configured browser origins.
- Upload size cap, one separation at a time, temp files cleaned per job.
"""

import asyncio
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import uuid

import uvicorn
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

# --- Configuration -----------------------------------------------------------
# Token resolution mirrors the DSP sidecar (see _resolve_auth_token): explicit
# JAAD_STEMS_TOKEN wins; else an explicit JAAD_STEMS_ALLOW_NO_AUTH=1 opt-out;
# else auto-generate + persist a token so the service is authenticated by default
# with zero configuration. The token lands in the persisted models cache volume.
AUTH_TOKEN = os.environ.get("JAAD_STEMS_TOKEN")
ALLOW_NO_AUTH = os.environ.get("JAAD_STEMS_ALLOW_NO_AUTH") == "1"
_HOME = os.environ.get("HOME", "/home/jaad")
TOKEN_FILE = os.environ.get("JAAD_STEMS_TOKEN_FILE", os.path.join(_HOME, ".cache", ".stems_token"))
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "JAAD_STEMS_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if o.strip()
]
MAX_UPLOAD_MB = int(os.environ.get("JAAD_STEMS_MAX_UPLOAD_MB", "200"))
ALLOWED_MODELS = {"htdemucs", "htdemucs_ft", "htdemucs_6s"}

app = FastAPI(title="JAAD Stems", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

# jobs[id] = {status: queued|processing|done|error, progress: 0..1,
#             dir: tempdir, stems: {name: path}, error: str}
jobs: dict = {}
_job_lock = asyncio.Lock()  # one separation at a time (model is heavy)


def _resolve_auth_token():
    """Make 'authenticated' the zero-config default. Returns the token to require,
    or None ONLY when the operator explicitly set JAAD_STEMS_ALLOW_NO_AUTH=1."""
    if AUTH_TOKEN:
        return AUTH_TOKEN
    if ALLOW_NO_AUTH:
        return None
    try:
        with open(TOKEN_FILE, "r") as f:
            existing = f.read().strip()
        if existing:
            return existing
    except OSError:
        pass
    token = secrets.token_hex(24)
    try:
        os.makedirs(os.path.dirname(TOKEN_FILE) or ".", exist_ok=True)
        fd = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(token)
    except OSError as e:
        print(f"⚠️ Could not persist auth token to {TOKEN_FILE} ({e}); "
              "it will change on the next restart.")
    return token


def _check_auth(authorization: str | None):
    if AUTH_TOKEN:
        if authorization != f"Bearer {AUTH_TOKEN}":
            raise HTTPException(status_code=401, detail="invalid token")
    elif not ALLOW_NO_AUTH:
        raise HTTPException(status_code=401, detail="auth not configured")


def _cuda_available() -> bool:
    try:
        import torch

        return torch.cuda.is_available()
    except Exception:
        return False


_PCT_RE = re.compile(r"(\d+)%")


def _run_separation(job_id: str, wav_path: str, model: str):
    """Blocking (runs in a worker thread): drive the Demucs CLI. The CLI is the
    stable interface across demucs 4.x — the `demucs.api` module is not present
    in all 4.0.x builds. Writes stems to <out>/<model>/<track>/<stem>.wav."""
    job = jobs[job_id]
    out_dir = os.path.join(os.path.dirname(wav_path), "out")
    device = "cuda" if _cuda_available() else "cpu"

    cmd = [sys.executable, "-m", "demucs", "-n", model, "-d", device, "-o", out_dir, wav_path]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)

    # Best-effort progress from Demucs' stderr percentage bar (tqdm uses \r, so
    # read in chunks, not lines). Never fail the job over progress parsing.
    window = ""
    while True:
        chunk = proc.stderr.read(128)
        if not chunk:
            break
        window = (window + chunk)[-256:]
        matches = _PCT_RE.findall(window)
        if matches:
            try:
                job["progress"] = min(0.99, int(matches[-1]) / 100.0)
            except ValueError:
                pass
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"demucs CLI exited with code {proc.returncode}")

    base = os.path.splitext(os.path.basename(wav_path))[0]
    stem_dir = os.path.join(out_dir, model, base)
    if not os.path.isdir(stem_dir):
        raise RuntimeError(f"demucs produced no output directory at {stem_dir}")
    stems = {
        os.path.splitext(f)[0]: os.path.join(stem_dir, f)
        for f in sorted(os.listdir(stem_dir))
        if f.endswith(".wav")
    }
    if not stems:
        raise RuntimeError("demucs produced no stem files")

    job["stems"] = stems
    job["progress"] = 1.0
    job["status"] = "done"


async def _process_job(job_id: str, wav_path: str, model: str):
    async with _job_lock:
        jobs[job_id]["status"] = "processing"
        try:
            await asyncio.to_thread(_run_separation, job_id, wav_path, model)
        except Exception as e:  # noqa: BLE001 — report any failure to the client
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"] = str(e)
            print(f"❌ Job {job_id} failed: {e}")


@app.get("/health")
def health():
    return {"ok": True, "service": "jaad-stems", "models": sorted(ALLOWED_MODELS)}


@app.post("/separate")
async def separate(
    file: UploadFile = File(...),
    model: str = Form("htdemucs"),
    authorization: str | None = Header(default=None),
):
    _check_auth(authorization)
    if model not in ALLOWED_MODELS:
        raise HTTPException(status_code=400, detail=f"model must be one of {sorted(ALLOWED_MODELS)}")

    job_dir = tempfile.mkdtemp(prefix="jaad_stems_")
    wav_path = os.path.join(job_dir, "input.wav")
    size = 0
    with open(wav_path, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_MB * 1024 * 1024:
                out.close()
                shutil.rmtree(job_dir, ignore_errors=True)
                raise HTTPException(status_code=413, detail=f"upload exceeds {MAX_UPLOAD_MB}MB")
            out.write(chunk)

    job_id = uuid.uuid4().hex
    jobs[job_id] = {"status": "queued", "progress": 0.0, "dir": job_dir, "stems": {}, "error": ""}
    asyncio.create_task(_process_job(job_id, wav_path, model))
    return {"job_id": job_id}


@app.get("/jobs/{job_id}")
def job_status(job_id: str, authorization: str | None = Header(default=None)):
    _check_auth(authorization)
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="unknown job")
    return {
        "status": job["status"],
        "progress": round(job["progress"], 3),
        "stems": sorted(job["stems"].keys()),
        "error": job["error"],
    }


@app.get("/jobs/{job_id}/stem/{name}")
def get_stem(job_id: str, name: str, authorization: str | None = Header(default=None)):
    _check_auth(authorization)
    job = jobs.get(job_id)
    if not job or job["status"] != "done":
        raise HTTPException(status_code=404, detail="job not done")
    path = job["stems"].get(name)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="unknown stem")
    return FileResponse(path, media_type="audio/wav", filename=f"{name}.wav")


@app.delete("/jobs/{job_id}")
def cleanup(job_id: str, authorization: str | None = Header(default=None)):
    _check_auth(authorization)
    job = jobs.pop(job_id, None)
    if job:
        shutil.rmtree(job["dir"], ignore_errors=True)
    return {"ok": True}


if __name__ == "__main__":
    _env_token = os.environ.get("JAAD_STEMS_TOKEN")
    AUTH_TOKEN = _resolve_auth_token()
    if AUTH_TOKEN and not _env_token:
        # Auto-generated or restored — surface it so the operator can paste it
        # into JAAD (localStorage 'jaad_stems_token').
        print("🔐 Stems auth token (set this in JAAD → stems token):")
        print(f"       {AUTH_TOKEN}")
    elif AUTH_TOKEN:
        print("🔐 Stems auth: using the token from JAAD_STEMS_TOKEN.")
    else:
        print("⚠️ JAAD_STEMS_ALLOW_NO_AUTH=1 — running WITHOUT token auth "
              "(CORS-restricted only). Use ONLY on a trusted localhost bind.")
    print(f"🎚️ JAAD Stems sidecar (Demucs) on :8000 · origins: {ALLOWED_ORIGINS}")
    uvicorn.run(app, host=os.environ.get("JAAD_STEMS_HOST", "0.0.0.0"), port=8000)
