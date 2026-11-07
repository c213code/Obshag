import type { ReactNode } from "react";
import { cx } from "./cx";

/** Three stacked capsules: the empty-state picture. Static, token colours only. */
export function CapsuleIllustration() {
  return (
    <div aria-hidden="true" className="relative h-[64px] w-[132px]">
      <span className="absolute inset-x-0 top-0 h-[26px] rounded-pill bg-card-2" />
      <span className="absolute inset-x-[14px] top-[19px] h-[26px] rounded-pill border border-card-2 bg-card" />
      <span className="absolute inset-x-[28px] top-[38px] flex h-[26px] items-center gap-2 rounded-pill bg-lime px-2">
        <span className="size-[10px] rounded-full bg-on-lime/40" />
        <span className="h-[6px] flex-1 rounded-pill bg-on-lime/30" />
      </span>
    </div>
  );
}

/** Empty state with personality: capsule picture, one short line, one primary action. */
export function EmptyState({
  title,
  text,
  action,
  className,
  testId,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className={cx("flex flex-col items-start gap-4 rounded-lg border border-hairline bg-card p-5", className)}>
      <CapsuleIllustration />
      <div className="flex flex-col gap-1">
        <h2 className="text-headline">{title}</h2>
        {text ? <p className="text-body text-muted">{text}</p> : null}
      </div>
      {action}
    </div>
  );
}
