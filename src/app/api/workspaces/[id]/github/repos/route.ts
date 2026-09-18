import { NextResponse } from "next/server";
import { getInstallationOctokit, GitHubConfigError } from "@/lib/github/appAuth";
import { getConnectionForProject } from "@/lib/github/connections";
import { assertProjectExists } from "@/lib/workspaces/agent/routeHelpers";
import { workspaceErrorResponse } from "@/lib/workspaces/httpErrors";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await assertProjectExists(id);
    const connection = getConnectionForProject(id);
    if (!connection) {
      return NextResponse.json({ error: "No GitHub connection for this project." }, { status: 404 });
    }

    const octokit = getInstallationOctokit(connection.installationId);
    const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({ per_page: 100 });
    const repos = data.repositories.map((r) => ({
      fullName: r.full_name,
      private: r.private,
      defaultBranch: r.default_branch,
    }));
    return NextResponse.json({ repos });
  } catch (err) {
    if (err instanceof GitHubConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return workspaceErrorResponse(err);
  }
}
