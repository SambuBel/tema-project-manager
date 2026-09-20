import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

const base =
  'flex w-full items-center whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400';
const idle = 'text-sidebar-muted hover:bg-sidebar-hover hover:text-white';
const active = 'bg-sidebar-active text-white';

interface CommonProps {
  icon: ReactNode;
  label: string;
  /** Contador futuro (p. ej. notificaciones). No se muestra si es 0 o undefined. */
  badge?: number;
}

function Content({ icon, label, badge }: CommonProps) {
  return (
    <>
      <span className="shrink-0">{icon}</span>
      <span className="ml-3 max-w-[12rem] truncate transition-[max-width,margin,opacity] duration-300 ease-in-out lg:group-data-[collapsed=true]/sb:ml-0 lg:group-data-[collapsed=true]/sb:max-w-0 lg:group-data-[collapsed=true]/sb:opacity-0">{label}</span>
      {badge ? (
        <span
          className="ml-auto overflow-hidden rounded-full bg-sky-500/20 px-2 py-0.5 text-xs text-sky-200 transition-opacity duration-300 lg:group-data-[collapsed=true]/sb:max-w-0 lg:group-data-[collapsed=true]/sb:px-0 lg:group-data-[collapsed=true]/sb:opacity-0"
          aria-label={`${badge} sin leer`}
        >
          {badge}
        </span>
      ) : null}
    </>
  );
}

interface LinkProps extends CommonProps {
  to: string;
  end?: boolean;
  onNavigate?: () => void;
}

export function SidebarNavLink({ to, end, onNavigate, ...content }: LinkProps) {
  return (
    <li>
      <NavLink
        to={to}
        end={end}
        onClick={onNavigate}
        title={content.label}
        aria-label={content.label}
        className={({ isActive }) => `${base} ${isActive ? active : idle}`}
      >
        <Content {...content} />
      </NavLink>
    </li>
  );
}

interface ButtonProps extends CommonProps {
  onClick: () => void;
}

export function SidebarNavButton({ onClick, ...content }: ButtonProps) {
  return (
    <li>
      <button type="button" onClick={onClick} title={content.label} aria-label={content.label} className={`${base} ${idle}`}>
        <Content {...content} />
      </button>
    </li>
  );
}
