import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RoleName } from '@tema/shared-types';
import { api } from '../lib/api';
import { roleLabels } from '../lib/roles';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { UserRolesDrawer } from '../components/admin/UserRolesDrawer';

function initials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase();
}

const ROLE_BADGE_STYLES: Record<RoleName, string> = {
  ADMIN: 'bg-[#245B78] text-white',
  PROGRAM_MANAGER: 'bg-[#EAF2F7] text-[#245B78]',
  PROJECT_LEADER: 'bg-amber-50 text-amber-700',
  COLLABORATOR: 'bg-gray-100 text-gray-600',
  OBSERVER: 'bg-gray-100 text-gray-500',
};

/**
 * Administración → Usuarios y permisos. Mismo componente para ADMIN (ve todo)
 * y PROGRAM_MANAGER (acceso de negocio más acotado, ver UserRolesDrawer) — la
 * ruta ya está protegida aparte por RequireRole en App.tsx.
 */
export function AdminUsersPage() {
  const { user: actor } = useCurrentUser();
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const { data: users, isLoading, isError } = useQuery({
    queryKey: ['users', { search }],
    queryFn: () => api.listUsers(search ? { search } : undefined),
  });

  if (!actor) return null;

  const selectedUser = users?.find((u) => u.id === selectedUserId) ?? null;

  return (
    <div className="flex flex-col gap-6 text-[#172B42]">
      <div>
        <h1 className="text-3xl font-bold">Usuarios y permisos</h1>
        <p className="mt-1 text-gray-500">
          Los permisos se derivan del rol — acá se administran roles, no acciones individuales.
        </p>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar usuario..."
        aria-label="Buscar usuario"
        className="w-full max-w-sm rounded-lg border border-[#DEE5EC] bg-white px-4 py-2.5 text-sm text-[#172B42] placeholder:text-[#607185] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 sm:w-80"
      />

      <div className="rounded-xl border border-[#DEE5EC] bg-white">
        {isLoading ? (
          <p className="p-6 text-sm text-[#607185]">Cargando usuarios...</p>
        ) : isError ? (
          <p className="p-6 text-sm text-red-600">Error al cargar los usuarios.</p>
        ) : !users || users.length === 0 ? (
          <p className="p-6 text-sm italic text-[#607185]">
            {search ? 'No se encontraron usuarios para esa búsqueda.' : 'No hay usuarios todavía.'}
          </p>
        ) : (
          <>
            {/* Tabla: desde sm hacia arriba */}
            <table className="hidden w-full text-left text-sm sm:table">
              <thead>
                <tr className="border-b border-[#DEE5EC] text-xs font-semibold uppercase tracking-wide text-[#607185]">
                  <th className="px-6 py-3 font-semibold">Usuario</th>
                  <th className="px-6 py-3 font-semibold">Email</th>
                  <th className="px-6 py-3 font-semibold">Estado</th>
                  <th className="px-6 py-3 font-semibold">Roles</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => setSelectedUserId(u.id)}
                    className="cursor-pointer border-b border-[#DEE5EC] last:border-b-0 hover:bg-[#EAF2F7]/40"
                  >
                    <td className="flex items-center gap-3 px-6 py-3">
                      {u.avatarUrl ? (
                        <img src={u.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#EAF2F7] text-xs font-semibold text-[#245B78]">
                          {initials(u.name)}
                        </span>
                      )}
                      <span className="font-medium">{u.name}</span>
                    </td>
                    <td className="px-6 py-3 text-[#607185]">{u.email}</td>
                    <td className="px-6 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          u.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {u.active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {u.roles.length === 0 ? (
                          <span className="text-xs text-[#607185]">Sin roles</span>
                        ) : (
                          u.roles.map((role) => (
                            <span
                              key={role}
                              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_BADGE_STYLES[role]}`}
                            >
                              {roleLabels[role]}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Cards: mobile */}
            <div className="flex flex-col divide-y divide-[#DEE5EC] sm:hidden">
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setSelectedUserId(u.id)}
                  className="flex flex-col gap-2 p-4 text-left hover:bg-[#EAF2F7]/40"
                >
                  <div className="flex items-center gap-3">
                    {u.avatarUrl ? (
                      <img src={u.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EAF2F7] text-xs font-semibold text-[#245B78]">
                        {initials(u.name)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium">{u.name}</p>
                      <p className="truncate text-xs text-[#607185]">{u.email}</p>
                    </div>
                    <span
                      className={`ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        u.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {u.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {u.roles.map((role) => (
                      <span key={role} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_BADGE_STYLES[role]}`}>
                        {roleLabels[role]}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {selectedUser && (
        <UserRolesDrawer actor={actor} user={selectedUser} onClose={() => setSelectedUserId(null)} />
      )}
    </div>
  );
}
