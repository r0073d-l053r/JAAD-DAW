# Contributing to JAAD

Thanks for your interest in **Just Another AI DAW**! This is the open-source
**Community Edition** (MIT). Contributions — bug reports, fixes, features, docs —
are welcome.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Bugs / features:** open an issue first (use the templates) so we can agree on
  the approach before you spend time on a PR.
- **Security issues:** do **not** open a public issue — follow the
  [Security Policy](SECURITY.md).
- **Big changes:** for anything architectural, skim `docs/adr/` and consider
  proposing an ADR; it saves rework.

## Development setup

Requires Node.js (20+). All commands run inside the `JAAD-DAW` directory.

```bash
npm install
npm run dev        # Vite dev server → http://localhost:3000/JAAD-DAW/
```

> Note: the app's base path is `/JAAD-DAW/`, so the bare root 404s even in dev.

Useful commands:

```bash
npm run lint       # eslint + tsc --noEmit  (must pass — CI gate)
npm run test       # vitest
npm run build      # production build → dist/
npm run format     # prettier
```

Optional backend sidecars (Docker):

```bash
docker compose up -d --build            # app + DSP/VST sidecar
docker compose --profile stems up -d    # also the stem-separation sidecar
```

## Making a change

1. **Fork** and create a branch: `git checkout -b feat/short-description`
   (prefixes we use: `feat/`, `fix/`, `chore/`, `docs/`, `harden/`).
2. Make your change. Match the surrounding code style; keep diffs focused.
3. **Run `npm run lint` and `npm run test`** — both must pass. Add or update tests
   for behavior you change.
4. Commit with a clear, conventional message
   (e.g. `fix(timeline): stop clip drag from snapping past bar 0`).
5. Push and open a **pull request** against `main`, filling in the PR template.

CI (`.github/workflows/`) runs `npm audit`, typecheck, tests, and a Docker build.
PRs must be green to merge.

## What makes a PR easy to merge

- **Focused:** one logical change per PR. Split unrelated cleanups out.
- **Tested:** new logic has tests; `npm run test` passes locally.
- **No secrets:** never commit tokens, API keys, `.env` files, or a real Firebase
  config. `.env.example` uses placeholders — keep it that way.
- **Docs updated:** if you change behavior, update the README / relevant docs.
- **DCO:** please sign off your commits (`git commit -s`) to certify you wrote the
  code and can contribute it under the MIT license.

## Extra care in security-sensitive areas

Changes to these get a closer review — call out the security impact in your PR:

- `docker-dsp/`, `docker-demucs/` — the sidecars (auth, the plugin/upload path,
  container isolation). Don't weaken the secure-by-default posture (auth on,
  upload off, origin allow-list).
- `firestore.rules`, `storage.rules` — access control. Include your reasoning.
- `nginx.conf`, `Dockerfile`, `docker-compose.yml` — headers, CSP, and isolation.
- Anything touching the Gemini/BYOK key handling or `localStorage` secrets.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
