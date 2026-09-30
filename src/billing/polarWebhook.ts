import type { MutableEntitlementStore, EntitlementPlan } from "./entitlement.js";
import { verifyPolarWebhookSignature, type PolarWebhookHeaders } from "./polarVerify.js";
import { isUnconfiguredSecret } from "../config.js";
import { SurfaceGuardDeny } from "../errors.js";

/** Checkout custom field slug / metadata key for the GitHub org login. */
export const GITHUB_ORG_FIELD = "github_org";

const GRANT_EVENTS = new Set([
  "order.paid",
  "subscription.active",
  "subscription.uncanceled",
  "subscription.resumed",
]);

const REVOKE_EVENTS = new Set([
  "subscription.revoked",
  "subscription.paused",
  "order.refunded",
]);

/** Canceled keeps access until period end — do not revoke here. */
const ACK_ONLY_EVENTS = new Set([
  "subscription.canceled",
  "subscription.updated",
  "subscription.created",
  "subscription.cycled",
  "subscription.past_due",
  "order.created",
  "order.updated",
  "refund.created",
  "refund.updated",
  "checkout.created",
  "checkout.updated",
  "checkout.expired",
  "customer.created",
  "customer.updated",
  "customer.deleted",
  "customer.state_changed",
]);

export type PolarHandleResult = {
  status: number;
  body: Record<string, unknown>;
};

export type PolarWebhookDeps = {
  polarWebhookSecret: string | undefined | null;
  store: MutableEntitlementStore;
};

/**
 * Extract GitHub org login from Polar order/subscription payload.
 * Prefers custom_field_data.github_org, then metadata.github_org.
 */
export function extractGithubOrg(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  const fromCustom = readOrgField(obj.custom_field_data);
  if (fromCustom) return fromCustom;

  const fromMeta = readOrgField(obj.metadata);
  if (fromMeta) return fromMeta;

  // Nested checkout (some subscription payloads).
  if (obj.checkout && typeof obj.checkout === "object") {
    const checkout = obj.checkout as Record<string, unknown>;
    const fromCheckoutCustom = readOrgField(checkout.custom_field_data);
    if (fromCheckoutCustom) return fromCheckoutCustom;
    const fromCheckoutMeta = readOrgField(checkout.metadata);
    if (fromCheckoutMeta) return fromCheckoutMeta;
  }

  return null;
}

function readOrgField(bag: unknown): string | null {
  if (!bag || typeof bag !== "object") return null;
  const rec = bag as Record<string, unknown>;
  const raw = rec[GITHUB_ORG_FIELD];
  if (typeof raw === "string") {
    const login = raw.trim().toLowerCase();
    // Basic GitHub login sanity — letters, digits, hyphen; 1–39 chars.
    if (login && /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(login)) {
      return login;
    }
    return null;
  }
  return null;
}

export function inferPlan(data: unknown, eventType: string): EntitlementPlan {
  if (!data || typeof data !== "object") {
    return eventType.startsWith("order.") ? "founding" : "monthly";
  }
  const obj = data as Record<string, unknown>;

  // Subscription recurring interval
  const interval =
    (typeof obj.recurring_interval === "string" && obj.recurring_interval) ||
    (obj.subscription &&
      typeof obj.subscription === "object" &&
      typeof (obj.subscription as Record<string, unknown>).recurring_interval ===
        "string" &&
      ((obj.subscription as Record<string, unknown>).recurring_interval as string)) ||
    null;
  if (interval === "year" || interval === "yearly") return "yearly";
  if (interval === "month" || interval === "monthly") return "monthly";

  // Product name heuristics (founding checkouts are monthly $99 / yearly $990).
  const product = obj.product;
  if (product && typeof product === "object") {
    const name = String((product as Record<string, unknown>).name ?? "").toLowerCase();
    if (name.includes("year")) return "yearly";
    if (name.includes("month")) return "monthly";
  }

  // One-time order without subscription → founding / one-time purchase.
  if (eventType === "order.paid" && !obj.subscription_id && !obj.subscription) {
    return "founding";
  }

  return "monthly";
}

