"use client";

import { useState } from "react";
import { Pill, type PillSize } from "@/components/ui/Pill";
import { Sheet } from "@/components/ui/Sheet";
import { formatTenge } from "@/lib/format/money";
import { ru } from "@/lib/i18n/ru";
import { useAppActions } from "../AppDataProvider";

/**
 * «Списать 75 ₸»: the creditor's way out when Kaspi cannot transfer the debt (under 100 ₸). A secondary pill that opens
 * a confirm sheet; the debt closes without a transfer.
 */
export function WriteOffButton({
  householdId,
  debtorId,
  name,
  amount,
  size = "row",
  className,
  testId = "writeoff",
}: {
  householdId: string;
  debtorId: string;
  name: string;
  amount: number;
  size?: PillSize;
  className?: string;
  testId?: string;
}) {
  const { writeOff } = useAppActions();
  const [asking, setAsking] = useState(false);
  const [open, setOpen] = useState(false);
  const money = formatTenge(amount);
  const title = ru.settle.small.confirmTitle(money, name);

  const confirm = () => {
    setOpen(false);
    void writeOff(householdId, debtorId);
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
        {ru.settle.small.writeOff(money)}
      </Pill>
      {asking ? (
        <Sheet open={open} onClose={() => setOpen(false)} onClosed={() => setAsking(false)} label={title} expandedClassName="max-w-[358px] p-4" focusFirst={false}>
          <div className="flex flex-col gap-3" data-testid="writeoff-sheet">
            <h2 className="px-1 text-headline">{title}</h2>
            <p className="px-1 text-caption">{ru.settle.small.confirmText}</p>
            <Pill variant="lime" size="lg" onClick={confirm} className="w-full" data-testid="writeoff-confirm">
              {ru.settle.small.confirm}
            </Pill>
            <Pill variant="on" size="lg" onClick={() => setOpen(false)} className="w-full">
              {ru.settle.small.cancel}
            </Pill>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
