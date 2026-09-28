import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/identity";
import { getFunnelSnapshot } from "@/lib/analytics/funnel";

// Gated by isAdmin(): open on localhost, ADMIN_USER_IDS-only once a
// trusted auth proxy is in front (see src/lib/identity.ts and
// docs/azure-deployment.md). See docs/analytics.md.
export async function GET() {
  // Admin surfaces expose other testers' free-text feedback; gate them.
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  return NextResponse.json({ funnel: getFunnelSnapshot() });
}