export function classifyPolarEvent(
  type: string,
): "grant" | "revoke" | "ack" | "unknown" {
  if (GRANT_EVENTS.has(type)) return "grant";
  if (REVOKE_EVENTS.has(type)) return "revoke";
  if (ACK_ONLY_EVENTS.has(type)) return "ack";
  return "unknown";
}

/**
 * Handle a verified Polar billing webhook. Fail closed on bad signatures /
 * unconfigured secret / missing github_org (no silent grant).
 */
export async function handlePolarWebhook(
  deps: PolarWebhookDeps,
  headers: PolarWebhookHeaders,
  rawBody: Buffer,
): Promise<PolarHandleResult> {
  if (isUnconfiguredSecret(deps.polarWebhookSecret ?? undefined)) {
    return {
      status: 503,
      body: {
        ok: false,
        code: "webhook_secret_unconfigured",
        message:
          "POLAR_WEBHOOK_SECRET not configured. Billing webhook disabled (fail closed).",
      },
    };
  }

  try {
    verifyPolarWebhookSignature(rawBody, headers, deps.polarWebhookSecret!.trim());
  } catch (err) {
    if (err instanceof SurfaceGuardDeny) {
      return {
        status: err.httpStatus,
        body: { ok: false, code: err.code, message: err.publicMessage },
      };
    }
    throw err;
  }

  let parsed: { type?: unknown; data?: unknown; id?: unknown };
  try {
    parsed = JSON.parse(rawBody.toString("utf8")) as {
      type?: unknown;
      data?: unknown;
      id?: unknown;
    };
  } catch {
    return {
      status: 400,
      body: { ok: false, code: "malformed_payload", message: "Body is not JSON." },
    };
  }

  const type = typeof parsed.type === "string" ? parsed.type : "";
  if (!type) {
    return {
      status: 400,
      body: { ok: false, code: "malformed_payload", message: "Missing event type." },
    };
  }

  const classification = classifyPolarEvent(type);
  const providerEventId =
    (typeof headers.id === "string" && headers.id.trim()) ||
    (typeof parsed.id === "string" && parsed.id) ||
    `${type}:${stableDataId(parsed.data)}`;

  if (classification === "ack" || classification === "unknown") {
    return {
      status: 202,
      body: {
        ok: true,
        action: "ignored",
        type,
        reason:
          classification === "unknown"
            ? "unhandled_event_type"
            : type === "subscription.canceled"
              ? "cancel_keeps_access_until_revoked"
              : "ack_only",
      },
    };
  }

  const orgLogin = extractGithubOrg(parsed.data);
  if (!orgLogin) {
    // Verified but unusable — do not grant/revoke. 202 so Polar does not disable the endpoint.
    return {
      status: 202,
      body: {
        ok: true,
        action: "skipped",
        type,
        reason: "missing_github_org",
        field: GITHUB_ORG_FIELD,
        message:
          `No ${GITHUB_ORG_FIELD} in custom_field_data or metadata. Entitlement unchanged (fail closed). ` +
          "Founder: add required checkout custom field slug github_org, or grant via SURFACE_GUARD_ENTITLED_ORGS.",
      },
    };
  }

  if (classification === "grant") {
    const plan = inferPlan(parsed.data, type);
    const result = await deps.store.grant({
      orgLogin,
      plan,
      providerEventId,
      source: `polar:${type}`,
    });
    return {
      status: 202,
      body: {
        ok: true,
        action: "grant",
        type,
        orgLogin: result.orgLogin,
        plan,
        added: result.added,
        duplicate: result.duplicate,
      },
    };
  }

  // revoke
  const result = await deps.store.revoke({
    orgLogin,
    providerEventId,
    reason: type,
  });
  return {
    status: 202,
    body: {
      ok: true,
      action: "revoke",
      type,
      orgLogin: result.orgLogin,
      removed: result.removed,
      duplicate: result.duplicate,
    },
  };
}

function stableDataId(data: unknown): string {
  if (data && typeof data === "object" && typeof (data as { id?: unknown }).id === "string") {
    return (data as { id: string }).id;
  }
  return "unknown";
}
