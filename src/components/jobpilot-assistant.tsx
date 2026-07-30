"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, Bot, Check, FilePlus2, Languages, MessageCircleMore, Navigation, PencilLine, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { applyAssistantResumeEdits, applyAssistantResumeSync, askJobPilotAssistant } from "@/app/assistant/actions";
import type { AssistantChatMessage, AssistantResponse, AssistantResumeSyncDraft } from "@/lib/jobpilot-assistant";
import type { Locale } from "@/lib/i18n";

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  response?: AssistantResponse;
  resume?: { id: string; title: string; versionId: string } | null;
  sync?: {
    sourceResume: { id: string; title: string; versionId: string; versionNumber: number; language: "zh" | "en" };
    targetResume: { id: string; title: string; versionId: string; versionNumber: number; language: "zh" | "en" };
    drafts: AssistantResumeSyncDraft[];
  } | null;
  applied?: boolean;
  actionHref?: string;
  actionLabel?: string;
  intent?: AssistantResponse["intent"];
  awaitingReply?: boolean;
  taskId?: string;
};

type AssistantTask = {
  id: string;
  status: "succeeded" | "failed";
  result?: {
    response: AssistantResponse;
    resume?: UiMessage["resume"];
    sync?: UiMessage["sync"];
  };
  error?: string;
};

function historyFrom(messages: UiMessage[]): AssistantChatMessage[] {
  return messages.slice(-12).map((message) => ({
    role: message.role,
    content: [
      message.content,
      message.response?.projectDrafts.length ? `<PREVIOUS_PROJECT_DRAFTS>${JSON.stringify(message.response.projectDrafts)}</PREVIOUS_PROJECT_DRAFTS>` : "",
      message.response?.skillDrafts.length ? `<PREVIOUS_SKILL_DRAFTS>${JSON.stringify(message.response.skillDrafts)}</PREVIOUS_SKILL_DRAFTS>` : "",
    ].filter(Boolean).join("\n"),
    intent: message.response?.intent ?? message.intent,
    awaitingReply: Boolean(message.response?.questions.length || message.awaitingReply),
  }));
}

