import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';
import { RoleEntity } from '../database/entities/role.entity';
import { UserRoleEntity } from '../database/entities/user-role.entity';
import { ProjectEntity } from '../projects/project.entity';
import { RoleName } from '../database/enums';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { hashPassword, normalizeEmail } from '../auth/password';

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
    private readonly dataSource: DataSource,
  ) {}

  findById(id: string, manager?: EntityManager): Promise<UserEntity | null> {
    const repo = manager ? manager.getRepository(UserEntity) : this.usersRepository;
    return repo.findOneBy({ id });
  }

  findByEmail(email: string, manager?: EntityManager): Promise<UserEntity | null> {
    const repo = manager ? manager.getRepository(UserEntity) : this.usersRepository;
    return repo.findOneBy({ email });
  }

  /**
   * Incluye usuarios desactivados: desactivar es una baja lógica (deleted_at), y la administración tiene que
   * poder verlos, editar sus roles y, sobre todo, REACTIVARLOS (antes daba 404). Primero la búsqueda normal;
   * solo si no aparece se reintenta con bajas incluidas.
   */
  private async findByIdOrThrow(id: string): Promise<UserEntity> {
    const user =
      (await this.usersRepository.findOneBy({ id })) ?? (await this.usersRepository.findOne({ where: { id }, withDeleted: true }));
    if (!user) {
      throw new NotFoundException(`Usuario ${id} no encontrado`);
    }
    return user;
  }

  /**
   * RN-23: Project.leaderId es la fuente de verdad del liderazgo y un proyecto no puede quedar
   * sin líder válido. Si el usuario es leaderId de algún proyecto, NO se le puede quitar
   * PROJECT_LEADER ni desactivarlo: hay que transferir antes el liderazgo con
   * PATCH /projects/:id/leader (no se reasigna automáticamente: elegir líder es decisión de
   * ADMIN/PM). `find` excluye los proyectos con baja lógica (deleted_at); los archivados SÍ
   * cuentan, siguen existiendo y siguen apuntando a ese usuario.
   */
  private async assertDoesNotLeadProjects(manager: EntityManager, userId: string, blockedAction: string): Promise<void> {
    const projects = await manager.find(ProjectEntity, {
      where: { leaderId: userId },
      select: { id: true, name: true },
      order: { name: 'ASC' },
    });
    if (projects.length === 0) return;

    throw new ConflictException({
      code: 'USER_LEADS_PROJECTS',
      message:
        `El usuario lidera ${projects.length} proyecto${projects.length === 1 ? '' : 's'}. ` +
        `Reasigná el liderazgo (PATCH /projects/:id/leader) antes de ${blockedAction}.`,
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
    });
  }

  /**
   * Bloquea la fila del usuario hasta el fin de la transacción. ProjectsService.changeLeader toma
   * FOR SHARE sobre el nuevo líder, así que "quitar rol / desactivar" y "asignar como líder" se
   * serializan: no puede ocurrir que uno valide con el estado viejo mientras el otro confirma.
   */
  private async lockUser(manager: EntityManager, userId: string): Promise<void> {
    await manager.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
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
    // Desactivados = deleted_at: solo se listan si el cliente lo pide (pantalla "Usuarios y permisos").
    if (query.includeInactive) base.withDeleted();

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

  /**
   * Alta de usuario (solo ADMIN, ver el @Roles del controller): única vía además de los scripts de
   * desarrollo, ya que el login con Google YA NO crea cuentas. La contraseña se hashea acá, nunca se
   * acepta un hash desde afuera y nunca se devuelve. Sin roles explícitos: COLLABORATOR.
   */
  async createUser(dto: CreateUserDto): Promise<UserEntity & { roles: RoleName[] }> {
    // El DTO ya normaliza, pero el service no confía en quién lo llame: el email se guarda siempre en minúsculas.
    const email = normalizeEmail(dto.email);
    const existing = await this.usersRepository
      .createQueryBuilder('user')
      .withDeleted()
      .where('LOWER(user.email) = :email', { email })
      .getOne();
    if (existing) {
      throw new ConflictException('Ya existe un usuario con ese email.');
    }

    const roleNames = dto.roles && dto.roles.length > 0 ? dto.roles : [RoleName.COLLABORATOR];
    const passwordHash = await hashPassword(dto.password);

    const userId = await this.dataSource.transaction(async (manager) => {
      const roleEntities = await Promise.all(roleNames.map((name) => manager.getRepository(RoleEntity).findOneBy({ name })));
      if (roleEntities.some((role) => !role)) {
        // Falta el seed de roles: error de configuración, no del request.
        throw new BadRequestException('Alguno de los roles pedidos no existe en el catálogo.');
      }

      const user = await manager.getRepository(UserEntity).save(
        manager.getRepository(UserEntity).create({ email, name: dto.name, active: true, passwordHash }),
      );
      await manager
        .getRepository(UserRoleEntity)
        .save(roleEntities.map((role) => manager.getRepository(UserRoleEntity).create({ userId: user.id, roleId: role!.id })));
      return user.id;
    });

    // Se relee: la entidad guardada traería passwordHash; la lectura normal (select: false) no.
    return this.findOneWithRoles(userId);
  }

  /** Activar/desactivar (baja lógica): ver UserEntity, nunca borrado físico. */
  async setActive(id: string, active: boolean, actor: RequestUser): Promise<UserEntity & { roles: RoleName[] }> {
    const target = await this.findByIdOrThrow(id);

    if (!this.permissions.canManageUserStatus(actor, id)) {
      throw new ForbiddenException(
        actor.id === id ? 'No podés desactivarte a vos mismo.' : 'No podés modificar el estado de este usuario.',
      );
    }

    if (active) {
      // Reactivar no puede dejar ningún proyecto sin líder: sin chequeo RN-23.
      target.active = true;
      target.deletedAt = null;
      await this.usersRepository.save(target);
    } else {
      // Desactivar: chequeo + escritura en una transacción con lock (ver lockUser).
      await this.dataSource.transaction(async (manager) => {
        await this.lockUser(manager, id);
        await this.assertDoesNotLeadProjects(manager, id, 'desactivarlo');
        target.active = false;
        target.deletedAt = new Date();
        await manager.getRepository(UserEntity).save(target);
      });
    }

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
   * RN-23: si el usuario es leaderId de algún proyecto, quitarle PROJECT_LEADER se rechaza con
   * 409 USER_LEADS_PROJECTS (ver assertDoesNotLeadProjects). Quitar cualquier otro rol no se
   * ve afectado.
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

    if (role === RoleName.PROJECT_LEADER) {
      // RN-23: solo este rol está atado a leaderId; el resto de los roles se quita sin chequeo.
      await this.dataSource.transaction(async (manager) => {
        await this.lockUser(manager, target.id);
        await this.assertDoesNotLeadProjects(manager, target.id, 'quitarle el rol de Líder');
        await manager.getRepository(UserRoleEntity).delete({ userId: target.id, roleId: roleEntity.id });
      });
    } else {
      await this.userRolesRepository.delete({ userId: target.id, roleId: roleEntity.id });
    }

    const roles = await this.getRoleNames(target.id);
    return Object.assign(target, { roles });
  }
}
