"use client";

import { css, cssTransition, useReducedMotionSafe } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";
import { Avatar, type AvatarColor } from "./Avatar";
import { CheckIcon } from "./icons";
import { cx } from "./cx";

/**
 * Payer row with the «Получил» action (approved reference #4). Tapping the button shrinks it
 * into a lime check circle and fills the progress bar to 100%. No confetti.
 */
export function ReceivedRow({
  name,
  avatarColor,
  paid,
  total,
  received,
  onReceive,
  pendingLabel,
  receivedLabel,
  buttonLabel,
}: {
  name: string;
  avatarColor: AvatarColor;
  /** How many members have paid already, counting this row only once `received`. */
  paid: number;
  total: number;
  received: boolean;
  onReceive: () => void;
  pendingLabel: string;
  receivedLabel: string;
  buttonLabel: string;
}) {
  const { reduced } = useReducedMotionSafe();
  const complete = received && paid >= total;
  const fill = complete ? 1 : paid / total;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-[10px]">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={paid}
          className="h-[6px] flex-1 overflow-hidden rounded-[3px] bg-card-2"
        >
          <div
            className="h-full origin-left bg-lime"
            style={{ transform: `scaleX(${fill})`, transition: reduced ? "transform 0.2s linear" : cssTransition({ transform: 0.5 }) }}
          />
        </div>
        <span
          data-testid="received-progress"
          className={cx("text-[12px] transition-colors duration-[400ms] ease-smooth", complete ? "text-lime" : "text-muted")}
        >
          {complete ? ru.common.allPaid : ru.common.members(paid, total)}
        </span>
      </div>
      <div className="relative flex items-center gap-[10px] rounded-pill border border-card-2 bg-card p-[6px]">
        <Avatar name={name} color={avatarColor} size={40} decorative />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14px]">{name}</span>{" "}
          <span className={cx("truncate text-[12px] transition-colors duration-[400ms] ease-smooth", received ? "text-muted" : "text-orange")}>
            {received ? receivedLabel : pendingLabel}
          </span>
        </div>
        <button
          type="button"
          disabled={received}
          onClick={onReceive}
          style={{
            transform: `scale(${received && !reduced ? 0.5 : 1})`,
            opacity: received ? 0 : 1,
            transition: reduced ? "transform 0.2s linear, opacity 0.2s linear" : cssTransition({ transform: 0.5, opacity: 0.5 }),
          }}
          className="min-w-[84px] rounded-pill bg-lime px-[14px] py-[10px] text-[13px] font-semibold text-on-lime"
          aria-hidden={received}
          tabIndex={received ? -1 : 0}
        >
          {/* the label is gone before the button has shrunk much: no clipped «Получ…» under the ✓ circle */}
          <span
            className="inline-block"
            style={{
              opacity: received ? 0 : 1,
              transition: reduced ? "opacity 0.1s linear" : cssTransition({ opacity: 0.14 }),
            }}
          >
            {buttonLabel}
          </span>
        </button>
        <span
          aria-hidden="true"
          className="absolute right-[6px] inline-flex size-10 items-center justify-center rounded-full bg-lime text-on-lime"
          style={{
            transform: `scale(${received || reduced ? 1 : 0.4})`,
            opacity: received ? 1 : 0,
            transition: reduced
              ? "transform 0.2s linear, opacity 0.2s linear"
              : `transform 0.55s ${css.softSpring} ${received ? 0.12 : 0}s, opacity 0.35s ${css.smooth} ${received ? 0.12 : 0}s`,
          }}
        >
          <CheckIcon size={20} />
        </span>
      </div>
    </div>
  );
}
