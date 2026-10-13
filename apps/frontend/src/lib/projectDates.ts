import type { Task } from '@tema/shared-types';

/**
 * Normaliza una fecha ISO o YYYY-MM-DD a string 'YYYY-MM-DD'.
 * Si el valor es nulo, indefinido o vacío, retorna null.
 */
export function normalizeDateString(date: string | null | undefined): string | null {
  if (!date) return null;
  const trimmed = date.trim();
  if (!trimmed) return null;
  return trimmed.split('T')[0] || null;
}

/**
 * RN-08: Verifica si la fecha de vencimiento de una tarea es posterior a la fecha de fin estimada del proyecto.
 * Si alguna de las dos fechas falta, retorna false.
 */
export function isTaskExceedingProjectEnd(
  taskDueDate: string | null | undefined,
  projectEndDate: string | null | undefined,
): boolean {
  const cleanDue = normalizeDateString(taskDueDate);
  const cleanEnd = normalizeDateString(projectEndDate);
  if (!cleanDue || !cleanEnd) return false;
  return cleanDue > cleanEnd;
}

/**
 * Verifica si la fecha de inicio de una tarea es anterior a la fecha de inicio del proyecto.
 * Si alguna de las dos fechas falta, retorna false.
 */
export function isTaskPrecedingProjectStart(
  taskStartDate: string | null | undefined,
  projectStartDate: string | null | undefined,
): boolean {
  const cleanStart = normalizeDateString(taskStartDate);
  const cleanProjStart = normalizeDateString(projectStartDate);
  if (!cleanStart || !cleanProjStart) return false;
  return cleanStart < cleanProjStart;
}

/**
 * RN-17: Verifica la coherencia de fechas de una tarea (inicio no posterior a vencimiento).
 * Si alguna de las dos falta, retorna true.
 * Si ambas existen y dueDate < startDate, retorna false.
 */
export function isTaskDatesConsistent(
  startDate: string | null | undefined,
  dueDate: string | null | undefined,
): boolean {
  const cleanStart = normalizeDateString(startDate);
  const cleanDue = normalizeDateString(dueDate);
  if (!cleanStart || !cleanDue) return true;
  return cleanDue >= cleanStart;
}

export interface AffectedTask {
  task: Task;
  exceedsEnd: boolean;
  precedesStart: boolean;
}

/**
 * Al editar las fechas de un proyecto, encuentra las tareas activas (no archivadas)
 * que quedan fuera del nuevo período planificado.
 */
export function findTasksOutsidePeriod(
  tasks: Task[],
  newProjectStartDate: string | null | undefined,
  newProjectEndDate: string | null | undefined,
): AffectedTask[] {
  const cleanProjStart = normalizeDateString(newProjectStartDate);
  const cleanProjEnd = normalizeDateString(newProjectEndDate);

  const affected: AffectedTask[] = [];

  for (const task of tasks) {
    if (task.archivedAt) continue;

    const exceedsEnd = isTaskExceedingProjectEnd(task.dueDate, cleanProjEnd);
    const precedesStart = isTaskPrecedingProjectStart(task.startDate, cleanProjStart);

    if (exceedsEnd || precedesStart) {
      affected.push({ task, exceedsEnd, precedesStart });
    }
  }

  return affected;
}
