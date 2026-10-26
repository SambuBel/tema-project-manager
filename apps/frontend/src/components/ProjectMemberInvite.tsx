import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../lib/api';
import type { Project, ProjectMemberRole, UserWithRoles } from '@tema/shared-types';

interface ProjectMemberInviteProps {
  project: Project;
  onBack: () => void;
}

interface SelectedMemberItem {
  user: UserWithRoles;
  role: ProjectMemberRole;
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
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<SelectedMemberItem[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: candidates, isLoading, isError } = useQuery({
    queryKey: ['available-users', project.id, search],
    queryFn: () => api.getAvailableUsers(project.id, search || undefined),
  });

  // Cerrar el dropdown si se hace click fuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addMembersMutation = useMutation({
    mutationFn: async () => {
      for (const item of selectedMembers) {
        await api.addProjectMember(project.id, {
          userId: item.user.id,
          projectRole: item.role,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-members', project.id] });
      onBack();
    },
  });

  const errorMessage =
    addMembersMutation.error instanceof ApiRequestError
      ? addMembersMutation.error.details[0] ?? addMembersMutation.error.message
      : addMembersMutation.error?.message;

  const handleSelectUser = (user: UserWithRoles) => {
    // Si no está ya seleccionado, lo agregamos con rol Colaborador por defecto
    if (!selectedMembers.some((m) => m.user.id === user.id)) {
      setSelectedMembers((prev) => [...prev, { user, role: 'COLLABORATOR' }]);
    }
    // Ocultar la lista y limpiar el buscador
    setIsDropdownOpen(false);
    setSearch('');
  };

  const handleRemoveSelected = (userId: string) => {
    setSelectedMembers((prev) => prev.filter((m) => m.user.id !== userId));
  };

  const handleChangeRole = (userId: string, newRole: ProjectMemberRole) => {
    setSelectedMembers((prev) =>
      prev.map((m) => (m.user.id === userId ? { ...m, role: newRole } : m)),
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedMembers.length === 0) return;
    addMembersMutation.mutate();
  };

  // Filtrar de los candidatos a aquellos que ya fueron seleccionados
  const availableCandidates = (candidates ?? []).filter(
    (c) => !selectedMembers.some((m) => m.user.id === c.id),
  );

  return (
    <div className="flex flex-col gap-8 text-[#172B42]">
      {/* Breadcrumb / Volver */}
      <div className="flex items-center text-sm text-[#607185]">
        <button onClick={onBack} className="hover:underline">Mis proyectos</button>
        <span className="mx-2">/</span>
        <button onClick={onBack} className="hover:underline">{project.name}</button>
        <span className="mx-2">/</span>
        <span>Agregar miembros</span>
      </div>

      <div>
        <h1 className="text-3xl font-semibold text-[#172B42]">Agregar miembros</h1>
        <p className="mt-2 text-sm text-[#607185]">
          Buscá personas de TEMA, seleccionalas y asignale el rol correspondiente a cada una.
        </p>
      </div>

      <div className="flex flex-col rounded-xl border border-[#DEE5EC] bg-white p-8 shadow-sm max-w-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* Campo buscador con dropdown flotante */}
          <div className="relative flex flex-col gap-2" ref={dropdownRef}>
            <label htmlFor="user-search" className="text-sm font-medium text-[#172B42]">
              Buscar por nombre o correo
            </label>
            <input
              id="user-search"
              type="text"
              autoFocus
              value={search}
              onFocus={() => setIsDropdownOpen(true)}
              onChange={(e) => {
                setSearch(e.target.value);
                setIsDropdownOpen(true);
              }}
              placeholder="Ej: Cristian o cristian@..."
              className="rounded-lg border border-[#DEE5EC] px-4 py-3 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none focus:ring-1 focus:ring-[#245B78]"
            />

            {/* Lista desplegable que se cierra al seleccionar */}
            {isDropdownOpen && (
              <div className="absolute top-[100%] left-0 right-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-[#DEE5EC] bg-white shadow-lg">
                {isLoading ? (
                  <p className="p-4 text-sm text-[#607185]">Buscando...</p>
                ) : isError ? (
                  <p className="p-4 text-sm text-red-600">No se pudo cargar la lista de usuarios.</p>
                ) : availableCandidates.length === 0 ? (
                  <p className="p-4 text-sm italic text-[#607185]">
                    {search ? 'No hay resultados para esa búsqueda.' : 'No hay más usuarios disponibles.'}
                  </p>
                ) : (
                  availableCandidates.map((candidate) => (
                    <button
                      type="button"
                      key={candidate.id}
                      onClick={() => handleSelectUser(candidate)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EAF2F7] text-xs font-semibold text-[#245B78]">
                        {initials(candidate.name)}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-[#172B42]">{candidate.name}</div>
                        <div className="text-xs text-[#607185]">{candidate.email}</div>
                      </div>
                      <span className="text-xs font-semibold text-[#245B78] bg-[#EAF2F7] px-2 py-1 rounded">
                        + Seleccionar
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Lista de usuarios seleccionados con asignación individual de rol */}
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium text-[#172B42]">
              Usuarios seleccionados ({selectedMembers.length})
            </label>

            {selectedMembers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#DEE5EC] p-6 text-center text-sm text-[#607185]">
                No seleccionaste a nadie todavía. Buscá arriba y hacé clic para sumarlo.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {selectedMembers.map(({ user, role }) => (
                  <div
                    key={user.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#DEE5EC] bg-[#F8FAFC] p-3.5"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#245B78] text-xs font-semibold text-white">
                        {initials(user.name)}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-[#172B42]">{user.name}</div>
                        <div className="text-xs text-[#607185]">{user.email}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[#607185]">Rol:</span>
                        <select
                          value={role}
                          onChange={(e) => handleChangeRole(user.id, e.target.value as ProjectMemberRole)}
                          className="rounded-md border border-[#DEE5EC] bg-white px-2.5 py-1.5 text-xs font-medium text-[#172B42] focus:border-[#245B78] focus:outline-none focus:ring-1 focus:ring-[#245B78]"
                        >
                          {ROLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveSelected(user.id)}
                        className="rounded-md p-1.5 text-[#607185] hover:bg-red-50 hover:text-red-600 transition-colors"
                        title="Quitar de la lista"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {addMembersMutation.isError && (
            <div className="text-sm text-red-600 font-medium bg-red-50 p-3 rounded-lg border border-red-100">
              No se pudo agregar a los miembros: {errorMessage}
            </div>
          )}

          <div className="mt-2 flex justify-end gap-4">
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg border border-[#DEE5EC] bg-white px-6 py-2.5 text-sm font-medium text-[#172B42] hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={selectedMembers.length === 0 || addMembersMutation.isPending}
              className="rounded-lg bg-[#245B78] px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#1a445b] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {addMembersMutation.isPending
                ? 'Agregando...'
                : `Agregar ${selectedMembers.length > 1 ? `(${selectedMembers.length}) al proyecto` : 'al proyecto'}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
