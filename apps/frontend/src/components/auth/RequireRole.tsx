import { Navigate, Outlet } from 'react-router-dom';
import type { AuthenticatedUser } from '@tema/shared-types';
import { useCurrentUser } from '../../hooks/useCurrentUser';

interface RequireRoleProps {
  /** Normalmente un helper de lib/permissions.ts (ej. canViewUsersUI). */
  allow: (user: AuthenticatedUser) => boolean;
}

/**
 * Protege una ruta además de ocultar el link del sidebar — "no alcanza con
 * ocultar el link" (ver HU de roles/permisos): si alguien escribe la URL a
 * mano sin el rol que corresponde, esto lo manda de vuelta a "/" en vez de
 * renderizar la página. Es UX, no seguridad: el backend igual revalida todo
 * en cada request (ver RolesGuard/PermissionsService).
 */
export function RequireRole({ allow }: RequireRoleProps) {
  const { user, isLoading } = useCurrentUser();

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-500">Cargando…</div>
    );
  }

  if (!user || !allow(user)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
