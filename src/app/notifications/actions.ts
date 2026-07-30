"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/current-user";
import { agentRuns, notifications } from "@/db/schema";
import { notificationDestination } from "@/lib/notification-destination";

function notificationId(formData: FormData) {
  return z.string().uuid().safeParse(formData.get("notificationId"));
}

async function destinationForNotification(notification: typeof notifications.$inferSelect, userId: string) {
  let runEntityType: string | null = null;
  let runEntityId: string | null = null;
  if (notification.entityType === "agent_run" && notification.entityId) {
    const run = await db.select().from(agentRuns).where(and(eq(agentRuns.id, notification.entityId), eq(agentRuns.userId, userId))).get();
    runEntityType = run?.entityType ?? null;
    runEntityId = run?.entityId ?? null;
  }
  return notificationDestination({
    notificationType: notification.notificationType,
    entityType: notification.entityType,
    entityId: notification.entityId,
    runEntityType,
    runEntityId,
  });
}

export async function openNotification(formData: FormData) {
  const id = notificationId(formData);
  if (!id.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const notification = await db.select().from(notifications).where(and(eq(notifications.id, id.data), eq(notifications.userId, user.id))).get();
  if (!notification) return;
  const href = await destinationForNotification(notification, user.id);
  if (!notification.readAt) {
    await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, notification.id)).run();
    revalidatePath("/notifications");
    revalidatePath("/");
  }
  redirect(href);
}

export async function markAllNotificationsRead() {
  const user = await getCurrentUser();
  if (!user) return;
  await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.userId, user.id)).run();
  revalidatePath("/notifications");
  revalidatePath("/");
}

export async function deleteNotification(formData: FormData) {
  const id = notificationId(formData);
  if (!id.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  await db.delete(notifications).where(and(eq(notifications.id, id.data), eq(notifications.userId, user.id))).run();
  revalidatePath("/notifications");
  revalidatePath("/");
}
