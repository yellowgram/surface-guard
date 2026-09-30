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

test("deny: webhook without permissions and no resolver → missing_contents_permission", async () => {
  const body = payload({
    installation: {
      id: 42,
      account: { login: "acme", type: "Organization" },
      // permissions omitted — mirrors real pull_request payloads
    },
  });
  const raw = Buffer.from(JSON.stringify(body), "utf8");
  const r = await handleGitHubWebhook(
    {
      webhookSecret: SECRET,
      entitlement: entitled,
      makeVerify: () => async () => ({ ok: true }),
      // no resolveInstallationPermissions
    },
    {
      signature: signGitHubWebhook(raw, SECRET),
      event: "pull_request",
      delivery: "d-no-perms",
    },
    raw,
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  if (r.body.ok && r.body.decision?.outcome === "deny") {
    assert.equal(r.body.decision.code, "missing_contents_permission");
  } else {
    assert.fail("expected missing_contents_permission deny");
  }
});

test("deny: webhook without permissions and resolver returns null → missing_contents_permission", async () => {
  const body = payload({
    installation: {
      id: 42,
      account: { login: "acme", type: "Organization" },
    },
  });
  const raw = Buffer.from(JSON.stringify(body), "utf8");
  const r = await handleGitHubWebhook(
    {
      webhookSecret: SECRET,
      entitlement: entitled,
      makeVerify: () => async () => ({ ok: true }),
      resolveInstallationPermissions: async () => null,
    },
    {
      signature: signGitHubWebhook(raw, SECRET),
      event: "pull_request",
      delivery: "d-null-resolve",
    },
    raw,
  );
  assert.equal(r.status, 200);
  if (r.body.ok && r.body.decision?.outcome === "deny") {
    assert.equal(r.body.decision.code, "missing_contents_permission");
  } else {
    assert.fail("expected missing_contents_permission deny");
  }
});

test("allow path: webhook without permissions but resolver returns contents+checks → continues past perm deny", async () => {
  let resolvedId: number | undefined;
  const body = payload({
    installation: {
      id: 42,
      account: { login: "acme", type: "Organization" },
    },
  });
  const raw = Buffer.from(JSON.stringify(body), "utf8");
  const r = await handleGitHubWebhook(
    {
      webhookSecret: SECRET,
      entitlement: entitled,
      makeVerify: () => async () => ({ ok: true }),
      resolveInstallationPermissions: async (installationId) => {
        resolvedId = installationId;
        return { contents: "read", checks: "write", metadata: "read" };
      },
    },
    {
      signature: signGitHubWebhook(raw, SECRET),
      event: "pull_request",
      delivery: "d-resolve-ok",
    },
    raw,
  );
  assert.equal(resolvedId, 42);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  if (r.body.ok && r.body.decision) {
    // Past the permission gate: entitled + verify ok → allow
    assert.equal(r.body.decision.outcome, "allow");
    assert.equal(r.body.decision.conclusion, "success");
  } else {
    assert.fail("expected allow decision after permission resolve");
  }
});

test("check_suite: omitted permissions + resolver → past missing-perm deny", async () => {
  const body = {
    action: "requested",
    installation: { id: 42, account: { login: "acme", type: "Organization" } },
    repository: {
      private: true,
      full_name: "acme/mcp",
      name: "mcp",
      owner: { login: "acme" },
    },
    check_suite: { head_sha: "abc123" },
  };
  const raw = Buffer.from(JSON.stringify(body), "utf8");
  const r = await handleGitHubWebhook(
    {
      webhookSecret: SECRET,
      entitlement: entitled,
      makeVerify: () => async () => ({ ok: true }),
      resolveInstallationPermissions: async () => ({
        contents: "read",
        checks: "write",
      }),
    },
    {
      signature: signGitHubWebhook(raw, SECRET),
      event: "check_suite",
      delivery: "d-suite",
    },
    raw,
  );
  assert.equal(r.status, 200);
  if (r.body.ok && r.body.decision) {
    assert.equal(r.body.decision.outcome, "allow");
  } else {
    assert.fail("expected allow on check_suite after resolve");
  }
});
