import { NextResponse } from "next/server";
import { generateRequestSchema } from "@/lib/schema";
import { generateSite, GenerationError } from "@/lib/anthropic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsedRequest = generateRequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: "Invalid request.", details: parsedRequest.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const site = await generateSite(parsedRequest.data.prompt, parsedRequest.data.style);
    return NextResponse.json(site, { status: 200 });
  } catch (err) {
    if (err instanceof GenerationError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Something went wrong generating the site." }, { status: 500 });
  }
}
