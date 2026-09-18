import { getDb } from "../db";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function countEvent(eventName: string): number {
  const row = getDb().prepare(`SELECT COUNT(*) as c FROM product_events WHERE event_name = ?`).get(eventName) as { c: number };
  return row.c;
}

function distinctUsersWithEvent(eventName: string): number {
  const row = getDb().prepare(`SELECT COUNT(DISTINCT user_id) as c FROM product_events WHERE event_name = ?`).get(eventName) as {
    c: number;
  };
  return row.c;
}

function durationsFor(eventName: string, filterJson?: (props: Record<string, unknown>) => boolean): number[] {
  const rows = getDb().prepare(`SELECT properties_json FROM product_events WHERE event_name = ?`).all(eventName) as {
    properties_json: string;
  }[];
  const out: number[] = [];
  for (const row of rows) {
    const props = JSON.parse(row.properties_json) as Record<string, unknown>;
    if (filterJson && !filterJson(props)) continue;
    if (typeof props.durationSeconds === "number") out.push(props.durationSeconds);
  }
  return out;
}

export interface ProviderBreakdown {
  provider: string;
  runsStarted: number;
  runsCompleted: number;
  runsFailed: number;
  successRate: number | null;
}

export interface FunnelSnapshot {
  // Unavailable until an invite system exists (Phase 6) - the event
  // schema is defined but nothing calls trackEvent for these yet.
  invitedUsers: null;
  inviteAcceptanceRate: null;
  onboardingCompletionRate: null;

  projectsCreated: number;
  firstValidatedRunRate: number | null;
  firstSuccessfulPreviewRate: number | null;
  planApprovalRate: number | null;
  diffReviewRate: number | null;
  githubExportRate: number | null;

  // Technically computable but only reflects the single placeholder
  // user's own activity until real multi-user auth exists - not a
  // meaningful cohort statistic yet. See `note`.
  day1ReturnRate: number | null;
  day7ReturnRate: number | null;
  day30ReturnRate: number | null;

  providerBreakdown: ProviderBreakdown[];
  medianSecondsToFirstPreview: number | null;
  medianSecondsPromptToValidatedBuild: number | null;
  failureReasonsByCategory: { category: string; count: number }[];

  // Not tracked - no cost field exists on agent_run_completed in the
  // approved event schema. Flagged rather than silently omitted.
  estimatedCostPerSuccessfulProject: null;

  note: string;
}

export function getFunnelSnapshot(): FunnelSnapshot {
  const db = getDb();

  const projectsCreated = countEvent("project_created");
  const usersWithProject = distinctUsersWithEvent("project_created");
  const usersWithPassedRun = (() => {
    const rows = db.prepare(`SELECT DISTINCT user_id, properties_json FROM product_events WHERE event_name = 'agent_run_completed'`).all() as {
      user_id: string;
      properties_json: string;
    }[];
    const users = new Set<string>();
    for (const row of rows) {
      const props = JSON.parse(row.properties_json) as { validationResult?: string };
      if (props.validationResult === "passed") users.add(row.user_id);
    }
    return users.size;
  })();

  const usersWithPreview = distinctUsersWithEvent("preview_viewed");

  const planApproved = countEvent("agent_plan_approved");
  const planRejected = countEvent("agent_plan_rejected");
  const planTotal = planApproved + planRejected;

  const runsCompletedOrFailed = countEvent("agent_run_completed") + countEvent("agent_run_failed");
  const diffsViewed = countEvent("file_diff_viewed");

  const exportsCompleted = (() => {
    const rows = db.prepare(`SELECT properties_json FROM product_events WHERE event_name = 'github_export_completed'`).all() as {
      properties_json: string;
    }[];
    return rows.filter((r) => (JSON.parse(r.properties_json) as { success?: boolean }).success).length;
  })();

  const providers = ["claude-code", "codex"] as const;
  const providerBreakdown: ProviderBreakdown[] = providers.map((provider) => {
    const runsStarted = (
      db.prepare(`SELECT COUNT(*) as c FROM product_events WHERE event_name = 'agent_run_started' AND provider = ?`).get(provider) as {
        c: number;
      }
    ).c;
    const runsCompleted = (
      db.prepare(`SELECT COUNT(*) as c FROM product_events WHERE event_name = 'agent_run_completed' AND provider = ?`).get(provider) as {
        c: number;
      }
    ).c;
    const runsFailed = (
      db.prepare(`SELECT COUNT(*) as c FROM product_events WHERE event_name = 'agent_run_failed' AND provider = ?`).get(provider) as {
        c: number;
      }
    ).c;
    const attempted = runsCompleted + runsFailed;
    return { provider, runsStarted, runsCompleted, runsFailed, successRate: attempted > 0 ? runsCompleted / attempted : null };
  });

  const failureRows = db.prepare(`SELECT properties_json FROM product_events WHERE event_name = 'agent_run_failed'`).all() as {
    properties_json: string;
  }[];
  const failureCounts = new Map<string, number>();
  for (const row of failureRows) {
    const props = JSON.parse(row.properties_json) as { errorCategory?: string };
    if (!props.errorCategory) continue;
    failureCounts.set(props.errorCategory, (failureCounts.get(props.errorCategory) ?? 0) + 1);
  }

  return {
    invitedUsers: null,
    inviteAcceptanceRate: null,
    onboardingCompletionRate: null,

    projectsCreated,
    firstValidatedRunRate: usersWithProject > 0 ? usersWithPassedRun / usersWithProject : null,
    firstSuccessfulPreviewRate: usersWithProject > 0 ? usersWithPreview / usersWithProject : null,
    planApprovalRate: planTotal > 0 ? planApproved / planTotal : null,
    diffReviewRate: runsCompletedOrFailed > 0 ? diffsViewed / runsCompletedOrFailed : null,
    githubExportRate: projectsCreated > 0 ? exportsCompleted / projectsCreated : null,

    // Real multi-day return-rate computation needs distinguishable users
    // across real days - not meaningful with today's single placeholder
    // user, so left explicitly unavailable rather than a misleading number.
    day1ReturnRate: null,
    day7ReturnRate: null,
    day30ReturnRate: null,

    providerBreakdown,
    medianSecondsToFirstPreview: median(durationsFor("preview_started")),
    medianSecondsPromptToValidatedBuild: median(
      durationsFor("agent_run_completed", (p) => p.validationResult === "passed"),
    ),
    failureReasonsByCategory: Array.from(failureCounts.entries()).map(([category, count]) => ({ category, count })),

    estimatedCostPerSuccessfulProject: null,

    note:
      "Invite/onboarding metrics and Day N return rates are unavailable in the current single-tenant beta " +
      "(no real multi-user auth exists yet - see Phase 6). Cost-per-project is unavailable because the " +
      "approved event schema has no cost field on agent_run_completed.",
  };
}
