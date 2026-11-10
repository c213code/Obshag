"use client";

import { useCallback, useEffect, useState } from "react";
import { useRepo } from "@/components/RepoProvider";
import type { PaidPrompt } from "@/lib/data/types";

/** The question is only worth asking for this long after Kaspi was opened (the server expires the prompt then too). */
export const PROMPT_FRESH_MS = 30 * 60_000;

/**
 * The debtor's own pending «Ты перевёл?» prompt for one person. It is looked up when the PWA becomes visible again
 * (the user comes back from Kaspi) and once on arrival when a push opened the screen with `?ask=1`.
 * `dismiss` hides it for this visit only: it stays pending and is asked again on the next return.
 */
export function usePaidPrompt({
  householdId,
  userId,
  enabled,
  askOnMount,
}: {
  householdId: string | null;
  userId: string;
  enabled: boolean;
  askOnMount: boolean;
}): { prompt: PaidPrompt | null; clear: () => void } {
  const repo = useRepo();
  const [prompt, setPrompt] = useState<PaidPrompt | null>(null);

  const fetchFresh = useCallback(async (): Promise<PaidPrompt | null> => {
    if (!householdId) return null;
    try {
      const list = await repo.listPaidPrompts(householdId);
      const now = Date.now();
      return list.find((p) => p.to_user === userId && now - Date.parse(p.opened_at) < PROMPT_FRESH_MS) ?? null;
    } catch {
      return null; // no question is better than a wrong one
    }
  }, [repo, householdId, userId]);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const look = () =>
      void fetchFresh().then((fresh) => {
        if (live && fresh) setPrompt((cur) => cur ?? fresh);
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") look();
    };
    document.addEventListener("visibilitychange", onVisible);
    if (askOnMount) look();
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, askOnMount, fetchFresh]);

  const clear = useCallback(() => setPrompt(null), []);
  return { prompt: enabled ? prompt : null, clear };
}
