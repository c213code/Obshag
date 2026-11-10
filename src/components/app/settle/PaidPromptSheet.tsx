"use client";

import { useState } from "react";
import { Pill } from "@/components/ui/Pill";
import { Sheet } from "@/components/ui/Sheet";
import { formatTenge } from "@/lib/format/money";
import { ru } from "@/lib/i18n/ru";

/**
 * «Ты перевёл Айдосу 200 ₸?» [Да, перевёл] [Ещё нет]. Mounted only while there is a prompt; `onClosed` fires after the
 * collapse. Closing it any other way (backdrop, Esc) answers nothing: the prompt stays pending for the next return.
 */
export function PaidPromptSheet({
  name,
  amount,
  onAnswer,
  onClosed,
}: {
  name: string;
  amount: number;
  onAnswer: (yes: boolean) => void;
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [outcome, setOutcome] = useState<"done" | "dismissed">("dismissed");
  const title = ru.settle.askPaid.title(name, formatTenge(amount));

  const answer = (yes: boolean) => {
    setOutcome(yes ? "done" : "dismissed");
    setOpen(false);
    onAnswer(yes);
  };

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      onClosed={onClosed}
      label={title}
      outcome={outcome}
      doneLabel={ru.settle.askPaid.done}
      expandedClassName="max-w-[358px] p-4"
      focusFirst={false}
    >
      <div className="flex flex-col gap-3" data-testid="paid-sheet">
        <h2 className="px-1 text-headline">{title}</h2>
        <p className="px-1 text-caption">{ru.settle.askPaid.text(name)}</p>
        <Pill variant="lime" size="lg" onClick={() => answer(true)} className="w-full" data-testid="paid-yes">
          {ru.settle.askPaid.yes}
        </Pill>
        <Pill variant="on" size="lg" onClick={() => answer(false)} className="w-full" data-testid="paid-no">
          {ru.settle.askPaid.no}
        </Pill>
      </div>
    </Sheet>
  );
}
