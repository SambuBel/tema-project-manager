import { EntityManager, IsNull } from 'typeorm';
import { MilestoneEntity } from './milestone.entity';
import { TaskEntity } from '../tasks/task.entity';
import { TaskStatus } from '../database/enums';

/**
 * Sincroniza de forma transaccional el estado de finalización automática de un Milestone:
 * - Solo contabiliza tareas principales activas (`parentTaskId IS NULL` y `archivedAt IS NULL`).
 * - Si `taskCount > 0` y `completedTaskCount === taskCount`:
 *   - Si el hito estaba pendiente (`completedAt === null`), lo marca automáticamente como alcanzado
 *     estableciendo `completedAt = new Date()` y `completedById = null` (diferenciándolo de la
 *     finalización manual, donde `completedById` registra al usuario que confirmó el hito).
 * - Si `taskCount === 0` o `completedTaskCount < taskCount`:
 *   - Si el hito había sido completado automáticamente (`completedAt !== null && completedById === null`),
 *     lo revierte automáticamente a Pendiente (`completedAt = null`, `completedById = null`).
 *   - Si el hito había sido confirmado manualmente (`completedAt !== null && completedById !== null`),
 *     preserva la confirmación manual para no reabrirlo indebidamente.
 */
export async function syncMilestoneAutoCompletionWithManager(
  manager: EntityManager | undefined | null,
  milestoneId: string | null | undefined,
  knownStats?: { taskCount: number; completedTaskCount: number },
  loadedMilestone?: MilestoneEntity | null,
): Promise<MilestoneEntity | null> {
  if (!manager || !milestoneId) return loadedMilestone ?? null;

  let milestone = loadedMilestone ?? null;
  if (!milestone) {
    if (typeof manager.findOne !== 'function') return null;
    milestone = await manager.findOne(MilestoneEntity, {
      where: { id: milestoneId, deletedAt: IsNull() } as any,
      relations: ['creator', 'completedBy'],
    });
  }

  if (!milestone || milestone.deletedAt) return null;

  let taskCount = knownStats?.taskCount;
  let completedTaskCount = knownStats?.completedTaskCount;

  if (taskCount === undefined || completedTaskCount === undefined) {
    if (typeof manager.getRepository === 'function') {
      const taskRepo = manager.getRepository(TaskEntity);
      const qb = taskRepo?.createQueryBuilder?.('t');
      if (qb && typeof qb.select === 'function' && typeof qb.getRawMany === 'function') {
        const rows: Array<{ milestoneId?: string; taskCount: string; completedTaskCount: string }> =
          (await qb
            .select('t.milestoneId', 'milestoneId')
            .addSelect('COUNT(t.id)', 'taskCount')
            .addSelect(`COUNT(CASE WHEN t.status = :completedStatus THEN 1 END)`, 'completedTaskCount')
            .where('t.milestoneId IN (:...milestoneIds)', { milestoneIds: [milestoneId] })
            .andWhere('t.parentTaskId IS NULL')
            .andWhere('t.archivedAt IS NULL')
            .setParameter('completedStatus', TaskStatus.COMPLETED)
            .groupBy('t.milestoneId')
            .getRawMany()) ?? [];
        const row = rows[0];
        taskCount = row ? parseInt(row.taskCount, 10) || 0 : 0;
        completedTaskCount = row ? parseInt(row.completedTaskCount, 10) || 0 : 0;
      }
    }

    if ((taskCount === undefined || completedTaskCount === undefined) && typeof manager.find === 'function') {
      const tasks =
        (await manager.find(TaskEntity, {
          where: { milestoneId, parentTaskId: IsNull(), archivedAt: IsNull() } as any,
        })) ?? [];
      const rootTasks = tasks.filter((t) => !t.parentTaskId && !t.archivedAt);
      taskCount = rootTasks.length;
      completedTaskCount = rootTasks.filter((t) => t.status === TaskStatus.COMPLETED).length;
    }
  }

  if (taskCount === undefined || completedTaskCount === undefined) {
    return milestone;
  }

  const allRootTasksCompleted = taskCount > 0 && completedTaskCount === taskCount;

  if (allRootTasksCompleted) {
    if (!milestone.completedAt) {
      milestone.completedAt = new Date();
      milestone.completedById = null;
      milestone.completedBy = null;
      if (typeof (manager as any).save === 'function') {
        await (manager as any).save(MilestoneEntity, milestone);
      } else if (typeof manager.update === 'function') {
        await manager.update(MilestoneEntity, milestone.id, {
          completedAt: milestone.completedAt,
          completedById: null,
        });
      }
    }
  } else {
    if (milestone.completedAt && !milestone.completedById) {
      milestone.completedAt = null;
      milestone.completedById = null;
      milestone.completedBy = null;
      if (typeof (manager as any).save === 'function') {
        await (manager as any).save(MilestoneEntity, milestone);
      } else if (typeof manager.update === 'function') {
        await manager.update(MilestoneEntity, milestone.id, {
          completedAt: null,
          completedById: null,
        });
      }
    }
  }

  return milestone;
}
