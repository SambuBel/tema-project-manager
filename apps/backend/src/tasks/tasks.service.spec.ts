import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { PermissionsService } from '../auth/permissions.service';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { ProjectEntity } from '../projects/project.entity';
import { TaskEntity } from './task.entity';
import { TaskSlugHistoryEntity } from './task-slug-history.entity';
import {
  AuditOrigin,
  ProjectActivityAction,
  ProjectActivityEntityType,
  ProjectMemberRole,
  RoleName,
  TaskStatus,
} from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateTaskDto } from './dto/create-task.dto';
import { SubtaskEntity } from '../subtasks/subtask.entity';

const PROJECT_ID = 'project-1';
const LEADER_ID = 'leader-1';

function makeUser(id: string, roles: RoleName[] = []): RequestUser {
  return { id, roles } as RequestUser;
}

function makeProject(overrides: Partial<ProjectEntity> = {}): ProjectEntity {
  return { id: PROJECT_ID, leaderId: LEADER_ID, ...overrides } as ProjectEntity;
}

function makeTask(overrides: Partial<TaskEntity> & { project: ProjectEntity }): TaskEntity {
  return {
    id: 'task-1',
    projectId: PROJECT_ID,
    createdBy: 'someone-else',
    assignedToId: null,
    archivedAt: null,
    ...overrides,
  } as TaskEntity;
}

/**
 * PermissionsService REAL (no mockeado): las policies de Tasks dependen de la
 * interacción real entre projectRole y ownership, que es exactamente lo que
 * causó el bug original (paso 4, punto 0). Mockear PermissionsService acá
 * ocultaría ese tipo de bug de nuevo. Solo se fakea el repositorio de
 * project_members, igual que en auth/permissions.service.spec.ts.
 */
function makePermissions(members: Array<Partial<ProjectMemberEntity>> = []): PermissionsService {
  const repo = {
    findOne: jest.fn(async ({ where }: { where: { userId: string; projectId: string } }) => {
      return (
        members.find(
          (m) => m.userId === where.userId && m.projectId === where.projectId && m.removedAt === null,
        ) ?? null
      );
    }),
  };
  return new PermissionsService(repo as unknown as import('typeorm').Repository<ProjectMemberEntity>);
}

function membership(userId: string, projectRole: ProjectMemberRole): Partial<ProjectMemberEntity> {
  return { userId, projectId: PROJECT_ID, projectRole, removedAt: null };
}

interface Deps {
  taskRepo: { findOne: jest.Mock; find: jest.Mock; findOneBy: jest.Mock; count: jest.Mock; save: jest.Mock; createQueryBuilder: jest.Mock; manager: { query: jest.Mock; find: jest.Mock; transaction: jest.Mock } };
  /** EntityManager transaccional que recibe el callback de manager.transaction(). */
  txManager: { query: jest.Mock; find: jest.Mock; save: jest.Mock; delete: jest.Mock };
  permissions: PermissionsService;
  projectRepo: { findOneBy: jest.Mock; manager: { find: jest.Mock } };
  usersService: { findById: jest.Mock };
  subtaskRepo: { count: jest.Mock };
  activityService: { logEvent: jest.Mock };
  commentRepo: { create: jest.Mock; save: jest.Mock; find: jest.Mock };
  taskSlugHistoryRepo: { findOne: jest.Mock; find: jest.Mock; create: jest.Mock; save: jest.Mock; delete: jest.Mock<any, [any]> };
}

function makeService(
  members: Array<Partial<ProjectMemberEntity>>,
  project = makeProject(),
): { service: TasksService } & Deps {
  const qb = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn(async () => []),
  };
  const taskRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    findOneBy: jest.fn(),
    count: jest.fn(async () => 0),
    save: jest.fn(async (t: unknown) => t),
    createQueryBuilder: jest.fn(() => qb),
    manager: {
      query: jest.fn(async () => []),
      find: jest.fn(async () => []),
      transaction: jest.fn(),
    },
  };
  const projectRepo = { findOneBy: jest.fn(async () => project), manager: { find: jest.fn(async () => []) } };
  const commentRepo = {
    create: jest.fn((c: unknown) => c),
    save: jest.fn(async (c: unknown) => c),
    find: jest.fn(async () => [] as unknown[]),
  };
  const usersService = { findById: jest.fn(async (id: string) => ({ id, active: true })) };
  const subtaskRepo = {
    count: jest.fn(async () => 0),
  };
  const taskSlugHistoryRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((h: unknown) => h),
    save: jest.fn(async (h: unknown) => h),
    delete: jest.fn(async (_criteria: unknown) => ({ affected: 1 })),
  };
  const permissions = makePermissions(members);
  const activityService = { logEvent: jest.fn() };

  // Igual que TypeORM: manager.transaction(cb) ejecuta cb con un EntityManager transaccional.
  // Las escrituras del txManager se enrutan a los mocks de repositorio existentes, así los tests
  // siguen verificando qué se persiste sin que producción necesite un camino "sin transacción".
  const txManager = {
    query: jest.fn((...args: unknown[]) => (taskRepo.manager.query as jest.Mock)(...args)),
    find: jest.fn((...args: unknown[]) => (taskRepo.manager.find as jest.Mock)(...args)),
    save: jest.fn(async (entity: unknown, data: unknown) =>
      entity === TaskSlugHistoryEntity ? taskSlugHistoryRepo.save(data) : taskRepo.save(data),
    ),
    delete: jest.fn(async (entity: unknown, criteria: unknown) =>
      entity === TaskSlugHistoryEntity ? taskSlugHistoryRepo.delete(criteria) : { affected: 0 },
    ),
  };
  taskRepo.manager.transaction.mockImplementation(async (cb: (m: unknown) => Promise<unknown>) => cb(txManager));

  const service = new TasksService(
    taskRepo as unknown as import('typeorm').Repository<TaskEntity>,
    projectRepo as unknown as import('typeorm').Repository<ProjectEntity>,
    commentRepo as never,
    usersService as never,
    permissions as never,
    activityService as never,
    subtaskRepo as unknown as import('typeorm').Repository<SubtaskEntity>,
    taskSlugHistoryRepo as never,
  );

  return {
    service,
    taskRepo,
    txManager,
    permissions,
    projectRepo,
    usersService,
    subtaskRepo,
    activityService,
    commentRepo,
    taskSlugHistoryRepo,
  };
}

