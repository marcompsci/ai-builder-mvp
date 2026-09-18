import { z } from "zod";
import type { EventName } from "./events";

// userId required; orgId nullable (no real org model exists yet - see
// src/lib/identity.ts - but the shape is ready for one). project/run/
// provider are nullable where an event doesn't always have one. Every
// event's extra properties below are a CLOSED shape - trackEvent() calls
// .strip() at write time, so any field not listed here (a prompt, file
// content, a token, an env value, free text) is silently dropped, never
// stored. This is an allowlist, the same discipline already used for
// Project Files MCP's extension allowlist and GitHub MCP's tool schemas.
const base = z.object({
  userId: z.string().min(1),
  orgId: z.string().min(1).nullable(),
  projectId: z.string().min(1).nullable().optional(),
  agentRunId: z.string().min(1).nullable().optional(),
  provider: z.enum(["claude-code", "codex"]).nullable().optional(),
});

export const EVENT_PROPERTY_SCHEMAS: Record<EventName, z.ZodObject<z.ZodRawShape>> = {
  beta_invite_sent: base.extend({ inviteId: z.string() }),
  beta_invite_accepted: base.extend({ inviteId: z.string(), timeToAcceptSeconds: z.number().nonnegative() }),
  onboarding_started: base,
  onboarding_completed: base.extend({ durationSeconds: z.number().nonnegative(), stepsCompleted: z.number().int().nonnegative() }),
  project_brief_approved: base.extend({ durationSeconds: z.number().nonnegative() }),

  project_created: base.extend({ projectType: z.string() }),
  agent_selected: base,
  agent_run_started: base.extend({ runType: z.enum(["plan", "apply"]) }),
  agent_plan_viewed: base,
  agent_plan_approved: base.extend({ durationSeconds: z.number().nonnegative() }),
  agent_plan_rejected: base,
  agent_run_cancelled: base.extend({ phase: z.enum(["plan", "apply"]) }),
  agent_run_completed: base.extend({
    durationSeconds: z.number().nonnegative(),
    validationResult: z.enum(["passed", "failed"]),
    filesChangedCount: z.number().int().nonnegative(),
  }),
  agent_run_failed: base.extend({
    durationSeconds: z.number().nonnegative(),
    errorCategory: z.enum(["install_failed", "invalid_plan", "validation_failed", "provider_error", "timeout"]),
  }),
  file_diff_viewed: base.extend({ filesViewedCount: z.number().int().nonnegative() }),
  validation_passed: base.extend({ durationSeconds: z.number().nonnegative() }),
  validation_failed: base.extend({ durationSeconds: z.number().nonnegative(), failedCommands: z.array(z.enum(["lint", "typecheck", "build"])) }),
  preview_started: base.extend({ durationToStartSeconds: z.number().nonnegative() }),
  preview_viewed: base,
  project_version_restored: base,
  github_connected: base.extend({ installationAccountType: z.enum(["organization", "personal"]) }),
  github_export_started: base.extend({ mode: z.enum(["existing", "create_new"]) }),
  github_export_completed: base.extend({ mode: z.enum(["existing", "create_new"]), success: z.boolean() }),
  mcp_tool_allowed: base.extend({ mcpServer: z.enum(["project-files", "github"]), toolName: z.string() }),
  mcp_tool_denied: base.extend({ mcpServer: z.enum(["project-files", "github"]), toolName: z.string() }),
  feedback_submitted: base.extend({
    rating: z.number().int().min(1).max(5).optional(),
    helped: z.enum(["yes", "somewhat", "no"]).optional(),
    wouldUseAgain: z.enum(["yes", "no", "maybe"]).optional(),
    wantsInterview: z.boolean().optional(),
  }),
};

export type EventProperties<T extends EventName> = z.infer<(typeof EVENT_PROPERTY_SCHEMAS)[T]>;
