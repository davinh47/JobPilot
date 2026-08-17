"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { checkListing } from "@/lib/listing-check";
import { getCurrentUser } from "@/lib/current-user";

export async function verifyJobListing(formData: FormData) {
  const id = z.string().uuid().safeParse(formData.get("jobId"));
  if (!id.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const ownedJob = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, id.data), eq(jobs.ownerUserId, user.id))).get();
  if (!ownedJob) return;
  await checkListing(id.data);
  revalidatePath(`/jobs/${id.data}`);
  revalidatePath("/matches");
}
