import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gantt, Willow } from '@svar-ui/react-gantt';
import type { ITask } from '@svar-ui/react-gantt';
import '@svar-ui/react-gantt/style.css';
import './gantt.css';
import { api } from '../../lib/api';
import { useGantt } from '../../hooks/useGantt';
import { buildGanttView } from '../../lib/ganttAdapter';
import { mergeGanttTasksWithMilestones } from '../../lib/ganttMilestonesAdapter';
import { formatLocalDate, isSameDay, startOfToday } from '../../lib/dates';
import { GanttMilestonesPanel } from './GanttMilestonesPanel';

interface ProjectGanttProps {
  projectId: string;
}

/** Columnas de la grilla izquierda. Sin "add-task": esta versión es SOLO LECTURA. */
const COLUMNS = [
  { id: 'text', header: 'Tarea', flexgrow: 1 },
  { id: 'start', header: 'Inicio', width: 120, align: 'center' as const },
  { id: 'end', header: 'Vence', width: 120, align: 'center' as const },
];

/**
 * Vista Gantt de un proyecto (solo lectura): barras por tarea/subtarea, marcadores tipo milestone (rombo)
 * para los hitos del proyecto (KAN-280), flechas de dependencias fin-inicio y línea de hoy.
 */
export function ProjectGantt({ projectId }: ProjectGanttProps) {
  const { data, isPending, isError } = useGantt(projectId);
  const { data: milestones } = useQuery({
    queryKey: ['milestones', projectId],
    queryFn: () => api.listMilestones(projectId),
    enabled: Boolean(projectId),
  });
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);

  const view = useMemo(() => (data ? buildGanttView(data) : null), [data]);
  const ganttTasks = useMemo(
    () => (view ? mergeGanttTasksWithMilestones(view.tasks, milestones) : []),
    [view, milestones],
  );

  // Línea de hoy: la edición open-source de SVAR deshabilita el prop `markers` (es PRO), pero sí
  // ofrece `highlightTime`: marcamos la columna del día actual con una clase CSS (ver gantt.css).
  const highlightToday = useCallback(
    (date: Date, unit: 'day' | 'hour') => (unit === 'day' && isSameDay(date, startOfToday()) ? 'tema-gantt-today' : ''),
    [],
  );

  const TaskBar = useCallback(
    ({ data: item }: { data: ITask }) => {
      if (item.isMilestone) {
        const isCompleted = item.milestoneStatus === 'COMPLETED';
        const isOverdue = item.milestoneStatus === 'OVERDUE';
        const statusText = isCompleted ? 'Alcanzado' : isOverdue ? 'Vencido' : 'Pendiente';
        return (
          <button
            type="button"
            onClick={() => setSelectedMilestoneId(String(item.milestoneId))}
            title={`Hito: ${item.text} (${statusText}) — Avance: ${item.milestoneProgress ?? 0}%`}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ${
              isCompleted
                ? 'bg-emerald-100 text-emerald-900'
                : isOverdue
                  ? 'bg-rose-100 text-rose-900'
                  : 'bg-[#EAF2F7] text-[#172B42]'
            }`}
          >
            <span aria-hidden="true">{isCompleted ? '✓ ◆' : '◆'}</span>
            <span className="truncate">{item.text}</span>
          </button>
        );
      }

      const blocked = item.blocked === true;
      return (
        <div title={blocked ? 'Bloqueada: tiene predecesoras sin completar' : undefined} className="truncate px-1">
          {blocked && <span aria-label="Bloqueada">🔒 </span>}
          {item.text}
        </div>
      );
    },
    [],
  );

  if (isPending) {
    return <p className="text-sm text-[#607185]">Cargando Gantt…</p>;
  }

  if (isError || !data || !view) {
    return <p className="text-sm text-red-600">No se pudo cargar el Gantt del proyecto.</p>;
  }

  const unscheduledCount = view.unscheduled.length;

  return (
    <div className="flex flex-col gap-4">
      {milestones && milestones.length > 0 && (
        <GanttMilestonesPanel
          milestones={milestones}
          selectedMilestoneId={selectedMilestoneId}
          onSelectMilestone={setSelectedMilestoneId}
        />
      )}

      {unscheduledCount > 0 && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {`Hay ${unscheduledCount} ${unscheduledCount === 1 ? 'tarea' : 'tareas'} sin fechas de planificación.`}
        </div>
      )}

      {ganttTasks.length === 0 ? (
        // Sin nada que dibujar. Si NO hay ninguna tarea → "no tiene tareas"; si hay pero ninguna con
        // fechas → "no tiene tareas planificadas" (y el aviso/listado de arriba y abajo las muestra).
        <p className="rounded-xl border border-[#DEE5EC] bg-white p-6 text-sm text-[#607185]">
          {unscheduledCount === 0
            ? 'Este proyecto todavía no tiene tareas.'
            : 'Este proyecto todavía no tiene tareas planificadas.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#DEE5EC] bg-white" style={{ height: 520 }}>
          <Willow>
            <Gantt
              tasks={ganttTasks}
              links={view.links}
              columns={COLUMNS}
              highlightTime={highlightToday}
              taskTemplate={TaskBar}
              gridWidth={480}
              cellWidth={44}
              inclusiveEnd
              readonly
            />
          </Willow>
        </div>
      )}

      {unscheduledCount > 0 && (
        <div className="rounded-xl border border-[#DEE5EC] bg-white p-4">
          <h3 className="text-sm font-semibold text-[#172B42]">Tareas sin planificar</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-[#172B42]">
            {view.unscheduled.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {task.blocked && <span aria-label="Bloqueada">🔒 </span>}
                  {task.title}
                </span>
                <span className="text-xs text-[#607185]">
                  {task.startDate || task.dueDate
                    ? `Inicio: ${formatLocalDate(task.startDate)} · Vence: ${formatLocalDate(task.dueDate)}`
                    : 'Sin fechas'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
