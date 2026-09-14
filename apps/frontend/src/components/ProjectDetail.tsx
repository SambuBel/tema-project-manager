import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ProjectStatus } from '@tema/shared-types';

interface ProjectDetailProps {
  id: string;
  onBack: () => void;
}

const statusLabels: Record<ProjectStatus, string> = {
  PLANNED: 'Planificado',
  IN_PROGRESS: 'En curso',
  PAUSED: 'En pausa',
  FINISHED: 'Finalizado',
  CANCELLED: 'Cancelado',
};

export function ProjectDetail({ id, onBack }: ProjectDetailProps) {
  const { data: project, isLoading, isError } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.getProject(id),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <button onClick={onBack} className="self-start text-sm text-gray-500 hover:underline">
          &larr; Volver
        </button>
        <p className="text-gray-500">Cargando proyecto...</p>
      </div>
    );
  }

  if (isError || !project) {
    return (
      <div className="flex flex-col gap-4">
        <button onClick={onBack} className="self-start text-sm text-gray-500 hover:underline">
          &larr; Volver
        </button>
        <p className="text-red-600">Error al cargar el detalle del proyecto.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <button onClick={onBack} className="self-start text-sm text-gray-500 hover:underline">
        &larr; Volver al listado
      </button>

      {/* Header del proyecto */}
      <div className="flex items-center justify-between rounded border border-gray-200 bg-gray-50 p-6">
        <div>
          <h2 className="text-2xl font-bold">{project.name}</h2>
          {project.description && (
            <p className="mt-2 text-gray-600">{project.description}</p>
          )}
        </div>
        <span className="rounded bg-black px-3 py-1 text-sm font-medium text-white">
          {statusLabels[project.status]}
        </span>
      </div>

      {/* Datos principales */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded border border-gray-200 p-4">
          <h3 className="mb-4 text-lg font-semibold">Información General</h3>
          <div className="flex flex-col gap-2 text-sm">
            <div>
              <span className="font-medium text-gray-500">Líder: </span>
              <span>{project.leader ? project.leader.name : 'Sin líder asignado'}</span>
            </div>
            <div>
              <span className="font-medium text-gray-500">Fecha de inicio: </span>
              <span>{project.startDate ?? 'No definida'}</span>
            </div>
            <div>
              <span className="font-medium text-gray-500">Fecha estimada de fin: </span>
              <span>{project.estimatedEndDate ?? 'No definida'}</span>
            </div>
            {project.archivedAt && (
              <div>
                <span className="font-medium text-gray-500">Archivado el: </span>
                <span>{new Date(project.archivedAt).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Bloque de Avance (Placeholder) */}
        <div className="rounded border border-gray-200 p-4">
          <h3 className="mb-4 text-lg font-semibold">Avance</h3>
          <p className="text-sm text-gray-500 italic">No hay información de avance disponible todavía.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Bloque de Tareas (Placeholder) */}
        <div className="rounded border border-gray-200 p-4">
          <h3 className="mb-4 text-lg font-semibold">Tareas</h3>
          <p className="text-sm text-gray-500 italic">No hay información de tareas disponible todavía.</p>
        </div>

        {/* Bloque de Equipo (Placeholder) */}
        <div className="rounded border border-gray-200 p-4">
          <h3 className="mb-4 text-lg font-semibold">Equipo</h3>
          <p className="text-sm text-gray-500 italic">No hay información del equipo disponible todavía.</p>
        </div>
      </div>

      {/* Bloque de Situación Presupuestaria (Placeholder) */}
      <div className="rounded border border-gray-200 p-4">
        <h3 className="mb-4 text-lg font-semibold">Situación Presupuestaria</h3>
        <p className="text-sm text-gray-500 italic">No hay información presupuestaria disponible todavía.</p>
      </div>

    </div>
  );
}
