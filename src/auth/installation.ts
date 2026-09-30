import type { Decision } from "../errors.js";
import { denySummary, denyTitle } from "../check/messages.js";

export type InstallationAuth = {
  installationId: number;
  permissions: Record<string, string>;
  accountLogin: string;
  accountType: "Organization" | "User" | string;
};

/**
 * Normalize installation payload from GitHub webhook / API.
 * Missing permissions map → empty object (downstream fail-closed on contents/checks).
 */
export function parseInstallation(raw: unknown): InstallationAuth | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = obj.id;
  if (typeof id !== "number" || !Number.isFinite(id)) return null;
  const account = obj.account;
  let accountLogin = "";
  let accountType = "Unknown";
  if (account && typeof account === "object") {
    const a = account as Record<string, unknown>;
    if (typeof a.login === "string") accountLogin = a.login;
    if (typeof a.type === "string") accountType = a.type;
  }
  const permissions =
    obj.permissions && typeof obj.permissions === "object"
      ? (obj.permissions as Record<string, string>)
      : {};
  return {
    installationId: id,
    permissions,
    accountLogin,
    accountType,
  };
}

export function denyInstallationToken(detail?: string): Decision {
  return {
    outcome: "deny",
    code: "installation_token_failed",
    title: denyTitle("installation_token_failed"),
    summary: denySummary("installation_token_failed", detail),
    conclusion: "failure",
  };
}