describe('TasksService - create (canCreateTask)', () => {
  const dto: CreateTaskDto = { projectId: PROJECT_ID, title: 'Nueva tarea' };

  it('404 si el proyecto no existe', async () => {
    const { service, projectRepo } = makeService([]);
    projectRepo.findOneBy.mockResolvedValue(null);

    await expect(service.create(dto, makeUser('u1'))).rejects.toThrow(NotFoundException);
  });

  it('ADMIN sin ser miembro: permitido', async () => {
    const { service, taskRepo } = makeService([]);
    const result = await service.create(dto, makeUser('admin-1', [RoleName.ADMIN]));
    expect(taskRepo.save).toHaveBeenCalled();
    expect(result.createdBy).toBe('admin-1');
  });

  it('PROGRAM_MANAGER sin ser miembro: permitido', async () => {
    const { service } = makeService([]);
    await expect(service.create(dto, makeUser('pm-1', [RoleName.PROGRAM_MANAGER]))).resolves.toBeDefined();
  });

  it('líder del proyecto: permitido', async () => {
    const { service } = makeService([]);
    await expect(service.create(dto, makeUser(LEADER_ID, [RoleName.PROJECT_LEADER]))).resolves.toBeDefined();
  });

  it('COLLABORATOR con projectRole COLLABORATOR en este proyecto: permitido', async () => {
    const { service } = makeService([membership('collab-1', ProjectMemberRole.COLLABORATOR)]);
    await expect(service.create(dto, makeUser('collab-1', [RoleName.COLLABORATOR]))).resolves.toBeDefined();
  });

  it('COLLABORATOR global pero projectRole OBSERVER en este proyecto: 403 (no decide por el rol global)', async () => {
    const { service, taskRepo } = makeService([membership('u1', ProjectMemberRole.OBSERVER)]);
    await expect(service.create(dto, makeUser('u1', [RoleName.COLLABORATOR]))).rejects.toThrow(ForbiddenException);
    expect(taskRepo.save).not.toHaveBeenCalled();
  });

  it('OBSERVER (rol global, con membership OBSERVER): 403', async () => {
    const { service } = makeService([membership('obs-1', ProjectMemberRole.OBSERVER)]);
    await expect(service.create(dto, makeUser('obs-1', [RoleName.OBSERVER]))).rejects.toThrow(ForbiddenException);
  });

  it('no miembro del proyecto: 403', async () => {
    const { service } = makeService([]);
    await expect(service.create(dto, makeUser('ajeno', [RoleName.COLLABORATOR]))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('multi-rol ADMIN + PROGRAM_MANAGER: permitido', async () => {
    const { service } = makeService([]);
    await expect(
      service.create(dto, makeUser('u1', [RoleName.PROGRAM_MANAGER, RoleName.ADMIN])),
    ).resolves.toBeDefined();
  });

  it('responsable inexistente: 404, no guarda', async () => {
    const { service, taskRepo, usersService } = makeService([]);
    usersService.findById.mockResolvedValue(null);
    await expect(
      service.create({ ...dto, assignedToId: 'missing' }, makeUser('admin-1', [RoleName.ADMIN])),
    ).rejects.toThrow(NotFoundException);
    expect(taskRepo.save).not.toHaveBeenCalled();
  });

  it('responsable que no es miembro del proyecto: 400, no guarda', async () => {
    const { service, taskRepo } = makeService([]);
    await expect(
      service.create({ ...dto, assignedToId: 'ajeno' }, makeUser('admin-1', [RoleName.ADMIN])),
    ).rejects.toThrow(BadRequestException);
    expect(taskRepo.save).not.toHaveBeenCalled();
  });

  it('responsable = líder del proyecto: permitido sin fila de membership', async () => {
    const { service } = makeService([]);
    await expect(
      service.create({ ...dto, assignedToId: LEADER_ID }, makeUser('admin-1', [RoleName.ADMIN])),
    ).resolves.toBeDefined();
  });
});

describe('TasksService - findAllByProject / findOne (canViewTask)', () => {
  it('findAllByProject: 404 si el proyecto no existe', async () => {
    const { service, projectRepo } = makeService([]);
    projectRepo.findOneBy.mockResolvedValue(null);
    await expect(service.findAllByProject({ projectId: 'missing' }, makeUser('u1'))).rejects.toThrow(NotFoundException);
  });

  it('findAllByProject: ADMIN no miembro puede ver', async () => {
    const { service } = makeService([]);
    await expect(service.findAllByProject({ projectId: PROJECT_ID }, makeUser('admin-1', [RoleName.ADMIN]))).resolves.toEqual([]);
  });

  it('findAllByProject: PM no miembro puede ver', async () => {
    const { service } = makeService([]);
    await expect(
      service.findAllByProject({ projectId: PROJECT_ID }, makeUser('pm-1', [RoleName.PROGRAM_MANAGER])),
    ).resolves.toEqual([]);
  });

  it('findAllByProject: líder del proyecto propio puede ver', async () => {
    const { service } = makeService([]);
    await expect(service.findAllByProject({ projectId: PROJECT_ID }, makeUser(LEADER_ID))).resolves.toEqual([]);
  });

  it('findAllByProject: líder de OTRO proyecto -> 403 salvo membership', async () => {
    const { service } = makeService([]);
    await expect(
      service.findAllByProject({ projectId: PROJECT_ID }, makeUser('otro-leader', [RoleName.PROJECT_LEADER])),
    ).rejects.toThrow(ForbiddenException);
  });

  it('findAllByProject: COLLABORATOR miembro puede ver', async () => {
    const { service } = makeService([membership('collab-1', ProjectMemberRole.COLLABORATOR)]);
    await expect(
      service.findAllByProject({ projectId: PROJECT_ID }, makeUser('collab-1', [RoleName.COLLABORATOR])),
    ).resolves.toEqual([]);
  });

  it('findAllByProject: OBSERVER miembro puede ver', async () => {
    const { service } = makeService([membership('obs-1', ProjectMemberRole.OBSERVER)]);
    await expect(service.findAllByProject({ projectId: PROJECT_ID }, makeUser('obs-1', [RoleName.OBSERVER]))).resolves.toEqual([]);
  });

  it('findAllByProject: no miembro -> 403', async () => {
    const { service } = makeService([]);
    await expect(service.findAllByProject({ projectId: PROJECT_ID }, makeUser('ajeno'))).rejects.toThrow(ForbiddenException);
  });

  it('findOne: 404 si la tarea no existe', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(null);
    await expect(service.findOne('missing', makeUser('u1'))).rejects.toThrow(NotFoundException);
  });

  it('findOne: 403 si no tiene acceso al proyecto de la tarea', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject() }));
    await expect(service.findOne('task-1', makeUser('ajeno'))).rejects.toThrow(ForbiddenException);
  });
});

