import type { Decision } from "../errors.js";
import { denySummary, denyTitle } from "./messages.js";

export type RepoPrivacyInput = {
  /** From GitHub API `repository.private`. undefined/null = unknown. */
  private: boolean | null | undefined;
  /** Installation permission map from GitHub (e.g. { contents: "read", checks: "write" }). */
  permissions?: Record<string, string> | null;
  fullName?: string;
};


/**
 * True when the permission map already satisfies the contents+checks gate.
 * Used by the webhook handler to decide whether to resolve via App API.
 * Does not change evaluatePrivateRepoGate behavior.
 */
export function hasUsableGatePermissions(
  permissions?: Record<string, string> | null,
): boolean {
  const perms = permissions ?? {};
  const contents = (perms.contents ?? "").toLowerCase();
  const checks = (perms.checks ?? "").toLowerCase();
  const contentsOk =
    contents === "read" || contents === "write" || contents === "admin";
  const checksOk = checks === "write" || checks === "admin";
  return contentsOk && checksOk;
}

/**
 * Reliable private-repo gate.
 * - public → deny (point at OSS Action)
 * - private unknown / null → deny (no silent pass)
 * - missing contents:read or checks:write → deny
 * - private + required perms → allow_path (caller still runs entitlement + verify)
 */
export function evaluatePrivateRepoGate(input: RepoPrivacyInput): Decision | { outcome: "continue" } {
  const perms = input.permissions ?? {};

  const contents = (perms.contents ?? "").toLowerCase();
  if (contents !== "read" && contents !== "write" && contents !== "admin") {
    return {
      outcome: "deny",
      code: "missing_contents_permission",
      title: denyTitle("missing_contents_permission"),
      summary: denySummary(
        "missing_contents_permission",
        `contents=${perms.contents ?? "(absent)"}`,
      ),
      conclusion: "failure",
    };
  }

  const checks = (perms.checks ?? "").toLowerCase();
  if (checks !== "write" && checks !== "admin") {
    return {
      outcome: "deny",
      code: "missing_checks_permission",
      title: denyTitle("missing_checks_permission"),
      summary: denySummary(
        "missing_checks_permission",
        `checks=${perms.checks ?? "(absent)"}`,
      ),
      conclusion: "failure",
    };
  }

  if (input.private === true) {
    return { outcome: "continue" };
  }

  if (input.private === false) {
    return {
      outcome: "deny",
      code: "repo_public",
      title: denyTitle("repo_public"),
      summary: denySummary(
        "repo_public",
        input.fullName ? `repo=${input.fullName}` : undefined,
      ),
      conclusion: "failure",
    };
  }

  // null / undefined / unexpected — fail closed
  return {
    outcome: "deny",
    code: "repo_privacy_unknown",
    title: denyTitle("repo_privacy_unknown"),
    summary: denySummary(
      "repo_privacy_unknown",
      `private=${String(input.private)} repo=${input.fullName ?? "(unknown)"}`,
    ),
    conclusion: "failure",
  };
}
