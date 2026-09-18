import { NextResponse } from "next/server";
import { z } from "zod";
import { getInstallationOctokit, GitHubConfigError } from "@/lib/github/appAuth";
import { getConnectionForProject } from "@/lib/github/connections";
import { clearRepoSelection, getRepoSelection, setRepoSelection } from "@/lib/github/repoSelection";
import { assertProjectExists } from "@/lib/workspaces/agent/routeHelpers";
import { workspaceErrorResponse } from "@/lib/workspaces/httpErrors";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await assertProjectExists(id);
    const selection = getRepoSelection(id);
    return NextResponse.json({ selection });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}

const selectRepoSchema = z.object({ repoFullName: z.string().min(1) });

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = selectRepoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    await assertProjectExists(id);
    const connection = getConnectionForProject(id);
    if (!connection) {
      return NextResponse.json({ error: "Connect GitHub for this project first." }, { status: 409 });
    }

    // Never trust repoFullName as given - only allow selecting a repo the
    // installation actually has access to, confirmed by asking GitHub
    // directly (not by trusting anything cached in the browser).
    const octokit = getInstallationOctokit(connection.installationId);
    const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({ per_page: 100 });
    const match = data.repositories.find((r) => r.full_name === parsed.data.repoFullName);
    if (!match) {
      return NextResponse.json({ error: "That repository is not accessible to this installation." }, { status: 403 });
    }

    const selection = setRepoSelection({
      projectId: id,
      connectionId: connection.id,
      repoFullName: match.full_name,
      defaultBranch: match.default_branch,
    });
    return NextResponse.json({ selection });
  } catch (err) {
    if (err instanceof GitHubConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return workspaceErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await assertProjectExists(id);
    clearRepoSelection(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
