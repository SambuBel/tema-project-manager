import 'reflect-metadata';
import { createHmac } from 'crypto';
import { config } from 'dotenv';
import ms from 'ms';
import dataSource from './data-source';

// data-source.ts carga primero el .env de la raiz: si ahi JWT_SECRET esta vacio, dotenv
// no lo pisa despues con el valor real de apps/backend/.env (no sobreescribe claves ya
// definidas, aunque esten vacias). Forzamos el override para que gane el .env local.
config({ path: '.env', override: true });
import { UserEntity } from './entities/user.entity';
import { RoleEntity } from './entities/role.entity';
import { UserRoleEntity } from './entities/user-role.entity';
import { RoleName } from './enums';

/**
 * SOLO DESARROLLO: crea (o reutiliza) un usuario activo con un rol global y firma a mano
 * un JWT de sesion identico al que emite AuthService.signSessionToken, para poder probar
 * endpoints protegidos (ej. en Postman) sin pasar por el login real de Google.
 *
 * Por defecto el rol es PROJECT_LEADER: desde el paso de roles/permisos, crear un
 * proyecto (POST /projects) requiere ADMIN/PROGRAM_MANAGER/PROJECT_LEADER — un
 * COLLABORATOR ya no puede. Pasar otro rol como 3er argumento si hace falta probar
 * con menos permisos (ej. COLLABORATOR para probar que un 403 sea el esperado).
 *
 * Uso:
 *   pnpm --filter @tema/backend create:dev-user -- dev@example.com "Dev User"
 *   pnpm --filter @tema/backend create:dev-user -- dev@example.com "Dev User" COLLABORATOR
 */
function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function signDevSessionToken(userId: string, secret: string, expiresIn: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresInSeconds = Math.floor(ms(expiresIn) / 1000);
  const payload = { sub: userId, iat: nowSeconds, exp: nowSeconds + expiresInSeconds };

  const headerPart = base64url(JSON.stringify(header));
  const payloadPart = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest('base64url');

  return `${headerPart}.${payloadPart}.${signature}`;
}

async function createDevUser(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const email = args[0] ?? 'dev@example.com';
  const name = args[1] ?? 'Dev User';
  const roleArg = (args[2]?.toUpperCase() ?? RoleName.PROJECT_LEADER) as RoleName;
  if (!Object.values(RoleName).includes(roleArg)) {
    throw new Error(`Rol "${args[2]}" invalido. Opciones: ${Object.values(RoleName).join(', ')}`);
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('Falta JWT_SECRET en el .env.');
  }
  const jwtExpiresIn = process.env.JWT_EXPIRES_IN ?? '8h';

  await dataSource.initialize();

  const usersRepo = dataSource.getRepository(UserEntity);
  const rolesRepo = dataSource.getRepository(RoleEntity);
  const userRolesRepo = dataSource.getRepository(UserRoleEntity);

  let user = await usersRepo.findOneBy({ email });
  if (!user) {
    user = await usersRepo.save(usersRepo.create({ email, name, active: true }));

    const role = await rolesRepo.findOneBy({ name: roleArg });
    if (!role) {
      throw new Error(`No existe el rol ${roleArg}. ¿Corriste "pnpm --filter @tema/backend seed"?`);
    }
    await userRolesRepo
      .createQueryBuilder()
      .insert()
      .into(UserRoleEntity)
      .values({ userId: user.id, roleId: role.id })
      .orIgnore()
      .execute();
  }

  await dataSource.destroy();

  const token = signDevSessionToken(user.id, jwtSecret, jwtExpiresIn);

  // eslint-disable-next-line no-console
  console.log(`Usuario: ${user.email} (id=${user.id}, rol pedido=${roleArg})`);
  // eslint-disable-next-line no-console
  console.log(`\nToken (valor de la cookie "tema_session"):\n${token}`);
  // eslint-disable-next-line no-console
  console.log(`\nHeader Cookie completo para Postman:\ntema_session=${token}`);
}

createDevUser().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('create:dev-user fallido:', err.message ?? err);
  process.exit(1);
});
