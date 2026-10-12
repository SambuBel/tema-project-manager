import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PermissionsService } from '../auth/permissions.service';
import { RoleName } from '../database/enums';
import { UserEntity } from '../database/entities/user.entity';
import { UserRoleEntity } from '../database/entities/user-role.entity';
import { ProjectEntity } from '../projects/project.entity';
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
  let manager: { query: jest.Mock; find: jest.Mock; getRepository: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  /** Proyectos donde el usuario objetivo es leaderId (lo que devolvería manager.find). */
  let ledProjects: Array<{ id: string; name: string }>;
  let service: UsersService;

  /** Lee el body estructurado de una excepción de dominio de Nest. */
  async function conflictBody(promise: Promise<unknown>): Promise<Record<string, unknown>> {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      return (error as ConflictException).getResponse() as Record<string, unknown>;
    }
    throw new Error('Se esperaba un ConflictException');
  }

  beforeEach(() => {
    ledProjects = [];
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

    manager = {
      query: jest.fn(async () => []),
      find: jest.fn(async () => ledProjects),
      getRepository: jest.fn((entity: unknown) => (entity === UserEntity ? usersRepo : userRolesRepo)),
    };
    dataSource = { transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)) };

    service = new UsersService(
      usersRepo as never,
      rolesRepo as never,
      userRolesRepo as never,
      permissions as unknown as PermissionsService,
      dataSource as never,
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

  describe('setActive - RN-23 (no dejar proyectos con líder inactivo)', () => {
    const admin = makeUser('admin-1', [RoleName.ADMIN]);

    it('desactivar a alguien que no lidera proyectos: OK, con lock y chequeo dentro de la transacción', async () => {
      usersRepo.findOneBy.mockResolvedValue({ id: 'target-1', active: true, deletedAt: null });

      const result = await service.setActive('target-1', false, admin);

      expect(result.active).toBe(false);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), ['target-1']);
      expect(manager.find).toHaveBeenCalledWith(
        ProjectEntity,
        expect.objectContaining({ where: { leaderId: 'target-1' } }),
      );
    });

    it('desactivar a un líder (1 proyecto): 409 USER_LEADS_PROJECTS, con los proyectos, y no cambia nada', async () => {
      const target = { id: 'target-1', active: true, deletedAt: null };
      usersRepo.findOneBy.mockResolvedValue(target);
      ledProjects = [{ id: 'p1', name: 'Proyecto Alfa' }];

      const body = await conflictBody(service.setActive('target-1', false, admin));

      expect(body).toMatchObject({ code: 'USER_LEADS_PROJECTS', projects: [{ id: 'p1', name: 'Proyecto Alfa' }] });
      expect(String(body.message)).toContain('1 proyecto.');
      expect(usersRepo.save).not.toHaveBeenCalled();
      expect(target.active).toBe(true);
      expect(target.deletedAt).toBeNull();
    });

    it('desactivar a un líder de varios proyectos: 409 con todos', async () => {
      usersRepo.findOneBy.mockResolvedValue({ id: 'target-1', active: true, deletedAt: null });
      ledProjects = [
        { id: 'p1', name: 'Proyecto Alfa' },
        { id: 'p2', name: 'Proyecto Beta' },
      ];

      const body = await conflictBody(service.setActive('target-1', false, admin));

      expect(body.projects).toHaveLength(2);
      expect(String(body.message)).toContain('2 proyectos');
      expect(usersRepo.save).not.toHaveBeenCalled();
    });

    it('un ex-líder cuyo proyecto ya fue reasignado (ya no es leaderId de nada) se puede desactivar', async () => {
      usersRepo.findOneBy.mockResolvedValue({ id: 'target-1', active: true, deletedAt: null });
      ledProjects = [];

      await expect(service.setActive('target-1', false, admin)).resolves.toMatchObject({ active: false });
    });

    it('reactivar NO consulta proyectos ni abre transacción, aunque figure como líder', async () => {
      usersRepo.findOneBy.mockResolvedValue({ id: 'target-1', active: false, deletedAt: new Date() });
      ledProjects = [{ id: 'p1', name: 'Proyecto Alfa' }];

      await expect(service.setActive('target-1', true, admin)).resolves.toMatchObject({ active: true, deletedAt: null });
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(manager.find).not.toHaveBeenCalled();
    });

    it('el permiso se evalúa antes: sin canManageUserStatus es 403 y ni consulta proyectos', async () => {
      usersRepo.findOneBy.mockResolvedValue({ id: 'target-1', active: true });
      permissions.canManageUserStatus.mockReturnValue(false);
      ledProjects = [{ id: 'p1', name: 'x' }];

      await expect(service.setActive('target-1', false, makeUser('pm-1', [RoleName.PROGRAM_MANAGER]))).rejects.toThrow(
        ForbiddenException,
      );
      expect(manager.find).not.toHaveBeenCalled();
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

    describe('RN-23 (no dejar proyectos sin líder)', () => {
      const admin = makeUser('admin-1', [RoleName.ADMIN]);

      beforeEach(() => {
        usersRepo.findOneBy.mockResolvedValue({ id: 'target-1' });
        rolesRepo.findOneBy.mockImplementation(async ({ name }: { name: RoleName }) => ({ id: `role-${name}`, name }));
      });

      it('quitar PROJECT_LEADER a alguien sin proyectos: OK, con lock y chequeo en la transacción', async () => {
        await expect(service.removeRole('target-1', RoleName.PROJECT_LEADER, admin)).resolves.toBeDefined();

        expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), ['target-1']);
        expect(manager.find).toHaveBeenCalledWith(
          ProjectEntity,
          expect.objectContaining({ where: { leaderId: 'target-1' } }),
        );
        expect(manager.getRepository).toHaveBeenCalledWith(UserRoleEntity);
        expect(userRolesRepo.delete).toHaveBeenCalledWith({ userId: 'target-1', roleId: `role-${RoleName.PROJECT_LEADER}` });
      });

      it('quitar PROJECT_LEADER a quien lidera 1 proyecto: 409 USER_LEADS_PROJECTS y el rol NO se borra', async () => {
        ledProjects = [{ id: 'p1', name: 'Proyecto Alfa' }];

        const body = await conflictBody(service.removeRole('target-1', RoleName.PROJECT_LEADER, admin));

        expect(body).toMatchObject({ code: 'USER_LEADS_PROJECTS', projects: [{ id: 'p1', name: 'Proyecto Alfa' }] });
        expect(userRolesRepo.delete).not.toHaveBeenCalled();
      });

      it('quitar PROJECT_LEADER a quien lidera varios proyectos: 409 con todos, el rol sigue', async () => {
        ledProjects = [
          { id: 'p1', name: 'Proyecto Alfa' },
          { id: 'p2', name: 'Proyecto Beta' },
        ];

        const body = await conflictBody(service.removeRole('target-1', RoleName.PROJECT_LEADER, admin));

        expect(body.projects).toHaveLength(2);
        expect(userRolesRepo.delete).not.toHaveBeenCalled();
      });

      it('un ex-líder (proyectos ya reasignados) puede perder PROJECT_LEADER', async () => {
        ledProjects = [];
        await expect(service.removeRole('target-1', RoleName.PROJECT_LEADER, admin)).resolves.toBeDefined();
        expect(userRolesRepo.delete).toHaveBeenCalledTimes(1);
      });

      it.each([RoleName.COLLABORATOR, RoleName.OBSERVER, RoleName.PROGRAM_MANAGER])(
        'quitar %s NO dispara RN-23, aunque lidere proyectos (ni consulta ni abre transacción)',
        async (role) => {
          ledProjects = [{ id: 'p1', name: 'Proyecto Alfa' }];

          await expect(service.removeRole('target-1', role, admin)).resolves.toBeDefined();

          expect(dataSource.transaction).not.toHaveBeenCalled();
          expect(manager.find).not.toHaveBeenCalled();
          expect(userRolesRepo.delete).toHaveBeenCalledWith({ userId: 'target-1', roleId: `role-${role}` });
        },
      );

      it('el permiso se evalúa antes: sin canRemoveGlobalRole es 403 y no consulta proyectos', async () => {
        permissions.canRemoveGlobalRole.mockReturnValue(false);
        ledProjects = [{ id: 'p1', name: 'x' }];

        await expect(service.removeRole('target-1', RoleName.PROJECT_LEADER, makeUser('pm-1', [RoleName.PROGRAM_MANAGER]))).rejects.toThrow(
          ForbiddenException,
        );
        expect(manager.find).not.toHaveBeenCalled();
      });
    });
  });
});