describe('TasksService - update (canEditTask)', () => {
  it('404 si la tarea no existe', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(null);
    await expect(service.update('missing', {}, makeUser('u1'))).rejects.toThrow(NotFoundException);
  });

  it('ADMIN: cualquier tarea', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject(), createdBy: 'otro', assignedToId: 'otro' }));
    await expect(
      service.update('task-1', { title: 'x' }, makeUser('admin-1', [RoleName.ADMIN])),
    ).resolves.toMatchObject({ title: 'x' });
  });

  it('PROGRAM_MANAGER: cualquier tarea', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject() }));
    await expect(
      service.update('task-1', { title: 'x' }, makeUser('pm-1', [RoleName.PROGRAM_MANAGER])),
    ).resolves.toMatchObject({ title: 'x' });
  });

  it('líder del proyecto propio: cualquier tarea del proyecto', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject(), createdBy: 'otro', assignedToId: 'otro' }));
    await expect(
      service.update('task-1', { title: 'x' }, makeUser(LEADER_ID, [RoleName.PROJECT_LEADER])),
    ).resolves.toMatchObject({ title: 'x' });
  });

  it('líder de OTRO proyecto: 403', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject() }));
    await expect(
      service.update('task-1', { title: 'x' }, makeUser('otro-leader', [RoleName.PROJECT_LEADER])),
    ).rejects.toThrow(ForbiddenException);
  });

  it('COLLABORATOR: tarea creada por él -> permitido', async () => {
    const { service, taskRepo } = makeService([membership('collab-1', ProjectMemberRole.COLLABORATOR)]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject(), createdBy: 'collab-1', assignedToId: null }));
    await expect(
      service.update('task-1', { title: 'x' }, makeUser('collab-1', [RoleName.COLLABORATOR])),
    ).resolves.toMatchObject({ title: 'x' });
  });

  it('COLLABORATOR: tarea asignada a él -> permitido', async () => {
    const { service, taskRepo } = makeService([membership('collab-1', ProjectMemberRole.COLLABORATOR)]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject(), createdBy: 'otro', assignedToId: 'collab-1' }));
    await expect(
      service.update('task-1', { title: 'x' }, makeUser('collab-1', [RoleName.COLLABORATOR])),
    ).resolves.toMatchObject({ title: 'x' });
  });

  it('COLLABORATOR: tarea creada Y asignada a otro -> 403, no guarda', async () => {
    const { service, taskRepo } = makeService([membership('collab-1', ProjectMemberRole.COLLABORATOR)]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject(), createdBy: 'otro', assignedToId: 'otro' }));
    await expect(
      service.update('task-1', { title: 'x' }, makeUser('collab-1', [RoleName.COLLABORATOR])),
    ).rejects.toThrow(ForbiddenException);
    expect(taskRepo.save).not.toHaveBeenCalled();
  });

  it('COLLABORATOR global con projectRole OBSERVER en este proyecto: 403 aunque sea propia', async () => {
    const { service, taskRepo } = makeService([membership('u1', ProjectMemberRole.OBSERVER)]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject(), createdBy: 'u1' }));
    await expect(
      service.update('task-1', { title: 'x' }, makeUser('u1', [RoleName.COLLABORATOR])),
    ).rejects.toThrow(ForbiddenException);
  });

  it('OBSERVER: siempre 403, incluso sobre tarea propia/asignada', async () => {
    const { service, taskRepo } = makeService([membership('obs-1', ProjectMemberRole.OBSERVER)]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject(), createdBy: 'obs-1', assignedToId: 'obs-1' }));
    await expect(
      service.update('task-1', { title: 'x' }, makeUser('obs-1', [RoleName.OBSERVER])),
    ).rejects.toThrow(ForbiddenException);
  });

  it('reasignar a alguien que no es miembro del proyecto: 400, no guarda', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject() }));
    await expect(
      service.update('task-1', { assignedToId: 'ajeno' }, makeUser('admin-1', [RoleName.ADMIN])),
    ).rejects.toThrow(BadRequestException);
    expect(taskRepo.save).not.toHaveBeenCalled();
  });

  describe('validación de transiciones de estado en update genérico', () => {
    it('debería validar la transición al cambiar status (transición a estado inválido -> 400)', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(
        makeTask({ project: makeProject(), status: TaskStatus.PENDING }),
      );

      await expect(
        service.update('task-1', { status: 'INVALID_STATUS' as any }, makeUser('admin-1', [RoleName.ADMIN])),
      ).rejects.toThrow(BadRequestException);
    });

    it('debería permitir update sin cambio de status', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(
        makeTask({ project: makeProject(), status: TaskStatus.PENDING }),
      );

      const result = await service.update(
        'task-1',
        { title: 'Título nuevo' },
        makeUser('admin-1', [RoleName.ADMIN]),
      );

      expect(result.title).toBe('Título nuevo');
      expect(taskRepo.save).toHaveBeenCalled();
    });

    it('debería permitir transición válida PENDING -> IN_PROGRESS', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(
        makeTask({ project: makeProject(), status: TaskStatus.PENDING }),
      );

      const result = await service.update(
        'task-1',
        { status: TaskStatus.IN_PROGRESS },
        makeUser('admin-1', [RoleName.ADMIN]),
      );

      expect(result.status).toBe(TaskStatus.IN_PROGRESS);
    });
  });

  describe('RN-04: no completar con subtareas pendientes', () => {
    it('permite completar si no tiene subtareas pendientes (count = 0)', async () => {
      const { service, taskRepo, subtaskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(
        makeTask({ project: makeProject(), status: TaskStatus.IN_PROGRESS }),
      );
      subtaskRepo.count.mockResolvedValue(0);

      await expect(
        service.update('task-1', { status: TaskStatus.COMPLETED }, makeUser('admin-1', [RoleName.ADMIN])),
      ).resolves.toMatchObject({ status: TaskStatus.COMPLETED });
    });

    it('400 si tiene subtareas sin completar, no guarda', async () => {
      const { service, taskRepo, subtaskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(
        makeTask({ project: makeProject(), status: TaskStatus.IN_PROGRESS }),
      );
      subtaskRepo.count.mockResolvedValue(2);

      await expect(
        service.update('task-1', { status: TaskStatus.COMPLETED }, makeUser('admin-1', [RoleName.ADMIN])),
      ).rejects.toThrow(BadRequestException);
      expect(taskRepo.save).not.toHaveBeenCalled();
    });

    it('consulta subtareas pendientes en subtaskRepo (taskId = task.id, completed = false)', async () => {
      const { service, taskRepo, subtaskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(
        makeTask({ project: makeProject(), status: TaskStatus.IN_PROGRESS }),
      );

      await service.update('task-1', { status: TaskStatus.COMPLETED }, makeUser('admin-1', [RoleName.ADMIN]));

      expect(subtaskRepo.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { taskId: 'task-1', completed: false } }),
      );
    });

    it('no chequea subtareas si el update no cambia el status a COMPLETED', async () => {
      const { service, taskRepo, subtaskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject() }));

      await service.update('task-1', { title: 'nuevo' }, makeUser('admin-1', [RoleName.ADMIN]));

      expect(subtaskRepo.count).not.toHaveBeenCalled();
    });

    it('se evalúa DESPUÉS de canEditTask: COLLABORATOR sin permiso -> 403, ni siquiera consulta subtareas', async () => {
      const { service, taskRepo, subtaskRepo } = makeService([membership('collab-1', ProjectMemberRole.COLLABORATOR)]);
      taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject(), createdBy: 'otro', assignedToId: 'otro' }));

      await expect(
        service.update('task-1', { status: TaskStatus.COMPLETED }, makeUser('collab-1', [RoleName.COLLABORATOR])),
      ).rejects.toThrow(ForbiddenException);
      expect(subtaskRepo.count).not.toHaveBeenCalled();
    });
  });
});

