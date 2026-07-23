# Changelog

All notable changes to JAAD are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Community Edition hardening

Hardening pass to make the open-source **Community Edition** safe to publish and
safe for a stranger to self-host. Branch: `harden/community-edition`.

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

## [0.1.0] — Early alpha (prior state)

The pre-hardening alpha: a browser DAW (React 19 + Vite + Web Audio) with a
generative AI copilot (Gemini, BYOK), a three-tier stem-separation engine
(browser WebGPU/WASM + self-hosted Demucs sidecar), a Wine/Carla Cloud VST bridge,
Firebase cloud sync with per-user ownership rules, and a Liquid Glass UI.
See `docs/adr/` for the architecture decisions behind these.
