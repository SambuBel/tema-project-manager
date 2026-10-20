import { TaskEntity } from '../task.entity';
import { TaskPriority, TaskStatus } from '../../database/enums';
import { toTaskListItem } from './task-list-item.dto';

const makeTask = (overrides: Partial<TaskEntity> = {}): TaskEntity =>
  ({
    id: 'task-1',
    slug: 'revisar-diseno',
    projectId: 'project-1',
    parentTaskId: null,
    title: 'Revisar diseño',
    description: 'Detalle',
    status: TaskStatus.PENDING,
    priority: TaskPriority.MEDIUM,
    assignedToId: 'user-1',
    assignedTo: { id: 'user-1', name: 'Cris', email: 'cris@tema.com', avatarUrl: null, active: true },
    project: { id: 'project-1', name: 'Proyecto', leaderId: 'user-9', objective: 'texto largo' },
    startDate: '2026-10-01',
    dueDate: '2026-10-20',
    createdBy: 'user-9',
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-02T10:00:00Z'),
    archivedAt: null,
    ...overrides,
  }) as unknown as TaskEntity;

describe('toTaskListItem', () => {
  it('conserva los campos que usan la lista y el tablero', () => {
    const item = toTaskListItem(makeTask());

    expect(item).toMatchObject({
      id: 'task-1',
      slug: 'revisar-diseno',
      projectId: 'project-1',
      parentTaskId: null,
      title: 'Revisar diseño',
      description: 'Detalle',
      status: TaskStatus.PENDING,
      priority: TaskPriority.MEDIUM,
      assignedToId: 'user-1',
      startDate: '2026-10-01',
      dueDate: '2026-10-20',
      createdBy: 'user-9',
      archivedAt: null,
    });
  });

  it('no repite el proyecto en cada tarea', () => {
    expect(toTaskListItem(makeTask())).not.toHaveProperty('project');
  });

  it('del responsable manda solo id y nombre', () => {
    expect(toTaskListItem(makeTask()).assignedTo).toEqual({ id: 'user-1', name: 'Cris' });
  });

  it('sin responsable devuelve assignedTo null', () => {
    const item = toTaskListItem(makeTask({ assignedToId: null, assignedTo: null }));

    expect(item.assignedTo).toBeNull();
    expect(item.assignedToId).toBeNull();
  });

  it('conserva subtaskCount y completedSubtaskCount calculados', () => {
    const item = toTaskListItem(makeTask({ subtaskCount: 4, completedSubtaskCount: 2 }));

    expect(item.subtaskCount).toBe(4);
    expect(item.completedSubtaskCount).toBe(2);
  });
});
