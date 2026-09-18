import { NextResponse } from "next/server";
import { createProject } from "@/lib/workspaces/create";
import { InvalidProjectNameError } from "@/lib/workspaces/sanitize";
import { listProjects } from "@/lib/workspaces/store";
import { trackEvent } from "@/lib/analytics/trackEvent";
import { LOCAL_DEV_USER_ID } from "@/lib/identity";

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const name = (body as { name?: unknown })?.name;

  try {
    const project = await createProject(name);
    trackEvent("project_created", {
      userId: LOCAL_DEV_USER_ID,
      orgId: null,
      projectId: project.id,
      projectType: project.templateVersion,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    if (err instanceof InvalidProjectNameError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not create the project." }, { status: 500 });
  }
}
