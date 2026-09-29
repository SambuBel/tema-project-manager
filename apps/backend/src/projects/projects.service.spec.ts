import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectEntity } from './project.entity';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { ProjectStatus, RoleName } from '../database/enums';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';
import { PermissionsService } from '../auth/permissions.service';
import { ProjectActivityService } from './project-activity.service';
import { RequestUser } from '../auth/types/authenticated-request-user';

function makeUser(id: string, roles: RoleName[] = []): RequestUser {
  return { id, roles } as RequestUser;
}

interface QueryBuilderMock {
  where: jest.Mock;
  andWhere: jest.Mock;
  leftJoin: jest.Mock;
  orderBy: jest.Mock;
  getMany: jest.Mock;
}

/** Repo fake mínimo para findAll: expone un query builder chainable sobre el que se assertea. */
function makeQueryBuilderMock(result: unknown[] = []): QueryBuilderMock {
  const qb = {} as QueryBuilderMock;
  qb.where = jest.fn(() => qb);
  qb.andWhere = jest.fn(() => qb);
  qb.leftJoin = jest.fn(() => qb);
  qb.orderBy = jest.fn(() => qb);
  qb.getMany = jest.fn(async () => result);
  return qb;
}

interface PermissionsMock {
  hasAnyGlobalRole: jest.Mock;
  isProjectLeader: jest.Mock;
  canViewProject: jest.Mock;
  canManageProject: jest.Mock;
  canManageProjectTeam: jest.Mock;
}

/**
 * PermissionsService mockeado con jest.fn() por método: la lógica real de cada
 * policy ya está cubierta en auth/permissions.service.spec.ts, acá solo interesa
 * que ProjectsService la llame y respete su resultado.
 */
function makePermissions(): PermissionsMock {
  return {
    hasAnyGlobalRole: jest.fn(() => false),
    isProjectLeader: jest.fn(() => false),
    canViewProject: jest.fn(async () => false),
    canManageProject: jest.fn(() => false),
    canManageProjectTeam: jest.fn(() => false),
  };
}

function makeActivityService() {
  return {
    logEvent: jest.fn(async () => ({}) as unknown),
    getActivity: jest.fn(async () => [] as unknown[]),
  };
}

/** EntityManager fake mínimo para los métodos que usan dataSource.transaction. */
function makeManager(entities: { project: unknown }) {
  return {
    findOne: jest.fn(async () => entities.project ?? null),
    findOneBy: jest.fn(async () => entities.project ?? null),
    create: jest.fn((_entity, data) => data),
    save: jest.fn(async (entity) => entity),
  };
}

