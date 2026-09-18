import { randomUUID } from "node:crypto";
import { getDb } from "../../lib/db"; // relative, not "@/" - same reason as Project Files MCP, see docs/project-files-mcp.md
import type { TrustedGitHubServerContext } from "./config";

export interface GitHubAuditEntryInput {
  toolName: string;
  decision: "allow" | "deny";
  reason?: string;
  branch?: string;
  approvalId?: string;
  githubResultRef?: string;
}

/** Insert-only, same table Project Files MCP uses (mcp_audit_log), with the GitHub-specific columns populated and the file-specific ones left null. */
export function recordAuditEntry(ctx: TrustedGitHubServerContext, entry: GitHubAuditEntryInput): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO mcp_audit_log
       (id, timestamp, user_id, org_id, project_id, agent_run_id, provider, tool_name, relative_path, decision, reason, content_hash_before, content_hash_after, repository, branch, approval_id, github_result_ref)
     VALUES
       (@id, @timestamp, @userId, @orgId, @projectId, @agentRunId, @provider, @toolName, NULL, @decision, @reason, NULL, NULL, @repository, @branch, @approvalId, @githubResultRef)`,
  ).run({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    userId: ctx.userId,
    orgId: ctx.orgId,
    projectId: ctx.projectId,
    agentRunId: ctx.runId,
    provider: ctx.provider,
    toolName: entry.toolName,
    decision: entry.decision,
    reason: entry.reason ?? null,
    repository: ctx.repoFullName,
    branch: entry.branch ?? null,
    approvalId: entry.approvalId ?? null,
    githubResultRef: entry.githubResultRef ?? null,
  });
}
