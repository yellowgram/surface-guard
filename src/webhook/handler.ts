import { SurfaceGuardDeny, type Decision } from "../errors.js";
import { verifyGitHubWebhookSignature } from "./verify.js";
import { parseInstallation } from "../auth/installation.js";
import { runSurfaceGuardCheck } from "../check/runCheck.js";
import type { EntitlementStore } from "../billing/entitlement.js";
import type { VerifyResult } from "../check/runCheck.js";

export type WebhookHandleResult =
  | { status: number; body: { ok: true; decision?: Decision; ignored?: string } }
  | { status: number; body: { ok: false; code: string; message: string } };

export type HandlerDeps = {
  webhookSecret: string;
  entitlement: EntitlementStore;
  /**
   * Produce a verify callback for a given repo + SHA.
   * Production wires Octokit + surfacepin; tests inject fakes.
   */
  makeVerify: (ctx: {
    owner: string;
    repo: string;
    sha: string;
    installationId: number;
  }) => () => Promise<VerifyResult>;
};

type RepoPayload = {
  private?: boolean;
  full_name?: string;
  name?: string;
  owner?: { login?: string };
};

/**
 * Process one GitHub webhook delivery.
 * Signature verify is mandatory and runs first.
 */
export async function handleGitHubWebhook(
  deps: HandlerDeps,
  headers: {
    signature?: string | null;
    event?: string | null;
    delivery?: string | null;
  },
  rawBody: Buffer | string,
): Promise<WebhookHandleResult> {
  try {
    verifyGitHubWebhookSignature(rawBody, headers.signature ?? undefined, deps.webhookSecret);
  } catch (err) {
    if (err instanceof SurfaceGuardDeny) {
      return {
        status: err.httpStatus,
        body: { ok: false, code: err.code, message: err.publicMessage },
      };
    }
    throw err;
  }

  const event = (headers.event ?? "").trim();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(
      typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return {
      status: 400,
      body: {
        ok: false,
        code: "malformed_payload",
        message: "Webhook body is not valid JSON.",
      },
    };
  }

  // Installation lifecycle — ack only (entitlement is billing-driven, not install-driven).
  if (event === "installation" || event === "installation_repositories") {
    return {
      status: 200,
      body: { ok: true, ignored: `${event} acknowledged; entitlement is billing-gated` },
    };
  }

  if (event !== "pull_request" && event !== "check_suite") {
    return {
      status: 200,
      body: { ok: true, ignored: `event ${event || "(missing)"} not handled` },
    };
  }

  // Ignore noisy PR actions
  if (event === "pull_request") {
    const action = typeof payload.action === "string" ? payload.action : "";
    if (!["opened", "synchronize", "reopened", "ready_for_review"].includes(action)) {
      return { status: 200, body: { ok: true, ignored: `pull_request.${action}` } };
    }
  }

  const repo = payload.repository as RepoPayload | undefined;
  const installation = parseInstallation(payload.installation);
  if (!repo || !installation) {
    return {
      status: 400,
      body: {
        ok: false,
        code: "malformed_payload",
        message: "Missing repository or installation on webhook payload.",
      },
    };
  }

  const owner =
    repo.owner?.login ??
    installation.accountLogin ??
    (typeof payload.organization === "object" &&
    payload.organization &&
    typeof (payload.organization as { login?: string }).login === "string"
      ? (payload.organization as { login: string }).login
      : "");
  const repoName = repo.name ?? "";
  const orgLogin = installation.accountLogin || owner;

  let sha = "";
  if (event === "pull_request") {
    const pr = payload.pull_request as { head?: { sha?: string } } | undefined;
    sha = pr?.head?.sha ?? "";
  } else if (event === "check_suite") {
    const suite = payload.check_suite as { head_sha?: string } | undefined;
    sha = suite?.head_sha ?? "";
  }
  if (!sha || !owner || !repoName) {
    return {
      status: 400,
      body: {
        ok: false,
        code: "malformed_payload",
        message: "Missing owner, repo name, or head SHA.",
      },
    };
  }

  const decision = await runSurfaceGuardCheck({
    repo: {
      private: repo.private,
      permissions: installation.permissions,
      fullName: repo.full_name,
    },
    orgLogin,
    entitlement: deps.entitlement,
    verify: deps.makeVerify({
      owner,
      repo: repoName,
      sha,
      installationId: installation.installationId,
    }),
  });

  // Always return the decision explicitly — callers must post a check run from this.
  return { status: 200, body: { ok: true, decision } };
}
