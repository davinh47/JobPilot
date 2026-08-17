"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages, LoaderCircle } from "lucide-react";
import { setLocalePreference } from "@/app/locale-actions";
import type { Locale } from "@/lib/i18n";

export function AuthLanguageSwitch({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function selectLocale(nextLocale: Locale) {
    if (pending || nextLocale === locale) return;
    startTransition(async () => {
      await setLocalePreference(nextLocale);
      router.refresh();
    });
  }

  return (
    <div
      aria-label={locale === "zh" ? "选择界面语言" : "Choose interface language"}
      className="auth-language-switch"
      role="group"
    >
      <span aria-hidden="true" className="auth-language-icon">
        {pending ? <LoaderCircle className="spin" size={15} /> : <Languages size={15} />}
      </span>
      <button
        aria-pressed={locale === "zh"}
        className={locale === "zh" ? "active" : ""}
        disabled={pending}
        onClick={() => selectLocale("zh")}
        type="button"
      >
        中文
      </button>
      <button
        aria-pressed={locale === "en"}
        className={locale === "en" ? "active" : ""}
        disabled={pending}
        onClick={() => selectLocale("en")}
        type="button"
      >
        English
      </button>
    </div>
  );
}
