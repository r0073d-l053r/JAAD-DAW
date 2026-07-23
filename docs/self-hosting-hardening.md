# Self-Hosting & Security Hardening

How to run JAAD's backend safely. Read this **before** exposing any part of it
beyond your own machine.

JAAD's backend is powerful because it does real work — hosting native audio
plugins (Wine + Carla) and running ML stem separation. That same power is the
attack surface: **a plugin host runs plugin code by design.** The defaults ship
locked down; this guide is about keeping them that way as you expose more.

> TL;DR: keep sidecars **loopback-bound**, keep **auth on**, keep **plugin upload
> off**, put **HTTPS + an authenticated proxy** in front of anything remote, and
> never bake a real API key into a public build.

---

## 1. Pick your deployment tier

| Tier | Who can reach it | What to do |
| :-- | :-- | :-- |
| **A. Localhost only** (default) | Just you, on one machine | Nothing extra. Sidecars bind to `127.0.0.1`; the auto-generated token is enough. |
| **B. Private LAN / tailnet** | Trusted devices | Front the app with HTTPS. Keep sidecar tokens. Do **not** publish sidecar ports. |
| **C. Internet-exposed** | Anyone | Authenticated HTTPS reverse proxy in front of the app; sidecars stay loopback-only and are reached **only** through the app's proxy; strict tokens; enable container isolation (§6). |

Most self-hosters want **A** or **B**. Only go to **C** if you understand the
plugin-execution risk (§4).

---

## 2. Sidecars are authenticated by default

The DSP/VST sidecar (`docker-dsp`) and the stem sidecar (`docker-demucs`) each
require a token. If you don't set one, the sidecar **auto-generates one on first
boot and prints it** — no unauthenticated sidecar ever starts by accident.

**Get the token from the logs:**

```bash
docker compose logs dsp | grep -A1 "auth token"
docker compose logs stems | grep -A1 "auth token"   # if you run the stems profile
```

**Enter it in the app:** Settings → **AI & Cloud** → *Self-Hosted Sidecar Access*
→ paste into **VST / DSP Bridge Token** and **Stem Separation Token**. It's stored
only in your browser (`localStorage`), never sent anywhere but your sidecar.

**Or pin a fixed token** (useful for scripted deploys) — uncomment in
`docker-compose.yml`:

```yaml
# dsp:
  environment:
    - JAAD_DSP_TOKEN=<a long random secret>     # e.g. `openssl rand -hex 24`
# stems:
  environment:
    - JAAD_STEMS_TOKEN=<a long random secret>
```

The tokens persist across restarts (DSP token in `./vst/.dsp_token`, stems token
in the models volume), so you paste them into the app once.

---

## 3. Keep the ports loopback-bound

The shipped `docker-compose.yml` binds both sidecars to `127.0.0.1` only:

```yaml
ports:
  - "127.0.0.1:8080:8080"   # DSP bridge
  - "127.0.0.1:6080:6080"   # noVNC plugin GUI
  - "127.0.0.1:8000:8000"   # stems
```

**Do not change these to `0.0.0.0:...`** to reach a sidecar from another machine.
Instead, expose the **app** over HTTPS and reverse-proxy to the sidecar on the
internal Docker network through your own front proxy (nginx / Caddy / Traefik, or
Tailscale Serve) — with auth. This keeps one authenticated front door instead of
publishing each sidecar port.

---

## 4. Never do these on a shared or exposed host

- **Don't set `JAAD_DSP_ALLOW_NO_AUTH=1` / `JAAD_STEMS_ALLOW_NO_AUTH=1`.** These
  disable the token entirely. They exist only for a throwaway localhost box.
- **Don't set `JAAD_ENABLE_PLUGIN_UPLOAD=1`** unless you are the only, trusted
  operator. Over-the-wire upload writes a binary that Carla **executes under
  Wine** — that is arbitrary code execution by design. Off by default; to add a
  plugin on a shared host, drop the file into `./vst` on the server yourself.
- **Don't load VST/VST3 plugins you don't trust.** Loading a plugin runs its code.

---

## 5. Put HTTPS in front (secure context)

The browser Web Audio + `SharedArrayBuffer` features JAAD relies on require a
**secure context** — the app must be served over **HTTPS** (or `localhost`).
Terminate TLS at a reverse proxy (Caddy, nginx, Traefik, or Tailscale Serve) and
point it at the app container. Preserve the cross-origin-isolation headers the
app sets (`Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`) — don't
strip them at the proxy.

