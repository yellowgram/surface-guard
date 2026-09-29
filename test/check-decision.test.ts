import assert from "node:assert/strict";
import { test } from "node:test";
import { runSurfaceGuardCheck } from "../src/check/runCheck.js";
import { EnvEntitlementStore } from "../src/billing/entitlement.js";

const permsOk = { contents: "read", checks: "write" };
const entitled = new EnvEntitlementStore(new Set(["acme"]));

test("allow: private + entitled + verify ok", async () => {
  const d = await runSurfaceGuardCheck({
    repo: { private: true, permissions: permsOk, fullName: "acme/x" },
    orgLogin: "acme",
    entitlement: entitled,
    verify: async () => ({ ok: true }),
  });
  assert.equal(d.outcome, "allow");
  assert.equal(d.conclusion, "success");
});

test("deny: public beats entitlement (no silent App pass)", async () => {
  const d = await runSurfaceGuardCheck({
    repo: { private: false, permissions: permsOk, fullName: "acme/pub" },
    orgLogin: "acme",
    entitlement: entitled,
    verify: async () => ({ ok: true }),
  });
  assert.equal(d.outcome, "deny");
  if (d.outcome === "deny") assert.equal(d.code, "repo_public");
});

test("deny: not entitled even if private + verify would pass", async () => {
  const d = await runSurfaceGuardCheck({
    repo: { private: true, permissions: permsOk },
    orgLogin: "stranger",
    entitlement: entitled,
    verify: async () => ({ ok: true }),
  });
  assert.equal(d.outcome, "deny");
  if (d.outcome === "deny") assert.equal(d.code, "org_not_entitled");
});

test("deny: lockfile missing", async () => {
  const d = await runSurfaceGuardCheck({
    repo: { private: true, permissions: permsOk },
    orgLogin: "acme",
    entitlement: entitled,
    verify: async () => ({ ok: false, reason: "missing" }),
  });
  assert.equal(d.outcome, "deny");
  if (d.outcome === "deny") assert.equal(d.code, "lockfile_missing");
});

test("deny: lockfile drift", async () => {
  const d = await runSurfaceGuardCheck({
    repo: { private: true, permissions: permsOk },
    orgLogin: "acme",
    entitlement: entitled,
    verify: async () => ({ ok: false, reason: "drift", detail: "tools root mismatch" }),
  });
  assert.equal(d.outcome, "deny");
  if (d.outcome === "deny") {
    assert.equal(d.code, "lockfile_drift");
    assert.match(d.summary, /tools root mismatch/);
  }
});

test("deny: verify throws → unreadable, not allow", async () => {
  const d = await runSurfaceGuardCheck({
    repo: { private: true, permissions: permsOk },
    orgLogin: "acme",
    entitlement: entitled,
    verify: async () => {
      throw new Error("octokit 403");
    },
  });
  assert.equal(d.outcome, "deny");
  if (d.outcome === "deny") assert.equal(d.code, "lockfile_unreadable");
});
