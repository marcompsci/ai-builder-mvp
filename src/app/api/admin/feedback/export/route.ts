import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/identity";
import { feedbackToCsv, listFeedback } from "@/lib/feedback";

export async function GET() {
  // Admin surfaces expose other testers' free-text feedback; gate them.
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const csv = feedbackToCsv(listFeedback());
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=feedback-export.csv",
    },
  });
}
