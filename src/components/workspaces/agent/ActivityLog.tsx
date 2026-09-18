import type { AgentEvent } from "@/lib/workspaces/agent/events";

const LABELS: Record<string, string> = {
  run_started: "Run started",
  context_loaded: "Reading project context",
  plan_created: "Plan created",
  approval_required: "Waiting for approval",
  file_read: "Read file",
  file_write: "Changed file",
  command_started: "Command started",
  command_completed: "Command finished",
  validation_started: "Running validation",
  validation_completed: "Validation finished",
  diff_ready: "Diff ready",
  snapshot_created: "Checkpoint created",
  run_completed: "Run completed",
  run_failed: "Run failed",
  run_cancelled: "Run cancelled",
};

function describe(event: AgentEvent): string {
  const label = LABELS[event.type] ?? event.type;
  const path = (event.data as { path?: string })?.path;
  return path ? `${label}: ${path}` : label;
}

export function ActivityLog({ events }: { events: AgentEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-neutral-400 dark:text-neutral-600">No activity yet.</p>;
  }
  return (
    <ol className="flex flex-col gap-1 text-xs">
      {events.map((event, i) => (
        <li key={i} className="flex gap-2 text-neutral-600 dark:text-neutral-400">
          <span className="shrink-0 tabular-nums text-neutral-400 dark:text-neutral-600">
            {new Date(event.timestamp).toLocaleTimeString()}
          </span>
          <span>{describe(event)}</span>
        </li>
      ))}
    </ol>
  );
}
