"use client";

import { formatNumber } from "@/lib/format/money";

const SIZE = 56;
const MAX_DIGITS = 11;

/**
 * Big centered amount (AddPurchase.dc.html): digits in a real numeric input, the ₸ sign beside it.
 * A hidden mirror sizes the input to its content so "2 400 ₸" stays centered as you type.
 * Backspace over a thousands space removes the digit before it instead of getting stuck.
 */
export function AmountInput({
  value,
  onChange,
  label,
  autoFocus,
  invalid,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  label: string;
  autoFocus?: boolean;
  /** Over the limit or too small for the group: the digits turn orange. */
  invalid?: boolean;
}) {
  const shown = value === null ? "" : formatNumber(value);
  const style = { fontSize: SIZE, lineHeight: 1.05 } as const;

  const handle = (raw: string) => {
    const previous = value === null ? "" : String(value);
    let digits = raw.replace(/\D/g, "").replace(/^0+/, "");
    // the user deleted a separator only: treat it as deleting the last digit
    if (digits === previous && raw.length < shown.length) digits = digits.slice(0, -1);
    if (digits === "") return onChange(null);
    // Typing past the limit is allowed up to 11 digits, so the screen can say why it is refused instead of silently eating keys.
    if (digits.length > MAX_DIGITS) return;
    onChange(Number(digits));
  };

  return (
    <div className="flex items-baseline justify-center gap-2 font-rounded font-bold tracking-[-0.02em] tabular-nums">
      <span className="inline-grid">
        <span aria-hidden="true" style={style} className="invisible col-start-1 row-start-1 whitespace-pre">
          {shown || "0"}
        </span>
        <input
          aria-label={label}
          value={shown}
          placeholder="0"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="next"
          autoFocus={autoFocus}
          onChange={(e) => handle(e.target.value)}
          style={style}
          aria-invalid={invalid || undefined}
          className={`col-start-1 row-start-1 w-0 min-w-full border-0 bg-transparent p-0 text-center outline-none placeholder:text-muted/40 ${invalid ? "text-orange" : "text-text"}`}
        />
      </span>
      <span aria-hidden="true" style={style} className={value === null ? "text-muted/40" : invalid ? "text-orange" : "text-text"}>
        ₸
      </span>
    </div>
  );
}
