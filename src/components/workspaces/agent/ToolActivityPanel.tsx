import type { AgentEvent } from "@/lib/workspaces/agent/events";

interface ToolActivityEntry {
  tool: string;
  path?: string;
  decision: "allow" | "deny" | "pending";
  reason?: string;
  status: "read" | "write" | "command" | "github-read" | "github-propose";
  timestamp: string;
}

const TOOL_EVENT_TYPES = new Set([
  "file_read",
  "file_write",
  "github_read",
  "github_propose_action",
  "command_started",
  "command_completed",
]);

function toEntry(event: AgentEvent): ToolActivityEntry | null {
  if (!TOOL_EVENT_TYPES.has(event.type)) return null;
  const data = event.data as { tool?: string; path?: string; decision?: string; reason?: string; command?: string } | undefined;

  const status =
    event.type === "file_write"
      ? "write"
      : event.type === "file_read"
        ? "read"
        : event.type === "github_propose_action"
          ? "github-propose"
          : event.type === "github_read"
            ? "github-read"
            : "command";

  return {
    tool: data?.tool ?? data?.command ?? event.type,
    path: data?.path,
    decision: data?.decision === "deny" ? "deny" : data?.decision === "allow" ? "allow" : "pending",
    reason: data?.reason,
    status,
    timestamp: event.timestamp,
  };
}

const STATUS_LABELS: Record<ToolActivityEntry["status"], string> = {
  read: "file read",
  write: "file write",
  command: "command",
  "github-read": "GitHub read",
  "github-propose": "GitHub action proposed",
};

/**
 * Shows exactly which Project Files MCP tool calls happened during a run -
 * which tool, which path, whether it was allowed or blocked, why, and the
 * result status. Deliberately never renders event.data.content or any
 * other field that could carry file content - only tool/path/decision/
 * reason/status, matching what the MCP audit log itself stores.
 */
export function ToolActivityPanel({ events }: { events: AgentEvent[] }) {
  const entries = events.map(toEntry).filter((e): e is ToolActivityEntry => e !== null);

  if (entries.length === 0) {
    return <p className="text-sm text-neutral-400 dark:text-neutral-600">No tool calls yet.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {entries.map((entry, i) => (
        <div
          key={i}
          className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-xs ${
            entry.decision === "deny"
              ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950"
              : "border-neutral-200 dark:border-neutral-800"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-neutral-700 dark:text-neutral-300">{entry.tool}</span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                entry.decision === "deny"
                  ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                  : entry.decision === "allow"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                    : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
              }`}
            >
              {entry.decision === "deny" ? "blocked" : entry.decision === "allow" ? "allowed" : "requested"}
            </span>
          </div>
          <span className="text-neutral-400 dark:text-neutral-500">{STATUS_LABELS[entry.status]}</span>
          {entry.path && <span className="text-neutral-500 dark:text-neutral-400">{entry.path}</span>}
          {entry.status === "github-propose" && entry.decision === "allow" && (
            <span className="text-amber-700 dark:text-amber-400">
              Created a pending approval - nothing on GitHub happened yet. See the GitHub Actions panel to review it.
            </span>
          )}
          {entry.reason && <span className="text-red-600 dark:text-red-400">{entry.reason}</span>}
        </div>
      ))}
    </div>
  );
}
