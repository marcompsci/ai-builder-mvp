import { NextResponse } from "next/server";
import { getFunnelSnapshot } from "@/lib/analytics/funnel";

// No dedicated admin-auth layer exists yet (that's Phase 6 scope, not
// this one) - this route carries the same trust assumption the rest of
// the app already has today (single trusted operator), not a new gap.
// See docs/analytics.md.
export async function GET() {
  return NextResponse.json({ funnel: getFunnelSnapshot() });
}
