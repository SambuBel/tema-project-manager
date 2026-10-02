import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PermissionsService } from '../auth/permissions.service';
import { RoleName } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';

function makeUser(id: string, roles: RoleName[] = []): RequestUser {
  return { id, roles } as RequestUser;
}

function makeQueryBuilder(result: unknown[] = []) {
  const qb = {} as Record<string, jest.Mock>;
  qb.leftJoin = jest.fn(() => qb);
  qb.innerJoin = jest.fn(() => qb);
  qb.select = jest.fn(() => qb);
  qb.addSelect = jest.fn(() => qb);
  qb.where = jest.fn(() => qb);
  qb.andWhere = jest.fn(() => qb);
  qb.orderBy = jest.fn(() => qb);
  qb.getMany = jest.fn(async () => result);
  qb.getRawMany = jest.fn(async () => result);
  return qb;
}

describe('UsersService', () => {
  let usersRepo: { findOneBy: jest.Mock; save: jest.Mock; createQueryBuilder: jest.Mock };
  let rolesRepo: { findOneBy: jest.Mock };
  let userRolesRepo: {
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let permissions: {
    canManageUserStatus: jest.Mock;
    canAssignGlobalRole: jest.Mock;
    canRemoveGlobalRole: jest.Mock;
    canViewUsers: jest.Mock;
  };
  let service: UsersService;

  beforeEach(() => {
    usersRepo = { findOneBy: jest.fn(), save: jest.fn(async (u) => u), createQueryBuilder: jest.fn() };
    rolesRepo = { findOneBy: jest.fn() };
    userRolesRepo = {
      findOneBy: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (r) => r),
      delete: jest.fn(async () => ({ affected: 1 })),
      createQueryBuilder: jest.fn(() => makeQueryBuilder([])),
    };
    permissions = {
      canManageUserStatus: jest.fn(() => true),
      canAssignGlobalRole: jest.fn(() => true),
      canRemoveGlobalRole: jest.fn(() => true),
      canViewUsers: jest.fn(() => true),
    };

    service = new UsersService(
      usersRepo as never,
      rolesRepo as never,
      userRolesRepo as never,
      permissions as unknown as PermissionsService,
    );
  });

  describe('setActive', () => {
    it('404 si el usuario no existe', async () => {
      usersRepo.findOneBy.mockResolvedValue(null);
      await expect(service.setActive('missing', false, makeUser('admin-1', [RoleName.ADMIN]))).rejects.toThrow(
        NotFoundException,
      );
    });

    it('403 si PermissionsService.canManageUserStatus da false (incluye el caso self)', async () => {
      usersRepo.findOneBy.mockResolvedValue({ id: 'target-1', active: true, deletedAt: null });
      permissions.canManageUserStatus.mockReturnValue(false);

      await expect(service.setActive('target-1', false, makeUser('admin-1', [RoleName.ADMIN]))).rejects.toThrow(
        ForbiddenException,
      );
      expect(usersRepo.save).not.toHaveBeenCalled();
    });

    it('desactivar: active=false y deletedAt se setea (baja lógica)', async () => {
      const target = { id: 'target-1', active: true, deletedAt: null };
      usersRepo.findOneBy.mockResolvedValue(target);
      userRolesRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder([]));

      const result = await service.setActive('target-1', false, makeUser('admin-1', [RoleName.ADMIN]));

      expect(result.active).toBe(false);
      expect(result.deletedAt).not.toBeNull();
      expect(usersRepo.save).toHaveBeenCalled();
    });

    it('reactivar: active=true y deletedAt vuelve a null (no queda bloqueado para siempre)', async () => {
      const target = { id: 'target-1', active: false, deletedAt: new Date() };
      usersRepo.findOneBy.mockResolvedValue(target);
      userRolesRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder([]));

      const result = await service.setActive('target-1', true, makeUser('admin-1', [RoleName.ADMIN]));

      expect(result.active).toBe(true);
      expect(result.deletedAt).toBeNull();
    });
  });

  describe('assignRole', () => {
    it('404 si el usuario no existe', async () => {
      usersRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.assignRole('missing', RoleName.PROJECT_LEADER, makeUser('pm-1', [RoleName.PROGRAM_MANAGER])),
      ).rejects.toThrow(NotFoundException);
    });

    it('403 si PermissionsService.canAssignGlobalRole da false', async () => {
      usersRepo.findOneBy.mockResolvedValue({ id: 'target-1' });
      permissions.canAssignGlobalRole.mockReturnValue(false);

      await expect(
        service.assignRole('target-1', RoleName.ADMIN, makeUser('pm-1', [RoleName.PROGRAM_MANAGER])),
      ).rejects.toThrow(ForbiddenException);
      expect(userRolesRepo.save).not.toHaveBeenCalled();
    });

    it('asigna el rol si no lo tenía', async () => {
      usersRepo.findOneBy.mockResolvedValue({ id: 'target-1' });
      rolesRepo.findOneBy.mockResolvedValue({ id: 'role-leader', name: RoleName.PROJECT_LEADER });
      userRolesRepo.findOneBy.mockResolvedValue(null);
      userRolesRepo.createQueryBuilder.mockReturnValue(
        makeQueryBuilder([{ userId: 'target-1', name: RoleName.PROJECT_LEADER }]),
      );

      const result = await service.assignRole(
        'target-1',
        RoleName.PROJECT_LEADER,
        makeUser('pm-1', [RoleName.PROGRAM_MANAGER]),
      );

      expect(userRolesRepo.save).toHaveBeenCalled();
      expect(result.roles).toEqual([RoleName.PROJECT_LEADER]);
    });

    it('idempotente: si ya tenía el rol, no lo duplica ni falla', async () => {
      usersRepo.findOneBy.mockResolvedValue({ id: 'target-1' });
      rolesRepo.findOneBy.mockResolvedValue({ id: 'role-leader', name: RoleName.PROJECT_LEADER });
      userRolesRepo.findOneBy.mockResolvedValue({ id: 'existing-row' }); // ya existe
      userRolesRepo.createQueryBuilder.mockReturnValue(
        makeQueryBuilder([{ userId: 'target-1', name: RoleName.PROJECT_LEADER }]),
      );

      const result = await service.assignRole(
        'target-1',
        RoleName.PROJECT_LEADER,
        makeUser('admin-1', [RoleName.ADMIN]),
      );

      expect(userRolesRepo.save).not.toHaveBeenCalled();
      expect(result.roles).toEqual([RoleName.PROJECT_LEADER]);
    });

    it('conserva otros roles ya existentes (multi-rol): no los pisa', async () => {
      usersRepo.findOneBy.mockResolvedValue({ id: 'target-1' });
      rolesRepo.findOneBy.mockResolvedValue({ id: 'role-leader', name: RoleName.PROJECT_LEADER });
      userRolesRepo.findOneBy.mockResolvedValue(null);
      userRolesRepo.createQueryBuilder.mockReturnValue(
        makeQueryBuilder([
          { userId: 'target-1', name: RoleName.ADMIN },
          { userId: 'target-1', name: RoleName.PROGRAM_MANAGER },
          { userId: 'target-1', name: RoleName.PROJECT_LEADER },
        ]),
      );

      const result = await service.assignRole('target-1', RoleName.PROJECT_LEADER, makeUser('admin-1', [RoleName.ADMIN]));

      expect(result.roles).toEqual(
        expect.arrayContaining([RoleName.ADMIN, RoleName.PROGRAM_MANAGER, RoleName.PROJECT_LEADER]),
      );
    });

    it('400 si el rol no existe en el catálogo (config rota, no culpa del usuario)', async () => {
      usersRepo.findOneBy.mockResolvedValue({ id: 'target-1' });
      rolesRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.assignRole('target-1', RoleName.PROJECT_LEADER, makeUser('admin-1', [RoleName.ADMIN])),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAllWithRoles', () => {
    it('devuelve usuarios con sus roles resueltos, sin N+1 (una query de usuarios + una de roles)', async () => {
      const usersQb = makeQueryBuilder([
        { id: 'u1', name: 'Ana' },
        { id: 'u2', name: 'Juan' },
      ]);
      const rolesQb = makeQueryBuilder([
        { userId: 'u1', name: RoleName.ADMIN },
        { userId: 'u1', name: RoleName.PROGRAM_MANAGER },
        { userId: 'u2', name: RoleName.COLLABORATOR },
      ]);
      usersRepo.createQueryBuilder.mockReturnValue(usersQb);
      userRolesRepo.createQueryBuilder.mockReturnValue(rolesQb);

      const result = await service.findAllWithRoles({});

      expect(result).toHaveLength(2);
      expect(result.find((u) => u.id === 'u1')?.roles).toEqual(
        expect.arrayContaining([RoleName.ADMIN, RoleName.PROGRAM_MANAGER]),
      );
      expect(result.find((u) => u.id === 'u2')?.roles).toEqual([RoleName.COLLABORATOR]);
    });

    it('usuario sin ningún rol asignado: array vacío, no undefined', async () => {
      usersRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder([{ id: 'u1', name: 'Ana' }]));
      userRolesRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder([]));

      const result = await service.findAllWithRoles({});
      expect(result[0]?.roles).toEqual([]);
    });

    it('lista vacía: no dispara la segunda query de roles', async () => {
      const usersQb = makeQueryBuilder([]);
      usersRepo.createQueryBuilder.mockReturnValue(usersQb);

      const result = await service.findAllWithRoles({});

      expect(result).toEqual([]);
      expect(userRolesRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('removeRole', () => {
    it('404 si el usuario no existe', async () => {
      usersRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.removeRole('missing', RoleName.PROJECT_LEADER, makeUser('admin-1', [RoleName.ADMIN])),
      ).rejects.toThrow(NotFoundException);
    });

    it('403 si PermissionsService.canRemoveGlobalRole da false', async () => {
      usersRepo.findOneBy.mockResolvedValue({ id: 'target-1' });
      permissions.canRemoveGlobalRole.mockReturnValue(false);

      await expect(
        service.removeRole('target-1', RoleName.PROJECT_LEADER, makeUser('pm-1', [RoleName.PROGRAM_MANAGER])),
      ).rejects.toThrow(ForbiddenException);
      expect(userRolesRepo.delete).not.toHaveBeenCalled();
    });

    it('quita el rol cuando está permitido', async () => {
      usersRepo.findOneBy.mockResolvedValue({ id: 'target-1' });
      rolesRepo.findOneBy.mockResolvedValue({ id: 'role-leader', name: RoleName.PROJECT_LEADER });
      userRolesRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder([]));

      const result = await service.removeRole(
        'target-1',
        RoleName.PROJECT_LEADER,
        makeUser('admin-1', [RoleName.ADMIN]),
      );

      expect(userRolesRepo.delete).toHaveBeenCalledWith({ userId: 'target-1', roleId: 'role-leader' });
      expect(result.roles).toEqual([]);
    });
  });
});
