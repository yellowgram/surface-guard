import http from "node:http";
import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { EnvEntitlementStore } from "./billing/entitlement.js";
import { handleGitHubWebhook } from "./webhook/handler.js";
import type { VerifyResult } from "./check/runCheck.js";
import { SurfaceGuardDeny } from "./errors.js";

function resolvePrivateKey(pemOrFile: string): string {
  if (pemOrFile.startsWith("FILE:")) {
    return readFileSync(pemOrFile.slice("FILE:".length), "utf8");
  }
  return pemOrFile.replace(/\\n/g, "\n");
}

/**
 * Placeholder verify used until Octokit+surfacepin file fetch is wired in production.
 * Fail closed: cannot read repo contents → missing/unreadable, never invent success.
 */
export function stubVerifyUnavailable(): () => Promise<VerifyResult> {
  return async () => ({
    ok: false,
    reason: "unreadable",
    detail:
      "Repo content fetch not wired in this build. Fail closed — no silent pass. Wire Octokit contents.get + surfacepin verify before go-live.",
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
}): http.Server {
  const env = opts?.env ?? process.env;
  const config = loadConfig(env);
  // Resolve key early so boot fails loud if path is bad.
  resolvePrivateKey(config.privateKeyPem);

  const entitlement = new EnvEntitlementStore(config.entitledOrgs, {
    // Empty entitled set → every org denied as not_entitled (explicit), not unavailable.
    // Unavailable is reserved for store errors / forced empty production misconfig.
    failIfEmpty: false,
  });

  const makeVerify = opts?.makeVerify ?? (() => stubVerifyUnavailable());

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
      `surface-guard listening on http://${config.host}:${config.port} (webhook verify required; no silent pass)`,
    );
  });
}
