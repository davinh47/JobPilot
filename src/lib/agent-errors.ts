import type { Locale } from "@/lib/i18n";
import { isCloudDeployment } from "@/lib/deployment";

export function friendlyAgentError(message: string | null | undefined, locale: Locale) {
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  if (!message) return text("AI 任务没有完成，请重试。", "The AI task did not complete. Try again.");
  const provider = /openai/i.test(message) ? "OpenAI" : /deepseek/i.test(message) ? "DeepSeek" : "AI";
  if (/no supported Greenhouse, Lever, or Ashby company source/i.test(message)) return text("本轮没有确认到可自动同步的 Greenhouse、Lever 或 Ashby 公司招聘源，因此没有添加连接器。普通公司官网推荐仍可在“标准”模式查看。", "This search did not confirm a syncable Greenhouse, Lever, or Ashby company source, so no connector was added. General company recommendations remain available in Standard mode.");
  if (/no verifiable company careers pages|no source-grounded company candidates|official careers pages could not be confirmed/i.test(message)) return text("本轮联网搜索没有确认到真实公司招聘页，JobPilot 没有保存占位结果。系统已按每个目标岗位和地点分别搜索；可以稍后重试，或切换 OpenAI 获得更稳定的公司检索覆盖。", "This search did not confirm a real company careers page, so JobPilot saved no placeholder results. It searched each target role and location separately; try again later or use OpenAI for more reliable company-search coverage.");
  if (/hosted web search|live web search|company discovery and verification require OpenAI/i.test(message)) return text("当前模型 API 不包含网络搜索。请在设置中选择 OpenAI 后再运行实时公司查证和全网岗位发现。", "The selected model API has no hosted web search. Select OpenAI in Settings to run live company verification and web-wide job discovery.");
  if (/network request failed|fetch failed|ENOTFOUND|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT|Connect Timeout/i.test(message)) {
    if (provider === "DeepSeek") return isCloudDeployment
      ? text("JobPilot 暂时无法连接 DeepSeek；每日计划会保留并自动重试。", "JobPilot cannot reach DeepSeek right now. The daily schedule will retry automatically.")
      : text("暂时无法连接 DeepSeek；请检查网络，任务会保留并自动重试。", "JobPilot cannot reach DeepSeek. Check your connection; the task will retry automatically.");
    return text(`${provider} API 当前无法连接。请检查这台电脑的网络、代理或 VPN；每日计划会保留，并在下个计划周期自动重试。`, `JobPilot cannot currently reach the ${provider} API. Check this computer's network, proxy, or VPN. The daily schedule remains enabled and will retry on its next cycle.`);
  }
  if (/structured output remained truncated|JSON output was truncated|output.*reached the token limit/i.test(message)) return text(
    `${provider} 没有完成这次生成。JobPilot 已自动精简并重试；请稍后重试，或减少单次提交的材料。`,
    `${provider} could not complete this generation. JobPilot already retried with a shorter response; try again later or submit less material at once.`,
  );
  if (/oversized request|token limit|context length|maximum context|1039/i.test(message)) return text(`${provider} 请求内容过长。JobPilot 已自动压缩输入；仍失败时请改用 OpenAI，或减少单次材料。`, `${provider} received too much content. JobPilot compacted the prompt; if it still fails, use OpenAI or reduce the source material.`);
  if (message.trim().startsWith("[") || message.includes("expected string, received undefined") || message.includes("incomplete structured data")) return text(`${provider} 返回的结构化结果不完整。系统会自动校验并修复一次。`, `${provider} returned incomplete structured data. JobPilot validates and repairs it once.`);
  if (/HTTP 401|HTTP 403|API error 1004|invalid.*key|not authorized|token not match/i.test(message)) return text(`${provider} API Key 无效或权限不足，请在设置中检查。`, `The ${provider} API key is invalid or lacks access. Check Settings.`);
  if (/HTTP 402|HTTP 429|rate limit|insufficient balance|insufficient.*fund|quota|余额不足/i.test(message)) return text(`${provider} 当前限流、余额不足或额度已用完。请检查 API 账户，或暂时切换服务商。`, `${provider} is rate-limited, out of balance, or out of quota. Check the API account or temporarily switch providers.`);
  if (/model.*not found|invalid.*model|model.*does not exist|unknown model/i.test(message)) return text(`${provider} 当前不可用或账户权限不足。请检查 API 账户，或暂时切换服务商。`, `${provider} is unavailable or the account lacks access. Check the API account or temporarily switch providers.`);
  if (/abort|timed out|timeout/i.test(message)) return text(`${provider} 请求超时，请稍后重试。`, `The ${provider} request timed out. Try again later.`);
  return message.length > 320 ? `${message.slice(0, 317)}...` : message;
}
