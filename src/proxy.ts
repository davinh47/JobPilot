import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authIdentityFromClaims, serializeAuthIdentity, verifiedIdentityHeader } from "@/lib/auth-claims";
import { isCloudDeployment } from "@/lib/deployment";

const publicPaths = ["/login", "/reset-password", "/auth/callback", "/privacy", "/terms", "/api/cron", "/api/extension"];

export async function proxy(request: NextRequest) {
  if (!isCloudDeployment) return NextResponse.next();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(verifiedIdentityHeader);
  let refreshedCookies: Array<{ name: string; value: string; options: CookieOptions }> = [];
  let refreshedHeaders: Record<string, string> = {};
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headersToSet) => {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          refreshedCookies = cookiesToSet;
          refreshedHeaders = headersToSet;
        },
      },
    },
  );
  const claimsStartedAt = Date.now();
  const { data } = await supabase.auth.getClaims();
  const claimsDurationMs = Date.now() - claimsStartedAt;
  if (claimsDurationMs >= 250) {
    console.info("[JobPilot performance] proxy auth claims", { durationMs: claimsDurationMs });
  }
  const identity = authIdentityFromClaims(data?.claims);
  const authenticated = Boolean(identity);
  const isPublic = publicPaths.some((path) => request.nextUrl.pathname === path || request.nextUrl.pathname.startsWith(`${path}/`));
  if (identity) requestHeaders.set(verifiedIdentityHeader, serializeAuthIdentity(identity));
  const applyRefreshedCookies = (response: NextResponse) => {
    for (const { name, value, options } of refreshedCookies) response.cookies.set(name, value, options);
    for (const [name, value] of Object.entries(refreshedHeaders)) response.headers.set(name, value);
    return response;
  };

  if (!authenticated && !isPublic) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return applyRefreshedCookies(NextResponse.redirect(loginUrl));
  }
  if (authenticated && request.nextUrl.pathname === "/login") {
    return applyRefreshedCookies(NextResponse.redirect(new URL("/matches", request.url)));
  }
  return applyRefreshedCookies(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|downloads/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
