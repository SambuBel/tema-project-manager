import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ResourceProfileEntity } from './resource-profile.entity';

/**
 * Mapeo de ResourceProfileEntity SIN conectarse a la base: lo declarado acá tiene que coincidir con PostgreSQL o `schema:log`
 * propone borrar los CHECK. La verificación contra Postgres real está en resource-profiles.constraints.db-spec.ts.
 */
describe('ResourceProfileEntity - metadata', () => {
  const ds = new DataSource({ type: 'postgres', entities: [__dirname + '/../../**/*.entity.ts'] });
  let meta: ReturnType<DataSource['getMetadata']>;
  beforeAll(async () => {
    await (ds as unknown as { buildMetadatas: () => Promise<void> }).buildMetadatas();
    meta = ds.getMetadata(ResourceProfileEntity);
  });
  const column = (name: string) => meta.columns.find((c) => c.databaseName === name)!;

  it('hourly_cost es numeric(12,2) NOT NULL y string en TypeScript (RNF-19)', () => {
    const hourly = column('hourly_cost');
    expect(hourly.type).toBe('numeric');
    expect([hourly.precision, hourly.scale, hourly.isNullable]).toEqual([12, 2, false]);
    expect(Reflect.getMetadata('design:type', ResourceProfileEntity.prototype, 'hourlyCost')).toBe(String);
  });
  it('name varchar(150), currency varchar(3), active default true, todos NOT NULL', () => {
    expect([column('name').type, column('name').length, column('name').isNullable]).toEqual(['varchar', '150', false]);
    expect([column('currency').type, column('currency').length, column('currency').isNullable]).toEqual(['varchar', '3', false]);
    expect([column('active').default, column('active').isNullable]).toEqual([true, false]);
  });
  it('revision es integer NOT NULL default 1 y columna normal (no @VersionColumn)', () => {
    const revision = column('revision');
    expect([revision.type, revision.isNullable, revision.default, revision.isVersion]).toEqual(['integer', false, 1, false]);
    expect(Reflect.getMetadata('design:type', ResourceProfileEntity.prototype, 'revision')).toBe(Number);
  });
  it('NO tiene soft delete (deleted_at): solo active', () => {
    expect(meta.columns.map((c) => c.databaseName).sort()).toEqual(['active', 'created_at', 'currency', 'hourly_cost', 'id', 'name', 'revision', 'updated_at']);
  });
  it('declara los cuatro CHECK (si falta alguno, schema:log propone borrarlo)', () => {
    expect(Object.fromEntries(meta.checks.map((c) => [c.name, c.expression]))).toEqual({
      ck_resource_profiles_hourly_cost_non_negative: '"hourly_cost" >= 0',
      ck_resource_profiles_name_not_blank: 'length(btrim("name")) > 0',
      ck_resource_profiles_currency_iso_format: `"currency" ~ '^[A-Z]{3}$'`,
      ck_resource_profiles_revision_positive: '"revision" >= 1',
    });
  });
  it('el índice (lower(name), currency) está registrado SIN sincronizar (índice de expresión creado por migración)', () => {
    const index = meta.indices.find((i) => i.name === 'ux_resource_profiles_name_currency')!;
    expect(index).toBeDefined();
    expect(index.synchronize).toBe(false);
  });
});
