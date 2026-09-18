"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@/lib/workspaces/agent/events";
import type { AgentRun, Provider } from "@/lib/workspaces/agent/runStore";
import { trackClientEvent } from "@/lib/analytics/clientTrack";
import { PostRunFeedback } from "@/components/feedback/PostRunFeedback";
import { ActivityLog } from "./ActivityLog";
import { AgentSelector } from "./AgentSelector";
import { DiffViewer } from "./DiffViewer";
import { PlanReview } from "./PlanReview";
import { ToolActivityPanel } from "./ToolActivityPanel";
import { ValidationResults } from "./ValidationResults";

const RELOAD_ON_EVENTS = new Set([
  "plan_created",
  "diff_ready",
  "validation_completed",
  "run_completed",
  "run_failed",
  "run_cancelled",
]);

export function AgentRunPanel({ projectId }: { projectId: string }) {
  const [request, setRequest] = useState("");
  const [provider, setProvider] = useState<Provider>("claude-code");
  const [run, setRun] = useState<AgentRun | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const trackedPlanViewRef = useRef<string | null>(null);
  const trackedDiffViewRef = useRef<string | null>(null);

  function stopStream() {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }

  async function refreshRun(runId: string) {
    const res = await fetch(`/api/workspaces/${projectId}/agent/runs/${runId}`);
    if (res.ok) {
      const data = await res.json();
      setRun(data.run);
    }
  }

  function attachStream(runId: string) {
    stopStream();
    setEvents([]);
    const es = new EventSource(`/api/workspaces/${projectId}/agent/runs/${runId}/events`);
    eventSourceRef.current = es;
    es.onmessage = (msg) => {
      const event: AgentEvent = JSON.parse(msg.data);
      setEvents((prev) => [...prev, event]);
      if (RELOAD_ON_EVENTS.has(event.type)) {
        void refreshRun(runId);
      }
    };
    es.onerror = () => {
      stopStream();
    };
  }

  useEffect(() => stopStream, []);

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!request.trim() || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/workspaces/${projectId}/agent/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: request.trim(), provider }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(typeof data.error === "string" ? data.error : "Could not start the plan.");
        return;
      }
      setRun(data.run);
      attachStream(data.run.id);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!run) return;
    setBusy(true);
    try {
      await fetch(`/api/workspaces/${projectId}/agent/runs/${run.id}/approve`, { method: "POST" });
      await refreshRun(run.id);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!run) return;
    await fetch(`/api/workspaces/${projectId}/agent/runs/${run.id}/cancel`, { method: "POST" });
  }

  async function revert() {
    if (!run) return;
    setBusy(true);
    try {
      await fetch(`/api/workspaces/${projectId}/agent/runs/${run.id}/revert`, { method: "POST" });
      await refreshRun(run.id);
    } finally {
      setBusy(false);
    }
  }

  function startNew() {
    stopStream();
    setRun(null);
    setEvents([]);
    setRequest("");
  }

  function discardPlan() {
    if (run) {
      trackClientEvent("agent_plan_rejected", { projectId, agentRunId: run.id, provider: run.provider });
    }
    startNew();
  }

  const canCancel = run && ["planning", "applying", "validating"].includes(run.phase);
  const isTerminal = run && ["complete", "failed", "cancelled"].includes(run.phase);

  useEffect(() => {
    if (run?.phase === "awaiting_approval" && run.plan && trackedPlanViewRef.current !== run.id) {
      trackedPlanViewRef.current = run.id;
      trackClientEvent("agent_plan_viewed", { projectId, agentRunId: run.id, provider: run.provider });
    }
  }, [run?.phase, run?.plan, run?.id, run?.provider, projectId]);

  useEffect(() => {
    if (run?.diffs && run.diffs.length > 0 && trackedDiffViewRef.current !== run.id) {
      trackedDiffViewRef.current = run.id;
      trackClientEvent("file_diff_viewed", { projectId, agentRunId: run.id, provider: run.provider, filesViewedCount: run.diffs.length });
    }
  }, [run?.diffs, run?.id, run?.provider, projectId]);

  return (
    <div className="flex flex-col gap-4">
      {!run && (
        <form onSubmit={submitRequest} className="flex flex-col gap-4">
          <AgentSelector value={provider} onChange={setProvider} disabled={busy} />

          <label htmlFor="agent-request" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Describe a change
          </label>
          <textarea
            id="agent-request"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="e.g. Change the hero headline to 'Book better coffee'"
            maxLength={2000}
            disabled={busy}
            className="min-h-20 resize-none rounded-lg border border-neutral-200 bg-white p-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-600"
          />
          <button
            type="submit"
            disabled={!request.trim() || busy}
            className="self-start rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            {busy ? "Starting…" : "Generate Plan"}
          </button>
          {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}
        </form>
      )}

      {run && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {run.provider} · {run.phase.replace(/_/g, " ")}
            </span>
            <div className="flex gap-2">
              {canCancel && (
                <button
                  type="button"
                  onClick={cancel}
                  className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
                >
                  Cancel
                </button>
              )}
              {isTerminal && (
                <button
                  type="button"
                  onClick={startNew}
                  className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
                >
                  New request
                </button>
              )}
            </div>
          </div>

          {run.phase === "awaiting_approval" && run.plan && (
            <PlanReview plan={run.plan} onApprove={approve} onDiscard={discardPlan} approving={busy} />
          )}

          {run.phase === "failed" && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
              <p>{run.error ?? "The run failed."}</p>
              {run.checkpointSha && (
                <button
                  type="button"
                  onClick={revert}
                  disabled={busy}
                  className="mt-2 rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900"
                >
                  Revert to before this run
                </button>
              )}
            </div>
          )}

          {run.validation && <ValidationResults results={run.validation} />}
          {run.diffs && <DiffViewer diffs={run.diffs} />}

          {run.phase === "complete" && <PostRunFeedback projectId={projectId} runId={run.id} variant="success" />}
          {run.phase === "failed" && <PostRunFeedback projectId={projectId} runId={run.id} variant="failure" />}

          <div>
            <h4 className="mb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">Tool Activity</h4>
            <p className="mb-1.5 text-[11px] text-neutral-400 dark:text-neutral-600">
              Every Project Files MCP call this run made - allowed or blocked, and why.
            </p>
            <ToolActivityPanel events={events} />
          </div>

          <div>
            <h4 className="mb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">Activity</h4>
            <ActivityLog events={events} />
          </div>
        </div>
      )}
    </div>
  );
}
