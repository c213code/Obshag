"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useRepo } from "@/components/RepoProvider";
import { getPublicEnv } from "@/lib/env/public";
import { ru } from "@/lib/i18n/ru";
import { postRemind } from "@/lib/remindClient";
import { useAppActions } from "../AppDataProvider";
import {
  getRemind,
  remindKey,
  remindServerSnapshot,
  setCooldown,
  setIdle,
  setSending,
  setSent,
  subscribeRemind,
  type RemindEntry,
} from "./remindStore";

/** State of one «Напомнить» button plus the press handler. The state is shared by every button for the same pair. */
export function useRemind(householdId: string, debtorId: string): { entry: RemindEntry; press: () => Promise<void> } {
  const repo = useRepo();
  const { showNotice } = useAppActions();
  const key = remindKey(householdId, debtorId);
  const entry = useSyncExternalStore(subscribeRemind, () => getRemind(key), remindServerSnapshot);

  const press = useCallback(async () => {
    if (getRemind(key).kind !== "idle") return; // sending, sent and cooldown ignore taps
    setSending(key);
    const headers: Record<string, string> = {};
    if (getPublicEnv().NEXT_PUBLIC_DATA_MODE === "mock") {
      // mock mode has no cookie session on the server: the route trusts this header only behind the E2E store gate
      const session = await repo.getSession().catch(() => null);
      if (session) headers["x-mock-user"] = session.user_id;
    }
    const result = await postRemind({ household_id: householdId, debtor_id: debtorId }, headers);
    if (result.ok) return setSent(key);
    if (result.reason === "cooldown") return setCooldown(key, result.retryAfter);
    setIdle(key);
    showNotice(result.reason === "forbidden" ? ru.remind.forbidden : result.reason === "too_small" ? ru.remind.tooSmall : ru.remind.failed);
  }, [key, householdId, debtorId, repo, showNotice]);

  return { entry, press };
}
