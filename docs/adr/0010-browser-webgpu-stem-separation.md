# ADR-0010: On-Device (WebGPU/WASM) Stem Separation Tier

- **Status**: 🟢 Accepted
- **Date**: 2026-07-07
- **Author**: USER & Claude

## Context & Problem Statement

ADR-0009 added real ML stem separation via a self-hosted Demucs sidecar — but it
assumes the JAAD host has (or can reach) a server with the model, ideally with a
GPU. Many self-hosters run JAAD on a NAS/VPS with no GPU passthrough, and the
public Pages build has no server at all. Those users fell straight to the biquad
filter approximation. Meanwhile the *client* machine — the one running the
browser — often has a perfectly good GPU.

## Decision

Add a **middle tier: run HT-Demucs in the browser itself**, using the user's own
device GPU via **WebGPU**, falling back to **multithreaded WASM** (which JAAD's
COOP/COEP cross-origin isolation already enables). The separation ladder becomes:

1. **Self-hosted Demucs server** (ADR-0009) — best quality/speed, 4/6-stem models.
2. **On-device Demucs (this ADR)** — `demucs-web` (MIT) + `onnxruntime-web`
   (`executionProviders: ['webgpu','wasm']`), htdemucs 4-stem ONNX (~172MB,
   STFT embedded in the graph). Covers Vocals / Drums / Bass.
3. **Biquad filter approximation** — last resort, labeled "(approx)".

### Implementation
- `src/lib/browserStems.ts`: capability probe (`navigator.gpu` /
  `crossOriginIsolated`), one-time model download from the demucs-web HuggingFace
  repo with streaming progress, **cached in the existing OPFS/IndexedDB asset
  store** (survives refreshes), resample-to-44.1k-stereo, separation with
  per-segment progress, results mapped to JAAD instruments.
- **Bundle discipline**: `demucs-web`/`onnxruntime-web` are dynamic imports and
  deliberately excluded from the `vendor` manual chunk **without naming a manual
  chunk** (named manual chunks get `<link rel=modulepreload>`), so the ~400KB
  engine is a true async chunk and the 26MB ort WASM runtime (Vite `?url` asset,
  same-origin for CSP) is fetched only on first use.
- `StemSeparator.tsx`: tier auto-resolution (server → device → filters), a
  device row with a **"Get model (172MB, one-time)"** consent button (no silent
  giant downloads), cyan `AI·GPU` badges, and a truthful three-mode footer.
- CSP: `connect-src` gains `https://huggingface.co https://*.hf.co`; COEP moves
  `require-corp → credentialless` (isolation preserved; cross-origin fonts work).

## Alternatives Considered
- **demucs.cpp → WASM** (free-music-demixer approach): proven, but CPU-only (no
  WebGPU), requires maintaining an Emscripten build; onnxruntime-web gives us
  WebGPU today with an npm dependency.
- **StemSplitio ONNX exports + hand-rolled chunking**: more models (6-stem, ft)
  but we'd own STFT/overlap-add correctness; deferred as a follow-up upgrade path.
- **Silent auto-download of the model**: rejected — 172MB needs explicit consent.

## Consequences
- **Positive**: AI-quality stems with *zero server requirements* — including the
  GitHub Pages demo; fully offline after the one-time model download; no new
  cost anywhere; the user's GPU does the work.
- **Negative / risks**: 172MB first-run download; WebGPU performance varies by
  device/browser (Chrome/Edge best — consistent with JAAD's Chrome-first
  stance); 4-stem only (no Guitar/Keyboard — those stay server-or-filter);
  in-browser separation of a full song takes tens of seconds (WebGPU) to minutes
  (WASM threads) vs ~10s on a server GPU; `demucs-web@1.0.2` is pinned — verify
  on upgrade.

## Verification
- Unit: capability detection, cache/download flow, instrument mapping, error
  paths (6 tests). Bundle: vendor byte-identical, no modulepreload of the tier.
- Manual (needs a real browser + one-time download): load a mix, no server →
  "Get model" → separate Vocals/Drums/Bass → A/B against the server tier.
