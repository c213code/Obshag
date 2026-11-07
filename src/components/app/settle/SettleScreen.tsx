"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { BottomActions } from "@/components/ui/BottomActions";
import { Bar } from "@/components/ui/Bar";
import { Header } from "@/components/ui/Header";
import { CheckIcon, ExternalIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { KASPI_TRANSFERS_URL } from "@/lib/clipboard";
import { formatNumber, formatTenge } from "@/lib/format/money";
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
import { PairScene } from "./PairScene";
import { useHeldIncoming } from "./useHeldIncoming";
import { useKaspiCopy } from "./useKaspiCopy";
import { useSettleData, type Incoming } from "./useSettleData";

const MAX_ITEMS = 3;
/** «Я оплатил» turns into «Отменить» under the same finger: a tap that close to the first one is the same gesture. */
const CANCEL_GUARD_MS = 350;

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
  const { markPaid, confirmReceived, cancelSettlement } = useAppActions();
  const { reduced } = useReducedMotionSafe();
  const data = useSettleData();

  const liveIncoming = (data?.incoming ?? []).filter((r) => r.from.user_id === userId);
  const { rows: incomingRows, hold, release, snapshot: frozen } = useHeldIncoming<PairNet>(liveIncoming);
  const [busy, setBusy] = useState(false);
  /** True for CANCEL_GUARD_MS after «Я оплатил»: «Отменить» is dimmed and aria-disabled meanwhile. */
  const [guarded, setGuarded] = useState(false);
  const guardUntil = useRef(0);
  const guardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const other = data?.memberOf(userId);
  const phone = other?.profile.kaspi_phone ?? null;
  const kaspi = useKaspiCopy(userId, phone);

  useEffect(
    () => () => {
      if (guardTimer.current) clearTimeout(guardTimer.current);
    },
    [],
  );

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
  const even = pair.direction === "even" && incomingRows.length === 0;
  const masked = maskKaspiPhone(other.profile.kaspi_phone);

  const transfer = () => {
    // both calls happen synchronously inside the tap: popup blockers and iOS only allow window.open there
    void kaspi.copy();
    window.open(KASPI_TRANSFERS_URL, "_blank", "noopener,noreferrer");
  };

  const onPaid = async (e: MouseEvent) => {
    if (busy) return;
    setBusy(true);
    guardUntil.current = e.timeStamp + CANCEL_GUARD_MS;
    setGuarded(true);
    if (guardTimer.current) clearTimeout(guardTimer.current);
    guardTimer.current = setTimeout(() => setGuarded(false), CANCEL_GUARD_MS);
    try {
      await markPaid(data.householdId, userId);
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async (e: MouseEvent) => {
    if (busy || !marked || e.timeStamp < guardUntil.current) return;
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
  const fade = { duration: 0.3, ease: ease.smooth };

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
              waitingLabel={iPay && marked ? ru.settle.waiting(name) : undefined}
            />
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Side testId="side-owe" label={ru.settle.toThem(name)} tone="orange" items={pair.myItems} />
            <Side testId="side-owed" label={ru.settle.toMe(name)} tone="lime" items={pair.theirItems} />
          </div>

          <AnimatePresence initial={false}>
            {incomingRows.map((r) => (
              <motion.div
                key={r.settlement.id}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={fade}
              >
                <IncomingRow row={r} meId={data.meId} received={r.received} onReceive={onReceive} />
              </motion.div>
            ))}
          </AnimatePresence>

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
                  <motion.span
                    key={kaspi.copied ? "copied" : "copy"}
                    className="inline-flex items-center gap-[6px]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: ease.smooth }}
                  >
                    {kaspi.copied ? <CheckIcon size={14} strokeWidth={3} /> : null}
                    {kaspi.copied ? ru.settle.copied : ru.settle.copy}
                  </motion.span>
                </AnimatePresence>
              </button>
            ) : null}
          </Bar>
          {kaspi.failed && phone ? (
            <p role="status" className="px-[6px] text-label text-orange">
              {ru.settle.copyFailed(phone)}
            </p>
          ) : null}
        </>
      )}

      {!even ? (
        <BottomActions barClassName="flex-1">
          {iPay ? (
            <>
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={marked ? "cancel" : "paid"}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: ease.smooth }}
                >
                  {marked ? (
                    <Pill
                      variant="ghost"
                      size="pay"
                      onClick={(e) => void onCancel(e)}
                      aria-disabled={guarded || busy}
                      className={guarded || busy ? "!opacity-40" : undefined}
                    >
                      {ru.settle.cancel}
                    </Pill>
                  ) : (
                    <Pill variant="on" size="pay" onClick={(e) => void onPaid(e)} disabled={busy}>
                      {ru.settle.paid}
                    </Pill>
                  )}
                </motion.span>
              </AnimatePresence>
              <Pill variant="lime" size="pay" onClick={transfer} className="flex-1">
                {ru.settle.transfer(formatTenge(pair.net))}
                <ExternalIcon size={18} strokeWidth={2.2} />
              </Pill>
            </>
          ) : (
            <RemindButton householdId={data.householdId} debtorId={userId} name={name} variant="on" size="pay" className="flex-1" testId="remind-pair" />
          )}
        </BottomActions>
      ) : null}
    </Screen>
  );
}
