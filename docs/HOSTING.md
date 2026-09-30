# Surface Guard — hosting path

Operator runbook to host the **private-repo** GitHub App check. This is not a public-sell go-live checklist.

**Honesty bar (do not cross):**

- Founding **reservation** checkout may be live on www (`/surface-guard`). That is **not** the App.
- Do **not** claim the App is sold publicly, generally available, or “live for buyers” until strategy unpauses G-APP after demand/dependent gates.
- Soft-WTP outreach is banned from this track — no cold DMs, no fabricated demand, no Soft-WTP copy in buyer-facing pages.
- Fail closed always: missing signature, public repo, unpaid org, missing files, auth failure, or Checks API failure → explicit deny / HTTP error. No silent pass.

## What this host does

1. Verify `X-Hub-Signature-256` (refuse placeholder webhook secrets at boot).
2. Gate: private repo + least-privilege installation perms + org entitlement.
3. Mint **installation access token** (Octokit App auth).
4. Fetch lockfile + surface dump via **Contents API** at the PR head SHA.
5. Run **SurfacePin** `verify()` (npm `surfacepin`, same hasher as OSS).
6. Post a completed **Checks API** run (allow or deny).

Public repos stay on the free OSS Action (`yellowgram/surfacepin`).

## Prerequisites

- Node 20+
- A GitHub App created from [`manifest/github-app.yml`](../manifest/github-app.yml) — **do not widen scopes**
- TLS-terminated HTTPS URL for webhooks (Fly / Railway / Render / VM + Caddy / etc.)
- Entitled orgs: env seed **or** Polar durable store (`POST /billing/polar`)

## Customer repo layout (file-mode)

App does **not** spawn customer MCP servers (no stdio on the host). Customers commit both:

| File | Env | Default |
|------|-----|---------|
| Lockfile | `SURFACE_GUARD_LOCKFILE_PATH` | `surfacepin.lock.json` |
| Surface dump JSON | `SURFACE_GUARD_SURFACE_PATH` | **required** (no default) |

Generate with OSS SurfacePin (`surfacepin lock …`). Drift → check failure with field-diff summary.

## Env

Copy [`.env.example`](../.env.example). Critical vars:

```bash
GITHUB_APP_ID=…
GITHUB_APP_PRIVATE_KEY_PATH=./app-private-key.pem   # or GITHUB_APP_PRIVATE_KEY with \n PEM
GITHUB_WEBHOOK_SECRET=…                            # ≥16 chars, not a placeholder
SURFACE_GUARD_ENTITLED_ORGS=acme,other-org         # lowercase logins (bootstrap/override)
SURFACE_GUARD_ENTITLEMENT_PATH=/data/entitlements.json
POLAR_WEBHOOK_SECRET=…                             # Polar dashboard webhook secret
SURFACE_GUARD_LOCKFILE_PATH=surfacepin.lock.json
SURFACE_GUARD_SURFACE_PATH=tools.json              # or combined surface JSON
PORT=3080
HOST=0.0.0.0                                       # behind a reverse proxy
```

Billing webhook: `https://<your-host>/billing/polar`  
Checkout custom field slug: `github_org` (required on founding products).

Emergency only: `SURFACE_GUARD_STUB_VERIFY=1` forces fail-closed stub verify (never use for founding orgs).

## GitHub App setup

1. Create App from the manifest (or paste permissions/events to match it).
2. Webhook URL: `https://<your-host>/github/webhook`
3. Webhook secret = `GITHUB_WEBHOOK_SECRET`
4. Download PEM → `GITHUB_APP_PRIVATE_KEY_PATH`
5. Install on **one org**; select only private repos that need the check
6. Mark org entitled after verified payment (Polar webhook with `github_org`, or `SURFACE_GUARD_ENTITLED_ORGS` override)

## Deploy artifacts

- [`Dockerfile`](../Dockerfile) — multi-stage Node 20, `CMD node dist/src/server.js`, non-root `surfaceguard`, `PORT`/`HOST` from env
- [`fly.toml`](../fly.toml) — app name `surface-guard`, region `iad`, health check `GET /health`
- Ordered go-live checklist: [`OPERATOR_GO_LIVE.md`](OPERATOR_GO_LIVE.md) (founder clicks vs agent work)

## Example: Fly.io

```bash
fly apps create surface-guard   # once
fly volumes create surface_guard_data --region iad --size 1 -a surface-guard   # once
fly secrets set \
  GITHUB_APP_ID=… \
  GITHUB_WEBHOOK_SECRET=… \
  GITHUB_APP_PRIVATE_KEY="$(cat app-private-key.pem)" \
  SURFACE_GUARD_ENTITLED_ORGS=acme \
  SURFACE_GUARD_SURFACE_PATH=tools.json \
  POLAR_WEBHOOK_SECRET=…   # omit until Polar dashboard secret exists
fly scale count 1 -a surface-guard
fly deploy
```

Point the GitHub App webhook at `https://surface-guard.fly.dev/github/webhook`.  
Point Polar at `https://surface-guard.fly.dev/billing/polar`.

Health: `GET /health` → `publicSellLive: false`, `silentPass: false`, `surfacepinVerify: true`, `billingWebhook: true` when Polar secret is set.

## Verify after deploy

```bash
npm ci && npm test
# Open a PR on an entitled private repo with lockfile + surface dump
# Expect a "Surface Guard" check: success on match, failure on drift/missing/public/unpaid
```

## Still operator / strategy (honest gaps)

- GitHub App registration + PEM + webhook secret are **manual**
- Polar → durable entitlement is wired (`POST /billing/polar`); founder must add webhook URL + secret + `github_org` custom field. `publicSellLive` stays false until E2E + strategy
- No multi-region HA / SLA pack
- Public sell / Marketplace listing remains **paused** until gates + strategy unpause
- Live stdio verify is out of scope for the App host (use OSS Action for that)
