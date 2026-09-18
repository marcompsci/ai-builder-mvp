import { NextResponse } from "next/server";
import { getApproval } from "@/lib/github/approvals";
import { assertProjectExists } from "@/lib/workspaces/agent/routeHelpers";
import { workspaceErrorResponse } from "@/lib/workspaces/httpErrors";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; approvalId: string }> }) {
  const { id, approvalId } = await params;
  try {
    await assertProjectExists(id);
    const approval = getApproval(approvalId, id);
    if (!approval) {
      return NextResponse.json({ error: "Approval not found." }, { status: 404 });
    }
    return NextResponse.json({ approval });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
