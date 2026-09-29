import { SurfaceGuardDeny } from "./errors.js";

export type AppConfig = {
  appId: string;
  privateKeyPem: string;
  webhookSecret: string;
  port: number;
  host: string;
  entitledOrgs: Set<string>;
  lockfilePath: string;
};

const PLACEHOLDER_SECRETS = new Set([
  "",
  "replace_me",
  "changeme",
  "replace_with_long_random_secret",
  "whsec_replace_me",
]);

export function isUnconfiguredSecret(value: string | undefined | null): boolean {
  if (value == null) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_SECRETS.has(trimmed)) return true;
  if (trimmed.length < 16) return true;
  return false;
}

export function parseEntitledOrgs(raw: string | undefined): Set<string> {
  const set = new Set<string>();
  if (!raw || !raw.trim()) return set;
  for (const part of raw.split(",")) {
    const login = part.trim().toLowerCase();
    if (login) set.add(login);
  }
  return set;
}

/**
 * Load config. Missing webhook secret / App id / private key refuse to start
 * (fail loud) — never boot into a silent-pass mode.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appId = (env.GITHUB_APP_ID ?? "").trim();
  const webhookSecret = (env.GITHUB_WEBHOOK_SECRET ?? "").trim();
  const privateKeyPem = (env.GITHUB_APP_PRIVATE_KEY ?? "").trim();
  const privateKeyPath = (env.GITHUB_APP_PRIVATE_KEY_PATH ?? "").trim();

  if (!appId) {
    throw new SurfaceGuardDeny(
      "malformed_payload",
      "GITHUB_APP_ID is required. Refusing to start without App credentials.",
      500,
    );
  }
  if (isUnconfiguredSecret(webhookSecret)) {
    throw new SurfaceGuardDeny(
      "webhook_secret_unconfigured",
      "GITHUB_WEBHOOK_SECRET is missing or a placeholder. Refusing to start — unsigned webhooks would be accepted otherwise.",
      500,
    );
  }

  let pem = privateKeyPem;
  if (!pem && privateKeyPath) {
    // Lazy path read is done by caller with fs — keep string for testability.
    pem = `FILE:${privateKeyPath}`;
  }
  if (!pem) {
    throw new SurfaceGuardDeny(
      "malformed_payload",
      "GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH is required. Refusing to start.",
      500,
    );
  }

  return {
    appId,
    privateKeyPem: pem,
    webhookSecret,
    port: Number(env.PORT ?? 3080) || 3080,
    host: (env.HOST ?? "127.0.0.1").trim() || "127.0.0.1",
    entitledOrgs: parseEntitledOrgs(env.SURFACE_GUARD_ENTITLED_ORGS),
    lockfilePath: (env.SURFACE_GUARD_LOCKFILE_PATH ?? "surfacepin.lock.json").trim(),
  };
}
