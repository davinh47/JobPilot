"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/current-user";
import { memories } from "@/db/schema";
import { queueProfileAnalysis, queueSearchReindex } from "@/lib/background-queue";
import { getLocale } from "@/lib/i18n";
import { saveCandidateContext } from "@/lib/profile-analysis";
import { sourceNeedsConfirmation } from "@/lib/source-authority";

export async function addConfirmedMemory(formData: FormData) {
  const parsed = z.object({ memoryType: z.enum(["capability_evidence", "preference", "star_story", "weakness", "goal"]), content: z.string().trim().min(5).max(4000) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  await db.insert(memories).values({ userId: user.id, memoryType: parsed.data.memoryType, content: parsed.data.content, sourceType: "user", sourceId: user.id, confidence: 1, userConfirmed: true }).run();
  await queueSearchReindex(user.id);
  revalidatePath("/profile");
}

export async function toggleMemoryConfirmation(formData: FormData) {
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const memory = await db.select().from(memories).where(and(eq(memories.id, id.data), eq(memories.userId, user.id))).get();
  if (!memory) return;
  if (!sourceNeedsConfirmation(memory.sourceType)) return;
  await db.update(memories).set({ userConfirmed: !memory.userConfirmed, updatedAt: new Date() }).where(and(eq(memories.id, memory.id), eq(memories.userId, user.id))).run();
  await queueSearchReindex(user.id);
  revalidatePath("/profile");
}

export async function saveProfileContextAction(formData: FormData) {
  const context = z.string().trim().max(12_000).safeParse(formData.get("userContext"));
  if (!context.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  await saveCandidateContext(user.id, context.data);
  revalidatePath("/profile");
}

export async function analyzeProfileAction(formData: FormData) {
  const context = z.string().trim().max(12_000).safeParse(formData.get("userContext"));
  if (!context.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  await saveCandidateContext(user.id, context.data);
  const localeValue = formData.get("locale");
  const locale = localeValue === "en" || localeValue === "zh" ? localeValue : await getLocale();
  await queueProfileAnalysis(user.id, locale);
  revalidatePath("/profile");
  revalidatePath("/automation");
}

export async function analyzeProfileFromResumeAction() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await queueProfileAnalysis(user.id, await getLocale());
  revalidatePath("/profile");
  revalidatePath("/automation");
  redirect("/profile?analysis=queued");
}
