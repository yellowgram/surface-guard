# Surface Guard — operator go-live checklist

Ordered steps to host the **private-repo** GitHub App check ASAP.

**Honesty bar (do not cross):**

- `publicSellLive` is env-driven (`SURFACE_GUARD_PUBLIC_SELL_LIVE`, default **false**). Founder GO after E2E sets it **true** on Fly for founding $99/$990 only.
- Do **not** claim Marketplace GA beyond founding sell; Soft-WTP / Soft* / coupons stay banned.
- Fail closed always — no silent pass.

**Who does what**

| Actor | Can do |
|-------|--------|
| **Founder (you)** | Create GitHub App, generate webhook secret, download PEM, install App on org, set Fly secrets (or approve agent with fly auth), mark entitled orgs after verified payment, open smoke PR on a private repo you control |
| **Agents** | Land Dockerfile / fly.toml / docs / Polar webhook code, run `npm ci` / test / build, open this PR, draft secret *names* and commands (never invent or commit secret *values*) |

Deploy artifacts in-repo: [`Dockerfile`](../Dockerfile), [`fly.toml`](../fly.toml). Narrative hosting notes: [`HOSTING.md`](HOSTING.md).

---

## (A) Create GitHub App from manifest — **founder clicks**

1. Open GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App** (org or personal; prefer the selling org).
2. Prefer manifest flow: use [`manifest/github-app.yml`](../manifest/github-app.yml) values (name, permissions, events). Paste hooks/permissions to match — **do not widen scopes**.
   - Permissions: `contents:read`, `checks:write`, `metadata:read`, `pull_requests:read` only.
   - Events: `check_suite`, `pull_request`, `installation`, `installation_repositories`.
3. Set **Webhook URL** temporarily to a placeholder if host DNS is not ready yet (complete in C/D), or to `https://surface-guard.fly.dev/github/webhook` once Fly app exists.
4. After create: note **App ID** → becomes `GITHUB_APP_ID`.
5. **Generate a private key** → download PEM. Store offline. Map to `GITHUB_APP_PRIVATE_KEY` (PEM with `\n`) or `GITHUB_APP_PRIVATE_KEY_PATH` (local only; prefer Fly secret with inline PEM).
6. Agents must **not** create the App or upload the PEM to git.

## (B) Generate webhook secret — **founder**

1. Generate a long random secret (≥16 chars; not a placeholder from `.env.example`).
   ```bash
   openssl rand -hex 32
   ```
2. Paste the same value into:
   - GitHub App → Webhook secret
   - Host secret `GITHUB_WEBHOOK_SECRET`
3. Never commit the value. Placeholders refuse to boot / verify (fail closed).

## (C) Deploy host — **founder runs Fly (agents can prepare)**

Prereqs: [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/) logged in as the founding account.

```bash
cd /path/to/surface-guard   # this repo, ops/go-live-host or main after merge
fly apps create surface-guard   # once; skip if app already exists
fly deploy                      # uses Dockerfile + fly.toml (app = surface-guard)
```

- Image CMD: `node dist/src/server.js`
- `PORT` from env (Fly sets it to match `http_service.internal_port` = 8080)
- `HOST=0.0.0.0` in image / fly.toml
- Process runs as non-root user `surfaceguard` (uid 1000)
- Health: `GET /health` → expect JSON with `ok: true`, `publicSellLive` matching env (true when `SURFACE_GUARD_PUBLIC_SELL_LIVE=true`), `silentPass: false`, `surfacepinVerify: true` (not stub), `billingWebhook: true` once Polar secret is set

Agents: do **not** `fly deploy` unless founder explicitly grants Fly access and asks for that deploy.

## (D) Set secrets — **founder** (agents list names only)

```bash
fly secrets set \
  GITHUB_APP_ID='…' \
  GITHUB_WEBHOOK_SECRET='…' \
  GITHUB_APP_PRIVATE_KEY="$(cat /path/to/app-private-key.pem)" \
  SURFACE_GUARD_ENTITLED_ORGS='your-org-login' \
  SURFACE_GUARD_SURFACE_PATH='tools.json' \
  POLAR_WEBHOOK_SECRET='…'   # from Polar webhook endpoint; omit until founder provides
  SURFACE_GUARD_PUBLIC_SELL_LIVE=true   # after E2E + founder GO; founding sell only
```

Optional: `SURFACE_GUARD_LOCKFILE_PATH` (default `surfacepin.lock.json` already in fly.toml `[env]`).

Then point the GitHub App webhook URL at:

`https://surface-guard.fly.dev/github/webhook`

(or your custom domain) and confirm webhook deliveries in the App settings.

## (E) Install App on org — **founder clicks**

