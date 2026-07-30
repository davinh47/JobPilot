"use client";

import { useState } from "react";
import { ArrowRight, BriefcaseBusiness, LoaderCircle, LockKeyhole } from "lucide-react";
import { AuthLanguageSwitch } from "@/components/auth-language-switch";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function ResetPasswordForm({ locale, invalidLink = false }: { locale: "zh" | "en"; invalidLink?: boolean }) {
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(invalidLink
    ? text("重置链接无效或已过期，请返回登录页重新申请。", "This reset link is invalid or expired. Request a new one from the sign-in page.")
    : "");
  const supabase = createSupabaseBrowserClient();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (password !== confirmation) {
      setMessage(text("两次输入的密码不一致。", "The passwords do not match."));
      setPending(false);
      return;
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage(error.code === "same_password"
        ? text("新密码不能与当前密码相同。", "The new password must differ from the current password.")
        : text("无法更新密码。重置链接可能已过期，请重新申请。", "The password could not be updated. The reset link may have expired; request a new one."));
      setPending(false);
      return;
    }
    await supabase.auth.signOut();
    window.location.assign("/login?error=password_updated");
  }

  return <div className="login-shell">
    <section className="login-panel">
      <AuthLanguageSwitch locale={locale} />
      <header><span className="brand-mark"><BriefcaseBusiness size={20} /></span><div><p className="eyebrow">JOBPILOT CLOUD</p><h1>{text("设置新密码", "Set a new password")}</h1><p>{text("使用至少 8 个字符。更新后，请使用新密码重新登录。", "Use at least 8 characters. After updating, sign in again with the new password.")}</p></div></header>
      <form className="login-email-form" onSubmit={submit}>
        <label>{text("新密码", "New password")}<span className="input-with-icon"><LockKeyhole size={16} /><input autoComplete="new-password" minLength={8} name="password" required type="password" /></span></label>
        <label>{text("确认新密码", "Confirm new password")}<span className="input-with-icon"><LockKeyhole size={16} /><input autoComplete="new-password" minLength={8} name="confirmation" required type="password" /></span></label>
        {message ? <p className="form-error" role="alert">{message}</p> : null}
        <button className="button button-primary" disabled={pending || invalidLink} type="submit">{pending ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}{text("更新密码", "Update password")}</button>
      </form>
      <a className="login-mode-switch login-return-link" href="/login">{text("返回登录", "Back to sign in")}</a>
    </section>
  </div>;
}
