"use client";

import { m, AnimatePresence } from "motion/react";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";
import type { MemberWithProfile } from "@/lib/data/repo";
import { sanitizeAmountText } from "@/lib/domain/customSplit";
import { MAX_ORDERS, ORDER_NOTE_MAX, type OrderDraft, type OrderIssue, type OrderSplit } from "@/lib/domain/orders";
import { formatNumber, formatTenge } from "@/lib/format/money";
import { ease } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";
import { avatarColorFor } from "../avatars";
import { PersonChip } from "./PersonChip";

const label = "pl-[6px] text-caption";
let seq = 0;
export const newDraft = (): OrderDraft => ({ key: `d${++seq}`, user_id: null, amount: "", note: "" });

const issueText: Record<OrderIssue, string | null> = {
  payer: ru.orders.payer,
  empty: null,
  too_many: ru.orders.tooMany,
  too_big: ru.orders.tooBig,
  rest_small: ru.orders.restSmall,
  no_participants: null,
};

/**
 * «+ Заказ» under the participants: personal orders inside a shared purchase. One row = who (chips) + amount + a note.
 * The preview line shows the equal part and what the people with orders pay in total. Pure view, the parent owns the rows.
 */
export function OrdersEditor({
  roster,
  meId,
  payerId,
  drafts,
  onChange,
  split,
}: {
  roster: ReadonlyArray<MemberWithProfile>;
  meId: string;
  payerId: string;
  drafts: ReadonlyArray<OrderDraft>;
  onChange: (next: OrderDraft[]) => void;
  /** The live result of orderSplit for the complete rows; null while nothing is ordered. */
  split: OrderSplit | null;
}) {
  const candidates = roster.filter((m) => m.user_id !== payerId);
  if (candidates.length === 0 && drafts.length === 0) return null;
  const patch = (key: string, p: Partial<OrderDraft>) => onChange(drafts.map((d) => (d.key === key ? { ...d, ...p } : d)));
  const nameOf = (id: string) => roster.find((m) => m.user_id === id)?.profile.display_name ?? ru.main.formerMember;

  const unfinished = drafts.some((d) => !d.user_id || !(Number(d.amount) > 0));
  const issue = split?.issue ? issueText[split.issue] : null;
  const each = split && !split.issue ? (split.each.min === split.each.max ? formatTenge(split.each.min) : `${formatNumber(split.each.min)}–${formatTenge(split.each.max)}`) : null;
  const people = split && !split.issue ? orderedTotals(split, drafts) : [];

  return (
    <div className="flex flex-col gap-2" data-testid="orders">
      <AnimatePresence initial={false}>
        {drafts.map((d, i) => (
          <m.div
            key={d.key}
            data-testid="order-row"
            role="group"
            aria-label={ru.orders.rowLabel(i + 1)}
            className="flex flex-col gap-2 overflow-hidden rounded-md border border-card-2 bg-card p-3"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: ease.smooth }}
          >
            <div className="flex items-center justify-between pr-[2px]">
              <span className={label}>{ru.orders.whose}</span>
              <button
                type="button"
                aria-label={ru.orders.remove}
                data-testid="order-remove"
                onClick={() => onChange(drafts.filter((x) => x.key !== d.key))}
                className="grid size-7 place-items-center rounded-full text-muted transition-transform duration-200 ease-smooth active:scale-[0.92]"
              >
                <CloseIcon size={14} strokeWidth={2.2} />
              </button>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label={ru.orders.whose}>
              {candidates.map((m) => (
                <PersonChip
                  key={m.user_id}
                  name={m.profile.display_name}
                  initialsOf={m.profile.display_name}
                  color={avatarColorFor(m.profile, meId)}
                  selected={d.user_id === m.user_id}
                  onToggle={() => patch(d.key, { user_id: d.user_id === m.user_id ? null : m.user_id })}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label className="flex w-[132px] shrink-0 items-center gap-1 rounded-pill border border-card-2 bg-card-2 py-[9px] pr-4 pl-4 focus-within:border-lime">
                <input
                  aria-label={ru.orders.amountLabel}
                  data-testid="order-amount"
                  inputMode="numeric"
                  autoComplete="off"
                  enterKeyHint="next"
                  placeholder="0"
                  value={d.amount === "" ? "" : formatNumber(Number(d.amount))}
                  onChange={(e) => patch(d.key, { amount: sanitizeAmountText(e.target.value) })}
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-right font-rounded text-[17px] font-bold tabular-nums outline-none placeholder:text-muted/50"
                />
                <span aria-hidden="true" className="text-muted">
                  ₸
                </span>
              </label>
              <input
                aria-label={ru.orders.noteLabel}
                data-testid="order-note"
                value={d.note}
                maxLength={ORDER_NOTE_MAX}
                enterKeyHint="done"
                autoComplete="off"
                placeholder={ru.orders.notePlaceholder}
                onChange={(e) => patch(d.key, { note: e.target.value })}
                className="min-w-0 flex-1 rounded-pill border border-card-2 bg-card-2 px-4 py-[9px] text-[15px] outline-none placeholder:text-muted/50 focus:border-lime"
              />
            </div>
          </m.div>
        ))}
      </AnimatePresence>

      {drafts.length < MAX_ORDERS && candidates.length > 0 ? (
        <button
          type="button"
          data-testid="add-order"
          onClick={() => onChange([...drafts, newDraft()])}
          className="flex items-center gap-2 self-start rounded-pill border border-dashed border-outline px-[14px] py-[9px] text-[15px] font-medium text-lime transition-transform duration-200 ease-smooth active:scale-[0.97]"
        >
          <PlusIcon size={16} strokeWidth={2.4} />
          {drafts.length === 0 ? ru.orders.add : ru.orders.addMore}
        </button>
      ) : null}

      {issue ? (
        <p role="alert" className="pl-[6px] text-label text-orange">
          {issue}
        </p>
      ) : unfinished && drafts.length > 0 ? (
        <p className="pl-[6px] text-caption">{ru.orders.finish}</p>
      ) : each ? (
        <p data-testid="orders-preview" aria-live="polite" className="pl-[6px] text-caption">
          {[ru.orders.preview(each), ...people.map((p) => ru.orders.previewPerson(nameOf(p.id), formatTenge(p.amount)))].join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

/** What each person with an order pays in total (equal part + orders), in the order they first appear. */
function orderedTotals(split: OrderSplit, drafts: ReadonlyArray<OrderDraft>): Array<{ id: string; amount: number }> {
  const ids: string[] = [];
  for (const d of drafts) if (d.user_id && !ids.includes(d.user_id) && (Number(d.amount) || 0) > 0) ids.push(d.user_id);
  return ids.flatMap((id) => {
    const s = split.shares.find((x) => x.debtor_id === id);
    return s ? [{ id, amount: s.amount }] : [];
  });
}
