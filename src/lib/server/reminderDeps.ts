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
import type { Repo } from "@/lib/data/repo";
import type { ReminderDeps } from "./reminderHandler";
import { getTelegramApi } from "./telegram/env";

/**
 * The repo of the anon-key, no-session server routes (cron, Telegram webhook): the secret-gated RPCs authenticate by
 * CRON_SECRET's hash. null = not configured (no CRON_SECRET, or no Supabase / E2E store).
 */
export function getServerRepo(): { repo: Repo; secret: string } | null {
  const secret = readCronSecret();
  if (!secret) return null;
  const env = getPublicEnv();
  if (env.NEXT_PUBLIC_DATA_MODE === "mock") {
    if (!mockStoreEnabled()) return null;
    return { repo: createMockRepo({ storage: serverStoreStorage(), session: memorySession(), serverSecret: secret }), secret };
  }
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { repo: createSupabaseRepo(client), secret };
}

/** Dependencies of /api/cron/daily. In mock mode the bot is never called. */
export function getCronDeps(): ReminderDeps | null {
  const server = getServerRepo();
  if (!server) return null;
  const mock = getPublicEnv().NEXT_PUBLIC_DATA_MODE === "mock";
  return { ...server, push: getPushSender(), telegram: mock ? null : getTelegramApi() };
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
