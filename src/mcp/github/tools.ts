import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getInstallationOctokit } from "../../lib/github/appAuth"; // relative, not "@/" - see docs/project-files-mcp.md
import { APPROVAL_ACTION_TYPES, createApproval } from "../../lib/github/approvals";
import { recordAuditEntry } from "./auditLog";
import { checkRateLimit, RateLimitError } from "./rateLimit";
import type { TrustedGitHubServerContext } from "./config";

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function deniedResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

async function guarded(
  ctx: TrustedGitHubServerContext,
  toolName: string,
  extra: { branch?: string },
  fn: () => Promise<{ result: ReturnType<typeof textResult>; reason?: string; githubResultRef?: string; approvalId?: string }>,
) {
  try {
    checkRateLimit();
  } catch (err) {
    recordAuditEntry(ctx, { toolName, decision: "deny", reason: "rate_limited", ...extra });
    return deniedResult(err instanceof RateLimitError ? err.message : "Rate limit exceeded.");
  }

  try {
    const { result, reason, githubResultRef, approvalId } = await fn();
    recordAuditEntry(ctx, { toolName, decision: "allow", reason, githubResultRef, approvalId, ...extra });
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.name : "error";
    recordAuditEntry(ctx, { toolName, decision: "deny", reason, ...extra });
    // Generic, never the underlying error's message/stack - same discipline as Project Files MCP.
    return deniedResult("That GitHub request could not be completed.");
  }
}

function ownerRepo(ctx: TrustedGitHubServerContext): { owner: string; repo: string } {
  const [owner, repo] = ctx.repoFullName.split("/", 2);
  return { owner, repo };
}

export function registerReadOnlyTools(server: McpServer, ctx: TrustedGitHubServerContext) {
  const { owner, repo } = ownerRepo(ctx);
  const octokit = getInstallationOctokit(ctx.installationId);

  server.registerTool(
    "get_repository_metadata",
    { description: "Get metadata for the connected repository (name, default branch, visibility, description).", inputSchema: {} },
    async () =>
      guarded(ctx, "get_repository_metadata", {}, async () => {
        const { data } = await octokit.rest.repos.get({ owner, repo });
        return {
          result: textResult({
            fullName: data.full_name,
            defaultBranch: data.default_branch,
            private: data.private,
            description: data.description,
          }),
        };
      }),
  );

  server.registerTool(
    "list_branches",
    { description: "List branches in the connected repository.", inputSchema: {} },
    async () =>
      guarded(ctx, "list_branches", {}, async () => {
        const { data } = await octokit.rest.repos.listBranches({ owner, repo, per_page: 100 });
        return { result: textResult({ branches: data.map((b) => ({ name: b.name, protected: b.protected })) }) };
      }),
  );

  server.registerTool(
    "list_repository_files",
    {
      description: "List files/folders at a path in the connected repository.",
      inputSchema: { path: z.string().optional(), ref: z.string().optional() },
    },
    async ({ path, ref }) =>
      guarded(ctx, "list_repository_files", { branch: ref }, async () => {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path: path ?? "", ref });
        const entries = Array.isArray(data) ? data.map((e) => ({ name: e.name, path: e.path, type: e.type })) : [{ name: data.name, path: data.path, type: data.type }];
        return { result: textResult({ entries } ) };
      }),
  );

  server.registerTool(
    "read_repository_file",
    {
      description: "Read a text file's content from the connected repository.",
      inputSchema: { path: z.string(), ref: z.string().optional() },
    },
    async ({ path, ref }) =>
      guarded(ctx, "read_repository_file", { branch: ref }, async () => {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });
        if (Array.isArray(data) || data.type !== "file" || !("content" in data)) {
          throw new Error("not_a_file");
        }
        const content = Buffer.from(data.content, "base64").toString("utf8");
        return { result: textResult({ path, content, size: data.size }) };
      }),
  );

  server.registerTool(
    "list_issues",
    { description: "List open issues in the connected repository.", inputSchema: { state: z.enum(["open", "closed", "all"]).optional() } },
    async ({ state }) =>
      guarded(ctx, "list_issues", {}, async () => {
        const { data } = await octokit.rest.issues.listForRepo({ owner, repo, state: state ?? "open", per_page: 50 });
        return { result: textResult({ issues: data.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, state: i.state })) }) };
      }),
  );

  server.registerTool(
    "read_issue",
    { description: "Read one issue's title and body.", inputSchema: { number: z.number().int().positive() } },
    async ({ number }) =>
      guarded(ctx, "read_issue", {}, async () => {
        const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: number });
        return { result: textResult({ number: data.number, title: data.title, body: data.body, state: data.state }) };
      }),
  );

  server.registerTool(
    "list_pull_requests",
    { description: "List pull requests in the connected repository.", inputSchema: { state: z.enum(["open", "closed", "all"]).optional() } },
    async ({ state }) =>
      guarded(ctx, "list_pull_requests", {}, async () => {
        const { data } = await octokit.rest.pulls.list({ owner, repo, state: state ?? "open", per_page: 50 });
        return { result: textResult({ pullRequests: data.map((p) => ({ number: p.number, title: p.title, state: p.state, head: p.head.ref, base: p.base.ref })) }) };
      }),
  );

  server.registerTool(
    "read_pull_request",
    { description: "Read one pull request's details.", inputSchema: { number: z.number().int().positive() } },
    async ({ number }) =>
      guarded(ctx, "read_pull_request", {}, async () => {
        const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: number });
        return {
          result: textResult({
            number: data.number,
            title: data.title,
            body: data.body,
            state: data.state,
            head: data.head.ref,
            base: data.base.ref,
          }),
        };
      }),
  );

  server.registerTool(
    "get_pull_request_diff",
    { description: "Get the unified diff for a pull request.", inputSchema: { number: z.number().int().positive() } },
    async ({ number }) =>
      guarded(ctx, "get_pull_request_diff", {}, async () => {
        const { data } = await octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: number,
          mediaType: { format: "diff" },
        });
        return { result: textResult({ diff: data as unknown as string }) };
      }),
  );
}

