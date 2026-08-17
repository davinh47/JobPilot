import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assistantContexts, type AssistantContextMessage } from "@/db/schema";
import type { AssistantChatMessage, AssistantResponse } from "@/lib/jobpilot-assistant";
import { compactToTokenBudget, estimateTokens } from "@/lib/token-budget";

export const ASSISTANT_CONTEXT_ROUND_LIMIT = 10;
export const ASSISTANT_CONTEXT_MESSAGE_TOKEN_LIMIT = 4800;
export const ASSISTANT_CONTEXT_SUMMARY_TOKEN_LIMIT = 1200;
export const ASSISTANT_CONTEXT_MIN_RECENT_ROUNDS = 2;

const ASSISTANT_CONTEXT_MESSAGE_OVERHEAD = 10;
const ASSISTANT_CONTEXT_SUMMARY_MESSAGE_TOKEN_LIMIT = 220;

type AssistantContextState = {
  summary: string;
  messages: AssistantContextMessage[];
  summarizedMessageCount: number;
  hasUnread: boolean;
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

function promptContent(message: AssistantContextMessage) {
  return message.contextContent ?? message.content;
}

function messageTokenCount(message: AssistantContextMessage) {
  return estimateTokens(promptContent(message)) + ASSISTANT_CONTEXT_MESSAGE_OVERHEAD;
}

function roundsTokenCount(rounds: AssistantContextMessage[][]) {
  return rounds.flat().reduce((total, message) => total + messageTokenCount(message), 0);
}

function distributeContentBudget(messages: AssistantContextMessage[], totalBudget: number) {
  const estimates = messages.map((message) => estimateTokens(promptContent(message)));
  const budgets = estimates.map((estimate) => Math.min(estimate, 120));
  let remaining = Math.max(0, totalBudget - budgets.reduce((total, budget) => total + budget, 0));
  while (remaining > 0) {
    const expandable = budgets.map((budget, index) => ({ index, need: (estimates[index] ?? 0) - budget })).filter((item) => item.need > 0);
    if (!expandable.length) break;
    const share = Math.max(1, Math.floor(remaining / expandable.length));
    let used = 0;
    for (const item of expandable) {
      const addition = Math.min(item.need, share, remaining - used);
      budgets[item.index] = (budgets[item.index] ?? 0) + addition;
      used += addition;
      if (used === remaining) break;
    }
    if (!used) break;
    remaining -= used;
  }
  return budgets;
}

function summaryPrefix(locale: "zh" | "en") {
  return locale === "zh" ? "更早对话摘要：" : "Earlier conversation summary:";
}

function cleanSummary(value: string) {
  return value
    .replace(/^(?:更早对话摘要：|Earlier conversation summary:)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedSummary(value: string, locale: "zh" | "en") {
  const body = cleanSummary(value);
  if (!body) return "";
  return compactToTokenBudget(`${summaryPrefix(locale)} ${body}`, ASSISTANT_CONTEXT_SUMMARY_TOKEN_LIMIT);
}

function archivedMessageSummary(message: AssistantContextMessage, locale: "zh" | "en") {
  const role = message.role === "user"
    ? locale === "zh" ? "用户" : "User"
    : locale === "zh" ? "助手" : "Assistant";
  const metadata = [
    message.intent ? `intent=${message.intent}` : "",
    message.awaitingReply ? (locale === "zh" ? "等待回复" : "awaiting reply") : "",
  ].filter(Boolean).join(", ");
  const excerpt = compactToTokenBudget(
    message.content.replace(/\s+/g, " ").trim(),
    ASSISTANT_CONTEXT_SUMMARY_MESSAGE_TOKEN_LIMIT,
  );
  return `${role}${metadata ? ` [${metadata}]` : ""}: ${excerpt}`;
}

function summarizeArchivedMessages(existingSummary: string, archived: AssistantContextMessage[], locale: "zh" | "en") {
  if (!archived.length) return boundedSummary(existingSummary, locale);
  const additions = archived.map((message) => archivedMessageSummary(message, locale)).join(" ");
  return boundedSummary([cleanSummary(existingSummary), additions].filter(Boolean).join(" "), locale);
}

export function compactAssistantContext(
  state: AssistantContextState,
  locale: "zh" | "en",
): AssistantContextState {
  const rounds = splitRounds(state.messages);
  let archiveCount = Math.max(0, rounds.length - ASSISTANT_CONTEXT_ROUND_LIMIT);
  while (
    rounds.length - archiveCount > ASSISTANT_CONTEXT_MIN_RECENT_ROUNDS
    && roundsTokenCount(rounds.slice(archiveCount)) > ASSISTANT_CONTEXT_MESSAGE_TOKEN_LIMIT
  ) archiveCount += 1;
  if (!archiveCount) return { ...state, summary: boundedSummary(state.summary, locale), messages: rounds.flat() };
  const archived = rounds.slice(0, archiveCount).flat();
  return {
    summary: summarizeArchivedMessages(state.summary, archived, locale),
    messages: rounds.slice(archiveCount).flat(),
    summarizedMessageCount: state.summarizedMessageCount + archived.length,
    hasUnread: state.hasUnread,
  };
}

export async function loadAssistantContext(userId: string): Promise<AssistantContextState> {
  const row = await db.select().from(assistantContexts).where(eq(assistantContexts.userId, userId)).get();
  return {
    summary: row?.summary ?? "",
    messages: Array.isArray(row?.messagesJson) ? row.messagesJson : [],
    summarizedMessageCount: row?.summarizedMessageCount ?? 0,
    hasUnread: row?.hasUnread ?? false,
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
  const rounds = splitRounds(messages);
  const selected: AssistantChatMessage[][] = [];
  let remaining = ASSISTANT_CONTEXT_MESSAGE_TOKEN_LIMIT;
  for (let index = rounds.length - 1; index >= 0 && remaining > ASSISTANT_CONTEXT_MESSAGE_OVERHEAD; index -= 1) {
    const round = rounds[index] ?? [];
    const rawTokens = round.reduce((total, message) => total + messageTokenCount(message), 0);
    const canFit = rawTokens <= remaining;
    if (!canFit && selected.length >= ASSISTANT_CONTEXT_MIN_RECENT_ROUNDS) break;
    const contentBudgets = distributeContentBudget(
      round,
      Math.max(1, remaining - ASSISTANT_CONTEXT_MESSAGE_OVERHEAD * round.length),
    );
    const promptRound = round.map((message, messageIndex) => ({
      role: message.role,
      content: canFit ? promptContent(message) : compactToTokenBudget(promptContent(message), contentBudgets[messageIndex] ?? 1),
      intent: message.intent,
      awaitingReply: message.awaitingReply,
    }));
    const used = promptRound.reduce((total, message) => total + estimateTokens(message.content) + ASSISTANT_CONTEXT_MESSAGE_OVERHEAD, 0);
    if (used > remaining && selected.length) break;
    selected.unshift(promptRound);
    remaining = Math.max(0, remaining - used);
  }
  return selected.flat();
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
    hasUnread: true,
  }).onConflictDoUpdate({
    target: assistantContexts.userId,
    set: {
      summary: compacted.summary,
      messagesJson: compacted.messages,
      summarizedMessageCount: compacted.summarizedMessageCount,
      hasUnread: true,
      updatedAt: new Date(),
    },
  }).run();
  return compacted;
}

export async function markAssistantContextRead(userId: string) {
  await db.update(assistantContexts)
    .set({ hasUnread: false, updatedAt: new Date() })
    .where(eq(assistantContexts.userId, userId))
    .run();
}

export async function clearAssistantContext(userId: string) {
  await db.delete(assistantContexts).where(eq(assistantContexts.userId, userId)).run();
}
