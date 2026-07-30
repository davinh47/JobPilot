import { LoaderCircle } from "lucide-react";
import { getLocale, pick } from "@/lib/i18n";

export default async function Loading() {
  const locale = await getLocale();
  return (
    <div aria-busy="true" aria-live="polite" className="route-loading">
      <LoaderCircle className="spin" size={22} />
      <span>{pick(locale, "正在加载…", "Loading…")}</span>
    </div>
  );
}
