import 'reflect-metadata';
import dataSource from './data-source';

/**
 * Resetea SOLO la base de dev: dropea y recrea el schema "public" (todas las tablas,
 * enums, etc.), sin tocar el contenedor/instancia de Postgres. Pensado para volver a
 * correr `migration:run` + `seed` desde cero durante el desarrollo.
 *
 * Bloqueado en production por seguridad.
 */
async function reset(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:reset esta deshabilitado cuando NODE_ENV=production.');
  }

  await dataSource.initialize();
  await dataSource.query('DROP SCHEMA public CASCADE');
  await dataSource.query('CREATE SCHEMA public');
  await dataSource.destroy();

  // eslint-disable-next-line no-console
  console.log('Schema "public" recreado. Corre "pnpm migration:run" y luego "pnpm seed".');
}

reset().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Reset fallido:', err);
  process.exit(1);
});
