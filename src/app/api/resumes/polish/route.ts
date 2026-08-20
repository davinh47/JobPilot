import { NextResponse } from "next/server";
import { polishResumeField } from "@/app/resumes/ai-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ ok: false, error: "Cross-origin request denied." }, { status: 403 });
  try {
    const input = await request.json() as Parameters<typeof polishResumeField>[0];
    const result = await polishResumeField(input);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "The resume field could not be polished." }, { status: 400 });
  }
}
