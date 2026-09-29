import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { PermissionsService } from '../auth/permissions.service';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { ProjectEntity } from '../projects/project.entity';
import { TaskEntity } from './task.entity';
import { ProjectMemberRole, RoleName } from '../database/enums';
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
  taskRepo: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };
  projectRepo: { findOneBy: jest.Mock };
  usersService: { findById: jest.Mock };
}

function makeService(members: Array<Partial<ProjectMemberEntity>>, project = makeProject()): { service: TasksService } & Deps {
  const taskRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn(async (t: unknown) => t) };
  const projectRepo = { findOneBy: jest.fn(async () => project) };
  const usersService = { findById: jest.fn(async (id: string) => ({ id, active: true })) };
  const permissions = makePermissions(members);

  const service = new TasksService(
    taskRepo as unknown as import('typeorm').Repository<TaskEntity>,
    projectRepo as unknown as import('typeorm').Repository<ProjectEntity>,
    usersService as never,
    permissions,
  );

  return { service, taskRepo, projectRepo, usersService };
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
    await expect(
      service.create(dto, makeUser('collab-1', [RoleName.COLLABORATOR])),
    ).resolves.toBeDefined();
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
    await expect(service.findAllByProject('missing', makeUser('u1'))).rejects.toThrow(NotFoundException);
  });

  it('findAllByProject: ADMIN no miembro puede ver', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.find.mockResolvedValue([]);
    await expect(service.findAllByProject(PROJECT_ID, makeUser('admin-1', [RoleName.ADMIN]))).resolves.toEqual([]);
  });

  it('findAllByProject: PM no miembro puede ver', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.find.mockResolvedValue([]);
    await expect(
      service.findAllByProject(PROJECT_ID, makeUser('pm-1', [RoleName.PROGRAM_MANAGER])),
    ).resolves.toEqual([]);
  });

  it('findAllByProject: líder del proyecto propio puede ver', async () => {
    const { service, taskRepo } = makeService([]);
    taskRepo.find.mockResolvedValue([]);
    await expect(service.findAllByProject(PROJECT_ID, makeUser(LEADER_ID))).resolves.toEqual([]);
  });

  it('findAllByProject: líder de OTRO proyecto -> 403 salvo membership', async () => {
    const { service } = makeService([]);
    await expect(
      service.findAllByProject(PROJECT_ID, makeUser('otro-leader', [RoleName.PROJECT_LEADER])),
    ).rejects.toThrow(ForbiddenException);
  });

  it('findAllByProject: COLLABORATOR miembro puede ver', async () => {
    const { service, taskRepo } = makeService([membership('collab-1', ProjectMemberRole.COLLABORATOR)]);
    taskRepo.find.mockResolvedValue([]);
    await expect(
      service.findAllByProject(PROJECT_ID, makeUser('collab-1', [RoleName.COLLABORATOR])),
    ).resolves.toEqual([]);
  });

  it('findAllByProject: OBSERVER miembro puede ver', async () => {
    const { service, taskRepo } = makeService([membership('obs-1', ProjectMemberRole.OBSERVER)]);
    taskRepo.find.mockResolvedValue([]);
    await expect(service.findAllByProject(PROJECT_ID, makeUser('obs-1', [RoleName.OBSERVER]))).resolves.toEqual([]);
  });

  it('findAllByProject: no miembro -> 403', async () => {
    const { service } = makeService([]);
    await expect(service.findAllByProject(PROJECT_ID, makeUser('ajeno'))).rejects.toThrow(ForbiddenException);
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
    await expect(service.update('task-1', { title: 'x' }, makeUser('admin-1', [RoleName.ADMIN]))).resolves.toMatchObject({
      title: 'x',
    });
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
    await expect(
      service.archive('task-1', makeUser('collab-1', [RoleName.COLLABORATOR])),
    ).rejects.toThrow(ForbiddenException);
    expect(taskRepo.save).not.toHaveBeenCalled();
  });

  it('COLLABORATOR sobre tarea ASIGNADA a él: 403', async () => {
    const { service, taskRepo } = makeService([membership('collab-1', ProjectMemberRole.COLLABORATOR)]);
    taskRepo.findOne.mockResolvedValue(makeTask({ project: makeProject(), assignedToId: 'collab-1' }));
    await expect(
      service.archive('task-1', makeUser('collab-1', [RoleName.COLLABORATOR])),
    ).rejects.toThrow(ForbiddenException);
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
});
