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
}: {
  children: ReactNode;
  trailing?: ReactNode;
  position?: "fixed" | "static";
}) {
  return (
    <div
      className={cx(
        position === "fixed" &&
          "fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(env(safe-area-inset-bottom),16px)]",
      )}
    >
      <div className={cx("flex items-center justify-between gap-2", position === "fixed" ? "w-full max-w-[390px] px-4" : "w-full")}>
        <Bar>{children}</Bar>
        {trailing}
      </div>
    </div>
  );
}
