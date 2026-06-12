# JAAD — June 2026 Overhaul

Release notes for the full-project overhaul. Suitable as a PR description.
All gates green at time of writing: **0 lint errors · 189/189 tests · clean
production build**.

## 🔒 Security & Cloud

- **Firebase anonymous auth + ownership model** — projects carry `ownerId`;
  Firestore/Storage rules enforce owner-write / link-read with a legacy-claim
  path. Project browser lists own + public projects via scoped queries.
  ⚠️ Inactive until the [deploy checklist](./firebase-deploy-checklist.md)
  is completed (enable Anonymous provider, deploy rules, mark demos public).
- **No embedded AI keys in hosted builds** — the public build is strictly
  BYOK (Settings → AI & Cloud); `VITE_GEMINI_API_KEY` remains available for
  self-hosters only.
- Gemini calls now retry with exponential backoff and surface real API errors;
  model IDs centralized and overridable without rebuild.
- Honest transport-security copy ("Secured in Transit (HTTPS)" instead of
  unqualified "Encryption Active").

## 🎚️ DAW Features

- **Per-track volume/pan automation lanes** — AUTO toggle per track opens
  draw/drag/delete breakpoint lanes with grid snapping; curves multiply with
  the fader, are applied in live playback, seeks, frozen-track playback and
  offline WAV/stem exports, sync to cloud, and are fully undoable.
- **Piano roll MIDI editor** — draw/move/resize/delete notes with snapping,
  preview keys, and built-in synth playback.
- **Clip fade handles** — corner-drag fade in/out, honored in playback,
  freeze, and all exports.
- **Convolution reverb** — true `ConvolverNode` with synthesized
  room/hall/plate IRs as a mixer FX slot.
- **Real time-stretch** — the SoundTouch worklet now performs actual WSOLA
  tempo-shifting (was a passthrough stub).
- **Submix bus foundation** — pure routing utilities landed
  (`busUtils.ts`); full store/engine/mixer integration in progress.
- Undo history capped (50 snapshots); storage-quota warnings with a
  dismissible banner; local project-state snapshots restore offline work.

## 🧊 Liquid Glass Theme Engine

- Glass rendering rebuilt to match `rdev/liquid-glass-react` (vendored
  reference): displacement refraction with chromatic edge fringing, specular
  rim rings, frost + warp layering — wrapped in a documented **panel
  contract** (glass fills its container; content never clipped) with
  regression tests.
- **Settings → Theme**: refraction mode (Standard/Polar/Prominent/Shader),
  live sliders (displacement, blur, saturation, aberration, radius, opacity)
  with an in-tab live preview card and reset; filter params apply globally,
  frost params scale per-panel to preserve hierarchy.
- **Performance Mode**: fully opaque matte panels (zero SVG/backdrop filters),
  accent color swatches; auto-selected on first run under
  `prefers-reduced-motion` or ≤4 hardware threads.
- Ambient edge glow + side-by-side theme test bench; theme storage v2.

## 🧰 Code Health, CI & Docs

- ESLint flat config + Prettier; CI now gates deploys on typecheck + tests.
- Timeline split into focused components; shared `useAudioImport` hook
  replaces triplicated drop/import logic; `ClipItem` memoized.
- Test suite grown to **189 tests** (engine timing, store history, automation
  curves, sync sanitization, glass contract).
- Docker CI hardening for the DSP sidecar; package renamed `jaad-daw`,
  unused deps dropped.
- New docs: Firebase deploy checklist, ADR status refresh, vendored-package
  local-modification notes.

## 🔭 Known follow-ups

- Submix buses: store/engine/mixer integration on top of the landed utilities.
- Loop region + snap guides; VST bridge ScriptProcessor→AudioWorklet
  migration; recording latency compensation.
- Track freeze pre-existing double-apply of fader volume/pan (flagged, not
  yet fixed).
- Real-time collaboration remains last-write-wins (roadmap).
