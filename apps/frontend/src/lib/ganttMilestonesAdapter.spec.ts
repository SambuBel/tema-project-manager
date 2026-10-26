import { describe, expect, it } from 'vitest';
import type { MilestoneSummaryDto } from '@tema/shared-types';
import type { ITask } from '@svar-ui/react-gantt';
import { mergeGanttTasksWithMilestones, toSvarMilestoneTasks } from './ganttMilestonesAdapter';
import { parseLocalDate } from './dates';

const makeMilestone = (overrides: Partial<MilestoneSummaryDto> & { id: string }): MilestoneSummaryDto => ({
  projectId: 'proj-1',
  name: `Hito ${overrides.id}`,
  description: 'Descripción del hito',
  dueDate: '2026-11-15',
  completedAt: null,
  completedById: null,
  createdBy: 'u-1',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  status: 'PENDING',
  taskCount: 4,
  completedTaskCount: 2,
  progress: 50,
  ...overrides,
});

describe('ganttMilestonesAdapter (KAN-280)', () => {
  it('convierte cada Milestone activo en un ítem type="milestone" en su dueDate con prefijo milestone:', () => {
    const items = toSvarMilestoneTasks([
      makeMilestone({ id: 'm-2', name: 'Entrega Final', dueDate: '2026-12-01', status: 'PENDING', progress: 25 }),
      makeMilestone({
        id: 'm-1',
        name: 'Kickoff',
        dueDate: '2026-10-20',
        status: 'COMPLETED',
        completedAt: '2026-10-19T12:00:00Z',
        progress: 100,
      }),
    ]);

    // Ordenados por dueDate ascendente
    expect(items.map((i) => i.id)).toEqual(['milestone:m-1', 'milestone:m-2']);
    expect(items[0]).toMatchObject({
      id: 'milestone:m-1',
      text: 'Kickoff',
      type: 'milestone',
      parent: 0,
      isMilestone: true,
      milestoneId: 'm-1',
      milestoneStatus: 'COMPLETED',
      milestoneProgress: 100,
    });
    expect((items[0]!.start as Date).getTime()).toBe(parseLocalDate('2026-10-20')!.getTime());
    expect((items[0]!.end as Date).getTime()).toBe(parseLocalDate('2026-10-20')!.getTime());
  });

  it('ignora hitos con fecha inválida y devuelve vacío si no hay hitos', () => {
    expect(toSvarMilestoneTasks([])).toEqual([]);
    expect(toSvarMilestoneTasks([makeMilestone({ id: 'm-bad', dueDate: 'fecha-invalida' })])).toEqual([]);
  });

  it('mergeGanttTasksWithMilestones combina tareas y hitos sin duplicar tareas ni alterar sus fechas', () => {
    const start = parseLocalDate('2026-10-10')!;
    const end = parseLocalDate('2026-10-15')!;
    const existingTasks: ITask[] = [
      { id: 'task-1', text: 'Tarea 1', start, end, type: 'task', parent: 0 },
    ];

    const merged = mergeGanttTasksWithMilestones(existingTasks, [
      makeMilestone({ id: 'm-1', name: 'Hito 1', dueDate: '2026-10-20' }),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(existingTasks[0]);
    expect((merged[0]!.start as Date).getTime()).toBe(start.getTime());
    expect((merged[0]!.end as Date).getTime()).toBe(end.getTime());
    expect(merged[1]!.id).toBe('milestone:m-1');
    expect(merged[1]!.type).toBe('milestone');
  });
});
