"use client";

import { useState } from "react";
import { ArrowRight, BriefcaseBusiness, Globe2, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { AuthLanguageSwitch } from "@/components/auth-language-switch";
import { buildAuthCallbackUrl } from "@/lib/auth-redirect";
import { signupResultIndicatesExistingAccount } from "@/lib/auth-signup";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm({ locale, nextPath, initialError }: { locale: "zh" | "en"; nextPath: string; initialError?: string }) {
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const confirmationFailed = initialError === "confirmation_failed";
  const passwordUpdated = initialError === "password_updated";
  const [mode, setMode] = useState<"signin" | "signup" | "recovery">("signin");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(confirmationFailed
    ? text("验证链接无效或已过期。请填写邮箱并重新发送验证邮件。", "The confirmation link is invalid or expired. Enter your email and resend confirmation.")
    : passwordUpdated
      ? text("密码已更新，请使用新密码登录。", "Your password was updated. Sign in with the new password.")
      : "");
  const [messageTone, setMessageTone] = useState<"error" | "success">(passwordUpdated ? "success" : "error");
  const [email, setEmail] = useState("");
  const [confirmationPending, setConfirmationPending] = useState(confirmationFailed);
  const googleAuthEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";
  const supabase = createSupabaseBrowserClient();
  const confirmationRedirect = () => buildAuthCallbackUrl(window.location.origin, nextPath);
  const recoveryRedirect = () => buildAuthCallbackUrl(window.location.origin, "/reset-password");

  function showMessage(value: string, tone: "error" | "success" = "error") {
    setMessage(value);
    setMessageTone(tone);
  }

  async function googleLogin() {
    setPending(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: buildAuthCallbackUrl(window.location.origin, nextPath) },
    });
    if (error) {
      showMessage(error.message);
      setPending(false);
    }
  }

  async function resendConfirmation() {
    if (!email.trim()) {
      showMessage(text("请先填写需要验证的邮箱。", "Enter the email address that needs verification."));
      return;
    }
    setPending(true);
    setMessage("");
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: confirmationRedirect() },
    });
    if (error) {
      showMessage(error.code === "over_email_send_rate_limit"
        ? text("验证邮件发送过于频繁，请稍后再试。", "Too many confirmation emails were requested. Try again shortly.")
        : error.message);
    } else {
      showMessage(text("验证请求已提交。如果该邮箱尚待验证，你会收到新邮件；请同时检查垃圾邮件文件夹。", "The confirmation request was submitted. If this email is awaiting verification, a new message will arrive; also check spam."), "success");
    }
    setPending(false);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const submittedEmail = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (mode === "recovery") {
      const { error } = await supabase.auth.resetPasswordForEmail(submittedEmail, { redirectTo: recoveryRedirect() });
      if (error) {
        showMessage(error.code === "over_email_send_rate_limit"
          ? text("重置邮件发送过于频繁，请稍后再试。", "Too many reset emails were requested. Try again shortly.")
          : error.message);
      } else {
        showMessage(text("如果该邮箱关联了 JobPilot 账户，你会收到密码重置邮件。请同时检查垃圾邮件文件夹。", "If that email is linked to a JobPilot account, a password reset message will arrive. Also check spam."), "success");
      }
      setPending(false);
      return;
    }
    const result = mode === "signin"
      ? await supabase.auth.signInWithPassword({ email: submittedEmail, password })
      : await supabase.auth.signUp({ email: submittedEmail, password, options: { emailRedirectTo: confirmationRedirect() } });
    if (result.error) {
      if (result.error.code === "email_not_confirmed") {
        setConfirmationPending(true);
        showMessage(text("这个邮箱已经注册，但尚未完成验证。请重新发送验证邮件。", "This email is registered but not confirmed. Resend the confirmation email."));
      } else if (result.error.code === "user_already_exists") {
        setConfirmationPending(true);
        showMessage(text("这个邮箱已经注册。若尚未验证，可以重新发送验证邮件；已验证则请返回登录。", "This email is already registered. Resend confirmation if needed, or return to sign in."));
      } else if (result.error.code === "invalid_credentials") {
        setConfirmationPending(true);
        showMessage(text("邮箱或密码不正确。若此前尚未验证邮箱，请使用下方的重新发送功能。", "The email or password is incorrect. If the email was never confirmed, use resend below."));
      } else {
        showMessage(result.error.message);
      }
    } else if (mode === "signup" && signupResultIndicatesExistingAccount(result.data.user)) {
      setConfirmationPending(true);
      showMessage(text("这个邮箱已经关联 JobPilot 账户，系统不会重复创建账户或发送新的注册邮件。请返回登录；若从未完成验证，请重新发送验证邮件。", "This email is already linked to a JobPilot account, so no duplicate account or signup email was created. Sign in instead, or resend confirmation if verification was never completed."));
    } else if (mode === "signup" && !result.data.session) {
      setConfirmationPending(true);
      showMessage(text("账户已创建，验证邮件已发送。请通过邮件完成验证；没有收到时可在下方重新发送。", "Your account was created and a confirmation email was sent. Confirm it by email, or resend below if it does not arrive."), "success");
    } else {
      const provisioned = await fetch("/api/auth/provision", { method: "POST" });
      if (!provisioned.ok) {
        showMessage(text("账户已登录，但工作区初始化失败。请稍后重试登录。", "You signed in, but workspace setup did not finish. Try signing in again shortly."));
        setPending(false);
        return;
      }
      window.location.assign(nextPath);
    }
    setPending(false);
  }

  return <div className="login-shell">
    <section className="login-panel">
      <AuthLanguageSwitch locale={locale} />
      <header><span className="brand-mark"><BriefcaseBusiness size={20} /></span><div><p className="eyebrow">JOBPILOT CLOUD</p><h1>{text("登录 JobPilot", "Sign in to JobPilot")}</h1><p>{text("你的简历、岗位和申请进度只会显示在自己的账户中。", "Your resumes, jobs, and application history stay inside your account.")}</p></div></header>
      {googleAuthEnabled && mode !== "recovery" ? <>
        <button className="button button-secondary login-google" disabled={pending} onClick={googleLogin} type="button"><Globe2 size={17} />{text("使用 Google 继续", "Continue with Google")}</button>
        <div className="login-divider"><span>{text("或使用邮箱", "or use email")}</span></div>
      </> : null}
      <form className="login-email-form" onSubmit={submit}>
        <label>{text("邮箱", "Email")}<span className="input-with-icon"><Mail size={16} /><input autoComplete="email" name="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></span></label>
        {mode !== "recovery" ? <label>{text("密码", "Password")}<span className="input-with-icon"><LockKeyhole size={16} /><input autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} name="password" required type="password" /></span></label> : null}
        {mode === "signin" ? <button className="login-forgot-password" onClick={() => { setMode("recovery"); setMessage(""); setConfirmationPending(false); }} type="button">{text("忘记密码？", "Forgot password?")}</button> : null}
        {message ? <p className={messageTone === "success" ? "form-success" : "form-error"}>{message}</p> : null}
        <button className="button button-primary" disabled={pending} type="submit">{pending ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}{mode === "signin" ? text("登录", "Sign in") : mode === "signup" ? text("创建账户", "Create account") : text("发送重置邮件", "Send reset email")}</button>
        {confirmationPending ? <button className="button button-secondary login-resend" disabled={pending} onClick={resendConfirmation} type="button"><Mail size={16} />{text("重新发送验证邮件", "Resend confirmation email")}</button> : null}
      </form>
      <button className="login-mode-switch" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); setConfirmationPending(false); }} type="button">{mode === "signin" ? text("第一次使用？创建邮箱账户", "New to JobPilot? Create an account") : text("返回登录", "Back to sign in")}</button>
      <footer><a href="/privacy">{text("隐私说明", "Privacy")}</a><span>·</span><a href="/terms">{text("使用条款", "Terms")}</a></footer>
    </section>
  </div>;
}
