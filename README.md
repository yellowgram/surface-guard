# Surface Guard

**Paid GitHub App** — private-repo PR check for [SurfacePin](https://github.com/yellowgram/surfacepin) lockfiles.

| Layer | Repo / URL | Price | Status |
|-------|------------|-------|--------|
| OSS SurfacePin | `yellowgram/surfacepin` (MIT) | Free, offline | Live |
| Surface Guard founding reservation | [www.yellowgram.dev/surface-guard](https://www.yellowgram.dev/surface-guard) | First 20 orgs lock **$99/mo** or **$990/yr** · 90-day auto-refund if no working private-repo check | Reservation checkout may be live |
| Surface Guard App (this repo) | private-repo Checks API path | same founding prices when strategy unpauses | **Code wired; not claimed public-sell live** |

Public repos stay on the free OSS Action. This App is for **private** repos on paying orgs only.

**Do not** tell buyers the App is generally available / public-sell live until strategy unpauses G-APP. Soft-WTP outreach is out of scope for this repo.

## What is wired (this branch)

Fail-closed end-to-end path for a hosted App:

1. **Webhook signature** — `X-Hub-Signature-256` HMAC-SHA256 required. Missing/invalid → `401`. Placeholder secrets refuse to boot / verify.
2. **Private-repo gate** — `repository.private === true` required. Public → deny (point at OSS Action). `null` / unknown → deny.
3. **Least privilege** — [`manifest/github-app.yml`](manifest/github-app.yml): `contents:read`, `checks:write`, `metadata:read`, `pull_requests:read` only.
4. **Entitlement** — org must be on an active plan. Store errors → deny.
5. **Octokit installation token** — mint per delivery; mint failure → `installation_token_failed` deny.
6. **Contents fetch** — lockfile + surface dump at PR head SHA.
7. **SurfacePin verify** — npm `surfacepin` `verify()` (same hasher as OSS). Drift → field-diff in check summary.
8. **Checks API post** — completed check run for allow **and** deny. Post failure → HTTP `502` (GitHub may retry). No silent missing verdict.

Hosting operator notes: [`docs/HOSTING.md`](docs/HOSTING.md).

## Customer repo (file-mode)

App host does **not** spawn MCP stdio. Commit both:

- `surfacepin.lock.json` (or `SURFACE_GUARD_LOCKFILE_PATH`)
- surface dump JSON (`SURFACE_GUARD_SURFACE_PATH`, e.g. `tools.json`)

## Develop

```bash
npm install
npm test
```

### Verify deny / allow locally

```bash
npm test
# Covers webhook, privacy, entitlement, pipeline, handler, contents, checks,
# real surfacepin verify (fixtures), check post fail-closed
```

### Boot (refuses placeholder webhook secret)

```bash
export GITHUB_APP_ID=123
export GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
export GITHUB_WEBHOOK_SECRET='a-long-random-secret!!'
export SURFACE_GUARD_ENTITLED_ORGS=acme
export SURFACE_GUARD_SURFACE_PATH=tools.json
npm run build && npm start
# POST /github/webhook  GET /health  (health.publicSellLive === false)
```

## Install flow (operator)

1. Create GitHub App from [`manifest/github-app.yml`](manifest/github-app.yml) (do not widen scopes).
2. Set webhook URL to `https://<host>/github/webhook`, secret = `GITHUB_WEBHOOK_SECRET`.
3. Install on one **org**; select only private repos that need the check.
4. Mark org entitled after verified Polar payment (`SURFACE_GUARD_ENTITLED_ORGS` or billing hook `applyBillingEntitlement`).
5. Open a PR on a private repo with lockfile + surface dump — check must match or deny with explicit messages.

See [`docs/HOSTING.md`](docs/HOSTING.md) for Fly/env details and honest gaps.

## License

Proprietary — see `LICENSE`. OSS SurfacePin remains MIT.
