"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRepo } from "@/components/RepoProvider";
import { PurchaseTracker, type UiPurchase } from "@/lib/data/purchaseTracker";
import { SettlementTracker } from "@/lib/data/settlementTracker";
import { markCovered, netPair, pairShares } from "@/lib/domain/netting";
import { stageOf, type Stage } from "@/lib/domain/guard";
import { splitEqual } from "@/lib/domain/split";
import type { ResolvePendingInput } from "@/lib/domain/schemas";
import { RepoError, type AuthSession, type MemberWithProfile, type NewCustomPurchase, type NewPurchase, type Repo } from "@/lib/data/repo";
import type { Bill, Household, Profile, Settlement } from "@/lib/data/types";
import { ru } from "@/lib/i18n/ru";
import { pendingJoin } from "@/lib/pendingJoin";
import { removeDevicePush, syncPush } from "@/lib/pushClient";
import { getPublicEnv } from "@/lib/env/public";

type Status = "loading" | "ready" | "error";

type Snapshot = {
  session: AuthSession | null;
  me: Profile | null;
  households: Household[];
  members: Record<string, MemberWithProfile[]>;
  purchases: Record<string, UiPurchase[]>;
  settlements: Record<string, Settlement[]>;
  bills: Record<string, Bill[]>;
};

const EMPTY: Snapshot = { session: null, me: null, households: [], members: {}, purchases: {}, settlements: {}, bills: {} };

/** What screens read. Changes whenever data changes. */
export type AppData = Snapshot & {
  status: Status;
  stage: Stage;
  activeId: string | null;
};

