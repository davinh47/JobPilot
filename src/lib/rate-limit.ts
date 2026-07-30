import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiRateLimits } from "@/db/schema";
import { isCloudDeployment, requireCloudEnvironment } from "@/lib/deployment";

type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

function privateRateLimitKey(value: string) {
  const secret = process.env.JOBPILOT_RATE_LIMIT_KEY || requireCloudEnvironment("JOBPILOT_SECRETS_KEY");
  return createHmac("sha256", secret).update(value).digest("hex");
}

export async function consumeRateLimit(scope: string, key: string, options: RateLimitOptions) {
  if (!isCloudDeployment) return { allowed: true, remaining: options.limit, retryAfterSeconds: 0 };
  const now = new Date();
  const keyHash = privateRateLimitKey(`${scope}:${key}`);
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(apiRateLimits)
      .where(and(eq(apiRateLimits.scope, scope), eq(apiRateLimits.keyHash, keyHash)))
      .get();
    if (!existing || existing.expiresAt.getTime() <= now.getTime()) {
      const expiresAt = new Date(now.getTime() + options.windowMs);
      if (existing) {
        await tx.update(apiRateLimits)
          .set({ requestCount: 1, windowStartedAt: now, expiresAt, updatedAt: now })
          .where(eq(apiRateLimits.id, existing.id))
          .run();
      } else {
        await tx.insert(apiRateLimits).values({ scope, keyHash, requestCount: 1, windowStartedAt: now, expiresAt }).run();
      }
      return { allowed: true, remaining: Math.max(0, options.limit - 1), retryAfterSeconds: 0 };
    }
    if (existing.requestCount >= options.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.expiresAt.getTime() - now.getTime()) / 1000)),
      };
    }
    await tx.update(apiRateLimits)
      .set({ requestCount: existing.requestCount + 1, updatedAt: now })
      .where(eq(apiRateLimits.id, existing.id))
      .run();
    return { allowed: true, remaining: Math.max(0, options.limit - existing.requestCount - 1), retryAfterSeconds: 0 };
  });
}
