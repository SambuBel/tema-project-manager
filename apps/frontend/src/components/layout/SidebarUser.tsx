import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { AuthenticatedUser } from '@tema/shared-types';
import { api } from '../../lib/api';
import { getPrimaryRole, roleLabels } from '../../lib/roles';
import { ConfirmDialog } from '../ConfirmDialog';
import { LogoutIcon } from './icons';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}

export function SidebarUser({ user }: { user: AuthenticatedUser }) {
  const role = getPrimaryRole(user.roles);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Reload completo (no navigate()): limpia toda la cache de React Query de una,
  // sin tener que invalidar a mano cada query que dependa del usuario logueado.
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      window.location.href = '/';
    },
  });

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
      <div className="ml-3 min-w-0 max-w-[12rem] flex-1 transition-[max-width,margin,opacity] duration-300 ease-in-out lg:group-data-[collapsed=true]/sb:ml-0 lg:group-data-[collapsed=true]/sb:max-w-0 lg:group-data-[collapsed=true]/sb:opacity-0">
        <p className="truncate text-sm font-medium text-white">{user.name}</p>
        {role && <p className="truncate text-xs text-sidebar-muted">{roleLabels[role]}</p>}
      </div>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        title="Cerrar sesión"
        aria-label="Cerrar sesión"
        className="ml-2 shrink-0 rounded-md p-1.5 text-sidebar-muted transition-colors duration-150 hover:bg-sidebar-hover hover:text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 lg:group-data-[collapsed=true]/sb:hidden"
      >
        <LogoutIcon />
      </button>

      <ConfirmDialog
        open={confirmOpen}
        title="Cerrar sesión"
        description="Vas a tener que volver a iniciar sesión con Google para seguir usando TEMA."
        confirmLabel="Cerrar sesión"
        variant="danger"
        isConfirming={logout.isPending}
        onConfirm={() => logout.mutate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
