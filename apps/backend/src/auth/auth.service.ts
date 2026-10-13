import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Response } from 'express';
import ms from 'ms';
import { UserEntity } from '../database/entities/user.entity';
import { UserRoleEntity } from '../database/entities/user-role.entity';
import { ExternalAccountEntity } from '../database/entities/external-account.entity';
import { AuthorizedDomainEntity } from '../database/entities/authorized-domain.entity';
import { ExternalAccountProvider } from '../database/enums';
import { GoogleProfileDto } from './dto/google-profile.dto';
import { AuthenticatedUserDto } from './dto/authenticated-user.dto';
import { AUTH_ERROR_CODES, AuthError } from './auth.errors';
import { getDummyPasswordHash, normalizeEmail, verifyPassword } from './password';
import { buildSessionCookieOptions, SESSION_COOKIE_NAME, sessionCookieClearOptions } from './auth.constants';

export interface SessionJwtPayload {
  sub: string;
}

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
   * Usuario por email SIN distinguir mayúsculas y CON bajas lógicas: un usuario desactivado tiene
   * deleted_at (ver UsersService.setActive), y hay que distinguirlo de "no existe" para poder
   * responder "deshabilitado". `includePasswordHash` trae la columna que normalmente no se selecciona.
   * Es SOLO lectura: este método (y todo el login) nunca crea ni modifica usuarios.
   */
  private findUserByEmail(email: string, includePasswordHash = false): Promise<UserEntity | null> {
    const qb = this.dataSource
      .getRepository(UserEntity)
      .createQueryBuilder('user')
      .withDeleted()
      .where('LOWER(user.email) = :email', { email: normalizeEmail(email) })
      .orderBy('user.createdAt', 'ASC');
    if (includePasswordHash) qb.addSelect('user.passwordHash');
    return qb.getOne();
  }

  /**
   * Login con email + contraseña. Autentica, NO provisiona: solo entra quien ya existe.
   * Email inexistente, usuario sin contraseña (solo Google) y contraseña incorrecta devuelven el MISMO
   * error (INVALID_CREDENTIALS) y gastan el mismo tiempo (verificación contra un hash señuelo), para no
   * revelar qué emails existen. "Deshabilitado" se informa recién DESPUÉS de acertar la contraseña.
   */
  async loginWithPassword(email: string, password: string): Promise<UserEntity> {
    const user = await this.findUserByEmail(email, true);
    const hash = user?.passwordHash ?? null;

    const passwordMatches = await verifyPassword(hash ?? (await getDummyPasswordHash()), password);
    if (!user || !hash || !passwordMatches) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
    }

    this.assertUserIsActive(user);
    user.passwordHash = null; // el hash no sale de este método
    return user;
  }

  /**
   * Login con Google. Valida email_verified y dominio autorizado (validación adicional: ya NO alcanza
   * para crear cuentas) y recién entonces busca un usuario EXISTENTE. Si no existe: USER_NOT_REGISTERED
   * y no se persiste nada (ni users, ni user_roles, ni external_accounts). Solo para un usuario ya
   * existente y activo se vincula la cuenta de Google; los roles jamás se tocan.
   */
  async loginWithGoogle(profile: GoogleProfileDto): Promise<UserEntity> {
    if (!profile.emailVerified) {
      throw new AuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
    }

    const authorized = await this.isDomainAuthorized(profile.email);
    if (!authorized) {
      throw new AuthError(AUTH_ERROR_CODES.UNAUTHORIZED_DOMAIN);
    }

    const usersRepo = this.dataSource.getRepository(UserEntity);

    // Cuenta de Google ya vinculada: se recupera su usuario.
    const existingAccount = await this.externalAccountsRepository.findOne({
      where: { provider: ExternalAccountProvider.GOOGLE, providerSubject: profile.providerSubject },
      relations: { user: true },
    });
    if (existingAccount) {
      const user = existingAccount.user ?? (await usersRepo.findOneBy({ id: existingAccount.userId }));
      this.assertUserIsActive(user);
      // Mantenemos el email/verificación de la cuenta externa al día con lo último que dijo Google.
      if (existingAccount.email !== profile.email || existingAccount.emailVerified !== profile.emailVerified) {
        await this.externalAccountsRepository.update(existingAccount.id, {
          email: profile.email,
          emailVerified: profile.emailVerified,
        });
      }
      return user!;
    }

    // Primera vez con esta cuenta de Google: el usuario TIENE que existir ya.
    const user = await this.findUserByEmail(profile.email);
    if (!user) {
      throw new AuthError(AUTH_ERROR_CODES.USER_NOT_REGISTERED);
    }
    this.assertUserIsActive(user);

    await this.externalAccountsRepository.save(
      this.externalAccountsRepository.create({
        userId: user.id,
        provider: ExternalAccountProvider.GOOGLE,
        providerSubject: profile.providerSubject,
        email: profile.email,
        emailVerified: profile.emailVerified,
      }),
    );
    return user;
  }

  private assertUserIsActive(user: UserEntity | null): void {
    if (!user || !user.active || user.deletedAt) {
      throw new AuthError(AUTH_ERROR_CODES.USER_DISABLED);
    }
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
