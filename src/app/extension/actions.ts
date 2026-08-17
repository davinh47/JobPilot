"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { rotateExtensionPairingToken } from "@/lib/secrets";

export async function rotateExtensionPairingTokenAction() {
  const user = await getCurrentUser();
  if (!user) return;
  await rotateExtensionPairingToken(user.id);
  revalidatePath("/extension");
}
