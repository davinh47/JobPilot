"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { generateSearchStrategy, updateSearchChecklistItem } from "@/lib/search-strategy";

export async function generateSearchPlanAction() {
  const user = await getCurrentUser();
  if (!user) return;
  await generateSearchStrategy(user.id).catch(() => undefined);
  revalidatePath("/search-plan");
  revalidatePath("/automation");
}

export async function updateSearchChecklistAction(formData: FormData) {
  const parsed = z.object({
    id: z.string().uuid(),
    status: z.enum(["pending", "checked", "skipped"]),
    resultCount: z.union([z.literal(""), z.coerce.number().int().min(0).max(100_000)]).optional(),
    notes: z.string().trim().max(1000).optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  await updateSearchChecklistItem(user.id, { id: parsed.data.id, status: parsed.data.status, resultCount: parsed.data.resultCount === "" ? null : parsed.data.resultCount, notes: parsed.data.notes });
  revalidatePath("/search-plan");
}
