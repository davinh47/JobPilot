import { eq } from "drizzle-orm";
import { client, db } from "./index";
import { appSettings, applicationStatuses, candidateProfiles, careerPreferences, users } from "./schema";

const defaultStatuses = [
  { slug: "to_apply", labelZh: "待申请", labelEn: "To apply", color: "gray", position: 0 },
  { slug: "applied", labelZh: "已申请", labelEn: "Applied", color: "blue", position: 1 },
  { slug: "interview_pending", labelZh: "待面试", labelEn: "Interview pending", color: "amber", position: 2 },
  { slug: "interviewed", labelZh: "已面试", labelEn: "Interviewed", color: "purple", position: 3 },
  { slug: "offer", labelZh: "Offer", labelEn: "Offer", color: "green", position: 4, isTerminal: true },
  { slug: "declined", labelZh: "Declined", labelEn: "Declined", color: "red", position: 5, isTerminal: true },
] as const;

async function main() {
  const existing = await db.select().from(users).where(eq(users.displayName, "JobPilot User")).get();

  if (!existing) {
    const user = await db.insert(users).values({ displayName: "JobPilot User" }).returning().get();
    await db.insert(candidateProfiles).values({ userId: user.id }).run();
    await db.insert(careerPreferences).values({ userId: user.id }).run();
    console.log("Created the local JobPilot workspace.");
  } else {
    console.log("Local JobPilot workspace already exists.");
  }

  const user = existing ?? await db.select().from(users).where(eq(users.displayName, "JobPilot User")).get();
  if (user) {
    const status = await db.select().from(applicationStatuses).where(eq(applicationStatuses.userId, user.id)).limit(1).get();
    if (!status) {
      await db.insert(applicationStatuses).values(defaultStatuses.map((item) => ({ ...item, userId: user.id, isDefault: true }))).run();
      console.log("Created default application statuses.");
    }
    const settings = await db.select().from(appSettings).where(eq(appSettings.userId, user.id)).get();
    if (!settings) {
      await db.insert(appSettings).values({ userId: user.id }).run();
      console.log("Created local application settings.");
    }
  }

  client.close();
}

void main();
