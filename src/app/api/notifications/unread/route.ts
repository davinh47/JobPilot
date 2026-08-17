import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/current-user";
import { agentRuns, notifications } from "@/db/schema";
import { notificationDestination } from "@/lib/notification-destination";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ count: 0, latest: null });
  const latest = await db.select({
    id: notifications.id,
    notificationType: notifications.notificationType,
    titleZh: notifications.titleZh,
    titleEn: notifications.titleEn,
    bodyZh: notifications.bodyZh,
    bodyEn: notifications.bodyEn,
    entityType: notifications.entityType,
    entityId: notifications.entityId,
    count: sql<number>`count(*) over()`,
    runEntityType: agentRuns.entityType,
    runEntityId: agentRuns.entityId,
  })
    .from(notifications)
    .leftJoin(agentRuns, and(eq(agentRuns.id, notifications.entityId), eq(agentRuns.userId, user.id)))
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)))
    .orderBy(desc(notifications.createdAt))
    .limit(1)
    .get();
  if (!latest) return NextResponse.json({ count: 0, latest: null });

  const href = notificationDestination({
    notificationType: latest.notificationType,
    entityType: latest.entityType,
    entityId: latest.entityId,
    runEntityType: latest.runEntityType,
    runEntityId: latest.runEntityId,
  });

  return NextResponse.json({
    count: Number(latest.count ?? 0),
    latest: {
      id: latest.id,
      titleZh: latest.titleZh,
      titleEn: latest.titleEn,
      bodyZh: latest.bodyZh,
      bodyEn: latest.bodyEn,
      href,
    },
  });
}
