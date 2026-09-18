import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/workspaces/agent/adapters/registry";
import { agentErrorResponse, assertProjectExists, loadOwnedRun } from "@/lib/workspaces/agent/routeHelpers";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  try {
    const workspaceRoot = await assertProjectExists(id);
    const run = loadOwnedRun(id, runId);

    if (run.phase !== "awaiting_approval") {
      return NextResponse.json({ error: `Run is not awaiting approval (phase: ${run.phase}).` }, { status: 409 });
    }

    const adapter = getAdapter(run.provider);
    void adapter.executeApprovedPlan({ runId, projectId: id, workspaceRoot });
    return NextResponse.json({ run: { ...run, phase: "applying" } });
  } catch (err) {
    return agentErrorResponse(err);
  }
}
