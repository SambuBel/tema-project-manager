import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';
import { RoleEntity } from '../database/entities/role.entity';
import { UserRoleEntity } from '../database/entities/user-role.entity';
import { RoleName } from '../database/enums';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

/**
 * Acceso a usuarios reutilizable entre modulos (hoy auth y la administración de
 * usuarios/roles globales). Los metodos que reciben `manager` opcional permiten
 * participar en la transaccion de AuthService.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly rolesRepository: Repository<RoleEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRolesRepository: Repository<UserRoleEntity>,
    private readonly permissions: PermissionsService,
  ) {}

  findById(id: string, manager?: EntityManager): Promise<UserEntity | null> {
    const repo = manager ? manager.getRepository(UserEntity) : this.usersRepository;
    return repo.findOneBy({ id });
  }

  findByEmail(email: string, manager?: EntityManager): Promise<UserEntity | null> {
    const repo = manager ? manager.getRepository(UserEntity) : this.usersRepository;
    return repo.findOneBy({ email });
  }

  private async findByIdOrThrow(id: string): Promise<UserEntity> {
    const user = await this.usersRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`Usuario ${id} no encontrado`);
    }
    return user;
  }

  /**
   * Roles globales de un usuario puntual. Misma query que AuthService.getRoleNames
   * (duplicada a propósito, es chica): inyectar AuthService acá sumaría una
   * dependencia cruzada más sobre un servicio pensado para el flujo de login, no
   * para administración de roles — el forwardRef con AuthModule ya existe solo
   * por PermissionsService.
   */
  private async getRoleNames(userId: string): Promise<RoleName[]> {
    const rows: Array<{ name: RoleName }> = await this.userRolesRepository
      .createQueryBuilder('userRole')
      .innerJoin('userRole.role', 'role')
      .select('role.name', 'name')
      .where('userRole.userId = :userId', { userId })
      .getRawMany();
    return rows.map((row) => row.name);
  }

  /**
   * Usuarios + sus roles globales, para la pantalla de administración. `role`
   * filtra server-side (ej. candidatos a líder: ?role=PROJECT_LEADER), `search`
   * busca por nombre o email. Se resuelve con una sola query (join + agregación),
   * no N+1: una query por usuario sería imposible de justificar en una lista.
   */
  async findAllWithRoles(query: ListUsersQueryDto): Promise<Array<UserEntity & { roles: RoleName[] }>> {
    const base = this.usersRepository.createQueryBuilder('user').orderBy('user.name', 'ASC');

    if (query.search) {
      base.andWhere('(user.name ILIKE :search OR user.email ILIKE :search)', { search: `%${query.search}%` });
    }

    if (query.role) {
      base.andWhere(
        `EXISTS (
          SELECT 1 FROM user_roles ur2
          INNER JOIN roles r2 ON r2.id = ur2.role_id
          WHERE ur2.user_id = user.id AND r2.name = :role
        )`,
        { role: query.role },
      );
    }

    const users = await base.getMany();
    if (users.length === 0) return [];

    const roleRows: Array<{ userId: string; name: RoleName }> = await this.userRolesRepository
      .createQueryBuilder('userRole')
      .innerJoin('userRole.role', 'role')
      .select('userRole.userId', 'userId')
      .addSelect('role.name', 'name')
      .where('userRole.userId IN (:...ids)', { ids: users.map((u) => u.id) })
      .getRawMany();

    const rolesByUser = new Map<string, RoleName[]>();
    for (const row of roleRows) {
      const list = rolesByUser.get(row.userId) ?? [];
      list.push(row.name);
      rolesByUser.set(row.userId, list);
    }

    return users.map((user) => Object.assign(user, { roles: rolesByUser.get(user.id) ?? [] }));
  }

  async findOneWithRoles(id: string): Promise<UserEntity & { roles: RoleName[] }> {
    const user = await this.findByIdOrThrow(id);
    const roles = await this.getRoleNames(id);
    return Object.assign(user, { roles });
  }

  /** Activar/desactivar (baja lógica): ver UserEntity, nunca borrado físico. */
  async setActive(id: string, active: boolean, actor: RequestUser): Promise<UserEntity & { roles: RoleName[] }> {
    const target = await this.findByIdOrThrow(id);

    if (!this.permissions.canManageUserStatus(actor, id)) {
      throw new ForbiddenException(
        actor.id === id ? 'No podés desactivarte a vos mismo.' : 'No podés modificar el estado de este usuario.',
      );
    }

    target.active = active;
    target.deletedAt = active ? null : new Date();
    await this.usersRepository.save(target);

    const roles = await this.getRoleNames(id);
    return Object.assign(target, { roles });
  }

  /**
   * Asigna un rol global. Idempotente: si ya lo tiene, no duplica (hay un índice
   * único de todos modos) y devuelve el estado actual sin error — asignar un rol
   * que ya existe no es un conflicto real, es un no-op.
   */
  async assignRole(targetId: string, role: RoleName, actor: RequestUser): Promise<UserEntity & { roles: RoleName[] }> {
    const target = await this.findByIdOrThrow(targetId);

    if (!this.permissions.canAssignGlobalRole(actor, targetId, role)) {
      throw new ForbiddenException(
        actor.id === targetId
          ? 'No podés modificar tus propios roles.'
          : `No tenés permiso para asignar el rol ${role}.`,
      );
    }

    const roleEntity = await this.rolesRepository.findOneBy({ name: role });
    if (!roleEntity) {
      // Error de configuración (falta el seed de roles), no un 400 del usuario.
      throw new BadRequestException(`El rol ${role} no existe en el catálogo.`);
    }

    const existing = await this.userRolesRepository.findOneBy({ userId: target.id, roleId: roleEntity.id });
    if (!existing) {
      await this.userRolesRepository.save(this.userRolesRepository.create({ userId: target.id, roleId: roleEntity.id }));
    }

    const roles = await this.getRoleNames(target.id);
    return Object.assign(target, { roles });
  }

  /**
   * Quita un rol global. Solo ADMIN (ver PermissionsService.canRemoveGlobalRole).
   * Idempotente: si no lo tenía, no es error.
   *
   * Invariante deliberadamente NO forzada acá: si se remueve PROJECT_LEADER a
   * alguien que lidera uno o más proyectos (project.leaderId), esos proyectos
   * NO se tocan — project.leaderId sigue apuntando a ese usuario. No es un bug:
   * isProjectLeader() compara únicamente project.leaderId === user.id, nunca
   * consulta el rol global (ver permissions.service.ts), así que el proyecto
   * nunca queda "sin líder" por esto. Es una inconsistencia conceptual posible
   * (alguien liderando sin tener la capacidad global que se requirió para
   * nombrarlo), reportada como punto abierto — no se resuelve con una cascada
   * silenciosa no pedida.
   */
  async removeRole(targetId: string, role: RoleName, actor: RequestUser): Promise<UserEntity & { roles: RoleName[] }> {
    const target = await this.findByIdOrThrow(targetId);

    if (!this.permissions.canRemoveGlobalRole(actor, targetId)) {
      throw new ForbiddenException(
        actor.id === targetId ? 'No podés modificar tus propios roles.' : 'No tenés permiso para quitar roles.',
      );
    }

    const roleEntity = await this.rolesRepository.findOneBy({ name: role });
    if (!roleEntity) {
      throw new BadRequestException(`El rol ${role} no existe en el catálogo.`);
    }

    await this.userRolesRepository.delete({ userId: target.id, roleId: roleEntity.id });

    const roles = await this.getRoleNames(target.id);
    return Object.assign(target, { roles });
  }
}
