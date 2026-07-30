import { NextResponse } from "next/server";
import { runWorkerOnce, scheduleDueJobs } from "@/worker/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  await scheduleDueJobs();
  const completed = [];
  while (Date.now() - startedAt < 180_000) {
    const result = await runWorkerOnce();
    if (!result) break;
    completed.push({ id: result.id, status: result.status });
  }
  return NextResponse.json({ ok: true, completed, elapsedMs: Date.now() - startedAt });
}
