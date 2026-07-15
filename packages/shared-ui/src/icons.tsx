import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function GiftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="9.5" width="16" height="10" rx="1.2" />
      <path d="M4 13h16" />
      <path d="M12 9.5v10" />
      <path d="M12 9.5c-2.4 0-3.6-1.1-3.6-2.6C8.4 5.6 9.2 4.7 10.2 4.7c1.4 0 1.8 1.7 1.8 4.8Z" />
      <path d="M12 9.5c2.4 0 3.6-1.1 3.6-2.6 0-1.3-.8-2.2-1.8-2.2-1.4 0-1.8 1.7-1.8 4.8Z" />
    </svg>
  );
}

export function CartIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 4.5h2.2l1 11.5a1.6 1.6 0 0 0 1.6 1.5h8.6a1.6 1.6 0 0 0 1.6-1.4l1-7.6H6.4" />
      <circle cx="9.5" cy="20" r="1.1" />
      <circle cx="17" cy="20" r="1.1" />
    </svg>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M8 16.2 5.8 14a3.5 3.5 0 0 1 0-5l1.6-1.6a3.5 3.5 0 0 1 5 0" />
      <path d="M16 7.8 18.2 10a3.5 3.5 0 0 1 0 5l-1.6 1.6a3.5 3.5 0 0 1-5 0" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6.5h16" />
      <path d="M4 12h16" />
      <path d="M4 17.5h16" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m9 5.5 7 6.5-7 6.5" />
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M18.5 12h-13" />
      <path d="m10.5 5.5-6 6.5 6 6.5" />
    </svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 9.5a6 6 0 0 1 12 0c0 4 1.4 5.2 1.4 5.9a.8.8 0 0 1-.8.8H5.4a.8.8 0 0 1-.8-.8c0-.7 1.4-1.9 1.4-5.9Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function FilterIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6h16" />
      <path d="M7.5 12h9" />
      <path d="M10.5 18h3" />
    </svg>
  );
}

export function ShieldCoinIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="11" r="4" />
      <path d="M12 8.7v4.6M10.2 10h3.6" />
      <path d="M4.5 5.5 12 3l7.5 2.5v5c0 5-3.2 8.6-7.5 10.5-4.3-1.9-7.5-5.5-7.5-10.5Z" opacity=".35" />
    </svg>
  );
}

export function ChatBubbleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4.5 3.5V16h-1A2.5 2.5 0 0 1 2 13.5" opacity="0" />
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v6A2.5 2.5 0 0 1 17.5 15H10l-4 3.2V15A2.5 2.5 0 0 1 4 12.5Z" />
    </svg>
  );
}

export function IdCardIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.6" />
      <circle cx="8.5" cy="11" r="1.8" />
      <path d="M5.8 15.8c.4-1.4 1.5-2.1 2.7-2.1s2.3.7 2.7 2.1" />
      <path d="M14 9.5h4M14 12.5h4M14 15.5h2.5" />
    </svg>
  );
}
