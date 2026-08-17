import { createClient } from "@supabase/supabase-js";
import { requireCloudEnvironment } from "@/lib/deployment";

export function createSupabaseAdminClient() {
  return createClient(
    requireCloudEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requireCloudEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
