"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { createRepo } from "@/lib/data";
import type { Repo } from "@/lib/data/repo";
import { ru } from "@/lib/i18n/ru";

const RepoContext = createContext<Repo | null>(null);

const noopSubscribe = () => () => undefined;
const useIsClient = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

type Built = { repo: Repo } | { failed: true } | null;

/**
 * Owns the Repo for this browser session. It is created on the client only (never during prerender), so a
 * build without Supabase env still succeeds and mock state never leaks between requests.
 * Children render only once the repo exists; a missing configuration shows a clear message.
 */
export function RepoProvider({ children, repo, fallback }: { children: ReactNode; repo?: Repo; fallback?: ReactNode }) {
  const isClient = useIsClient();
  const built = useMemo<Built>(() => {
    if (repo) return { repo };
    if (!isClient) return null;
    try {
      return { repo: createRepo() };
    } catch (e) {
      console.error("RepoProvider: could not create the data layer", e); // the screen shows a plain message
      return { failed: true };
    }
  }, [repo, isClient]);

  if (built && "failed" in built) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[390px] items-center px-5">
        <p role="alert" className="text-body text-orange">
          {ru.errors.notConfigured}
        </p>
      </main>
    );
  }
  if (!built) return <>{fallback ?? null}</>;
  return <RepoContext.Provider value={built.repo}>{children}</RepoContext.Provider>;
}

export function useRepo(): Repo {
  const repo = useContext(RepoContext);
  if (!repo) throw new Error("useRepo must be used inside <RepoProvider>");
  return repo;
}
