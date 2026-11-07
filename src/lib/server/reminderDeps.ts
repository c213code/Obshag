import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createMockRepo, memorySession } from "@/lib/data/mockRepo";
import { serverStoreStorage } from "@/lib/data/mockServerStore";
import { mockStoreEnabled } from "@/lib/data/mockStoreGate";
import { createSupabaseRepo } from "@/lib/data/supabaseRepo";
import { getPublicEnv } from "@/lib/env/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPushSender } from "./captureDeps";
import { readCronSecret } from "./cronAuth";
import type { ReminderDeps } from "./reminderHandler";

/**
 * Dependencies of /api/cron/daily: the ANON key and no session (run_daily_reminders authenticates by CRON_SECRET's hash).
 * null = not configured (no CRON_SECRET, or no Supabase / E2E store): the route then answers 401 / 500.
 */
export function getCronDeps(): ReminderDeps | null {
  const secret = readCronSecret();
  if (!secret) return null;
  const env = getPublicEnv();
  if (env.NEXT_PUBLIC_DATA_MODE === "mock") {
    if (!mockStoreEnabled()) return null;
    return { repo: createMockRepo({ storage: serverStoreStorage(), session: memorySession(), serverSecret: secret }), push: getPushSender(), secret };
  }
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { repo: createSupabaseRepo(client), push: getPushSender(), secret };
}

/**
 * Dependencies of /api/remind: the SIGNED-IN user.
 *  - Supabase: the cookie session (RLS and auth.uid() apply). Refreshed-session cache headers are collected in `headers`.
 *  - mock mode (E2E gate only): the device's mock user id, sent by the app in `x-mock-user`.
 */
export async function getRemindDeps(request: Request, headers: Record<string, string>): Promise<ReminderDeps | null> {
  const secret = readCronSecret();
  if (!secret) return null;
  const env = getPublicEnv();
  if (env.NEXT_PUBLIC_DATA_MODE === "mock") {
    if (!mockStoreEnabled()) return null;
    const id = request.headers.get("x-mock-user");
    return {
      repo: createMockRepo({ storage: serverStoreStorage(), session: memorySession(id && id.length <= 64 ? id : null), serverSecret: secret }),
      push: getPushSender(),
      secret,
    };
  }
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  const client = await createSupabaseServerClient({ onCacheHeaders: (h) => Object.assign(headers, h) });
  return { repo: createSupabaseRepo(client), push: getPushSender(), secret };
}
