import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/identity";
import { topProblemThemes } from "@/lib/feedback";

export async function GET() {
  // Admin surfaces expose other testers' free-text feedback; gate them.
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  return NextResponse.json({ themes: topProblemThemes() });
}
