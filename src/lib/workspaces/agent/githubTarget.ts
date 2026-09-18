import { getConnectionForProject } from "../../github/connections";
import { getRepoSelection } from "../../github/repoSelection";

export interface ActiveGitHubTarget {
  connectionId: string;
  installationId: string;
  repoFullName: string;
  defaultBranch: string;
}

/**
 * Resolves the one connection+repo a project has set up, if any. Returns
 * null (never throws) when nothing is connected or no repo has been
 * selected - GitHub MCP is simply not spawned for that run in that case.
 * This is the single place adapters ask "does this project have GitHub
 * access configured" so the two providers can't drift on the answer.
 */
export function getActiveGitHubTarget(projectId: string): ActiveGitHubTarget | null {
  const connection = getConnectionForProject(projectId);
  if (!connection) return null;
  const selection = getRepoSelection(projectId);
  if (!selection || selection.connectionId !== connection.id) return null;
  return {
    connectionId: connection.id,
    installationId: connection.installationId,
    repoFullName: selection.repoFullName,
    defaultBranch: selection.defaultBranch,
  };
}