/**
 * Write tools never execute a GitHub action directly - each one validates
 * its input, creates a pending github_approvals row, and returns
 * immediately. The actual GitHub API call only ever happens from the
 * human-triggered approval-execution route (src/lib/github/execute.ts),
 * against this exact stored payload, once. See docs/github-mcp.md.
 */
export function registerWriteTools(server: McpServer, ctx: TrustedGitHubServerContext) {
  function proposeInput() {
    return {
      reason: z.string().min(1).max(500),
    };
  }

  server.registerTool(
    "create_branch",
    {
      description: "Propose creating a new branch. Requires human approval before it actually happens.",
      inputSchema: { branchName: z.string().min(1), fromBranch: z.string().optional(), ...proposeInput() },
    },
    async ({ branchName, fromBranch, reason }) =>
      guarded(ctx, "create_branch", { branch: branchName }, async () => {
        const approval = createApproval({
          projectId: ctx.projectId,
          connectionId: ctx.connectionId,
          agentRunId: ctx.runId,
          actionType: "create_branch",
          repoFullName: ctx.repoFullName,
          sourceBranch: fromBranch ?? ctx.defaultBranch,
          targetBranch: branchName,
          payload: { branchName, fromBranch: fromBranch ?? ctx.defaultBranch },
          reason,
          reversible: true,
        });
        return { result: textResult({ status: "pending_approval", approvalId: approval.id }), approvalId: approval.id };
      }),
  );

  server.registerTool(
    "create_commit_or_push_changes",
    {
      description: "Propose pushing the current local git state to a branch. Requires human approval before it actually happens.",
      inputSchema: { branchName: z.string().min(1), commitSummary: z.string().min(1), ...proposeInput() },
    },
    async ({ branchName, commitSummary, reason }) =>
      guarded(ctx, "create_commit_or_push_changes", { branch: branchName }, async () => {
        const approval = createApproval({
          projectId: ctx.projectId,
          connectionId: ctx.connectionId,
          agentRunId: ctx.runId,
          actionType: "create_commit_or_push_changes",
          repoFullName: ctx.repoFullName,
          targetBranch: branchName,
          payload: { branchName, commitSummary },
          reason,
          reversible: false,
        });
        return { result: textResult({ status: "pending_approval", approvalId: approval.id }), approvalId: approval.id };
      }),
  );

  server.registerTool(
    "create_pull_request",
    {
      description: "Propose opening a pull request. Requires human approval before it actually happens.",
      inputSchema: {
        title: z.string().min(1),
        body: z.string().optional(),
        headBranch: z.string().min(1),
        baseBranch: z.string().optional(),
        draft: z.boolean().optional(),
        ...proposeInput(),
      },
    },
    async ({ title, body, headBranch, baseBranch, draft, reason }) =>
      guarded(ctx, "create_pull_request", { branch: headBranch }, async () => {
        const approval = createApproval({
          projectId: ctx.projectId,
          connectionId: ctx.connectionId,
          agentRunId: ctx.runId,
          actionType: "create_pull_request",
          repoFullName: ctx.repoFullName,
          sourceBranch: headBranch,
          targetBranch: baseBranch ?? ctx.defaultBranch,
          payload: { title, body: body ?? "", headBranch, baseBranch: baseBranch ?? ctx.defaultBranch, draft: Boolean(draft) },
          reason,
          reversible: true,
        });
        return { result: textResult({ status: "pending_approval", approvalId: approval.id }), approvalId: approval.id };
      }),
  );

  server.registerTool(
    "create_issue",
    {
      description: "Propose creating an issue. Requires human approval before it actually happens.",
      inputSchema: { title: z.string().min(1), body: z.string().optional(), ...proposeInput() },
    },
    async ({ title, body, reason }) =>
      guarded(ctx, "create_issue", {}, async () => {
        const approval = createApproval({
          projectId: ctx.projectId,
          connectionId: ctx.connectionId,
          agentRunId: ctx.runId,
          actionType: "create_issue",
          repoFullName: ctx.repoFullName,
          payload: { title, body: body ?? "" },
          reason,
          reversible: true,
        });
        return { result: textResult({ status: "pending_approval", approvalId: approval.id }), approvalId: approval.id };
      }),
  );

  server.registerTool(
    "add_pull_request_comment",
    {
      description: "Propose adding a comment to a pull request. Requires human approval before it actually happens.",
      inputSchema: { pullNumber: z.number().int().positive(), body: z.string().min(1), ...proposeInput() },
    },
    async ({ pullNumber, body, reason }) =>
      guarded(ctx, "add_pull_request_comment", {}, async () => {
        const approval = createApproval({
          projectId: ctx.projectId,
          connectionId: ctx.connectionId,
          agentRunId: ctx.runId,
          actionType: "add_pull_request_comment",
          repoFullName: ctx.repoFullName,
          payload: { pullNumber, body },
          reason,
          reversible: true,
        });
        return { result: textResult({ status: "pending_approval", approvalId: approval.id }), approvalId: approval.id };
      }),
  );
}

export { APPROVAL_ACTION_TYPES };
