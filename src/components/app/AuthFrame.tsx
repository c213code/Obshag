import type { ReactNode } from "react";
import { Screen } from "./Screen";

/**
 * Shared frame for the screens without a mockup (login, verify, onboarding, household, join):
 * a caption + big rounded headline on top, content, and a floating capsule footer with the primary action.
 */
export function AuthFrame({
  eyebrow,
  title,
  subtitle,
  header,
  children,
  footer,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Replaces the eyebrow, e.g. a Header capsule with a back button. */
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Screen topOffset={54} bottomRoom={Boolean(footer)}>
      {header}
      <div className="flex flex-col gap-2">
        {eyebrow ? <span className="text-caption">{eyebrow}</span> : null}
        <h1 className="text-display">{title}</h1>
        {subtitle ? <p className="text-body text-muted">{subtitle}</p> : null}
      </div>
      {children}
      {footer ? (
        <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(env(safe-area-inset-bottom),28px)]">
          <div className="flex w-full max-w-[390px] items-center gap-3 px-5">{footer}</div>
        </div>
      ) : null}
    </Screen>
  );
}
