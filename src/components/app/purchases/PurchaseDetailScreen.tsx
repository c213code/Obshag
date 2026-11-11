"use client";

import { canDelete } from "@/lib/domain/canDelete";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, m } from "motion/react";
import { Header } from "@/components/ui/Header";
import { EditIcon } from "@/components/ui/icons";
import { Money } from "@/components/ui/Money";
import { Pill, PillLink } from "@/components/ui/Pill";
import { purchaseProgress } from "@/lib/domain/summary";
import { formatWhen } from "@/lib/format/date";
import { formatNumber, formatTenge } from "@/lib/format/money";
import { ease } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";
import { isAccumulating } from "@/lib/domain/minTransfer";
import { deriveEqual, orderSplit } from "@/lib/domain/orders";
import { useAppActions, useAppData } from "../AppDataProvider";
import { useSettleData } from "../settle/useSettleData";
import { RemindButton } from "../remind/RemindButton";
import { Screen } from "../Screen";
import { avatarColorFor } from "../avatars";
import { EditPurchaseSheet } from "./EditPurchaseSheet";
import { PaymentRow } from "./PaymentRow";

const chip = "rounded-pill bg-on-lime/10 px-3 py-[6px] text-label";
const fade = { duration: 0.2, ease: ease.smooth };

/** /purchases/[id], per Purchase.dc.html: lime card, «Кто скинул», delete. The payer can edit the description and delete. */
export function PurchaseDetailScreen() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { me, members, purchases, settlements, status } = useAppData();
  const settle = useSettleData();
  const { deletePurchase, editDescription } = useAppActions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0); // a fresh form (from the saved purchase) on every open
  const inputRef = useRef<HTMLInputElement>(null);

  const purchase = useMemo(() => Object.values(purchases).flat().find((p) => p.id === id), [purchases, id]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const back = () => (window.history.length > 1 ? router.back() : router.replace("/purchases"));

  if (!me || status !== "ready") return null;
  if (!purchase) {
    return (
      <Screen topOffset={54} bottomRoom={false} gap={4} className="pb-10">
        <Header title={ru.detail.title} onBack={back} />
        <div className="flex flex-col items-start gap-3 rounded-lg bg-card p-5" data-testid="purchase-missing">
          <p className="text-headline">{ru.detail.notFoundTitle}</p>
          <p className="text-caption">{ru.detail.notFoundText}</p>
          <PillLink href="/purchases" variant="lime">
            {ru.purchases.title}
          </PillLink>
        </div>
      </Screen>
    );
  }

  const roster = new Map((members[purchase.household_id] ?? []).map((m) => [m.user_id, m]));
  const isPayer = purchase.payer_id === me.id;
  const payerName = isPayer ? null : (roster.get(purchase.payer_id)?.profile.display_name ?? ru.main.formerMember);
  const when = formatWhen(purchase.created_at, { today: ru.detail.today, yesterday: ru.detail.yesterday });
  const byline = [purchase.merchant, when, isPayer ? ru.detail.payerYou : ru.detail.payer(payerName ?? "")].filter(Boolean).join(" · ");

  const owing = purchase.shares.filter((s) => s.amount > 0);
  const amounts = owing.map((s) => s.amount);
  const lo = Math.min(...amounts);
  const hi = Math.max(...amounts);
  const orders = purchase.orders ?? [];
  // an equal split with orders: the chip shows the equal part, not «свои суммы»
  const derived = deriveEqual(purchase);
  const eachSplit = derived && orders.length > 0 ? orderSplit(purchase.amount, derived.participants, derived.orders, purchase.payer_id) : null;
  const eachText = eachSplit && !eachSplit.issue ? (eachSplit.each.min === eachSplit.each.max ? formatTenge(eachSplit.each.min) : `${formatNumber(eachSplit.each.min)}–${formatTenge(eachSplit.each.max)}`) : null;
  const perText = eachText ?? (amounts.length === 0 ? null : lo === hi ? formatTenge(lo) : hi - lo <= 1 ? `${formatNumber(lo)}–${formatTenge(hi)}` : null);
  const uneven = amounts.length > 0 && perText === null;
  // the full edit (amount, payer, participants, orders): payer or admin, shared, not a bill, nothing paid yet, an equal split
  const isAdmin = (members[purchase.household_id] ?? []).some((x) => x.user_id === me.id && x.active && x.role === "admin");
  const paidAny = purchase.shares.some((s) => s.settlement_id !== null || (s.settled_at !== null && s.debtor_id !== purchase.payer_id));
  const fullEdit = purchase.status === "shared" && !purchase.bill_id && (isPayer || isAdmin) && !paidAny && derived !== null && !purchase.id.startsWith("optimistic-");

  // who already sent the money first (in the order they did), people still being waited for after them (Purchase.dc.html)
  const rows = purchase.shares
    .filter((s) => s.debtor_id !== purchase.payer_id && s.amount > 0)
    .sort((a, b) => (a.settled_at === null ? 1 : 0) - (b.settled_at === null ? 1 : 0) || (a.settled_at ?? "").localeCompare(b.settled_at ?? ""));
  const { paid, total } = purchaseProgress(purchase.payer_id, purchase.shares);
  // my open share is under the Kaspi minimum: it is not asked for on its own, it joins the next settlement
  const mine = purchase.status === "shared" && !isPayer ? purchase.shares.find((s) => s.debtor_id === me.id) : undefined;
  const myShare = mine && mine.settled_at === null && isAccumulating(mine.amount) ? mine : null;
  // my share is still open: pay the payer from here (the transfer is the pair's net, so the other purchases between us count too)
  const open = mine && mine.settled_at === null && mine.settlement_id === null && mine.amount > 0 ? mine : null;
  const pair = open && settle ? settle.pairWith(purchase.payer_id) : null;
  const canPay = pair !== null && pair.direction === "i_pay" && !isAccumulating(pair.net) && roster.get(purchase.payer_id)?.active === true;
  const nettedOut = pair !== null && pair.direction !== "i_pay";
  const writeoffs = new Map((settlements[purchase.household_id] ?? []).filter((x) => x.kind === "writeoff").map((x) => [x.id, x]));

  const startEdit = () => {
    if (fullEdit) {
      setSheetKey((k) => k + 1);
      setSheetOpen(true);
      return;
    }
    setDraft(purchase.description);
    setConfirming(false);
    setEditing(true);
  };
  const saveEdit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (text === "") return;
    setEditing(false);
    void editDescription(purchase.id, text); // optimistic: the card shows the new text at once
  };
  const remove = () => {
    router.replace("/purchases"); // the row is gone from the list at once; it comes back with a notice if the server refuses
    void deletePurchase(purchase.id);
  };

  return (
    <Screen topOffset={54} bottomRoom={false} gap={4} className="min-h-dvh pb-[30px]">
      <Header
        title={ru.detail.title}
        onBack={back}
        trailing={(isPayer || fullEdit) && !editing ? { label: ru.detail.edit, icon: <EditIcon size={18} />, onClick: startEdit } : undefined}
      />

      <section aria-label={purchase.description} className="relative flex flex-col gap-3 overflow-hidden rounded-lg bg-lime p-5 text-on-lime">
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 200 200"
          className="pointer-events-none absolute -right-[50px] -bottom-[60px] size-[200px]"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.08"
        >
          <circle cx="100" cy="100" r="90" strokeWidth="22" />
        </svg>
        <div className="relative flex flex-col gap-1">
          {editing ? (
            <form onSubmit={saveEdit} className="flex flex-col gap-2" data-testid="edit-form">
              <input
                ref={inputRef}
                aria-label={ru.detail.editTitle}
                value={draft}
                maxLength={200}
                placeholder={ru.detail.editPlaceholder}
                enterKeyHint="done"
                autoComplete="off"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditing(false);
                }}
                className="h-11 w-full rounded-pill border-0 bg-on-lime/10 px-4 text-headline text-on-lime outline-none placeholder:text-on-lime/50"
              />
              <div className="flex gap-2">
                <Pill type="submit" variant="ghost" size="row" disabled={draft.trim() === ""} className="flex-1 !bg-on-lime !text-lime">
                  {ru.detail.editSave}
                </Pill>
                <Pill variant="ghost" size="row" onClick={() => setEditing(false)} className="flex-1 !bg-on-lime/10 !text-on-lime">
                  {ru.detail.editCancel}
                </Pill>
              </div>
            </form>
          ) : (
            <h1 className="text-headline" data-testid="purchase-title">
              {purchase.description}
            </h1>
          )}
          <span className="text-label" data-testid="purchase-byline">
            {byline}
          </span>
        </div>
        <Money value={purchase.amount} duration={0} className="relative text-display" />
        <div className="relative flex gap-2">
          {purchase.status === "personal" ? (
            <span className={chip}>{ru.main.personal}</span>
          ) : owing.length > 0 ? (
            <>
              <span className={chip}>{ru.detail.people(owing.length)}</span>
              <span className={chip}>{uneven ? ru.detail.customAmounts : ru.detail.perPerson(perText ?? "")}</span>
            </>
          ) : null}
        </div>
      </section>

      {myShare ? (
        <p data-testid="small-share-note" className="rounded-md border border-hairline bg-card px-4 py-3 text-caption">
          {ru.detail.smallShare(formatTenge(myShare.amount))}
        </p>
      ) : null}

      {orders.length > 0 ? (
        <section aria-label={ru.detail.ordersTitle} data-testid="purchase-orders" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between px-[6px]">
            <h2 className="text-headline">{ru.detail.ordersTitle}</h2>
            <span className="text-label">{ru.detail.ordersCaption}</span>
          </div>
          <ul className="flex flex-col gap-2">
            {orders.map((o, i) => {
              const name = o.user_id === me.id ? ru.main.you : (roster.get(o.user_id)?.profile.display_name ?? ru.main.formerMember);
              return (
                <li key={`${o.user_id}-${i}`} data-testid="purchase-order" className="flex items-center justify-between gap-3 rounded-md bg-card px-4 py-3">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body">{name}</span>
                    {o.note ? <span className="truncate text-caption">{o.note}</span> : null}
                  </span>
                  <span className="shrink-0 font-rounded text-headline tabular-nums">{formatTenge(o.amount)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {rows.length > 0 ? (
        <>
          <div className="flex items-baseline justify-between px-[6px]">
            <h2 className="text-headline">{ru.detail.whoPaid}</h2>
            <span className="text-label !text-lime" data-testid="purchase-progress">
              {ru.detail.progress(paid, total)}
            </span>
          </div>
          <ul className="flex flex-col gap-2">
            {rows.map((s) => {
              const m = roster.get(s.debtor_id);
              const name = s.debtor_id === me.id ? ru.main.you : (m?.profile.display_name ?? ru.main.formerMember);
              const received = s.settled_at !== null;
              const extra = uneven || orders.length > 0 ? ` · ${formatTenge(s.amount)}` : "";
              const writtenOff = s.settlement_id ? writeoffs.get(s.settlement_id) : undefined;
              const caption = writtenOff ? ru.detail.writtenOff(formatTenge(s.amount)) : received ? `${ru.detail.received(formatWhen(s.settled_at ?? "", { today: (t) => t, yesterday: (t) => t }))}${extra}` : `${ru.detail.waiting}${extra}`;
              return (
                <li key={s.debtor_id}>
                  <PaymentRow
                    name={name}
                    color={m ? avatarColorFor(m.profile, me.id) : "brown"}
                    received={received}
                    caption={caption}
                    action={isPayer && m && !(settle && isAccumulating(settle.pairWith(s.debtor_id).net)) ? <RemindButton householdId={purchase.household_id} debtorId={s.debtor_id} name={name} testId={`remind-${s.debtor_id}`} /> : null}
                  />
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      <div className="flex-1" />
      {canPay && pair ? (
        <div className="flex flex-col items-center gap-2" data-testid="detail-pay">
          <PillLink href={`/settle/${purchase.payer_id}`} prefetch={false} variant="lime" size="lg" className="w-full" data-testid="detail-pay-link">
            {ru.detail.payTo(payerName ?? "", formatTenge(pair.net))}
          </PillLink>
          {pair.net !== open?.amount ? <span className="text-center text-caption">{ru.detail.payNetted}</span> : null}
        </div>
      ) : nettedOut ? (
        <p data-testid="detail-netted" className="rounded-md border border-hairline bg-card px-4 py-3 text-caption">
          {ru.detail.nettedOut(payerName ?? "")}
        </p>
      ) : null}
      {canDelete(purchase, me.id, members[purchase.household_id]) && !editing ? (
        <div className="flex justify-center">
          <AnimatePresence initial={false} mode="popLayout">
            {confirming ? (
              <m.div
                key="ask"
                role="alertdialog"
                aria-label={ru.detail.deleteAsk}
                className="flex items-center gap-2 rounded-pill border border-danger-line py-[6px] pr-[6px] pl-5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={fade}
              >
                <span className="text-body !text-danger">{ru.detail.deleteAsk}</span>
                <Pill variant="ghost" size="row" onClick={remove} className="!bg-danger !text-bg" data-testid="delete-confirm">
                  {ru.detail.deleteConfirm}
                </Pill>
                <Pill variant="on" size="row" onClick={() => setConfirming(false)}>
                  {ru.detail.deleteCancel}
                </Pill>
              </m.div>
            ) : (
              <m.button
                key="ask-trigger"
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-pill border border-danger-line px-5 py-3 text-body !text-danger transition-transform duration-200 ease-smooth active:scale-[0.97]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={fade}
              >
                {ru.detail.delete}
              </m.button>
            )}
          </AnimatePresence>
        </div>
      ) : null}
      {fullEdit ? <EditPurchaseSheet key={sheetKey} purchase={purchase} roster={members[purchase.household_id] ?? []} meId={me.id} open={sheetOpen} onClose={() => setSheetOpen(false)} /> : null}
    </Screen>
  );
}
