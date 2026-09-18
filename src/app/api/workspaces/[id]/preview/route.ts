import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { workspaceErrorResponse } from "@/lib/workspaces/httpErrors";
import { getProjectRoot, WorkspaceNotFoundError } from "@/lib/workspaces/paths";
import { ensurePreviewStarted, getPreviewStatus } from "@/lib/workspaces/preview";

async function assertProjectExists(id: string) {
  const root = getProjectRoot(id); // throws WorkspacePathError if id is malformed
  const exists = await fs
    .access(root)
    .then(() => true)
    .catch(() => false);
  if (!exists) throw new WorkspaceNotFoundError("Project not found");
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await assertProjectExists(id);
    const status = ensurePreviewStarted(id);
    return NextResponse.json(status);
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await assertProjectExists(id);
    const status = getPreviewStatus(id) ?? { status: "idle" as const };
    return NextResponse.json(status);
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
