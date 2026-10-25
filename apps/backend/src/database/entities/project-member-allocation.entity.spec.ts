import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ProjectMemberAllocationEntity } from './project-member-allocation.entity';
import { ProjectMemberEntity } from './project-member.entity';

/**
 * Mapeo de las entidades SIN conectarse a la base: lo declarado acá tiene que coincidir con PostgreSQL o `schema:log` propone
 * borrar CHECK y renombrar FK. La verificación contra Postgres real está en project-member-allocations.constraints.db-spec.ts.
 */
describe('ProjectMemberAllocationEntity / ProjectMemberEntity - metadata', () => {
  const ds = new DataSource({ type: 'postgres', entities: [__dirname + '/../../**/*.entity.ts'] });
  let allocations: ReturnType<DataSource['getMetadata']>;
  let members: ReturnType<DataSource['getMetadata']>;
  beforeAll(async () => {
    await (ds as unknown as { buildMetadatas: () => Promise<void> }).buildMetadatas();
    allocations = ds.getMetadata(ProjectMemberAllocationEntity);
    members = ds.getMetadata(ProjectMemberEntity);
  });
  const column = (name: string) => allocations.columns.find((c) => c.databaseName === name)!;

  it('project_members es SOLO organizativo: sin perfil, horas ni ninguna columna económica', () => {
    expect(members.columns.map((c) => c.databaseName).sort()).toEqual(['id', 'joined_at', 'project_id', 'project_role', 'removed_at', 'user_id']);
  });
  it('las FK de project_members tienen los nombres de la base', () => {
    expect(Object.fromEntries(members.foreignKeys.map((fk) => [fk.columnNames[0], fk.name]))).toEqual({ project_id: 'fk_pm_project', user_id: 'fk_pm_user' });
  });
  it('NO duplica project_id (se obtiene por el miembro)', () => {
    expect(allocations.columns.some((c) => c.databaseName === 'project_id')).toBe(false);
  });
  it('importes: numeric con la precisión esperada y string en TypeScript (RNF-19)', () => {
    expect([column('hourly_cost_snapshot').precision, column('hourly_cost_snapshot').scale]).toEqual([12, 2]);
    expect([column('estimated_hours').precision, column('estimated_hours').scale]).toEqual([8, 2]);
    expect([column('estimated_cost_snapshot').precision, column('estimated_cost_snapshot').scale]).toEqual([18, 2]);
    // `string | null` se emite como Object en design:type: lo importante es que NUNCA sea Number
    for (const prop of ['hourlyCostSnapshot', 'estimatedHours', 'estimatedCostSnapshot']) {
      expect(Reflect.getMetadata('design:type', ProjectMemberAllocationEntity.prototype, prop)).not.toBe(Number);
    }
    for (const prop of ['hourlyCostSnapshot', 'estimatedHours', 'estimatedCostSnapshot']) {
      expect(allocations.columns.find((c) => c.propertyName === prop)!.type).toBe('numeric'); // el tipo de columna es numeric, no float
    }
  });
  it('origin usa el mismo enum que audit_logs y project_activities', () => {
    expect(column('origin').enumName).toBe('audit_origin_enum');
    expect(column('origin').default).toBe('UI');
  });
  it('declara los CHECK (si falta alguno, schema:log propone borrarlo)', () => {
    expect(allocations.checks.map((c) => c.name).sort()).toEqual(
      [
        'ck_pm_allocations_revision_positive', 'ck_pm_allocations_current_not_superseded', 'ck_pm_allocations_profile_snapshot_consistent',
        'ck_pm_allocations_currency_iso_format', 'ck_pm_allocations_hourly_cost_non_negative', 'ck_pm_allocations_estimated_hours_non_negative',
        'ck_pm_allocations_estimated_cost_non_negative', 'ck_pm_allocations_cost_presence', 'ck_pm_allocations_cost_matches_inputs',
      ].sort(),
    );
  });
  it('FK con nombre y reglas de borrado: miembro CASCADE, perfil RESTRICT, usuario RESTRICT', () => {
    const byColumn = Object.fromEntries(allocations.foreignKeys.map((fk) => [fk.columnNames[0], [fk.name, fk.onDelete]]));
    expect(byColumn).toEqual({
      project_member_id: ['fk_pm_allocations_member', 'CASCADE'],
      resource_profile_id: ['fk_pm_allocations_profile', 'RESTRICT'],
      budget_id: ['fk_pm_allocations_budget', 'NO ACTION'],
      changed_by: ['fk_pm_allocations_changed_by', 'RESTRICT'],
    });
  });
  it('índices: único (miembro, revision) y único parcial de la vigente', () => {
    const unique = allocations.indices.find((i) => i.name === 'ux_pm_allocations_member_revision')!;
    expect(unique.isUnique).toBe(true);
    expect(unique.columns.map((c) => c.databaseName)).toEqual(['project_member_id', 'revision']);
    const current = allocations.indices.find((i) => i.name === 'ux_pm_allocations_one_current')!;
    expect(current.isUnique).toBe(true);
    expect(current.where).toBe('"is_current" = true');
  });
});
