import { ForbiddenException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PermissionsService } from '../auth/permissions.service';
import { RoleName } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';

function makeUser(id: string, roles: RoleName[] = []): RequestUser {
  return { id, roles } as RequestUser;
}

describe('UsersController', () => {
  let usersService: {
    findAllWithRoles: jest.Mock;
    findOneWithRoles: jest.Mock;
    setActive: jest.Mock;
    assignRole: jest.Mock;
    removeRole: jest.Mock;
  };
  let permissions: { canViewUsers: jest.Mock };
  let controller: UsersController;

  beforeEach(() => {
    usersService = {
      findAllWithRoles: jest.fn(async () => []),
      findOneWithRoles: jest.fn(async () => ({})),
      setActive: jest.fn(async () => ({})),
      assignRole: jest.fn(async () => ({})),
      removeRole: jest.fn(async () => ({})),
    };
    permissions = { canViewUsers: jest.fn(() => true) };

    controller = new UsersController(usersService as unknown as UsersService, permissions as unknown as PermissionsService);
  });

  describe('findAll', () => {
    it('delega en el service si canViewUsers da true', async () => {
      const user = makeUser('admin-1', [RoleName.ADMIN]);
      await controller.findAll({}, user);
      expect(usersService.findAllWithRoles).toHaveBeenCalledWith({});
    });

    it('403 si canViewUsers da false (ej. PROJECT_LEADER/COLLABORATOR/OBSERVER)', async () => {
      permissions.canViewUsers.mockReturnValue(false);
      const user = makeUser('leader-1', [RoleName.PROJECT_LEADER]);

      await expect(controller.findAll({}, user)).rejects.toThrow(ForbiddenException);
      expect(usersService.findAllWithRoles).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('403 si canViewUsers da false', async () => {
      permissions.canViewUsers.mockReturnValue(false);
      await expect(controller.findOne('target-1', makeUser('collab-1', [RoleName.COLLABORATOR]))).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('updateStatus / assignRole / removeRole', () => {
    // La autorización fina (self-check, ADMIN-only, excepción de PM) vive en
    // UsersService (vía PermissionsService) — acá solo se verifica que el
    // controller delega con los parámetros correctos, sin lógica propia.
    it('updateStatus delega en usersService.setActive', async () => {
      const user = makeUser('admin-1', [RoleName.ADMIN]);
      await controller.updateStatus('target-1', { active: false }, user);
      expect(usersService.setActive).toHaveBeenCalledWith('target-1', false, user);
    });

    it('assignRole delega en usersService.assignRole', async () => {
      const user = makeUser('pm-1', [RoleName.PROGRAM_MANAGER]);
      await controller.assignRole('target-1', { role: RoleName.PROJECT_LEADER }, user);
      expect(usersService.assignRole).toHaveBeenCalledWith('target-1', RoleName.PROJECT_LEADER, user);
    });

    it('removeRole delega en usersService.removeRole', async () => {
      const user = makeUser('admin-1', [RoleName.ADMIN]);
      await controller.removeRole('target-1', RoleName.PROJECT_LEADER, user);
      expect(usersService.removeRole).toHaveBeenCalledWith('target-1', RoleName.PROJECT_LEADER, user);
    });
  });
});
