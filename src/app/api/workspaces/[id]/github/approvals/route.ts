import { NextResponse } from "next/server";
import { listApprovalsForProject, listApprovalsForRun } from "@/lib/github/approvals";
import { assertProjectExists } from "@/lib/workspaces/agent/routeHelpers";
import { workspaceErrorResponse } from "@/lib/workspaces/httpErrors";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await assertProjectExists(id);
    const runId = new URL(request.url).searchParams.get("runId");
    const approvals = runId ? listApprovalsForRun(runId, id) : listApprovalsForProject(id);
    return NextResponse.json({ approvals });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
