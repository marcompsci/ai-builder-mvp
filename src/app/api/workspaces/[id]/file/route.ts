import { NextResponse } from "next/server";
import { readWorkspaceFile } from "@/lib/workspaces/fsTree";
import { workspaceErrorResponse } from "@/lib/workspaces/httpErrors";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const relativePath = new URL(request.url).searchParams.get("path");

  if (!relativePath) {
    return NextResponse.json({ error: "Query parameter 'path' is required." }, { status: 400 });
  }

  try {
    const file = await readWorkspaceFile(id, relativePath);
    return NextResponse.json(file);
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
