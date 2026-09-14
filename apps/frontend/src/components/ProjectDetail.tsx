import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'No definida';
  // simple formatting, e.g. "18 sep" or just ISO depending on what we have. 
  // Let's use Date object for standard formatting
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function ProjectDetail({ id, onBack }: ProjectDetailProps) {
  const qc = useQueryClient();
  const { data: project, isLoading, isError } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.getProject(id),
  });

  const archive = useMutation({
    mutationFn: (projectId: string) => api.archiveProject(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
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

  const leaderName = project.leader?.name || 'Responsable no disponible';
  const canArchive = project.status === 'FINISHED' || project.status === 'CANCELLED';

  const handleArchive = () => {
    if (window.confirm('¿Querés archivar este proyecto?')) {
      archive.mutate(project.id);
    }
  };

  return (
    <div className="flex flex-col gap-8 text-[#172B42]">
      {/* Breadcrumb / Volver */}
      <div className="flex items-center text-sm text-[#607185]">
        <button onClick={onBack} className="hover:underline">Mis proyectos</button>
        <span className="mx-2">/</span>
        <span>{project.name}</span>
      </div>

      {/* Título y Subtítulo */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold">{project.name}</h1>
          <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
            {statusLabels[project.status]}
          </span>
        </div>
        <p className="mt-2 text-sm text-[#607185]">
          TEMA Consulting · Responsable: {leaderName}
        </p>
      </div>

      {/* Navegación y Acciones */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-2">
          <button className="rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white">
            Resumen
          </button>
          <button className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] opacity-50 cursor-not-allowed">
            Tablero
          </button>
          <button className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] opacity-50 cursor-not-allowed">
            Gantt
          </button>
          <button className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] opacity-50 cursor-not-allowed">
            Archivos
          </button>
        </div>
        
        <div className="flex gap-2">
          <button className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] opacity-50 cursor-not-allowed">
            Editar proyecto
          </button>
          <button 
            className={`rounded-lg border border-[#DEE5EC] px-4 py-2 text-sm font-medium ${canArchive && !project.archivedAt ? 'bg-white text-[#172B42] hover:bg-gray-50' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
            onClick={handleArchive}
            disabled={!canArchive || !!project.archivedAt || archive.isPending}
          >
            {project.archivedAt ? 'Proyecto archivado' : 'Archivar proyecto'}
          </button>
        </div>
      </div>

      {/* Tarjetas Superiores */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="flex flex-col justify-center rounded-xl border border-[#DEE5EC] bg-white p-6">
          <h3 className="text-sm font-medium text-[#607185]">Avance</h3>
          <p className="mt-2 text-3xl font-semibold">-</p>
          <p className="mt-2 text-sm text-[#607185]">Sin métricas disponibles</p>
        </div>
        
        <div className="flex flex-col justify-center rounded-xl border border-[#DEE5EC] bg-white p-6">
          <h3 className="text-sm font-medium text-[#607185]">Entrega</h3>
          <p className="mt-2 text-3xl font-semibold">
            {project.estimatedEndDate ? new Date(project.estimatedEndDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '-'}
          </p>
          <p className="mt-2 text-sm text-[#607185]">{project.estimatedEndDate ? 'Fecha estimada' : 'No definida'}</p>
        </div>

        <div className="flex flex-col justify-center rounded-xl border border-[#DEE5EC] bg-white p-6">
          <h3 className="text-sm font-medium text-[#607185]">Equipo</h3>
          <p className="mt-2 text-3xl font-semibold">-</p>
          <p className="mt-2 text-sm text-[#607185]">Información de equipo pendiente</p>
        </div>
      </div>

      {/* Bloque Central: Objetivo y Equipo */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Objetivo */}
        <div className="col-span-1 flex flex-col rounded-xl border border-[#DEE5EC] bg-white p-6 md:col-span-2">
          <h3 className="text-lg font-semibold text-[#172B42]">Objetivo del proyecto</h3>
          {project.description ? (
            <p className="mt-4 text-base text-[#172B42] leading-relaxed">
              {project.description}
            </p>
          ) : (
            <p className="mt-4 text-base italic text-[#607185]">
              No hay descripción disponible para este proyecto.
            </p>
          )}
          
          <div className="mt-8 text-sm text-[#607185]">
            Inicio: {formatDate(project.startDate)} &nbsp;&nbsp;&nbsp; Finalización: {formatDate(project.estimatedEndDate)}
          </div>
          
          <div className="mt-4 self-start rounded-lg bg-[#EAF2F7] px-3 py-1 text-xs font-medium text-[#245B78]">
            Solo miembros del proyecto
          </div>
        </div>

        {/* Equipo */}
        <div className="col-span-1 flex flex-col rounded-xl border border-[#DEE5EC] bg-white p-6">
          <h3 className="text-lg font-semibold text-[#172B42]">Equipo</h3>
          
          <div className="mt-4 flex flex-col gap-4">
            {project.leader ? (
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#EAF2F7] text-xs font-semibold text-[#245B78]">
                  {project.leader.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                </div>
                <div className="text-sm text-[#172B42]">
                  {project.leader.name} · Líder
                </div>
              </div>
            ) : (
              <p className="text-sm text-[#607185]">Responsable no disponible</p>
            )}
            
            <p className="mt-2 text-sm italic text-[#607185]">
              Los demás integrantes estarán disponibles cuando se integre la gestión de equipo.
            </p>
          </div>
          
          <button className="mt-auto w-full rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] opacity-50 cursor-not-allowed">
            Gestionar equipo
          </button>
        </div>
      </div>

      {/* Próximos hitos */}
      <div className="flex flex-col rounded-xl border border-[#DEE5EC] bg-white p-6">
        <h3 className="text-lg font-semibold text-[#172B42]">Próximos hitos</h3>
        <p className="mt-4 text-sm italic text-[#607185]">
          No hay hitos disponibles todavía.
        </p>
      </div>

    </div>
  );
}
