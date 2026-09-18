import { NextResponse } from "next/server";
import { listVersions } from "@/lib/workspaces/git/history";
import { workspaceErrorResponse } from "@/lib/workspaces/httpErrors";
import { assertProjectExists } from "@/lib/workspaces/agent/routeHelpers";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const workspaceRoot = await assertProjectExists(id);
    const versions = await listVersions(workspaceRoot);
    return NextResponse.json({ versions });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
