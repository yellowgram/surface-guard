import { createHmac, timingSafeEqual } from "node:crypto";
import { SurfaceGuardDeny } from "../errors.js";
import { isUnconfiguredSecret } from "../config.js";

/**
 * Verify GitHub webhook X-Hub-Signature-256.
 * Fail closed: missing secret, missing header, or mismatch → deny.
 * Never process the body before this returns ok.
 */
export function verifyGitHubWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined | null,
  webhookSecret: string,
): { ok: true } {
  if (isUnconfiguredSecret(webhookSecret)) {
    throw new SurfaceGuardDeny(
      "webhook_secret_unconfigured",
      "Webhook secret is not configured. Rejecting all deliveries.",
      500,
    );
  }
  if (!signatureHeader || !signatureHeader.trim()) {
    throw new SurfaceGuardDeny(
      "webhook_signature_missing",
      "Missing X-Hub-Signature-256 header. Unsigned webhook rejected.",
      401,
    );
  }

  const presented = signatureHeader.trim();
  const prefix = "sha256=";
  if (!presented.startsWith(prefix) || presented.length <= prefix.length) {
    throw new SurfaceGuardDeny(
      "webhook_signature_invalid",
      "X-Hub-Signature-256 must be sha256=<hex>. Rejected.",
      401,
    );
  }
  const theirHex = presented.slice(prefix.length).toLowerCase();
  if (!/^[0-9a-f]+$/.test(theirHex) || theirHex.length !== 64) {
    throw new SurfaceGuardDeny(
      "webhook_signature_invalid",
      "X-Hub-Signature-256 hex digest is malformed. Rejected.",
      401,
    );
  }

  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const expectedHex = createHmac("sha256", webhookSecret).update(body).digest("hex");
  const a = Buffer.from(expectedHex, "utf8");
  const b = Buffer.from(theirHex, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new SurfaceGuardDeny(
      "webhook_signature_invalid",
      "Webhook signature mismatch. Rejected.",
      401,
    );
  }
  return { ok: true };
}

/** Test helper: sign a body the way GitHub does. */
export function signGitHubWebhook(rawBody: Buffer | string, secret: string): string {
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const hex = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${hex}`;
}
