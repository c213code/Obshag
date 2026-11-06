import { getPublicEnv } from "@/lib/env/public";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { localStorageSession, localStorageStorage, serverStorage } from "./mockBrowser";
import { createMockRepo } from "./mockRepo";
import type { Repo } from "./repo";
import { createSupabaseRepo } from "./supabaseRepo";

/**
 * Builds a Repo for the configured NEXT_PUBLIC_DATA_MODE. There is deliberately NO module-level
 * singleton: the instance is owned by `RepoProvider` (created once on the client), so state never
 * leaks between requests or tests.
 *  - mock: localStorage-backed (E2E build: the shared server store, so two contexts see each other)
 *  - supabase: browser client + RPCs
 */
export function createRepo(): Repo {
  const env = getPublicEnv();
  if (env.NEXT_PUBLIC_DATA_MODE === "mock") {
    return createMockRepo({
      storage: env.NEXT_PUBLIC_E2E === "1" ? serverStorage() : localStorageStorage(),
      session: localStorageSession(),
    });
  }
  return createSupabaseRepo(createSupabaseBrowserClient());
}
