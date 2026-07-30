"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { Locale } from "@/lib/i18n";

export function ExtensionPairingPanel({ locale, token }: { locale: Locale; token: string }) {
  const [copied, setCopied] = useState(false);
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const copy = async () => { await navigator.clipboard.writeText(token); setCopied(true); };
  return <div className="extension-token-panel"><code>{`${token.slice(0, 6)}••••••••••••${token.slice(-4)}`}</code><button className="button button-secondary" onClick={copy} type="button">{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? text("已复制", "Copied") : text("复制配对令牌", "Copy pairing token")}</button></div>;
}
