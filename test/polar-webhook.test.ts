import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FileEntitlementStore,
  UnionEntitlementStore,
  evaluateEntitlement,
} from "../src/billing/entitlement.js";
import {
  handlePolarWebhook,
  extractGithubOrg,
  GITHUB_ORG_FIELD,
} from "../src/billing/polarWebhook.js";
import {
  signPolarWebhook,
  verifyPolarWebhookSignature,
} from "../src/billing/polarVerify.js";
import { createServer } from "../src/server.js";
import { SurfaceGuardDeny } from "../src/errors.js";

const SECRET = "test-polar-webhook-secret!!";

function orderPaid(org: string | null) {
  const custom_field_data =
    org === null ? {} : { [GITHUB_ORG_FIELD]: org };
  return {
    type: "order.paid",
    data: {
      id: "order_1",
      status: "paid",
      custom_field_data,
      metadata: {},
    },
  };
}

test("polar signature: valid legacy-utf8 accepts", () => {
  const body = Buffer.from(JSON.stringify(orderPaid("acme")), "utf8");
  const signed = signPolarWebhook(body, SECRET);
  assert.deepEqual(
    verifyPolarWebhookSignature(
      body,
      { id: signed.id, timestamp: signed.timestamp, signature: signed.signature },
      SECRET,
    ),
    { ok: true },
  );
});

test("polar signature: missing headers fail closed", () => {
  const body = Buffer.from("{}", "utf8");
  assert.throws(
    () => verifyPolarWebhookSignature(body, {}, SECRET),
    (err: unknown) =>
      err instanceof SurfaceGuardDeny && err.code === "webhook_signature_missing",
  );
});

test("polar signature: bad signature fail closed", () => {
  const body = Buffer.from(JSON.stringify(orderPaid("acme")), "utf8");
  const signed = signPolarWebhook(body, SECRET);
  assert.throws(
    () =>
      verifyPolarWebhookSignature(
        body,
        {
          id: signed.id,
          timestamp: signed.timestamp,
          signature: "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        },
        SECRET,
      ),
    (err: unknown) =>
      err instanceof SurfaceGuardDeny && err.code === "webhook_signature_invalid",
  );
});

test("extractGithubOrg prefers custom_field_data.github_org", () => {
  assert.equal(
    extractGithubOrg({
      custom_field_data: { github_org: "Acme-Corp" },
      metadata: { github_org: "other" },
    }),
    "acme-corp",
  );
  assert.equal(extractGithubOrg({ metadata: { github_org: "only-meta" } }), "only-meta");
  assert.equal(extractGithubOrg({ custom_field_data: {} }), null);
});

test("grant flips allow; revoke flips deny; missing org skipped fail-closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sg-polar-"));
  const path = join(dir, "e.json");
  try {
    const store = new FileEntitlementStore(path);

    const body = Buffer.from(JSON.stringify(orderPaid("acme")), "utf8");
    const signed = signPolarWebhook(body, SECRET, { id: "msg_grant" });
    const grant = await handlePolarWebhook(
      { polarWebhookSecret: SECRET, store },
      { id: signed.id, timestamp: signed.timestamp, signature: signed.signature },
      body,
    );
    assert.equal(grant.status, 202);
    assert.equal(grant.body.action, "grant");
    assert.equal((await evaluateEntitlement(store, "acme")).outcome, "continue");

    const badSig = await handlePolarWebhook(
      { polarWebhookSecret: SECRET, store },
      { id: "x", timestamp: String(Math.floor(Date.now() / 1000)), signature: "v1,AAAA" },
      body,
    );
    assert.equal(badSig.status, 401);

    const missingOrgBody = Buffer.from(JSON.stringify(orderPaid(null)), "utf8");
    const missingSigned = signPolarWebhook(missingOrgBody, SECRET, { id: "msg_miss" });
    const skipped = await handlePolarWebhook(
      { polarWebhookSecret: SECRET, store },
      {
        id: missingSigned.id,
        timestamp: missingSigned.timestamp,
        signature: missingSigned.signature,
      },
      missingOrgBody,
    );
    assert.equal(skipped.status, 202);
    assert.equal(skipped.body.action, "skipped");
    assert.equal(skipped.body.reason, "missing_github_org");
    // Existing grant unchanged; unknown org still denied
    assert.equal((await evaluateEntitlement(store, "nobody")).outcome, "deny");

    const revokeBody = Buffer.from(
      JSON.stringify({
        type: "order.refunded",
        data: {
          id: "order_1",
          custom_field_data: { github_org: "acme" },
        },
      }),
      "utf8",
    );
    const revokeSigned = signPolarWebhook(revokeBody, SECRET, { id: "msg_rev" });
    const revoked = await handlePolarWebhook(
      { polarWebhookSecret: SECRET, store },
      {
        id: revokeSigned.id,
        timestamp: revokeSigned.timestamp,
        signature: revokeSigned.signature,
      },
      revokeBody,
    );
    assert.equal(revoked.status, 202);
    assert.equal(revoked.body.action, "revoke");
    assert.equal((await evaluateEntitlement(store, "acme")).outcome, "deny");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unconfigured polar secret → 503, never open allow", async () => {
  const store = new FileEntitlementStore(join(tmpdir(), "unused-polar.json"));
  const body = Buffer.from(JSON.stringify(orderPaid("acme")), "utf8");
  const r = await handlePolarWebhook(
    { polarWebhookSecret: "", store },
    { id: "a", timestamp: "1", signature: "v1,x" },
    body,
  );
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "webhook_secret_unconfigured");
});

test("HTTP /billing/polar + env seed still works via createServer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sg-http-"));
  const path = join(dir, "e.json");
  try {
    const durable = new FileEntitlementStore(path);
    const store = new UnionEntitlementStore(new Set(["seed-org"]), durable);
    const server = createServer({
      env: {
        GITHUB_APP_ID: "1",
        GITHUB_WEBHOOK_SECRET: "test-webhook-secret-32chars-min!!",
        GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----",
        POLAR_WEBHOOK_SECRET: SECRET,
        SURFACE_GUARD_ENTITLED_ORGS: "seed-org",
        SURFACE_GUARD_ENTITLEMENT_PATH: path,
        SURFACE_GUARD_STUB_VERIFY: "1",
      },
      entitlementStore: store,
      makeVerify: () => async () => ({ ok: true }),
      postCheck: async () => ({ id: 1 }),
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const port = addr.port;

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    const healthJson = (await health.json()) as Record<string, unknown>;
    assert.equal(healthJson.publicSellLive, false); // default: env unset
    assert.equal(healthJson.billingWebhook, true);
    assert.equal(healthJson.silentPass, false);

    // Env seed org entitled without Polar grant
    assert.equal((await store.isOrgEntitled("seed-org")).status, "entitled");

    const payload = orderPaid("paid-via-polar");
    const raw = Buffer.from(JSON.stringify(payload), "utf8");
    const signed = signPolarWebhook(raw, SECRET, { id: "http_grant" });
    const res = await fetch(`http://127.0.0.1:${port}/billing/polar`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": signed.id,
        "webhook-timestamp": signed.timestamp,
        "webhook-signature": signed.signature,
      },
      body: raw,
    });
    assert.equal(res.status, 202);
    const json = (await res.json()) as Record<string, unknown>;
    assert.equal(json.action, "grant");
    assert.equal((await store.isOrgEntitled("paid-via-polar")).status, "entitled");

    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
