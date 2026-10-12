import { useCallback, useMemo } from 'react';
import { Gantt, Willow } from '@svar-ui/react-gantt';
import type { ITask } from '@svar-ui/react-gantt';
import '@svar-ui/react-gantt/style.css';
import './gantt.css';
import { useGantt } from '../../hooks/useGantt';
import { buildGanttView } from '../../lib/ganttAdapter';
import { formatLocalDate, isSameDay, startOfToday } from '../../lib/dates';

interface ProjectGanttProps {
  projectId: string;
}

/** Columnas de la grilla izquierda. Sin "add-task": esta versión es SOLO LECTURA. */
const COLUMNS = [
  { id: 'text', header: 'Tarea', flexgrow: 1 },
  { id: 'start', header: 'Inicio', width: 120, align: 'center' as const },
  { id: 'end', header: 'Vence', width: 120, align: 'center' as const },
];

/** Contenido de cada barra: nombre, con candado si la tarea está bloqueada por dependencias. */
function TaskBar({ data }: { data: ITask }) {
  const blocked = data.blocked === true;
  return (
    <div title={blocked ? 'Bloqueada: tiene predecesoras sin completar' : undefined} className="truncate px-1">
      {blocked && <span aria-label="Bloqueada">🔒 </span>}
      {data.text}
    </div>
  );
}

/**
 * Vista Gantt de un proyecto (solo lectura): barras por tarea/subtarea, flechas de dependencias
 * fin-inicio y línea de hoy. Los datos vienen del read model del backend; la librería solo dibuja.
 */
export function ProjectGantt({ projectId }: ProjectGanttProps) {
  const { data, isPending, isError } = useGantt(projectId);

  const view = useMemo(() => (data ? buildGanttView(data) : null), [data]);
  // Línea de hoy: la edición open-source de SVAR deshabilita el prop `markers` (es PRO), pero sí
  // ofrece `highlightTime`: marcamos la columna del día actual con una clase CSS (ver gantt.css).
  const highlightToday = useCallback(
    (date: Date, unit: 'day' | 'hour') => (unit === 'day' && isSameDay(date, startOfToday()) ? 'tema-gantt-today' : ''),
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
      {unscheduledCount > 0 && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {`Hay ${unscheduledCount} ${unscheduledCount === 1 ? 'tarea' : 'tareas'} sin fechas de planificación.`}
        </div>
      )}

      {view.tasks.length === 0 ? (
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
              tasks={view.tasks}
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
