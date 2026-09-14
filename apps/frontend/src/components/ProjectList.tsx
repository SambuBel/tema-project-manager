import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ProjectStatus, ListProjectsQuery } from '@tema/shared-types';

const statusLabels: Record<ProjectStatus, string> = {
  PLANNED: 'Planificado',
  IN_PROGRESS: 'En curso',
  PAUSED: 'En pausa',
  FINISHED: 'Finalizado',
  CANCELLED: 'Cancelado',
};

export function ProjectList() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<ListProjectsQuery>({});
  
  // Use a separate state for the text input to debounce or apply on search/enter, 
  // but to keep it simple and reactive we can just apply on change or submit.
  // We'll use a form for the search bar to apply filters on submit.
  const [searchInput, setSearchInput] = useState('');

  const projects = useQuery({
    queryKey: ['projects', filters],
    queryFn: () => api.listProjects(filters),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['projects'] }),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ProjectStatus }) =>
      api.updateProjectStatus(id, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['projects'] }),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.archiveProject(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['projects'] }),
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters((prev) => ({ ...prev, name: searchInput || undefined }));
  };

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as ProjectStatus | '';
    setFilters((prev) => ({ ...prev, status: value || undefined }));
  };

  const handleArchive = (id: string) => {
    if (window.confirm('¿Querés archivar este proyecto?')) {
      archive.mutate(id);
    }
  };

  const isArchivedView = filters.archived === true;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex border-b border-gray-200">
        <button
          className={`px-4 py-2 font-medium ${!isArchivedView ? 'border-b-2 border-black text-black' : 'text-gray-500'}`}
          onClick={() => setFilters((prev) => ({ ...prev, archived: undefined }))}
        >
          Activos
        </button>
        <button
          className={`px-4 py-2 font-medium ${isArchivedView ? 'border-b-2 border-black text-black' : 'text-gray-500'}`}
          onClick={() => setFilters((prev) => ({ ...prev, archived: true }))}
        >
          Archivados
        </button>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          className="flex-1 rounded border border-gray-300 px-3 py-2"
          placeholder="Buscar proyecto"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select
          className="rounded border border-gray-300 px-3 py-2"
          value={filters.status ?? ''}
          onChange={handleStatusChange}
        >
          <option value="">Todos</option>
          {Object.entries(statusLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <button
          className="rounded bg-black px-4 py-2 text-white"
          type="submit"
        >
          Buscar
        </button>
      </form>

      {projects.isLoading && <p className="text-gray-500">Cargando proyectos...</p>}
      
      {projects.isError && (
        <p className="text-red-600">Error al cargar el listado de proyectos.</p>
      )}

      {projects.isSuccess && projects.data.length === 0 && (
        <p className="text-gray-500">No se encontraron proyectos con los filtros actuales.</p>
      )}

      {projects.isSuccess && projects.data.length > 0 && (
        <ul className="space-y-4">
          {projects.data.map((p) => {
            const canArchive = p.status === 'FINISHED' || p.status === 'CANCELLED';
            return (
              <li
                key={p.id}
                className="flex flex-col gap-2 rounded border border-gray-200 px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium">{p.name}</div>
                  <div className="flex items-center gap-4">
                    <select
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                      value={p.status}
                      onChange={(e) =>
                        updateStatus.mutate({
                          id: p.id,
                          status: e.target.value as ProjectStatus,
                        })
                      }
                      disabled={isArchivedView || (updateStatus.isPending && updateStatus.variables?.id === p.id)}
                    >
                      {Object.entries(statusLabels).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                    
                    {!isArchivedView && canArchive && (
                      <button
                        className="text-sm text-yellow-600 hover:underline disabled:opacity-50"
                        onClick={() => handleArchive(p.id)}
                        disabled={archive.isPending && archive.variables === p.id}
                      >
                        Archivar
                      </button>
                    )}
                  </div>
                </div>
                
                {updateStatus.isError && updateStatus.variables?.id === p.id && (
                  <div className="text-xs text-red-600">
                    {/* FIXME: DEPENDENCY BLOCKER */}
                    Error al cambiar estado. Pendiente de integración con Auth (falta usuario en sesión).
                  </div>
                )}
                
                {archive.isError && archive.variables === p.id && (
                  <div className="text-xs text-red-600">
                    Error al archivar el proyecto.
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