describe('TasksService - update: planificación (fechas) separada de edición', () => {
  const ADMIN = makeUser('admin-1', [RoleName.ADMIN]);
  const PM = makeUser('pm-1', [RoleName.PROGRAM_MANAGER]);
  const LEADER = makeUser(LEADER_ID, [RoleName.PROJECT_LEADER]);
  const FOREIGN_LEADER = makeUser('otro-leader', [RoleName.PROJECT_LEADER]);
  const COLLAB = makeUser('collab-1', [RoleName.COLLABORATOR]);
  const OBSERVER = makeUser('obs-1', [RoleName.OBSERVER]);

  /** Tarea propia del COLLABORATOR, con fechas ya cargadas. */
  const ownTask = (overrides: Partial<TaskEntity> = {}) =>
    makeTask({
      project: makeProject(),
      createdBy: 'collab-1',
      description: 'original',
      startDate: '2026-10-10',
      dueDate: '2026-10-20',
      ...overrides,
    });

  describe('quienes administran la planificación', () => {
    it.each([
      ['ADMIN', ADMIN],
      ['PROGRAM_MANAGER', PM],
      ['líder real', LEADER],
    ])('%s: cambia startDate y dueDate', async (_label, actor) => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(ownTask({ createdBy: 'otro' }));
      await expect(
        service.update('task-1', { startDate: '2026-10-12', dueDate: '2026-10-30' }, actor),
      ).resolves.toMatchObject({ startDate: '2026-10-12', dueDate: '2026-10-30' });
    });

    it('PROJECT_LEADER ajeno: 403, no guarda', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(ownTask());
      await expect(service.update('task-1', { dueDate: '2026-10-30' }, FOREIGN_LEADER)).rejects.toThrow(ForbiddenException);
      expect(taskRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('COLLABORATOR sobre tarea propia', () => {
    const collabMembership = [membership('collab-1', ProjectMemberRole.COLLABORATOR)];

    it('puede editar title y description', async () => {
      const { service, taskRepo } = makeService(collabMembership);
      taskRepo.findOne.mockResolvedValue(ownTask());
      await expect(
        service.update('task-1', { title: 'nuevo', description: 'otra' }, COLLAB),
      ).resolves.toMatchObject({ title: 'nuevo', description: 'otra' });
    });

    it.each([
      ['startDate', { startDate: '2026-10-12' }],
      ['dueDate', { dueDate: '2026-10-30' }],
      ['limpiar dueDate (null)', { dueDate: null }],
    ])('cambiar %s: 403 y no guarda', async (_label, dto) => {
      const { service, taskRepo } = makeService(collabMembership);
      taskRepo.findOne.mockResolvedValue(ownTask());
      await expect(service.update('task-1', dto, COLLAB)).rejects.toThrow(ForbiddenException);
      expect(taskRepo.save).not.toHaveBeenCalled();
    });

    it('request mixto (description + dueDate): 403 y NO modifica nada (ni la parte permitida)', async () => {
      const { service, taskRepo } = makeService(collabMembership);
      const task = ownTask();
      taskRepo.findOne.mockResolvedValue(task);
      await expect(
        service.update('task-1', { description: 'Cambio', dueDate: '2026-10-30' }, COLLAB),
      ).rejects.toThrow(ForbiddenException);
      expect(taskRepo.save).not.toHaveBeenCalled();
      expect(task.description).toBe('original');
      expect(task.dueDate).toBe('2026-10-20');
    });

    it('reenviar las MISMAS fechas (como hace el form de edición) no cuenta como cambio de planificación', async () => {
      const { service, taskRepo } = makeService(collabMembership);
      taskRepo.findOne.mockResolvedValue(ownTask());
      await expect(
        service.update('task-1', { description: 'x', startDate: '2026-10-10', dueDate: '2026-10-20' }, COLLAB),
      ).resolves.toMatchObject({ description: 'x', startDate: '2026-10-10', dueDate: '2026-10-20' });
    });
  });

  describe('sin permiso de edición (siguen siendo 403, también con fechas)', () => {
    it('OBSERVER: 403', async () => {
      const { service, taskRepo } = makeService([membership('obs-1', ProjectMemberRole.OBSERVER)]);
      taskRepo.findOne.mockResolvedValue(ownTask({ createdBy: 'obs-1' }));
      await expect(service.update('task-1', { dueDate: '2026-10-30' }, OBSERVER)).rejects.toThrow(ForbiddenException);
      expect(taskRepo.save).not.toHaveBeenCalled();
    });

    it('COLLABORATOR global con projectRole OBSERVER en este proyecto: 403', async () => {
      const { service, taskRepo } = makeService([membership('collab-1', ProjectMemberRole.OBSERVER)]);
      taskRepo.findOne.mockResolvedValue(ownTask());
      await expect(service.update('task-1', { description: 'x' }, COLLAB)).rejects.toThrow(ForbiddenException);
      await expect(service.update('task-1', { dueDate: '2026-10-30' }, COLLAB)).rejects.toThrow(ForbiddenException);
      expect(taskRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('validación de fechas (400)', () => {
    it('startDate posterior al dueDate enviado en el mismo request', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(ownTask());
      await expect(
        service.update('task-1', { startDate: '2026-10-30', dueDate: '2026-10-05' }, ADMIN),
      ).rejects.toThrow(BadRequestException);
      expect(taskRepo.save).not.toHaveBeenCalled();
    });

    it('update parcial: startDate nuevo (25) queda después del dueDate existente (20)', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(ownTask());
      await expect(service.update('task-1', { startDate: '2026-10-25' }, ADMIN)).rejects.toThrow(BadRequestException);
      expect(taskRepo.save).not.toHaveBeenCalled();
    });

    it('update parcial: dueDate nuevo (05) queda antes del startDate existente (10)', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(ownTask());
      await expect(service.update('task-1', { dueDate: '2026-10-05' }, ADMIN)).rejects.toThrow(BadRequestException);
    });

    it('mensaje claro con ambas fechas', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(ownTask());
      await expect(service.update('task-1', { dueDate: '2026-10-05' }, ADMIN)).rejects.toThrow(
        'La fecha de vencimiento (2026-10-05) no puede ser anterior a la de inicio (2026-10-10).',
      );
    });

    it('fechas compatibles con las existentes: OK (misma fecha también)', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(ownTask());
      await expect(service.update('task-1', { dueDate: '2026-10-10' }, ADMIN)).resolves.toMatchObject({
        dueDate: '2026-10-10',
      });
    });

    it('sin startDate existente, cualquier dueDate es válido', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(ownTask({ startDate: null }));
      await expect(service.update('task-1', { dueDate: '2026-01-01' }, ADMIN)).resolves.toBeDefined();
    });

    it('el permiso se evalúa ANTES que las fechas: sin permiso de planificación es 403, no 400', async () => {
      const { service, taskRepo } = makeService([membership('collab-1', ProjectMemberRole.COLLABORATOR)]);
      taskRepo.findOne.mockResolvedValue(ownTask());
      await expect(service.update('task-1', { dueDate: '2026-10-05' }, COLLAB)).rejects.toThrow(ForbiddenException);
    });
  });
});

describe('TasksService - comentarios (canCommentOnTask) vs lectura (canViewTask)', () => {
  const ADMIN = makeUser('admin-1', [RoleName.ADMIN]);
  const PM = makeUser('pm-1', [RoleName.PROGRAM_MANAGER]);
  const LEADER = makeUser(LEADER_ID, [RoleName.PROJECT_LEADER]);
  const FOREIGN_LEADER = makeUser('otro-leader', [RoleName.PROJECT_LEADER]);
  const COLLAB = makeUser('collab-1', [RoleName.COLLABORATOR]);
  const OBSERVER = makeUser('obs-1', [RoleName.OBSERVER]);
  const STRANGER = makeUser('nadie', [RoleName.COLLABORATOR]);

  // Tarea AJENA a todos: comentar no depende de ownership.
  const foreignTask = () => makeTask({ project: makeProject(), createdBy: 'otro', assignedToId: 'otro' });

  describe('addComment', () => {
    it.each([
      ['ADMIN', ADMIN, []],
      ['PROGRAM_MANAGER', PM, []],
      ['líder real', LEADER, []],
      ['COLLABORATOR local, sobre tarea ajena', COLLAB, [membership('collab-1', ProjectMemberRole.COLLABORATOR)]],
    ])('%s: puede comentar', async (_label, actor, members) => {
      const { service, taskRepo, commentRepo } = makeService(members);
      taskRepo.findOne.mockResolvedValue(foreignTask());
      await expect(service.addComment('task-1', '  hola  ', actor)).resolves.toMatchObject({
        taskId: 'task-1',
        authorUserId: actor.id,
        content: 'hola',
      });
      expect(commentRepo.save).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['OBSERVER local', OBSERVER, [membership('obs-1', ProjectMemberRole.OBSERVER)]],
      ['COLLABORATOR global con projectRole OBSERVER', COLLAB, [membership('collab-1', ProjectMemberRole.OBSERVER)]],
      ['PROJECT_LEADER ajeno sin membership', FOREIGN_LEADER, []],
      ['usuario sin acceso al proyecto', STRANGER, []],
    ])('%s: 403 y no guarda', async (_label, actor, members) => {
      const { service, taskRepo, commentRepo } = makeService(members);
      taskRepo.findOne.mockResolvedValue(foreignTask());
      await expect(service.addComment('task-1', 'hola', actor)).rejects.toThrow(ForbiddenException);
      expect(commentRepo.save).not.toHaveBeenCalled();
    });

    it('PROJECT_LEADER global con membership OBSERVER en este proyecto: 403 (el rol global no habilita)', async () => {
      const { service, taskRepo } = makeService([membership('otro-leader', ProjectMemberRole.OBSERVER)]);
      taskRepo.findOne.mockResolvedValue(foreignTask());
      await expect(service.addComment('task-1', 'hola', FOREIGN_LEADER)).rejects.toThrow(ForbiddenException);
    });

    it('la autorización va antes que la validación: OBSERVER con comentario vacío recibe 403, no 400', async () => {
      const { service, taskRepo } = makeService([membership('obs-1', ProjectMemberRole.OBSERVER)]);
      taskRepo.findOne.mockResolvedValue(foreignTask());
      await expect(service.addComment('task-1', '   ', OBSERVER)).rejects.toThrow(ForbiddenException);
    });

    it('con permiso, un comentario vacío sigue siendo 400', async () => {
      const { service, taskRepo, commentRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(foreignTask());
      await expect(service.addComment('task-1', '   ', ADMIN)).rejects.toThrow(BadRequestException);
      expect(commentRepo.save).not.toHaveBeenCalled();
    });

    it('404 si la tarea no existe', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(null);
      await expect(service.addComment('missing', 'hola', ADMIN)).rejects.toThrow(NotFoundException);
    });
  });

  describe('addComment - regresión: la autorización espera el resultado de la promesa', () => {
    it('si canCommentOnTask resuelve false de forma asíncrona: 403 y no guarda (una Promise sin await sería truthy)', async () => {
      const { service, taskRepo, commentRepo, permissions } = makeService([]);
      taskRepo.findOne.mockResolvedValue(foreignTask());
      let resolvedPolicy = false;
      const spy = jest.spyOn(permissions, 'canCommentOnTask').mockImplementation(
        () =>
          new Promise<boolean>((resolve) =>
            setImmediate(() => {
              resolvedPolicy = true;
              resolve(false);
            }),
          ),
      );

      await expect(service.addComment('task-1', 'hola', ADMIN)).rejects.toThrow(ForbiddenException);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(resolvedPolicy).toBe(true);
      expect(commentRepo.create).not.toHaveBeenCalled();
      expect(commentRepo.save).not.toHaveBeenCalled();
    });

    it('si canCommentOnTask resuelve true de forma asíncrona: guarda el comentario una sola vez', async () => {
      const { service, taskRepo, commentRepo, permissions } = makeService([]);
      taskRepo.findOne.mockResolvedValue(foreignTask());
      jest
        .spyOn(permissions, 'canCommentOnTask')
        .mockImplementation(() => new Promise<boolean>((resolve) => setImmediate(() => resolve(true))));

      await expect(service.addComment('task-1', 'hola', STRANGER)).resolves.toMatchObject({
        taskId: 'task-1',
        authorUserId: STRANGER.id,
        content: 'hola',
      });
      expect(commentRepo.save).toHaveBeenCalledTimes(1);
    });

    it('usuario ajeno al proyecto (sin membership) con la policy REAL: 403 y no guarda', async () => {
      const { service, taskRepo, commentRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(foreignTask());

      await expect(service.addComment('task-1', 'hola', STRANGER)).rejects.toThrow(ForbiddenException);
      expect(commentRepo.create).not.toHaveBeenCalled();
      expect(commentRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getTimeline (lectura: canViewTask, el OBSERVER sigue pudiendo leer)', () => {
    it.each([
      ['OBSERVER local', OBSERVER, [membership('obs-1', ProjectMemberRole.OBSERVER)]],
      ['COLLABORATOR global con projectRole OBSERVER', COLLAB, [membership('collab-1', ProjectMemberRole.OBSERVER)]],
      ['COLLABORATOR local', COLLAB, [membership('collab-1', ProjectMemberRole.COLLABORATOR)]],
      ['ADMIN', ADMIN, []],
      ['PROGRAM_MANAGER', PM, []],
      ['líder real', LEADER, []],
    ])('%s: puede leer comentarios y actividad', async (_label, actor, members) => {
      const { service, taskRepo, commentRepo } = makeService(members);
      taskRepo.findOne.mockResolvedValue(foreignTask());
      commentRepo.find.mockResolvedValue([
        { id: 'c1', content: 'existente', createdAt: new Date(), author: { id: 'x', name: 'Ana Gómez' } },
      ]);
      const timeline = await service.getTimeline('task-1', actor);
      expect(timeline).toEqual([expect.objectContaining({ type: 'COMMENT', content: 'existente' })]);
    });

    it.each([
      ['PROJECT_LEADER ajeno sin membership', FOREIGN_LEADER],
      ['usuario sin acceso', STRANGER],
    ])('%s: 403 (sin lectura tampoco ve la timeline)', async (_label, actor) => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(foreignTask());
      await expect(service.getTimeline('task-1', actor)).rejects.toThrow(ForbiddenException);
    });
  });
});

describe('TasksService - updateStatus (transiciones de estado)', () => {
  it('1. permite Pendiente → Completada cuando no tiene subtareas pendientes (RN-04)', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(
      makeTask({ project: makeProject(), status: TaskStatus.PENDING }),
    );
    taskRepo.count.mockResolvedValue(0);

    const result = await service.updateStatus(
      'task-1',
      { status: TaskStatus.COMPLETED },
      makeUser('admin-1', [RoleName.ADMIN]),
    );

    expect(result.status).toBe(TaskStatus.COMPLETED);
    expect(taskRepo.save).toHaveBeenCalled();
  });

  it('2. permite Completada → En curso', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(
      makeTask({ project: makeProject(), status: TaskStatus.COMPLETED }),
    );

    const result = await service.updateStatus(
      'task-1',
      { status: TaskStatus.IN_PROGRESS },
      makeUser('admin-1', [RoleName.ADMIN]),
    );

    expect(result.status).toBe(TaskStatus.IN_PROGRESS);
    expect(taskRepo.save).toHaveBeenCalled();
  });

  it('3. permite Bloqueada → En revisión', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(
      makeTask({ project: makeProject(), status: TaskStatus.BLOCKED }),
    );

    const result = await service.updateStatus(
      'task-1',
      { status: TaskStatus.IN_REVIEW },
      makeUser('admin-1', [RoleName.ADMIN]),
    );

    expect(result.status).toBe(TaskStatus.IN_REVIEW);
    expect(taskRepo.save).toHaveBeenCalled();
  });

  it('4. permite En revisión → Pendiente', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(
      makeTask({ project: makeProject(), status: TaskStatus.IN_REVIEW }),
    );

    const result = await service.updateStatus(
      'task-1',
      { status: TaskStatus.PENDING },
      makeUser('admin-1', [RoleName.ADMIN]),
    );

    expect(result.status).toBe(TaskStatus.PENDING);
    expect(taskRepo.save).toHaveBeenCalled();
  });

  it('permite En curso → Pendiente', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(
      makeTask({ project: makeProject(), status: TaskStatus.IN_PROGRESS }),
    );

    const result = await service.updateStatus(
      'task-1',
      { status: TaskStatus.PENDING },
      makeUser('admin-1', [RoleName.ADMIN]),
    );

    expect(result.status).toBe(TaskStatus.PENDING);
    expect(taskRepo.save).toHaveBeenCalled();
  });

  it('5. movimiento al mismo estado devuelve la tarea sin cambios ni guardado (no-op)', async () => {
    const { service, taskRepo, activityService } = makeService([]);
    taskRepo.findOne.mockResolvedValue(
      makeTask({ project: makeProject(), status: TaskStatus.IN_PROGRESS }),
    );

    const result = await service.updateStatus(
      'task-1',
      { status: TaskStatus.IN_PROGRESS },
      makeUser('admin-1', [RoleName.ADMIN]),
    );

    expect(result.status).toBe(TaskStatus.IN_PROGRESS);
    expect(taskRepo.save).not.toHaveBeenCalled();
    expect(activityService.logEvent).not.toHaveBeenCalled();
  });

  it('6. rechazo por falta de permisos (RF-TB-05): OBSERVER no puede cambiar estado', async () => {
    const { service, taskRepo } = makeService([membership('obs-1', ProjectMemberRole.OBSERVER)]);
    taskRepo.findOne.mockResolvedValue(
      makeTask({ project: makeProject(), status: TaskStatus.PENDING }),
    );

    await expect(
      service.updateStatus('task-1', { status: TaskStatus.IN_PROGRESS }, makeUser('obs-1', [RoleName.OBSERVER])),
    ).rejects.toThrow(new ForbiddenException('No podés cambiar el estado de esta tarea.'));
  });

  it('7. rechazo por RN-04: no se puede pasar a Completada con subtareas pendientes', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(
      makeTask({ project: makeProject(), status: TaskStatus.PENDING }),
    );
    taskRepo.count.mockResolvedValue(3);

    await expect(
      service.updateStatus('task-1', { status: TaskStatus.COMPLETED }, makeUser('admin-1', [RoleName.ADMIN])),
    ).rejects.toThrow(new BadRequestException('No se puede completar una tarea con subtareas pendientes'));
    expect(taskRepo.save).not.toHaveBeenCalled();
  });

  it('7b. RN-04: no cuenta subtareas archivadas como pendientes en updateStatus', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(
      makeTask({ project: makeProject(), status: TaskStatus.PENDING }),
    );
    taskRepo.count.mockResolvedValue(0);

    const result = await service.updateStatus(
      'task-1',
      { status: TaskStatus.COMPLETED },
      makeUser('admin-1', [RoleName.ADMIN]),
    );

    expect(result.status).toBe(TaskStatus.COMPLETED);
    expect(taskRepo.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          parentTaskId: 'task-1',
          archivedAt: expect.anything(),
        }),
      }),
    );
  });

  it('8. RN-13: cuando el módulo de dependencias esté implementado, bloqueará paso a En curso o Completada', () => {
    // RN-13: "una tarea con predecesoras sin completar no puede pasar a En curso ni Completada."
    // Nota: El módulo de dependencias de tareas (Gantt) aún no está implementado en la capa de servicios.
    // Esta prueba documenta el requisito pendiente de integración con dicho módulo.
    expect(true).toBe(true);
  });

  it('9. registro correcto en el historial de actividad (RF-TA-10 / CU-06)', async () => {
    const { service, taskRepo, activityService } = makeService([]);
    taskRepo.findOne.mockResolvedValue(
      makeTask({ project: makeProject(), status: TaskStatus.PENDING }),
    );

    await service.updateStatus(
      'task-1',
      { status: TaskStatus.IN_PROGRESS },
      makeUser('admin-1', [RoleName.ADMIN]),
    );

    expect(activityService.logEvent).toHaveBeenCalledWith(
      {
        projectId: PROJECT_ID,
        actorId: 'admin-1',
        actionType: ProjectActivityAction.TASK_UPDATED,
        entityType: ProjectActivityEntityType.TASK,
        entityId: 'task-1',
        metadata: { changes: { status: { old: TaskStatus.PENDING, new: TaskStatus.IN_PROGRESS } } },
      },
      expect.anything(),
    );
  });

  it('HU39: un cambio de estado hecho por el asistente queda con origen AI y el pedido del usuario', async () => {
    const { service, taskRepo, activityService } = makeService([]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject(), status: TaskStatus.PENDING }));

    await service.updateStatus('task-1', { status: TaskStatus.IN_PROGRESS }, makeUser('admin-1', [RoleName.ADMIN]), {
      origin: AuditOrigin.AI,
      request: 'pasá la tarea a en progreso',
    });

    expect(activityService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        origin: AuditOrigin.AI,
        metadata: expect.objectContaining({ viaAssistant: true, request: 'pasá la tarea a en progreso' }),
      }),
      expect.anything(),
    );
  });

  it('lanza NotFoundException si la tarea no existe', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(null);

    await expect(
      service.updateStatus('no-existe', { status: TaskStatus.IN_PROGRESS }, makeUser('admin-1', [RoleName.ADMIN])),
    ).rejects.toThrow(NotFoundException);
  });

  it('lanza BadRequestException si el estado destino no es válido', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(
      makeTask({ project: makeProject(), status: TaskStatus.PENDING }),
    );

    await expect(
      service.updateStatus('task-1', { status: 'INVALID_STATUS' as any }, makeUser('admin-1', [RoleName.ADMIN])),
    ).rejects.toThrow(BadRequestException);
  });

  it('COLLABORATOR puede cambiar estado de tarea propia', async () => {
    const { service, taskRepo } = makeService([membership('collab-1', ProjectMemberRole.COLLABORATOR)]);
    taskRepo.findOne.mockResolvedValue(
      makeTask({ project: makeProject(), status: TaskStatus.PENDING, createdBy: 'collab-1' }),
    );

    const result = await service.updateStatus(
      'task-1',
      { status: TaskStatus.IN_PROGRESS },
      makeUser('collab-1', [RoleName.COLLABORATOR]),
    );

    expect(result.status).toBe(TaskStatus.IN_PROGRESS);
  });
});

