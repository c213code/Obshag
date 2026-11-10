"use client";

import type { ComponentProps, Ref } from "react";
import { cx } from "./cx";

type FabProps = Omit<ComponentProps<"button">, "children" | "aria-label" | "ref"> & {
  "aria-label": string;
  children: React.ReactNode;
  /** Shrinks and fades out (scale .6, opacity 0) while the Fab menu is open. Never rotates. */
  hidden?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

/**
 * 58px lime circle. Never rotates: it only scales (press .94, hidden .6) and fades. The motion is a CSS transition
 * (see `.fab` in globals.css: transform .5 s / opacity .4 s, smooth) toggled by `data-hidden` and `:active`, so it
 * stays on the compositor.
 */
export function Fab({ className, children, hidden = false, ref, ...rest }: FabProps) {
  return (
    <button
      ref={ref}
      type="button"
      data-hidden={hidden}
      className={cx("fab inline-flex size-[58px] shrink-0 items-center justify-center rounded-full bg-lime text-on-lime", className)}
      {...rest}
    >
      {children}
    </button>
  );
}
