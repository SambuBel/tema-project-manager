import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Response } from 'express';
import ms from 'ms';
import { UserEntity } from '../database/entities/user.entity';
import { RoleEntity } from '../database/entities/role.entity';
import { UserRoleEntity } from '../database/entities/user-role.entity';
import { ExternalAccountEntity } from '../database/entities/external-account.entity';
import { AuthorizedDomainEntity } from '../database/entities/authorized-domain.entity';
import { ExternalAccountProvider, RoleName } from '../database/enums';
import { GoogleProfileDto } from './dto/google-profile.dto';
import { AuthenticatedUserDto } from './dto/authenticated-user.dto';
import { AUTH_ERROR_CODES, AuthError } from './auth.errors';
import { buildSessionCookieOptions, SESSION_COOKIE_NAME, sessionCookieClearOptions } from './auth.constants';

export interface SessionJwtPayload {
  sub: string;
}

/** Rol asignado automaticamente a todo usuario nuevo creado via login con Google. */
const DEFAULT_ROLE_FOR_NEW_USERS = RoleName.COLLABORATOR;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(AuthorizedDomainEntity)
    private readonly authorizedDomainsRepository: Repository<AuthorizedDomainEntity>,
    @InjectRepository(ExternalAccountEntity)
    private readonly externalAccountsRepository: Repository<ExternalAccountEntity>,
  ) {}

  /** lowercase + trim + parte posterior al ÚLTIMO "@" (soporta emails con "@" locales raros). */
  static normalizeDomain(email: string): string {
    const trimmed = email.trim().toLowerCase();
    const at = trimmed.lastIndexOf('@');
    return at === -1 ? '' : trimmed.slice(at + 1);
  }

  private async isDomainAuthorized(email: string): Promise<boolean> {
    const domain = AuthService.normalizeDomain(email);
    if (!domain) return false;

    const found = await this.authorizedDomainsRepository.findOne({
      where: { domain, active: true },
    });
    return found !== null;
  }

  /**
   * Orquesta todo el login: valida email_verified y dominio (sin tocar la base todavía),
   * y recien despues abre una transaccion para buscar/crear User + ExternalAccount +
   * UserRole. Cualquier error dentro de la transaccion (incluido "no existe el rol
   * COLLABORATOR") hace rollback automatico: nunca queda un usuario a medio crear.
   */
  async loginWithGoogle(profile: GoogleProfileDto): Promise<UserEntity> {
    if (!profile.emailVerified) {
      throw new AuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
    }

    const authorized = await this.isDomainAuthorized(profile.email);
    if (!authorized) {
      throw new AuthError(AUTH_ERROR_CODES.UNAUTHORIZED_DOMAIN);
    }

    return this.dataSource.transaction(async (manager) => this.resolveOrCreateUser(profile, manager));
  }

  private async resolveOrCreateUser(profile: GoogleProfileDto, manager: EntityManager): Promise<UserEntity> {
    const externalAccountsRepo = manager.getRepository(ExternalAccountEntity);
    const usersRepo = manager.getRepository(UserEntity);

    const existingAccount = await externalAccountsRepo.findOne({
      where: { provider: ExternalAccountProvider.GOOGLE, providerSubject: profile.providerSubject },
      relations: { user: true },
    });

    if (existingAccount) {
      const user = existingAccount.user ?? (await usersRepo.findOneBy({ id: existingAccount.userId }));
      this.assertUserIsActive(user);
      // Mantenemos el email/verificacion de la cuenta externa al dia con lo ultimo que dijo Google.
      if (existingAccount.email !== profile.email || existingAccount.emailVerified !== profile.emailVerified) {
        await externalAccountsRepo.update(existingAccount.id, {
          email: profile.email,
          emailVerified: profile.emailVerified,
        });
      }
      return user!;
    }

    const existingUser = await usersRepo.findOneBy({ email: profile.email });

    if (existingUser) {
      this.assertUserIsActive(existingUser);
      await externalAccountsRepo.save(
        externalAccountsRepo.create({
          userId: existingUser.id,
          provider: ExternalAccountProvider.GOOGLE,
          providerSubject: profile.providerSubject,
          email: profile.email,
          emailVerified: profile.emailVerified,
        }),
      );
      return existingUser;
    }

    return this.createUserWithExternalAccount(profile, manager);
  }

  private assertUserIsActive(user: UserEntity | null): void {
    if (!user || !user.active || user.deletedAt) {
      throw new AuthError(AUTH_ERROR_CODES.USER_DISABLED);
    }
  }

  private async createUserWithExternalAccount(
    profile: GoogleProfileDto,
    manager: EntityManager,
  ): Promise<UserEntity> {
    const usersRepo = manager.getRepository(UserEntity);
    const rolesRepo = manager.getRepository(RoleEntity);
    const userRolesRepo = manager.getRepository(UserRoleEntity);
    const externalAccountsRepo = manager.getRepository(ExternalAccountEntity);

    const collaboratorRole = await rolesRepo.findOneBy({ name: DEFAULT_ROLE_FOR_NEW_USERS });
    if (!collaboratorRole) {
      // Error de configuracion (falta correr el seed): que quede claro en logs, y que
      // la transaccion haga rollback en vez de crear un usuario sin rol.
      this.logger.error(
        `No existe el rol ${DEFAULT_ROLE_FOR_NEW_USERS} en la base. ¿Falta correr el seed?`,
      );
      throw new Error(`Rol por defecto "${DEFAULT_ROLE_FOR_NEW_USERS}" no encontrado.`);
    }

    const user = await usersRepo.save(
      usersRepo.create({
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        active: true,
      }),
    );

    await userRolesRepo.save(userRolesRepo.create({ userId: user.id, roleId: collaboratorRole.id }));

    await externalAccountsRepo.save(
      externalAccountsRepo.create({
        userId: user.id,
        provider: ExternalAccountProvider.GOOGLE,
        providerSubject: profile.providerSubject,
        email: profile.email,
        emailVerified: profile.emailVerified,
      }),
    );

    return user;
  }

  /** Roles globales del usuario, para /auth/me y para el JWT. */
  async getRoleNames(userId: string): Promise<string[]> {
    const rows: Array<{ name: string }> = await this.dataSource
      .getRepository(UserRoleEntity)
      .createQueryBuilder('userRole')
      .innerJoin('userRole.role', 'role')
      .select('role.name', 'name')
      .where('userRole.userId = :userId', { userId })
      .getRawMany();
    return rows.map((row) => row.name);
  }

  toAuthenticatedUserDto(user: UserEntity, roles: string[]): AuthenticatedUserDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      roles,
    };
  }

  signSessionToken(userId: string): string {
    const payload: SessionJwtPayload = { sub: userId };
    return this.jwtService.sign(payload);
  }

  setSessionCookie(response: Response, token: string): void {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN') ?? '8h';

    response.cookie(SESSION_COOKIE_NAME, token, buildSessionCookieOptions(isProduction, ms(expiresIn)));
  }

  clearSessionCookie(response: Response): void {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    response.clearCookie(SESSION_COOKIE_NAME, sessionCookieClearOptions(isProduction));
  }
}
