import http from "node:http";
import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { EnvEntitlementStore } from "./billing/entitlement.js";
import { handleGitHubWebhook } from "./webhook/handler.js";
import type { VerifyResult } from "./check/runCheck.js";
import type { Decision } from "./errors.js";
import { SurfaceGuardDeny } from "./errors.js";
import { createGitHubApp, createInstallationOctokit } from "./github/octokit.js";
import { makeContentsFetcher } from "./github/contents.js";
import { postSurfaceGuardCheck } from "./github/checks.js";
import { verifySurfacePinAtSha } from "./check/surfacepinVerify.js";

function resolvePrivateKey(pemOrFile: string): string {
  if (pemOrFile.startsWith("FILE:")) {
    return readFileSync(pemOrFile.slice("FILE:".length), "utf8");
  }
  return pemOrFile.replace(/\\n/g, "\n");
}

/**
 * Legacy stub kept for tests / emergency override via SURFACE_GUARD_STUB_VERIFY=1.
 * Fail closed: never invent success.
 */
export function stubVerifyUnavailable(): () => Promise<VerifyResult> {
  return async () => ({
    ok: false,
    reason: "unreadable",
    detail:
      "Repo content fetch stub active (SURFACE_GUARD_STUB_VERIFY). Fail closed — no silent pass.",
  });
}

export function createServer(opts?: {
  env?: NodeJS.ProcessEnv;
  makeVerify?: (ctx: {
    owner: string;
    repo: string;
    sha: string;
    installationId: number;
  }) => () => Promise<VerifyResult>;
  postCheck?: (ctx: {
    owner: string;
    repo: string;
    sha: string;
    installationId: number;
    decision: Decision;
  }) => Promise<{ id: number } | void>;
}): http.Server {
  const env = opts?.env ?? process.env;
  const config = loadConfig(env);
  const privateKey = resolvePrivateKey(config.privateKeyPem);

  const entitlement = new EnvEntitlementStore(config.entitledOrgs, {
    failIfEmpty: false,
  });

  const stubMode = (env.SURFACE_GUARD_STUB_VERIFY ?? "").trim() === "1";
  // Skip App client when tests inject both makeVerify + postCheck (no network).
  const depsFullyInjected = Boolean(opts?.makeVerify && opts?.postCheck);
  const app =
    stubMode || depsFullyInjected
      ? null
      : createGitHubApp({ appId: config.appId, privateKeyPem: privateKey });

  const makeVerify =
    opts?.makeVerify ??
    ((ctx) => {
      if (stubMode || !app) {
        return stubVerifyUnavailable();
      }
      return async (): Promise<VerifyResult> => {
        let octokit;
        try {
          octokit = await createInstallationOctokit(app, ctx.installationId);
        } catch (err) {
          return {
            ok: false,
            reason: "installation_token_failed",
            detail: err instanceof Error ? err.message : String(err),
          };
        }
        const fetchFile = makeContentsFetcher(octokit);
        return verifySurfacePinAtSha(
          fetchFile,
          { owner: ctx.owner, repo: ctx.repo, sha: ctx.sha },
          { lockfilePath: config.lockfilePath, surfacePath: config.surfacePath },
        );
      };
    });

  const postCheck =
    opts?.postCheck ??
    (async (ctx) => {
      if (stubMode || !app) {
        throw new Error(
          "Checks API post unavailable in stub mode. Unset SURFACE_GUARD_STUB_VERIFY and configure App credentials.",
        );
      }
      const octokit = await createInstallationOctokit(app, ctx.installationId);
      return postSurfaceGuardCheck(octokit, {
        owner: ctx.owner,
        repo: ctx.repo,
        sha: ctx.sha,
        decision: ctx.decision,
      });
    });

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            service: "surface-guard",
            webhookVerify: true,
            silentPass: false,
            surfacepinVerify: !stubMode,
            checksApi: !stubMode,
            stubVerify: stubMode,
            publicSellLive: false,
          }),
        );
        return;
      }

      if (req.method === "POST" && req.url === "/github/webhook") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const rawBody = Buffer.concat(chunks);
        const result = await handleGitHubWebhook(
          {
            webhookSecret: config.webhookSecret,
            entitlement,
            makeVerify,
            postCheck,
          },
          {
            signature: req.headers["x-hub-signature-256"] as string | undefined,
            event: req.headers["x-github-event"] as string | undefined,
            delivery: req.headers["x-github-delivery"] as string | undefined,
          },
          rawBody,
        );
        res.writeHead(result.status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.body));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: "not found" }));
    } catch (err) {
      if (err instanceof SurfaceGuardDeny) {
        res.writeHead(err.httpStatus, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, code: err.code, message: err.publicMessage }));
        return;
      }
      console.error(err);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: "internal error" }));
    }
  });

  return server;
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === new URL(entry, "file://").href || import.meta.url.endsWith("/server.js");
  } catch {
    return import.meta.url.endsWith("/server.js");
  }
}

if (isMain()) {
  const config = loadConfig();
  const server = createServer();
  server.listen(config.port, config.host, () => {
    console.log(
      `surface-guard listening on http://${config.host}:${config.port} (Octokit+SurfacePin+Checks wired; fail-closed; publicSellLive=false)`,
    );
  });
}
