import { NextResponse } from "next/server";
import { agentErrorResponse, assertProjectExists, loadOwnedRun } from "@/lib/workspaces/agent/routeHelpers";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  try {
    await assertProjectExists(id);
    const run = loadOwnedRun(id, runId);
    return NextResponse.json({ run });
  } catch (err) {
    return agentErrorResponse(err);
  }
}
