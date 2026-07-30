import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/current-user";
import { users } from "@/db/schema";
import { findUserIdByExtensionPairingToken, getOrCreateExtensionPairingToken } from "@/lib/secrets";
import { isCloudDeployment } from "@/lib/deployment";
import { capturedJobHintsSchema, smartImportJob } from "@/lib/smart-job-import";
import { isHttpUrl } from "@/lib/public-web";
import { consumeRateLimit } from "@/lib/rate-limit";

const payloadSchema = z.object({
  url: z.string().max(2_000).refine(isHttpUrl),
  capturedHtml: z.string().max(1_500_000).optional(),
  capturedText: z.string().max(120_000).optional(),
  hints: capturedJobHintsSchema.optional(),
});

const extensionOriginPattern = /^chrome-extension:\/\/[a-p]{32}$/;

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && extensionOriginPattern.test(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
}

function tokenMatches(received: string, expected: string) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);
  if (!origin || !extensionOriginPattern.test(origin)) return NextResponse.json({ error: "Chrome extension origin required." }, { status: 403, headers });
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (isCloudDeployment) {
    const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const [ipLimit, tokenLimit] = await Promise.all([
      consumeRateLimit("extension-import-ip", forwardedFor, { limit: 30, windowMs: 5 * 60_000 }),
      consumeRateLimit("extension-import-token", received || "missing", { limit: 12, windowMs: 60_000 }),
    ]);
    const denied = !ipLimit.allowed ? ipLimit : !tokenLimit.allowed ? tokenLimit : null;
    if (denied) return NextResponse.json(
      { error: "Too many extension requests. Try again shortly." },
      { status: 429, headers: { ...headers, "Retry-After": String(denied.retryAfterSeconds) } },
    );
  }
  const userId = isCloudDeployment ? await findUserIdByExtensionPairingToken(received) : (await getCurrentUser())?.id;
  if (!userId) return NextResponse.json({ error: "Extension pairing token is invalid." }, { status: 401, headers });
  if (!isCloudDeployment) {
    const expected = await getOrCreateExtensionPairingToken(userId);
    if (!tokenMatches(received, expected)) return NextResponse.json({ error: "Extension pairing token is invalid." }, { status: 401, headers });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_750_000) return NextResponse.json({ error: "Captured page data is too large." }, { status: 413, headers });
  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Captured page data is invalid." }, { status: 400, headers });
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return NextResponse.json({ error: "JobPilot is not initialized." }, { status: 503, headers });
  try {
    const result = await smartImportJob({ userId: user.id, ...parsed.data, source: "chrome_extension" });
    return NextResponse.json({ ok: true, jobUrl: `${request.nextUrl.origin}/jobs/${result.jobId}`, ...result }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to import this page." }, { status: 422, headers });
  }
}
