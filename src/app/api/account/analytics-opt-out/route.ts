import { NextResponse } from "next/server";
import { z } from "zod";
import { isOptedOut, setOptedOut } from "@/lib/analytics/optOut";
import { currentUserId } from "@/lib/identity";

export async function GET() {
  const userId = await currentUserId();
  return NextResponse.json({ optedOut: isOptedOut(userId) });
}

const bodySchema = z.object({ optedOut: z.boolean() });

export async function POST(request: Request) {
  const userId = await currentUserId();
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

  setOptedOut(userId, parsed.data.optedOut);
  return NextResponse.json({ optedOut: parsed.data.optedOut });
}
