import type { ReactNode } from "react";
import { Bar } from "./Bar";
import { cx } from "./cx";

/**
 * Floating action container: a Bar plus an optional trailing Fab or lime Pill.
 * `fixed` pins it to the bottom (safe-area aware); `static` is for galleries.
 */
export function BottomActions({
  children,
  trailing,
  position = "fixed",
  barClassName,
}: {
  children: ReactNode;
  trailing?: ReactNode;
  position?: "fixed" | "static";
  barClassName?: string;
}) {
  return (
    <div
      className={cx(
        position === "fixed" &&
          "fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(env(safe-area-inset-bottom),28px)]",
      )}
    >
      <div className={cx("flex items-center justify-between gap-3", position === "fixed" ? "w-full max-w-[390px] px-5" : "w-full")}>
        <Bar className={barClassName}>{children}</Bar>
        {trailing}
      </div>
    </div>
  );
}
