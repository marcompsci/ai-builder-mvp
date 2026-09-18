import { randomUUID } from "node:crypto";
import { getDb } from "../../lib/db"; // relative, not "@/" - see the note in tools.ts
import type { TrustedServerContext } from "./config";

export interface AuditEntryInput {
  toolName: string;
  relativePath?: string;
  decision: "allow" | "deny";
  reason?: string;
  contentHashBefore?: string;
  contentHashAfter?: string;
}

/**
 * Insert-only. No code path in this app updates or deletes rows in
 * mcp_audit_log - it is treated as immutable by convention. Never pass
 * file contents or secret values here, only hashes/paths/decisions.
 */
export function recordAuditEntry(ctx: TrustedServerContext, entry: AuditEntryInput): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO mcp_audit_log
       (id, timestamp, user_id, org_id, project_id, agent_run_id, provider, tool_name, relative_path, decision, reason, content_hash_before, content_hash_after)
     VALUES
       (@id, @timestamp, @userId, @orgId, @projectId, @agentRunId, @provider, @toolName, @relativePath, @decision, @reason, @contentHashBefore, @contentHashAfter)`,
  ).run({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    userId: ctx.userId,
    orgId: ctx.orgId,
    projectId: ctx.projectId,
    agentRunId: ctx.runId,
    provider: ctx.provider,
    toolName: entry.toolName,
    relativePath: entry.relativePath ?? null,
    decision: entry.decision,
    reason: entry.reason ?? null,
    contentHashBefore: entry.contentHashBefore ?? null,
    contentHashAfter: entry.contentHashAfter ?? null,
  });
}
