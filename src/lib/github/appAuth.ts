import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

export class GitHubConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubConfigError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new GitHubConfigError(`${name} is not configured. See .env.example.`);
  }
  return value;
}

function appCredentials(): { appId: string; privateKey: string } {
  return {
    appId: requireEnv("GITHUB_APP_ID"),
    // Stored in the env var with literal "\n" sequences (PEM files don't
    // survive .env files with real newlines); decode them back here.
    privateKey: requireEnv("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n"),
  };
}

/** An Octokit authenticated as the App itself - used only to look up installations, never to touch repo content. */
export function getAppOctokit(): Octokit {
  const { appId, privateKey } = appCredentials();
  return new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey } });
}

/**
 * Mints a short-lived (~1h) installation access token on demand and returns
 * an Octokit using it. Nothing here is persisted - the token lives only in
 * this Octokit instance's memory for the duration of the request that
 * needed it, per requirement #11.
 */
export function getInstallationOctokit(installationId: string): Octokit {
  const { appId, privateKey } = appCredentials();
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey, installationId },
  });
}
