import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ProjectStatus, ListProjectsQuery, Project } from '@tema/shared-types';

const statusLabels: Record<ProjectStatus, string> = {
  PLANNED: 'Planificado',
  IN_PROGRESS: 'En curso',
  PAUSED: 'En pausa',
  FINISHED: 'Finalizado',
  CANCELLED: 'Cancelado',
};

interface ProjectListProps {
  onSelectProject: (id: string) => void;
}

export function ProjectList({ onSelectProject }: ProjectListProps) {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<ListProjectsQuery>({});

  const [searchInput, setSearchInput] = useState('');

  const projects = useQuery({
    queryKey: ['projects', filters],
    queryFn: () => api.listProjects(filters),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.archiveProject(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['projects'] }),
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters((prev) => ({ ...prev, name: searchInput || undefined }));
  };

  const isArchivedView = filters.archived === true;

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Sin fecha';
    const [year, month, day] = dateStr.split('T')[0].split('-');
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    return `${d.getDate()} ${d.toLocaleString('es', { month: 'short' }).substring(0, 3)}`;
  };

  // Mock progress for now as it's not in the API
  const getMockProgress = (id: string) => {
    return Math.abs(id.hashCode ? id.hashCode() % 100 : 50);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex bg-white rounded-md overflow-hidden border border-gray-200">
          <button
            className={`px-6 py-2 text-sm font-medium ${!isArchivedView ? 'bg-sidebar-card text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            onClick={() => setFilters((prev) => ({ ...prev, archived: undefined }))}
          >
            Activos
          </button>
          <button
            className={`px-6 py-2 text-sm font-medium ${isArchivedView ? 'bg-sidebar-card text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            onClick={() => setFilters((prev) => ({ ...prev, archived: true }))}
          >
            Archivados
          </button>
        </div>

        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            className="rounded-md border border-gray-300 px-4 py-2 text-sm w-64 focus:outline-none focus:ring-1 focus:ring-sidebar-card"
            placeholder="Filtrar"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </form>
      </div>

      {projects.isLoading && <p className="text-gray-500">Cargando proyectos...</p>}

      {projects.isError && <p className="text-red-600">Error al cargar el listado de proyectos.</p>}

      {projects.isSuccess && projects.data.length === 0 && (
        <p className="text-gray-500">No se encontraron proyectos con los filtros actuales.</p>
      )}

      {projects.isSuccess && projects.data.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.data.map((p) => {
            const initials =
              p.leader?.name
                ?.split(' ')
                .map((n) => n[0])
                .join('')
                .substring(0, 2)
                .toUpperCase() || 'U';
            return (
              <div
                key={p.id}
                className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
              >
                <div className="mb-4">
                  <span className="inline-block rounded bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                    {statusLabels[p.status]}
                  </span>
                </div>

                <h3 className="mb-1 text-lg font-bold text-gray-900">{p.name}</h3>
                <p className="mb-5 text-sm text-gray-500">{p.description || 'Sin descripción'}</p>

                <div className="mb-2 h-1.5 w-full rounded-full bg-gray-200">
                  <div
                    className="h-1.5 rounded-full bg-[#5E8E7E]"
                    style={{ width: `${Math.random() * 50 + 20}%` }}
                  ></div>
                </div>

                <p className="mb-6 text-xs text-gray-500">
                  {Math.floor(Math.random() * 50 + 20)}% de avance · Entrega{' '}
                  {formatDate(p.estimatedEndDate)}
                </p>

                <div className="mt-auto mb-5 flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-600">
                    {initials}
                  </div>
                  <span className="text-sm font-medium text-gray-700">
                    {p.leader?.name || 'Sin asignar'}
                  </span>
                </div>

                <button
                  className="w-full rounded-md bg-sidebar-card py-2.5 text-sm font-medium text-white hover:bg-sidebar-hover transition-colors"
                  onClick={() => onSelectProject(p.id)}
                >
                  Abrir proyecto
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
