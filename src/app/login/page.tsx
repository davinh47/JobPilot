import { LoginForm } from "@/components/login-form";
import { getLocale } from "@/lib/i18n";
import { safeInternalPath } from "@/lib/safe-redirect";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const locale = await getLocale();
  const { next, error } = await searchParams;
  return <LoginForm initialError={error} key={locale} locale={locale} nextPath={safeInternalPath(next)} />;
}
