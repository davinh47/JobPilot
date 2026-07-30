"use server";

import { redirect } from "next/navigation";
import { processAccountDeletion, requestAccountDeletion } from "@/lib/account-deletion";
import { enqueueBackgroundJob } from "@/lib/background-queue";
import { getCurrentUser } from "@/lib/current-user";
import { isCloudDeployment } from "@/lib/deployment";

export async function deleteCloudAccount() {
  if (!isCloudDeployment) return;
  const user = await getCurrentUser();
  if (!user) return;

  await requestAccountDeletion(user.id);
  try {
    await processAccountDeletion(user.id);
  } catch {
    await enqueueBackgroundJob({ userId: user.id, jobType: "account_deletion", dedupeKey: "current", payloadJson: {}, priority: 100, maxAttempts: 10 });
    redirect("/settings?delete_error=1");
  }
  redirect("/login?deleted=1");
}
