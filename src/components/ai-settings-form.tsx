"use client";

import { useActionState, useState } from "react";
import { KeyRound, Save } from "lucide-react";
import { deleteAiApiKey, saveAiSettings, testAiConnection, type FormState } from "@/app/actions";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import type { Locale } from "@/lib/i18n";
import type { AiModelStrategy } from "@/lib/ai-models";

const initialState: FormState = {};
const providers = {
  openai: {
    name: "OpenAI",
    defaultModel: "gpt-5.6-terra",
    models: [
      { value: "gpt-5.6-luna", zh: "GPT-5.6 Luna · 快速", en: "GPT-5.6 Luna · Fast" },
      { value: "gpt-5.6-terra", zh: "GPT-5.6 Terra · 均衡", en: "GPT-5.6 Terra · Balanced" },
      { value: "gpt-5.6-sol", zh: "GPT-5.6 Sol · 高质量", en: "GPT-5.6 Sol · High quality" },
    ],
  },
  deepseek: {
    name: "DeepSeek",
    defaultModel: "deepseek-v4-flash",
    models: [
      { value: "deepseek-v4-flash", zh: "DeepSeek V4 Flash · 快速", en: "DeepSeek V4 Flash · Fast" },
      { value: "deepseek-v4-pro", zh: "DeepSeek V4 Pro · 高质量", en: "DeepSeek V4 Pro · High quality" },
    ],
  },
} as const;
type Provider = keyof typeof providers;

