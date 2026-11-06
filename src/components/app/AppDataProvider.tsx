"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRepo } from "@/components/RepoProvider";
import { PurchaseTracker, type UiPurchase } from "@/lib/data/purchaseTracker";
import { stageOf, type Stage } from "@/lib/domain/guard";
import { splitEqual } from "@/lib/domain/split";
import { RepoError, type AuthSession, type MemberWithProfile, type NewPurchase, type Repo } from "@/lib/data/repo";
import type { Household, Profile } from "@/lib/data/types";
import { ru } from "@/lib/i18n/ru";
import { pendingJoin } from "@/lib/pendingJoin";

type Status = "loading" | "ready" | "error";

type Snapshot = {
  session: AuthSession | null;
  me: Profile | null;
  households: Household[];
  members: Record<string, MemberWithProfile[]>;
  purchases: Record<string, UiPurchase[]>;
};

const EMPTY: Snapshot = { session: null, me: null, households: [], members: {}, purchases: {} };

/** What screens read. Changes whenever data changes. */
export type AppData = Snapshot & {
  status: Status;
  stage: Stage;
  activeId: string | null;
};

/** What screens call. Every function has a stable identity for the life of the provider, so using actions alone never re-renders. */
export type AppActions = {
  setActiveId(id: string): void;
  /** Reloads everything. By default a failure shows the retry screen; `silent` keeps the current data on screen. */
  refresh(opts?: { silent?: boolean }): Promise<void>;
  /** Reloads the roster of one household (a neighbour may have joined since the last load). */
  refreshMembers(householdId: string): Promise<void>;
  /** Resolves true when the user was signed out; on failure a notice explains and it resolves false. */
  signOut(): Promise<boolean>;
  /** Optimistic: the purchase shows up at once, and is rolled back (with a notice) if the server refuses it. */
  addPurchase(input: NewPurchase): void;
  dismissNotice(): void;
};

const DataCtx = createContext<AppData | null>(null);
const ActionsCtx = createContext<AppActions | null>(null);
const NoticeCtx = createContext<string | null>(null);

function need<T>(v: T | null, hook: string): T {
  if (v === null) throw new Error(`${hook} must be used inside <AppDataProvider>`);
  return v;
}
export const useAppData = (): AppData => need(useContext(DataCtx), "useAppData");
export const useAppActions = (): AppActions => need(useContext(ActionsCtx), "useAppActions");
/** The current notice text (null when there is none). Kept apart so a notice does not re-render the data screens. */
export const useNotice = (): string | null => useContext(NoticeCtx);

type Loaded = Omit<Snapshot, "purchases"> & { purchases: Record<string, Awaited<ReturnType<Repo["listPurchases"]>>> };

async function loadSnapshot(repo: Repo): Promise<Loaded> {
  const session = await repo.getSession();
  if (!session) return EMPTY;
  // independent reads: one round trip of waiting, not two
  const [me, households] = await Promise.all([repo.getMe(), repo.listHouseholds()]);
  if (!me) return { ...EMPTY, session };
  const rows = await Promise.all(
    households.map(async (h) => {
      const [members, purchases] = await Promise.all([repo.listMembers(h.id), repo.listPurchases(h.id)]);
      return { id: h.id, members, purchases };
    }),
  );
  return {
    session,
    me,
    households,
    members: Object.fromEntries(rows.map((r) => [r.id, r.members])),
    purchases: Object.fromEntries(rows.map((r) => [r.id, r.purchases])),
  };
}

const sameRoster = (a: ReadonlyArray<MemberWithProfile> | undefined, b: ReadonlyArray<MemberWithProfile>) =>
  !!a && JSON.stringify(a) === JSON.stringify(b);

const REFOCUS_MIN_GAP_MS = 3000;

