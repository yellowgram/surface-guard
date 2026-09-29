import type { DenyCode } from "../errors.js";

const FOUNDING_URL = "https://www.yellowgram.dev/surface-guard";
const OSS_ACTION = "https://github.com/yellowgram/surfacepin#github-action";

export function denyTitle(code: DenyCode): string {
  switch (code) {
    case "repo_public":
      return "Surface Guard: public repo — use OSS Action";
    case "repo_privacy_unknown":
      return "Surface Guard: cannot confirm private repo";
    case "missing_contents_permission":
      return "Surface Guard: missing contents:read";
    case "missing_checks_permission":
      return "Surface Guard: missing checks:write";
    case "org_not_entitled":
      return "Surface Guard: org not entitled";
    case "entitlement_store_unavailable":
      return "Surface Guard: entitlement check unavailable";
    case "lockfile_missing":
      return "Surface Guard: lockfile missing";
    case "lockfile_drift":
      return "Surface Guard: surface drift";
    case "lockfile_unreadable":
      return "Surface Guard: lockfile unreadable";
    case "installation_token_failed":
      return "Surface Guard: installation auth failed";
    default:
      return `Surface Guard: denied (${code})`;
  }
}

export function denySummary(code: DenyCode, detail?: string): string {
  const extra = detail ? `\n\nDetail: ${detail}` : "";
  switch (code) {
    case "repo_public":
      return (
        "This repository is **public**. Surface Guard only runs on **private** repos for paying orgs.\n\n" +
        `Use the free OSS Action instead: ${OSS_ACTION}\n` +
        `Founding reservation: ${FOUNDING_URL}` +
        extra
      );
    case "repo_privacy_unknown":
      return (
        "Could not determine whether this repository is private (API error or missing permission). " +
        "**Fail closed:** check denied. No silent pass.\n\n" +
        "Grant `contents: read` (and ensure the App can see the repo), then re-run." +
        extra
      );
    case "missing_contents_permission":
      return (
        "Installation is missing `contents: read`. Surface Guard cannot read the lockfile. " +
        "Re-install or update App permissions, then re-run." +
        extra
      );
    case "missing_checks_permission":
      return (
        "Installation is missing `checks: write`. Surface Guard cannot post a check run. " +
        "Re-install or update App permissions, then re-run." +
        extra
      );
    case "org_not_entitled":
      return (
        "This GitHub organization is not on an active Surface Guard plan.\n\n" +
        `Reserve founding pricing ($99/mo or $990/yr per org): ${FOUNDING_URL}\n` +
        "Public repos can keep using free OSS SurfacePin." +
        extra
      );
    case "entitlement_store_unavailable":
      return (
        "Entitlement store is unavailable. **Fail closed:** check denied until billing status can be confirmed. " +
        "No silent pass on unknown entitlement." +
        extra
      );
    case "lockfile_missing":
      return (
        "Committed lockfile and/or surface dump was not found on this SHA. " +
        "Commit `surfacepin.lock.json` plus the surface dump JSON (`SURFACE_GUARD_SURFACE_PATH`), " +
        "generated with OSS SurfacePin, then push again." +
        extra
      );
    case "lockfile_drift":
      return (
        "SurfacePin verify failed: MCP list surface drifted from the committed lockfile." +
        extra
      );
    case "lockfile_unreadable":
      return "Could not read or parse the SurfacePin lockfile." + extra;
    case "installation_token_failed":
      return "Could not mint an installation access token. Check App credentials and installation id." + extra;
    default:
      return `Denied (${code}).` + extra;
  }
}

export const allowTitle = "Surface Guard: private-repo surface match";
export const allowSummary =
  "Repository is private, org is entitled, and SurfacePin verify matched the committed lockfile.";
