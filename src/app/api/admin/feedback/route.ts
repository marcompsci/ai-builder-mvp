import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/identity";
import { listFeedback, type FeedbackFilter } from "@/lib/feedback";

export async function GET(request: Request) {
  // Admin surfaces expose other testers' free-text feedback; gate them.
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const url = new URL(request.url);
  const filter: FeedbackFilter = {};
  const kind = url.searchParams.get("kind");
  if (kind === "post_run_success" || kind === "post_run_failure") filter.kind = kind;
  const rating = url.searchParams.get("rating");
  if (rating) filter.rating = Number(rating);
  const since = url.searchParams.get("since");
  if (since) filter.since = since;
  const until = url.searchParams.get("until");
  if (until) filter.until = until;

  return NextResponse.json({ feedback: listFeedback(filter) });
}
