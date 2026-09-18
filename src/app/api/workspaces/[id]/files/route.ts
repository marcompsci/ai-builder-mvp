import { NextResponse } from "next/server";
import { buildFileTree } from "@/lib/workspaces/fsTree";
import { workspaceErrorResponse } from "@/lib/workspaces/httpErrors";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const tree = await buildFileTree(id);
    return NextResponse.json({ tree });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