/**
 * Everything the signed-in screens read: session, profile, households, members and purchases.
 * Three contexts, so a toast does not re-render Главная and a data change does not re-render a button that only calls an action.
 */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const repo = useRepo();
  const [status, setStatus] = useState<Status>("loading");
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [tracker] = useState(() => new PurchaseTracker());
  const alive = useRef(true);
  const loadSeq = useRef(0);
  const latestLoad = useRef<Promise<void>>(Promise.resolve());
  const memberSeq = useRef(0);
  const tempId = useRef(0);
  const meRef = useRef<Profile | null>(null);
  const stageRef = useRef<Stage>(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Server lists plus this device's in-flight and just-confirmed rows. */
  const withLocalRows = useCallback(
    (loaded: Loaded): Snapshot => ({
      ...loaded,
      purchases: Object.fromEntries(Object.entries(loaded.purchases).map(([id, list]) => [id, tracker.view(id, list)])),
    }),
    [tracker],
  );

  const patchPurchases = useCallback(
    (householdId: string) =>
      setSnap((s) => ({ ...s, purchases: { ...s.purchases, [householdId]: tracker.view(householdId, s.purchases[householdId] ?? []) } })),
    [tracker],
  );

  const refresh = useCallback(
    (opts: { silent?: boolean } = {}): Promise<void> => {
      // a monotonically increasing token: only the newest load may apply its result
      const token = ++loadSeq.current;
      const run = async (): Promise<void> => {
        try {
          const next = await loadSnapshot(repo);
          if (token !== loadSeq.current) {
            // superseded: this result is stale. Callers still wait for the newest load (if there is one).
            const newer = latestLoad.current;
            return newer === p ? undefined : newer;
          }
          if (!alive.current) return;
          meRef.current = next.me;
          stageRef.current = stageOf({ hasSession: !!next.session, hasProfile: !!next.me, householdCount: next.households.length });
          setSnap(withLocalRows(next));
          setStatus("ready");
        } catch {
          if (token !== loadSeq.current || !alive.current || opts.silent) return;
          setStatus("error");
        }
      };
      const p: Promise<void> = run();
      latestLoad.current = p;
      return p;
    },
    [repo, withLocalRows],
  );

  const refreshMembers = useCallback(
    async (householdId: string): Promise<void> => {
      const token = ++memberSeq.current;
      try {
        const list = await repo.listMembers(householdId);
        if (token !== memberSeq.current || !alive.current) return;
        setSnap((s) => (sameRoster(s.members[householdId], list) ? s : { ...s, members: { ...s.members, [householdId]: list } }));
      } catch {
        // keep the roster we have; the next focus or screen entry tries again
      }
    },
    [repo],
  );

  // first load
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // coming back to the app (tab visible / window focused): neighbours may have joined or paid since
  useEffect(() => {
    let last = Date.now();
    const back = () => {
      if (document.visibilityState !== "visible" || stageRef.current !== 3) return;
      const now = Date.now();
      if (now - last < REFOCUS_MIN_GAP_MS) return;
      last = now;
      void refresh({ silent: true });
    };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, [refresh]);

  const signOut = useCallback(async (): Promise<boolean> => {
    try {
      await repo.signOut();
    } catch {
      setNotice(ru.errors.signOutFailed);
      return false;
    }
    pendingJoin.clear(); // a deep link remembered for the previous user must not follow the next one
    loadSeq.current++; // any load still in flight belongs to the old session
    tracker.clear();
    meRef.current = null;
    stageRef.current = 0;
    setActiveId(null);
    setSnap(EMPTY);
    return true;
  }, [repo, tracker]);

  const addPurchase = useCallback(
    (input: NewPurchase) => {
      const me = meRef.current;
      if (!me) return;
      const id = `optimistic-${++tempId.current}`;
      const createdAt = new Date().toISOString();
      let shares;
      try {
        shares = splitEqual(input.amount, input.participant_ids, me.id).map((s) => ({
          purchase_id: id,
          debtor_id: s.debtor_id,
          amount: s.amount,
          settled_at: s.settled ? createdAt : null,
          settlement_id: null,
        }));
      } catch {
        setNotice(ru.errors.purchaseFailed);
        return;
      }
      tracker.begin({
        id,
        clientKey: id,
        household_id: input.household_id,
        payer_id: me.id,
        amount: input.amount,
        description: input.description.trim(),
        merchant: input.merchant ? input.merchant : null,
        source: "manual",
        status: "shared",
        created_at: createdAt,
        shares,
      });
      patchPurchases(input.household_id);

      repo
        .createPurchase(input)
        .then((real) => {
          tracker.resolve(id, real); // the real row inherits the optimistic row's key: no second row appears
          if (alive.current) patchPurchases(input.household_id);
        })
        .catch((e: unknown) => {
          tracker.fail(id);
          if (!alive.current) return;
          patchPurchases(input.household_id);
          setNotice(e instanceof RepoError && e.code === "forbidden" ? ru.errors.generic : ru.errors.purchaseFailed);
        });
    },
    [repo, tracker, patchPurchases],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  const actions = useMemo<AppActions>(
    () => ({ setActiveId, refresh, refreshMembers, signOut, addPurchase, dismissNotice }),
    [refresh, refreshMembers, signOut, addPurchase, dismissNotice],
  );

  const data = useMemo<AppData>(() => {
    const stage = stageOf({ hasSession: !!snap.session, hasProfile: !!snap.me, householdCount: snap.households.length });
    const active = snap.households.some((h) => h.id === activeId) ? activeId : (snap.households[0]?.id ?? null);
    return { ...snap, status, stage, activeId: active };
  }, [snap, status, activeId]);

  return (
    <ActionsCtx.Provider value={actions}>
      <DataCtx.Provider value={data}>
        <NoticeCtx.Provider value={notice}>{children}</NoticeCtx.Provider>
      </DataCtx.Provider>
    </ActionsCtx.Provider>
  );
}
