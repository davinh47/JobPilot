import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { accountDeletionRequests, backgroundJobs, users } from "@/db/schema";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const storagePageSize = 1_000;

async function updateDeletionRequest(
  userId: string,
  values: Partial<typeof accountDeletionRequests.$inferInsert>,
) {
  await db.update(accountDeletionRequests)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(accountDeletionRequests.userId, userId))
    .run();
}

async function deleteAllStoredFiles(userId: string) {
  const supabase = createSupabaseAdminClient();
  const bucket = process.env.SUPABASE_RESUME_BUCKET ?? "resumes";
  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(userId, {
      limit: storagePageSize,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`Unable to list account storage: ${error.message}`);
    const paths = (data ?? []).map((file) => `${userId}/${file.name}`);
    if (!paths.length) return;
    const { error: removalError } = await supabase.storage.from(bucket).remove(paths);
    if (removalError) throw new Error(`Unable to delete account storage: ${removalError.message}`);
    if (paths.length < storagePageSize) return;
  }
}

function authUserIsAlreadyAbsent(message: string) {
  return /user not found|not found|does not exist/i.test(message);
}

export async function requestAccountDeletion(userId: string) {
  const now = new Date();
  await db.insert(accountDeletionRequests).values({
    userId,
    status: "requested",
    currentStep: "requested",
    requestedAt: now,
  }).onConflictDoUpdate({
    target: accountDeletionRequests.userId,
    set: {
      status: "requested",
      currentStep: "requested",
      lastError: null,
      completedAt: null,
      requestedAt: now,
      updatedAt: now,
    },
  }).run();
}

export async function processAccountDeletion(userId: string) {
  const request = await db.select().from(accountDeletionRequests)
    .where(eq(accountDeletionRequests.userId, userId))
    .get();
  if (!request || request.status === "completed") return;

  await updateDeletionRequest(userId, {
    status: "deleting",
    currentStep: "storage",
    attempts: request.attempts + 1,
    lastError: null,
  });

  try {
    await deleteAllStoredFiles(userId);
    await updateDeletionRequest(userId, { currentStep: "auth" });

    const { error: authError } = await createSupabaseAdminClient().auth.admin.deleteUser(userId);
    if (authError && !authUserIsAlreadyAbsent(authError.message)) {
      throw new Error(`Unable to delete the authentication account: ${authError.message}`);
    }

    await updateDeletionRequest(userId, { currentStep: "database" });
    await db.transaction(async (tx) => {
      await tx.delete(backgroundJobs).where(and(
        eq(backgroundJobs.userId, userId),
        ne(backgroundJobs.jobType, "account_deletion"),
      )).run();
      await tx.delete(users).where(eq(users.id, userId)).run();
    });

    await updateDeletionRequest(userId, {
      status: "completed",
      currentStep: "completed",
      completedAt: new Date(),
      lastError: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown account deletion error";
    await updateDeletionRequest(userId, { status: "failed", lastError: message.slice(0, 2_000) });
    throw error;
  }
}
