import { db } from "@/db";
import { isCloudDeployment } from "@/lib/deployment";

type BatchQuery = Parameters<typeof db.batch>[0][number];
type BatchResults<T extends readonly [BatchQuery, ...BatchQuery[]]> = {
  [K in keyof T]: Awaited<T[K]>;
};

export async function queryBatch<const T extends readonly [BatchQuery, ...BatchQuery[]]>(queries: T) {
  const startedAt = Date.now();
  const result = await db.batch(queries) as BatchResults<T>;
  const durationMs = Date.now() - startedAt;
  if (isCloudDeployment && durationMs >= 250) {
    console.info("[JobPilot performance] database batch", { queryCount: queries.length, durationMs });
  }
  return result;
}
