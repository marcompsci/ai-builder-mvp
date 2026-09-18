import { NextResponse } from "next/server";
import { z } from "zod";
import { isOptedOut, setOptedOut } from "@/lib/analytics/optOut";
import { LOCAL_DEV_USER_ID } from "@/lib/identity";

export async function GET() {
  return NextResponse.json({ optedOut: isOptedOut(LOCAL_DEV_USER_ID) });
}

const bodySchema = z.object({ optedOut: z.boolean() });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  setOptedOut(LOCAL_DEV_USER_ID, parsed.data.optedOut);
  return NextResponse.json({ optedOut: parsed.data.optedOut });
}
