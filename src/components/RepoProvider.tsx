"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createRepo } from "@/lib/data";
import type { Repo } from "@/lib/data/repo";

const RepoContext = createContext<Repo | null>(null);

/**
 * Owns the Repo for this browser session. In mock mode the repo lives only in the client:
 * it is created once in a `useState` initializer, never as a module singleton.
 */
export function RepoProvider({ children, repo }: { children: ReactNode; repo?: Repo }) {
  const [value] = useState<Repo>(() => repo ?? createRepo());
  return <RepoContext.Provider value={value}>{children}</RepoContext.Provider>;
}

export function useRepo(): Repo {
  const repo = useContext(RepoContext);
  if (!repo) throw new Error("useRepo must be used inside <RepoProvider>");
  return repo;
}
