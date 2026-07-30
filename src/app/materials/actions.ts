"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { applicationEvents, applications, materials } from "@/db/schema";
import { queueSearchReindex } from "@/lib/background-queue";
import { getCurrentUser } from "@/lib/current-user";

export type MaterialFormState = { error?: string; success?: string };

export async function saveCoverLetter(_: MaterialFormState, formData: FormData): Promise<MaterialFormState> {
  const parsed = z.object({ materialId: z.string().uuid(), title: z.string().trim().min(3).max(160), content: z.string().trim().min(100).max(12_000), locale: z.enum(["zh", "en"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: formData.get("locale") === "en" ? "Check the title and letter content." : "请检查标题和正文内容。" };
  const user = await getCurrentUser();
  if (!user) return { error: parsed.data.locale === "en" ? "Sign in first." : "请先登录。" };
  const material = await db.select().from(materials).where(eq(materials.id, parsed.data.materialId)).get();
  if (!material || material.materialType !== "cover_letter") return { error: parsed.data.locale === "en" ? "Cover letter not found." : "找不到这封求职信。" };
  const application = await db.select().from(applications).where(and(eq(applications.id, material.applicationId), eq(applications.userId, user.id))).get();
  if (!application) return { error: parsed.data.locale === "en" ? "Application not found." : "找不到对应申请。" };
  await db.update(materials).set({ title: parsed.data.title, contentText: parsed.data.content, status: "draft", factCheckStatus: "needs_review", updatedAt: new Date() }).where(eq(materials.id, material.id)).run();
  await queueSearchReindex(application.userId);
  revalidatePath(`/materials/${material.id}`);
  return { success: parsed.data.locale === "en" ? "Draft saved." : "草稿已保存。" };
}

export async function confirmCoverLetter(formData: FormData) {
  const id = z.string().uuid().safeParse(formData.get("materialId"));
  if (!id.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const material = await db.select().from(materials).where(eq(materials.id, id.data)).get();
  if (!material || material.materialType !== "cover_letter") return;
  const application = await db.select().from(applications).where(and(eq(applications.id, material.applicationId), eq(applications.userId, user.id))).get();
  if (!application) return;
  await db.transaction(async (tx) => {
    await tx.update(materials).set({ status: "ready", factCheckStatus: "passed", updatedAt: new Date() }).where(eq(materials.id, material.id)).run();
    await tx.insert(applicationEvents).values({ applicationId: material.applicationId, eventType: "material_added", title: "Cover letter facts confirmed", detailsJson: { materialId: material.id }, actorType: "user" }).run();
  });
  if (application) await queueSearchReindex(application.userId);
  revalidatePath(`/materials/${material.id}`);
}
