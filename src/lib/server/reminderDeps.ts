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
import type { DutyDeps } from "./dutyHandler";
import type { PaidDeps } from "./paidHandler";
import type { PayLinkDeps } from "./payLinkHandler";
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
async function getSessionRepo(request: Request, headers: Record<string, string>): Promise<{ repo: Repo; secret: string } | null> {
  const secret = readCronSecret();
  if (!secret) return null;
  const env = getPublicEnv();
  if (env.NEXT_PUBLIC_DATA_MODE === "mock") {
    if (!mockStoreEnabled()) return null;
    const id = request.headers.get("x-mock-user");
    return {
      repo: createMockRepo({ storage: serverStoreStorage(), session: memorySession(id && id.length <= 64 ? id : null), serverSecret: secret }),
      secret,
    };
  }
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  const client = await createSupabaseServerClient({ onCacheHeaders: (h) => Object.assign(headers, h) });
  return { repo: createSupabaseRepo(client), secret };
}

export async function getRemindDeps(request: Request, headers: Record<string, string>): Promise<ReminderDeps | null> {
  const session = await getSessionRepo(request, headers);
  return session ? { ...session, push: getPushSender() } : null;
}

/** Dependencies of /api/cron/morning. In mock mode the bot is never called. */
export function getMorningDeps(): DutyDeps | null {
  const server = getServerRepo();
  if (!server) return null;
  const mock = getPublicEnv().NEXT_PUBLIC_DATA_MODE === "mock";
  return { ...server, push: getPushSender(), telegram: mock ? null : getTelegramApi() };
}

/** Dependencies of /api/duty/notify: the SIGNED-IN user (same session rules as getRemindDeps). */
export async function getDutyNotifyDeps(request: Request, headers: Record<string, string>): Promise<DutyDeps | null> {
  const session = await getSessionRepo(request, headers);
  if (!session) return null;
  const mock = getPublicEnv().NEXT_PUBLIC_DATA_MODE === "mock";
  return { ...session, push: getPushSender(), telegram: mock ? null : getTelegramApi() };
}

/** Dependencies of /api/settle/opened: the SIGNED-IN debtor (same session rules as getRemindDeps). In mock mode the bot is never called. */
export async function getPaidDeps(request: Request, headers: Record<string, string>): Promise<PaidDeps | null> {
  const session = await getSessionRepo(request, headers);
  if (!session) return null;
  const mock = getPublicEnv().NEXT_PUBLIC_DATA_MODE === "mock";
  // mock mode (E2E): no 150 s timer holding the server; the notice then finds the prompt too young and sends nothing
  return { ...session, push: getPushSender(), telegram: mock ? null : getTelegramApi(), ...(mock ? { wait: () => Promise.resolve() } : {}) };
}

/**
 * Dependencies of the pay link page and /api/k/<code>/*: NO session (the roommates open the link from the Telegram group),
 * the anon-key server repo and the server secret. In mock mode (E2E) there is no 150 s timer and the bot is never called.
 */
export function getPayLinkDeps(): PayLinkDeps | null {
  const server = getServerRepo();
  if (!server) return null;
  const mock = getPublicEnv().NEXT_PUBLIC_DATA_MODE === "mock";
  return { ...server, push: getPushSender(), telegram: mock ? null : getTelegramApi(), ...(mock ? { wait: () => Promise.resolve() } : {}) };
}