describe('TasksService - archive ("eliminar tarea", RN-07 baja lógica; canDeleteTask)', () => {
  it('404 si la tarea no existe', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(null);
    await expect(service.archive('missing', makeUser('u1'))).rejects.toThrow(NotFoundException);
  });

  it('ADMIN: permitido', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject() }));
    const result = await service.archive('task-1', makeUser('admin-1', [RoleName.ADMIN]));
    expect(result.archivedAt).not.toBeNull();
  });

  it('PROGRAM_MANAGER: permitido', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject() }));
    const result = await service.archive('task-1', makeUser('pm-1', [RoleName.PROGRAM_MANAGER]));
    expect(result.archivedAt).not.toBeNull();
  });

  it('líder del proyecto propio: permitido', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject() }));
    const result = await service.archive('task-1', makeUser(LEADER_ID, [RoleName.PROJECT_LEADER]));
    expect(result.archivedAt).not.toBeNull();
  });

  it('líder de OTRO proyecto: 403', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject() }));
    await expect(service.archive('task-1', makeUser('otro-leader', [RoleName.PROJECT_LEADER]))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('COLLABORATOR sobre tarea PROPIA: 403 (a diferencia de editar, acá el ownership no habilita nada)', async () => {
    const { service, taskRepo } = makeService([membership('collab-1', ProjectMemberRole.COLLABORATOR)]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject(), createdBy: 'collab-1' }));
    await expect(service.archive('task-1', makeUser('collab-1', [RoleName.COLLABORATOR]))).rejects.toThrow(
      ForbiddenException,
    );
    expect(taskRepo.save).not.toHaveBeenCalled();
  });

  it('COLLABORATOR sobre tarea ASIGNADA a él: 403', async () => {
    const { service, taskRepo } = makeService([membership('collab-1', ProjectMemberRole.COLLABORATOR)]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject(), assignedToId: 'collab-1' }));
    await expect(service.archive('task-1', makeUser('collab-1', [RoleName.COLLABORATOR]))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('OBSERVER: 403', async () => {
    const { service, taskRepo } = makeService([membership('obs-1', ProjectMemberRole.OBSERVER)]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject() }));
    await expect(service.archive('task-1', makeUser('obs-1', [RoleName.OBSERVER]))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('idempotente: ya archivada no vuelve a guardar (con permiso concedido)', async () => {
    const { service, taskRepo } = makeService([]);
    const archivedAt = new Date();
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject(), archivedAt }));
    const result = await service.archive('task-1', makeUser('admin-1', [RoleName.ADMIN]));
    expect(result.archivedAt).toBe(archivedAt);
    expect(taskRepo.save).not.toHaveBeenCalled();
  });

  it('multi-rol ADMIN + PROGRAM_MANAGER: permitido', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject() }));
    const result = await service.archive('task-1', makeUser('u1', [RoleName.ADMIN, RoleName.PROGRAM_MANAGER]));
    expect(result.archivedAt).not.toBeNull();
  });
});

