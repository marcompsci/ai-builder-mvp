import { createHash, randomUUID } from "node:crypto";
import { getDb } from "../db";

export const APPROVAL_ACTION_TYPES = [
  "create_branch",
  "create_commit_or_push_changes",
  "create_pull_request",
  "create_issue",
  "add_pull_request_comment",
] as const;
export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPES)[number];

export type ApprovalStatus = "pending" | "approved" | "rejected" | "executed" | "expired";

const APPROVAL_TTL_MS = 15 * 60 * 1000;

export interface GitHubApproval {
  id: string;
  projectId: string;
  connectionId: string;
  agentRunId: string;
  actionType: ApprovalActionType;
  repoFullName: string;
  targetBranch: string | null;
  sourceBranch: string | null;
  payload: Record<string, unknown>;
  payloadHash: string;
  reason: string | null;
  reversible: boolean;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  result: Record<string, unknown> | null;
}

function rowToApproval(row: Record<string, unknown>): GitHubApproval {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    connectionId: row.connection_id as string,
    agentRunId: row.agent_run_id as string,
    actionType: row.action_type as ApprovalActionType,
    repoFullName: row.repo_full_name as string,
    targetBranch: (row.target_branch as string) ?? null,
    sourceBranch: (row.source_branch as string) ?? null,
    payload: JSON.parse(row.payload_json as string),
    payloadHash: row.payload_hash as string,
    reason: (row.reason as string) ?? null,
    reversible: Boolean(row.reversible),
    status: row.status as ApprovalStatus,
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
    decidedAt: (row.decided_at as string) ?? null,
    executedAt: (row.executed_at as string) ?? null,
    result: row.result_json ? JSON.parse(row.result_json as string) : null,
  };
}

export function hashPayload(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function createApproval(input: {
  projectId: string;
  connectionId: string;
  agentRunId: string;
  actionType: ApprovalActionType;
  repoFullName: string;
  targetBranch?: string | null;
  sourceBranch?: string | null;
  payload: Record<string, unknown>;
  reason?: string | null;
  reversible: boolean;
}): GitHubApproval {
  const db = getDb();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
  const payloadHash = hashPayload(input.payload);

  db.prepare(
    `INSERT INTO github_approvals
       (id, project_id, connection_id, agent_run_id, action_type, repo_full_name, target_branch, source_branch, payload_json, payload_hash, reason, reversible, status, created_at, expires_at, decided_at, executed_at, result_json)
     VALUES
       (@id, @projectId, @connectionId, @agentRunId, @actionType, @repoFullName, @targetBranch, @sourceBranch, @payloadJson, @payloadHash, @reason, @reversible, 'pending', @createdAt, @expiresAt, NULL, NULL, NULL)`,
  ).run({
    id,
    projectId: input.projectId,
    connectionId: input.connectionId,
    agentRunId: input.agentRunId,
    actionType: input.actionType,
    repoFullName: input.repoFullName,
    targetBranch: input.targetBranch ?? null,
    sourceBranch: input.sourceBranch ?? null,
    payloadJson: JSON.stringify(input.payload),
    payloadHash,
    reason: input.reason ?? null,
    reversible: input.reversible ? 1 : 0,
    createdAt,
    expiresAt,
  });

  return {
    id,
    projectId: input.projectId,
    connectionId: input.connectionId,
    agentRunId: input.agentRunId,
    actionType: input.actionType,
    repoFullName: input.repoFullName,
    targetBranch: input.targetBranch ?? null,
    sourceBranch: input.sourceBranch ?? null,
    payload: input.payload,
    payloadHash,
    reason: input.reason ?? null,
    reversible: input.reversible,
    status: "pending",
    createdAt,
    expiresAt,
    decidedAt: null,
    executedAt: null,
    result: null,
  };
}

/** Always scoped to a project - never trust an approval id alone (cross-project lookup returns null). */
export function getApproval(id: string, projectId: string): GitHubApproval | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM github_approvals WHERE id = ? AND project_id = ?`).get(id, projectId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const approval = rowToApproval(row);
  if (approval.status === "pending" && new Date(approval.expiresAt).getTime() < Date.now()) {
    db.prepare(`UPDATE github_approvals SET status = 'expired' WHERE id = ?`).run(id);
    return { ...approval, status: "expired" };
  }
  return approval;
}

export function listApprovalsForRun(agentRunId: string, projectId: string): GitHubApproval[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM github_approvals WHERE agent_run_id = ? AND project_id = ? ORDER BY created_at ASC`)
    .all(agentRunId, projectId) as Record<string, unknown>[];
  return rows.map(rowToApproval);
}

export function listApprovalsForProject(projectId: string): GitHubApproval[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM github_approvals WHERE project_id = ? ORDER BY created_at DESC`)
    .all(projectId) as Record<string, unknown>[];
  return rows.map(rowToApproval);
}

export class ApprovalStateError extends Error {}

/** Transitions pending -> approved|rejected. Rejects anything not currently pending (no re-deciding, no double-approving). */
export function decideApproval(id: string, projectId: string, decision: "approved" | "rejected"): GitHubApproval {
  const approval = getApproval(id, projectId);
  if (!approval) throw new ApprovalStateError("Approval not found.");
  if (approval.status !== "pending") {
    throw new ApprovalStateError(`Approval is not pending (status: ${approval.status}).`);
  }
  const db = getDb();
  const decidedAt = new Date().toISOString();
  db.prepare(`UPDATE github_approvals SET status = ?, decided_at = ? WHERE id = ?`).run(decision, decidedAt, id);
  return { ...approval, status: decision, decidedAt };
}

/**
 * Transitions approved -> executed, exactly once, recording the result.
 * Throws if the approval isn't in 'approved' state - this is what makes
 * replay impossible: an already-executed (or never-approved) row can never
 * be executed again.
 */
export function markExecuted(id: string, projectId: string, result: Record<string, unknown>): GitHubApproval {
  const approval = getApproval(id, projectId);
  if (!approval) throw new ApprovalStateError("Approval not found.");
  if (approval.status !== "approved") {
    throw new ApprovalStateError(`Approval is not in an executable state (status: ${approval.status}).`);
  }
  const db = getDb();
  const executedAt = new Date().toISOString();
  db.prepare(`UPDATE github_approvals SET status = 'executed', executed_at = ?, result_json = ? WHERE id = ?`).run(
    executedAt,
    JSON.stringify(result),
    id,
  );
  return { ...approval, status: "executed", executedAt, result };
}
