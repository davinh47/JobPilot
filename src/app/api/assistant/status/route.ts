import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { agentRuns, appSettings } from "@/db/schema";
import { clearAssistantContext, loadAssistantContext, markAssistantContextRead } from "@/lib/assistant-context";
import { getCurrentUser } from "@/lib/current-user";
import { assistantResponseSchema, assistantResumeSyncDraftSchema } from "@/lib/jobpilot-assistant";
import { hasAiProviderKey } from "@/lib/secrets";

export const dynamic = "force-dynamic";

const resumeReferenceSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  versionId: z.string().uuid(),
});

const persistedAssistantResultSchema = z.object({
  response: assistantResponseSchema,
  resume: resumeReferenceSchema.nullable().optional(),
  sync: z.object({
    sourceResume: resumeReferenceSchema.extend({ versionNumber: z.number().int(), language: z.enum(["zh", "en"]) }),
    targetResume: resumeReferenceSchema.extend({ versionNumber: z.number().int(), language: z.enum(["zh", "en"]) }),
    drafts: z.array(assistantResumeSyncDraftSchema).max(20),
  }).nullable().optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ aiEnabled: false, context: { messages: [] } });
  const [settings, context, recentRuns] = await Promise.all([
    db.select({ aiEnabled: appSettings.aiEnabled, aiProvider: appSettings.aiProvider })
      .from(appSettings)
      .where(eq(appSettings.userId, user.id))
      .get(),
    loadAssistantContext(user.id),
    db.select({
      id: agentRuns.id,
      status: agentRuns.status,
      outputJson: agentRuns.outputJson,
      errorMessage: agentRuns.errorMessage,
      createdAt: agentRuns.createdAt,
    }).from(agentRuns).where(and(
      eq(agentRuns.userId, user.id),
      eq(agentRuns.runType, "assistant"),
    )).orderBy(desc(agentRuns.createdAt)).limit(12).all(),
  ]);
  const aiEnabled = settings?.aiEnabled
    ? await hasAiProviderKey(settings.aiProvider, user.id)
    : false;
  const tasks = recentRuns.map((run) => {
    const result = persistedAssistantResultSchema.safeParse(run.outputJson?.assistantResult);
    return run.status === "succeeded" && result.success
      ? { id: run.id, status: run.status, result: result.data, createdAt: run.createdAt }
      : null;
  }).filter((task): task is NonNullable<typeof task> => task !== null);
  return NextResponse.json({
    aiEnabled,
    assistantUnread: context.hasUnread,
    tasks,
    context: {
      messages: context.messages.map(({ role, content, intent, awaitingReply }) => ({ role, content, intent, awaitingReply })),
    },
  });
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await markAssistantContextRead(user.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await clearAssistantContext(user.id);
  return NextResponse.json({ ok: true });
}
