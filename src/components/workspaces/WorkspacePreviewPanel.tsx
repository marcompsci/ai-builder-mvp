"use client";

import { useEffect, useRef, useState } from "react";
import type { PreviewState } from "@/lib/workspaces/preview";

type LocalStatus = PreviewState["status"] | "idle";

export function WorkspacePreviewPanel({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<LocalStatus>("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function applyState(state: PreviewState) {
    setStatus(state.status);
    setUrl(state.url ?? null);
    setError(state.error ?? null);
    if (state.status === "ready" || state.status === "error") {
      stopPolling();
    }
  }

  async function pollStatus() {
    try {
      const res = await fetch(`/api/workspaces/${projectId}/preview`);
      const data: PreviewState = await res.json();
      applyState(data);
    } catch {
      setStatus("error");
      setError("Lost connection while checking preview status.");
      stopPolling();
    }
  }

  async function startPreview() {
    setStatus("installing");
    setError(null);
    setUrl(null);
    try {
      const res = await fetch(`/api/workspaces/${projectId}/preview`, { method: "POST" });
      const data: PreviewState = await res.json();
      applyState(data);
      if (data.status !== "ready" && data.status !== "error") {
        pollRef.current = setInterval(pollStatus, 1200);
      }
    } catch {
      setStatus("error");
      setError("Couldn't reach the server to start the preview.");
    }
  }

  // The parent renders this component with key={projectId}, so switching
  // projects fully remounts it with fresh default state instead of needing
  // an effect to reset state on prop change. This effect only handles
  // unmount cleanup.
  useEffect(() => {
    return stopPolling;
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Preview</span>
        {status !== "ready" && (
          <button
            type="button"
            onClick={startPreview}
            disabled={status === "installing" || status === "starting"}
            className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            {status === "installing"
              ? "Installing…"
              : status === "starting"
                ? "Starting…"
                : "Start Preview"}
          </button>
        )}
      </div>

      <div className="flex-1">
        {status === "idle" && (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <p className="text-sm text-neutral-400 dark:text-neutral-600">
              Click &ldquo;Start Preview&rdquo; to run this project locally.
            </p>
          </div>
        )}

        {(status === "installing" || status === "starting") && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-white" />
            <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
              {status === "installing" ? "Installing dependencies…" : "Starting dev server…"}
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-sm font-medium text-red-600 dark:text-red-400">Preview failed</p>
            <p className="max-w-sm text-xs text-neutral-500 dark:text-neutral-400">
              {error ?? "Something went wrong starting the preview."}
            </p>
            <button
              type="button"
              onClick={startPreview}
              className="mt-1 rounded-lg border border-neutral-300 px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
            >
              Try again
            </button>
          </div>
        )}

        {status === "ready" && url && (
          <iframe src={url} title="Project preview" className="h-full w-full border-0" />
        )}
      </div>
    </div>
  );
}
