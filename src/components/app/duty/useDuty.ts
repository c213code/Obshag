"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRepo } from "@/components/RepoProvider";
import type { MemberWithProfile } from "@/lib/data/repo";
import type { Duty, DutyDay, Profile, SwapRequest } from "@/lib/data/types";
import { almatyDay } from "@/lib/domain/almaty";
import { addDays, toneMap, weekStart, type Tone } from "@/lib/domain/duty";
import { getPublicEnv } from "@/lib/env/public";
import { postDutyNotify, type DutyNotifyEvent } from "@/lib/dutyClient";
import { useAppData } from "../AppDataProvider";

const NONE: MemberWithProfile[] = [];

type DutyState = { status: DutyView["status"]; duty: Duty | null; plan: DutyDay[]; requests: SwapRequest[] };

/** A clock that ticks every `ms` (a lazy initial value keeps render pure). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Runs `init` once each time `open` turns true (state is adjusted while rendering, not in an effect). */
export function useOnOpen(open: boolean, init: () => void): void {
  const [was, setWas] = useState(false);
  if (open !== was) {
    setWas(open);
    if (open) init();
  }
}

export type DutyView = {
  status: "loading" | "ready" | "error";
  householdId: string | null;
  me: Profile | null;
  roster: ReadonlyArray<MemberWithProfile>;
  isAdmin: boolean;
  /** The cooking duty (the only one with a screen for now), or the first duty. null = none yet. */
  duty: Duty | null;
  plan: DutyDay[];
  requests: SwapRequest[];
  today: string;
  nameOf(userId: string | null | undefined): string;
  toneOf(userId: string | null | undefined): Tone;
  reload(): Promise<void>;
};

/** Mock mode only: the server routes trust this header behind the E2E store gate (like «Напомнить»). */
export function useNotifyDuty() {
  const repo = useRepo();
  return useCallback(
    async (requestId: string, event: DutyNotifyEvent) => {
      const headers: Record<string, string> = {};
      if (getPublicEnv().NEXT_PUBLIC_DATA_MODE === "mock") {
        const session = await repo.getSession().catch(() => null);
        if (session) headers["x-mock-user"] = session.user_id;
      }
      return postDutyNotify({ request_id: requestId, event }, headers);
    },
    [repo],
  );
}

/**
 * The active household's cooking duty with its plan for `from..to` (offsets in days from today) and its swap requests.
 * Reloads when the app comes back to the foreground and whenever `reload()` is called after a write.
 */
export function useDuty(range: { from: string | ((today: string) => string); to: string | ((today: string) => string) }): DutyView {
  const repo = useRepo();
  const { me, members, activeId } = useAppData();
  const today = useMemo(() => almatyDay(new Date()).date, []);
  const from = typeof range.from === "function" ? range.from(today) : range.from;
  const to = typeof range.to === "function" ? range.to(today) : range.to;
  const roster = (activeId && members[activeId]) || NONE;
  const [state, setState] = useState<DutyState>({
    status: "loading",
    duty: null,
    plan: [],
    requests: [],
  });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fetchState = useCallback(async (): Promise<DutyState | null> => {
    if (!activeId) return null;
    try {
      const duties = await repo.listDuties(activeId);
      const duty = duties.find((d) => d.kind === "cooking") ?? duties[0] ?? null;
      if (!duty) return { status: "ready", duty: null, plan: [], requests: [] };
      const [plan, requests] = await Promise.all([repo.dutySchedule(duty.id, from, to), repo.listSwapRequests(duty.id)]);
      return { status: "ready", duty, plan, requests };
    } catch {
      return { status: "error", duty: null, plan: [], requests: [] };
    }
  }, [repo, activeId, from, to]);

  const reload = useCallback(async () => {
    const next = await fetchState();
    // a failed refresh never replaces data that is already on screen
    if (next && alive.current) setState((s) => (next.status === "error" && s.status === "ready" ? s : next));
  }, [fetchState]);

  useEffect(() => {
    let on = true;
    void fetchState().then((next) => {
      if (next && on) setState((s) => (next.status === "error" && s.status === "ready" ? s : next));
    });
    return () => {
      on = false;
    };
  }, [fetchState]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  const isAdmin = !!me && roster.some((m) => m.user_id === me.id && m.role === "admin");
  const tones = useMemo(() => toneMap(state.duty?.order ?? roster.map((m) => m.user_id), me?.id ?? null), [state.duty, roster, me]);
  const names = useMemo(() => new Map(roster.map((m) => [m.user_id, m.profile.display_name])), [roster]);

  return {
    status: state.status,
    householdId: activeId,
    me,
    roster,
    isAdmin,
    duty: state.duty,
    plan: state.plan,
    requests: state.requests,
    today,
    nameOf: (id) => (id ? (names.get(id) ?? "?") : "?"),
    toneOf: (id) => (id ? (tones.get(id) ?? "blue") : "blue"),
    reload,
  };
}

/** Monday of this week .. 3 weeks ahead: the window of /duty (week, order, swap neighbours). */
export const MAIN_RANGE = { from: (t: string) => weekStart(t), to: (t: string) => addDays(t, 28) };
