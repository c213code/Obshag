"use client";

import { motion } from "motion/react";
import { ease, useReducedMotionSafe } from "@/lib/motion";
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
  const smooth = { duration: 0.5, ease: ease.smooth };
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
          <motion.div
            className="h-full origin-left bg-lime"
            initial={false}
            animate={{ scaleX: fill }}
            transition={reduced ? { duration: 0.2, ease: "linear" } : smooth}
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
        <div className="flex flex-1 flex-col">
          <span className="text-[14px]">{name}</span>
          <span className={cx("text-[12px] transition-colors duration-[400ms] ease-smooth", received ? "text-muted" : "text-orange")}>
            {received ? receivedLabel : pendingLabel}
          </span>
        </div>
        <motion.button
          type="button"
          disabled={received}
          onClick={onReceive}
          initial={false}
          animate={received ? { scale: reduced ? 1 : 0.5, opacity: 0 } : { scale: 1, opacity: 1 }}
          transition={reduced ? { duration: 0.2, ease: "linear" } : smooth}
          className="min-w-[84px] rounded-pill bg-lime px-[14px] py-[10px] text-[13px] font-semibold text-on-lime"
          aria-hidden={received}
          tabIndex={received ? -1 : 0}
        >
          {buttonLabel}
        </motion.button>
        <motion.span
          aria-hidden="true"
          className="absolute right-[6px] inline-flex size-10 items-center justify-center rounded-full bg-lime text-on-lime"
          initial={false}
          animate={received ? { scale: 1, opacity: 1 } : { scale: reduced ? 1 : 0.4, opacity: 0 }}
          transition={
            reduced
              ? { duration: 0.2, ease: "linear" }
              : { scale: { duration: 0.55, ease: ease.softSpring, delay: received ? 0.12 : 0 }, opacity: { duration: 0.35, ease: ease.smooth, delay: received ? 0.12 : 0 } }
          }
        >
          <CheckIcon size={20} />
        </motion.span>
      </div>
    </div>
  );
}
