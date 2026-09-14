import 'reflect-metadata';
import dataSource from './data-source';
import { AuthorizedDomainEntity } from './entities/authorized-domain.entity';

/**
 * Inserta (idempotente) UN dominio autorizado para desarrollo, tomado de argv o de
 * AUTHORIZED_DOMAIN_DEV en .env. No se hardcodea ningun dominio real de TEMA.
 *
 * Uso:
 *   pnpm --filter @tema/backend seed:dev-domain -- tudominio.com
 *   # o, si AUTHORIZED_DOMAIN_DEV esta en .env:
 *   pnpm --filter @tema/backend seed:dev-domain
 */
function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase();
}

async function seedDevDomain(): Promise<void> {
  const raw = process.argv[2] ?? process.env.AUTHORIZED_DOMAIN_DEV;
  if (!raw) {
    throw new Error(
      'Falta el dominio. Pasalo como argumento ("pnpm ... seed:dev-domain -- midominio.com") ' +
        'o definí AUTHORIZED_DOMAIN_DEV en tu .env.',
    );
  }
  const domain = normalizeDomain(raw);

  await dataSource.initialize();
  await dataSource
    .createQueryBuilder()
    .insert()
    .into(AuthorizedDomainEntity)
    .values({ domain, active: true })
    .orIgnore()
    .execute();
  await dataSource.destroy();

  // eslint-disable-next-line no-console
  console.log(`Dominio autorizado de dev asegurado: "${domain}".`);
}

seedDevDomain().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('seed:dev-domain fallido:', err.message ?? err);
  process.exit(1);
});