export function AiSettingsForm({ locale, enabled: initialEnabled, provider: initialProvider, model: initialModel, modelStrategy: initialModelStrategy, deepseekKeyConfigured, openaiKeyConfigured, cloudDeployment }: { locale: Locale; enabled: boolean; provider: string; model: string; modelStrategy: AiModelStrategy; deepseekKeyConfigured: boolean; openaiKeyConfigured: boolean; cloudDeployment: boolean }) {
  const [state, action, pending] = useActionState(saveAiSettings, initialState);
  const [testState, testAction, testPending] = useActionState(testAiConnection, initialState);
  const startingProvider: Provider = initialProvider === "openai" ? "openai" : "deepseek";
  const startingModels = providers[startingProvider].models as readonly { value: string }[];
  const [provider, setProvider] = useState<Provider>(startingProvider);
  const [model, setModel] = useState(startingModels.some((item) => item.value === initialModel) ? initialModel : providers[startingProvider].defaultModel);
  const [modelStrategy, setModelStrategy] = useState<AiModelStrategy>(initialModelStrategy);
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const selected = providers[provider];
  const keyConfigured = provider === "deepseek" ? deepseekKeyConfigured : openaiKeyConfigured;
  const confirmedEnabled = state.savedAiSettings?.enabled;
  const changeProvider = (next: Provider) => {
    setProvider(next);
    setModel(providers[next].defaultModel);
  };

  return <form action={action} className="ai-settings-form" data-tour="ai-settings">
    <input name="locale" type="hidden" value={locale} />
    <div className="ai-settings-head"><span className="settings-icon"><KeyRound size={19} /></span><div><h2>{text("AI 辅助", "AI assistance")}</h2><p>{text("选择服务商、模型和任务路由；默认“均衡”适合大多数用户。", "Choose a provider, model, and task routing. Balanced works well for most users.")}</p></div><label className="switch-control"><input aria-label={text("AI 辅助", "AI assistance")} defaultChecked={confirmedEnabled ?? initialEnabled} key={`ai-enabled-${confirmedEnabled ?? "initial"}`} name="aiEnabled" type="checkbox" /><span /><strong className="switch-label-on">{text("已开启", "On")}</strong><strong className="switch-label-off">{text("已关闭", "Off")}</strong></label></div>
    <div className="ai-provider-tabs" role="group" aria-label={text("AI 提供商", "AI provider")}>{(Object.keys(providers) as Provider[]).map((item) => <button aria-pressed={provider === item} className={provider === item ? "active" : ""} key={item} onClick={() => changeProvider(item)} type="button">{providers[item].name}</button>)}</div>
    <input name="aiProvider" type="hidden" value={provider} />
    <div className="ai-settings-fields">
      <label>{selected.name} API Key<input autoComplete="off" name="apiKey" placeholder={keyConfigured ? "••••••••••••••••" : "sk-..."} type="password" /><small>{keyConfigured ? text("已配置；留空将保留现有 Key。", "Configured; leave blank to keep it.") : cloudDeployment ? text("Key 会在你的云端账户中加密保存，只由 JobPilot 后端调用。", "The key is encrypted in your cloud account and used only by the JobPilot backend.") : text("Key 只保存在本机受保护的 secrets 文件中，不会发送到浏览器端。", "The key stays in the local protected secrets file and is never exposed to the browser.")}</small></label>
      {cloudDeployment ? <p className="provider-update-note">{text(
        "Cloud Key 使用 AES-256-GCM 静态加密，保存后不会回传到浏览器；执行 AI 任务时由 JobPilot 后端解密并发送给所选服务商。这不是零知识加密，建议使用单独创建并设置消费限制的 Key。",
        "Cloud keys are encrypted at rest with AES-256-GCM and are never returned to the browser after saving. The JobPilot backend decrypts the key only to send your AI requests to the selected provider. This is not zero-knowledge encryption; use a separate key with a provider spending limit.",
      )}</p> : null}
      <div className="form-row two-columns">
        <label>{text("模型", "Model")}<select name="aiModel" onChange={(event) => setModel(event.target.value)} value={model}>{selected.models.map((item) => <option key={item.value} value={item.value}>{locale === "zh" ? item.zh : item.en}</option>)}</select></label>
        <label>{text("任务模型路由", "Task model routing")}<select name="aiModelStrategy" onChange={(event) => setModelStrategy(event.target.value as AiModelStrategy)} value={modelStrategy}><option value="economy">{text("节省成本", "Economy")}</option><option value="balanced">{text("均衡（推荐）", "Balanced (recommended)")}</option><option value="quality">{text("质量优先", "Quality first")}</option><option value="fixed">{text("固定使用所选模型", "Always use selected model")}</option></select></label>
      </div>
      <p className="provider-update-note">{modelStrategy === "fixed"
        ? text(`所有任务都使用 ${model}。`, `Every task uses ${model}.`)
        : text("JobPilot 会按任务难度自动分配模型；“模型”用于固定模式和连接测试。", "JobPilot routes by task difficulty. The selected model is used for fixed mode and connection tests.")}</p>
      {keyConfigured ? <div className="ai-key-delete-row"><span>{cloudDeployment ? text(`${selected.name} API Key 已加密保存在账户中`, `${selected.name} API key is encrypted in your account`) : text(`${selected.name} API Key 已保存在本机`, `${selected.name} API key is stored locally`)}</span><ConfirmDeleteButton cancelLabel={text("取消", "Cancel")} confirmAction={deleteAiApiKey} confirmLabel={text("确认删除", "Delete key")} description={cloudDeployment ? text(`将删除账户中加密保存的 ${selected.name} API Key。若当前正在使用该提供商，AI 辅助也会关闭。`, `This removes the encrypted ${selected.name} API key from your account. AI assistance will also turn off if this is the active provider.`) : text(`将删除保存在本机的 ${selected.name} API Key。若当前正在使用该提供商，AI 辅助也会关闭。`, `This removes the locally stored ${selected.name} API key. AI assistance will also turn off if this is the active provider.`)} title={text(`删除 ${selected.name} API Key？`, `Delete ${selected.name} API key?`)} triggerLabel={text("删除 API Key", "Delete API key")} triggerStyle="delete-button" /></div> : null}
    </div>
    {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}{state.success ? <p className="form-success" role="status">{state.success}</p> : null}{testState.error ? <p className="form-error" role="alert">{testState.error}</p> : null}{testState.success ? <p className="form-success" role="status">{testState.success}</p> : null}
    <div className="settings-form-footer"><p>{text("关闭 AI 后，简历编辑和申请管理仍可正常使用。", "Resume editing and application tracking still work when AI is off.")}</p><div><button className="button button-secondary" disabled={pending || testPending} formAction={testAction} type="submit">{testPending ? text("测试中…", "Testing…") : text("测试连接", "Test connection")}</button><button className="button button-primary" disabled={pending || testPending} type="submit"><Save size={16} />{pending ? text("保存中…", "Saving…") : text("保存", "Save")}</button></div></div>
  </form>;
}
