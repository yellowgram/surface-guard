import assert from "node:assert/strict";
import { test } from "node:test";
import { handleGitHubWebhook } from "../src/webhook/handler.js";
import { signGitHubWebhook } from "../src/webhook/verify.js";
import { EnvEntitlementStore } from "../src/billing/entitlement.js";
import type { Decision } from "../src/errors.js";

const SECRET = "test-webhook-secret-32chars-min!!";
const entitled = new EnvEntitlementStore(new Set(["acme"]));

function payload() {
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
  };
}

test("handler: posts check on allow and returns checkId", async () => {
  const posted: Decision[] = [];
  const raw = Buffer.from(JSON.stringify(payload()), "utf8");
  const r = await handleGitHubWebhook(
    {
      webhookSecret: SECRET,
      entitlement: entitled,
      makeVerify: () => async () => ({ ok: true }),
      postCheck: async ({ decision }) => {
        posted.push(decision);
        return { id: 777 };
      },
    },
    {
      signature: signGitHubWebhook(raw, SECRET),
      event: "pull_request",
      delivery: "d1",
    },
    raw,
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  if (r.body.ok) {
    assert.equal(r.body.checkId, 777);
    assert.equal(r.body.decision?.outcome, "allow");
  }
  assert.equal(posted.length, 1);
  assert.equal(posted[0]?.outcome, "allow");
});

test("handler: check post failure → 502 fail-closed", async () => {
  const raw = Buffer.from(JSON.stringify(payload()), "utf8");
  const r = await handleGitHubWebhook(
    {
      webhookSecret: SECRET,
      entitlement: entitled,
      makeVerify: () => async () => ({ ok: true }),
      postCheck: async () => {
        throw new Error("checks down");
      },
    },
    {
      signature: signGitHubWebhook(raw, SECRET),
      event: "pull_request",
      delivery: "d1",
    },
    raw,
  );
  assert.equal(r.status, 502);
  assert.equal(r.body.ok, false);
  if (!r.body.ok) assert.equal(r.body.code, "check_post_failed");
});

test("handler: installation_token_failed maps to deny decision + posted check", async () => {
  const raw = Buffer.from(JSON.stringify(payload()), "utf8");
  const r = await handleGitHubWebhook(
    {
      webhookSecret: SECRET,
      entitlement: entitled,
      makeVerify: () => async () => ({
        ok: false,
        reason: "installation_token_failed",
        detail: "mint failed",
      }),
      postCheck: async ({ decision }) => {
        assert.equal(decision.outcome, "deny");
        if (decision.outcome === "deny") {
          assert.equal(decision.code, "installation_token_failed");
        }
        return { id: 1 };
      },
    },
    {
      signature: signGitHubWebhook(raw, SECRET),
      event: "pull_request",
      delivery: "d1",
    },
    raw,
  );
  assert.equal(r.status, 200);
  if (r.body.ok && r.body.decision?.outcome === "deny") {
    assert.equal(r.body.decision.code, "installation_token_failed");
  } else {
    assert.fail("expected installation_token_failed deny");
  }
});
