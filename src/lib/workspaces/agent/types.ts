import type { AgentRun, Provider } from "./runStore";

export type { Provider };

export interface CreatePlanContext {
  runId: string;
  projectId: string;
  workspaceRoot: string;
  request: string;
}

export interface ExecuteApprovedPlanContext {
  runId: string;
  projectId: string;
  workspaceRoot: string;
}

/**
 * Provider-neutral coding-agent contract. One run system, two adapters -
 * every route/UI piece talks to this interface, never to a specific SDK.
 * `cancelRun`/`getRunStatus` are typically thin wrappers around the shared
 * runStore (cancellation/status is our own bookkeeping, not provider
 * session state); `createPlan`/`executeApprovedPlan` are where the two
 * providers actually differ.
 */
export interface CodingAgent {
  readonly provider: Provider;
  createPlan(ctx: CreatePlanContext): Promise<void>;
  executeApprovedPlan(ctx: ExecuteApprovedPlanContext): Promise<void>;
  cancelRun(runId: string): void;
  getRunStatus(runId: string): AgentRun | null;
}
