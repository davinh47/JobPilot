import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getBackgroundQueueState, runWorkerOnce } from "@/worker/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Cross-origin request denied." }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await runWorkerOnce(user.id);
  const queue = await getBackgroundQueueState(user.id);
  return NextResponse.json(
    {
      processed: Boolean(result),
      status: result?.status ?? null,
      pending: queue.pending,
      retryAfterMs: queue.retryAfterMs,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
