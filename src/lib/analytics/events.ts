/**
 * The full product-analytics event taxonomy for Phase 7A. See
 * docs/analytics.md for the full properties reference and privacy
 * boundaries; EVENT_PROPERTY_SCHEMAS in schema.ts is the source of truth
 * for what each event may actually carry.
 */
export const EVENT_NAMES = [
  // Forward-compatible: schema defined now, but NOT called from any route
  // yet - these depend on product flows (invite system, onboarding,
  // project-brief approval) that don't exist in the app today. They fire
  // only once those flows are built (a future, separate phase) - adding a
  // schema entry here is not a commitment to build that flow.
  "beta_invite_sent",
  "beta_invite_accepted",
  "onboarding_started",
  "onboarding_completed",
  "project_brief_approved",

  // Wired in Phase 7A - map onto existing code paths.
  "project_created",
  "agent_selected",
  "agent_run_started",
  "agent_plan_viewed",
  "agent_plan_approved",
  "agent_plan_rejected",
  "agent_run_cancelled",
  "agent_run_completed",
  "agent_run_failed",
  "file_diff_viewed",
  "validation_passed",
  "validation_failed",
  "preview_started",
  "preview_viewed",
  "project_version_restored",
  "github_connected",
  "github_export_started",
  "github_export_completed",
  "mcp_tool_allowed",
  "mcp_tool_denied",
  "feedback_submitted",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/**
 * Event names reachable from a client-side beacon (the view-events route) -
 * every other event is server-emitted only, from the exact server code
 * path that performs the action. Mostly "I saw this" events; also includes
 * agent_plan_rejected, since "Discard" (PlanReview.tsx) has no server call
 * site at all today - it's a purely local state reset.
 */
export const CLIENT_VIEW_EVENT_NAMES = ["agent_plan_viewed", "file_diff_viewed", "preview_viewed", "agent_plan_rejected"] as const;
export type ClientViewEventName = (typeof CLIENT_VIEW_EVENT_NAMES)[number];
