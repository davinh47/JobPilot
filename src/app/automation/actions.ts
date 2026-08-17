"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/current-user";
import { appSettings, careerPreferences, companyRecommendations, jobSearchTargets, sourceConnectors } from "@/db/schema";
import { providerSupportsAutomaticDiscovery } from "@/lib/ai-provider-config";
import { queueConnectorRefresh, enqueueBackgroundJob } from "@/lib/background-queue";
import { getLocale } from "@/lib/i18n";

function boardToken(value: string) {
  const trimmed = value.trim().replace(/\/$/, "");
  try {
    const url = new URL(trimmed);
    return url.pathname.split("/").filter(Boolean)[0] ?? "";
  } catch {
    return trimmed;
  }
}

export async function addSourceConnector(formData: FormData) {
  const parsed = z.object({ provider: z.enum(["greenhouse", "lever", "ashby"]), name: z.string().trim().min(2).max(100), board: z.string().trim().min(1).max(300), region: z.enum(["global", "eu"]).default("global") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const token = boardToken(parsed.data.board);
  if (!token) return;
  await db.insert(sourceConnectors).values({ userId: user.id, provider: parsed.data.provider, name: parsed.data.name, boardToken: token, region: parsed.data.region }).onConflictDoUpdate({ target: [sourceConnectors.userId, sourceConnectors.provider, sourceConnectors.boardToken], set: { name: parsed.data.name, region: parsed.data.region, enabled: true, updatedAt: new Date() } }).run();
  revalidatePath("/automation");
}

export async function toggleSourceConnector(formData: FormData) {
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const connector = await db.select().from(sourceConnectors).where(and(eq(sourceConnectors.id, id.data), eq(sourceConnectors.userId, user.id))).get();
  if (!connector) return;
  await db.update(sourceConnectors).set({ enabled: !connector.enabled, updatedAt: new Date() }).where(and(eq(sourceConnectors.id, connector.id), eq(sourceConnectors.userId, user.id))).run();
  revalidatePath("/automation");
}

export async function syncSourceNow(formData: FormData) {
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  await queueConnectorRefresh({ userId: user.id, connectorId: id.data });
  revalidatePath("/automation");
  revalidatePath("/matches");
}

export async function syncAllSourcesNow() {
  const user = await getCurrentUser();
  if (!user) return;
  await queueConnectorRefresh({ userId: user.id });
  revalidatePath("/automation");
  revalidatePath("/matches");
}

export async function saveAutomationSettings(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;
  const settings = await db.select().from(appSettings).where(eq(appSettings.userId, user.id)).get();
  const values = { workerEnabled: formData.get("workerEnabled") === "on", notificationsEnabled: formData.get("notificationsEnabled") === "on", updatedAt: new Date() };
  if (settings) await db.update(appSettings).set(values).where(eq(appSettings.id, settings.id)).run();
  else await db.insert(appSettings).values({ userId: user.id, ...values }).run();
  revalidatePath("/automation");
  revalidatePath("/settings");
}

async function discoveryRequirements(userId: string) {
  const [settings, preferences, targets] = await Promise.all([
    db.select().from(appSettings).where(eq(appSettings.userId, userId)).get(),
    db.select().from(careerPreferences).where(eq(careerPreferences.userId, userId)).get(),
    db.select({ id: jobSearchTargets.id }).from(jobSearchTargets).where(eq(jobSearchTargets.userId, userId)).limit(1).all(),
  ]);
  if (!settings?.aiEnabled || !providerSupportsAutomaticDiscovery(settings.aiProvider) || !preferences || (!targets.length && !preferences.targetTitlesJson.length)) return null;
  return { settings, preferences };
}

export async function setDailyDiscoveryEnabled(formData: FormData) {
  const enabled = z.enum(["true", "false"]).safeParse(formData.get("enabled"));
  if (!enabled.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const shouldEnable = enabled.data === "true";
  if (!shouldEnable) {
    await db.update(careerPreferences).set({ searchEnabled: false, updatedAt: new Date() }).where(eq(careerPreferences.userId, user.id)).run();
    revalidatePath("/automation");
    revalidatePath("/matches");
    revalidatePath("/preferences");
    return;
  }
  const requirements = await discoveryRequirements(user.id);
  if (!requirements) return;
  await db.transaction(async (tx) => {
    await tx.update(appSettings).set({ workerEnabled: true, webSearchEnabled: true, updatedAt: new Date() }).where(eq(appSettings.id, requirements.settings.id)).run();
    await tx.update(careerPreferences).set({ searchEnabled: true, updatedAt: new Date() }).where(eq(careerPreferences.id, requirements.preferences.id)).run();
  });
  revalidatePath("/automation");
  revalidatePath("/matches");
  revalidatePath("/preferences");
}

export async function runStandardDiscovery() {
  const user = await getCurrentUser();
  if (!user) return;
  if (!await discoveryRequirements(user.id)) return;
  await enqueueBackgroundJob({ userId: user.id, jobType: "web_job_search", dedupeKey: "manual", payloadJson: { locale: await getLocale() }, priority: 6 });
  revalidatePath("/automation");
  revalidatePath("/matches");
}

export async function runCompanyRecommendations() {
  const user = await getCurrentUser();
  if (!user) return;
  if (!await discoveryRequirements(user.id)) return;
  await enqueueBackgroundJob({ userId: user.id, jobType: "company_recommendations", dedupeKey: "manual", payloadJson: { mode: "recommend", locale: await getLocale() }, priority: 5, maxAttempts: 2 });
  revalidatePath("/automation");
  revalidatePath("/profile");
}

export async function runCompanySourceSetup() {
  const user = await getCurrentUser();
  if (!user) return;
  if (!await discoveryRequirements(user.id)) return;
  await enqueueBackgroundJob({ userId: user.id, jobType: "company_source_setup", dedupeKey: "manual", payloadJson: { mode: "connect", locale: await getLocale() }, priority: 5, maxAttempts: 2 });
  revalidatePath("/automation");
  revalidatePath("/profile");
  revalidatePath("/matches");
}

export async function dismissCompanyRecommendation(formData: FormData) {
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  await db.update(companyRecommendations).set({ status: "dismissed", updatedAt: new Date() }).where(and(eq(companyRecommendations.id, id.data), eq(companyRecommendations.userId, user.id))).run();
  revalidatePath("/automation");
}