1. GitHub App → **Install App** → choose **one org**.
2. Select **only private repos** that need the check (least privilege).
3. Confirm installation has the least-privilege perms from the manifest (no admin / secrets / workflows write).

## (F) Polar billing webhook + durable entitlement — **founder clicks + secrets**

**What shipped in code**

- `POST https://surface-guard.fly.dev/billing/polar` — Polar Standard Webhooks signature verify (fail closed).
- Durable store: JSON file on Fly volume `/data/entitlements.json` (single-writer; keep machine count = 1).
- Union with env seed: org is entitled if **either** `SURFACE_GUARD_ENTITLED_ORGS` lists it **or** Polar granted it.
- Grant events: `order.paid`, `subscription.active`, `subscription.uncanceled`, `subscription.resumed`.
- Revoke events: `subscription.revoked`, `subscription.paused`, `order.refunded`.
  (`subscription.canceled` is ack-only — access until Polar sends `subscription.revoked`.)
- Custom field / metadata key: **`github_org`** (GitHub org login, lowercase).
- `GET /health` → `publicSellLive` from `SURFACE_GUARD_PUBLIC_SELL_LIVE` (default false); `billingWebhook: true` only when `POLAR_WEBHOOK_SECRET` is set (no secret leakage).
- Without `POLAR_WEBHOOK_SECRET`, the route returns **503** (fail closed — never open allow).

**Founding sell only.** Reuse existing Polar checkouts (monthly $99 / yearly $990). Do not invent Soft-WTP / Soft* / coupons. Flip `SURFACE_GUARD_PUBLIC_SELL_LIVE=true` only after E2E + founder GO.

### Founder Polar dashboard steps

1. **Custom field** (Settings → Custom Fields → New):
   - Type: Text
   - Slug: `github_org` (exact)
   - Name/label: e.g. "GitHub organization login"
   - Attach to both founding products/checkout links as **Required**
2. **Webhook endpoint** (Settings → Webhooks → Add Endpoint):
   - URL: `https://surface-guard.fly.dev/billing/polar`
   - Format: Raw
   - Secret: generate in Polar (or paste a long random). This becomes Fly secret `POLAR_WEBHOOK_SECRET`.
   - Subscribe at least: `order.paid`, `order.refunded`, `subscription.active`, `subscription.revoked`, `subscription.paused`, `subscription.uncanceled`, `subscription.resumed` (plus canceled/updated if you want delivery logs).
3. **Fly secret** (after you have the Polar secret value — agents must not invent it):
   ```bash
   fly secrets set POLAR_WEBHOOK_SECRET='…' -a surface-guard
   ```
4. **Bootstrap / override** still works: `SURFACE_GUARD_ENTITLED_ORGS=your-org` for manual grant before webhook E2E.
5. Confirm `GET https://surface-guard.fly.dev/health` shows `"billingWebhook":true` and `"publicSellLive":true` once the sell secret is set.

### Volume (once)

```bash
fly volumes create surface_guard_data --region iad --size 1 -a surface-guard
# Deploy attaches mount from fly.toml; keep a single machine for single-writer JSON.
fly scale count 1 -a surface-guard
```

## (G) Smoke PR check — **founder**

On an **entitled** org, **private** repo with App installed:

1. Commit `surfacepin.lock.json` + surface dump JSON (path = `SURFACE_GUARD_SURFACE_PATH`, e.g. `tools.json`) generated via OSS SurfacePin (`surfacepin lock …`).
2. Open a PR.
3. Expect Checks API run named **Surface Guard**:
   - success when lock matches dump
   - failure on drift / missing files / public repo / unpaid org / auth failure
4. Confirm `GET https://surface-guard.fly.dev/health` shows `publicSellLive` per env and checks still fail closed on deny paths.

Local preflight (agents or founder):

```bash
npm ci && npm test && npm run build
```

---

## Done when

- [ ] App created from manifest (A)
- [ ] Webhook secret set on App + host (B/D)
- [ ] Fly app deployed and healthy (C)
- [ ] Secrets set; webhook URL live (D)
- [ ] Installed on one org, private repos only (E)
- [ ] Polar webhook URL + secret + `github_org` custom field configured; or org listed in `SURFACE_GUARD_ENTITLED_ORGS` after verified payment (F)
- [ ] Smoke PR shows allow + deny paths (G)
- [ ] Founding public sell live only when `SURFACE_GUARD_PUBLIC_SELL_LIVE=true` (no Soft-WTP / Marketplace GA claims)

## Explicit non-goals for this checklist

- Creating the GitHub App via automation / agents
- Committing PEM, webhook secrets, or `.env`
- `npm publish`
- Marketplace GA claims beyond founding $99/$990
- Soft-WTP / Soft* / coupons