export function JobPilotAssistant({ locale, initialOpen = false }: { locale: Locale; initialOpen?: boolean }) {
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const [open, setOpen] = useState(initialOpen);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([{
    id: "welcome",
    role: "assistant",
    content: text("你好，我是 JobPilot 助手。你可以问我界面怎么用、分析或修改简历，也可以让我比较中英文简历并生成确认后才会同步的更新草稿。", "Hi, I am JobPilot Assistant. Ask how JobPilot works, request resume feedback or edits, or have me compare bilingual resumes and prepare a synchronization draft that is applied only after confirmation."),
  }]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const quickActions = [
    text("怎么添加岗位？", "How do I add a job?"),
    text("分析一下我的简历", "Review my resume"),
    text("帮我添加简历项目", "Help me add resume projects"),
    text("把中文版简历的新内容同步到英文版简历", "Sync new Chinese resume content to my English resume"),
  ];

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, open, pending]);

  useEffect(() => {
    let active = true;
    void fetch("/api/assistant/status", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{
        aiEnabled?: boolean;
        context?: { messages?: Array<Pick<UiMessage, "role" | "content" | "intent" | "awaitingReply">> };
        tasks?: AssistantTask[];
      }> : null)
      .then((result) => {
        if (!active) return;
        if (result) {
          setAiEnabled(Boolean(result.aiEnabled));
          const restored = result.context?.messages ?? [];
          if (restored.length) {
            const restoredMessages: UiMessage[] = restored.map((message) => ({ ...message, id: crypto.randomUUID() }));
            for (const task of [...(result.tasks ?? [])].reverse()) {
              if (task.status !== "succeeded" || !task.result) continue;
              const matchingIndex = restoredMessages.findLastIndex((message) =>
                message.role === "assistant" && message.content === task.result!.response.reply
              );
              const taskMessage: UiMessage = {
                id: `task-${task.id}`,
                taskId: task.id,
                role: "assistant",
                content: task.result.response.reply,
                response: task.result.response,
                resume: task.result.resume ?? null,
                sync: task.result.sync ?? null,
              };
              if (matchingIndex >= 0) restoredMessages[matchingIndex] = { ...restoredMessages[matchingIndex], ...taskMessage };
              else restoredMessages.push(taskMessage);
            }
            setMessages(restoredMessages);
          }
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setContextLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const openAssistant = () => {
    setOpen(true);
    window.setTimeout(() => inputRef.current?.focus(), 50);
  };

  const clearConversation = async () => {
    if (pending || !window.confirm(text("清除当前助手对话和摘要？简历、岗位与其它数据不会受影响。", "Clear the current assistant conversation and summary? Resumes, jobs, and other data will not be affected."))) return;
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/assistant/status", { method: "DELETE" });
      if (!response.ok) {
        setError(text("无法清除对话，请稍后重试。", "The conversation could not be cleared. Try again."));
        return;
      }
      setMessages([{
        id: "welcome-reset",
        role: "assistant",
        content: text("对话上下文已清除。你可以开始一个新的 JobPilot 任务。", "Conversation context cleared. You can start a new JobPilot task."),
      }]);
    } finally {
      setPending(false);
    }
  };

  const send = async (preset?: string) => {
    const content = (preset ?? input).trim();
    if (!content || pending || !contextLoaded) return;
    const userMessage: UiMessage = { id: crypto.randomUUID(), role: "user", content };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setError("");
    setPending(true);
    try {
      const result = await askJobPilotAssistant({ messages: historyFrom(nextMessages), pathname, locale });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessages((current) => [...current, { id: crypto.randomUUID(), taskId: "runId" in result ? result.runId : undefined, role: "assistant", content: result.response.reply, response: result.response, resume: "resume" in result ? result.resume : null, sync: "sync" in result ? result.sync : null }]);
    } finally {
      setPending(false);
    }
  };

  const applyResumeEdits = async (message: UiMessage) => {
    const projectDrafts = message.response?.projectDrafts ?? [];
    const skillDrafts = message.response?.skillDrafts ?? [];
    if ((!projectDrafts.length && !skillDrafts.length) || !message.resume || applyingId) return;
    setApplyingId(message.id);
    setError("");
    try {
      const result = await applyAssistantResumeEdits({ resumeId: message.resume!.id, expectedVersionId: message.resume!.versionId, locale, projectDrafts, skillDrafts });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const changeText = locale === "zh"
        ? [result.updatedCount ? `修改 ${result.updatedCount} 个` : "", result.addedCount ? `添加 ${result.addedCount} 个` : ""].filter(Boolean).join("并")
        : [result.updatedCount ? `updated ${result.updatedCount}` : "", result.addedCount ? `added ${result.addedCount}` : ""].filter(Boolean).join(" and ");
      setMessages((current) => [...current.map((item) => item.id === message.id ? { ...item, applied: true } : item), {
        id: crypto.randomUUID(),
        role: "assistant",
        content: text(`已在 ${message.resume!.title} 中${changeText}项内容，并创建 v${result.versionNumber}。原版本没有被覆盖。`, `I ${changeText} resume item${result.addedCount + result.updatedCount === 1 ? "" : "s"} in ${message.resume!.title} as v${result.versionNumber}. The previous version was preserved.`),
        actionHref: result.href,
        actionLabel: text("打开新版本", "Open new version"),
      }]);
      router.refresh();
    } finally {
      setApplyingId(null);
    }
  };

  const applyResumeSync = async (message: UiMessage) => {
    if (!message.sync?.drafts.length || applyingId) return;
    setApplyingId(message.id);
    setError("");
    try {
      const result = await applyAssistantResumeSync({
        sourceResumeId: message.sync!.sourceResume.id,
        sourceVersionId: message.sync!.sourceResume.versionId,
        targetResumeId: message.sync!.targetResume.id,
        targetVersionId: message.sync!.targetResume.versionId,
        locale,
        drafts: message.sync!.drafts,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const changeText = locale === "zh"
        ? [result.updatedCount ? `更新 ${result.updatedCount} 项` : "", result.addedCount ? `新增 ${result.addedCount} 项` : ""].filter(Boolean).join("、")
        : [result.updatedCount ? `updated ${result.updatedCount}` : "", result.addedCount ? `added ${result.addedCount}` : ""].filter(Boolean).join(" and ");
      const targetVersionLabel = message.sync!.targetResume.language === "zh" ? "中文版" : "英文版";
      setMessages((current) => [...current.map((item) => item.id === message.id ? { ...item, applied: true } : item), {
        id: crypto.randomUUID(),
        role: "assistant",
        content: text(`已将草稿同步到“${message.sync!.targetResume.title}”，${changeText}，并创建 v${result.versionNumber}。同步前的${targetVersionLabel}仍然保留。`, `I synchronized the draft to “${message.sync!.targetResume.title}”, ${changeText}, and created v${result.versionNumber}. The previous target version was preserved.`),
        actionHref: result.href,
        actionLabel: text("检查同步后的版本", "Review synchronized version"),
      }]);
      router.refresh();
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <>
      {!open ? <button aria-label={text("打开 JobPilot 助手", "Open JobPilot Assistant")} className="assistant-launcher" data-tour="assistant-launcher" onClick={openAssistant} title={text("JobPilot 助手", "JobPilot Assistant")} type="button"><MessageCircleMore size={22} /></button> : null}
      {open ? <aside aria-label={text("JobPilot 助手", "JobPilot Assistant")} className="assistant-drawer">
        <header className="assistant-header" data-tour="assistant-launcher">
          <div><span className="assistant-mark"><Bot size={18} /></span><div><strong>{text("JobPilot 助手", "JobPilot Assistant")}</strong><small><span className={`status-dot ${aiEnabled === false ? "inactive" : ""}`} />{aiEnabled == null ? text("正在读取设置", "Checking settings") : aiEnabled ? text("AI 辅助已开启", "AI assistance on") : text("仅使用指南", "Guide only")}</small></div></div>
          <span className="assistant-header-actions">
            <button aria-label={text("清除助手对话", "Clear assistant conversation")} className="assistant-icon-button" disabled={pending} onClick={() => void clearConversation()} title={text("开始新对话", "Start a new conversation")} type="button"><RotateCcw size={18} /></button>
            <button aria-label={text("关闭助手", "Close assistant")} className="assistant-icon-button" onClick={() => setOpen(false)} title={text("关闭", "Close")} type="button"><X size={19} /></button>
          </span>
        </header>

        <div aria-live="polite" className="assistant-messages">
          {messages.map((message) => <article className={`assistant-message ${message.role}`} key={message.id}>
            <div className="assistant-message-label">{message.role === "user" ? text("你", "You") : text("助手", "Assistant")}</div>
            <p>{message.content}</p>
            {message.response?.questions.length ? <ul className="assistant-questions">{message.response.questions.map((question) => <li key={question}>{question}</li>)}</ul> : null}
            {message.response?.navigation ? <button className="assistant-navigation" onClick={() => router.push(message.response!.navigation!.href)} type="button"><Navigation size={14} />{message.response.navigation.label}<ArrowUpRight size={14} /></button> : null}
            {message.actionHref ? <button className="assistant-navigation" onClick={() => router.push(message.actionHref!)} type="button"><Navigation size={14} />{message.actionLabel}<ArrowUpRight size={14} /></button> : null}
            {(message.response?.projectDrafts.length || message.response?.skillDrafts.length) ? <div className="assistant-project-proposal">
              <div className="assistant-proposal-heading"><Sparkles size={15} /><span>{message.resume ? text(`目标简历：${message.resume.title}`, `Target resume: ${message.resume.title}`) : text("项目修改草稿", "Project edit drafts")}</span></div>
              {message.response.projectDrafts.map((draft) => <section className="assistant-project-draft" key={`${message.id}-${draft.targetEntryId ?? draft.projectName}`}>
                <header><strong>{draft.projectName}</strong><span>{draft.operation === "update" ? text("修改已有项目", "Update existing") : text("添加新项目", "Add new")}</span>{draft.role ? <span>{draft.role}</span> : null}</header>
                {(draft.startDate || draft.endDate || draft.current) ? <small>{[draft.startDate, draft.current ? text("至今", "Present") : draft.endDate].filter(Boolean).join(" - ")}</small> : null}
                <p>{draft.description}</p>
                {draft.highlights.length ? <ul>{draft.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul> : null}
                {draft.skills.length ? <div className="assistant-skill-list">{draft.skills.map((skill) => <span key={skill}>{skill}</span>)}</div> : null}
              </section>)}
              {message.response.skillDrafts.map((draft) => <section className="assistant-project-draft" key={`${message.id}-${draft.targetEntryId ?? draft.category}`}>
                <header><strong>{draft.category}</strong><span>{draft.operation === "update" ? text("更新技能类别", "Update skill category") : text("添加技能类别", "Add skill category")}</span></header>
                <div className="assistant-skill-list">{draft.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>
              </section>)}
              <button className="button button-primary" disabled={message.applied || applyingId === message.id || pending} onClick={() => void applyResumeEdits(message)} type="button">{message.applied ? <><Check size={16} />{text("已应用", "Applied")}</> : <>{[...message.response.projectDrafts, ...message.response.skillDrafts].some((draft) => draft.operation === "update") ? <PencilLine size={16} /> : <FilePlus2 size={16} />}{applyingId === message.id ? text("正在创建版本…", "Creating version…") : text(`确认应用 ${message.response.projectDrafts.length + message.response.skillDrafts.length} 项修改`, `Confirm ${message.response.projectDrafts.length + message.response.skillDrafts.length} change${message.response.projectDrafts.length + message.response.skillDrafts.length === 1 ? "" : "s"}`)}</>}</button>
            </div> : null}
            {message.sync?.drafts.length ? <div className="assistant-project-proposal">
              <div className="assistant-proposal-heading"><Languages size={15} /><span>{text(`从“${message.sync.sourceResume.title}”同步到“${message.sync.targetResume.title}”`, `Sync “${message.sync.sourceResume.title}” to “${message.sync.targetResume.title}”`)}</span></div>
              {message.sync.drafts.map((draft) => {
                const entry = draft.translatedEntry;
                const targetVersionLabel = message.sync!.targetResume.language === "zh" ? "中文版" : "英文版";
                const heading = entry.projectName || entry.position || entry.degree || entry.name || entry.category || entry.title || draft.sourceLabel;
                const organization = entry.organization || entry.school || entry.issuer || entry.role || entry.subtitle;
                return <section className="assistant-project-draft" key={`${message.id}-${draft.sourceEntryId}-${draft.targetEntryId ?? "new"}`}>
                  <header><strong>{heading}</strong><span>{draft.operation === "update" ? text(`更新${targetVersionLabel}已有条目`, "Update target entry") : text(`新增到${targetVersionLabel}`, "Add to target")}</span>{organization ? <span>{organization}</span> : null}</header>
                  <small>{text(`来源：${draft.sourceLabel}`, `Source: ${draft.sourceLabel}`)}</small>
                  {entry.description ? <p>{entry.description}</p> : null}
                  {entry.highlights.length ? <ul>{entry.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul> : null}
                  {entry.skills.length ? <div className="assistant-skill-list">{entry.skills.map((skill) => <span key={skill}>{skill}</span>)}</div> : null}
                </section>;
              })}
              <button className="button button-primary" disabled={message.applied || applyingId === message.id || pending} onClick={() => void applyResumeSync(message)} type="button">{message.applied ? <><Check size={16} />{text("已同步", "Synchronized")}</> : <><Languages size={16} />{applyingId === message.id ? text(`正在创建${message.sync.targetResume.language === "zh" ? "中文" : "英文"}版本…`, "Creating target version…") : text(`确认同步 ${message.sync.drafts.length} 项`, `Confirm ${message.sync.drafts.length} synchronized change${message.sync.drafts.length === 1 ? "" : "s"}`)}</>}</button>
            </div> : null}
          </article>)}
          {messages.length === 1 ? <div className="assistant-quick-actions">{quickActions.map((action) => <button disabled={pending} key={action} onClick={() => void send(action)} type="button">{action}</button>)}</div> : null}
          {pending && !applyingId ? <div className="assistant-thinking"><span />{text("正在后台整理，你可以继续使用其它页面…", "Working in the background. You can continue using other pages…")}</div> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div ref={messagesEndRef} />
        </div>

        <footer className="assistant-composer">
          <textarea aria-label={text("给 JobPilot 助手发送消息", "Message JobPilot Assistant")} disabled={pending || !contextLoaded} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={contextLoaded ? text("描述你想在 JobPilot 中完成的事情…", "Describe what you want to do in JobPilot…") : text("正在读取对话上下文…", "Loading conversation context…")} ref={inputRef} rows={2} value={input} />
          <button aria-label={text("发送", "Send")} disabled={!input.trim() || pending || !contextLoaded} onClick={() => void send()} title={text("发送", "Send")} type="button"><Send size={18} /></button>
        </footer>
      </aside> : null}
    </>
  );
}
