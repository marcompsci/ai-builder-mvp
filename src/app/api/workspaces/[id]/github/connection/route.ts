import { NextResponse } from "next/server";
import { deleteConnection, getConnectionForProject } from "@/lib/github/connections";
import { assertProjectExists } from "@/lib/workspaces/agent/routeHelpers";
import { workspaceErrorResponse } from "@/lib/workspaces/httpErrors";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await assertProjectExists(id);
    const connection = getConnectionForProject(id);
    // Never returns token material - there is none to return; connections
    // only ever store the installation id and display metadata.
    return NextResponse.json({ connection });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await assertProjectExists(id);
    const connection = getConnectionForProject(id);
    if (connection) deleteConnection(connection.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
