import { getPublicEnv } from "@/lib/env/public";
import { createMockRepo } from "./mockRepo";
import type { Repo } from "./repo";

/**
 * Builds a Repo for the configured NEXT_PUBLIC_DATA_MODE. There is deliberately NO module-level
 * singleton: mock mode is client-only, and the instance is owned by `RepoProvider`
 * (created once in a `useState` initializer), so state never leaks between requests or tests.
 * The Supabase repo arrives in slice 1.
 */
export function createRepo(): Repo {
  if (getPublicEnv().NEXT_PUBLIC_DATA_MODE === "mock") return createMockRepo();
  throw new Error("Supabase repo is not implemented yet (slice 1). Set NEXT_PUBLIC_DATA_MODE=mock.");
}
