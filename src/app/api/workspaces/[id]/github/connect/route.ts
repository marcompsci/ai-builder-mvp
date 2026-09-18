import { NextResponse } from "next/server";
import { GitHubConfigError } from "@/lib/github/appAuth";
import { createState } from "@/lib/github/state";
import { assertProjectExists } from "@/lib/workspaces/agent/routeHelpers";
import { workspaceErrorResponse } from "@/lib/workspaces/httpErrors";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await assertProjectExists(id);
    const slug = process.env.GITHUB_APP_SLUG;
    if (!slug) throw new GitHubConfigError("GITHUB_APP_SLUG is not configured. See .env.example.");

    const state = createState(id);
    const url = `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
    return NextResponse.redirect(url);
  } catch (err) {
    if (err instanceof GitHubConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return workspaceErrorResponse(err);
  }
}
