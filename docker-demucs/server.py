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
import shutil
import tempfile
import uuid

import uvicorn
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

# --- Configuration -----------------------------------------------------------
AUTH_TOKEN = os.environ.get("JAAD_STEMS_TOKEN")
ALLOW_NO_AUTH = os.environ.get("JAAD_STEMS_ALLOW_NO_AUTH") == "1"
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
_separators: dict = {}      # model name -> loaded Separator (cached)


def _check_auth(authorization: str | None):
    if AUTH_TOKEN:
        if authorization != f"Bearer {AUTH_TOKEN}":
            raise HTTPException(status_code=401, detail="invalid token")
    elif not ALLOW_NO_AUTH:
        raise HTTPException(status_code=401, detail="auth not configured")


def _get_separator(model: str, progress_cb):
    """Load (and cache) a Demucs separator. Import here so the API can report a
    clean error if demucs/torch are missing rather than dying at startup."""
    from demucs.api import Separator

    if model not in _separators:
        _separators[model] = Separator(model=model)
    sep = _separators[model]
    sep.update_parameter(callback=progress_cb)
    return sep


def _run_separation(job_id: str, wav_path: str, model: str):
    """Blocking: runs in a worker thread. Writes stems next to the input."""
    from demucs.api import save_audio

    job = jobs[job_id]

    def progress_cb(data: dict):
        try:
            length = float(data.get("audio_length") or 0) or 1.0
            offset = float(data.get("segment_offset") or 0)
            models = float(data.get("models") or 1) or 1.0
            idx = float(data.get("model_idx_in_bag") or 0)
            job["progress"] = min(0.99, (idx + min(offset / length, 1.0)) / models)
        except Exception:
            pass  # progress is best-effort; never fail the job over it

    separator = _get_separator(model, progress_cb)
    _origin, separated = separator.separate_audio_file(wav_path)

    stems: dict = {}
    out_dir = os.path.dirname(wav_path)
    for name, tensor in separated.items():
        out_path = os.path.join(out_dir, f"{name}.wav")
        save_audio(tensor, out_path, samplerate=separator.samplerate)
        stems[name] = out_path

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
    if not AUTH_TOKEN and not ALLOW_NO_AUTH:
        raise SystemExit(
            "Refusing to start: set JAAD_STEMS_TOKEN, or JAAD_STEMS_ALLOW_NO_AUTH=1 "
            "to explicitly run without a token (local only)."
        )
    if not AUTH_TOKEN:
        print("⚠️ JAAD_STEMS_TOKEN not set — running WITHOUT token auth (CORS-restricted only).")
    print(f"🎚️ JAAD Stems sidecar (Demucs) on :8000 · origins: {ALLOWED_ORIGINS}")
    uvicorn.run(app, host=os.environ.get("JAAD_STEMS_HOST", "0.0.0.0"), port=8000)
