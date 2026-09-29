# Surface Guard

**Paid GitHub App** — private-repo PR check for [SurfacePin](https://github.com/yellowgram/surfacepin) lockfiles.

| Layer | Repo / URL | Price |
|-------|------------|-------|
| OSS SurfacePin | `yellowgram/surfacepin` (MIT) | Free, offline |
| Surface Guard App | this repo | **$99/mo** or **$990/yr** per org |
| Founding reservation | [www.yellowgram.dev/surface-guard](https://www.yellowgram.dev/surface-guard) | First 20 orgs lock price · 90-day auto-refund if no working private-repo check |

Public repos stay on the free OSS Action. This App is for **private** repos on paying orgs only.

## Hardening contract (this branch)

Every path is **fail-closed**. There is no silent pass.

1. **Webhook signature** — `X-Hub-Signature-256` HMAC-SHA256 required. Missing/invalid → `401`. Placeholder secrets refuse to boot / verify.
2. **Private-repo gate** — `repository.private === true` required. Public → deny (point at OSS Action). `null` / unknown → deny.
3. **Least privilege** — see [`manifest/github-app.yml`](manifest/github-app.yml): `contents:read`, `checks:write`, `metadata:read`, `pull_requests:read` only. Missing required scope → deny with a clear check message.
4. **Entitlement** — org must be on an active plan. Store errors / unavailable → deny (not allow).
5. **Clear check titles** — every deny uses a typed code + human summary (`repo_public`, `org_not_entitled`, `lockfile_drift`, …).

## Status

App **server scaffold** for hardening + unit tests. Production Octokit file-fetch + check-run posting still to wire before go-live (`stubVerifyUnavailable` fails closed until then). Demand gates may pause public sell; this repo hardens the App path so founding orgs get a real private-repo check within the 90-day window.

## Develop

```bash
npm install
npm test
```

### Verify deny / allow locally

```bash
npm test
# Covers:
#   webhook-verify     — allow valid sig; deny missing/wrong/tampered/placeholder
#   private-repo       — allow private+perms; deny public/unknown/missing scopes
#   entitlement        — allow entitled; deny unpaid / store down
#   check-decision     — full pipeline allow + deny matrix
#   handler-deny-allow — signed webhook HTTP decisions
```

### Boot (refuses placeholder webhook secret)

```bash
export GITHUB_APP_ID=123
export GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
export GITHUB_WEBHOOK_SECRET='a-long-random-secret!!'
export SURFACE_GUARD_ENTITLED_ORGS=acme
npm run build && npm start
# POST /github/webhook  GET /health
```

## Install flow (operator)

1. Create GitHub App from [`manifest/github-app.yml`](manifest/github-app.yml) (do not widen scopes).
2. Set webhook URL to `https://<host>/github/webhook`, secret = `GITHUB_WEBHOOK_SECRET`.
3. Install on one **org**; select only private repos that need the check.
4. Mark org entitled after verified Polar payment (`SURFACE_GUARD_ENTITLED_ORGS` or billing hook `applyBillingEntitlement`).
5. Open a PR on a private repo with `surfacepin.lock.json` — check must fail closed until verify is wired, then match/deny with explicit messages.

## License

Proprietary — see `LICENSE`. OSS SurfacePin remains MIT.
