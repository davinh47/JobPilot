import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { isHttpUrl } from "@/lib/public-web";
import { smartImportJob } from "@/lib/smart-job-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const inputSchema = z.object({
  url: z.string().trim().max(2_000).refine(isHttpUrl),
  locale: z.enum(["zh", "en"]),
});

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ ok: false, error: "Cross-origin request denied." }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Enter a complete job URL." }, { status: 400 });
  try {
    const result = await smartImportJob({ userId: user.id, url: parsed.data.url, source: "url_import" });
    return NextResponse.json({ ok: true, jobId: result.jobId, jobUrl: `/jobs/${result.jobId}` }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const fallback = parsed.data.locale === "zh" ? "无法导入这个岗位页面。" : "Unable to import this job page.";
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : fallback }, { status: 422 });
  }
}
