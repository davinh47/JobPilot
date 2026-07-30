"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/current-user";
import { users } from "@/db/schema";
import { storedLocale } from "@/lib/i18n";

export async function setLocalePreference(value: "zh" | "en") {
  const locale = z.enum(["zh", "en"]).parse(value);
  const store = await cookies();
  store.set("jobpilot_locale", locale, { path: "/", maxAge: 31_536_000, sameSite: "lax" });
  const user = await getCurrentUser();
  if (user) await db.update(users).set({ locale: storedLocale(locale), updatedAt: new Date() }).where(eq(users.id, user.id)).run();
}
