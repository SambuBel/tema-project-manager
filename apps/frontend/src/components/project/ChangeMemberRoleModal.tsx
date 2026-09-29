import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { ProjectMember, ProjectMemberRole } from '@tema/shared-types';

const ROLE_OPTIONS: { value: ProjectMemberRole; label: string }[] = [
  { value: 'COLLABORATOR', label: 'Colaborador' },
  { value: 'OBSERVER', label: 'Observador' },
];

interface ChangeMemberRoleModalProps {
  projectId: string;
  member: ProjectMember;
  onClose: () => void;
}

/** Usa PATCH /projects/:id/members/:memberId/role, ya implementado en el backend (paso 3). */
export function ChangeMemberRoleModal({ projectId, member, onClose }: ChangeMemberRoleModalProps) {
  const qc = useQueryClient();
  const [role, setRole] = useState<ProjectMemberRole>(member.projectRole);

  const mutation = useMutation({
    mutationFn: (projectRole: ProjectMemberRole) =>
      api.updateProjectMemberRole(projectId, member.id, { projectRole }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project-members', projectId] });
      onClose();
    },
  });

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-role-title"
        className="relative w-full max-w-sm rounded-lg bg-white p-6 shadow-lg"
      >
        <h2 id="change-role-title" className="text-base font-semibold text-[#172B42]">
          Cambiar rol de {member.user?.name ?? 'este usuario'}
        </h2>
        <p className="mt-1 text-sm text-[#607185]">Este rol aplica únicamente a este proyecto.</p>

        <div className="mt-4 flex flex-col gap-2">
          {ROLE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
                role === option.value ? 'border-[#245B78] bg-[#EAF2F7]' : 'border-[#DEE5EC] bg-white'
              }`}
            >
              <input
                type="radio"
                name="project-role"
                value={option.value}
                checked={role === option.value}
                onChange={() => setRole(option.value)}
                className="accent-[#245B78]"
              />
              <span className="font-medium text-[#172B42]">{option.label}</span>
            </label>
          ))}
        </div>

        {mutation.isError && (
          <p className="mt-3 text-sm font-medium text-red-600">No se pudo cambiar el rol. Intentá de nuevo.</p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm font-medium text-[#607185] hover:bg-gray-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate(role)}
            disabled={mutation.isPending || role === member.projectRole}
            className="rounded-md bg-[#245B78] px-3 py-2 text-sm font-medium text-white hover:bg-[#1a445b] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutation.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
