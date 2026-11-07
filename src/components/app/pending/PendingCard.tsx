"use client";

import { useEffect, useRef, type FormEvent } from "react";
import { BasketIcon } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";
import { Money } from "@/components/ui/Money";
import { formatTenge } from "@/lib/format/money";
import { ru } from "@/lib/i18n/ru";

export type Choice = "shared" | "personal";

const chipBase =
  "rounded-pill px-3 py-2 text-[13px] leading-[1.2] font-medium transition-transform duration-200 ease-smooth active:scale-[0.96]";

/**
 * The content of the island (ApplePay.dc.html): merchant + amount, category chips, «Общее · по N ₸» and «Моё».
 * Pure view: the parent owns the state and the resolve call.
 */
export function PendingCard({
  merchant,
  amount,
  perPerson,
  category,
  writing,
  text,
  choice,
  onCategory,
  onWrite,
  onText,
  onCommitText,
  onResolve,
  busy = false,
  canShare = true,
  error = null,
}: {
  merchant: string;
  amount: number;
  perPerson: number;
  /** The selected quick category, or null. */
  category: string | null;
  writing: boolean;
  text: string;
  /** The emphasised button: «Общее» unless a notification action chose «Моё». */
  choice: Choice;
  onCategory: (name: string) => void;
  onWrite: () => void;
  onText: (value: string) => void;
  onCommitText: () => void;
  onResolve: (shared: boolean) => void;
  /** A save is in flight: both buttons wait. */
  busy?: boolean;
  /** False while the roster is empty: «Общее» has nobody to split with. */
  canShare?: boolean;
  /** Inline failure message shown above the buttons. */
  error?: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (writing) input.current?.focus({ preventScroll: true });
  }, [writing]);

  const submitText = (e: FormEvent) => {
    e.preventDefault();
    onCommitText();
  };
  const sharedOn = choice === "shared";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid size-[44px] shrink-0 place-items-center rounded-full bg-lime text-on-lime">
          <BasketIcon size={22} strokeWidth={2} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span data-testid="pending-merchant" className="truncate text-headline">
            {merchant}
          </span>
          <span className="text-caption">{ru.pending.caption}</span>
        </div>
        <Money value={amount} className="text-amount" />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={ru.pending.categoriesLabel}>
        {ru.pending.categories.map((name) => {
          const on = !writing && category === name;
          return (
            <button
              key={name}
              type="button"
              aria-pressed={on}
              onClick={() => onCategory(name)}
              className={cx(chipBase, on ? "bg-lime text-on-lime" : "bg-card-2 text-text")}
            >
              {name}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={writing}
          onClick={onWrite}
          className={cx(chipBase, writing ? "bg-lime text-on-lime" : "bg-transparent text-lime shadow-[inset_0_0_0_1px_var(--color-outline)]")}
        >
          {ru.pending.write}
        </button>
      </div>

      {writing ? (
        <form
          onSubmit={submitText}
          className="flex items-center gap-2 rounded-md bg-card py-[6px] pr-[6px] pl-[14px] shadow-[inset_0_0_0_1px_var(--color-lime)]"
        >
          <input
            ref={input}
            value={text}
            onChange={(e) => onText(e.target.value)}
            maxLength={200}
            enterKeyHint="done"
            aria-label={ru.pending.placeholder}
            placeholder={ru.pending.placeholder}
            className="min-w-0 flex-1 bg-transparent text-[16px] text-text placeholder:text-muted"
          />
          <button
            type="submit"
            aria-label={ru.pending.send}
            className="grid size-[36px] shrink-0 place-items-center rounded-full bg-lime text-on-lime transition-transform duration-200 ease-smooth active:scale-[0.92]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" data-testid="pending-error" className="px-1 text-caption !text-orange">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          data-testid="pending-shared"
          disabled={busy || !canShare}
          data-selected={sharedOn}
          aria-pressed={sharedOn}
          onClick={() => onResolve(true)}
          className={cx(
            "flex-1 rounded-pill p-[14px] text-center text-[15px] leading-[1.2] font-semibold transition-[transform,background-color,color] duration-300 ease-smooth active:scale-[0.97] disabled:opacity-50",
            sharedOn ? "bg-lime text-on-lime" : "bg-card-2 text-text",
          )}
        >
          {perPerson > 0 ? ru.pending.shared(formatTenge(perPerson)) : ru.pending.sharedAlone}
        </button>
        <button
          type="button"
          data-testid="pending-personal"
          disabled={busy}
          data-selected={!sharedOn}
          aria-pressed={!sharedOn}
          onClick={() => onResolve(false)}
          className={cx(
            "rounded-pill px-5 py-[14px] text-[15px] leading-[1.2] font-semibold transition-[transform,background-color,color] duration-300 ease-smooth active:scale-[0.97] disabled:opacity-50",
            sharedOn ? "bg-card-2 text-text" : "bg-lime text-on-lime",
          )}
        >
          {ru.pending.mine}
        </button>
      </div>
    </div>
  );
}
