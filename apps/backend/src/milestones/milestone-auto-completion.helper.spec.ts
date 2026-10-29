
import type { EntityManager } from 'typeorm';
import { milestoneProgressTasks, syncMilestoneAutoCompletionWithManager } from './milestone-auto-completion.helper';
import { TaskStatus } from '../database/enums';
import { MilestoneEntity } from './milestone.entity';

describe('progreso de hitos con subtareas', () => {
  it('cuenta solo las unidades vinculadas, sin sumar dos veces padre e hija', () => {
    const parent = { id: 'parent', parentTaskId: null };
    const child = { id: 'child', parentTaskId: 'parent' };
    const sibling = { id: 'sibling', parentTaskId: 'unlinked-parent' };
    expect(milestoneProgressTasks([parent, child, sibling])).toEqual([parent, sibling]);
    expect(milestoneProgressTasks([child])).toEqual([child]);
  });

  it.each([true, false])('completa y reabre automáticamente un hito con subtarea independiente (completada: %s)', async (completed) => {
    const milestone = { id: 'milestone', completedAt: completed ? null : new Date(), completedById: null } as MilestoneEntity;
    const manager = {
      find: jest.fn().mockResolvedValue([{ id: 'child', parentTaskId: 'parent', archivedAt: null,
        status: completed ? TaskStatus.COMPLETED : TaskStatus.PENDING }]),
      save: jest.fn(),
    };
    await syncMilestoneAutoCompletionWithManager(manager as unknown as EntityManager, milestone.id, undefined, milestone);
    expect(Boolean(milestone.completedAt)).toBe(completed);
    expect(manager.save).toHaveBeenCalledTimes(1);
  });

  it('preserva la confirmación manual aunque queden subtareas pendientes', async () => {
    const milestone = { id: 'milestone', completedAt: new Date(), completedById: 'user' } as MilestoneEntity;
    const manager = { save: jest.fn() };
    await syncMilestoneAutoCompletionWithManager(manager as unknown as EntityManager, milestone.id, { taskCount: 1, completedTaskCount: 0 }, milestone);
    expect(milestone.completedAt).toBeTruthy();
    expect(manager.save).not.toHaveBeenCalled();
  });
});
