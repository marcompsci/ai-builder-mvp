import { NextResponse } from "next/server";
import { getExportForProject } from "@/lib/github/connections";
import { assertProjectExists } from "@/lib/workspaces/agent/routeHelpers";
import { workspaceErrorResponse } from "@/lib/workspaces/httpErrors";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; exportId: string }> }) {
  const { id, exportId } = await params;
  try {
    await assertProjectExists(id);
    const exportRecord = getExportForProject(exportId, id);
    if (!exportRecord) {
      return NextResponse.json({ error: "Export not found." }, { status: 404 });
    }
    return NextResponse.json({ export: exportRecord });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
