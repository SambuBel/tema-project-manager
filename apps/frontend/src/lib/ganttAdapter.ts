import type { GanttDependency, GanttResponse, GanttTask } from '@tema/shared-types';
import type { ILink, ITask } from '@svar-ui/react-gantt';
import { addDays, parseLocalDate } from './dates';

/**
 * Adapter dominio TEMA → SVAR React Gantt (@svar-ui/react-gantt 2.8.0). Es el ÚNICO lugar que
 * conoce el formato de la librería; el resto de la app trabaja con los tipos de @tema/shared-types.
 *
 * Correspondencias (nombres reales de SVAR, no inventados):
 *   GanttTask.title            → ITask.text
 *   GanttTask.startDate        → ITask.start  (Date local, ver dates.ts)
 *   GanttTask.dueDate (incl.)  → ITask.end    (Date EXCLUSIVO: dueDate + 1 día; SVAR dibuja hasta
 *                                              el inicio de `end`, y el dueDate de TEMA es inclusivo)
 *   GanttTask.parentTaskId     → ITask.parent (0 = raíz)
 *   GanttDependency FINISH_TO_START → ILink type 'e2s' (end-to-start), source = predecesora,
 *                                      target = sucesora
 * Campos propios (ITask admite claves extra): status, blocked, assignee, y type 'task' en todas
 * (no 'summary': SVAR recalcularía las fechas del padre desde sus hijos y pisaría las de TEMA).
 */

export interface GanttView {
  /** Tareas que SVAR puede representar (fechas válidas), padre antes que hijos. */
  tasks: ITask[];
  links: ILink[];
  /** Sin fechas completas (o inválidas): no se dibujan ni se les inventa duración. */
  unscheduled: GanttTask[];
}

/** Programable = ambas fechas válidas y vencimiento no anterior al inicio. */
export function isScheduled(task: GanttTask): boolean {
  const start = parseLocalDate(task.startDate);
  const due = parseLocalDate(task.dueDate);
  return !!start && !!due && due.getTime() >= start.getTime();
}

export function toSvarTasks(scheduled: GanttTask[]): ITask[] {
  const scheduledIds = new Set(scheduled.map((task) => task.id));

  return scheduled.map((task) => ({
    id: task.id,
    text: task.title,
    start: parseLocalDate(task.startDate)!,
    end: addDays(parseLocalDate(task.dueDate)!, 1),
    type: task.startDate === task.dueDate ? 'milestone' : 'task',    // Una subtarea cuyo padre no está programado queda como raíz: SVAR no admite padres inexistentes.
    parent: task.parentTaskId && scheduledIds.has(task.parentTaskId) ? task.parentTaskId : 0,
    open: true,
    status: task.status,
    blocked: task.blocked,
    assignee: task.assignedTo?.name ?? null,
  }));
}

/** Mapea dependencia TEMA → tipo de link SVAR. */
type SvarLinkType = 'e2s' | 's2s' | 'e2e' | 's2e';

const DEPENDENCY_TYPE_MAP: Record<string, SvarLinkType> = {
  FINISH_TO_START: 'e2s',
  START_TO_START: 's2s',
  FINISH_TO_FINISH: 'e2e',
  START_TO_FINISH: 's2e',
};

/** Lo de arriba pero al inverso: tipo SVAR -> tipo backend (para crear dependencias). */
export const SVAR_TO_DEPENDENCY_TYPE: Record<string, string> = {
  'e2s': 'FINISH_START',
  's2s': 'START_START',
  'e2e': 'FINISH_FINISH',
  's2e': 'START_FINISH',
};

/**
 * Mapea los 4 tipos de dependencia TEMA → SVAR y filtra las que tengan ambos
 * extremos dibujados: una flecha con un extremo ausente rompería SVAR.
 */
export function toSvarLinks(dependencies: GanttDependency[], scheduledIds: ReadonlySet<string>): ILink[] {
  return dependencies
    .filter(
      (dep) =>
        scheduledIds.has(dep.predecessorTaskId) &&
        scheduledIds.has(dep.successorTaskId),
    )
    .map((dep) => ({
      id: dep.id,
      type: DEPENDENCY_TYPE_MAP[dep.type] ?? ('e2s' as SvarLinkType),
      source: dep.predecessorTaskId,
      target: dep.successorTaskId,
    }));
}

/** Padres antes que hijos, conservando el orden del backend dentro de cada nivel. */
function parentsFirst(tasks: GanttTask[]): GanttTask[] {
  return [...tasks.filter((t) => !t.parentTaskId), ...tasks.filter((t) => t.parentTaskId)];
}

export function buildGanttView(response: Pick<GanttResponse, 'tasks' | 'dependencies'>): GanttView {
  const scheduled = parentsFirst(response.tasks.filter(isScheduled));
  const unscheduled = response.tasks.filter((task) => !isScheduled(task));

  return {
    tasks: toSvarTasks(scheduled),
    links: toSvarLinks(response.dependencies, new Set(scheduled.map((task) => task.id))),
    unscheduled,
  };
}
