import type { AuthenticatedUser } from '@tema/shared-types';
import { getPrimaryRole, roleLabels } from '../../lib/roles';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}

export function SidebarUser({ user }: { user: AuthenticatedUser }) {
  const role = getPrimaryRole(user.roles);
  return (
    <div className="flex items-center overflow-hidden whitespace-nowrap border-t border-sidebar-border px-[19px] py-4">
      {user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={`Foto de ${user.name}`}
          referrerPolicy="no-referrer"
          className="h-9 w-9 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-active text-xs font-semibold text-white"
        >
          {initials(user.name)}
        </span>
      )}
      <div className="ml-3 min-w-0 max-w-[12rem] transition-[max-width,margin,opacity] duration-300 ease-in-out lg:group-data-[collapsed=true]/sb:ml-0 lg:group-data-[collapsed=true]/sb:max-w-0 lg:group-data-[collapsed=true]/sb:opacity-0">
        <p className="truncate text-sm font-medium text-white">{user.name}</p>
        {role && <p className="truncate text-xs text-sidebar-muted">{roleLabels[role]}</p>}
      </div>
    </div>
  );
}
