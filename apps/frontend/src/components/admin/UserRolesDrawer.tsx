import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedUser, RoleName, UserWithRoles } from '@tema/shared-types';
import { api } from '../../lib/api';
import { roleLabels } from '../../lib/roles';
import {
  canAssignGlobalRoleUI,
  canAssignProjectLeaderRoleUI,
  canManageGlobalRolesUI,
  canManageUserStatusUI,
  canRemoveGlobalRoleUI,
} from '../../lib/permissions';
import { ConfirmDialog } from '../ConfirmDialog';

const ALL_ROLES: RoleName[] = ['ADMIN', 'PROGRAM_MANAGER', 'PROJECT_LEADER', 'COLLABORATOR', 'OBSERVER'];

interface UserRolesDrawerProps {
  actor: AuthenticatedUser;
  user: UserWithRoles;
  onClose: () => void;
}

function initials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase();
}

/**
 * Mismo componente para ADMIN (editor completo de roles + estado) y para
 * PROGRAM_MANAGER (solo puede asignar PROJECT_LEADER) — "modo restringido" en
 * vez de una pantalla aparte, tal como pide la HU. Qué controles se muestran
 * sale de los helpers de lib/permissions.ts, nunca de un `if (actor.roles...)`
 * local.
 */
export function UserRolesDrawer({ actor, user, onClose }: UserRolesDrawerProps) {
  const qc = useQueryClient();
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['users'] });
    void qc.invalidateQueries({ queryKey: ['user', user.id] });
  };

  const assignRole = useMutation({
    mutationFn: (role: RoleName) => api.assignUserRole(user.id, role),
    onSuccess: invalidate,
  });
  const removeRole = useMutation({
    mutationFn: (role: RoleName) => api.removeUserRole(user.id, role),
    onSuccess: invalidate,
  });
  const updateStatus = useMutation({
    mutationFn: (active: boolean) => api.updateUserStatus(user.id, active),
    onSuccess: () => {
      invalidate();
      setConfirmDeactivate(false);
    },
  });

  const isSelf = actor.id === user.id;
  const canEditAnyRole = canManageGlobalRolesUI(actor, user.id);
  const canAssignLeaderOnly = !canEditAnyRole && canAssignProjectLeaderRoleUI(actor, user.id);
  const canManageStatus = canManageUserStatusUI(actor, user.id);
  const alreadyLeader = user.roles.includes('PROJECT_LEADER');
  const isPending = assignRole.isPending || removeRole.isPending || updateStatus.isPending;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-slate-900/50" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-drawer-title"
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white p-6 shadow-lg"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#EAF2F7] text-sm font-semibold text-[#245B78]">
                {initials(user.name)}
              </span>
            )}
            <div>
              <h2 id="user-drawer-title" className="text-base font-semibold text-[#172B42]">
                {user.name}
              </h2>
              <p className="text-sm text-[#607185]">{user.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-md p-1 text-[#607185] hover:bg-gray-100"
          >
            ✕
          </button>
        </div>

        <div className="mt-6 flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              user.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {user.active ? 'Activo' : 'Inactivo'}
          </span>
        </div>

        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#607185]">Roles globales</h3>

          {isSelf && (
            <p className="mt-2 text-sm italic text-[#607185]">No podés modificar tus propios roles.</p>
          )}

          <div className="mt-3 flex flex-col gap-2">
            {ALL_ROLES.map((role) => {
              const has = user.roles.includes(role);
              // Modo PM restringido: solo se muestra la fila de PROJECT_LEADER con la acción puntual.
              if (canAssignLeaderOnly && role !== 'PROJECT_LEADER') {
                return null;
              }

              const canToggleOn = canAssignGlobalRoleUI(actor, user.id, role);
              const canToggleOff = has && canRemoveGlobalRoleUI(actor, user.id);

              return (
                <div
                  key={role}
                  className="flex items-center justify-between rounded-lg border border-[#DEE5EC] px-3 py-2"
                >
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      has ? 'bg-[#EAF2F7] text-[#245B78]' : 'bg-gray-50 text-gray-400'
                    }`}
                  >
                    {roleLabels[role]}
                  </span>

                  {has ? (
                    canToggleOff && (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => removeRole.mutate(role)}
                        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                      >
                        Quitar
                      </button>
                    )
                  ) : (
                    canToggleOn && (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => assignRole.mutate(role)}
                        className="text-xs font-medium text-[#245B78] hover:underline disabled:opacity-50"
                      >
                        {canAssignLeaderOnly ? 'Asignar rol de Líder' : 'Asignar'}
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>

          {canAssignLeaderOnly && alreadyLeader && (
            <p className="mt-2 text-xs text-[#607185]">Ya tiene el rol de Líder.</p>
          )}

          {(assignRole.isError || removeRole.isError) && (
            <p className="mt-2 text-sm text-red-600">No se pudo actualizar el rol. Intentá de nuevo.</p>
          )}
        </div>

        <Link to="/roles" className="mt-4 self-start text-sm font-medium text-[#245B78] hover:underline">
          Ver permisos del rol →
        </Link>

        {canManageStatus && (
          <div className="mt-auto border-t border-[#DEE5EC] pt-4">
            {user.active ? (
              <button
                type="button"
                onClick={() => setConfirmDeactivate(true)}
                className="rounded-lg border border-[#DEE5EC] px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Desactivar usuario
              </button>
            ) : (
              <button
                type="button"
                disabled={isPending}
                onClick={() => updateStatus.mutate(true)}
                className="rounded-lg border border-[#DEE5EC] px-4 py-2 text-sm font-medium text-[#172B42] hover:bg-gray-50 disabled:opacity-50"
              >
                Reactivar usuario
              </button>
            )}
            {updateStatus.isError && <p className="mt-2 text-sm text-red-600">No se pudo actualizar el estado.</p>}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeactivate}
        title="Desactivar usuario"
        description={`${user.name} no va a poder iniciar sesión hasta que lo reactives.`}
        confirmLabel="Desactivar"
        variant="danger"
        isConfirming={updateStatus.isPending}
        onConfirm={() => updateStatus.mutate(false)}
        onCancel={() => setConfirmDeactivate(false)}
      />
    </div>,
    document.body,
  );
}
