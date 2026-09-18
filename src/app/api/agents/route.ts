import { NextResponse } from "next/server";
import { getProviderAvailability } from "@/lib/workspaces/agent/availability";

export async function GET() {
  return NextResponse.json({ providers: getProviderAvailability() });
}
