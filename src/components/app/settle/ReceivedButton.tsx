"use client";

import { useState } from "react";
import { Pill, type PillSize } from "@/components/ui/Pill";
import { Sheet } from "@/components/ui/Sheet";
import { formatTenge } from "@/lib/format/money";
import { ru } from "@/lib/i18n/ru";
import { useAppActions } from "../AppDataProvider";

/**
 * «Нурбол перевёл мне» (slice 25): the creditor records that the debtor sent the money, without waiting for the debtor to
 * mark it. A secondary pill that opens a confirm sheet; the debt closes the same way the debtor's own mark closes it.
 */
export function ReceivedButton({
  householdId,
  fromId,
  name,
  amount,
  size = "row",
  className,
  testId = "received",
}: {
  householdId: string;
  fromId: string;
  name: string;
  amount: number;
  size?: PillSize;
  className?: string;
  testId?: string;
}) {
  const { markReceived } = useAppActions();
  const [asking, setAsking] = useState(false);
  const [open, setOpen] = useState(false);
  const title = ru.settle.markedByMe.confirmTitle(name, formatTenge(amount));

  const confirm = () => {
    setOpen(false);
    void markReceived(householdId, fromId);
  };

  return (
    <>
      <Pill
        variant="on"
        size={size}
        className={className}
        data-testid={testId}
        onClick={() => {
          setAsking(true);
          setOpen(true);
        }}
      >
        {ru.settle.markedByMe.button(name)}
      </Pill>
      {asking ? (
        <Sheet open={open} onClose={() => setOpen(false)} onClosed={() => setAsking(false)} label={title} expandedClassName="max-w-[358px] p-4" focusFirst={false}>
          <div className="flex flex-col gap-3" data-testid="received-sheet">
            <h2 className="px-1 text-headline">{title}</h2>
            <p className="px-1 text-caption">{ru.settle.markedByMe.confirmText}</p>
            <Pill variant="lime" size="lg" onClick={confirm} className="w-full" data-testid="received-confirm">
              {ru.settle.markedByMe.confirm}
            </Pill>
            <Pill variant="on" size="lg" onClick={() => setOpen(false)} className="w-full">
              {ru.settle.markedByMe.cancel}
            </Pill>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
