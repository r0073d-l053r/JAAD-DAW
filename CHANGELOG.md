# Changelog

All notable changes to JAAD are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.16.0] — 2026-07-24

Community Edition security hardening — making JAAD safe to open-source and safe
for a stranger to self-host.

### Security

- **Sidecars are now authenticated by default.** The DSP/VST sidecar and the stem
  sidecar auto-generate and persist a token on first boot (printed in the logs)
  and require it — neither ever starts silently unauthenticated. The old
  `ALLOW_NO_AUTH=1` shipped compose default is removed and is now an explicit,
  documented, localhost-only opt-out.
- **Over-the-wire plugin upload is off by default.** Uploading a plugin executes
  its code under Wine, so it is gated behind `JAAD_ENABLE_PLUGIN_UPLOAD=1`
  (trusted operators only), enforced at both the message handler and the writer.
- **Container isolation**: `no-new-privileges`, `pids_limit`, and
  `cap_drop: ["ALL"]` on every service — smoke-tested against real containers
  (app serves, the Wine bridge loads plugins, GPU Demucs separates); the app
  keeps only the four caps nginx needs. `mem_limit` on app + dsp; `read_only` and
  the stems `mem_limit` are left as opt-in further tightenings.
- **DoS / denial-of-wallet caps:** DSP bounds concurrent WebSocket clients
  (`JAAD_DSP_MAX_CLIENTS`, default 8); the stem sidecar bounds queued/processing
  jobs (`JAAD_STEMS_MAX_ACTIVE_JOBS`, default 3), rejected before the upload hits
  disk.
- **CI supply-chain:** gitleaks secret scan (blocking) and Trivy vuln/config scan;
  least-privilege `contents: read` tokens and `persist-credentials: false` on
  checkouts.
- Secret-scanned the full git history (all branches) — clean, no committed tokens
  or keys. `.gitignore` now excludes `vst/` (which holds the auto-generated
  `.dsp_token`).
- **Patched audit CVEs that were blocking the Pages deploy (PR #62):** a
  non-breaking `npm audit fix` cleared `websocket-driver` ≤0.7.4 (critical —
  resource-limit bypass / message corruption) and `brace-expansion` (high —
  ReDoS), which failed the deploy's `npm audit --audit-level=high` gate. A
  remaining low, dev-only esbuild advisory is intentionally deferred.

### Added

- Settings → AI & Cloud → **Self-Hosted Sidecar Access**: masked fields to paste
  the DSP and stem tokens (stored only in the browser).
- **`SECURITY.md`** — private vulnerability disclosure policy and scope.
- **`CONTRIBUTING.md`** and **`CODE_OF_CONDUCT.md`** (Contributor Covenant 2.1).
- **`.github/`** issue templates (routing security reports to the private channel)
  and a pull-request template with a no-secrets + security-area checklist.
- **`docs/self-hosting-hardening.md`** — consolidated hardening guide with a
  pre-exposure checklist.
- **`.github/dependabot.yml`** — npm, GitHub Actions, and Docker updates.
- **`.github/workflows/security.yml`** — the secret + vulnerability scan workflow.

### Changed

- `docker-compose.yml` ships secure-by-default (no `ALLOW_NO_AUTH`; hardening
  directives on each service).
- README: accurate, secure-by-default self-host steps (token from
  `docker compose logs`, no baked key on public builds); a Security section; and
  Contributing now points to `CONTRIBUTING.md` / Code of Conduct.

### Fixed

- README dev URL corrected to `http://localhost:3000/JAAD-DAW/` (the bare root
  404s because the app's base path is `/JAAD-DAW/`).
- ADR index refreshed to include ADR-0007 through ADR-0010.

> The July 2026 feature surge between v0.15.5 and this release — the self-hosted
> Demucs + on-device WebGPU stem engine (ADR-0009/0010), the real-knob Wine/Carla
> Cloud VST bridge with a live noVNC GUI (ADR-0008), Copilot tool-calling, and the
> MIDI piano roll — shipped on `main` and is included in 0.16.0. Detailed per-PR
> notes for that stretch live on the GitHub Releases page.

## [0.15.5] — 2026-05-26 — "Fidelity Evasion & DSP Stabilization"

- **AI Authenticity Processor** overhauled: mathematically-perfect overlap-add
  (OLA) reconstruction, unity-gain saturation waveshaping, and phase-entropy
  calibration. The processor removes the telltale spectral artifacts left by
  AI-generated audio for a natural, high-fidelity analog sound — which also
  lowers AI-detector scores. Added a DSP test harness
  (`aiAuthenticityProcessor.test.ts`).
- Peak/clipping detection in the waveform canvas + mixer LED meters; BYOK Gemini
  key UI with a "Clear Key" button and privacy clarifications (v0.15.4).

## [0.15.1] — 2026-05-24 — "Tighten the Bolts"

- Fixed the spectrogram worker MIME load, VST/sidechain dial-drag interference,
  cloud-project load crashes (defensive `SYNC_STATE` sanitization), and Firebase
  bundle download (SDK fallback for CORS/firewalls). Higher-fidelity mixer
  metering (analyser FFT 64 → 1024); pointer-event standardization on all dials.

## [0.14.0] — 2026-05-20 — "Share Everything"

- Share Modal + deep-link system (`?project=…`) with cloud-first share gating,
  social sharing (Discord / Twitter-X / email), and end-to-end deep-link auto-load.
- (v0.13.0 "Demo Shield") read-only template protection + a GitHub Pages welcome
  modal for the public hosted demo.

---

Releases before v0.14.0 predate this changelog; see the
[GitHub Releases](https://github.com/r0073d-l053r/JAAD-DAW/releases) page for the
full patch-notes history.
