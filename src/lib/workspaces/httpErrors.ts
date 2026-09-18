import { NextResponse } from "next/server";
import { WorkspaceNotFoundError, WorkspacePathError } from "./paths";

export function workspaceErrorResponse(err: unknown): NextResponse {
  if (err instanceof WorkspaceNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof WorkspacePathError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}
