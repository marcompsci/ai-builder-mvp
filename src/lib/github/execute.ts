import { git } from "../workspaces/git/client";
import { getInstallationOctokit } from "./appAuth";
import { GitHubPushError } from "./push";
import { getApproval, markExecuted, type GitHubApproval } from "./approvals";
import { getConnectionById } from "./connections";
import { getRepoSelection } from "./repoSelection";
import { recordHumanAuditEntry } from "./auditLog";
import { getProjectRoot } from "../workspaces/paths";

export interface ExecuteContext {
  installationId: string;
  defaultBranch: string;
  workspaceRoot: string;
}

function splitRepo(repoFullName: string): { owner: string; repo: string } {
  const [owner, repo] = repoFullName.split("/", 2);
  return { owner, repo };
}

/** Blocks any write targeting the repo's default branch - the one, deliberately simple, hard rule this app enforces without depending on GitHub's own (often not installation-token-visible) branch protection API. */
function assertNotDefaultBranch(branch: string | null | undefined, ctx: ExecuteContext) {
  if (branch && branch === ctx.defaultBranch) {
    throw new GitHubPushError(`Pushing directly to the default branch (${ctx.defaultBranch}) is not allowed.`);
  }
}

/**
 * Executes exactly one already-approved GitHub action. Called only from the
 * human-triggered approval-execution route, never from a tool call - see
 * docs/github-mcp.md. The approval row this reads from is the sole source
 * of truth for what happens; nothing here re-derives intent from the model.
 */
export async function executeApproval(approval: GitHubApproval, ctx: ExecuteContext): Promise<Record<string, unknown>> {
  const octokit = getInstallationOctokit(ctx.installationId);
  const { owner, repo } = splitRepo(approval.repoFullName);
  const payload = approval.payload;

  switch (approval.actionType) {
    case "create_branch": {
      const branchName = String(payload.branchName ?? "");
      const fromBranch = typeof payload.fromBranch === "string" ? payload.fromBranch : ctx.defaultBranch;
      if (!branchName) throw new GitHubPushError("branchName is required.");
      try {
        const { data: refData } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${fromBranch}` });
        const { data: created } = await octokit.rest.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${branchName}`,
          sha: refData.object.sha,
        });
        return { branchName, sha: created.object.sha };
      } catch (err) {
        throw new GitHubPushError(err instanceof Error ? `Could not create branch: ${err.message}` : "Could not create branch.");
      }
    }

    case "create_commit_or_push_changes": {
      const branchName = String(payload.branchName ?? "");
      if (!branchName) throw new GitHubPushError("branchName is required.");
      assertNotDefaultBranch(branchName, ctx);

      const commitSha = await git(ctx.workspaceRoot, ["rev-parse", "HEAD"]);
      let token: string;
      try {
        const auth = (await octokit.auth({ type: "installation" })) as { token: string };
        token = auth.token;
      } catch (err) {
        throw new GitHubPushError(err instanceof Error ? `Could not authenticate with GitHub: ${err.message}` : "Could not authenticate with GitHub.");
      }
      const remoteUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
      try {
        await git(ctx.workspaceRoot, ["push", remoteUrl, `HEAD:refs/heads/${branchName}`], { redactSecrets: [token] });
      } catch (err) {
        throw new GitHubPushError(err instanceof Error ? err.message : "Push failed.");
      }
      return { branchName, commitSha };
    }

    case "create_pull_request": {
      const title = String(payload.title ?? "");
      const body = typeof payload.body === "string" ? payload.body : "";
      const headBranch = String(payload.headBranch ?? approval.sourceBranch ?? "");
      const baseBranch = String(payload.baseBranch ?? approval.targetBranch ?? ctx.defaultBranch);
      const draft = Boolean(payload.draft);
      if (!title || !headBranch) throw new GitHubPushError("title and headBranch are required.");
      try {
        const { data } = await octokit.rest.pulls.create({ owner, repo, title, body, head: headBranch, base: baseBranch, draft });
        return { number: data.number, url: data.html_url, headBranch, baseBranch };
      } catch (err) {
        throw new GitHubPushError(err instanceof Error ? `Could not create pull request: ${err.message}` : "Could not create pull request.");
      }
    }

    case "create_issue": {
      const title = String(payload.title ?? "");
      const body = typeof payload.body === "string" ? payload.body : "";
      if (!title) throw new GitHubPushError("title is required.");
      try {
        const { data } = await octokit.rest.issues.create({ owner, repo, title, body });
        return { number: data.number, url: data.html_url };
      } catch (err) {
        throw new GitHubPushError(err instanceof Error ? `Could not create issue: ${err.message}` : "Could not create issue.");
      }
    }

    case "add_pull_request_comment": {
      const pullNumber = Number(payload.pullNumber);
      const body = String(payload.body ?? "");
      if (!pullNumber || !body) throw new GitHubPushError("pullNumber and body are required.");
      try {
        const { data } = await octokit.rest.issues.createComment({ owner, repo, issue_number: pullNumber, body });
        return { commentId: data.id, url: data.html_url };
      } catch (err) {
        throw new GitHubPushError(err instanceof Error ? `Could not add comment: ${err.message}` : "Could not add comment.");
      }
    }

    default:
      throw new GitHubPushError("Unknown action type.");
  }
}

export class ApprovalExecutionError extends Error {}

/**
 * The one entry point both the decide route (auto-execute on approval) and
 * the standalone execute route (manual retry) call. Re-derives the
 * installation and default branch from the project's CURRENT connection
 * and repo selection rather than trusting anything cached on the approval
 * row, and refuses to run if the approval's repo no longer matches what
 * the project is actually connected to (guards against executing a stale
 * approval after a disconnect/reconnect to a different repo).
 */
export async function runApprovedExecution(approvalId: string, projectId: string): Promise<GitHubApproval> {
  const approval = getApproval(approvalId, projectId);
  if (!approval) throw new ApprovalExecutionError("Approval not found.");
  if (approval.status !== "approved") {
    throw new ApprovalExecutionError(`Approval is not in an executable state (status: ${approval.status}).`);
  }

  const connection = getConnectionById(approval.connectionId, projectId);
  const selection = getRepoSelection(projectId);
  if (!connection || !selection || selection.repoFullName !== approval.repoFullName) {
    throw new ApprovalExecutionError("This project's GitHub connection or repository has changed since this action was proposed.");
  }

  const workspaceRoot = getProjectRoot(projectId);
  const ctx: ExecuteContext = { installationId: connection.installationId, defaultBranch: selection.defaultBranch, workspaceRoot };

  try {
    const result = await executeApproval(approval, ctx);
    const updated = markExecuted(approval.id, projectId, result);
    recordHumanAuditEntry(approval, {
      toolName: approval.actionType,
      decision: "allow",
      githubResultRef: typeof result.url === "string" ? result.url : undefined,
    });
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Execution failed.";
    recordHumanAuditEntry(approval, { toolName: approval.actionType, decision: "deny", reason: message });
    throw err instanceof GitHubPushError ? err : new ApprovalExecutionError(message);
  }
}
