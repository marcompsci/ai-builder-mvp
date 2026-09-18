import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/workspaces/agent/adapters/registry";
import { agentErrorResponse, assertProjectExists, loadOwnedRun } from "@/lib/workspaces/agent/routeHelpers";

const CANCELLABLE_PHASES = new Set(["planning", "applying", "validating"]);

// agent_run_cancelled fires from pipeline.ts, not here - this route only
// requests cancellation; the pipeline is where it's actually confirmed
// (rolled back to checkpoint), which is the more authoritative moment and
// avoids double-counting the same cancellation in the funnel.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  try {
    await assertProjectExists(id);
    const run = loadOwnedRun(id, runId);

    if (!CANCELLABLE_PHASES.has(run.phase)) {
      return NextResponse.json({ error: `Run cannot be cancelled (phase: ${run.phase}).` }, { status: 409 });
    }

    getAdapter(run.provider).cancelRun(runId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return agentErrorResponse(err);
  }
}
