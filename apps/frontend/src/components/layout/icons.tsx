import type { SVGProps } from 'react';

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export const HomeIcon = () => (
  <Icon>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </Icon>
);

export const FolderIcon = () => (
  <Icon>
    <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </Icon>
);

export const ShieldIcon = () => (
  <Icon>
    <path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.3 7 9 4.2-1.7 7-4.8 7-9V6z" />
    <path d="m9.2 12 2 2 3.6-3.8" />
  </Icon>
);

export const BellIcon = () => (
  <Icon>
    <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </Icon>
);

export const SparklesIcon = () => (
  <Icon>
    <path d="M10 4.5 11.6 9l4.4 1.6-4.4 1.6L10 16.7 8.4 12.2 4 10.6 8.4 9z" />
    <path d="m17.5 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  </Icon>
);

export const MenuIcon = () => (
  <Icon width="22" height="22">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon width="22" height="22">
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon width="14" height="14">
    <path d="m14.5 6-6 6 6 6" />
  </Icon>
);
