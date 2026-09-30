import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluatePrivateRepoGate,
  hasUsableGatePermissions,
} from "../src/check/privateRepo.js";

const permsOk = { contents: "read", checks: "write", metadata: "read" };

test("continue: private repo with least-privilege perms", () => {
  const d = evaluatePrivateRepoGate({
    private: true,
    permissions: permsOk,
    fullName: "acme/private-mcp",
  });
  assert.equal(d.outcome, "continue");
});

test("deny: public repo — no silent pass to App check", () => {
  const d = evaluatePrivateRepoGate({
    private: false,
    permissions: permsOk,
    fullName: "acme/public-mcp",
  });
  assert.equal(d.outcome, "deny");
  if (d.outcome === "deny") {
    assert.equal(d.code, "repo_public");
    assert.match(d.summary, /OSS Action/i);
    assert.equal(d.conclusion, "failure");
  }
});

test("deny: privacy unknown (null) — fail closed", () => {
  const d = evaluatePrivateRepoGate({
    private: null,
    permissions: permsOk,
  });
  assert.equal(d.outcome, "deny");
  if (d.outcome === "deny") {
    assert.equal(d.code, "repo_privacy_unknown");
  }
});

test("deny: privacy undefined — fail closed", () => {
  const d = evaluatePrivateRepoGate({
    private: undefined,
    permissions: permsOk,
  });
  assert.equal(d.outcome, "deny");
  if (d.outcome === "deny") {
    assert.equal(d.code, "repo_privacy_unknown");
  }
});

test("deny: missing contents:read", () => {
  const d = evaluatePrivateRepoGate({
    private: true,
    permissions: { checks: "write" },
  });
  assert.equal(d.outcome, "deny");
  if (d.outcome === "deny") {
    assert.equal(d.code, "missing_contents_permission");
  }
});

test("deny: missing checks:write", () => {
  const d = evaluatePrivateRepoGate({
    private: true,
    permissions: { contents: "read", checks: "read" },
  });
  assert.equal(d.outcome, "deny");
  if (d.outcome === "deny") {
    assert.equal(d.code, "missing_checks_permission");
  }
});

test("hasUsableGatePermissions: empty / missing → false", () => {
  assert.equal(hasUsableGatePermissions(null), false);
  assert.equal(hasUsableGatePermissions({}), false);
  assert.equal(hasUsableGatePermissions({ contents: "read" }), false);
  assert.equal(hasUsableGatePermissions({ checks: "write" }), false);
});

test("hasUsableGatePermissions: contents read + checks write → true", () => {
  assert.equal(
    hasUsableGatePermissions({ contents: "read", checks: "write" }),
    true,
  );
});
