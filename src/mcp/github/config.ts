// Same trust model as Project Files MCP (src/mcp/projectFiles/config.ts):
// every field here comes from an environment variable injected by our own
// server-side code at process-spawn time - never a tool parameter. In
// particular, repoFullName/defaultBranch/installationId are NOT arguments
// on any GitHub MCP tool - there is no way for a model to ask for a
// different repository.

export interface TrustedGitHubServerContext {
  projectId: string;
  runId: string;
  provider: "claude-code" | "codex";
  connectionId: string;
  installationId: string;
  repoFullName: string;
  defaultBranch: string;
  userId: string;
  orgId: string;
}

class GitHubServerConfigError extends Error {}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new GitHubServerConfigError(`GitHub MCP: missing required env var ${name}`);
  }
  return value;
}

export function loadTrustedContext(): TrustedGitHubServerContext {
  const provider = requireEnv("GITHUB_MCP_PROVIDER");
  if (provider !== "claude-code" && provider !== "codex") {
    throw new GitHubServerConfigError(`GitHub MCP: invalid GITHUB_MCP_PROVIDER "${provider}"`);
  }

  return {
    projectId: requireEnv("GITHUB_MCP_PROJECT_ID"),
    runId: requireEnv("GITHUB_MCP_RUN_ID"),
    provider,
    connectionId: requireEnv("GITHUB_MCP_CONNECTION_ID"),
    installationId: requireEnv("GITHUB_MCP_INSTALLATION_ID"),
    repoFullName: requireEnv("GITHUB_MCP_REPO_FULL_NAME"),
    defaultBranch: requireEnv("GITHUB_MCP_DEFAULT_BRANCH"),
    userId: process.env.GITHUB_MCP_USER_ID || "local-dev-user",
    orgId: process.env.GITHUB_MCP_ORG_ID || "local",
  };
}