---

## 6. Tighten the containers

The compose file ships with `no-new-privileges`, `pids_limit`, and
**`cap_drop: ["ALL"]`** on **every** service — the app adds back only the four
caps nginx needs (`CHOWN`, `SETUID`, `SETGID`, `NET_BIND_SERVICE`); the dsp (Wine)
and stems (torch) containers need none. `mem_limit` is set on the app and dsp
(stems is opt-in — see below). All three were smoke-tested with caps dropped: the
app serves, the Wine bridge loads plugins, and GPU Demucs separates. (On dsp,
jackd logs a harmless "Cannot lock down memory" — dropping `CAP_IPC_LOCK` blocks
`mlock`, but `--no-realtime` doesn't need it.)

Two further tightenings are left opt-in (commented) because they need a test on
your host:

- **Read-only root filesystem** on the app, with `tmpfs` for nginx's writable
  paths. (Impractical for the dsp container — Wine writes `~/.wine`, Xvfb `/tmp`.)
- A **`mem_limit` on the stems service** sized to your host so one big separation
  can't exhaust RAM.

---

## 7. Firebase backend (cloud sync)

Cloud sync is optional. If you connect your own Firebase project:

- Enable the **Anonymous** sign-in provider and **deploy the shipped rules** —
  they're inactive until you do. See
  [firebase-deploy-checklist.md](firebase-deploy-checklist.md).
  ```bash
  firebase deploy --only firestore:rules,storage
  ```
- The rules enforce **per-user ownership**, make audio assets **immutable**, and
  **size-cap** uploads (denial-of-wallet defense).
- **Known design limit:** projects are readable by anyone who has the (unguessable,
  CSPRNG) project ID — this is how share links work, so there are no *private*
  projects yet, and a leaked ID can't be revoked. Don't put secrets in a project
  you've shared. Real accounts + private projects are on the roadmap.

The Firebase **web config** (`apiKey`, etc.) is public by design — security is
enforced by the rules, not by hiding those values.

---

## 8. AI keys — never bake a secret into a public build

- On the **hosted/public** build, JAAD is **BYOK**: each user pastes their own
  Gemini key in Settings; it's stored only in their browser.
- **Never set `VITE_GEMINI_API_KEY`** for a build you host publicly — Vite bakes
  it into the JS bundle and anyone can extract it. Only use it for a private,
  network-restricted deployment.
- **Residual risk:** the BYOK key lives in `localStorage`, so a successful XSS
  against the app could read it. The app's Content-Security-Policy is the primary
  defense (§9). Treat your key like a password; revoke it if the machine is
  compromised.

---

## 9. Known residual: CSP needs `unsafe-eval`

The shipped Content-Security-Policy (`nginx.conf`) still allows `'unsafe-eval'`
and `'unsafe-inline'` (styles). This is required today because `essentia.js`
(BPM detection) compiles its Emscripten module via `new Function(...)`, and
Tailwind emits inline styles. It weakens the XSS defense the CSP would otherwise
give. Mitigations in place: everything else in the CSP is locked to `'self'`,
`object-src 'none'`, `frame-ancestors 'none'`. Removing `unsafe-eval` (by moving
essentia to a worker/precompiled path) is tracked on the roadmap.

---

## 10. Pre-exposure checklist

Before anyone but you can reach it:

- [ ] Sidecar ports still bound to `127.0.0.1` (or reached only via the app proxy)
- [ ] `JAAD_DSP_ALLOW_NO_AUTH` / `JAAD_STEMS_ALLOW_NO_AUTH` **not** set
- [ ] `JAAD_ENABLE_PLUGIN_UPLOAD` **not** set (unless single trusted operator)
- [ ] Sidecar tokens set/copied into the app; confirmed the bridge connects
- [ ] App served over **HTTPS**, isolation headers preserved
- [ ] Container isolation enabled and smoke-tested (§6)
- [ ] Firebase rules deployed (if using cloud sync)
- [ ] No `VITE_GEMINI_API_KEY` baked into a public build
- [ ] Reported issues go to [SECURITY.md](../SECURITY.md), not public issues

See also: [SECURITY.md](../SECURITY.md) · [firebase-deploy-checklist.md](firebase-deploy-checklist.md) · [ADR index](adr/README.md)