describe('ProjectsService - findAll', () => {
  let service: ProjectsService;
  let mockRepo: { createQueryBuilder: jest.Mock };
  let permissions: ReturnType<typeof makePermissions>;
  let qb: ReturnType<typeof makeQueryBuilderMock>;

  beforeEach(async () => {
    qb = makeQueryBuilderMock([]);
    mockRepo = { createQueryBuilder: jest.fn(() => qb) };
    permissions = makePermissions();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: getRepositoryToken(ProjectEntity), useValue: mockRepo },
        { provide: getRepositoryToken(ProjectMemberEntity), useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: AuthService, useValue: {} },
        { provide: PermissionsService, useValue: permissions },
        { provide: DataSource, useValue: {} },
        { provide: ProjectActivityService, useValue: makeActivityService() },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  it('excluye proyectos archivados por defecto', async () => {
    permissions.hasAnyGlobalRole.mockReturnValue(true);
    await service.findAll({}, makeUser('admin-1', [RoleName.ADMIN]));

    expect(qb.where).toHaveBeenCalledWith('project.archivedAt IS NULL');
  });

  it('incluye solo archivados cuando archived es true', async () => {
    permissions.hasAnyGlobalRole.mockReturnValue(true);
    await service.findAll({ archived: true }, makeUser('admin-1', [RoleName.ADMIN]));

    expect(qb.where).toHaveBeenCalledWith('project.archivedAt IS NOT NULL');
  });

  it('ADMIN: no agrega ningún filtro de acceso (ve todos)', async () => {
    permissions.hasAnyGlobalRole.mockReturnValue(true);
    await service.findAll({}, makeUser('admin-1', [RoleName.ADMIN]));

    expect(permissions.hasAnyGlobalRole).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-1' }),
      [RoleName.ADMIN, RoleName.PROGRAM_MANAGER],
    );
    expect(qb.leftJoin).not.toHaveBeenCalled();
  });

  it('PROGRAM_MANAGER: no agrega filtro de acceso (ve todos)', async () => {
    permissions.hasAnyGlobalRole.mockReturnValue(true);
    await service.findAll({}, makeUser('pm-1', [RoleName.PROGRAM_MANAGER]));

    expect(qb.leftJoin).not.toHaveBeenCalled();
  });

  it('resto de roles: filtra por leaderId o membership en SQL (leftJoin + andWhere), nunca en memoria', async () => {
    permissions.hasAnyGlobalRole.mockReturnValue(false);
    const user = makeUser('collab-1', [RoleName.COLLABORATOR]);
    await service.findAll({}, user);

    expect(qb.leftJoin).toHaveBeenCalledWith(
      ProjectMemberEntity,
      'membership',
      'membership.projectId = project.id AND membership.userId = :userId AND membership.removedAt IS NULL',
      { userId: 'collab-1' },
    );
    expect(qb.andWhere).toHaveBeenCalled();
  });

  it('mantiene los filtros de búsqueda existentes (status, name)', async () => {
    permissions.hasAnyGlobalRole.mockReturnValue(true);
    await service.findAll({ status: ProjectStatus.IN_PROGRESS, name: 'Alfa' }, makeUser('admin-1', [RoleName.ADMIN]));

    expect(qb.andWhere).toHaveBeenCalledWith('project.status = :status', { status: ProjectStatus.IN_PROGRESS });
    expect(qb.andWhere).toHaveBeenCalledWith('project.name ILIKE :name', { name: '%Alfa%' });
  });
});

