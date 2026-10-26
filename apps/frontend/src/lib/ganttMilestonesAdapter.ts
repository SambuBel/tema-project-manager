import type { MilestoneSummaryDto } from '@tema/shared-types';
import type { ITask } from '@svar-ui/react-gantt';
import { parseLocalDate } from './dates';

/**
 * Adaptador aislado de Milestones para SVAR React Gantt (KAN-280).
 * Se mantiene en un módulo propio para minimizar conflictos de merge con
 * otras ramas que evolucionan `ganttAdapter.ts` (ej. `feature/gantt-crud-dependencias`).
 *
 * Criterio visual provisional:
 * - Cada Milestone activo con `dueDate` válida se proyecta como `type: 'milestone'`
 *   (SVAR dibuja un rombo en `start = dueDate`).
 * - El ID lleva prefijo `milestone:` para no colisionar con IDs de tareas ni dependencias.
 * - Incluye metadatos de estado (`PENDING`, `OVERDUE`, `COMPLETED`) y avance para
 *   diferenciar visualmente hitos pendientes vs alcanzados y mostrar detalle al seleccionarlo.
 */
export function toSvarMilestoneTasks(milestones: MilestoneSummaryDto[]): ITask[] {
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return [];
  }

  return milestones
    .filter((m) => Boolean(parseLocalDate(m.dueDate)))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((m) => {
      const targetDate = parseLocalDate(m.dueDate)!;
      return {
        id: `milestone:${m.id}`,
        text: m.name,
        start: targetDate,
        end: targetDate,
        type: 'milestone',
        parent: 0,
        open: true,
        isMilestone: true,
        milestoneId: m.id,
        milestoneStatus: m.status,
        milestoneProgress: m.progress,
        milestoneTaskCount: m.taskCount,
        milestoneCompletedTaskCount: m.completedTaskCount,
        milestoneDueDate: m.dueDate,
        milestoneCompletedAt: m.completedAt,
        milestoneDescription: m.description,
      };
    });
}

/**
 * Combina las tareas programadas del Gantt con los hitos del proyecto sin alterar
 * ni duplicar las tareas existentes ni modificar sus fechas.
 */
export function mergeGanttTasksWithMilestones(
  scheduledTasks: ITask[],
  milestones?: MilestoneSummaryDto[],
): ITask[] {
  const milestoneItems = milestones ? toSvarMilestoneTasks(milestones) : [];
  if (milestoneItems.length === 0) {
    return scheduledTasks;
  }
  return [...scheduledTasks, ...milestoneItems];
}
