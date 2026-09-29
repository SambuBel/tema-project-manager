import { PermissionsService } from './permissions.service';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { ProjectEntity } from '../projects/project.entity';
import { ProjectMemberRole, RoleName } from '../database/enums';
import { RequestUser } from './types/authenticated-request-user';

function makeUser(roles: RoleName[], id = 'user-1'): RequestUser {
  return { id, roles } as RequestUser;
}

function makeProject(leaderId: string, id = 'project-1'): ProjectEntity {
  return { id, leaderId } as ProjectEntity;
}

describe('PermissionsService', () => {
  let membersRepo: { findOne: jest.Mock };
  let service: PermissionsService;

  beforeEach(() => {
    membersRepo = { findOne: jest.fn(async () => null) };
    service = new PermissionsService(membersRepo as unknown as import('typeorm').Repository<ProjectMemberEntity>);
  });

  describe('hasAnyGlobalRole', () => {
    it('true si el usuario tiene alguno de los roles pedidos', () => {
      expect(service.hasAnyGlobalRole(makeUser([RoleName.COLLABORATOR, RoleName.ADMIN]), [RoleName.ADMIN])).toBe(true);
    });

    it('false si no tiene ninguno', () => {
      expect(service.hasAnyGlobalRole(makeUser([RoleName.OBSERVER]), [RoleName.ADMIN, RoleName.PROGRAM_MANAGER])).toBe(
        false,
      );
    });

    it('multi-rol: ADMIN + PROGRAM_MANAGER conserva ambos permisos', () => {
      const user = makeUser([RoleName.ADMIN, RoleName.PROGRAM_MANAGER]);
      expect(service.hasAnyGlobalRole(user, [RoleName.ADMIN])).toBe(true);
      expect(service.hasAnyGlobalRole(user, [RoleName.PROGRAM_MANAGER])).toBe(true);
    });
  });

  describe('isProjectLeader', () => {
    it('true si project.leaderId === user.id', () => {
      const user = makeUser([RoleName.PROJECT_LEADER], 'leader-1');
      expect(service.isProjectLeader(user, makeProject('leader-1'))).toBe(true);
    });

    it('false si es otro usuario, aunque tenga el rol global PROJECT_LEADER', () => {
      const user = makeUser([RoleName.PROJECT_LEADER], 'user-2');
      expect(service.isProjectLeader(user, makeProject('leader-1'))).toBe(false);
    });
  });

  describe('canViewProject', () => {
    it('ADMIN ve cualquier proyecto sin ser miembro', async () => {
      const user = makeUser([RoleName.ADMIN], 'admin-1');
      await expect(service.canViewProject(user, makeProject('otro'))).resolves.toBe(true);
      expect(membersRepo.findOne).not.toHaveBeenCalled();
    });

    it('PROGRAM_MANAGER ve cualquier proyecto sin ser miembro', async () => {
      const user = makeUser([RoleName.PROGRAM_MANAGER], 'pm-1');
      await expect(service.canViewProject(user, makeProject('otro'))).resolves.toBe(true);
    });

    it('el líder del proyecto lo ve', async () => {
      const user = makeUser([RoleName.PROJECT_LEADER], 'leader-1');
      await expect(service.canViewProject(user, makeProject('leader-1'))).resolves.toBe(true);
    });

    it('COLLABORATOR con membership ve el proyecto', async () => {
      membersRepo.findOne.mockResolvedValue({ projectRole: ProjectMemberRole.COLLABORATOR } as ProjectMemberEntity);
      const user = makeUser([RoleName.COLLABORATOR], 'collab-1');
      await expect(service.canViewProject(user, makeProject('leader-1'))).resolves.toBe(true);
    });

    it('OBSERVER con membership ve el proyecto', async () => {
      membersRepo.findOne.mockResolvedValue({ projectRole: ProjectMemberRole.OBSERVER } as ProjectMemberEntity);
      const user = makeUser([RoleName.OBSERVER], 'obs-1');
      await expect(service.canViewProject(user, makeProject('leader-1'))).resolves.toBe(true);
    });

    it('sin membership ni ser líder/admin/PM -> false', async () => {
      membersRepo.findOne.mockResolvedValue(null);
      const user = makeUser([RoleName.COLLABORATOR], 'ajeno-1');
      await expect(service.canViewProject(user, makeProject('leader-1'))).resolves.toBe(false);
    });
  });

  describe('canManageProject / canManageProjectTeam', () => {
    it('ADMIN administra cualquier proyecto', () => {
      const user = makeUser([RoleName.ADMIN], 'admin-1');
      expect(service.canManageProject(user, makeProject('otro'))).toBe(true);
      expect(service.canManageProjectTeam(user, makeProject('otro'))).toBe(true);
    });

    it('PROGRAM_MANAGER administra cualquier proyecto', () => {
      const user = makeUser([RoleName.PROGRAM_MANAGER], 'pm-1');
      expect(service.canManageProject(user, makeProject('otro'))).toBe(true);
    });

    it('el líder administra el proyecto que lidera', () => {
      const user = makeUser([RoleName.PROJECT_LEADER], 'leader-1');
      expect(service.canManageProject(user, makeProject('leader-1'))).toBe(true);
    });

    it('PROJECT_LEADER global NO alcanza para administrar un proyecto ajeno', () => {
      const user = makeUser([RoleName.PROJECT_LEADER], 'leader-2');
      expect(service.canManageProject(user, makeProject('leader-1'))).toBe(false);
    });

    it('COLLABORATOR nunca administra, aunque sea miembro', () => {
      const user = makeUser([RoleName.COLLABORATOR], 'collab-1');
      expect(service.canManageProject(user, makeProject('leader-1'))).toBe(false);
    });

    it('OBSERVER nunca administra', () => {
      const user = makeUser([RoleName.OBSERVER], 'obs-1');
      expect(service.canManageProject(user, makeProject('leader-1'))).toBe(false);
    });
  });

  describe('económicos (preparados, sin endpoints todavía)', () => {
    it('canDefineBudget: solo ADMIN/PROGRAM_MANAGER, ni el líder', () => {
      expect(service.canDefineBudget(makeUser([RoleName.ADMIN]))).toBe(true);
      expect(service.canDefineBudget(makeUser([RoleName.PROGRAM_MANAGER]))).toBe(true);
      expect(service.canDefineBudget(makeUser([RoleName.PROJECT_LEADER]))).toBe(false);
    });

    it('canManageCosts: PROJECT_LEADER solo en el proyecto que lidera', () => {
      const leader = makeUser([RoleName.PROJECT_LEADER], 'leader-1');
      expect(service.canManageCosts(leader, makeProject('leader-1'))).toBe(true);
      expect(service.canManageCosts(leader, makeProject('otro'))).toBe(false);
    });

    it('canViewEconomicData: COLLABORATOR y OBSERVER nunca', () => {
      expect(service.canViewEconomicData(makeUser([RoleName.COLLABORATOR]), makeProject('leader-1'))).toBe(false);
      expect(service.canViewEconomicData(makeUser([RoleName.OBSERVER]), makeProject('leader-1'))).toBe(false);
    });

    it('canViewEconomicData: ADMIN/PROGRAM_MANAGER en cualquier proyecto', () => {
      expect(service.canViewEconomicData(makeUser([RoleName.ADMIN]), makeProject('otro'))).toBe(true);
    });
  });
});
