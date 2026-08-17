import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireCloudEnvironment } from "@/lib/deployment";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    requireCloudEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requireCloudEnvironment("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
          } catch {
            // Server Components cannot always write cookies; proxy.ts refreshes sessions.
          }
        },
      },
    },
  );
}
