import assert from "node:assert/strict";
import { test } from "node:test";
import { handleGitHubWebhook } from "../src/webhook/handler.js";
import { signGitHubWebhook } from "../src/webhook/verify.js";
import { EnvEntitlementStore } from "../src/billing/entitlement.js";

const SECRET = "test-webhook-secret-32chars-min!!";
const entitled = new EnvEntitlementStore(new Set(["acme"]));

function payload(overrides: Record<string, unknown> = {}) {
  return {
    action: "synchronize",
    installation: {
      id: 42,
      permissions: { contents: "read", checks: "write", metadata: "read" },
      account: { login: "acme", type: "Organization" },
    },
    repository: {
      private: true,
      full_name: "acme/mcp",
      name: "mcp",
      owner: { login: "acme" },
    },
    pull_request: { head: { sha: "abc123" } },
    ...overrides,
  };
}

async function post(
  bodyObj: unknown,
  opts: {
    event?: string;
    sig?: string | null;
    verifyOk?: boolean;
  } = {},
) {
  const raw = Buffer.from(JSON.stringify(bodyObj), "utf8");
  const signature =
    opts.sig === null
      ? undefined
      : (opts.sig ?? signGitHubWebhook(raw, SECRET));
  return handleGitHubWebhook(
    {
      webhookSecret: SECRET,
      entitlement: entitled,
      makeVerify: () => async () =>
        opts.verifyOk === false
          ? { ok: false, reason: "drift", detail: "drifted" }
          : { ok: true },
    },
    { signature, event: opts.event ?? "pull_request", delivery: "d1" },
    raw,
  );
}

test("deny: unsigned webhook → 401, no decision", async () => {
  const r = await post(payload(), { sig: null });
  assert.equal(r.status, 401);
  assert.equal(r.body.ok, false);
  if (!r.body.ok) assert.equal(r.body.code, "webhook_signature_missing");
});

test("allow: private entitled signed PR → success decision", async () => {
  const r = await post(payload(), { verifyOk: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  if (r.body.ok && r.body.decision) {
    assert.equal(r.body.decision.outcome, "allow");
    assert.equal(r.body.decision.conclusion, "success");
  }
});

test("deny: public repo on signed webhook", async () => {
  const r = await post(
    payload({ repository: { private: false, full_name: "acme/pub", name: "pub", owner: { login: "acme" } } }),
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  if (r.body.ok && r.body.decision) {
    assert.equal(r.body.decision.outcome, "deny");
    if (r.body.decision.outcome === "deny") {
      assert.equal(r.body.decision.code, "repo_public");
    }
  }
});

test("deny: not entitled org", async () => {
  const r = await post(
    payload({
      installation: {
        id: 99,
        permissions: { contents: "read", checks: "write" },
        account: { login: "other-org", type: "Organization" },
      },
    }),
  );
  assert.equal(r.status, 200);
  if (r.body.ok && r.body.decision && r.body.decision.outcome === "deny") {
    assert.equal(r.body.decision.code, "org_not_entitled");
  } else {
    assert.fail("expected deny decision");
  }
});

test("deny: verify drift surfaces as lockfile_drift", async () => {
  const r = await post(payload(), { verifyOk: false });
  assert.equal(r.status, 200);
  if (r.body.ok && r.body.decision && r.body.decision.outcome === "deny") {
    assert.equal(r.body.decision.code, "lockfile_drift");
  } else {
    assert.fail("expected drift deny");
  }
});
