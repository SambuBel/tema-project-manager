import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { PermissionsService } from '../auth/permissions.service';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { ProjectEntity } from '../projects/project.entity';
import { TaskEntity } from './task.entity';
import {
  ProjectActivityAction,
  ProjectActivityEntityType,
  ProjectMemberRole,
  RoleName,
  TaskStatus,
} from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateTaskDto } from './dto/create-task.dto';

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
    parentTaskId: null,
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
  taskRepo: { findOne: jest.Mock; find: jest.Mock; findOneBy: jest.Mock; count: jest.Mock; save: jest.Mock; createQueryBuilder: jest.Mock };
  projectRepo: { findOneBy: jest.Mock; manager: { find: jest.Mock } };
  usersService: { findById: jest.Mock };
  activityService: { logEvent: jest.Mock };
  commentRepo: { create: jest.Mock; save: jest.Mock; find: jest.Mock };
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
  };
  const projectRepo = { findOneBy: jest.fn(async () => project), manager: { find: jest.fn(async () => []) } };
  const commentRepo = {
    create: jest.fn((c: unknown) => c),
    save: jest.fn(async (c: unknown) => c),
    find: jest.fn(async () => [] as unknown[]),
  };
  const usersService = { findById: jest.fn(async (id: string) => ({ id, active: true })) };
  const permissions = makePermissions(members);
  const activityService = { logEvent: jest.fn() };

  const service = new TasksService(
    taskRepo as unknown as import('typeorm').Repository<TaskEntity>,
    projectRepo as unknown as import('typeorm').Repository<ProjectEntity>,
    commentRepo as never,
    usersService as never,
    permissions as never,
    activityService as never,
  );

  return { service, taskRepo, projectRepo, usersService, activityService, commentRepo };
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

  describe('subtareas (jerarquía de un solo nivel)', () => {
    const PARENT_ID = 'parent-task-1';

    it('crea la subtarea si la tarea padre existe, es del mismo proyecto y no es a su vez una subtarea', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOneBy.mockResolvedValue({ id: PARENT_ID, projectId: PROJECT_ID, parentTaskId: null });

      const result = await service.create(
        { ...dto, parentTaskId: PARENT_ID },
        makeUser('admin-1', [RoleName.ADMIN]),
      );

      expect(taskRepo.findOneBy).toHaveBeenCalledWith({ id: PARENT_ID });
      expect(result.parentTaskId).toBe(PARENT_ID);
    });

    it('404 si la tarea padre no existe, no guarda', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.create({ ...dto, parentTaskId: PARENT_ID }, makeUser('admin-1', [RoleName.ADMIN])),
      ).rejects.toThrow(NotFoundException);
      expect(taskRepo.save).not.toHaveBeenCalled();
    });

    it('400 si la tarea padre es de otro proyecto, no guarda', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOneBy.mockResolvedValue({ id: PARENT_ID, projectId: 'otro-proyecto', parentTaskId: null });

      await expect(
        service.create({ ...dto, parentTaskId: PARENT_ID }, makeUser('admin-1', [RoleName.ADMIN])),
      ).rejects.toThrow(BadRequestException);
      expect(taskRepo.save).not.toHaveBeenCalled();
    });

    it('400 si se intenta anidar una subtarea dentro de otra subtarea, no guarda', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOneBy.mockResolvedValue({ id: PARENT_ID, projectId: PROJECT_ID, parentTaskId: 'abuelo' });

      await expect(
        service.create({ ...dto, parentTaskId: PARENT_ID }, makeUser('admin-1', [RoleName.ADMIN])),
      ).rejects.toThrow(BadRequestException);
      expect(taskRepo.save).not.toHaveBeenCalled();
    });

    it('crear subtarea sigue exigiendo canCreateTask: COLLABORATOR con projectRole OBSERVER -> 403', async () => {
      const { service, taskRepo } = makeService([membership('u1', ProjectMemberRole.OBSERVER)]);
      taskRepo.findOneBy.mockResolvedValue({ id: PARENT_ID, projectId: PROJECT_ID, parentTaskId: null });

      await expect(
        service.create({ ...dto, parentTaskId: PARENT_ID }, makeUser('u1', [RoleName.COLLABORATOR])),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});

describe('TasksService - findAllByProject / findOne / findSubtasks (canViewTask)', () => {
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

  it('findSubtasks: mismo criterio de acceso que la tarea padre (403 si no puede verla)', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(makeTask({ id: 'parent-1', project: makeProject() }));
    await expect(service.findSubtasks('parent-1', makeUser('ajeno'))).rejects.toThrow(ForbiddenException);
    expect(taskRepo.find).not.toHaveBeenCalled();
  });

  it('findSubtasks: devuelve las subtareas si tiene acceso a la tarea padre', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.findOne.mockResolvedValue(makeTask({ id: 'parent-1', project: makeProject() }));
    taskRepo.find.mockResolvedValue([{ id: 'sub-1' }]);

    const result = await service.findSubtasks('parent-1', makeUser('admin-1', [RoleName.ADMIN]));

    expect(taskRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { parentTaskId: 'parent-1' } }));
    expect(result).toEqual([{ id: 'sub-1' }]);
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
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(
        makeTask({ project: makeProject(), status: TaskStatus.IN_PROGRESS }),
      );
      taskRepo.count.mockResolvedValue(0);

      await expect(
        service.update('task-1', { status: TaskStatus.COMPLETED }, makeUser('admin-1', [RoleName.ADMIN])),
      ).resolves.toMatchObject({ status: TaskStatus.COMPLETED });
    });

    it('400 si tiene subtareas sin completar, no guarda', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(
        makeTask({ project: makeProject(), status: TaskStatus.IN_PROGRESS }),
      );
      taskRepo.count.mockResolvedValue(2);

      await expect(
        service.update('task-1', { status: TaskStatus.COMPLETED }, makeUser('admin-1', [RoleName.ADMIN])),
      ).rejects.toThrow(BadRequestException);
      expect(taskRepo.save).not.toHaveBeenCalled();
    });

    it('consulta subtareas pendientes de ESTA tarea (parentTaskId = task.id, status != COMPLETED)', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(
        makeTask({ project: makeProject(), status: TaskStatus.IN_PROGRESS }),
      );

      await service.update('task-1', { status: TaskStatus.COMPLETED }, makeUser('admin-1', [RoleName.ADMIN]));

      expect(taskRepo.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { parentTaskId: 'task-1', status: expect.anything(), archivedAt: expect.anything() } }),
      );
    });

    it('RN-04: no cuenta subtareas archivadas como pendientes (archivedAt no nulo)', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(
        makeTask({ project: makeProject(), status: TaskStatus.IN_PROGRESS }),
      );
      taskRepo.count.mockResolvedValue(0);

      await expect(
        service.update('task-1', { status: TaskStatus.COMPLETED }, makeUser('admin-1', [RoleName.ADMIN])),
      ).resolves.toMatchObject({ status: TaskStatus.COMPLETED });

      expect(taskRepo.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            parentTaskId: 'task-1',
            status: expect.anything(),
            archivedAt: expect.anything(),
          }),
        }),
      );
    });

    it('no chequea subtareas si el update no cambia el status a COMPLETED', async () => {
      const { service, taskRepo } = makeService([]);
      taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject() }));

      await service.update('task-1', { title: 'nuevo' }, makeUser('admin-1', [RoleName.ADMIN]));

      expect(taskRepo.count).not.toHaveBeenCalled();
    });

    it('RN-04 se evalúa DESPUÉS de canEditTask: COLLABORATOR sin permiso -> 403, ni siquiera consulta subtareas', async () => {
      const { service, taskRepo } = makeService([membership('collab-1', ProjectMemberRole.COLLABORATOR)]);
      taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject(), createdBy: 'otro', assignedToId: 'otro' }));

      await expect(
        service.update('task-1', { status: TaskStatus.COMPLETED }, makeUser('collab-1', [RoleName.COLLABORATOR])),
      ).rejects.toThrow(ForbiddenException);
      expect(taskRepo.count).not.toHaveBeenCalled();
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

    expect(activityService.logEvent).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      actorId: 'admin-1',
      actionType: ProjectActivityAction.TASK_UPDATED,
      entityType: ProjectActivityEntityType.TASK,
      entityId: 'task-1',
      metadata: { changes: { status: { old: TaskStatus.PENDING, new: TaskStatus.IN_PROGRESS } } },
    });
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
