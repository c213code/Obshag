import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "prefix"> & {
  label: string;
  prefix?: ReactNode;
  /** Sits at the right end of the capsule, e.g. the eye button of a password field. */
  trailing?: ReactNode;
  error?: string | null;
  /** Quiet helper line under the capsule (hidden while there is an error). */
  hint?: string;
};

/** Capsule text input: caption above, 58px pill, lime border on focus, orange on error. */
export function TextField({ label, prefix, trailing, error, hint, id, ...input }: TextFieldProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  const errorId = `${fieldId}-error`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="pl-[6px] text-caption">
        {label}
      </label>
      <div
        className={cx(
          "flex h-[58px] items-center gap-2 rounded-pill border bg-card px-5 transition-colors duration-200 ease-smooth",
          error ? "border-orange" : "border-card-2 focus-within:border-lime",
        )}
      >
        {prefix ? (
          <span aria-hidden="true" className="text-headline text-muted">
            {prefix}
          </span>
        ) : null}
        <input
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1 bg-transparent font-medium text-text outline-none placeholder:text-muted/60"
          {...input}
        />
        {trailing}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="pl-[6px] text-label text-orange">
          {error}
        </p>
      ) : hint ? (
        <p className="pl-[6px] text-label text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
