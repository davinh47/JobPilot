import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/current-user";
import { getLocale } from "@/lib/i18n";
import { isCloudDeployment } from "@/lib/deployment";
import "./globals.css";

export const metadata: Metadata = {
  title: "JobPilot",
  description: "Local-first job search workspace",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [locale, user] = await Promise.all([getLocale(), getCurrentUser()]);
  if (isCloudDeployment && !user) {
    return <html lang={locale === "zh" ? "zh-CN" : "en"}><body>{children}</body></html>;
  }
  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"}>
      <body><AppShell cloud={isCloudDeployment} locale={locale} userEmail={user?.email}>{children}</AppShell></body>
    </html>
  );
}
