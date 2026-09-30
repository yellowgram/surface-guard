import { createHmac, timingSafeEqual } from "node:crypto";
import { SurfaceGuardDeny } from "../errors.js";
import { isUnconfiguredSecret } from "../config.js";

const MAX_SKEW_SECONDS = 5 * 60;

export type PolarWebhookHeaders = {
  id?: string | undefined | null;
  timestamp?: string | undefined | null;
  signature?: string | undefined | null;
};

/**
 * Verify Polar webhook signatures (Standard Webhooks + Polar HMAC dual-key).
 * Fail closed: missing/placeholder secret, missing headers, skew, or mismatch → deny.
 *
 * Polar secrets generated on/after 2026-09-08 use Standard Webhooks (whsec_… as-is).
 * Older secrets use Polar HMAC (UTF-8 bytes of the full secret string).
 * We try both key derivations so either era works.
 */
export function verifyPolarWebhookSignature(
  rawBody: Buffer | string,
  headers: PolarWebhookHeaders,
  webhookSecret: string,
): { ok: true } {
  if (isUnconfiguredSecret(webhookSecret)) {
    throw new SurfaceGuardDeny(
      "webhook_secret_unconfigured",
      "POLAR_WEBHOOK_SECRET is missing or a placeholder. Rejecting billing webhooks.",
      503,
    );
  }

  const id = (headers.id ?? "").trim();
  const timestamp = (headers.timestamp ?? "").trim();
  const signatureHeader = (headers.signature ?? "").trim();

  if (!id || !timestamp || !signatureHeader) {
    throw new SurfaceGuardDeny(
      "webhook_signature_missing",
      "Missing webhook-id, webhook-timestamp, or webhook-signature. Unsigned Polar webhook rejected.",
      401,
    );
  }

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) {
    throw new SurfaceGuardDeny(
      "webhook_signature_invalid",
      "webhook-timestamp is not a number. Rejected.",
      401,
    );
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > MAX_SKEW_SECONDS) {
    throw new SurfaceGuardDeny(
      "webhook_signature_invalid",
      "webhook-timestamp outside allowed skew. Rejected.",
      401,
    );
  }

  const body =
    typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const signedContent = Buffer.concat([
    Buffer.from(id, "utf8"),
    Buffer.from(".", "utf8"),
    Buffer.from(timestamp, "utf8"),
    Buffer.from(".", "utf8"),
    body,
  ]);

  const presented = parseSignatureVersions(signatureHeader);
  if (presented.length === 0) {
    throw new SurfaceGuardDeny(
      "webhook_signature_invalid",
      "webhook-signature has no v1 signatures. Rejected.",
      401,
    );
  }

  for (const key of derivePolarSecretKeys(webhookSecret)) {
    const expected = createHmac("sha256", key).update(signedContent).digest();
    for (const their of presented) {
      if (their.length === expected.length && timingSafeEqual(their, expected)) {
        return { ok: true };
      }
    }
  }

  throw new SurfaceGuardDeny(
    "webhook_signature_invalid",
    "Polar webhook signature mismatch. Rejected.",
    401,
  );
}

/** Derive candidate HMAC keys for Polar Standard Webhooks + legacy Polar HMAC. */
export function derivePolarSecretKeys(secret: string): Buffer[] {
  const trimmed = secret.trim();
  const keys: Buffer[] = [];
  const seen = new Set<string>();

  const push = (buf: Buffer) => {
    const hex = buf.toString("hex");
    if (seen.has(hex)) return;
    seen.add(hex);
    keys.push(buf);
  };

  // Standard Webhooks: whsec_<base64> or polar_whs_<base64> → decode payload after prefix.
  for (const prefix of ["whsec_", "polar_whs_"]) {
    if (trimmed.startsWith(prefix) && trimmed.length > prefix.length) {
      try {
        push(Buffer.from(trimmed.slice(prefix.length), "base64"));
      } catch {
        /* ignore decode errors; other candidates may still work */
      }
    }
  }

  // Legacy Polar HMAC: UTF-8 bytes of the full secret string.
  push(Buffer.from(trimmed, "utf8"));

  // Raw base64 of the whole secret (founders sometimes paste decoded material).
  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length >= 16) push(decoded);
  } catch {
    /* ignore */
  }

  return keys;
}

function parseSignatureVersions(header: string): Buffer[] {
  const out: Buffer[] = [];
  for (const part of header.split(" ")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const comma = trimmed.indexOf(",");
    if (comma <= 0) continue;
    const version = trimmed.slice(0, comma);
    const sig = trimmed.slice(comma + 1);
    if (version !== "v1" || !sig) continue;
    try {
      const buf = Buffer.from(sig, "base64");
      if (buf.length > 0) out.push(buf);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

/** Test helper: sign a body the Standard Webhooks way with Polar-legacy key bytes. */
export function signPolarWebhook(
  rawBody: Buffer | string,
  secret: string,
  opts?: { id?: string; timestamp?: string; keyMode?: "legacy-utf8" | "whsec" },
): { id: string; timestamp: string; signature: string } {
  const id = opts?.id ?? `msg_${Date.now()}`;
  const timestamp = opts?.timestamp ?? String(Math.floor(Date.now() / 1000));
  const body =
    typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const signedContent = Buffer.concat([
    Buffer.from(id, "utf8"),
    Buffer.from(".", "utf8"),
    Buffer.from(timestamp, "utf8"),
    Buffer.from(".", "utf8"),
    body,
  ]);

  let key: Buffer;
  if (opts?.keyMode === "whsec" && secret.startsWith("whsec_")) {
    key = Buffer.from(secret.slice("whsec_".length), "base64");
  } else {
    key = Buffer.from(secret.trim(), "utf8");
  }
  const sig = createHmac("sha256", key).update(signedContent).digest("base64");
  return { id, timestamp, signature: `v1,${sig}` };
}
