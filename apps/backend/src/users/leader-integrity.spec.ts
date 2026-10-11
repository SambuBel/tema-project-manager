import { BadRequestException, ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';
import { ProjectsService } from '../projects/projects.service';
import { ProjectEntity } from '../projects/project.entity';
import { UserEntity } from '../database/entities/user.entity';
import { RoleName } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';

/**
 * RN-23 de punta a punta a nivel service: UsersService y ProjectsService REALES sobre un
 * estado en memoria compartido (usuarios, roles globales y proyectos). Cubre el flujo que
 * el ADMIN/PM tiene que seguir: transferir el liderazgo con changeLeader y recién después
 * quitar PROJECT_LEADER / desactivar al ex-líder.
 */
const admin = { id: 'admin-1', roles: [RoleName.ADMIN] } as RequestUser;

interface FakeUser {
  id: string;
  active: boolean;
  deletedAt: Date | null;
}

function buildWorld() {
  const users = new Map<string, FakeUser>([
    ['A', { id: 'A', active: true, deletedAt: null }],
    ['B', { id: 'B', active: true, deletedAt: null }],
    ['C', { id: 'C', active: true, deletedAt: null }],
  ]);
  const roles = new Map<string, Set<RoleName>>([
    ['A', new Set([RoleName.PROJECT_LEADER])],
    ['B', new Set([RoleName.PROJECT_LEADER])],
    ['C', new Set([RoleName.COLLABORATOR])], // sin PROJECT_LEADER: no elegible
  ]);
  const projects: ProjectEntity[] = [
    { id: 'p1', name: 'Proyecto Alfa', leaderId: 'A' } as ProjectEntity,
    { id: 'p2', name: 'Proyecto Beta', leaderId: 'A' } as ProjectEntity,
  ];

  const usersRepo = {
    findOneBy: jest.fn(async ({ id }: { id: string }) => users.get(id) ?? null),
    save: jest.fn(async (u: FakeUser) => u),
  };
  const rolesRepo = { findOneBy: jest.fn(async ({ name }: { name: RoleName }) => ({ id: `role-${name}`, name })) };
  const userRolesRepo = {
    delete: jest.fn(async ({ userId, roleId }: { userId: string; roleId: string }) => {
      roles.get(userId)?.delete(roleId.replace('role-', '') as RoleName);
    }),
    createQueryBuilder: jest.fn(() => {
      let userId = '';
      const qb: Record<string, jest.Mock> = {};
      qb.innerJoin = jest.fn(() => qb);
      qb.select = jest.fn(() => qb);
      qb.where = jest.fn((_sql: string, params: { userId: string }) => {
        userId = params.userId;
        return qb;
      });
      qb.getRawMany = jest.fn(async () => [...(roles.get(userId) ?? [])].map((name) => ({ name })));
      return qb;
    }),
  };

  const manager = {
    query: jest.fn(async () => []),
    find: jest.fn(async (_entity: unknown, opts: { where: { leaderId: string } }) =>
      projects.filter((p) => p.leaderId === opts.where.leaderId),
    ),
    findOneBy: jest.fn(async (_entity: unknown, where: { id: string }) => projects.find((p) => p.id === where.id) ?? null),
    save: jest.fn(async (entity: unknown) => entity),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    getRepository: jest.fn((entity: unknown) => (entity === UserEntity ? usersRepo : userRolesRepo)),
  };
  const dataSource = { transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)) };

  const permissions = {
    canRemoveGlobalRole: jest.fn(() => true),
    canManageUserStatus: jest.fn(() => true),
  };
  const usersService = new UsersService(
    usersRepo as never,
    rolesRepo as never,
    userRolesRepo as never,
    permissions as never,
    dataSource as never,
  );

  // ProjectsService solo necesita, para changeLeader, estos colaboradores.
  const authService = { getRoleNames: jest.fn(async (id: string) => [...(roles.get(id) ?? [])]) };
  const projectsService = new ProjectsService(
    {} as never,
    {} as never,
    { findById: jest.fn(async (id: string) => users.get(id) ?? null) } as never,
    authService as never,
    {} as never,
    dataSource as never,
    { logEvent: jest.fn() } as never,
  );

  return { users, roles, projects, usersService, projectsService, manager };
}