/** What screens call. Every function has a stable identity for the life of the provider, so using actions alone never re-renders. */
export type AppActions = {
  setActiveId(id: string): void;
  /** Switches the active household and remembers it (profiles.default_household_id), so Apple Pay captures land there too. */
  switchHousehold(id: string): Promise<void>;
  /** Reloads everything. By default a failure shows the retry screen; `silent` keeps the current data on screen. */
  refresh(opts?: { silent?: boolean }): Promise<void>;
  /** Reloads the roster of one household (a neighbour may have joined since the last load). */
  refreshMembers(householdId: string): Promise<void>;
  /** Resolves true when the user was signed out; on failure a notice explains and it resolves false. */
  signOut(): Promise<boolean>;
  /** Optimistic: the purchase shows up at once, and is rolled back (with a notice) if the server refuses it. Equal split, or explicit `shares` («Свои суммы»). */
  addPurchase(input: NewPurchase | NewCustomPurchase): void;
  /** Payer only. Optimistic: the row disappears at once and comes back with a notice if the server refuses (e.g. something was already paid). */
  deletePurchase(purchaseId: string): Promise<boolean>;
  /** Payer only. Optimistic: the new description shows at once; rolled back with a notice on failure. */
  editDescription(purchaseId: string, description: string): Promise<boolean>;
  /** My own «Напоминания» switch for one household. Optimistic, rolled back with a notice on failure. */
  setRemindersEnabled(householdId: string, enabled: boolean): Promise<boolean>;
  /** «Я оплатил»: optimistic `marked` settlement to `toUserId` for the current net. Resolves true when the server accepted it. */
  markPaid(householdId: string, toUserId: string): Promise<boolean>;
  /** «Получил»: optimistic confirm; the covered shares show as settled at once. Rolled back with a notice on failure. */
  confirmReceived(settlementId: string): Promise<boolean>;
  /** «Отменить» (by the debtor) or declining an incoming mark (by the creditor). */
  cancelSettlement(settlementId: string): Promise<boolean>;
  /**
   * Resolves a pending Apple Pay purchase (payer only). Optimistic: it shows as shared/personal at once; on failure it is
   * rolled back with a notice. Resolves true when the server accepted it (or it already had that state).
   */
  resolvePending(purchaseId: string, input: ResolvePendingInput): Promise<boolean>;
  /** Shows a toast. */
  showNotice(text: string): void;
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
      const [members, purchases, settlements, bills] = await Promise.all([
        repo.listMembers(h.id),
        repo.listPurchases(h.id),
        repo.listSettlements(h.id),
        repo.listBills(h.id),
      ]);
      return { id: h.id, members, purchases, settlements, bills };
    }),
  );
  return {
    session,
    me,
    households,
    members: Object.fromEntries(rows.map((r) => [r.id, r.members])),
    purchases: Object.fromEntries(rows.map((r) => [r.id, r.purchases])),
    settlements: Object.fromEntries(rows.map((r) => [r.id, r.settlements])),
    bills: Object.fromEntries(rows.map((r) => [r.id, r.bills])),
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
  const [settlementTracker] = useState(() => new SettlementTracker());
  const alive = useRef(true);
  const loadSeq = useRef(0);
  const latestLoad = useRef<Promise<void>>(Promise.resolve());
  const memberSeq = useRef(0);
  const tempId = useRef(0);
  /** What is on screen. Updated in the same step as the state, so an action right after a change reads the new value. */
  const snapRef = useRef<Snapshot>(EMPTY);
  /** The last lists the SERVER sent. Every optimistic view is built from these, never from the previous view, so a rollback cannot keep stale optimistic rows. */
  const serverRef = useRef<Pick<Loaded, "purchases" | "settlements">>({ purchases: {}, settlements: {} });
  const meRef = useRef<Profile | null>(null);
  const stageRef = useRef<Stage>(0);

  const commit = useCallback((update: (s: Snapshot) => Snapshot) => {
    const next = update(snapRef.current);
    snapRef.current = next;
    setSnap(next);
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Shares of every settlement this device confirmed but no load has confirmed yet show as settled. */
  const settledLocally = useCallback(
    (householdId: string, list: ReadonlyArray<UiPurchase>): UiPurchase[] => {
      const confirmed = settlementTracker.locallyConfirmed().filter((c) => c.household_id === householdId);
      if (confirmed.length === 0) return [...list];
      return list.map((p) => ({
        ...p,
        shares: confirmed.reduce((shares, c) => markCovered(c, shares, [p], c.confirmed_at ?? c.marked_at), p.shares),
      }));
    },
    [settlementTracker],
  );

  /** Server lists plus this device's in-flight and just-confirmed rows. */
  const withLocalRows = useCallback(
    (loaded: Loaded): Snapshot => {
      const settlements = Object.fromEntries(Object.entries(loaded.settlements).map(([id, list]) => [id, settlementTracker.view(id, list)]));
      return {
        ...loaded,
        settlements,
        purchases: Object.fromEntries(
          Object.entries(loaded.purchases).map(([id, list]) => [id, settledLocally(id, tracker.view(id, list))]),
        ),
      };
    },
    [tracker, settlementTracker, settledLocally],
  );

  /** Rebuilds one household's purchases and settlements from the last server lists plus this device's own changes. */
  const rebuild = useCallback(
    (householdId: string) =>
      commit((s) => ({
        ...s,
        settlements: { ...s.settlements, [householdId]: settlementTracker.view(householdId, serverRef.current.settlements[householdId] ?? []) },
        purchases: {
          ...s.purchases,
          [householdId]: settledLocally(householdId, tracker.view(householdId, serverRef.current.purchases[householdId] ?? [])),
        },
      })),
    [commit, tracker, settlementTracker, settledLocally],
  );
  const patchPurchases = rebuild;
  const patchSettlements = rebuild;

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
          serverRef.current = { purchases: next.purchases, settlements: next.settlements };
          commit(() => withLocalRows(next));
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
    [repo, withLocalRows, commit],
  );

  const refreshMembers = useCallback(
    async (householdId: string): Promise<void> => {
      const token = ++memberSeq.current;
      try {
        const list = await repo.listMembers(householdId);
        if (token !== memberSeq.current || !alive.current) return;
        commit((s) => (sameRoster(s.members[householdId], list) ? s : { ...s, members: { ...s.members, [householdId]: list } }));
      } catch {
        // keep the roster we have; the next focus or screen entry tries again
      }
    },
    [repo, commit],
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

  // the worker re-subscribed after the push service rotated the subscription: save the new one
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === "push-resubscribed") void syncPush(repo, getPublicEnv().NEXT_PUBLIC_VAPID_PUBLIC_KEY);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [repo]);

  const signOut = useCallback(async (): Promise<boolean> => {
    await removeDevicePush(repo); // while still signed in: RLS lets only the owner delete the row
    try {
      await repo.signOut();
    } catch {
      setNotice(ru.errors.signOutFailed);
      return false;
    }
    pendingJoin.clear(); // a deep link remembered for the previous user must not follow the next one
    loadSeq.current++; // any load still in flight belongs to the old session
    tracker.clear();
    settlementTracker.clear();
    serverRef.current = { purchases: {}, settlements: {} };
    meRef.current = null;
    stageRef.current = 0;
    setActiveId(null);
    commit(() => EMPTY);
    return true;
  }, [repo, tracker, settlementTracker, commit]);

  const addPurchase = useCallback(
    (input: NewPurchase | NewCustomPurchase) => {
      const me = meRef.current;
      if (!me) return;
      const id = `optimistic-${++tempId.current}`;
      const createdAt = new Date().toISOString();
      let shares;
      try {
        shares =
          "shares" in input
            ? input.shares.map((r) => ({
                purchase_id: id,
                debtor_id: r.user_id,
                amount: r.amount,
                settled_at: r.user_id === me.id ? createdAt : null,
                settlement_id: null,
              }))
            : splitEqual(input.amount, input.participant_ids, me.id).map((s) => ({
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

      ("shares" in input ? repo.createPurchaseCustom(input) : repo.createPurchase(input))
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

  const findPurchase = useCallback(
    (id: string) =>
      Object.values(snapRef.current.purchases)
        .flat()
        .find((p) => p.id === id),
    [],
  );

  const deletePurchase = useCallback(
    async (purchaseId: string): Promise<boolean> => {
      const me = meRef.current;
      const current = findPurchase(purchaseId);
      if (!me || !current || current.payer_id !== me.id || purchaseId.startsWith("optimistic-")) return false;
      tracker.remove(purchaseId);
      patchPurchases(current.household_id);
      try {
        await repo.deletePurchase(purchaseId);
        if (alive.current) void refresh({ silent: true });
        return true;
      } catch (e) {
        tracker.restore(purchaseId);
        if (alive.current) {
          patchPurchases(current.household_id);
          setNotice(e instanceof RepoError && e.code === "has_payments" ? ru.detail.errors.hasPayments : ru.detail.errors.deleteFailed);
          void refresh({ silent: true });
        }
        return false;
      }
    },
    [repo, tracker, patchPurchases, refresh, findPurchase],
  );

  const editDescription = useCallback(
    async (purchaseId: string, description: string): Promise<boolean> => {
      const me = meRef.current;
      const current = findPurchase(purchaseId);
      const text = description.trim();
      if (!me || !current || current.payer_id !== me.id || text === "" || text.length > 200) return false;
      if (text === current.description) return true;
      tracker.rename(purchaseId, text);
      patchPurchases(current.household_id);
      try {
        await repo.updatePurchaseDescription(purchaseId, text);
        if (alive.current) void refresh({ silent: true });
        return true;
      } catch {
        tracker.unrename(purchaseId);
        if (alive.current) {
          patchPurchases(current.household_id);
          setNotice(ru.detail.errors.editFailed);
          void refresh({ silent: true });
        }
        return false;
      }
    },
    [repo, tracker, patchPurchases, refresh, findPurchase],
  );

  const setRemindersEnabled = useCallback(
    async (householdId: string, enabled: boolean): Promise<boolean> => {
      const me = meRef.current;
      if (!me) return false;
      const apply = (value: boolean) =>
        commit((s) => ({
          ...s,
          members: {
            ...s.members,
            [householdId]: (s.members[householdId] ?? []).map((m) => (m.user_id === me.id ? { ...m, reminders_enabled: value } : m)),
          },
        }));
      const before = (snapRef.current.members[householdId] ?? []).find((m) => m.user_id === me.id)?.reminders_enabled !== false;
      apply(enabled);
      try {
        await repo.setRemindersEnabled(householdId, enabled);
        return true;
      } catch {
        if (alive.current) {
          apply(before);
          setNotice(ru.flat.remindersFailed);
        }
        return false;
      }
    },
    [repo, commit],
  );

  const markPaid = useCallback(
    async (householdId: string, toUserId: string): Promise<boolean> => {
      const me = meRef.current;
      if (!me) return false;
      const optimisticId = `optimistic-s-${++tempId.current}`;
      // the optimistic amount is only for display: the backend recomputes the net and the real row replaces this one
      const shown = snapRef.current;
      const ps = shown.purchases[householdId] ?? [];
      const pair = netPair(me.id, toUserId, ps.flatMap((p) => p.shares), ps);
      if (pair.direction !== "i_pay") return false;
      const existing = (shown.settlements[householdId] ?? []).find((x) => x.status === "marked" && x.from_id === me.id && x.to_id === toUserId);
      if (existing) return true; // a second tap changes nothing
      settlementTracker.begin({
        id: optimisticId,
        household_id: householdId,
        from_id: me.id,
        to_id: toUserId,
        amount: pair.net,
        status: "marked",
        marked_at: new Date().toISOString(),
        confirmed_at: null,
        covered: pairShares(me.id, toUserId, ps.flatMap((p) => p.shares), ps),
      });
      patchSettlements(householdId);
      try {
        const real = await repo.markSettlement(householdId, toUserId);
        settlementTracker.resolve(optimisticId, real);
        if (alive.current) patchSettlements(householdId);
        return true;
      } catch (e) {
        settlementTracker.release(optimisticId);
        if (alive.current) {
          patchSettlements(householdId);
          const code = e instanceof RepoError ? e.code : null;
          setNotice(
            code === "invalid" ? ru.settle.errors.nothingToPay : code === "rate_limited" ? ru.settle.errors.rateLimited : ru.settle.errors.markFailed,
          );
          void refresh({ silent: true });
        }
        return false;
      }
    },
    [repo, settlementTracker, patchSettlements, refresh],
  );

  const changeSettlement = useCallback(
    async (settlementId: string, status: "confirmed" | "cancelled"): Promise<boolean> => {
      const current = Object.values(snapRef.current.settlements)
        .flat()
        .find((x) => x.id === settlementId);
      if (!current || current.status !== "marked") return false; // double taps and stale rows do nothing
      const at = new Date().toISOString();
      settlementTracker.patch({ ...current, status, confirmed_at: status === "confirmed" ? at : null });
      patchSettlements(current.household_id);
      try {
        const real = status === "confirmed" ? await repo.confirmSettlement(settlementId, current.amount) : await repo.cancelSettlement(settlementId);
        settlementTracker.patch({ ...real, covered: real.covered.length > 0 ? real.covered : current.covered });
        patchSettlements(current.household_id);
        // the covered shares are now settled on the server: pull the truth (balances, progress)
        if (alive.current) await refresh({ silent: true });
        return true;
      } catch (e) {
        // roll back to the last server lists straight away: this must not wait for (or depend on) a refresh that may fail too
        settlementTracker.release(settlementId);
        if (alive.current) patchSettlements(current.household_id);
        if (e instanceof RepoError && e.code === "stale" && status === "confirmed") {
          // the books changed after «я оплатил»: withdraw the mark so the debtor can mark the new amount
          await repo.cancelSettlement(settlementId).catch(() => undefined);
          if (alive.current) setNotice(ru.settle.errors.stale);
        } else if (alive.current) {
          setNotice(status === "confirmed" ? ru.settle.errors.confirmFailed : ru.settle.errors.cancelFailed);
        }
        if (alive.current) await refresh({ silent: true });
        return false;
      }
    },
    [repo, settlementTracker, patchSettlements, refresh],
  );
  const confirmReceived = useCallback((id: string) => changeSettlement(id, "confirmed"), [changeSettlement]);
  const cancelSettlement = useCallback((id: string) => changeSettlement(id, "cancelled"), [changeSettlement]);

  const resolvePending = useCallback(
    async (purchaseId: string, input: ResolvePendingInput): Promise<boolean> => {
      const me = meRef.current;
      if (!me) return false;
      const current = Object.values(snapRef.current.purchases)
        .flat()
        .find((p) => p.id === purchaseId);
      if (!current || current.status !== "pending") return false; // double taps and stale rows do nothing
      const description = input.description && input.description.trim() !== "" ? input.description.trim() : current.description;
      let shares: UiPurchase["shares"] = [];
      if (input.shared) {
        try {
          const at = new Date().toISOString();
          shares = splitEqual(current.amount, input.participant_ids ?? [], me.id).map((s) => ({
            purchase_id: current.id,
            debtor_id: s.debtor_id,
            amount: s.amount,
            settled_at: s.settled ? at : null,
            settlement_id: null,
          }));
        } catch {
          setNotice(ru.pending.errors.resolveFailed);
          return false;
        }
      }
      tracker.override({ ...current, description, status: input.shared ? "shared" : "personal", shares });
      patchPurchases(current.household_id);
      try {
        const real = await repo.resolvePending(purchaseId, input);
        tracker.override(real);
        if (alive.current) patchPurchases(current.household_id);
        return true;
      } catch (e) {
        tracker.dropOverride(purchaseId);
        if (alive.current) {
          patchPurchases(current.household_id);
          setNotice(e instanceof RepoError && (e.code === "invalid" || e.code === "not_found") ? ru.pending.errors.alreadyResolved : ru.pending.errors.resolveFailed);
          void refresh({ silent: true });
        }
        return false;
      }
    },
    [repo, tracker, patchPurchases, refresh],
  );

  const switchHousehold = useCallback(
    async (id: string): Promise<void> => {
      setActiveId(id);
      commit((s) => (s.me ? { ...s, me: { ...s.me, default_household_id: id } } : s));
      try {
        await repo.setDefaultHousehold(id);
      } catch {
        if (alive.current) setNotice(ru.flat.errors.switchFailed);
      }
    },
    [repo, commit],
  );

  const showNotice = useCallback((text: string) => setNotice(text), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const actions = useMemo<AppActions>(
    () => ({ setActiveId, switchHousehold, refresh, refreshMembers, signOut, addPurchase, deletePurchase, editDescription, setRemindersEnabled, markPaid, confirmReceived, cancelSettlement, resolvePending, showNotice, dismissNotice }),
    [switchHousehold, refresh, refreshMembers, signOut, addPurchase, deletePurchase, editDescription, setRemindersEnabled, markPaid, confirmReceived, cancelSettlement, resolvePending, showNotice, dismissNotice],
  );

  const data = useMemo<AppData>(() => {
    const stage = stageOf({ hasSession: !!snap.session, hasProfile: !!snap.me, householdCount: snap.households.length });
    const has = (id: string | null | undefined): id is string => !!id && snap.households.some((h) => h.id === id);
    const active = has(activeId) ? activeId : has(snap.me?.default_household_id) ? snap.me.default_household_id : (snap.households[0]?.id ?? null);
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
