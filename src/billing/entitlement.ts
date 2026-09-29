import type { Decision } from "../errors.js";
import { denySummary, denyTitle } from "../check/messages.js";

export type EntitlementStore = {
  /**
   * Resolve whether an org login is entitled.
   * Must throw or return unavailable — never invent a silent allow.
   */
  isOrgEntitled(orgLogin: string): Promise<EntitlementLookup>;
};

export type EntitlementLookup =
  | { status: "entitled"; plan?: "monthly" | "yearly" | "founding" }
  | { status: "not_entitled" }
  | { status: "unavailable"; reason: string };

/** In-memory / env-backed store for founding window. Fail closed when empty+forced. */
export class EnvEntitlementStore implements EntitlementStore {
  constructor(
    private readonly entitled: Set<string>,
    private readonly opts: { failIfEmpty?: boolean } = {},
  ) {}

  async isOrgEntitled(orgLogin: string): Promise<EntitlementLookup> {
    const login = orgLogin.trim().toLowerCase();
    if (!login) {
      return { status: "unavailable", reason: "empty org login" };
    }
    if (this.opts.failIfEmpty && this.entitled.size === 0) {
      // Production without a wired store must not silently pass everyone.
      return {
        status: "unavailable",
        reason: "SURFACE_GUARD_ENTITLED_ORGS empty and no external billing store",
      };
    }
    if (this.entitled.has(login)) {
      return { status: "entitled", plan: "founding" };
    }
    return { status: "not_entitled" };
  }
}

export async function evaluateEntitlement(
  store: EntitlementStore,
  orgLogin: string,
): Promise<Decision | { outcome: "continue"; plan?: string }> {
  let lookup: EntitlementLookup;
  try {
    lookup = await store.isOrgEntitled(orgLogin);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      outcome: "deny",
      code: "entitlement_store_unavailable",
      title: denyTitle("entitlement_store_unavailable"),
      summary: denySummary("entitlement_store_unavailable", reason),
      conclusion: "failure",
    };
  }

  if (lookup.status === "entitled") {
    return { outcome: "continue", plan: lookup.plan };
  }
  if (lookup.status === "unavailable") {
    return {
      outcome: "deny",
      code: "entitlement_store_unavailable",
      title: denyTitle("entitlement_store_unavailable"),
      summary: denySummary("entitlement_store_unavailable", lookup.reason),
      conclusion: "failure",
    };
  }
  return {
    outcome: "deny",
    code: "org_not_entitled",
    title: denyTitle("org_not_entitled"),
    summary: denySummary("org_not_entitled", `org=${orgLogin}`),
    conclusion: "failure",
  };
}

/** Polar/billing webhook hook — mark org entitled after verified payment. */
export type BillingEntitlementEvent = {
  orgLogin: string;
  plan: "monthly" | "yearly";
  providerEventId: string;
};

export function applyBillingEntitlement(
  entitled: Set<string>,
  event: BillingEntitlementEvent,
): { added: boolean } {
  const login = event.orgLogin.trim().toLowerCase();
  if (!login) return { added: false };
  const before = entitled.has(login);
  entitled.add(login);
  return { added: !before };
}
