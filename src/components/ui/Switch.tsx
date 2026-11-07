import { cx } from "./cx";

/** 50x30 switch of Invite.dc.html: lime track and on-lime knob when on. Only transform and color animate. */
export function Switch({
  checked,
  onChange,
  labelledBy,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** id of the element that names the switch. */
  labelledBy: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      onClick={() => onChange(!checked)}
      className={cx("relative h-[30px] w-[50px] shrink-0 rounded-[15px] transition-colors duration-200 ease-smooth", checked ? "bg-lime" : "bg-card-2", className)}
    >
      <span
        aria-hidden="true"
        className={cx(
          "absolute top-[3px] left-[3px] size-[24px] rounded-full transition-transform duration-200 ease-smooth",
          checked ? "translate-x-[20px] bg-on-lime" : "translate-x-0 bg-muted",
        )}
      />
    </button>
  );
}
