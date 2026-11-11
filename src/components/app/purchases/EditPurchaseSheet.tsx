"use client";

import { useState } from "react";
import { Pill } from "@/components/ui/Pill";
import type { MemberWithProfile } from "@/lib/data/repo";
import type { UiPurchase } from "@/lib/data/purchaseTracker";
import { deriveEqual, draftsToOrders, orderSplit, ordersToDrafts, type OrderDraft } from "@/lib/domain/orders";
import { MAX_AMOUNT } from "@/lib/domain/schemas";
import { formatNumber, formatTenge } from "@/lib/format/money";
import { ru } from "@/lib/i18n/ru";
import { useAppActions } from "../AppDataProvider";
import { avatarColorFor } from "../avatars";
import { DutySheet } from "../duty/DutySheet";
import { AmountInput } from "../purchase/AmountInput";
import { OrdersEditor } from "../purchase/OrdersEditor";
import { PersonChip } from "../purchase/PersonChip";

const label = "pl-[6px] text-caption";

/**
 * «Изменить» on a shared purchase (the payer or an admin, nothing paid yet): the same pieces as the new-purchase form in a
 * bottom sheet. Mounted while open, so its state always starts from the saved purchase.
 */
export function EditPurchaseSheet({
  purchase,
  roster,
  meId,
  open,
  onClose,
}: {
  purchase: UiPurchase;
  roster: ReadonlyArray<MemberWithProfile>;
  meId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { editPurchase, showNotice } = useAppActions();
  const initial = deriveEqual(purchase);
  const [amount, setAmount] = useState<number | null>(purchase.amount);
  const [what, setWhat] = useState(purchase.description);
  const [payer, setPayer] = useState(purchase.payer_id);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(initial?.participants ?? []));
  const [drafts, setDrafts] = useState<OrderDraft[]>(() => ordersToDrafts(initial?.orders ?? []));
  const [busy, setBusy] = useState(false);

  const participantIds = roster.map((m) => m.user_id).filter((id) => picked.has(id));
  const { orders, incomplete } = draftsToOrders(drafts);
  const split = orderSplit(amount ?? 0, participantIds, orders, payer);
  const overLimit = amount !== null && amount > MAX_AMOUNT;
  const hasOrders = orders.length > 0;
  const canSave = !busy && !!amount && !overLimit && what.trim() !== "" && participantIds.length > 0 && !incomplete && !split.issue;

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const save = async () => {
    if (!canSave || amount === null) return;
    setBusy(true);
    const result = await editPurchase(purchase.id, {
      amount,
      description: what.trim(),
      payer_id: payer,
      participant_ids: participantIds,
      orders,
    });
    setBusy(false);
    if (result === "ok") {
      showNotice(ru.detail.adminEdit.saved);
      onClose();
      return;
    }
    showNotice(result === "has_payments" ? ru.detail.adminEdit.hasPayments : result === "invalid" ? ru.detail.adminEdit.invalid : ru.detail.adminEdit.failed);
    if (result === "has_payments") onClose();
  };

  return (
    <DutySheet open={open} onClose={onClose} label={ru.detail.adminEdit.label} title={ru.detail.adminEdit.title} testId="edit-purchase-sheet">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2 py-1">
          <AmountInput value={amount} onChange={setAmount} label={ru.purchase.amountLabel} invalid={overLimit} />
          <input
            aria-label={ru.detail.adminEdit.what}
            data-testid="edit-what"
            value={what}
            maxLength={200}
            placeholder={ru.purchase.whatPlaceholder}
            enterKeyHint="done"
            autoComplete="off"
            onChange={(e) => setWhat(e.target.value)}
            className="w-full border-0 bg-transparent p-0 text-center text-[16px] leading-[19px] text-muted outline-none placeholder:text-muted/50"
          />
        </div>

        <div className="flex flex-col gap-2" role="radiogroup" aria-label={ru.detail.adminEdit.payer}>
          <span className={label}>{ru.detail.adminEdit.payer}</span>
          <div className="flex flex-wrap gap-2">
            {roster.map((m) => (
              <PersonChip
                key={m.user_id}
                name={m.user_id === meId ? ru.detail.adminEdit.you : m.profile.display_name}
                initialsOf={m.profile.display_name}
                color={avatarColorFor(m.profile, meId)}
                selected={payer === m.user_id}
                onToggle={() => setPayer(m.user_id)}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className={label}>{ru.detail.adminEdit.whom}</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label={ru.detail.adminEdit.whom}>
            {roster.map((m) => (
              <PersonChip
                key={m.user_id}
                name={m.user_id === meId ? ru.detail.adminEdit.you : m.profile.display_name}
                initialsOf={m.profile.display_name}
                color={avatarColorFor(m.profile, meId)}
                selected={picked.has(m.user_id)}
                onToggle={() => toggle(m.user_id)}
              />
            ))}
          </div>
          <OrdersEditor roster={roster} meId={meId} payerId={payer} drafts={drafts} onChange={setDrafts} split={hasOrders ? split : null} />
          {!hasOrders && amount && participantIds.length > 0 && !split.issue ? (
            <p className="pl-[6px] text-caption">{ru.orders.preview(split.each.min === split.each.max ? formatTenge(split.each.min) : `${formatNumber(split.each.min)}–${formatTenge(split.each.max)}`)}</p>
          ) : null}
        </div>

        <Pill variant="lime" size="lg" disabled={!canSave} onClick={() => void save()} data-testid="edit-save" className="w-full">
          {busy ? ru.detail.adminEdit.saving : ru.detail.adminEdit.save}
        </Pill>
      </div>
    </DutySheet>
  );
}
