import { git } from "../workspaces/git/client";
import { getInstallationOctokit } from "./appAuth";

export class GitHubPushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubPushError";
  }
}

export interface PushParams {
  workspaceRoot: string;
  installationId: string;
  installationAccountType: string | null;
  installationLogin: string;
  mode: "existing" | "create_new";
  repoFullName?: string;
  newRepoName?: string;
  branch: string;
}

export async function pushProjectToGitHub(params: PushParams): Promise<{ repoFullName: string; commitSha: string }> {
  const octokit = getInstallationOctokit(params.installationId);
  let owner: string;
  let repo: string;

  if (params.mode === "create_new") {
    if (!params.newRepoName) {
      throw new GitHubPushError("A repository name is required to create a new repository.");
    }
    // GitHub Apps cannot create repositories under a personal account via
    // an installation token (that endpoint only accepts a user OAuth
    // token/PAT) - only under an organization the app is installed on with
    // Administration: write. Be honest about this rather than silently
    // failing.
    if (params.installationAccountType !== "Organization") {
      throw new GitHubPushError(
        "This GitHub connection is on a personal account. GitHub Apps can't create repositories there - " +
          "create the repository on GitHub first, then select it as an existing repository, or connect an " +
          "organization installation instead.",
      );
    }
    try {
      const { data } = await octokit.rest.repos.createInOrg({
        org: params.installationLogin,
        name: params.newRepoName,
        private: true,
      });
      owner = data.owner.login;
      repo = data.name;
    } catch (err) {
      throw new GitHubPushError(err instanceof Error ? `Could not create the repository: ${err.message}` : "Could not create the repository.");
    }
  } else {
    if (!params.repoFullName || !params.repoFullName.includes("/")) {
      throw new GitHubPushError("A valid repository (owner/name) is required.");
    }
    [owner, repo] = params.repoFullName.split("/", 2);
    try {
      await octokit.rest.repos.get({ owner, repo });
    } catch {
      throw new GitHubPushError("That repository was not found or this connection can't access it.");
    }
  }

  const commitSha = await git(params.workspaceRoot, ["rev-parse", "HEAD"]);

  let token: string;
  try {
    const auth = (await octokit.auth({ type: "installation" })) as { token: string };
    token = auth.token;
  } catch (err) {
    throw new GitHubPushError(err instanceof Error ? `Could not authenticate with GitHub: ${err.message}` : "Could not authenticate with GitHub.");
  }

  const remoteUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  try {
    await git(params.workspaceRoot, ["push", remoteUrl, `HEAD:refs/heads/${params.branch}`], {
      redactSecrets: [token],
    });
  } catch (err) {
    throw new GitHubPushError(err instanceof Error ? err.message : "Push failed.");
  }

  return { repoFullName: `${owner}/${repo}`, commitSha };
}
