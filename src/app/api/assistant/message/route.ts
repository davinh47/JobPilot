import { NextResponse } from "next/server";
import { askJobPilotAssistant } from "@/app/assistant/actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ ok: false, error: "Cross-origin request denied." }, { status: 403 });
  try {
    const input = await request.json() as Parameters<typeof askJobPilotAssistant>[0];
    const result = await askJobPilotAssistant(input);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "The assistant request could not be processed." }, { status: 400 });
  }
}