describe('ProjectsService - findOne / getMembers / getActivity (canViewProject)', () => {
  let service: ProjectsService;
  let mockRepo: { findOne: jest.Mock };
  let mockMemberRepo: { find: jest.Mock };
  let permissions: ReturnType<typeof makePermissions>;
  let activityService: ReturnType<typeof makeActivityService>;

  beforeEach(async () => {
    mockRepo = { findOne: jest.fn() };
    mockMemberRepo = { find: jest.fn() };
    permissions = makePermissions();
    activityService = makeActivityService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: getRepositoryToken(ProjectEntity), useValue: mockRepo },
        { provide: getRepositoryToken(ProjectMemberEntity), useValue: mockMemberRepo },
        { provide: UsersService, useValue: {} },
        { provide: AuthService, useValue: {} },
        { provide: PermissionsService, useValue: permissions },
        { provide: DataSource, useValue: {} },
        { provide: ProjectActivityService, useValue: activityService },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  describe('findOne', () => {
    it('404 si no existe', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('1', makeUser('u1'))).rejects.toThrow(NotFoundException);
    });

    it('200 (devuelve el proyecto) si existe y canViewProject da true', async () => {
      const project = { id: '1', name: 'Test' };
      mockRepo.findOne.mockResolvedValue(project);
      permissions.canViewProject.mockResolvedValue(true);

      const result = await service.findOne('1', makeUser('u1'));

      expect(result).toEqual(project);
      expect(mockRepo.findOne).toHaveBeenCalledWith({ where: { id: '1' }, relations: ['leader'] });
    });

    it('403 si existe pero canViewProject da false (no confundir con 404)', async () => {
      mockRepo.findOne.mockResolvedValue({ id: '1' });
      permissions.canViewProject.mockResolvedValue(false);

      await expect(service.findOne('1', makeUser('ajeno'))).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getMembers', () => {
    it('lista miembros si canViewProject da true', async () => {
      mockRepo.findOne.mockResolvedValue({ id: '1' });
      permissions.canViewProject.mockResolvedValue(true);
      mockMemberRepo.find.mockResolvedValue([{ id: 'm1' }]);

      const result = await service.getMembers('1', makeUser('u1'));
      expect(result).toEqual([{ id: 'm1' }]);
      expect(mockMemberRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: '1', removedAt: IsNull() } }),
      );
    });

    it('403 si no tiene acceso de lectura al proyecto', async () => {
      mockRepo.findOne.mockResolvedValue({ id: '1' });
      permissions.canViewProject.mockResolvedValue(false);

      await expect(service.getMembers('1', makeUser('ajeno'))).rejects.toThrow(ForbiddenException);
      expect(mockMemberRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('getActivity', () => {
    it('delega en ProjectActivityService.getActivity si canViewProject da true', async () => {
      mockRepo.findOne.mockResolvedValue({ id: '1' });
      permissions.canViewProject.mockResolvedValue(true);
      activityService.getActivity.mockResolvedValue([{ id: 'a1' }]);

      const result = await service.getActivity('1', 20, 0, makeUser('u1'));

      expect(activityService.getActivity).toHaveBeenCalledWith('1', 20, 0);
      expect(result).toEqual([{ id: 'a1' }]);
    });

    it('403 si no tiene acceso de lectura al proyecto: no llega a pedir actividad', async () => {
      mockRepo.findOne.mockResolvedValue({ id: '1' });
      permissions.canViewProject.mockResolvedValue(false);

      await expect(service.getActivity('1', 20, 0, makeUser('ajeno'))).rejects.toThrow(ForbiddenException);
      expect(activityService.getActivity).not.toHaveBeenCalled();
    });

    it('404 si el proyecto no existe', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.getActivity('missing', 20, 0, makeUser('u1'))).rejects.toThrow(NotFoundException);
    });
  });
});

describe('ProjectsService - create', () => {
  let service: ProjectsService;
  let mockDataSource: { transaction: jest.Mock };
  let activityService: ReturnType<typeof makeActivityService>;

  beforeEach(async () => {
    mockDataSource = { transaction: jest.fn() };
    activityService = makeActivityService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: getRepositoryToken(ProjectEntity), useValue: {} },
        { provide: getRepositoryToken(ProjectMemberEntity), useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: AuthService, useValue: {} },
        { provide: PermissionsService, useValue: makePermissions() },
        { provide: DataSource, useValue: mockDataSource },
        { provide: ProjectActivityService, useValue: activityService },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  it('asigna leaderId y createdBy usando el usuario autenticado (también para ADMIN/PM, no solo PROJECT_LEADER) y audita PROJECT_CREATED', async () => {
    const manager = {
      create: jest.fn((_entity, data) => data),
      save: jest.fn(async (entity) => entity),
    };
    mockDataSource.transaction.mockImplementation((fn) => fn(manager));

    const result = await service.create({ name: 'Test' }, makeUser('user123', [RoleName.ADMIN]));

    expect(result.leaderId).toBe('user123');
    expect(result.createdBy).toBe('user123');
    expect(activityService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'user123', actionType: 'PROJECT_CREATED' }),
      manager,
    );
  });
});

