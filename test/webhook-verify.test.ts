import assert from "node:assert/strict";
import { test } from "node:test";
import {
  signGitHubWebhook,
  verifyGitHubWebhookSignature,
} from "../src/webhook/verify.js";
import { SurfaceGuardDeny } from "../src/errors.js";

const SECRET = "test-webhook-secret-32chars-min!!";

test("allow: valid sha256 signature", () => {
  const body = Buffer.from('{"ok":true}', "utf8");
  const sig = signGitHubWebhook(body, SECRET);
  assert.deepEqual(verifyGitHubWebhookSignature(body, sig, SECRET), { ok: true });
});

test("deny: missing signature header", () => {
  const body = Buffer.from("{}", "utf8");
  assert.throws(
    () => verifyGitHubWebhookSignature(body, undefined, SECRET),
    (err: unknown) =>
      err instanceof SurfaceGuardDeny && err.code === "webhook_signature_missing",
  );
});

test("deny: wrong signature", () => {
  const body = Buffer.from("{}", "utf8");
  assert.throws(
    () => verifyGitHubWebhookSignature(body, "sha256=" + "ab".repeat(32), SECRET),
    (err: unknown) =>
      err instanceof SurfaceGuardDeny && err.code === "webhook_signature_invalid",
  );
});

test("deny: placeholder / short secret refuses verify", () => {
  const body = Buffer.from("{}", "utf8");
  assert.throws(
    () => verifyGitHubWebhookSignature(body, "sha256=dead", "replace_me"),
    (err: unknown) =>
      err instanceof SurfaceGuardDeny && err.code === "webhook_secret_unconfigured",
  );
});

test("deny: tampered body fails even with well-formed header", () => {
  const body = Buffer.from('{"a":1}', "utf8");
  const sig = signGitHubWebhook(body, SECRET);
  const tampered = Buffer.from('{"a":2}', "utf8");
  assert.throws(
    () => verifyGitHubWebhookSignature(tampered, sig, SECRET),
    (err: unknown) =>
      err instanceof SurfaceGuardDeny && err.code === "webhook_signature_invalid",
  );
});
