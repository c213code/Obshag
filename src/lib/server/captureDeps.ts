import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createMockRepo, memorySession } from "@/lib/data/mockRepo";
import { serverStoreStorage } from "@/lib/data/mockServerStore";
import { mockStoreEnabled } from "@/lib/data/mockStoreGate";
import { createSupabaseRepo } from "@/lib/data/supabaseRepo";
import { getPublicEnv } from "@/lib/env/public";
import type { CaptureDeps } from "./captureHandler";
import { createRecordingSender, type PushSender } from "./push";
import { createWebPushSender, readVapid } from "./webPush";

const log = globalThis as typeof globalThis & { __obshakPushLog?: Array<{ endpoint: string; payload: unknown }> };

/** E2E only: what the fake sender "sent". */
export const pushLog = (): Array<{ endpoint: string; payload: unknown }> => (log.__obshakPushLog ??= []);

/**
 * The push sender for this environment: a recorder in mock/E2E mode (nothing leaves the machine; calls are visible at
 * /api/mock-push-log), web-push with VAPID otherwise, or null when VAPID is not configured.
 */
export function getPushSender(): PushSender | null {
  if (getPublicEnv().NEXT_PUBLIC_DATA_MODE === "mock") {
    const recorder = createRecordingSender();
    return {
      async send(sub, payload) {
        pushLog().push({ endpoint: sub.endpoint, payload });
        return recorder.send(sub, payload);
      },
    };
  }
  const vapid = readVapid();
  return vapid ? createWebPushSender(vapid) : null;
}

/**
 * Dependencies of /api/capture.
 *  - mock mode (E2E store gate): the E2E mock store and a recording sender, nothing leaves the machine.
 *  - otherwise: a Supabase client with the ANON key and no session (the RPC authenticates by token), web-push with VAPID.
 * Returns null when the server cannot serve captures at all (mock mode without the E2E gate, or Supabase not configured).
 */
export function getCaptureDeps(): CaptureDeps | null {
  const env = getPublicEnv();
  if (env.NEXT_PUBLIC_DATA_MODE === "mock") {
    if (!mockStoreEnabled()) return null;
    return {
      repo: createMockRepo({ storage: serverStoreStorage(), session: memorySession() }),
      push: getPushSender(),
    };
  }
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { repo: createSupabaseRepo(client), push: getPushSender() };
}