describe('ProjectsService - update / archive / changeStatus (canManageProject)', () => {
  let service: ProjectsService;
  let mockDataSource: { transaction: jest.Mock };
  let permissions: ReturnType<typeof makePermissions>;
  let activityService: ReturnType<typeof makeActivityService>;

  beforeEach(async () => {
    mockDataSource = { transaction: jest.fn() };
    permissions = makePermissions();
    activityService = makeActivityService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: getRepositoryToken(ProjectEntity), useValue: {} },
        { provide: getRepositoryToken(ProjectMemberEntity), useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: AuthService, useValue: {} },
        { provide: PermissionsService, useValue: permissions },
        { provide: DataSource, useValue: mockDataSource },
        { provide: ProjectActivityService, useValue: activityService },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  describe('update', () => {
    it('permitido si canManageProject da true (ADMIN/PM en cualquiera, Lead en el propio)', async () => {
      const manager = makeManager({ project: { id: '1', leaderId: 'leader-1', name: 'Old' } });
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));
      permissions.canManageProject.mockReturnValue(true);

      const result = await service.update('1', { name: 'New' }, makeUser('leader-1', [RoleName.PROJECT_LEADER]));

      expect(result.name).toBe('New');
      expect(activityService.logEvent).toHaveBeenCalled();
    });

    it('403 si canManageProject da false (Lead ajeno, Collaborator, Observer): no guarda ni audita', async () => {
      const manager = makeManager({ project: { id: '1', leaderId: 'leader-1' } });
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));
      permissions.canManageProject.mockReturnValue(false);

      await expect(
        service.update('1', { name: 'New' }, makeUser('otro', [RoleName.PROJECT_LEADER])),
      ).rejects.toThrow(ForbiddenException);
      expect(manager.save).not.toHaveBeenCalled();
      expect(activityService.logEvent).not.toHaveBeenCalled();
    });

    it('404 si el proyecto no existe (antes de evaluar permisos)', async () => {
      const manager = makeManager({ project: null });
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));

      await expect(service.update('1', {}, makeUser('u1'))).rejects.toThrow(NotFoundException);
    });

    it('sin cambios reales: no guarda ni audita, aunque tenga permiso', async () => {
      const manager = makeManager({ project: { id: '1', leaderId: 'leader-1', name: 'Same' } });
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));
      permissions.canManageProject.mockReturnValue(true);

      const result = await service.update('1', { name: 'Same' }, makeUser('leader-1'));

      expect(result.name).toBe('Same');
      expect(manager.save).not.toHaveBeenCalled();
      expect(activityService.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('permitido: archiva un proyecto FINALIZADO y audita PROJECT_ARCHIVED', async () => {
      const manager = makeManager({ project: { id: '1', status: ProjectStatus.FINISHED, archivedAt: null } });
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));
      permissions.canManageProject.mockReturnValue(true);

      const result = await service.archive('1', makeUser('admin-1', [RoleName.ADMIN]));
      expect(result.archivedAt).not.toBeNull();
      expect(activityService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'PROJECT_ARCHIVED' }),
        manager,
      );
    });

    it('permitido: archiva un proyecto CANCELADO', async () => {
      const manager = makeManager({ project: { id: '1', status: ProjectStatus.CANCELLED, archivedAt: null } });
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));
      permissions.canManageProject.mockReturnValue(true);

      const result = await service.archive('1', makeUser('admin-1', [RoleName.ADMIN]));
      expect(result.archivedAt).not.toBeNull();
    });

    it('403 si canManageProject da false, incluso en estado archivable', async () => {
      const manager = makeManager({ project: { id: '1', status: ProjectStatus.FINISHED, archivedAt: null } });
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));
      permissions.canManageProject.mockReturnValue(false);

      await expect(service.archive('1', makeUser('collab-1', [RoleName.COLLABORATOR]))).rejects.toThrow(
        ForbiddenException,
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('404 si no existe', async () => {
      const manager = makeManager({ project: null });
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));
      await expect(service.archive('1', makeUser('u1'))).rejects.toThrow(NotFoundException);
    });

    it.each([ProjectStatus.PLANNED, ProjectStatus.IN_PROGRESS, ProjectStatus.PAUSED])(
      'BadRequestException si el proyecto está en estado %s (con permiso concedido)',
      async (status) => {
        const manager = makeManager({ project: { id: '1', status, archivedAt: null } });
        mockDataSource.transaction.mockImplementation((fn) => fn(manager));
        permissions.canManageProject.mockReturnValue(true);

        await expect(service.archive('1', makeUser('admin-1', [RoleName.ADMIN]))).rejects.toThrow(
          BadRequestException,
        );
      },
    );

    it('ya archivado: devuelve sin cambios sin volver a guardar ni auditar (con permiso concedido)', async () => {
      const date = new Date();
      const manager = makeManager({ project: { id: '1', status: ProjectStatus.FINISHED, archivedAt: date } });
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));
      permissions.canManageProject.mockReturnValue(true);

      const result = await service.archive('1', makeUser('admin-1', [RoleName.ADMIN]));
      expect(result.archivedAt).toEqual(date);
      expect(manager.save).not.toHaveBeenCalled();
      expect(activityService.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('changeStatus', () => {
    it('permitido: cambia el status y registra el historial', async () => {
      const project = { id: '1', status: ProjectStatus.PLANNED };
      const manager = makeManager({ project });
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));
      permissions.canManageProject.mockReturnValue(true);

      const result = await service.changeStatus(
        '1',
        { status: ProjectStatus.IN_PROGRESS },
        makeUser('admin-1', [RoleName.ADMIN]),
      );

      expect(result.status).toBe(ProjectStatus.IN_PROGRESS);
      expect(manager.save).toHaveBeenCalledTimes(2); // history + project
    });

    it('403 si canManageProject da false: no toca la base', async () => {
      const project = { id: '1', status: ProjectStatus.PLANNED };
      const manager = makeManager({ project });
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));
      permissions.canManageProject.mockReturnValue(false);

      await expect(
        service.changeStatus('1', { status: ProjectStatus.IN_PROGRESS }, makeUser('observer-1', [RoleName.OBSERVER])),
      ).rejects.toThrow(ForbiddenException);
      expect(manager.save).not.toHaveBeenCalled();
    });
  });
});

