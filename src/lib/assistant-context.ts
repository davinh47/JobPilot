import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assistantContexts, type AssistantContextMessage } from "@/db/schema";
import type { AssistantChatMessage, AssistantResponse } from "@/lib/jobpilot-assistant";

export const ASSISTANT_CONTEXT_ROUND_LIMIT = 10;
export const ASSISTANT_CONTEXT_SUMMARY_LIMIT = 6000;

type AssistantContextState = {
  summary: string;
  messages: AssistantContextMessage[];
  summarizedMessageCount: number;
};

function cleanMessage(message: AssistantContextMessage): AssistantContextMessage {
  return {
    role: message.role,
    content: message.content.trim().slice(0, 5000),
    ...(message.contextContent ? { contextContent: message.contextContent.trim().slice(0, 20_000) } : {}),
    ...(message.intent ? { intent: message.intent } : {}),
    ...(message.awaitingReply ? { awaitingReply: true } : {}),
  };
}

function splitRounds(messages: AssistantContextMessage[]) {
  const rounds: AssistantContextMessage[][] = [];
  for (const message of messages.map(cleanMessage).filter((item) => item.content)) {
    if (message.role === "user" || !rounds.length) rounds.push([message]);
    else rounds[rounds.length - 1]?.push(message);
  }
  return rounds;
}

function summarizeArchivedMessages(existingSummary: string, archived: AssistantContextMessage[], locale: "zh" | "en") {
  if (!archived.length) return existingSummary;
  const labels = locale === "zh"
    ? { prefix: "更早对话摘要：", user: "用户", assistant: "助手" }
    : { prefix: "Earlier conversation summary:", user: "User", assistant: "Assistant" };
  const additions = archived.map((message) => {
    const label = message.role === "user" ? labels.user : labels.assistant;
    const content = message.content.replace(/\s+/g, " ").trim().slice(0, 700);
    return `${label}: ${content}`;
  }).join(" ");
  const combined = [existingSummary.replace(/\s+/g, " ").trim(), additions].filter(Boolean).join(" ");
  if (combined.length <= ASSISTANT_CONTEXT_SUMMARY_LIMIT) return `${labels.prefix} ${combined}`.replace(`${labels.prefix} ${labels.prefix}`, labels.prefix);
  const tail = combined.slice(-(ASSISTANT_CONTEXT_SUMMARY_LIMIT - labels.prefix.length - 2));
  return `${labels.prefix} …${tail.replace(/^.*?\s/, "")}`;
}

export function compactAssistantContext(
  state: AssistantContextState,
  locale: "zh" | "en",
): AssistantContextState {
  const rounds = splitRounds(state.messages);
  const archiveCount = Math.max(0, rounds.length - ASSISTANT_CONTEXT_ROUND_LIMIT);
  if (!archiveCount) return { ...state, messages: rounds.flat() };
  const archived = rounds.slice(0, archiveCount).flat();
  return {
    summary: summarizeArchivedMessages(state.summary, archived, locale),
    messages: rounds.slice(archiveCount).flat(),
    summarizedMessageCount: state.summarizedMessageCount + archived.length,
  };
}

export async function loadAssistantContext(userId: string): Promise<AssistantContextState> {
  const row = await db.select().from(assistantContexts).where(eq(assistantContexts.userId, userId)).get();
  return {
    summary: row?.summary ?? "",
    messages: Array.isArray(row?.messagesJson) ? row.messagesJson : [],
    summarizedMessageCount: row?.summarizedMessageCount ?? 0,
  };
}

export function prepareAssistantTurn(
  state: AssistantContextState,
  latestUserMessage: AssistantChatMessage,
  locale: "zh" | "en",
) {
  const messages = [...state.messages];
  const last = messages.at(-1);
  if (last?.role !== "user" || last.content !== latestUserMessage.content) {
    messages.push(cleanMessage(latestUserMessage));
  }
  return compactAssistantContext({ ...state, messages }, locale);
}

export function assistantPromptMessages(messages: AssistantContextMessage[]): AssistantChatMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.contextContent ?? message.content,
    intent: message.intent,
    awaitingReply: message.awaitingReply,
  }));
}

export async function persistAssistantExchange(input: {
  userId: string;
  state: AssistantContextState;
  response: AssistantResponse;
  locale: "zh" | "en";
}) {
  const draftContext = [
    input.response.projectDrafts.length ? `<PREVIOUS_PROJECT_DRAFTS>${JSON.stringify(input.response.projectDrafts)}</PREVIOUS_PROJECT_DRAFTS>` : "",
    input.response.skillDrafts.length ? `<PREVIOUS_SKILL_DRAFTS>${JSON.stringify(input.response.skillDrafts)}</PREVIOUS_SKILL_DRAFTS>` : "",
  ].filter(Boolean).join("\n");
  const contextContent = draftContext ? `${input.response.reply}\n${draftContext}` : input.response.reply;
  const compacted = compactAssistantContext({
    ...input.state,
    messages: [...input.state.messages, {
      role: "assistant",
      content: input.response.reply,
      contextContent,
      intent: input.response.intent,
      awaitingReply: input.response.questions.length > 0,
    }],
  }, input.locale);
  await db.insert(assistantContexts).values({
    userId: input.userId,
    summary: compacted.summary,
    messagesJson: compacted.messages,
    summarizedMessageCount: compacted.summarizedMessageCount,
  }).onConflictDoUpdate({
    target: assistantContexts.userId,
    set: {
      summary: compacted.summary,
      messagesJson: compacted.messages,
      summarizedMessageCount: compacted.summarizedMessageCount,
      updatedAt: new Date(),
    },
  }).run();
  return compacted;
}

export async function clearAssistantContext(userId: string) {
  await db.delete(assistantContexts).where(eq(assistantContexts.userId, userId)).run();
}
