"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, m } from "motion/react";
import { Avatar } from "@/components/ui/Avatar";
import { BottomActions } from "@/components/ui/BottomActions";
import { Bar } from "@/components/ui/Bar";
import { cx } from "@/components/ui/cx";
import { Header } from "@/components/ui/Header";
import { CheckIcon, ExternalIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { useRepo } from "@/components/RepoProvider";
import { KASPI_TRANSFERS_URL } from "@/lib/clipboard";
import { getPublicEnv } from "@/lib/env/public";
import { postPaidOpened } from "@/lib/paidClient";
import { formatNumber, formatTenge } from "@/lib/format/money";
import { isAccumulating } from "@/lib/domain/minTransfer";
import { maskKaspiPhone } from "@/lib/domain/phoneFormat";
import { pairScreenState } from "@/lib/domain/settleNav";
import type { NetItem, PairNet } from "@/lib/domain/netting";
import { ease, useReducedMotionSafe } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";
import { useAppActions, useAppData } from "../AppDataProvider";
import { RemindButton } from "../remind/RemindButton";
import { Screen } from "../Screen";
import { avatarColorFor } from "../avatars";
import { EmptySettle } from "./EmptySettle";
import { IncomingRow } from "./IncomingRow";
import { PaidPromptSheet } from "./PaidPromptSheet";
import { PairScene } from "./PairScene";
import { useHeldIncoming } from "./useHeldIncoming";
import { useKaspiCopy } from "./useKaspiCopy";
import { usePaidPrompt } from "./usePaidPrompt";
import { WriteOffButton } from "./WriteOffButton";
import { useSettleData, type Incoming } from "./useSettleData";

const MAX_ITEMS = 3;

/** One column of Pay.dc.html: a colored label and the top shares behind that side, plus «и ещё N». */
function Side({ label, tone, items, testId }: { label: string; tone: "orange" | "lime"; items: ReadonlyArray<NetItem>; testId: string }) {
  const shown = items.slice(0, MAX_ITEMS);
  const rest = items.length - shown.length;
  return (
    <section data-testid={testId} className="flex flex-col gap-2 rounded-md border border-hairline bg-card px-[14px] py-3">
      <h3 className={tone === "orange" ? "text-label text-orange" : "text-label text-lime"}>{label}</h3>
      {shown.length === 0 ? <p className="text-caption">{ru.settle.nothingOnSide}</p> : null}
      {shown.map((i) => (
        <div key={i.purchase_id} className="flex justify-between gap-2 text-body">
          <span className="min-w-0 truncate">{i.description}</span>
          <span className="shrink-0 tabular-nums">{formatNumber(i.amount)}</span>
        </div>
      ))}
      {rest > 0 ? <p className="text-caption">{ru.settle.more(rest)}</p> : null}
    </section>
  );
}

/** /settle/[userId], per Pay.dc.html: capsule header, netting card, two columns, Kaspi bar, floating actions. */
export function SettleScreen() {
  const router = useRouter();
  const { userId } = useParams<{ userId: string }>();
  const { me } = useAppData();
  const { answerPaid, confirmReceived, cancelSettlement } = useAppActions();
  const repo = useRepo();
  const { reduced } = useReducedMotionSafe();
  const data = useSettleData();

  const liveIncoming = (data?.incoming ?? []).filter((r) => r.from.user_id === userId);
  const { rows: incomingRows, hold, release, snapshot: frozen } = useHeldIncoming<PairNet>(liveIncoming);
  const [busy, setBusy] = useState(false);
  const other = data?.memberOf(userId);
  const phone = other?.profile.kaspi_phone ?? null;
  const kaspi = useKaspiCopy(userId, phone);

  // «Ты перевёл?»: asked when the user comes back from Kaspi (or from the push with ?ask=1), only while there is something to pay
  const livePairNow = data && other ? data.pairWith(userId) : null;
  const canAsk =
    !!livePairNow && livePairNow.direction === "i_pay" && !isAccumulating(livePairNow.net) && !data?.outgoing.some((s) => s.to_id === userId);
  const [askOnMount] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ask") === "1");
  const { prompt, clear } = usePaidPrompt({ householdId: data?.householdId ?? null, userId, enabled: canAsk, askOnMount });

  // not a neighbour and no debt with them either: back to the list. A neighbour who LEFT but still has a debt stays here
  // (the list never sends the user back to such a person, so there is no loop).
  const state = data ? pairScreenState(userId, data.meId, data.net, (id) => !!data.memberOf(id)) : null;
  const departed = data?.net.counterparties.find((c) => c.userId === userId && !c.active) ?? null;
  const unknown = state === "unknown";
  useEffect(() => {
    if (unknown) router.replace("/settle");
  }, [unknown, router]);

  const back = () => (window.history.length > 1 ? router.back() : router.push("/"));

  if (!data || !me || unknown) return null;

  if (!other) {
    const amount = formatTenge(departed?.net ?? 0);
    return (
      <Screen topOffset={54} bottomRoom={false} gap={4} className="pb-10">
        <Header title={ru.settle.listTitle} onBack={back} />
        <div data-testid="settle-departed">
          <EmptySettle
            title={ru.settle.departed(ru.settle.departedName)}
            text={`${departed?.direction === "i_pay" ? ru.settle.iOwe(amount) : ru.settle.theyOwe(amount)}. ${ru.settle.departedText}`}
            action={ru.settle.evenAction}
            href="/settle"
          />
        </div>
      </Screen>
    );
  }

  const livePair = data.pairWith(userId);
  // while a «Получил» animation plays the screen keeps the numbers it had when the button was pressed
  const pair = frozen ?? livePair;
  const name = other.profile.display_name;
  const marked = data.outgoing.find((s) => s.to_id === userId) ?? null;
  // slice 19: my pending transfer is out of the net (it counts as paid), so the pair can be even while I still wait for them
  const pendingOnly = !!marked && pair.direction === "even" && incomingRows.length === 0;
  const even = pair.direction === "even" && incomingRows.length === 0 && !marked;
  const masked = maskKaspiPhone(other.profile.kaspi_phone);

  const transfer = () => {
    // both calls happen synchronously inside the tap: popup blockers and iOS only allow window.open there
    void kaspi.copy();
    window.open(KASPI_TRANSFERS_URL, "_blank", "noopener,noreferrer");
    if (!marked) void notifyOpened();
  };

  /** Tells the server the debtor went to pay: it asks «ты перевёл?» a couple of minutes later. Never blocks the tap. */
  const notifyOpened = async () => {
    const headers: Record<string, string> = {};
    if (getPublicEnv().NEXT_PUBLIC_DATA_MODE === "mock") {
      // mock mode has no cookie session on the server: the route trusts this header only behind the E2E store gate
      const session = await repo.getSession().catch(() => null);
      if (session) headers["x-mock-user"] = session.user_id;
    }
    await postPaidOpened({ household_id: data.householdId, to_user: userId }, headers);
  };

  const onCancel = async () => {
    if (busy || !marked) return;
    setBusy(true);
    try {
      await cancelSettlement(marked.id);
    } finally {
      setBusy(false);
    }
  };

  const onReceive = (row: Incoming) => {
    if (!hold(row, livePair)) return;
    // a refused confirmation takes the ✓ back instead of pretending it worked
    void confirmReceived(row.settlement.id).then((ok) => {
      if (!ok) release(row.settlement.id);
    });
  };

  const iPay = pair.direction === "i_pay";
  /** 1..99 ₸: Kaspi cannot transfer it. It accumulates; the creditor may write it off. */
  const small = pair.direction !== "even" && isAccumulating(pair.net);
  const fade = { duration: 0.3, ease: ease.smooth };
  /** Is there a main action next to «Отменить»? Without one the cancel pill takes the whole bar. */
  const hasMain = small ? !iPay : iPay || !pendingOnly;

  return (
    <Screen topOffset={54} bottomRoom={false} gap={4} className="pb-[132px]">
      <Header
        title={ru.settle.withName(name)}
        onBack={back}
      />

      {even ? (
        <EmptySettle />
      ) : (
        <>
          {marked ? (
            <section
              data-testid="waiting"
              role="status"
              className="enter flex items-center gap-3 rounded-lg border border-hairline bg-card px-4 py-4"
            >
              <Avatar name={name} color={avatarColorFor(other.profile, me.id)} size={40} decorative />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 text-[14px]">
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-orange" />
                  <span className="truncate">{ru.settle.waiting(name)}</span>
                </span>
                <span className="text-caption">{ru.settle.waitingCard(formatTenge(marked.amount))}</span>
              </div>
            </section>
          ) : null}
          {pair.direction !== "even" ? (
            <PairScene
              meName={me.display_name}
              otherName={name}
              meColor={avatarColorFor(me, me.id)}
              otherColor={avatarColorFor(other.profile, me.id)}
              iOwe={pair.iOwe}
              theyOwe={pair.theyOwe}
              net={pair.net}
              direction={pair.direction}
            />
          ) : null}

          {pendingOnly ? null : (
          <div className="grid grid-cols-2 gap-3">
            <Side testId="side-owe" label={ru.settle.toThem(name)} tone="orange" items={pair.myItems} />
            <Side testId="side-owed" label={ru.settle.toMe(name)} tone="lime" items={pair.theirItems} />
          </div>
          )}

          <AnimatePresence initial={false}>
            {incomingRows.map((r) => (
              <m.div
                key={r.settlement.id}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={fade}
              >
                <IncomingRow row={r} meId={data.meId} received={r.received} onReceive={onReceive} />
              </m.div>
            ))}
          </AnimatePresence>

          {pendingOnly ? null : small ? (
            <p data-testid="small-note" className="rounded-md border border-hairline bg-card px-4 py-3 text-caption">
              {iPay ? ru.settle.small.iOweNote(formatTenge(pair.net)) : ru.settle.small.theyOweNote(formatTenge(pair.net))}
            </p>
          ) : (
          <Bar className="pl-5" data-testid="kaspi-bar">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-caption">{ru.settle.kaspiOf(name)}</span>
              <span className="text-headline tabular-nums">{masked ?? ru.settle.noKaspi}</span>
            </div>
            {masked ? (
              <button
                type="button"
                onClick={() => void kaspi.copy()}
                aria-live="polite"
                className="inline-flex h-10 shrink-0 items-center justify-center gap-[6px] rounded-pill bg-card-2 px-[14px] text-[13px] font-semibold text-lime transition-transform duration-200 ease-smooth active:scale-[0.97]"
              >
                <AnimatePresence initial={false} mode="popLayout">
                  <m.span
                    key={kaspi.copied ? "copied" : "copy"}
                    className="inline-flex items-center gap-[6px]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: ease.smooth }}
                  >
                    {kaspi.copied ? <CheckIcon size={14} strokeWidth={3} /> : null}
                    {kaspi.copied ? ru.settle.copied : ru.settle.copy}
                  </m.span>
                </AnimatePresence>
              </button>
            ) : null}
          </Bar>
          )}
          {!pendingOnly && !small && kaspi.failed && phone ? (
            <p role="status" className="px-[6px] text-label text-orange">
              {ru.settle.copyFailed(phone)}
            </p>
          ) : null}
        </>
      )}

      {!even && (marked || !(small && iPay)) ? (
        <BottomActions barClassName="flex-1">
          <AnimatePresence initial={false}>
            {marked ? (
              <m.span
                key="cancel"
                className={hasMain ? undefined : "flex-1"}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: ease.smooth }}
              >
                <Pill
                  variant="ghost"
                  size="pay"
                  onClick={() => void onCancel()}
                  aria-disabled={busy}
                  className={cx(!hasMain && "w-full", busy && "!opacity-40")}
                >
                  {ru.settle.cancel}
                </Pill>
              </m.span>
            ) : null}
          </AnimatePresence>
          {small ? (
            iPay ? null : (
              <WriteOffButton householdId={data.householdId} debtorId={userId} name={name} amount={pair.net} size="pay" className="flex-1" testId="writeoff-pair" />
            )
          ) : iPay ? (
            <Pill variant="lime" size="pay" onClick={transfer} className="flex-1">
              {ru.settle.transfer(formatTenge(pair.net))}
              <ExternalIcon size={18} strokeWidth={2.2} />
            </Pill>
          ) : pendingOnly ? null : (
            <RemindButton householdId={data.householdId} debtorId={userId} name={name} variant="on" size="pay" className="flex-1" testId="remind-pair" />
          )}
        </BottomActions>
      ) : null}
      {prompt ? (
        <PaidPromptSheet
          key={prompt.id}
          name={name}
          amount={prompt.amount}
          onAnswer={(yes) => void answerPaid(prompt.id, yes)}
          onClosed={clear}
        />
      ) : null}
    </Screen>
  );
}
