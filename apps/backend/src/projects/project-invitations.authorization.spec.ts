import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectEntity } from './project.entity';
import { ProjectInvitationEntity } from './project-invitation.entity';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { ProjectMemberRole, RoleName } from '../database/enums';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';
import { PermissionsService } from '../auth/permissions.service';
import { ProjectActivityService } from './project-activity.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { InviteProjectMemberDto } from './invite-project-member.dto';

/**
 * Usa el PermissionsService REAL (no mockeado) a propósito: acá importa demostrar que la
 * regla "administrar equipo" (ADMIN / PM / líder real de ESE proyecto) protege las
 * invitaciones, incluido el aislamiento entre proyectos.
 */
const PROJECT_A = { id: 'project-a', leaderId: 'leader-a' } as ProjectEntity;
const PROJECT_B = { id: 'project-b', leaderId: 'leader-b' } as ProjectEntity;

const user = (id: string, roles: RoleName[]): RequestUser => ({ id, roles }) as RequestUser;

const admin = user('admin', [RoleName.ADMIN]);
const pm = user('pm', [RoleName.PROGRAM_MANAGER]);
const leaderOfA = user('leader-a', [RoleName.PROJECT_LEADER]);
const leaderOfB = user('leader-b', [RoleName.PROJECT_LEADER]);
// Rol global PROJECT_LEADER pero NO es leaderId ni de A ni de B.
const foreignLeader = user('foreign-leader', [RoleName.PROJECT_LEADER]);
// Miembro COLLABORATOR de A.
const collaborator = user('collab', [RoleName.COLLABORATOR]);
const observer = user('observer', [RoleName.OBSERVER]);

