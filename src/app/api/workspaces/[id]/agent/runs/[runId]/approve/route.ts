import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/workspaces/agent/adapters/registry";
import { agentErrorResponse, assertProjectExists, loadOwnedRun } from "@/lib/workspaces/agent/routeHelpers";
import { trackEvent } from "@/lib/analytics/trackEvent";
import { LOCAL_DEV_USER_ID } from "@/lib/identity";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  try {
    const workspaceRoot = await assertProjectExists(id);
    const run = loadOwnedRun(id, runId);

    if (run.phase !== "awaiting_approval") {
      return NextResponse.json({ error: `Run is not awaiting approval (phase: ${run.phase}).` }, { status: 409 });
    }

    trackEvent("agent_plan_approved", {
      userId: LOCAL_DEV_USER_ID,
      orgId: null,
      projectId: id,
      agentRunId: runId,
      provider: run.provider,
      durationSeconds: (Date.now() - new Date(run.updatedAt).getTime()) / 1000,
    });
    trackEvent("agent_run_started", {
      userId: LOCAL_DEV_USER_ID,
      orgId: null,
      projectId: id,
      agentRunId: runId,
      provider: run.provider,
      runType: "apply",
    });

    const adapter = getAdapter(run.provider);
    void adapter.executeApprovedPlan({ runId, projectId: id, workspaceRoot });
    return NextResponse.json({ run: { ...run, phase: "applying" } });
  } catch (err) {
    return agentErrorResponse(err);
  }
}
