import { NextResponse } from "next/server";
import { getConnectionForProject, createExport, updateExport } from "@/lib/github/connections";
import { exportRequestSchema } from "@/lib/github/exportRequestSchema";
import { pushProjectToGitHub, GitHubPushError } from "@/lib/github/push";
import { GitHubConfigError } from "@/lib/github/appAuth";
import { assertProjectExists } from "@/lib/workspaces/agent/routeHelpers";
import { workspaceErrorResponse } from "@/lib/workspaces/httpErrors";
import { trackEvent } from "@/lib/analytics/trackEvent";
import { currentUserId } from "@/lib/identity";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = exportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;
  if (input.mode === "existing" && !input.repoFullName) {
    return NextResponse.json({ error: "repoFullName is required when mode is 'existing'." }, { status: 400 });
  }
  if (input.mode === "create_new" && !input.newRepoName) {
    return NextResponse.json({ error: "newRepoName is required when mode is 'create_new'." }, { status: 400 });
  }

  try {
    const workspaceRoot = await assertProjectExists(id);
    const connection = getConnectionForProject(id);
    if (!connection) {
      return NextResponse.json({ error: "Connect GitHub for this project first." }, { status: 409 });
    }

    const exportRecord = createExport({
      projectId: id,
      connectionId: connection.id,
      repoFullName: input.mode === "existing" ? input.repoFullName! : `${connection.githubLogin}/${input.newRepoName}`,
      branch: input.branch,
      mode: input.mode,
    });

    trackEvent("github_export_started", { userId: userId, orgId: null, projectId: id, mode: input.mode });

    void (async () => {
      updateExport(exportRecord.id, { status: "pushing" });
      try {
        const result = await pushProjectToGitHub({
          workspaceRoot,
          installationId: connection.installationId,
          installationAccountType: connection.installationAccountType,
          installationLogin: connection.githubLogin,
          mode: input.mode,
          repoFullName: input.repoFullName,
          newRepoName: input.newRepoName,
          branch: input.branch,
        });
        updateExport(exportRecord.id, {
          status: "succeeded",
          commitSha: result.commitSha,
          completedAt: new Date().toISOString(),
        });
        trackEvent("github_export_completed", { userId: userId, orgId: null, projectId: id, mode: input.mode, success: true });
      } catch (err) {
        updateExport(exportRecord.id, {
          status: "failed",
          errorMessage: err instanceof GitHubPushError ? err.message : "Export failed.",
          completedAt: new Date().toISOString(),
        });
        trackEvent("github_export_completed", { userId: userId, orgId: null, projectId: id, mode: input.mode, success: false });
      }
    })();

    return NextResponse.json({ export: exportRecord }, { status: 201 });
  } catch (err) {
    if (err instanceof GitHubConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return workspaceErrorResponse(err);
  }
}
