import type { AgentPlan } from "./planSchema";
import { type AgentEvent, type AgentEventType, makeEvent } from "./events";

export const PROVIDERS = ["claude-code", "codex"] as const;
export type Provider = (typeof PROVIDERS)[number];

export type RunPhase =
  | "planning"
  | "awaiting_approval"
  | "applying"
  | "validating"
  | "complete"
  | "failed"
  | "cancelled";

export interface FileDiff {
  path: string;
  before: string | null; // null = file did not exist before
  after: string | null; // null = file was deleted
  unifiedDiff: string;
}

export interface ValidationCommandResult {
  label: string;
  command: string;
  passed: boolean;
  output: string;
}

export interface AgentRun {
  id: string;
  projectId: string;
  provider: Provider;
  phase: RunPhase;
  request: string;
  plan: AgentPlan | null;
  planRawText: string | null;
  error: string | null;
  checkpointSha: string | null;
  commitSha: string | null;
  diffs: FileDiff[] | null;
  validation: ValidationCommandResult[] | null;
  createdAt: string;
  updatedAt: string;
  cancelRequested: boolean;
}

interface InternalRun extends AgentRun {
  events: AgentEvent[];
  subscribers: Set<(event: AgentEvent) => void>;
}

const runs = new Map<string, InternalRun>();

export function createRun(id: string, projectId: string, request: string, provider: Provider): AgentRun {
  const now = new Date().toISOString();
  const run: InternalRun = {
    id,
    projectId,
    provider,
    phase: "planning",
    request,
    plan: null,
    planRawText: null,
    error: null,
    checkpointSha: null,
    commitSha: null,
    diffs: null,
    validation: null,
    createdAt: now,
    updatedAt: now,
    cancelRequested: false,
    events: [],
    subscribers: new Set(),
  };
  runs.set(id, run);
  return toPublic(run);
}

function toPublic(run: InternalRun): AgentRun {
  return {
    id: run.id,
    projectId: run.projectId,
    provider: run.provider,
    phase: run.phase,
    request: run.request,
    plan: run.plan,
    planRawText: run.planRawText,
    error: run.error,
    checkpointSha: run.checkpointSha,
    commitSha: run.commitSha,
    diffs: run.diffs,
    validation: run.validation,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    cancelRequested: run.cancelRequested,
  };
}

export function getRun(id: string): AgentRun | null {
  const run = runs.get(id);
  return run ? toPublic(run) : null;
}

export function getRunEvents(id: string): AgentEvent[] {
  return runs.get(id)?.events ?? [];
}

export function emit(id: string, type: AgentEventType, data?: Record<string, unknown>): void {
  const run = runs.get(id);
  if (!run) return;
  const event = makeEvent(id, type, data);
  run.events.push(event);
  run.updatedAt = event.timestamp;
  for (const sub of run.subscribers) sub(event);
}

export function subscribe(id: string, listener: (event: AgentEvent) => void): () => void {
  const run = runs.get(id);
  if (!run) return () => {};
  run.subscribers.add(listener);
  return () => run.subscribers.delete(listener);
}

export function updateRun(id: string, patch: Partial<Omit<InternalRun, "id" | "events" | "subscribers">>): void {
  const run = runs.get(id);
  if (!run) return;
  Object.assign(run, patch, { updatedAt: new Date().toISOString() });
}

export function requestCancel(id: string): boolean {
  const run = runs.get(id);
  if (!run) return false;
  run.cancelRequested = true;
  return true;
}
