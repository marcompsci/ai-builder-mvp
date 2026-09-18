import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import type { GitHubApproval } from "./approvals";

/**
 * Records a human decide/execute action into the same mcp_audit_log table
 * the GitHub MCP server writes to (src/mcp/github/auditLog.ts) - one
 * unified trail for "what did the agent propose" and "what did the human
 * do about it". provider is "human" here, never one of the agent
 * providers, so the two kinds of rows stay distinguishable.
 */
export function recordHumanAuditEntry(
  approval: GitHubApproval,
  entry: { toolName: string; decision: "allow" | "deny"; reason?: string; githubResultRef?: string },
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO mcp_audit_log
       (id, timestamp, user_id, org_id, project_id, agent_run_id, provider, tool_name, relative_path, decision, reason, content_hash_before, content_hash_after, repository, branch, approval_id, github_result_ref)
     VALUES
       (@id, @timestamp, @userId, @orgId, @projectId, @agentRunId, 'human', @toolName, NULL, @decision, @reason, NULL, NULL, @repository, @branch, @approvalId, @githubResultRef)`,
  ).run({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    userId: "local-dev-user",
    orgId: "local",
    projectId: approval.projectId,
    agentRunId: approval.agentRunId,
    toolName: entry.toolName,
    decision: entry.decision,
    reason: entry.reason ?? null,
    repository: approval.repoFullName,
    branch: approval.targetBranch ?? approval.sourceBranch ?? null,
    approvalId: approval.id,
    githubResultRef: entry.githubResultRef ?? null,
  });
}
