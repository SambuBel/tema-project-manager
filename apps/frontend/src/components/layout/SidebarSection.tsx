import type { ReactNode } from 'react';

interface SidebarSectionProps {
  title?: string;
  children: ReactNode;
}

export function SidebarSection({ title, children }: SidebarSectionProps) {
  return (
    <div className="px-4">
      {title && (
        <p className="mb-2 max-h-6 overflow-hidden whitespace-nowrap px-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted transition-[max-height,opacity,margin] duration-300 ease-in-out lg:group-data-[collapsed=true]/sb:mb-0 lg:group-data-[collapsed=true]/sb:max-h-0 lg:group-data-[collapsed=true]/sb:opacity-0">
          {title}
        </p>
      )}
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}
