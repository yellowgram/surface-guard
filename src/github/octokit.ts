import { App, Octokit, RequestError } from "octokit";

export type GuardOctokit = InstanceType<typeof Octokit>;

export type AppCredentials = {
  appId: string;
  privateKeyPem: string;
};

/**
 * Build a GitHub App client. Used only to mint installation tokens.
 * Fail closed: bad credentials surface when getInstallationOctokit is called.
 */
export function createGitHubApp(creds: AppCredentials): App {
  const appId = Number(creds.appId);
  if (!Number.isFinite(appId) || appId <= 0) {
    throw new Error(`GITHUB_APP_ID must be a positive number (got ${JSON.stringify(creds.appId)})`);
  }
  if (!creds.privateKeyPem.includes("BEGIN")) {
    throw new Error("GITHUB_APP_PRIVATE_KEY does not look like a PEM private key");
  }
  return new App({
    appId,
    privateKey: creds.privateKeyPem,
    Octokit,
  });
}

/**
 * Mint an installation-scoped Octokit (contents:read + checks:write as granted).
 */
export async function createInstallationOctokit(
  app: App,
  installationId: number,
): Promise<GuardOctokit> {
  if (!Number.isFinite(installationId) || installationId <= 0) {
    throw new Error(`installationId must be a positive number (got ${installationId})`);
  }
  try {
    return (await app.getInstallationOctokit(installationId)) as GuardOctokit;
  } catch (err) {
    const detail = formatOctokitError(err);
    throw new Error(`installation token mint failed: ${detail}`);
  }
}

export function formatOctokitError(err: unknown): string {
  if (err instanceof RequestError) {
    return `GitHub API ${err.status}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export { RequestError };
