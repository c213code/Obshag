import { Avatar, type AvatarColor } from "@/components/ui/Avatar";
import { sanitizeAmountText } from "@/lib/domain/customSplit";
import { ru } from "@/lib/i18n/ru";

/** One «Свои суммы» row: a «.who» pill (avatar + name) with the person's amount typed at the right end. */
export function PersonAmountRow({
  name,
  initialsOf,
  color,
  value,
  onChange,
  invalid,
}: {
  name: string;
  initialsOf: string;
  color: AvatarColor;
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 rounded-pill border border-card-2 bg-card py-[6px] pr-4 pl-[6px] text-[15px] font-medium focus-within:border-lime">
      <Avatar name={initialsOf} color={color} size={32} decorative className="!font-semibold" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <input
        aria-label={ru.purchase.amountOf(name)}
        inputMode="numeric"
        autoComplete="off"
        enterKeyHint="done"
        placeholder={ru.purchase.amountPlaceholder}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(sanitizeAmountText(e.target.value))}
        className="w-[110px] border-0 bg-transparent p-0 text-right font-rounded text-[17px] font-bold tabular-nums outline-none placeholder:text-muted/50"
      />
      <span aria-hidden="true" className="text-muted">
        ₸
      </span>
    </label>
  );
}
