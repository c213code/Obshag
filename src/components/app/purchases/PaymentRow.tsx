import type { ReactNode } from "react";
import { Avatar, type AvatarColor } from "@/components/ui/Avatar";
import { CheckIcon } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";
import { ru } from "@/lib/i18n/ru";

/** One «Кто скинул» row (Purchase.dc.html .prow): avatar, name + caption, then ✓ (received) or an action (waiting). */
export function PaymentRow({
  name,
  color,
  received,
  caption,
  action,
}: {
  name: string;
  color: AvatarColor;
  /** null = still waiting. */
  received: boolean;
  caption: string;
  action?: ReactNode;
}) {
  return (
    <div
      data-testid="payment-row"
      data-received={received}
      className={cx("flex items-center gap-3 rounded-pill border bg-card p-[6px]", received ? "border-hairline" : "border-wait-line")}
    >
      <Avatar name={name} color={color} size={44} decorative />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body">{name}</span>
        <span className={cx("truncate text-caption", !received && "!text-orange")}>{caption}</span>
      </div>
      {received ? (
        <span className="grid size-[44px] shrink-0 place-items-center rounded-full bg-lime-soft text-lime" role="img" aria-label={ru.detail.receivedLabel}>
          <CheckIcon size={18} strokeWidth={3} />
        </span>
      ) : (
        <div className="shrink-0 pr-[2px]">{action}</div>
      )}
    </div>
  );
}
