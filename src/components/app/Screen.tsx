import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/** Page column from the mockups: 390px max, 20px side padding, status-bar offset on top, room for the floating bars below. */
export function Screen({
  children,
  className,
  topOffset = 58,
  bottomRoom = true,
}: {
  children: ReactNode;
  className?: string;
  /** Mockup top padding (Main 58, forms 54); the real safe-area inset replaces it inside the installed PWA. */
  topOffset?: 54 | 58;
  bottomRoom?: boolean;
}) {
  return (
    <main
      className={cx(
        "mx-auto flex w-full max-w-[390px] flex-col gap-6 px-5",
        topOffset === 58 ? "pt-[max(0px,calc(58px-env(safe-area-inset-top)))]" : "pt-[max(0px,calc(54px-env(safe-area-inset-top)))]",
        bottomRoom && "pb-[156px]",
        className,
      )}
    >
      {children}
    </main>
  );
}