describe('RN-23 de punta a punta (transferir liderazgo antes de quitar rol / desactivar)', () => {
  it('mientras A lidera proyectos: no se le puede quitar PROJECT_LEADER ni desactivarlo', async () => {
    const w = buildWorld();

    await expect(w.usersService.removeRole('A', RoleName.PROJECT_LEADER, admin)).rejects.toBeInstanceOf(ConflictException);
    await expect(w.usersService.setActive('A', false, admin)).rejects.toBeInstanceOf(ConflictException);

    expect(w.roles.get('A')!.has(RoleName.PROJECT_LEADER)).toBe(true);
    expect(w.users.get('A')).toMatchObject({ active: true, deletedAt: null });
  });

  it('flujo completo: changeLeader de todos los proyectos A -> B, y recién ahí A pierde el rol y se desactiva', async () => {
    const w = buildWorld();

    // 1) Transferir liderazgo (la vía normal): cada proyecto queda con B.
    await w.projectsService.changeLeader('p1', { newLeaderId: 'B' }, admin);
    // Con un proyecto todavía a su nombre, A sigue bloqueado.
    await expect(w.usersService.removeRole('A', RoleName.PROJECT_LEADER, admin)).rejects.toBeInstanceOf(ConflictException);
    await w.projectsService.changeLeader('p2', { newLeaderId: 'B' }, admin);

    expect(w.projects.map((p) => p.leaderId)).toEqual(['B', 'B']);

    // 2) A ya no lidera nada: puede perder el rol y desactivarse.
    await expect(w.usersService.removeRole('A', RoleName.PROJECT_LEADER, admin)).resolves.toMatchObject({ roles: [] });
    await expect(w.usersService.setActive('A', false, admin)).resolves.toMatchObject({ active: false });
    expect(w.users.get('A')!.deletedAt).not.toBeNull();

    // 3) Ahora el bloqueado es B, que quedó como líder de ambos.
    await expect(w.usersService.removeRole('B', RoleName.PROJECT_LEADER, admin)).rejects.toBeInstanceOf(ConflictException);
    await expect(w.usersService.setActive('B', false, admin)).rejects.toBeInstanceOf(ConflictException);
  });

  it('changeLeader exige un nuevo líder activo y con PROJECT_LEADER: si falla, el proyecto sigue con A', async () => {
    const w = buildWorld();

    await expect(w.projectsService.changeLeader('p1', { newLeaderId: 'C' }, admin)).rejects.toBeInstanceOf(
      BadRequestException,
    ); // C no tiene PROJECT_LEADER
    w.users.get('B')!.active = false;
    await expect(w.projectsService.changeLeader('p1', { newLeaderId: 'B' }, admin)).rejects.toBeInstanceOf(
      BadRequestException,
    ); // B inactivo

    expect(w.projects[0]!.leaderId).toBe('A');
  });

  it('carrera resuelta por orden de operaciones: si a B le quitaron PROJECT_LEADER antes, changeLeader a B falla y no queda líder sin rol', async () => {
    const w = buildWorld();

    await w.usersService.removeRole('B', RoleName.PROJECT_LEADER, admin); // B no lidera nada: permitido
    await expect(w.projectsService.changeLeader('p1', { newLeaderId: 'B' }, admin)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(w.projects[0]!.leaderId).toBe('A');
  });

  it('quitar otro rol a un líder no afecta RN-23', async () => {
    const w = buildWorld();
    w.roles.get('A')!.add(RoleName.COLLABORATOR);

    await expect(w.usersService.removeRole('A', RoleName.COLLABORATOR, admin)).resolves.toMatchObject({
      roles: [RoleName.PROJECT_LEADER],
    });
  });
});
