import { TaskForm } from './TaskForm';
import type { Project } from '@tema/shared-types';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useMyMembership } from '../hooks/useMyMembership';
import { canCreateTaskUI } from '../lib/permissions';

/**
 * Contenido de la pestaña "Resumen" del proyecto.
 */

interface ProjectDetailProps {
  project: Project;
  onManageTeam: () => void;
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

export function ProjectDetail({ project, onManageTeam }: ProjectDetailProps) {
  const { user } = useCurrentUser();
  const { membership } = useMyMembership(project.id);
  const canCreateTask = !!user && canCreateTaskUI(user, project, membership);

  return (
    <>
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
            {project.estimatedEndDate ? formatDate(project.estimatedEndDate).split(' de 20')[0] : '-'}
          </p>
          <p className="mt-2 text-sm text-[#607185]">
            {project.estimatedEndDate ? 'Fecha estimada' : 'No definida'}
          </p>
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

      {/* Próximos hitos */}
      <div className="flex flex-col rounded-xl border border-[#DEE5EC] bg-white p-6">
        <h3 className="text-lg font-semibold text-[#172B42]">Próximos hitos</h3>
        <p className="mt-4 text-sm italic text-[#607185]">
          No hay hitos disponibles todavía.
        </p>
      </div>

      {/* Alta de tareas: nunca puede -> no se renderiza (no solo deshabilitado) */}
      {canCreateTask && <TaskForm projectId={project.id} />}
    </>
  );
}