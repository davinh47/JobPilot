import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeInternalPath } from "@/lib/safe-redirect";
import { ensureWorkspaceUser } from "@/lib/user-provisioning";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeInternalPath(url.searchParams.get("next"));
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (data.user) {
        const metadata = data.user.user_metadata as { full_name?: unknown; name?: unknown };
        const displayName = typeof metadata.full_name === "string"
          ? metadata.full_name
          : typeof metadata.name === "string" ? metadata.name : null;
        await ensureWorkspaceUser({ id: data.user.id, email: data.user.email, displayName });
      }
      const response = NextResponse.redirect(new URL(next, url.origin));
      if (next === "/reset-password") {
        response.cookies.set("jobpilot_password_recovery", "1", {
          httpOnly: true,
          maxAge: 10 * 60,
          path: "/reset-password",
          sameSite: "lax",
          secure: url.protocol === "https:",
        });
      }
      return response;
    }
  }
  if (next === "/reset-password") return NextResponse.redirect(new URL("/reset-password?error=invalid_link", url.origin));
  return NextResponse.redirect(new URL("/login?error=confirmation_failed", url.origin));
}
