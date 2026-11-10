"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRepo } from "@/components/RepoProvider";
import type { Duty, DutyEvent } from "@/lib/data/types";
import { currentOf, turnQueue } from "@/lib/domain/dutyEvents";
import { getPublicEnv } from "@/lib/env/public";
import { postDutyEventNotify } from "@/lib/dutyClient";
import { useNow, type DutyView } from "./useDuty";

export type EventDutyView = {
  status: "loading" | "ready" | "error";
  duty: Duty;
  events: DutyEvent[];
  me: DutyView["me"];
  isAdmin: boolean;
  roster: DutyView["roster"];
  today: string;
  nowMs: number;
  nameOf: DutyView["nameOf"];
  toneOf: DutyView["toneOf"];
  /** The rotation from the pointer on (away members skipped): [0] is the current person. */
  queue: string[];
  current: string | null;
  /** Re-reads the events and the duty (bottles, price). */
  reload(): Promise<void>;
  /** Asks the server to push the current person about my own fresh ping / empty event. */
  notify(eventId: string): Promise<void>;
};

/** The events of a Мусор / Вода duty (newest first) and the derived queue. The duty row itself comes from the Очередь view. */
export function useEventDuty(duty: Duty, view: DutyView): EventDutyView {
  const repo = useRepo();
  const nowMs = useNow(30_000);
  const [state, setState] = useState<{ duty: string; status: EventDutyView["status"]; events: DutyEvent[] }>({ duty: duty.id, status: "loading", events: [] });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const events = await repo.listDutyEvents(duty.id);
      if (alive.current) setState({ duty: duty.id, status: "ready", events });
    } catch {
      if (alive.current) setState((s) => (s.duty === duty.id && s.status === "ready" ? s : { duty: duty.id, status: "error", events: [] }));
    }
  }, [repo, duty.id]);

  useEffect(() => {
    let on = true;
    void repo
      .listDutyEvents(duty.id)
      .then((events) => on && alive.current && setState({ duty: duty.id, status: "ready", events }))
      .catch(() => on && alive.current && setState({ duty: duty.id, status: "error", events: [] }));
    return () => {
      on = false;
    };
  }, [repo, duty.id]);

  const { reload: reloadDuties } = view;
  const reload = useCallback(async () => {
    await Promise.all([fetchEvents(), reloadDuties()]);
  }, [fetchEvents, reloadDuties]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  const notify = useCallback(
    async (eventId: string) => {
      const headers: Record<string, string> = {};
      if (getPublicEnv().NEXT_PUBLIC_DATA_MODE === "mock") {
        const session = await repo.getSession().catch(() => null);
        if (session) headers["x-mock-user"] = session.user_id;
      }
      await postDutyEventNotify({ event_id: eventId }, headers);
    },
    [repo],
  );

  const events = useMemo(() => (state.duty === duty.id ? state.events : []), [state, duty.id]);
  const status = state.duty === duty.id ? state.status : "loading";
  const roster = useMemo(() => view.roster.map((m) => ({ user_id: m.user_id, active: m.active, away_until: m.away_until })), [view.roster]);
  const queue = useMemo(() => turnQueue(duty.order, roster, events, view.today), [duty.order, roster, events, view.today]);
  const current = useMemo(() => currentOf(duty.order, roster, events, view.today), [duty.order, roster, events, view.today]);

  return {
    status,
    duty,
    events,
    me: view.me,
    isAdmin: view.isAdmin,
    roster: view.roster,
    today: view.today,
    nowMs,
    nameOf: view.nameOf,
    toneOf: view.toneOf,
    queue,
    current,
    reload,
    notify,
  };
}
