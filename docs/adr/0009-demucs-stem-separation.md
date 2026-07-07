# ADR-0009: Suno-Grade Stem Separation via a Self-Hosted Demucs Sidecar

- **Status**: 🟢 Accepted (client verified in CI; sidecar needs a one-time run on real hardware)
- **Date**: 2026-07-04
- **Author**: USER & Claude

## Context & Problem Statement

JAAD's "AI Stem Separation" was **cascaded biquad filtering** (`stemSeparation.ts`) —
a frequency-band split. Filters cannot unmix sources that overlap in frequency
(vocals, guitars, and keys all live in the midrange), so quality was far below
Suno Studio's tool, which uses trained ML source separation. We want stems that
match or beat Suno's, while staying true to JAAD's self-hosted, no-paywall ethos.

## Decision

A **hybrid, server-first architecture** mirroring the BPM engine (local tool first,
better tool when available) and the DSP sidecar pattern (Dockerized, token/CORS
guarded, loopback-bound):

1. **`docker-demucs/` sidecar** — FastAPI + **Demucs v4 (htdemucs)**, Meta's
   open-source hybrid-transformer separator — the same model family behind most
   commercial stem tools. Job API: `POST /separate` (WAV upload, model choice) →
   poll `GET /jobs/{id}` (progress from Demucs' callback) → `GET /jobs/{id}/stem/{name}`
   (WAV per stem) → `DELETE /jobs/{id}` (temp cleanup). One job at a time; upload
   capped (default 200MB); bearer-token auth unless `JAAD_STEMS_ALLOW_NO_AUTH=1`;
   CORS restricted to configured origins; non-root container; model weights cached
   in a volume.
2. **Model selection**: `htdemucs` (vocals/drums/bass/other) by default;
   `htdemucs_6s` automatically when Guitar or Keyboard is requested (adds
   guitar/piano at slightly lower overall quality). `htdemucs_ft` allowed for
   users who want max quality at 4× separation time.
3. **Client (`stemServer.ts`)** — health probe, upload→poll→download flow with
   progress, `localStorage` config (`jaad_stems_url`, `jaad_stems_token`).
4. **Honest hybrid UI (`StemSeparator.tsx`)** — when the server is reachable:
   Vocals/Drums/Bass/Guitar/Keyboard get an **AI badge** and go through Demucs;
   all other instrument choices use the filter code, with tracks labeled
   "(approx)". Footer states the active mode plainly ("DEMUCS AI SOURCE
   SEPARATION · SELF-HOSTED" vs "LOCAL FILTER APPROXIMATION MODE"). The old
   always-on "AI" framing is gone.
5. **Distribution**: the stems service is **opt-in** so the ~2.5GB torch image
   never enters Docker CI or default `docker-compose up`. *(Originally a
   separate `docker-compose.stems.yml`; unified 2026-07 into the main
   `docker-compose.yml` under `profiles: ["stems"]`, with CI's bake pinned to
   explicit `jaad dsp` targets — bake ignores profiles.)* GPU users uncomment
   the `gpus` block and switch the torch index to CUDA for ~10–30× speedups.

## Alternatives Considered

- **In-browser ML (ONNX Runtime Web / demucs.cpp WASM)** — genuinely possible
  (free-music-demixer proves it) and JAAD already ships COOP/COEP for threaded
  WASM. Rejected *for now*: model downloads (100MB+) and minutes-long CPU
  separations make a poor default UX; the user owns a GPU server. Left open as a
  future no-server tier.
- **Cloud separation APIs** — rejected: recurring cost and a paywall is exactly
  what JAAD exists to avoid.
- **Spleeter / Open-Unmix** — older/lower quality than Demucs v4 for the same
  self-host cost.

## Consequences

- **Positive**: true source separation at open-source state of the art —
  competitive with Suno Studio; graceful degradation to filters offline; no new
  cost or third-party dependency; pattern reusable for the future ComfyUI/ACE-Step
  generation server.
- **Negative / risks**: first run downloads model weights (~300MB–2GB); CPU-only
  hosts wait minutes per song; the sidecar adds another service to operate. The
  Demucs Python API surface (`demucs.api.Separator`, callback fields) is pinned to
  `demucs==4.0.1` — verify on upgrade.

## Verification checklist (one-time, on the AI server)
1. `docker compose --profile stems up -d --build` (first run downloads weights).
2. `curl http://localhost:8000/health` → `{"ok": true, ...}`.
3. In JAAD → right-click a full-mix clip → Stem Separation Studio → confirm the
   green **AI Ready** dot and AI badges.
4. Extract Vocals+Drums+Bass → A/B the stems against Suno's on the same song.
5. GPU path: enable the compose `gpus` block + CUDA torch, confirm separation
   drops from minutes to seconds.
