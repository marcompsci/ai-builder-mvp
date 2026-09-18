import { NextResponse } from "next/server";
import { restoreToCommit } from "@/lib/workspaces/git/checkpoint";
import { agentErrorResponse, assertProjectExists, loadOwnedRun } from "@/lib/workspaces/agent/routeHelpers";
import { updateRun } from "@/lib/workspaces/agent/runStore";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  try {
    const workspaceRoot = await assertProjectExists(id);
    const run = loadOwnedRun(id, runId);

    if (run.phase !== "failed" || !run.checkpointSha) {
      return NextResponse.json({ error: "This run has nothing to revert." }, { status: 409 });
    }

    const { backupSha, restoreSha } = await restoreToCommit(workspaceRoot, run.checkpointSha);
    updateRun(runId, { phase: "cancelled" });
    return NextResponse.json({ backupSha, restoreSha });
  } catch (err) {
    return agentErrorResponse(err);
  }
}
