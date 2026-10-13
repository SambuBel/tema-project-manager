import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GanttService } from './gantt.service';
import { PermissionsService } from '../auth/permissions.service';
import { ProjectEntity } from '../projects/project.entity';
import { TaskEntity } from '../tasks/task.entity';
import { TaskDependencyEntity } from '../database/entities/task-dependency.entity';
import { DependencyType, ProjectMemberRole, RoleName, TaskPriority, TaskStatus } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';

const PROJECT_ID = 'project-1';
const LEADER_ID = 'leader-1';
const project = { id: PROJECT_ID, name: 'Proyecto Alfa', leaderId: LEADER_ID, startDate: '2026-10-01', estimatedEndDate: '2026-12-31' } as ProjectEntity;

const user = (id: string, roles: RoleName[]): RequestUser => ({ id, roles }) as RequestUser;
const admin = user('admin-1', [RoleName.ADMIN]);
const pm = user('pm-1', [RoleName.PROGRAM_MANAGER]);
const realLeader = user(LEADER_ID, [RoleName.PROJECT_LEADER]);
const collaborator = user('collab-1', [RoleName.COLLABORATOR]);
const observer = user('obs-1', [RoleName.OBSERVER]);
const foreignLeader = user('otro-leader', [RoleName.PROJECT_LEADER]);
const stranger = user('nadie', [RoleName.COLLABORATOR]);

const task = (overrides: Partial<TaskEntity> & { id: string }): TaskEntity =>
  ({
    projectId: PROJECT_ID,
    parentTaskId: null,
    title: `Tarea ${overrides.id}`,
    status: TaskStatus.PENDING,
    priority: TaskPriority.MEDIUM,
    startDate: '2026-10-10',
    dueDate: '2026-10-14',
    assignedTo: null,
    archivedAt: null,
    ...overrides,
  }) as TaskEntity;

const dep = (id: string, predecessorTaskId: string, successorTaskId: string): TaskDependencyEntity =>
  ({ id, predecessorTaskId, successorTaskId, dependencyType: DependencyType.FINISH_START }) as TaskDependencyEntity;

function chain(result: unknown[]) {
  const qb: Record<string, jest.Mock> = {};
  for (const name of ['leftJoinAndSelect', 'innerJoin', 'where', 'andWhere', 'orderBy', 'addOrderBy']) {
    qb[name] = jest.fn(() => qb);
  }
  qb.getMany = jest.fn(async () => result);
  return qb;
}

function build(opts: { project?: ProjectEntity | null; tasks?: TaskEntity[]; deps?: TaskDependencyEntity[]; members?: Array<{ userId: string; projectRole: ProjectMemberRole }> } = {}) {
  const taskQb = chain(opts.tasks ?? []);
  const depQb = chain(opts.deps ?? []);
  const membersRepo = {
    findOne: jest.fn(async ({ where }: { where: { userId: string } }) => opts.members?.find((m) => m.userId === where.userId) ?? null),
  };
  const service = new GanttService(
    { createQueryBuilder: jest.fn(() => taskQb) } as never,
    { findOneBy: jest.fn(async () => (opts.project === undefined ? project : opts.project)) } as never,
    { createQueryBuilder: jest.fn(() => depQb) } as never,
    new PermissionsService(membersRepo as never),
  );
  return { service, taskQb, depQb };
}

