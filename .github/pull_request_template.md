<!--
Thanks for contributing to JAAD! Please fill this out so review is quick.
Security fix? Do NOT describe the vulnerability in a public PR — see SECURITY.md.
-->

## What & why

<!-- What does this change, and why? Link the issue it closes. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / chore
- [ ] Docs
- [ ] Security / hardening

## How I tested it

<!-- Commands run, browsers checked, manual steps. -->

## Checklist

- [ ] `npm run lint` passes (eslint + typecheck)
- [ ] `npm run test` passes; I added/updated tests for changed behavior
- [ ] Focused change — no unrelated edits bundled in
- [ ] **No secrets committed** (tokens, API keys, `.env`, real Firebase config)
- [ ] Docs/README updated if behavior changed
- [ ] Commits signed off (`git commit -s`, DCO)

## Security-sensitive areas

<!-- Tick if this PR touches any of these, and describe the security impact. -->

- [ ] Sidecars (`docker-dsp/`, `docker-demucs/`) — auth, upload path, isolation
- [ ] `firestore.rules` / `storage.rules`
- [ ] `nginx.conf` / `Dockerfile` / `docker-compose.yml`
- [ ] Key / token / `localStorage` secret handling
- [ ] None of the above
