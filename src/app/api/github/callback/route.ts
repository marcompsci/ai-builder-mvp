import { NextResponse } from "next/server";
import { getAppOctokit, GitHubConfigError } from "@/lib/github/appAuth";
import { saveConnection } from "@/lib/github/connections";
import { InvalidStateError, verifyState } from "@/lib/github/state";
import { trackEvent } from "@/lib/analytics/trackEvent";
import { LOCAL_DEV_USER_ID } from "@/lib/identity";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const installationId = url.searchParams.get("installation_id");
  const state = url.searchParams.get("state");

  if (!installationId || !state) {
    return NextResponse.json({ error: "Missing installation_id or state." }, { status: 400 });
  }

  let projectId: string;
  try {
    projectId = verifyState(state);
  } catch (err) {
    const message = err instanceof InvalidStateError ? err.message : "Invalid state.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const appOctokit = getAppOctokit();
    const { data: installation } = await appOctokit.rest.apps.getInstallation({
      installation_id: Number(installationId),
    });

    const account = installation.account;
    const login = account && "login" in account ? account.login : (account && "slug" in account ? account.slug : "unknown");
    const accountType = account && "type" in account ? account.type : null;

    saveConnection({
      projectId,
      githubLogin: login ?? "unknown",
      installationId,
      installationAccountType: accountType ?? null,
    });
    trackEvent("github_connected", {
      userId: LOCAL_DEV_USER_ID,
      orgId: null,
      projectId,
      installationAccountType: accountType === "Organization" ? "organization" : "personal",
    });

    return NextResponse.redirect(new URL(`/workspaces?project=${encodeURIComponent(projectId)}&github=connected`, request.url));
  } catch (err) {
    if (err instanceof GitHubConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: "Could not complete the GitHub connection." }, { status: 500 });
  }
}
