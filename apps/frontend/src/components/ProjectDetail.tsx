import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { MilestoneStatus, Project } from '@tema/shared-types';

/**
 * Contenido de la pestaña "Resumen" del proyecto.
 */

interface ProjectDetailProps {
  project: Project;
  onManageTeam: () => void;
  onViewMilestones?: () => void;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'No definida';
  try {
    const parts = dateStr.split('T')[0]?.split('-');
    if (!parts || parts.length < 3) return dateStr;
    const [year, month, day] = parts;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

const MILESTONE_STATUS_STYLES: Record<MilestoneStatus, { bg: string; text: string; label: string }> = {
  PENDING: { bg: 'bg-[#EAF2F7]', text: 'text-[#245B78]', label: 'Pendiente' },
  OVERDUE: { bg: 'bg-[#FDECEA]', text: 'text-[#C62828]', label: 'Vencido' },
  COMPLETED: { bg: 'bg-[#EAF5EA]', text: 'text-[#2E7D32]', label: 'Alcanzado' },
};

export function ProjectDetail({ project, onManageTeam, onViewMilestones }: ProjectDetailProps) {
  const { data: upcomingMilestones, isLoading: loadingMilestones, isError: errorMilestones } = useQuery({
    queryKey: ['milestones-upcoming', project.id],
    queryFn: () => api.listMilestones(project.id, { upcoming: true, limit: 3 }),
  });

  return (
    <>
      {/* Tarjetas Superiores */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="flex flex-col justify-center rounded-xl border border-[#DEE5EC] bg-white p-6">
          <h3 className="text-sm font-medium text-[#607185]">Avance</h3>
          <p className="mt-2 text-3xl font-semibold">
            {project.progress !== undefined ? `${project.progress}%` : '-'}
          </p>
          <p className="mt-2 text-sm text-[#607185]">
            {project.progress !== undefined ? 'De tareas completadas' : 'Sin métricas disponibles'}
          </p>
        </div>

        <div className="flex flex-col justify-center rounded-xl border border-[#DEE5EC] bg-white p-6">
          <h3 className="text-sm font-medium text-[#607185]">Entrega</h3>
          <p className="mt-2 text-3xl font-semibold">
            {project.estimatedEndDate ? formatDate(project.estimatedEndDate).split(' de 20')[0] : '-'}
          </p>
          <p className="mt-2 text-sm text-[#607185]">
            {project.estimatedEndDate ? 'Fecha estimada' : 'No definida'}
          </p>
        </div>

        <div className="flex flex-col justify-center rounded-xl border border-[#DEE5EC] bg-white p-6">
          <h3 className="text-sm font-medium text-[#607185]">Equipo</h3>
          <p className="mt-2 text-3xl font-semibold">
            {project.memberCount !== undefined ? project.memberCount : '-'}
          </p>
          <p className="mt-2 text-sm text-[#607185]">
            {project.memberCount !== undefined ? 'Miembros activos' : 'Información de equipo pendiente'}
          </p>
        </div>
      </div>

      {/* Bloque Central: Objetivo y Equipo */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Objetivo */}
        <div className="col-span-1 flex flex-col rounded-xl border border-[#DEE5EC] bg-white p-6 md:col-span-2">
          <h3 className="text-lg font-semibold text-[#172B42]">Objetivo del proyecto</h3>
          {project.description ? (
            <p className="mt-4 text-base leading-relaxed text-[#172B42]">
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
                  {project.leader.name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .substring(0, 2)
                    .toUpperCase()}
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

          <button
            onClick={onManageTeam}
            className="mt-auto w-full rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] hover:bg-gray-50"
          >
            Gestionar equipo
          </button>
        </div>
      </div>

      {/* Próximos hitos (KAN-246) */}
      <div className="flex flex-col rounded-xl border border-[#DEE5EC] bg-white p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[#172B42]">Próximos hitos</h3>
          {onViewMilestones && (
            <button
              onClick={onViewMilestones}
              className="text-sm font-medium text-[#245B78] hover:underline"
            >
              Ver todos los hitos &rarr;
            </button>
          )}
        </div>

        {loadingMilestones && (
          <p className="mt-4 text-sm text-[#607185]">Cargando próximos hitos...</p>
        )}

        {errorMilestones && (
          <p className="mt-4 text-sm text-red-600">No se pudieron cargar los próximos hitos.</p>
        )}

        {!loadingMilestones && !errorMilestones && (!upcomingMilestones || upcomingMilestones.length === 0) && (
          <div className="mt-4 flex flex-col items-start gap-2">
            <p className="text-sm italic text-[#607185]">
              No hay próximos hitos programados en este proyecto.
            </p>
            {onViewMilestones && (
              <button
                onClick={onViewMilestones}
                className="mt-2 rounded-lg border border-[#DEE5EC] bg-white px-3 py-1.5 text-xs font-medium text-[#172B42] hover:bg-gray-50"
              >
                Ir a la pestaña de Hitos
              </button>
            )}
          </div>
        )}

        {!loadingMilestones && !errorMilestones && upcomingMilestones && upcomingMilestones.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {upcomingMilestones.map((m) => {
              const statusInfo = MILESTONE_STATUS_STYLES[m.status] || MILESTONE_STATUS_STYLES.PENDING;
              return (
                <div
                  key={m.id}
                  className="flex flex-col justify-between rounded-lg border border-[#DEE5EC] bg-[#FAFCFD] p-4 transition-shadow hover:shadow-sm"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-medium text-[#172B42] line-clamp-1" title={m.name}>
                        {m.name}
                      </h4>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.bg} ${statusInfo.text}`}>
                        {statusInfo.label}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[#607185]">
                      Fecha objetivo: <span className="font-medium text-[#172B42]">{formatDate(m.dueDate)}</span>
                    </p>
                  </div>

                  <div className="mt-4">
                    <div className="flex justify-between text-xs text-[#607185] mb-1">
                      <span>Progreso ({m.completedTaskCount}/{m.taskCount})</span>
                      <span className="font-semibold text-[#172B42]">{m.progress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#E5E9EB]">
                      <div
                        className="h-full rounded-full bg-[#245B78] transition-all duration-300"
                        style={{ width: `${m.progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
