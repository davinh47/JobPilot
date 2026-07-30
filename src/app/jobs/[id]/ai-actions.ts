"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { analyzeJobMatchById } from "@/lib/job-match-ai";

export async function analyzeJobMatch(formData: FormData) {
  const id = z.string().uuid().safeParse(formData.get("jobId"));
  if (!id.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  await analyzeJobMatchById(user.id, id.data).catch(() => undefined);
  revalidatePath(`/jobs/${id.data}`);
  revalidatePath("/matches");
}
