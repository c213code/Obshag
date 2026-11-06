import type { HTMLAttributes } from "react";
import { cx } from "./cx";

/** Capsule: 94% card background, 1px card-2 border, padding 6, pill radius. */
export function Bar({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "flex items-center gap-[6px] rounded-pill border border-card-2 p-[6px]",
        "bg-[color-mix(in_srgb,var(--color-card)_94%,transparent)]",
        className,
      )}
      {...rest}
    />
  );
}
