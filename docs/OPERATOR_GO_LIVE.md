# Surface Guard — operator go-live checklist

Ordered steps to host the **private-repo** GitHub App check ASAP.

**Honesty bar (do not cross):**

- `publicSellLive` stays **false** until App + host actually work end-to-end.
- Do **not** claim Marketplace / public-sell / generally available.
- Soft-WTP outreach is banned on this track.
- Reservation checkout on www is **not** the App.
- Fail closed always — no silent pass.

**Who does what**

| Actor | Can do |
|-------|--------|
| **Founder (you)** | Create GitHub App, generate webhook secret, download PEM, install App on org, set Fly secrets (or approve agent with fly auth), mark entitled orgs after verified payment, open smoke PR on a private repo you control |
| **Agents** | Land Dockerfile / fly.toml / docs, run `npm ci` / test / build, open this PR, draft secret *names* and commands (never invent or commit secret *values*), open follow-up issues for Polar webhook |

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
- Health: `GET /health` → expect JSON with `ok: true`, `publicSellLive: false`, `silentPass: false`, `surfacepinVerify: true` (not stub)

Agents: do **not** `fly deploy` unless founder explicitly grants Fly access and asks for that deploy.

## (D) Set secrets — **founder** (agents list names only)

```bash
fly secrets set \
  GITHUB_APP_ID='…' \
  GITHUB_WEBHOOK_SECRET='…' \
  GITHUB_APP_PRIVATE_KEY="$(cat /path/to/app-private-key.pem)" \
  SURFACE_GUARD_ENTITLED_ORGS='your-org-login' \
  SURFACE_GUARD_SURFACE_PATH='tools.json'
```

Optional: `SURFACE_GUARD_LOCKFILE_PATH` (default `surfacepin.lock.json` already in fly.toml `[env]`).

Then point the GitHub App webhook URL at:

`https://surface-guard.fly.dev/github/webhook`

(or your custom domain) and confirm webhook deliveries in the App settings.

## (E) Install App on org — **founder clicks**

1. GitHub App → **Install App** → choose **one org**.
2. Select **only private repos** that need the check (least privilege).
3. Confirm installation has the least-privilege perms from the manifest (no admin / secrets / workflows write).

## (F) Polar / entitlement env stub — **founder + honest gap**

**v1 (now):** entitlement is env-only.

- Set `SURFACE_GUARD_ENTITLED_ORGS` to comma-separated lowercase org logins after **verified** founding / paid checkout.
- Code hook exists: `applyBillingEntitlement` in `src/billing/entitlement.ts` — in-memory helper for a future billing webhook; **no live Polar (or other) webhook route is wired in this repo yet**.

**Do not invent Soft-WTP or public-sell copy.** Reservation checkout ≠ App entitlement until you mark the org.

### Follow-up issue text (paste into a GitHub issue when ready)

```text
Title: Wire Polar entitlement webhook → SURFACE_GUARD_ENTITLED_ORGS store

Body:
v1 Surface Guard hosts with fail-closed env entitlement (SURFACE_GUARD_ENTITLED_ORGS).
applyBillingEntitlement() is a stub hook only — there is no HTTP route verifying Polar
(or Stripe) webhooks, no signature check for billing events, and no durable store.

Need:
- POST /billing/polar (or equivalent) with provider signature verify
- Map paid org login → durable entitlement store (replace env-only for multi-instance)
- Fail closed on bad signatures / unknown events
- Keep publicSellLive=false until strategy unpauses; no Marketplace claim in this work
- Tests for allow/deny on entitlement flip; never silent pass

Out of scope: Soft-WTP outreach, public-sell messaging, widening GitHub App scopes.
```

## (G) Smoke PR check — **founder**

On an **entitled** org, **private** repo with App installed:

1. Commit `surfacepin.lock.json` + surface dump JSON (path = `SURFACE_GUARD_SURFACE_PATH`, e.g. `tools.json`) generated via OSS SurfacePin (`surfacepin lock …`).
2. Open a PR.
3. Expect Checks API run named **Surface Guard**:
   - success when lock matches dump
   - failure on drift / missing files / public repo / unpaid org / auth failure
4. Confirm `GET https://surface-guard.fly.dev/health` still shows `publicSellLive: false`.

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
- [ ] At least one org listed in `SURFACE_GUARD_ENTITLED_ORGS` after verified payment (F)
- [ ] Smoke PR shows allow + deny paths (G)
- [ ] Still **not** claiming Marketplace / public-sell live

## Explicit non-goals for this checklist

- Creating the GitHub App via automation / agents
- Committing PEM, webhook secrets, or `.env`
- `npm publish`
- Polar live webhook (tracked as follow-up above)
- Soft-WTP or public-sell claims
