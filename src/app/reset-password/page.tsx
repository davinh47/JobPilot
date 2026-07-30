import { ResetPasswordForm } from "@/components/reset-password-form";
import { getLocale } from "@/lib/i18n";
import { cookies } from "next/headers";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [locale, params, store] = await Promise.all([getLocale(), searchParams, cookies()]);
  const validRecovery = store.get("jobpilot_password_recovery")?.value === "1";
  return <ResetPasswordForm invalidLink={params.error === "invalid_link" || !validRecovery} key={locale} locale={locale} />;
}
