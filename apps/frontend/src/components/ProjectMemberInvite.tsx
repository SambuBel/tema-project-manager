import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../lib/api';
import type { Project, ProjectMemberRole, UserWithRoles } from '@tema/shared-types';

interface ProjectMemberInviteProps {
  project: Project;
  onBack: () => void;
}

const ROLE_OPTIONS: { value: ProjectMemberRole; label: string }[] = [
  { value: 'COLLABORATOR', label: 'Colaborador' },
  { value: 'OBSERVER', label: 'Observador' },
];

function initials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase();
}

export function ProjectMemberInvite({ project, onBack }: ProjectMemberInviteProps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserWithRoles | null>(null);
  const [selectedRole, setSelectedRole] = useState<ProjectMemberRole>('COLLABORATOR');

  const { data: candidates, isLoading, isError } = useQuery({
    queryKey: ['available-users', project.id, search],
    queryFn: () => api.getAvailableUsers(project.id, search || undefined),
  });

  const addMutation = useMutation({
    mutationFn: () => api.addProjectMember(project.id, { userId: selectedUser!.id, projectRole: selectedRole }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-members', project.id] });
      onBack();
    },
  });

  const errorMessage =
    addMutation.error instanceof ApiRequestError
      ? addMutation.error.details[0] ?? addMutation.error.message
      : addMutation.error?.message;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    addMutation.mutate();
  };

  return (
    <div className="flex flex-col gap-8 text-[#172B42]">
      {/* Breadcrumb / Volver */}
      <div className="flex items-center text-sm text-[#607185]">
        <button onClick={onBack} className="hover:underline">Mis proyectos</button>
        <span className="mx-2">/</span>
        <button onClick={onBack} className="hover:underline">{project.name}</button>
        <span className="mx-2">/</span>
        <span>Agregar miembro</span>
      </div>

      <div>
        <h1 className="text-3xl font-semibold text-[#172B42]">Agregar miembro</h1>
        <p className="mt-2 text-sm text-[#607185]">
          Buscá a alguien de TEMA y sumalo al proyecto con el acceso adecuado.
        </p>
      </div>

      <div className="flex flex-col rounded-xl border border-[#DEE5EC] bg-white p-8 shadow-sm max-w-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label htmlFor="user-search" className="text-sm font-medium text-[#172B42]">Buscar por nombre o correo</label>
            <input
              id="user-search"
              type="text"
              autoFocus
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelectedUser(null);
              }}
              placeholder="Ej: Cristian o cristian@..."
              className="rounded-lg border border-[#DEE5EC] px-4 py-3 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none focus:ring-1 focus:ring-[#245B78]"
            />
          </div>

          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto rounded-lg border border-[#DEE5EC]">
            {isLoading ? (
              <p className="p-4 text-sm text-[#607185]">Buscando...</p>
            ) : isError ? (
              <p className="p-4 text-sm text-red-600">No se pudo cargar la lista de usuarios.</p>
            ) : !candidates || candidates.length === 0 ? (
              <p className="p-4 text-sm italic text-[#607185]">
                {search ? 'No hay resultados para esa búsqueda.' : 'No hay más usuarios de TEMA para agregar a este proyecto.'}
              </p>
            ) : (
              candidates.map((candidate) => {
                const isSelected = selectedUser?.id === candidate.id;
                return (
                  <button
                    type="button"
                    key={candidate.id}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedUser(candidate)}
                    className={`flex items-center gap-3 border-l-4 px-4 py-3 text-left transition-colors ${
                      isSelected
                        ? 'border-[#245B78] bg-[#D6E6F0]'
                        : 'border-transparent hover:bg-gray-50'
                    }`}
                  >
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${
                        isSelected ? 'bg-[#245B78] text-white' : 'bg-[#EAF2F7] text-[#245B78]'
                      }`}
                    >
                      {initials(candidate.name)}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{candidate.name}</div>
                      <div className="text-xs text-[#607185]">{candidate.email}</div>
                    </div>
                    {isSelected && (
                      <span aria-hidden="true" className="text-lg font-bold text-[#245B78]">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="member-role" className="text-sm font-medium text-[#172B42]">Rol *</label>
            <select
              id="member-role"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as ProjectMemberRole)}
              className="rounded-lg border border-[#DEE5EC] px-4 py-3 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none focus:ring-1 focus:ring-[#245B78] bg-white"
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="text-xs text-[#607185]">Este rol aplica únicamente a este proyecto.</p>
          </div>

          {addMutation.isError && (
            <div className="text-sm text-red-600 font-medium bg-red-50 p-3 rounded-lg border border-red-100">
              No se pudo agregar al miembro: {errorMessage}
            </div>
          )}

          <div className="mt-2 flex justify-end gap-4">
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg border border-[#DEE5EC] bg-white px-6 py-2.5 text-sm font-medium text-[#172B42]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!selectedUser || addMutation.isPending}
              className="rounded-lg bg-[#245B78] px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#1a445b] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {addMutation.isPending ? 'Agregando...' : 'Agregar al proyecto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
