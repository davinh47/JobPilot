import { eq } from "drizzle-orm";
import { db } from "@/db";
import { applicationStatuses, appSettings, candidateProfiles, careerPreferences, users } from "@/db/schema";

export const defaultApplicationStatuses = [
  { slug: "to_apply", labelZh: "待申请", labelEn: "To apply", color: "gray", position: 0 },
  { slug: "applied", labelZh: "已申请", labelEn: "Applied", color: "blue", position: 1 },
  { slug: "interview_pending", labelZh: "待面试", labelEn: "Interview pending", color: "amber", position: 2 },
  { slug: "interviewed", labelZh: "已面试", labelEn: "Interviewed", color: "purple", position: 3 },
  { slug: "offer", labelZh: "Offer", labelEn: "Offer", color: "green", position: 4, isTerminal: true },
  { slug: "declined", labelZh: "Declined", labelEn: "Declined", color: "red", position: 5, isTerminal: true },
] as const;

export async function ensureWorkspaceUser(input: { id: string; email?: string | null; displayName?: string | null }) {
  const existing = await db.select().from(users).where(eq(users.id, input.id)).get();
  if (existing) return existing;
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: input.id,
      displayName: input.displayName?.trim() || input.email?.split("@")[0] || "JobPilot User",
      email: input.email ?? null,
    }).onConflictDoNothing().run();
    await tx.insert(candidateProfiles).values({ userId: input.id }).onConflictDoNothing().run();
    await tx.insert(careerPreferences).values({ userId: input.id }).onConflictDoNothing().run();
    await tx.insert(appSettings).values({ userId: input.id }).onConflictDoNothing().run();
    await tx.insert(applicationStatuses).values(defaultApplicationStatuses.map((item) => ({
      ...item,
      userId: input.id,
      isDefault: true,
    }))).onConflictDoNothing().run();
  });
  const user = await db.select().from(users).where(eq(users.id, input.id)).get();
  if (!user) throw new Error("Unable to initialize the JobPilot account.");
  return user;
}
