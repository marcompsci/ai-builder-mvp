export const AGENT_EVENT_TYPES = [
  "run_started",
  "context_loaded",
  "plan_created",
  "approval_required",
  "file_read",
  "file_write",
  "github_read",
  "github_propose_action",
  "command_started",
  "command_completed",
  "validation_started",
  "validation_completed",
  "diff_ready",
  "snapshot_created",
  "run_completed",
  "run_failed",
  "run_cancelled",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export interface AgentEvent {
  type: AgentEventType;
  runId: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export function makeEvent(runId: string, type: AgentEventType, data?: Record<string, unknown>): AgentEvent {
  return { type, runId, timestamp: new Date().toISOString(), data };
}