describe('ProjectsService - Members (canManageProjectTeam)', () => {
  let service: ProjectsService;
  let mockDataSource: { transaction: jest.Mock };
  let mockUsersService: { findById: jest.Mock };
  let permissions: ReturnType<typeof makePermissions>;
  let activityService: ReturnType<typeof makeActivityService>;

  function makeMemberManager(project: unknown, existingOrMember: unknown = null) {
    return {
      findOneBy: jest.fn(async () => project),
      findOne: jest.fn(async () => existingOrMember),
      create: jest.fn((_entity, data) => data),
      save: jest.fn(async (entity) => entity),
    };
  }

  beforeEach(async () => {
    mockDataSource = { transaction: jest.fn() };
    mockUsersService = { findById: jest.fn() };
    permissions = makePermissions();
    activityService = makeActivityService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: getRepositoryToken(ProjectEntity), useValue: {} },
        { provide: getRepositoryToken(ProjectMemberEntity), useValue: {} },
        { provide: UsersService, useValue: mockUsersService },
        { provide: AuthService, useValue: {} },
        { provide: PermissionsService, useValue: permissions },
        { provide: DataSource, useValue: mockDataSource },
        { provide: ProjectActivityService, useValue: activityService },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  describe('addMember', () => {
    it('permitido: agrega un miembro válido y audita MEMBER_ADDED', async () => {
      const manager = makeMemberManager({ id: '1', leaderId: 'leader1' }, null);
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));
      permissions.canManageProjectTeam.mockReturnValue(true);
      mockUsersService.findById.mockResolvedValue({ id: 'u1', name: 'Ana' });

      const result = await service.addMember(
        '1',
        { userId: 'u1', projectRole: 'COLLABORATOR' as never },
        makeUser('leader1', [RoleName.PROJECT_LEADER]),
      );
      expect(result.userId).toBe('u1');
      expect(activityService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'MEMBER_ADDED' }),
        manager,
      );
    });

    it('403 si canManageProjectTeam da false', async () => {
      const manager = makeMemberManager({ id: '1', leaderId: 'leader1' });
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));
      permissions.canManageProjectTeam.mockReturnValue(false);

      await expect(
        service.addMember('1', { userId: 'u1', projectRole: 'COLLABORATOR' as never }, makeUser('other')),
      ).rejects.toThrow(ForbiddenException);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('ConflictException si el miembro ya existe', async () => {
      const manager = makeMemberManager({ id: '1', leaderId: 'leader1' }, { id: 'm1' });
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));
      permissions.canManageProjectTeam.mockReturnValue(true);
      mockUsersService.findById.mockResolvedValue({ id: 'u1' });

      await expect(
        service.addMember('1', { userId: 'u1', projectRole: 'COLLABORATOR' as never }, makeUser('leader1')),
      ).rejects.toThrow(ConflictException);
    });

    it('NotFoundException si el usuario no existe', async () => {
      const manager = makeMemberManager({ id: '1', leaderId: 'leader1' });
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));
      permissions.canManageProjectTeam.mockReturnValue(true);
      mockUsersService.findById.mockResolvedValue(null);

      await expect(
        service.addMember('1', { userId: 'u1', projectRole: 'COLLABORATOR' as never }, makeUser('leader1')),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMemberRole', () => {
    it('403 si canManageProjectTeam da false', async () => {
      const manager = makeMemberManager({ id: '1', leaderId: 'leader1' });
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));
      permissions.canManageProjectTeam.mockReturnValue(false);

      await expect(
        service.updateMemberRole('1', 'm1', { projectRole: 'OBSERVER' as never }, makeUser('other')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('permitido: actualiza el rol del miembro y audita MEMBER_ROLE_CHANGED', async () => {
      const manager = makeMemberManager(
        { id: '1', leaderId: 'leader1' },
        { id: 'm1', userId: 'u1', projectRole: 'COLLABORATOR' },
      );
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));
      permissions.canManageProjectTeam.mockReturnValue(true);

      const result = await service.updateMemberRole(
        '1',
        'm1',
        { projectRole: 'OBSERVER' as never },
        makeUser('leader1', [RoleName.PROJECT_LEADER]),
      );
      expect(result.projectRole).toBe('OBSERVER');
      expect(activityService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'MEMBER_ROLE_CHANGED' }),
        manager,
      );
    });

    it('NotFoundException si el miembro no existe', async () => {
      const manager = makeMemberManager({ id: '1', leaderId: 'leader1' }, null);
      mockDataSource.transaction.mockImplementation((fn) => fn(manager));
      permissions.canManageProjectTeam.mockReturnValue(true);

      await expect(
        service.updateMemberRole('1', 'missing', { projectRole: 'OBSERVER' as never }, makeUser('leader1')),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

describe('ProjectsService - changeLeader', () => {
  let service: ProjectsService;
  let mockDataSource: { transaction: jest.Mock };
  let mockUsersService: { findById: jest.Mock };
  let mockAuthService: { getRoleNames: jest.Mock };
  let activityService: ReturnType<typeof makeActivityService>;

  beforeEach(async () => {
    mockDataSource = { transaction: jest.fn() };
    mockUsersService = { findById: jest.fn() };
    mockAuthService = { getRoleNames: jest.fn() };
    activityService = makeActivityService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: getRepositoryToken(ProjectEntity), useValue: {} },
        { provide: getRepositoryToken(ProjectMemberEntity), useValue: {} },
        { provide: UsersService, useValue: mockUsersService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: PermissionsService, useValue: makePermissions() },
        { provide: DataSource, useValue: mockDataSource },
        { provide: ProjectActivityService, useValue: activityService },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  // La autorización de QUIÉN puede llamar a este endpoint (solo ADMIN/PROGRAM_MANAGER)
  // la resuelve @Roles(...)+RolesGuard en el controller, no el service — por eso acá
  // no hay casos de "Lead/Collaborator/Observer -> 403": esos ya no llegan al service.

  it('proyecto inexistente -> NotFoundException', async () => {
    mockDataSource.transaction.mockImplementation((fn) => fn(makeManager({ project: null })));

    await expect(
      service.changeLeader('missing', { newLeaderId: 'u2' }, makeUser('pm-1', [RoleName.PROGRAM_MANAGER])),
    ).rejects.toThrow(NotFoundException);
  });

  it('nuevo líder inexistente -> NotFoundException, no escribe nada', async () => {
    const manager = makeManager({ project: { id: '1', leaderId: 'old-leader' } });
    mockDataSource.transaction.mockImplementation((fn) => fn(manager));
    mockUsersService.findById.mockResolvedValue(null);

    await expect(
      service.changeLeader('1', { newLeaderId: 'missing' }, makeUser('pm-1', [RoleName.PROGRAM_MANAGER])),
    ).rejects.toThrow(NotFoundException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('nuevo líder inactivo -> BadRequestException, no escribe nada', async () => {
    const manager = makeManager({ project: { id: '1', leaderId: 'old-leader' } });
    mockDataSource.transaction.mockImplementation((fn) => fn(manager));
    mockUsersService.findById.mockResolvedValue({ id: 'u2', active: false, deletedAt: null });

    await expect(
      service.changeLeader('1', { newLeaderId: 'u2' }, makeUser('pm-1', [RoleName.PROGRAM_MANAGER])),
    ).rejects.toThrow(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('nuevo líder sin rol PROJECT_LEADER -> BadRequestException, no escribe nada', async () => {
    const manager = makeManager({ project: { id: '1', leaderId: 'old-leader' } });
    mockDataSource.transaction.mockImplementation((fn) => fn(manager));
    mockUsersService.findById.mockResolvedValue({ id: 'u2', active: true, deletedAt: null });
    mockAuthService.getRoleNames.mockResolvedValue([RoleName.COLLABORATOR]);

    await expect(
      service.changeLeader('1', { newLeaderId: 'u2' }, makeUser('pm-1', [RoleName.PROGRAM_MANAGER])),
    ).rejects.toThrow(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('caso válido: actualiza leaderId y audita PROJECT_LEADER_CHANGED', async () => {
    const project = { id: '1', leaderId: 'old-leader' };
    const manager = makeManager({ project });
    mockDataSource.transaction.mockImplementation((fn) => fn(manager));
    mockUsersService.findById.mockResolvedValue({ id: 'u2', active: true, deletedAt: null });
    mockAuthService.getRoleNames.mockResolvedValue([RoleName.PROJECT_LEADER]);

    const result = await service.changeLeader('1', { newLeaderId: 'u2' }, makeUser('admin-1', [RoleName.ADMIN]));

    expect(result.leaderId).toBe('u2');
    expect(activityService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'PROJECT_LEADER_CHANGED',
        metadata: { previousLeaderId: 'old-leader', newLeaderId: 'u2' },
      }),
      manager,
    );
  });

  it('nuevo líder === líder actual: no-op, no escribe ni audita', async () => {
    const project = { id: '1', leaderId: 'u2' };
    const manager = makeManager({ project });
    mockDataSource.transaction.mockImplementation((fn) => fn(manager));
    mockUsersService.findById.mockResolvedValue({ id: 'u2', active: true, deletedAt: null });
    mockAuthService.getRoleNames.mockResolvedValue([RoleName.PROJECT_LEADER]);

    const result = await service.changeLeader('1', { newLeaderId: 'u2' }, makeUser('admin-1', [RoleName.ADMIN]));

    expect(result.leaderId).toBe('u2');
    expect(manager.save).not.toHaveBeenCalled();
    expect(activityService.logEvent).not.toHaveBeenCalled();
  });

  it('el proyecto nunca queda con leaderId null: el objeto guardado siempre trae un leaderId string', async () => {
    const project = { id: '1', leaderId: 'old-leader' };
    const manager = makeManager({ project });
    mockDataSource.transaction.mockImplementation((fn) => fn(manager));
    mockUsersService.findById.mockResolvedValue({ id: 'u2', active: true, deletedAt: null });
    mockAuthService.getRoleNames.mockResolvedValue([RoleName.PROJECT_LEADER]);

    await service.changeLeader('1', { newLeaderId: 'u2' }, makeUser('admin-1', [RoleName.ADMIN]));

    const savedProject = manager.save.mock.calls.find((call) => (call[0] as { id?: string }).id === '1')?.[0] as {
      leaderId: string;
    };
    expect(savedProject.leaderId).toBeTruthy();
  });
});
