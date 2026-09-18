"use client";

import type { ClientViewEventName } from "./events";

/**
 * Browser-side beacon for the small fixed set of client-observed events
 * (see CLIENT_VIEW_EVENT_NAMES). Fire-and-forget, never awaited by
 * callers, never throws into the UI it's instrumenting.
 */
export function trackClientEvent(
  eventName: ClientViewEventName,
  props: { projectId?: string; agentRunId?: string; provider?: "claude-code" | "codex"; filesViewedCount?: number } = {},
): void {
  try {
    void fetch("/api/analytics/view-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventName, ...props }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // never let an analytics beacon throw into the calling component
  }
}
