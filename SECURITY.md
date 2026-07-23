# Security Policy

Thanks for helping keep **JAAD (Just Another AI DAW)** and its users safe.

JAAD is early-alpha software. We take security seriously anyway — especially
because the self-hostable backend includes a **DSP/VST sidecar that runs native
plugin code** and an optional **stem-separation sidecar**. Please read the
[hardening notes](#self-hosting-hardening) before exposing any of it beyond your
own machine.

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Report it privately through **GitHub's private vulnerability reporting**:

1. Go to the repository's **Security** tab → **Report a vulnerability**
   (this opens a private advisory only the maintainers can see), or use
   <https://github.com/r0073d-l053r/JAAD-DAW/security/advisories/new>.
2. Include:
   - what the issue is and the impact you think it has,
   - the version / commit (or "hosted demo"),
   - clear steps to reproduce (a proof-of-concept is welcome),
   - any suggested fix.

If you cannot use GitHub advisories, open a normal issue that says only *"security
report — please provide a private contact"* with **no technical details**, and a
maintainer will follow up.

### What to expect

- **Acknowledgement:** within about **7 days**.
- **Assessment & next steps:** within about **14 days** of acknowledgement.
- We'll keep you updated on the fix, and we're happy to **credit you** in the
  release notes (tell us the name/handle you'd like, or ask to stay anonymous).

This is a volunteer, best-effort project — timelines are targets, not guarantees.

### Coordinated disclosure

Please give us a reasonable chance to ship a fix before disclosing publicly. We
aim to resolve valid reports within **90 days** and will coordinate a disclosure
date with you. We will not pursue or support legal action against good-faith
research that follows this policy.

## Scope

**In scope**

- The web app (`src/`) and its production container (`Dockerfile`, `nginx.conf`).
- The DSP/VST sidecar (`docker-dsp/`) and stem sidecar (`docker-demucs/`).
- Firebase rules (`firestore.rules`, `storage.rules`).
- CI/build configuration in this repository.

**Out of scope**

- Anything requiring a **malicious VST/AU plugin that the operator chose to load**
  — hosting plugins means running their code by design (see hardening below).
- Findings that only apply when a deployment **ignores the documented secure
  defaults** (e.g. sets `JAAD_DSP_ALLOW_NO_AUTH=1` on an internet-exposed host,
  or enables `JAAD_ENABLE_PLUGIN_UPLOAD` on a shared box).
- Denial of service from unrealistic load against a single self-hosted instance.
- Vulnerabilities in third-party dependencies with no JAAD-specific impact — please
  report those upstream (we do run `npm audit` in CI).
- Social engineering, physical access, and spam/rate-limit reports on the public
  demo.

## Supported versions

JAAD has not reached a stable release yet. Security fixes land on **`main`**, and
only the **latest `main` / most recent tag** is supported. Self-hosters should
track `main`.

## Self-hosting hardening

If you run the backend, the sidecars are **authenticated by default** — each
prints a token on first boot that you paste into the app
(Settings → AI & Cloud → *Self-Hosted Sidecar Access*). Before exposing anything
beyond `localhost`:

- Keep the sidecar ports **loopback-bound** (the shipped default) or front them
  with an authenticated reverse proxy over HTTPS.
- **Do not** set `JAAD_DSP_ALLOW_NO_AUTH` / `JAAD_STEMS_ALLOW_NO_AUTH` on an
  exposed host.
- Leave **plugin upload off** (`JAAD_ENABLE_PLUGIN_UPLOAD` unset) unless you are
  the only, trusted operator — uploaded plugins execute as native code.
- Only load VST/VST3 plugins you trust.

The full self-hosting hardening guide lives in the project docs.
