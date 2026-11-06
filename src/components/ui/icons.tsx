import type { SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Svg({ size = 22, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 11 12 4l8 7" />
    <path d="M6 10v9h12v-9" />
  </Svg>
);
export const ListIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
  </Svg>
);
export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <path d="M16 3v4M8 3v4M4 11h16M11 15h1M12 15v3" />
  </Svg>
);
export const UsersIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="9" r="3.5" />
    <path d="M2.5 19c.6-3.2 3.1-5 6.5-5s5.9 1.8 6.5 5" />
    <path d="M16 5.6a3.5 3.5 0 0 1 0 6.8M18 14.3c1.8.6 3 2 3.5 4.7" />
  </Svg>
);
export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const BackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 5-7 7 7 7" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const BellIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" />
    <path d="M10 21h4" />
  </Svg>
);
export const CartIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="19" r="2" />
    <circle cx="17" cy="19" r="2" />
    <path d="M17 17H6V3H4" />
    <path d="m6 5 14 1-1 7H6" />
  </Svg>
);
export const TransferIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8h15m-4-4 4 4-4 4" />
    <path d="M20 16H5m4-4-4 4 4 4" />
  </Svg>
);
export const ExternalIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 17 17 7M9 7h8v8" />
  </Svg>
);
export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="3" />
    <path d="M15 9V7a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v5a3 3 0 0 0 3 3h2" />
  </Svg>
);

export const icons = {
  home: HomeIcon,
  list: ListIcon,
  calendar: CalendarIcon,
  users: UsersIcon,
  plus: PlusIcon,
  back: BackIcon,
  check: CheckIcon,
  bell: BellIcon,
  cart: CartIcon,
  transfer: TransferIcon,
  external: ExternalIcon,
  copy: CopyIcon,
} as const;

export type IconName = keyof typeof icons;
