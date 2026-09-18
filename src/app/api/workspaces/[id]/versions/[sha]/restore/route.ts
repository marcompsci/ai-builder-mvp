import { NextResponse } from "next/server";
import { z } from "zod";
import { restoreToCommit } from "@/lib/workspaces/git/checkpoint";
import { workspaceErrorResponse } from "@/lib/workspaces/httpErrors";
import { assertProjectExists } from "@/lib/workspaces/agent/routeHelpers";

const bodySchema = z.object({ confirm: z.literal(true) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string; sha: string }> }) {
  const { id, sha } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Restoring requires { confirm: true } in the request body." }, { status: 400 });
  }

  try {
    const workspaceRoot = await assertProjectExists(id);
    // restoreToCommit validates `sha` is a real, reachable commit in THIS
    // project's own repo (resolveCommit) before touching anything - a sha
    // from another project's history will not resolve here.
    const { backupSha, restoreSha } = await restoreToCommit(workspaceRoot, sha);
    return NextResponse.json({ backupSha, restoreSha });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
