"use client";

import { Pill } from "@/components/ui/Pill";
import { Sheet } from "@/components/ui/Sheet";
import { ru } from "@/lib/i18n/ru";

/** «Удалить «нан» · 600 ₸? Доли у всех исчезнут.» */
export function DeleteConfirmSheet({
  open,
  what,
  amount,
  onClose,
  onClosed,
  onConfirm,
}: {
  open: boolean;
  what: string;
  amount: string;
  onClose: () => void;
  onClosed?: () => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} onClosed={onClosed} label={ru.purchases.swipeAsk(what, amount)} expandedClassName="max-w-[358px] p-4" focusFirst={false}>
      <div className="flex flex-col gap-3" data-testid="swipe-confirm-sheet">
        <h2 className="px-1 text-headline">{ru.purchases.swipeAsk(what, amount)}</h2>
        <p className="px-1 text-caption">{ru.purchases.swipeAskHint}</p>
        <Pill variant="ghost" size="lg" onClick={onConfirm} className="w-full !bg-danger !text-bg" data-testid="swipe-confirm">
          {ru.purchases.swipeDelete}
        </Pill>
        <Pill variant="on" size="lg" onClick={onClose} className="w-full">
          {ru.purchases.swipeCancel}
        </Pill>
      </div>
    </Sheet>
  );
}
