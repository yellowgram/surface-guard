import type { Decision } from "../errors.js";
import { allowSummary, allowTitle, denySummary, denyTitle } from "./messages.js";
import { evaluatePrivateRepoGate, type RepoPrivacyInput } from "./privateRepo.js";
import {
  evaluateEntitlement,
  type EntitlementStore,
} from "../billing/entitlement.js";

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: "missing" | "unreadable" | "drift" | "installation_token_failed";
      detail?: string;
    };

export type RunCheckInput = {
  repo: RepoPrivacyInput;
  orgLogin: string;
  entitlement: EntitlementStore;
  /** Injected SurfacePin verify — keeps App free of I/O in unit tests. */
  verify: () => Promise<VerifyResult>;
};

/**
 * Full decision pipeline for a PR / check_suite on one repo.
 * Order: private-repo+perms → entitlement → surfacepin verify.
 * Every terminal path is an explicit allow or deny (no silent pass).
 */
export async function runSurfaceGuardCheck(input: RunCheckInput): Promise<Decision> {
  const gate = evaluatePrivateRepoGate(input.repo);
  if (gate.outcome === "deny") return gate;

  const entitled = await evaluateEntitlement(input.entitlement, input.orgLogin);
  if (entitled.outcome === "deny") return entitled;

  let verify: VerifyResult;
  try {
    verify = await input.verify();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      outcome: "deny",
      code: "lockfile_unreadable",
      title: denyTitle("lockfile_unreadable"),
      summary: denySummary("lockfile_unreadable", detail),
      conclusion: "failure",
    };
  }

  if (verify.ok) {
    return {
      outcome: "allow",
      title: allowTitle,
      summary: allowSummary,
      conclusion: "success",
    };
  }

  if (verify.reason === "installation_token_failed") {
    return {
      outcome: "deny",
      code: "installation_token_failed",
      title: denyTitle("installation_token_failed"),
      summary: denySummary("installation_token_failed", verify.detail),
      conclusion: "failure",
    };
  }
  if (verify.reason === "missing") {
    return {
      outcome: "deny",
      code: "lockfile_missing",
      title: denyTitle("lockfile_missing"),
      summary: denySummary("lockfile_missing", verify.detail),
      conclusion: "failure",
    };
  }
  if (verify.reason === "drift") {
    return {
      outcome: "deny",
      code: "lockfile_drift",
      title: denyTitle("lockfile_drift"),
      summary: denySummary("lockfile_drift", verify.detail),
      conclusion: "failure",
    };
  }
  return {
    outcome: "deny",
    code: "lockfile_unreadable",
    title: denyTitle("lockfile_unreadable"),
    summary: denySummary("lockfile_unreadable", verify.detail),
    conclusion: "failure",
  };
}
