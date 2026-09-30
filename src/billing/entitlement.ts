import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Decision } from "../errors.js";
import { denySummary, denyTitle } from "../check/messages.js";

export type EntitlementPlan = "monthly" | "yearly" | "founding";

export type EntitlementStore = {
  /**
   * Resolve whether an org login is entitled.
   * Must throw or return unavailable — never invent a silent allow.
   */
  isOrgEntitled(orgLogin: string): Promise<EntitlementLookup>;
};

export type MutableEntitlementStore = EntitlementStore & {
  grant(event: BillingEntitlementEvent): Promise<GrantResult>;
  revoke(event: BillingRevokeEvent): Promise<RevokeResult>;
};

export type EntitlementLookup =
  | { status: "entitled"; plan?: EntitlementPlan }
  | { status: "not_entitled" }
  | { status: "unavailable"; reason: string };

export type GrantResult = {
  added: boolean;
  duplicate: boolean;
  orgLogin: string;
};

export type RevokeResult = {
  removed: boolean;
  duplicate: boolean;
  orgLogin: string;
};

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

export type OrgGrantRecord = {
  plan: EntitlementPlan;
  grantedAt: string;
  providerEventId: string;
  source?: string;
};

export type ProcessedEventRecord = {
  action: "grant" | "revoke";
  orgLogin: string;
  at: string;
};

export type FileEntitlementDocument = {
  version: 1;
  orgs: Record<string, OrgGrantRecord>;
  processedEvents: Record<string, ProcessedEventRecord>;
};

const MAX_PROCESSED_EVENTS = 4000;

/**
 * Durable JSON-file entitlement store (single-writer). Survives restarts when
 * path sits on a Fly volume (default `/data/entitlements.json`).
 */
export class FileEntitlementStore implements MutableEntitlementStore {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async isOrgEntitled(orgLogin: string): Promise<EntitlementLookup> {
    const login = orgLogin.trim().toLowerCase();
    if (!login) {
      return { status: "unavailable", reason: "empty org login" };
    }
    try {
      const doc = this.readDoc();
      const rec = doc.orgs[login];
      if (rec) return { status: "entitled", plan: rec.plan };
      return { status: "not_entitled" };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { status: "unavailable", reason: `entitlement file unreadable: ${reason}` };
    }
  }

  async grant(event: BillingEntitlementEvent): Promise<GrantResult> {
    return this.withWriteLock(() => {
      const login = event.orgLogin.trim().toLowerCase();
      if (!login) {
        return { added: false, duplicate: false, orgLogin: "" };
      }
      const doc = this.readDoc();
      if (doc.processedEvents[event.providerEventId]) {
        return { added: false, duplicate: true, orgLogin: login };
      }
      const before = Boolean(doc.orgs[login]);
      doc.orgs[login] = {
        plan: event.plan,
        grantedAt: new Date().toISOString(),
        providerEventId: event.providerEventId,
        source: event.source,
      };
      this.markProcessed(doc, event.providerEventId, {
        action: "grant",
        orgLogin: login,
        at: new Date().toISOString(),
      });
      this.writeDoc(doc);
      return { added: !before, duplicate: false, orgLogin: login };
    });
  }

  async revoke(event: BillingRevokeEvent): Promise<RevokeResult> {
    return this.withWriteLock(() => {
      const login = event.orgLogin.trim().toLowerCase();
      if (!login) {
        return { removed: false, duplicate: false, orgLogin: "" };
      }
      const doc = this.readDoc();
      if (doc.processedEvents[event.providerEventId]) {
        return { removed: false, duplicate: true, orgLogin: login };
      }
      const before = Boolean(doc.orgs[login]);
      delete doc.orgs[login];
      this.markProcessed(doc, event.providerEventId, {
        action: "revoke",
        orgLogin: login,
        at: new Date().toISOString(),
      });
      this.writeDoc(doc);
      return { removed: before, duplicate: false, orgLogin: login };
    });
  }

  /** Test/ops helper — current durable org set (excludes env seed). */
  listGrantedOrgs(): string[] {
    return Object.keys(this.readDoc().orgs).sort();
  }

  private async withWriteLock<T>(fn: () => T): Promise<T> {
    const run = this.writeChain.then(fn, fn);
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private readDoc(): FileEntitlementDocument {
    if (!existsSync(this.filePath)) {
      return { version: 1, orgs: {}, processedEvents: {} };
    }
    const raw = readFileSync(this.filePath, "utf8");
    if (!raw.trim()) {
      return { version: 1, orgs: {}, processedEvents: {} };
    }
    const parsed = JSON.parse(raw) as FileEntitlementDocument;
    if (!parsed || parsed.version !== 1 || typeof parsed.orgs !== "object") {
      throw new Error("entitlement file schema mismatch");
    }
    if (!parsed.processedEvents || typeof parsed.processedEvents !== "object") {
      parsed.processedEvents = {};
    }
    return parsed;
  }

  private writeDoc(doc: FileEntitlementDocument): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(doc, null, 2), "utf8");
    renameSync(tmp, this.filePath);
  }

  private markProcessed(
    doc: FileEntitlementDocument,
    eventId: string,
    record: ProcessedEventRecord,
  ): void {
    doc.processedEvents[eventId] = record;
    const ids = Object.keys(doc.processedEvents);
    if (ids.length <= MAX_PROCESSED_EVENTS) return;
    // Drop oldest by recorded timestamp (fail-safe: alphabetical if missing).
    ids.sort((a, b) => {
      const atA = doc.processedEvents[a]?.at ?? "";
      const atB = doc.processedEvents[b]?.at ?? "";
      return atA < atB ? -1 : atA > atB ? 1 : a < b ? -1 : 1;
    });
    const drop = ids.length - MAX_PROCESSED_EVENTS;
    for (let i = 0; i < drop; i++) {
      const id = ids[i];
      if (id) delete doc.processedEvents[id];
    }
  }
}

/**
 * Union: env seed OR durable grant. Env seed is founder override (not revoked by Polar).
 * Never silent-pass unknown orgs.
 */
export class UnionEntitlementStore implements MutableEntitlementStore {
  constructor(
    private readonly envSeed: Set<string>,
    private readonly durable: MutableEntitlementStore,
  ) {}

  async isOrgEntitled(orgLogin: string): Promise<EntitlementLookup> {
    const login = orgLogin.trim().toLowerCase();
    if (!login) {
      return { status: "unavailable", reason: "empty org login" };
    }
    if (this.envSeed.has(login)) {
      return { status: "entitled", plan: "founding" };
    }
    return this.durable.isOrgEntitled(login);
  }

  grant(event: BillingEntitlementEvent): Promise<GrantResult> {
    return this.durable.grant(event);
  }

  revoke(event: BillingRevokeEvent): Promise<RevokeResult> {
    return this.durable.revoke(event);
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
  plan: EntitlementPlan;
  providerEventId: string;
  source?: string;
};

export type BillingRevokeEvent = {
  orgLogin: string;
  providerEventId: string;
  reason: string;
};

/**
 * Legacy in-memory helper retained for tests / scripts.
 * Prefer MutableEntitlementStore.grant on the durable/union store in production.
 */
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

export function revokeBillingEntitlement(
  entitled: Set<string>,
  orgLogin: string,
): { removed: boolean } {
  const login = orgLogin.trim().toLowerCase();
  if (!login) return { removed: false };
  const before = entitled.has(login);
  entitled.delete(login);
  return { removed: before };
}
