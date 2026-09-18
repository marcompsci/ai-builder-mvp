import { NextResponse } from "next/server";
import { buildProjectZip } from "@/lib/workspaces/git/download";
import { workspaceErrorResponse } from "@/lib/workspaces/httpErrors";
import { assertProjectExists } from "@/lib/workspaces/agent/routeHelpers";
import { getProjectEntry } from "@/lib/workspaces/store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const workspaceRoot = await assertProjectExists(id);
    const entry = await getProjectEntry(id);
    const zip = await buildProjectZip(workspaceRoot);
    const filename = `${(entry?.name ?? id).replace(/[^a-zA-Z0-9._-]+/g, "-")}.zip`;

    return new NextResponse(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
