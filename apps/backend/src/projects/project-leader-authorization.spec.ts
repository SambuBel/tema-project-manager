import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ForbiddenException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectEntity } from './project.entity';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { ProjectMemberRole, ProjectStatus, RoleName } from '../database/enums';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';
import { PermissionsService } from '../auth/permissions.service';
import { ProjectActivityService } from './project-activity.service';
import { RequestUser } from '../auth/types/authenticated-request-user';

/**
 * Líder REAL = rol global PROJECT_LEADER Y project.leaderId === user.id. Se usa el
 * PermissionsService REAL: lo que se prueba es que un leaderId histórico sin el rol NO dé permisos.
 */
const USER_ID = 'u1';
const project = (overrides: Partial<ProjectEntity> = {}) =>
  ({ id: 'p1', name: 'P', leaderId: USER_ID, status: ProjectStatus.FINISHED, archivedAt: null, ...overrides }) as ProjectEntity;
const user = (roles: RoleName[], id = USER_ID): RequestUser => ({ id, roles }) as RequestUser;

describe('ProjectsService - líder real vs leaderId histórico', () => {
  let service: ProjectsService;
  let current: ProjectEntity;
  let manager: Record<string, jest.Mock>;
  let memberRepo: { find: jest.Mock; findOne: jest.Mock };

  beforeEach(async () => {
    current = project();
    manager = {
      findOne: jest.fn(async (entity: unknown) => (entity === ProjectEntity ? current : null)),
      findOneBy: jest.fn(async () => current),
      create: jest.fn((_e, data) => data),
      save: jest.fn(async (e) => e),
    };
    memberRepo = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: getRepositoryToken(ProjectEntity), useValue: { findOne: jest.fn(async () => current) } },
        { provide: getRepositoryToken(ProjectMemberEntity), useValue: memberRepo },
        { provide: UsersService, useValue: { findById: jest.fn(async (id: string) => ({ id, name: 'X' })), findByEmail: jest.fn() } },
        { provide: AuthService, useValue: {} },
        { provide: PermissionsService, useFactory: () => new PermissionsService(memberRepo as never) },
        {
          provide: DataSource,
          useValue: { transaction: jest.fn((fn) => fn(manager)), getRepository: jest.fn(() => ({ find: jest.fn(async () => []) })) },
        },
        { provide: ProjectActivityService, useValue: { logEvent: jest.fn() } },
      ],
    }).compile();
    service = module.get(ProjectsService);
  });

  const writes = (actor: RequestUser) => ({
    editar: () => service.update('p1', { name: 'Nuevo' }, actor),
    estado: () => service.changeStatus('p1', { status: ProjectStatus.IN_PROGRESS }, actor),
    archivar: () => service.archive('p1', actor),
    agregarMiembro: () => service.addMember('p1', { userId: 'x', projectRole: ProjectMemberRole.OBSERVER }, actor),
    invitar: () => service.inviteMember('p1', { email: 'a@gmail.com', name: 'A', projectRole: ProjectMemberRole.OBSERVER }, actor),
    cancelarInvitacion: () => service.revokeInvitation('p1', 'inv', actor),
    verInvitaciones: () => service.getPendingInvitations('p1', actor),
    cambiarRolMiembro: () => service.updateMemberRole('p1', 'm1', { projectRole: ProjectMemberRole.OBSERVER }, actor),
    quitarMiembro: () => service.removeMember('p1', 'm1', actor),
  });

  describe.each([
    ['COLLABORATOR (rol local COLLABORATOR) con leaderId histórico', [RoleName.COLLABORATOR], ProjectMemberRole.COLLABORATOR],
    ['OBSERVER (rol local OBSERVER) con leaderId histórico', [RoleName.OBSERVER], ProjectMemberRole.OBSERVER],
  ])('%s', (_label, roles, localRole) => {
    beforeEach(() => {
      memberRepo.findOne.mockResolvedValue({ projectRole: localRole });
    });

    it('puede VER el proyecto (miembros) pero NINGUNA acción de líder: todo 403 y no escribe', async () => {
      await expect(service.getMembers('p1', user(roles))).resolves.toEqual([]);

      for (const [, action] of Object.entries(writes(user(roles)))) {
        await expect(action()).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  it('PROJECT_LEADER con leaderId propio: edita, cambia estado, archiva y administra el equipo', async () => {
    const actor = user([RoleName.PROJECT_LEADER]);
    await expect(writes(actor).editar()).resolves.toBeDefined();
    await expect(writes(actor).estado()).resolves.toBeDefined();
    current = project({ status: ProjectStatus.FINISHED });
    await expect(writes(actor).archivar()).resolves.toBeDefined();
    await expect(writes(actor).agregarMiembro()).resolves.toBeDefined();
    await expect(writes(actor).verInvitaciones()).resolves.toBeDefined();
  });

  it('PROJECT_LEADER que NO es el leaderId (y sin membership): no administra ni ve nada de este proyecto', async () => {
    const actor = user([RoleName.PROJECT_LEADER], 'otro');
    for (const [, action] of Object.entries(writes(actor))) {
      await expect(action()).rejects.toBeInstanceOf(ForbiddenException);
    }
    await expect(service.getMembers('p1', actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ['ADMIN', [RoleName.ADMIN]],
    ['PROGRAM_MANAGER', [RoleName.PROGRAM_MANAGER]],
  ])('%s sin PROJECT_LEADER y con leaderId ajeno: administra igual (bypass intacto)', async (_label, roles) => {
    const actor = user(roles, 'boss');
    await expect(writes(actor).editar()).resolves.toBeDefined();
    await expect(writes(actor).agregarMiembro()).resolves.toBeDefined();
    await expect(writes(actor).verInvitaciones()).resolves.toBeDefined();
  });
});
