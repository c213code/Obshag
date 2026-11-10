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
import { useAppActions, useAppData } from "../AppDataProvider";
import { RemindButton } from "../remind/RemindButton";
import { Screen } from "../Screen";
import { avatarColorFor } from "../avatars";
import { PaymentRow } from "./PaymentRow";

const chip = "rounded-pill bg-on-lime/10 px-3 py-[6px] text-label";
const fade = { duration: 0.2, ease: ease.smooth };

/** /purchases/[id], per Purchase.dc.html: lime card, «Кто скинул», delete. The payer can edit the description and delete. */
export function PurchaseDetailScreen() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { me, members, purchases, status } = useAppData();
  const { deletePurchase, editDescription } = useAppActions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
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
  const perText = amounts.length === 0 ? null : lo === hi ? formatTenge(lo) : hi - lo <= 1 ? `${formatNumber(lo)}–${formatTenge(hi)}` : null;
  const uneven = amounts.length > 0 && perText === null;

  // who already sent the money first (in the order they did), people still being waited for after them (Purchase.dc.html)
  const rows = purchase.shares
    .filter((s) => s.debtor_id !== purchase.payer_id && s.amount > 0)
    .sort((a, b) => (a.settled_at === null ? 1 : 0) - (b.settled_at === null ? 1 : 0) || (a.settled_at ?? "").localeCompare(b.settled_at ?? ""));
  const { paid, total } = purchaseProgress(purchase.payer_id, purchase.shares);

  const startEdit = () => {
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
        trailing={isPayer && !editing ? { label: ru.detail.edit, icon: <EditIcon size={18} />, onClick: startEdit } : undefined}
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
              const extra = uneven ? ` · ${formatTenge(s.amount)}` : "";
              const caption = received ? `${ru.detail.received(formatWhen(s.settled_at ?? "", { today: (t) => t, yesterday: (t) => t }))}${extra}` : `${ru.detail.waiting}${extra}`;
              return (
                <li key={s.debtor_id}>
                  <PaymentRow
                    name={name}
                    color={m ? avatarColorFor(m.profile, me.id) : "brown"}
                    received={received}
                    caption={caption}
                    action={isPayer && m ? <RemindButton householdId={purchase.household_id} debtorId={s.debtor_id} name={name} testId={`remind-${s.debtor_id}`} /> : null}
                  />
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      <div className="flex-1" />
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
    </Screen>
  );
}
