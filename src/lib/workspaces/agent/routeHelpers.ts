import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { getProjectRoot, WorkspaceNotFoundError, WorkspacePathError } from "../paths";
import { getRun, type AgentRun } from "./runStore";

export async function assertProjectExists(id: string): Promise<string> {
  const root = getProjectRoot(id); // throws WorkspacePathError if id is malformed
  const exists = await fs
    .access(root)
    .then(() => true)
    .catch(() => false);
  if (!exists) throw new WorkspaceNotFoundError("Project not found");
  return root;
}

/** Loads a run and verifies it actually belongs to this project - never trust runId alone. */
export function loadOwnedRun(projectId: string, runId: string): AgentRun {
  const run = getRun(runId);
  if (!run || run.projectId !== projectId) {
    throw new WorkspaceNotFoundError("Run not found");
  }
  return run;
}

export function agentErrorResponse(err: unknown): NextResponse {
  if (err instanceof WorkspaceNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof WorkspacePathError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}