describe('TasksService - caso crítico (bug arquitectónico original)', () => {
  // User.roles = [COLLABORATOR] (global) pero ProjectMember.projectRole = OBSERVER
  // en ESTE proyecto. Antes del paso 4, TasksService no distinguía esto: cualquier
  // fila de membership alcanzaba para crear/editar/borrar. Este test falla si
  // alguna policy vuelve a decidir por el rol global en vez del local.
  const USER_ID = 'user-obs-local';
  const members = [membership(USER_ID, ProjectMemberRole.OBSERVER)];
  const user = makeUser(USER_ID, [RoleName.COLLABORATOR]);

  it('GET (ver tarea): permitido', async () => {
    const { service, taskRepo } = makeService(members);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject() }));
    await expect(service.findOne('task-1', user)).resolves.toBeDefined();
  });

  it('POST (crear tarea): 403', async () => {
    const { service } = makeService(members);
    await expect(service.create({ projectId: PROJECT_ID, title: 'x' }, user)).rejects.toThrow(ForbiddenException);
  });

  it('PATCH (editar tarea): 403, incluso si la tarea es propia/asignada', async () => {
    const { service, taskRepo } = makeService(members);
    taskRepo.findOne.mockResolvedValue(
      makeTask({ project: makeProject(), createdBy: USER_ID, assignedToId: USER_ID }),
    );
    await expect(service.update('task-1', { title: 'x' }, user)).rejects.toThrow(ForbiddenException);
  });

  it('DELETE/archive (eliminar tarea): 403', async () => {
    const { service, taskRepo } = makeService(members);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject() }));
    await expect(service.archive('task-1', user)).rejects.toThrow(ForbiddenException);
  });

  it('PATCH status (cambiar estado): 403', async () => {
    const { service, taskRepo } = makeService(members);
    taskRepo.findOne.mockResolvedValue(
      makeTask({ project: makeProject(), status: TaskStatus.PENDING }),
    );
    await expect(
      service.updateStatus('task-1', { status: TaskStatus.IN_PROGRESS }, user),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('TasksService - Slugs de tareas e histórico de URLs legibles', () => {
  const leaderUser = makeUser(LEADER_ID, [RoleName.PROJECT_LEADER]);
  const members = [membership(LEADER_ID, 'COLLABORATOR' as any)];

  it('crear tarea genera un slug legible a partir del título', async () => {
    const { service, taskRepo } = makeService(members);
    taskRepo.manager.query.mockResolvedValue([]);

    const task = await service.create(
      { projectId: PROJECT_ID, title: 'Implementar Login con Google' },
      leaderUser,
    );

    expect(task.slug).toBe('implementar-login-con-google');
  });

  it('nombres repetidos en el mismo proyecto: genera sufijo incremental (-2, -3)', async () => {
    const { service, taskRepo } = makeService(members);
    taskRepo.manager.query.mockResolvedValue([
      { slug: 'revision-de-codigo', task_id: 't-1', source: 'task' },
      { slug: 'revision-de-codigo-2', task_id: 't-2', source: 'task' },
    ]);

    const task = await service.create(
      { projectId: PROJECT_ID, title: 'Revisión de Código' },
      leaderUser,
    );

    expect(task.slug).toBe('revision-de-codigo-3');
  });

  it('no reutiliza slugs que existen en el histórico de otra tarea', async () => {
    const { service, taskRepo } = makeService(members);
    taskRepo.manager.query.mockResolvedValue([
      { slug: 'tarea-urgente', task_id: 'other-task', source: 'history' },
    ]);

    const task = await service.create(
      { projectId: PROJECT_ID, title: 'Tarea Urgente' },
      leaderUser,
    );

    expect(task.slug).toBe('tarea-urgente-2');
  });

  it('al renombrar una tarea, actualiza su slug y registra el slug viejo en task_slug_histories', async () => {
    const { service, taskRepo, taskSlugHistoryRepo } = makeService(members);
    const existing = makeTask({
      project: makeProject(),
      title: 'Nombre Original',
      slug: 'nombre-original',
    });
    taskRepo.findOne.mockResolvedValue(existing);
    taskRepo.manager.query.mockResolvedValue([]);

    const updated = await service.update(
      existing.id,
      { title: 'Nombre Renovado' },
      leaderUser,
    );

    expect(updated.slug).toBe('nombre-renovado');
    expect(taskSlugHistoryRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: existing.id,
        projectId: PROJECT_ID,
        slug: 'nombre-original',
      }),
    );
  });

  it('findOne resuelve tarea por UUID directamente (compatibilidad hacia atrás)', async () => {
    const { service, taskRepo } = makeService(members);
    const existing = makeTask({
      id: 'e8b8c2d1-9452-47ef-8a3c-1b7f03d65a29',
      project: makeProject(),
      slug: 'mi-tarea-importante',
    });
    taskRepo.findOne.mockResolvedValue(existing);

    const found = await service.findOne('e8b8c2d1-9452-47ef-8a3c-1b7f03d65a29', leaderUser);
    expect(found.id).toBe('e8b8c2d1-9452-47ef-8a3c-1b7f03d65a29');
    expect(found.slug).toBe('mi-tarea-importante');
  });

  it('findOne resuelve tarea por slug activo', async () => {
    const { service, taskRepo } = makeService(members);
    const existing = makeTask({
      id: 'task-uuid-123',
      project: makeProject(),
      slug: 'tarea-de-prueba',
    });
    taskRepo.findOne.mockImplementation(async ({ where }: any) => {
      if (where.slug === 'tarea-de-prueba') return existing;
      return null;
    });

    const found = await service.findOne('tarea-de-prueba', leaderUser, PROJECT_ID);
    expect(found.id).toBe('task-uuid-123');
    expect(found.slug).toBe('tarea-de-prueba');
  });

  it('findOne resuelve tarea a través del histórico si se usa un slug anterior', async () => {
    const { service, taskRepo, taskSlugHistoryRepo } = makeService(members);
    const existing = makeTask({
      id: 'task-uuid-renamed',
      project: makeProject(),
      slug: 'nuevo-slug',
    });
    taskRepo.findOne.mockImplementation(async ({ where }: any) => {
      if (where.slug === 'slug-antiguo') return null;
      return null;
    });
    taskSlugHistoryRepo.findOne.mockResolvedValue({
      taskId: 'task-uuid-renamed',
      projectId: PROJECT_ID,
      slug: 'slug-antiguo',
      task: existing,
    });

    const found = await service.findOne('slug-antiguo', leaderUser, PROJECT_ID);
    expect(found.id).toBe('task-uuid-renamed');
    expect(found.slug).toBe('nuevo-slug');
  });

  it('findOne lanza NotFoundException si el slug no existe ni activo ni en histórico', async () => {
    const { service, taskRepo, taskSlugHistoryRepo } = makeService(members);
    taskRepo.findOne.mockResolvedValue(null);
    taskSlugHistoryRepo.findOne.mockResolvedValue(null);

    await expect(
      service.findOne('slug-inexistente', leaderUser, PROJECT_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('findOne lanza ForbiddenException si el usuario no tiene acceso a la tarea encontrada por slug', async () => {
    const observerOutside = makeUser('stranger', [RoleName.COLLABORATOR]);
    const { service, taskRepo } = makeService(members);
    const existing = makeTask({
      id: 'task-uuid-secret',
      project: makeProject(),
      slug: 'tarea-confidencial',
    });
    taskRepo.findOne.mockResolvedValue(existing);

    await expect(
      service.findOne('tarea-confidencial', observerOutside, PROJECT_ID),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('TasksService - atomicidad en creación de subtareas (regresión error 500 y duplicados)', () => {
  const leaderUser = makeUser(LEADER_ID, [RoleName.PROJECT_LEADER]);
  const parentTask = makeTask({
    id: 'parent-task-1',
    project: makeProject(),
    parentTaskId: null,
    archivedAt: null,
  });

  it('persiste subtarea y registra evento de actividad dentro de la misma transacción', async () => {
    const { service, taskRepo, activityService } = makeService([]);
    taskRepo.findOneBy.mockResolvedValue(parentTask);

    const committedTasks: TaskEntity[] = [];
    const txManager = {
      query: jest.fn(async () => []),
      save: jest.fn(async (_entity: unknown, data: TaskEntity) => {
        const saved = { ...data, id: 'subtask-new-1' } as TaskEntity;
        committedTasks.push(saved);
        return saved;
      }),
    };
    taskRepo.manager.transaction = jest.fn(async (cb: (m: unknown) => Promise<unknown>) => cb(txManager)) as jest.Mock;

    const created = await service.create(
      {
        projectId: PROJECT_ID,
        title: 'Subtarea de prueba',
        parentTaskId: parentTask.id,
      },
      leaderUser,
    );

    expect(created.id).toBe('subtask-new-1');
    expect(created.parentTaskId).toBe(parentTask.id);
    expect(created.slug).toBe('subtarea-de-prueba');
    expect(committedTasks).toHaveLength(1);
    expect(activityService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        actorId: LEADER_ID,
        actionType: ProjectActivityAction.TASK_CREATED,
        entityType: ProjectActivityEntityType.TASK,
        entityId: 'subtask-new-1',
        metadata: expect.objectContaining({
          title: 'Subtarea de prueba',
          slug: 'subtarea-de-prueba',
        }),
      }),
      txManager,
    );
  });

  it('revierte la creación de la subtarea si falla logEvent (evita subtareas fantasma y duplicados al reintentar)', async () => {
    const { service, taskRepo, activityService } = makeService([]);
    taskRepo.findOneBy.mockResolvedValue(parentTask);

    const persistedInDb: TaskEntity[] = [];

    taskRepo.manager.transaction = jest.fn(async (cb: (m: unknown) => Promise<unknown>) => {
      const stagedTasks: TaskEntity[] = [];
      const txManager = {
        query: jest.fn(async () =>
          persistedInDb.map((t) => ({ slug: t.slug, task_id: t.id, source: 'active' })),
        ),
        save: jest.fn(async (_entity: unknown, data: TaskEntity) => {
          const saved = { ...data, id: `subtask-${stagedTasks.length + 1}` } as TaskEntity;
          stagedTasks.push(saved);
          return saved;
        }),
      };
      // Si cb lanza excepción, no se vuelcan stagedTasks a persistedInDb (rollback transaccional)
      const result = await cb(txManager);
      persistedInDb.push(...stagedTasks);
      return result;
    });

    // Primer intento: falla el registro de actividad (ej. error SQL en project_activities)
    activityService.logEvent.mockRejectedValueOnce(
      new Error('column "origin" of relation "project_activities" does not exist'),
    );

    await expect(
      service.create(
        {
          projectId: PROJECT_ID,
          title: 'Saludar',
          parentTaskId: parentTask.id,
        },
        leaderUser,
      ),
    ).rejects.toThrow('column "origin" of relation "project_activities" does not exist');

    // La subtarea NO debe haber quedado persistida tras el fallo
    expect(persistedInDb).toHaveLength(0);

    // Segundo intento (reintento del usuario tras resolver el problema): tiene éxito sin duplicados
    activityService.logEvent.mockResolvedValueOnce(undefined);

    const createdOnRetry = await service.create(
      {
        projectId: PROJECT_ID,
        title: 'Saludar',
        parentTaskId: parentTask.id,
      },
      leaderUser,
    );

    expect(persistedInDb).toHaveLength(1);
    expect(createdOnRetry.slug).toBe('saludar');
  });
});

describe('TasksService - findAllByProject: contadores agregados de subtareas sin N+1', () => {
  const leaderUser = makeUser(LEADER_ID, [RoleName.PROJECT_LEADER]);

  it('calcula subtaskCount y completedSubtaskCount en una única consulta agregada', async () => {
    const { service, taskRepo } = makeService([]);
    const rootTasks = [
      makeTask({ id: 'task-a', title: 'Tarea A', project: makeProject() }),
      makeTask({ id: 'task-b', title: 'Tarea B', project: makeProject() }),
      makeTask({ id: 'task-c', title: 'Tarea C', project: makeProject() }),
    ];

    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => rootTasks),
    };
    taskRepo.createQueryBuilder.mockReturnValue(qb);

    taskRepo.manager.query.mockResolvedValueOnce([
      { parentTaskId: 'task-a', total: 5, completed: 0 },
      { parentTaskId: 'task-b', total: 3, completed: 2 },
    ]);

    const result = await service.findAllByProject({ projectId: PROJECT_ID }, leaderUser);

    expect(taskRepo.manager.query).toHaveBeenCalledTimes(1);
    expect(taskRepo.manager.query).toHaveBeenCalledWith(
      expect.stringContaining('GROUP BY parent_task_id'),
      [PROJECT_ID, TaskStatus.COMPLETED, ['task-a', 'task-b', 'task-c']],
    );

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ id: 'task-a', subtaskCount: 5, completedSubtaskCount: 0 });
    expect(result[1]).toMatchObject({ id: 'task-b', subtaskCount: 3, completedSubtaskCount: 2 });
    expect(result[2]).toMatchObject({ id: 'task-c', subtaskCount: 0, completedSubtaskCount: 0 });
  });

  it('no ejecuta consulta de conteo si el listado de tareas está vacío', async () => {
    const { service, taskRepo } = makeService([]);
    const result = await service.findAllByProject({ projectId: PROJECT_ID }, leaderUser);

    expect(result).toEqual([]);
    expect(taskRepo.manager.query).not.toHaveBeenCalled();
  });
});
