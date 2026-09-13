import 'reflect-metadata';
import dataSource from './data-source';
import { RoleEntity } from './entities/role.entity';
import { CostCategoryEntity } from './entities/cost-category.entity';
import { RoleName } from './enums';

/**
 * Seed minimo de desarrollo: solo catalogos (roles globales y rubros de costo).
 * No crea usuarios reales de TEMA ni datos productivos. Idempotente: puede correrse
 * varias veces sin duplicar filas (ON CONFLICT DO NOTHING sobre las columnas unicas).
 */
async function seed(): Promise<void> {
  await dataSource.initialize();

  await dataSource
    .createQueryBuilder()
    .insert()
    .into(RoleEntity)
    .values(Object.values(RoleName).map((name) => ({ name })))
    .orIgnore()
    .execute();

  const costCategories = [
    'Recursos humanos',
    'Licencias y software',
    'Servicios de terceros',
    'Viáticos y traslados',
    'Otros',
  ];

  await dataSource
    .createQueryBuilder()
    .insert()
    .into(CostCategoryEntity)
    .values(costCategories.map((name) => ({ name })))
    .orIgnore()
    .execute();

  // eslint-disable-next-line no-console
  console.log(
    `Seed OK: ${Object.values(RoleName).length} roles, ${costCategories.length} rubros de costo.`,
  );

  await dataSource.destroy();
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed fallido:', err);
  process.exit(1);
});
