import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

export type PillVariant = "ghost" | "on" | "lime";
export type PillSize = "sm" | "md";

export const pillVariantClass: Record<PillVariant, string> = {
  ghost: "text-muted",
  on: "bg-card-2 text-text",
  lime: "bg-lime text-on-lime",
};

export const pillSizeClass: Record<PillSize, string> = {
  sm: "h-8 px-3 text-label",
  md: "h-11 px-4 text-headline",
};

export function pillClass(variant: PillVariant, size: PillSize, extra?: string) {
  return cx(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-pill whitespace-nowrap",
    "transition-transform duration-200 ease-smooth active:scale-[0.97]",
    pillSizeClass[size],
    pillVariantClass[variant],
    extra,
  );
}

type CommonProps = { variant?: PillVariant; size?: PillSize; className?: string };

export type PillProps = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">;

export function Pill({ variant = "ghost", size = "md", className, type = "button", ...rest }: PillProps) {
  return <button type={type} className={pillClass(variant, size, className)} {...rest} />;
}

export type PillLinkProps = CommonProps &
  Omit<ComponentProps<typeof Link>, "className"> & { children: ReactNode };

/** Link-rendered Pill. */
export function PillLink({ variant = "ghost", size = "md", className, ...rest }: PillLinkProps) {
  return <Link className={pillClass(variant, size, className)} {...rest} />;
}
