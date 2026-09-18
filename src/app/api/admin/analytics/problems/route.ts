import { NextResponse } from "next/server";
import { topProblemThemes } from "@/lib/feedback";

export async function GET() {
  return NextResponse.json({ themes: topProblemThemes() });
}