describe('ProjectsService - invitaciones (autorización)', () => {
  let service: ProjectsService;
  let invitationsFind: jest.Mock;
  let manager: { findOneBy: jest.Mock; findOne: jest.Mock; create: jest.Mock; save: jest.Mock; getRepository: jest.Mock; remove?: jest.Mock };

  const projects: Record<string, ProjectEntity> = { [PROJECT_A.id]: PROJECT_A, [PROJECT_B.id]: PROJECT_B };

  beforeEach(async () => {
    invitationsFind = jest.fn(async () => [{ id: 'inv-1', email: 'x@gmail.com' }]);
    manager = {
      findOneBy: jest.fn(async (_entity, where: { id: string }) => projects[where.id] ?? null),
      findOne: jest.fn(async () => null),
      create: jest.fn((_entity, data) => data),
      save: jest.fn(async (entity) => entity),
      getRepository: jest.fn(),
    };
    const dataSource = {
      transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)),
      getRepository: jest.fn(() => ({ find: invitationsFind })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        PermissionsService,
        {
          provide: getRepositoryToken(ProjectEntity),
          useValue: { findOne: jest.fn(async ({ where }: { where: { id: string } }) => projects[where.id] ?? null) },
        },
        { provide: getRepositoryToken(ProjectMemberEntity), useValue: { findOne: jest.fn(async () => null) } },
        { provide: UsersService, useValue: { findByEmail: jest.fn(async () => null) } },
        { provide: AuthService, useValue: {} },
        { provide: DataSource, useValue: dataSource },
        { provide: ProjectActivityService, useValue: { logEvent: jest.fn() } },
      ],
    }).compile();

    service = module.get(ProjectsService);
  });

  describe('GET invitations (getPendingInvitations)', () => {
    it.each([
      ['ADMIN', admin],
      ['PROGRAM_MANAGER', pm],
      ['líder real del proyecto', leaderOfA],
    ])('%s: permitido', async (_label, actor) => {
      await expect(service.getPendingInvitations(PROJECT_A.id, actor)).resolves.toHaveLength(1);
      expect(invitationsFind).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: PROJECT_A.id, status: 'PENDING' } }));
    });

    it.each([
      ['PROJECT_LEADER ajeno (rol global, no es leaderId)', foreignLeader],
      ['COLLABORATOR', collaborator],
      ['OBSERVER', observer],
    ])('%s: 403 y no consulta invitaciones', async (_label, actor) => {
      await expect(service.getPendingInvitations(PROJECT_A.id, actor)).rejects.toBeInstanceOf(ForbiddenException);
      expect(invitationsFind).not.toHaveBeenCalled();
    });

    it('404 si el proyecto no existe', async () => {
      await expect(service.getPendingInvitations('nope', admin)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('aislamiento: el líder de A ve A (200) pero NO B (403)', async () => {
      await expect(service.getPendingInvitations(PROJECT_A.id, leaderOfA)).resolves.toBeDefined();
      await expect(service.getPendingInvitations(PROJECT_B.id, leaderOfA)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('aislamiento: un COLLABORATOR miembro de A recibe 403 tanto en A como en B', async () => {
      await expect(service.getPendingInvitations(PROJECT_A.id, collaborator)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.getPendingInvitations(PROJECT_B.id, collaborator)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ADMIN y PM: 200 en cualquier proyecto', async () => {
      for (const actor of [admin, pm]) {
        await expect(service.getPendingInvitations(PROJECT_A.id, actor)).resolves.toBeDefined();
        await expect(service.getPendingInvitations(PROJECT_B.id, actor)).resolves.toBeDefined();
      }
    });
  });

  describe('POST invitations (inviteMember)', () => {
    const dto: InviteProjectMemberDto = { email: 'nuevo@gmail.com', name: 'Nuevo', projectRole: ProjectMemberRole.COLLABORATOR };

    it.each([
      ['ADMIN', admin],
      ['PROGRAM_MANAGER', pm],
      ['líder real', leaderOfA],
    ])('%s: puede invitar', async (_label, actor) => {
      await expect(service.inviteMember(PROJECT_A.id, dto, actor)).resolves.toMatchObject({ projectId: PROJECT_A.id });
      expect(manager.save).toHaveBeenCalled();
    });

    it.each([
      ['PROJECT_LEADER ajeno', foreignLeader],
      ['COLLABORATOR', collaborator],
      ['OBSERVER', observer],
    ])('%s: 403 y no guarda', async (_label, actor) => {
      await expect(service.inviteMember(PROJECT_A.id, dto, actor)).rejects.toBeInstanceOf(ForbiddenException);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('aislamiento: el líder de B no puede invitar a A', async () => {
      await expect(service.inviteMember(PROJECT_A.id, dto, leaderOfB)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('DELETE invitations (revokeInvitation)', () => {
    it.each([
      ['ADMIN', admin],
      ['PROGRAM_MANAGER', pm],
      ['líder real', leaderOfA],
    ])('%s: puede cancelar una invitación pendiente', async (_label, actor) => {
      const invitation = { id: 'inv-1', projectId: PROJECT_A.id, status: 'PENDING' };
      manager.findOne.mockResolvedValue(invitation);
      manager.remove = jest.fn(async (entity) => entity);

      await expect(service.revokeInvitation(PROJECT_A.id, 'inv-1', actor)).resolves.toBeUndefined();
      expect(manager.remove).toHaveBeenCalledWith(invitation);
    });

    it.each([
      ['PROJECT_LEADER ajeno', foreignLeader],
      ['COLLABORATOR', collaborator],
      ['OBSERVER', observer],
    ])('%s: 403 y no toca nada', async (_label, actor) => {
      manager.remove = jest.fn();
      await expect(service.revokeInvitation(PROJECT_A.id, 'inv-1', actor)).rejects.toBeInstanceOf(ForbiddenException);
      expect(manager.findOne).not.toHaveBeenCalled();
      expect(manager.remove).not.toHaveBeenCalled();
    });

    it('aislamiento: el líder de A no cancela invitaciones de B', async () => {
      manager.remove = jest.fn();
      await expect(service.revokeInvitation(PROJECT_B.id, 'inv-1', leaderOfA)).rejects.toBeInstanceOf(ForbiddenException);
      expect(manager.remove).not.toHaveBeenCalled();
    });

    it('invitación inexistente o ya no pendiente (acotada por projectId): 404', async () => {
      manager.remove = jest.fn();
      await expect(service.revokeInvitation(PROJECT_A.id, 'inv-x', admin)).rejects.toBeInstanceOf(NotFoundException);
      expect(manager.findOne).toHaveBeenCalledWith(
        ProjectInvitationEntity,
        expect.objectContaining({ where: { id: 'inv-x', projectId: PROJECT_A.id, status: 'PENDING' } }),
      );
      expect(manager.remove).not.toHaveBeenCalled();
    });
  });

  describe('POST invitations: persiste el nombre del invitado', () => {
    it('guarda name junto al email y el rol', async () => {
      await service.inviteMember(PROJECT_A.id, { email: 'nuevo@gmail.com', name: 'Nuevo Nombre', projectRole: ProjectMemberRole.OBSERVER }, admin);
      expect(manager.create).toHaveBeenCalledWith(
        ProjectInvitationEntity,
        expect.objectContaining({ email: 'nuevo@gmail.com', name: 'Nuevo Nombre', projectRole: ProjectMemberRole.OBSERVER }),
      );
    });
  });

  describe('test-accept (testAcceptInvitation)', () => {
    it('usuario sin permiso sobre ESE proyecto: 403 y no toca invitaciones, usuarios ni miembros', async () => {
      await expect(service.testAcceptInvitation(PROJECT_A.id, 'inv-1', collaborator)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.testAcceptInvitation(PROJECT_A.id, 'inv-1', foreignLeader)).rejects.toBeInstanceOf(ForbiddenException);
      expect(manager.findOne).not.toHaveBeenCalled();
      expect(manager.getRepository).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('aislamiento: el líder de A no puede aceptar invitaciones de B', async () => {
      await expect(service.testAcceptInvitation(PROJECT_B.id, 'inv-1', leaderOfA)).rejects.toBeInstanceOf(ForbiddenException);
      expect(manager.getRepository).not.toHaveBeenCalled();
    });

    it('404 si el proyecto no existe', async () => {
      await expect(service.testAcceptInvitation('nope', 'inv-1', admin)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('con permiso y sin invitación pendiente de ese proyecto: 404 (la búsqueda va acotada por projectId)', async () => {
      await expect(service.testAcceptInvitation(PROJECT_A.id, 'inv-1', leaderOfA)).rejects.toBeInstanceOf(NotFoundException);
      expect(manager.findOne).toHaveBeenCalledWith(
        ProjectInvitationEntity,
        expect.objectContaining({ where: { id: 'inv-1', projectId: PROJECT_A.id, status: 'PENDING' } }),
      );
    });
  });
});