describe('GanttService - permisos (canViewProject)', () => {
  it.each([
    ['ADMIN', admin, []],
    ['PROGRAM_MANAGER', pm, []],
    ['líder real', realLeader, []],
    ['COLLABORATOR miembro', collaborator, [{ userId: 'collab-1', projectRole: ProjectMemberRole.COLLABORATOR }]],
    ['OBSERVER miembro', observer, [{ userId: 'obs-1', projectRole: ProjectMemberRole.OBSERVER }]],
  ])('%s: puede ver el Gantt', async (_label, actor, members) => {
    const { service } = build({ members });
    await expect(service.getGantt(PROJECT_ID, actor)).resolves.toMatchObject({ project: { id: PROJECT_ID } });
  });

  it.each([
    ['PROJECT_LEADER ajeno sin membership', foreignLeader],
    ['usuario sin membership', stranger],
  ])('%s: 403 y no consulta tareas', async (_label, actor) => {
    const { service, taskQb } = build();
    await expect(service.getGantt(PROJECT_ID, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(taskQb.getMany).not.toHaveBeenCalled();
  });

  it('404 si el proyecto no existe', async () => {
    const { service } = build({ project: null });
    await expect(service.getGantt(PROJECT_ID, admin)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('GanttService - datos del read model', () => {
  it('devuelve el proyecto con sus fechas', async () => {
    const { service } = build();
    const result = await service.getGantt(PROJECT_ID, admin);
    expect(result.project).toEqual({ id: PROJECT_ID, name: 'Proyecto Alfa', startDate: '2026-10-01', estimatedEndDate: '2026-12-31' });
  });

  it('incluye tareas raíz y subtareas (con parentTaskId) y el responsable resumido', async () => {
    const { service } = build({
      tasks: [
        task({ id: 'A' }),
        task({ id: 'A1', parentTaskId: 'A', assignedTo: { id: 'u1', name: 'Ana', email: 'ana@x.com' } as never }),
      ],
    });
    const { tasks } = await service.getGantt(PROJECT_ID, admin);

    expect(tasks.map((t) => [t.id, t.parentTaskId])).toEqual([['A', null], ['A1', 'A']]);
    expect(tasks[1]!.assignedTo).toEqual({ id: 'u1', name: 'Ana' }); // sin email ni otros datos
    expect(tasks[0]!.assignedTo).toBeNull();
  });

  it('consulta tareas del proyecto excluyendo archivadas, y solo dependencias FINISH_START del mismo proyecto', async () => {
    const { service, taskQb, depQb } = build();
    await service.getGantt(PROJECT_ID, admin);

    expect(taskQb.where).toHaveBeenCalledWith('task.projectId = :projectId', { projectId: PROJECT_ID });
    expect(taskQb.andWhere).toHaveBeenCalledWith('task.archivedAt IS NULL');
    expect(taskQb.andWhere).not.toHaveBeenCalledWith(expect.stringContaining('parentTaskId'));
    expect(depQb.where).toHaveBeenCalledWith('pred.projectId = :projectId', { projectId: PROJECT_ID });
    expect(depQb.andWhere).toHaveBeenCalledWith('succ.projectId = :projectId', { projectId: PROJECT_ID });
    expect(depQb.andWhere).toHaveBeenCalledWith('pred.archivedAt IS NULL');
    expect(depQb.andWhere).toHaveBeenCalledWith('succ.archivedAt IS NULL');
    expect(depQb.andWhere).toHaveBeenCalledWith('dep.dependencyType = :type', { type: DependencyType.FINISH_START });
  });

  it('ordena por fecha de inicio (sin planificar al final) y antigüedad', async () => {
    const { service, taskQb } = build();
    await service.getGantt(PROJECT_ID, admin);
    expect(taskQb.orderBy).toHaveBeenCalledWith('task.startDate', 'ASC', 'NULLS LAST');
    expect(taskQb.addOrderBy).toHaveBeenCalledWith('task.createdAt', 'ASC');
  });

  it('devuelve las dependencias con el tipo FINISH_TO_START', async () => {
    const { service } = build({ tasks: [task({ id: 'A' }), task({ id: 'B' })], deps: [dep('d1', 'A', 'B')] });
    const { dependencies } = await service.getGantt(PROJECT_ID, admin);
    expect(dependencies).toEqual([{ id: 'd1', predecessorTaskId: 'A', successorTaskId: 'B', type: 'FINISH_TO_START' }]);
  });

  it('una tarea sin fechas conserva startDate/dueDate en null (no se inventan)', async () => {
    const { service } = build({ tasks: [task({ id: 'A', startDate: null, dueDate: null }), task({ id: 'B', startDate: '2026-10-10', dueDate: null })] });
    const { tasks } = await service.getGantt(PROJECT_ID, admin);
    expect(tasks[0]).toMatchObject({ startDate: null, dueDate: null });
    expect(tasks[1]).toMatchObject({ startDate: '2026-10-10', dueDate: null });
  });

  it('no expone datos económicos ni campos internos de las tareas', async () => {
    const { service } = build({
      tasks: [task({ id: 'A', createdBy: 'x', description: 'secreto', estimatedCost: 10, hourlyCost: 5 } as never)],
    });
    const result = await service.getGantt(PROJECT_ID, admin);
    const keys = Object.keys(result.tasks[0]!).sort();
    expect(keys).toEqual(['assignedTo', 'blocked', 'dueDate', 'id', 'parentTaskId', 'priority', 'startDate', 'status', 'title']);
    expect(Object.keys(result.project).sort()).toEqual(['estimatedEndDate', 'id', 'name', 'startDate']);
    expect(JSON.stringify(result)).not.toMatch(/cost|budget|hourly|economic|rate/i);
  });
});

describe('GanttService - blocked derivado', () => {
  const run = async (tasks: TaskEntity[], deps: TaskDependencyEntity[]) => {
    const { service } = build({ tasks, deps });
    const { tasks: out } = await service.getGantt(PROJECT_ID, admin);
    return Object.fromEntries(out.map((t) => [t.id, t.blocked]));
  };

  it('blocked=true si la predecesora NO está completada (y status NO se modifica)', async () => {
    const successor = task({ id: 'B', status: TaskStatus.PENDING });
    const blocked = await run([task({ id: 'A', status: TaskStatus.IN_PROGRESS }), successor], [dep('d1', 'A', 'B')]);
    expect(blocked).toEqual({ A: false, B: true });
    expect(successor.status).toBe(TaskStatus.PENDING);
  });

  it.each([TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW, TaskStatus.BLOCKED])(
    'predecesora en %s bloquea a la sucesora',
    async (status) => {
      expect(await run([task({ id: 'A', status }), task({ id: 'B' })], [dep('d1', 'A', 'B')])).toMatchObject({ B: true });
    },
  );

  it('blocked=false con la predecesora COMPLETED', async () => {
    expect(await run([task({ id: 'A', status: TaskStatus.COMPLETED }), task({ id: 'B' })], [dep('d1', 'A', 'B')])).toEqual({ A: false, B: false });
  });

  it('múltiples predecesoras: basta UNA incompleta para bloquear', async () => {
    const tasks = [task({ id: 'A', status: TaskStatus.COMPLETED }), task({ id: 'B', status: TaskStatus.IN_PROGRESS }), task({ id: 'C' })];
    expect(await run(tasks, [dep('d1', 'A', 'C'), dep('d2', 'B', 'C')])).toMatchObject({ C: true });
  });

  it('múltiples predecesoras: con TODAS completadas se desbloquea', async () => {
    const tasks = [task({ id: 'A', status: TaskStatus.COMPLETED }), task({ id: 'B', status: TaskStatus.COMPLETED }), task({ id: 'C' })];
    expect(await run(tasks, [dep('d1', 'A', 'C'), dep('d2', 'B', 'C')])).toMatchObject({ C: false });
  });

  it('múltiples sucesoras de una misma predecesora: todas bloqueadas', async () => {
    const tasks = [task({ id: 'A' }), task({ id: 'B' }), task({ id: 'C' })];
    expect(await run(tasks, [dep('d1', 'A', 'B'), dep('d2', 'A', 'C')])).toEqual({ A: false, B: true, C: true });
  });

  it('sin dependencias nadie está bloqueado', async () => {
    expect(await run([task({ id: 'A' }), task({ id: 'B' })], [])).toEqual({ A: false, B: false });
  });
});
