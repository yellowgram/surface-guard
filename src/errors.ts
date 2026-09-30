/** Typed deny / failure codes. Every deny path uses one of these — never silent. */

export type DenyCode =
  | "webhook_signature_missing"
  | "webhook_signature_invalid"
  | "webhook_secret_unconfigured"
  | "repo_public"
  | "repo_privacy_unknown"
  | "missing_contents_permission"
  | "missing_checks_permission"
  | "org_not_entitled"
  | "entitlement_store_unavailable"
  | "lockfile_missing"
  | "lockfile_drift"
  | "lockfile_unreadable"
  | "installation_token_failed"
  | "unsupported_event"
  | "malformed_payload";

export class SurfaceGuardDeny extends Error {
  readonly code: DenyCode;
  readonly httpStatus: number;
  readonly publicMessage: string;

  constructor(code: DenyCode, publicMessage: string, httpStatus = 403) {
    super(`${code}: ${publicMessage}`);
    this.name = "SurfaceGuardDeny";
    this.code = code;
    this.publicMessage = publicMessage;
    this.httpStatus = httpStatus;
  }
}

export type CheckConclusion = "success" | "failure" | "neutral" | "cancelled";

export type Decision =
  | {
      outcome: "allow";
      title: string;
      summary: string;
      conclusion: "success";
    }
  | {
      outcome: "deny";
      code: DenyCode;
      title: string;
      summary: string;
      conclusion: "failure";
    };
