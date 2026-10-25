import 'reflect-metadata';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import dataSource from '../database/data-source';
import { ResourceProfilesService } from './resource-profiles.service';
import { PermissionsService } from '../auth/permissions.service';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { RoleName } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';

/**
 * ResourceProfilesService contra PostgreSQL REAL: unicidad, revision, concurrencia, auditoría atómica y permisos.
 *   pnpm --filter @tema/backend test:db
 * El servicio abre SUS PROPIAS transacciones (se confirman): los datos de prueba se crean y se BORRAN explícitamente.
 */
const SUFFIX = `res01-${Date.now()}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const name = (label: string) => `${label} ${SUFFIX}`;

let admin: RequestUser;
let pm: RequestUser;
let leader: RequestUser;
let collaborator: RequestUser;
let observer: RequestUser;
const userIds: string[] = [];
let service: ResourceProfilesService;
const buildService = (ds: object = dataSource) =>
  new ResourceProfilesService(new PermissionsService(dataSource.getRepository(ProjectMemberEntity)), ds as DataSource);

async function createUser(label: string, roles: RoleName[]): Promise<RequestUser> {
  const [{ id }] = await dataSource.query(`INSERT INTO users (email, name, active) VALUES ($1, $2, true) RETURNING id`, [`${label}-${SUFFIX}@tema-test.com`, label]);
  userIds.push(id);
  return { id, name: label, roles } as RequestUser;
}

type RawProfile = { name: string; hourly: string; currency: string; active: boolean; revision: number; updated_micro: string };
const raw = async (id: string): Promise<RawProfile> =>
  (
    await dataSource.query(
      `SELECT name, hourly_cost::text AS hourly, currency, active, revision, to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS.US') AS updated_micro FROM resource_profiles WHERE id = $1`,
      [id],
    )
  )[0];
const count = async (sql: string, params: unknown[] = []): Promise<number> => (await dataSource.query(sql, params))[0].n as number;
const mine = () => count(`SELECT count(*)::int AS n FROM resource_profiles WHERE name LIKE $1`, [`%${SUFFIX}`]);
type AuditRow = { old_values: Record<string, unknown> | null; new_values: Record<string, unknown> & { change?: { changedFields: string[] } }; user_id: string; origin: string; action: string };
const audits = async (id: string): Promise<AuditRow[]> =>
  dataSource.query(`SELECT old_values, new_values, user_id, origin, action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at, action`, [id]);

beforeAll(async () => {
  if (!dataSource.isInitialized) await dataSource.initialize();
  admin = await createUser('admin', [RoleName.ADMIN]);
  pm = await createUser('pm', [RoleName.PROGRAM_MANAGER]);
  leader = await createUser('leader', [RoleName.PROJECT_LEADER]);
  collaborator = await createUser('collab', [RoleName.COLLABORATOR]);
  observer = await createUser('obs', [RoleName.OBSERVER]);
  service = buildService();
});

afterAll(async () => {
  await dataSource.query(`DELETE FROM audit_logs WHERE entity_type = 'RESOURCE_PROFILE' AND (new_values->>'name' LIKE $1 OR old_values->>'name' LIKE $1)`, [`%${SUFFIX}`]);
  await dataSource.query(`DELETE FROM resource_profiles WHERE name LIKE $1`, [`%${SUFFIX}`]);
  await dataSource.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
  if (dataSource.isInitialized) await dataSource.destroy();
});

describe('create', () => {
  it('se guarda exacto: activo, revision 1, costo cero permitido y texto original conservado', async () => {
    const created = await service.create({ name: name('consultor SENIOR'), hourlyCost: '0.00', currency: 'USD' }, admin);
    expect(created).toMatchObject({ name: name('consultor SENIOR'), hourlyCost: '0.00', currency: 'USD', active: true, revision: 1 });
    expect(await raw(created.id)).toMatchObject({ name: name('consultor SENIOR'), hourly: '0.00', active: true, revision: 1 });
  });
  it('precisión exacta del costo por hora', async () => {
    const created = await service.create({ name: name('Preciso'), hourlyCost: '9999999999.99', currency: 'ARS' }, admin);
    expect((await raw(created.id)).hourly).toBe('9999999999.99');
  });
  it('el mismo nombre en dos monedas: permitido', async () => {
    const usd = await service.create({ name: name('Dos monedas'), hourlyCost: '50.00', currency: 'USD' }, admin);
    const ars = await service.create({ name: name('Dos monedas'), hourlyCost: '40000.00', currency: 'ARS' }, admin);
    expect([usd.currency, ars.currency]).toEqual(['USD', 'ARS']);
  });
  it('el mismo nombre (otras mayúsculas) en la misma moneda: 409 RESOURCE_PROFILE_NAME_CONFLICT y no deja auditoría', async () => {
    const first = await service.create({ name: name('Duplicado'), hourlyCost: '1.00', currency: 'USD' }, admin);
    const error = (await service.create({ name: name('DUPLICADO'), hourlyCost: '2.00', currency: 'USD' }, admin).catch((e: unknown) => e)) as ConflictException;
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'RESOURCE_PROFILE_NAME_CONFLICT' });
    expect(await count(`SELECT count(*)::int AS n FROM resource_profiles WHERE lower(name) = lower($1) AND currency = 'USD'`, [name('Duplicado')])).toBe(1);
    expect((await audits(first.id)).map((a) => a.action)).toEqual(['RESOURCE_PROFILE_CREATED']);
    expect(await count(`SELECT count(*)::int AS n FROM audit_logs WHERE entity_type = 'RESOURCE_PROFILE' AND new_values->>'name' = $1 AND new_values->>'hourlyCost' = '2.00'`, [name('DUPLICADO')])).toBe(0);
  });
  it.each([2, 5])('%s POST iguales al mismo tiempo: UNO gana y el resto 409 RESOURCE_PROFILE_NAME_CONFLICT (garantizado por el índice)', async (parallel) => {
    const label = name(`Carrera ${parallel}`);
    const results = await Promise.allSettled(Array.from({ length: parallel }, (_, i) => service.create({ name: label, hourlyCost: `${i + 1}.00`, currency: 'USD' }, admin)));
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(parallel - 1);
    for (const r of rejected) expect(r.reason).toMatchObject({ response: { code: 'RESOURCE_PROFILE_NAME_CONFLICT' } });
    expect(await count(`SELECT count(*)::int AS n FROM resource_profiles WHERE name = $1`, [label])).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'RESOURCE_PROFILE_CREATED' AND new_values->>'name' = $1`, [label])).toBe(1);
  });
  it.each([['PROGRAM_MANAGER', () => pm], ['PROJECT_LEADER', () => leader], ['COLLABORATOR', () => collaborator], ['OBSERVER', () => observer]])('%s: 403 y no se crea nada', async (_n, actor) => {
    const before = await mine();
    await expect(service.create({ name: name('Prohibido'), hourlyCost: '1.00', currency: 'USD' }, actor())).rejects.toBeInstanceOf(ForbiddenException);
    expect(await mine()).toBe(before);
  });
  it('auditoría CREATED en la MISMA transacción (xmin), origen UI, sin project_activities', async () => {
    const created = await service.create({ name: name('Auditado'), hourlyCost: '12.30', currency: 'EUR' }, admin);
    const [audit] = await audits(created.id);
    expect(audit).toMatchObject({
      action: 'RESOURCE_PROFILE_CREATED', user_id: admin.id, origin: 'UI', old_values: null,
      new_values: { name: name('Auditado'), hourlyCost: '12.30', currency: 'EUR', active: true, revision: 1 },
    });
    const [{ same }] = await dataSource.query(
      `SELECT (SELECT xmin::text FROM resource_profiles WHERE id = $1) = (SELECT xmin::text FROM audit_logs WHERE entity_id = $1) AS same`,
      [created.id],
    );
    expect(same).toBe(true);
    expect(await count(`SELECT count(*)::int AS n FROM project_activities WHERE metadata::text LIKE $1`, [`%${created.id}%`]).catch(() => 0)).toBe(0);
  });
  it('rollback: si falla la auditoría no queda el perfil', async () => {
    const failing = buildService({
      transaction: (run: (manager: unknown) => Promise<unknown>) =>
        dataSource.transaction(async (manager) =>
          run(
            new Proxy(manager, {
              get(target, prop, receiver) {
                if (prop !== 'save') return Reflect.get(target, prop, receiver);
                return async (row: object) => {
                  if (row instanceof AuditLogEntity) throw new Error('fallo simulado en la auditoría');
                  return target.save(row);
                };
              },
            }),
          ),
        ),
      manager: dataSource.manager,
    });
    await expect(failing.create({ name: name('Se revierte'), hourlyCost: '1.00', currency: 'USD' }, admin)).rejects.toThrow('fallo simulado');
    expect(await count(`SELECT count(*)::int AS n FROM resource_profiles WHERE name = $1`, [name('Se revierte')])).toBe(0);
    await expect(service.create({ name: name('Se revierte'), hourlyCost: '1.00', currency: 'USD' }, admin)).resolves.toBeDefined(); // y el nombre quedó libre
  });
});

describe('list', () => {
  it('por defecto solo activos; con includeInactive también los inactivos; orden determinístico', async () => {
    const b = await service.create({ name: name('lista b'), hourlyCost: '2.00', currency: 'USD' }, admin);
    const a = await service.create({ name: name('Lista A'), hourlyCost: '1.00', currency: 'USD' }, admin);
    const inactive = await service.create({ name: name('Lista inactivo'), hourlyCost: '3.00', currency: 'USD' }, admin);
    await service.update(inactive.id, { expectedRevision: 1, active: false }, admin);

    const ours = new Set([a.id, b.id, inactive.id]);
    const normal = (await service.list({}, admin)).filter((p) => ours.has(p.id));
    expect(normal.map((p) => p.id)).toEqual([a.id, b.id]); // sin el inactivo; orden por lower(name): "lista a" < "lista b"
    const all = (await service.list({ includeInactive: true }, admin)).filter((p) => ours.has(p.id));
    expect(all.map((p) => p.id)).toEqual([a.id, b.id, inactive.id]); // "lista b" < "lista inactivo"
    expect(all.find((p) => p.id === inactive.id)).toMatchObject({ active: false, revision: 2 });
    expect(all.every((p) => typeof p.hourlyCost === 'string')).toBe(true);
  });
  it.each([['ADMIN', () => admin], ['PROGRAM_MANAGER', () => pm], ['PROJECT_LEADER', () => leader]])('%s ve el catálogo (también con includeInactive)', async (_n, actor) => {
    await expect(service.list({}, actor())).resolves.toBeInstanceOf(Array);
    await expect(service.list({ includeInactive: true }, actor())).resolves.toBeInstanceOf(Array);
  });
  it.each([['COLLABORATOR', () => collaborator], ['OBSERVER', () => observer]])('%s: 403 completo, con o sin includeInactive', async (_n, actor) => {
    await expect(service.list({}, actor())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.list({ includeInactive: true }, actor())).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('update', () => {
  const make = (label: string, extra: Partial<{ hourlyCost: string; currency: string }> = {}) =>
    service.create({ name: name(label), hourlyCost: extra.hourlyCost ?? '50.00', currency: extra.currency ?? 'USD' }, admin);

  it('revision 1 → 2 → 3, updated_at avanza y cada campo cambia', async () => {
    const created = await make('Edita');
    const before = await raw(created.id);
    await sleep(5);
    expect(await service.update(created.id, { expectedRevision: 1, hourlyCost: '60' }, admin)).toMatchObject({ hourlyCost: '60.00', revision: 2 });
    expect(await service.update(created.id, { expectedRevision: 2, name: name('Edita renombrado') }, admin)).toMatchObject({ name: name('Edita renombrado'), revision: 3 });
    expect(await service.update(created.id, { expectedRevision: 3, currency: 'ARS', hourlyCost: '60000.50' }, admin)).toMatchObject({ currency: 'ARS', hourlyCost: '60000.50', revision: 4 });
    const after = await raw(created.id);
    expect(after.updated_micro > before.updated_micro).toBe(true);
    expect(after).toMatchObject({ name: name('Edita renombrado'), hourly: '60000.50', currency: 'ARS', revision: 4, active: true });
  });
  it.each([['PROGRAM_MANAGER', () => pm], ['PROJECT_LEADER', () => leader], ['COLLABORATOR', () => collaborator], ['OBSERVER', () => observer]])('%s: 403 y nada cambia', async (_n, actor) => {
    const created = await make(`Permiso ${_n}`);
    await expect(service.update(created.id, { expectedRevision: 1, hourlyCost: '1.00' }, actor())).rejects.toBeInstanceOf(ForbiddenException);
    expect((await raw(created.id)).revision).toBe(1);
  });
  it('perfil inexistente: 404 RESOURCE_PROFILE_NOT_FOUND', async () => {
    await expect(service.update('00000000-0000-4000-8000-000000000000', { expectedRevision: 1, name: 'x' }, admin)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('revisión vieja: 409 VERSION_CONFLICT (con currentRevision) aunque el contenido sea idéntico; no escribe ni audita', async () => {
    const created = await make('Conflicto');
    await service.update(created.id, { expectedRevision: 1, hourlyCost: '55.00' }, admin);
    const before = await raw(created.id);
    for (const body of [{ hourlyCost: '1.00' }, { hourlyCost: '55.00' }]) {
      const error = (await service.update(created.id, { expectedRevision: 1, ...body }, admin).catch((e: unknown) => e)) as ConflictException;
      expect(error.getResponse()).toMatchObject({ code: 'RESOURCE_PROFILE_VERSION_CONFLICT', currentRevision: 2 });
    }
    expect(await raw(created.id)).toEqual(before);
    expect((await audits(created.id)).length).toBe(2);
  });
  it('sin cambios: 409 NO_CHANGES; no suma revision, no toca updated_at, no audita', async () => {
    const created = await make('Sin cambios');
    await sleep(5);
    const before = await raw(created.id);
    await expect(service.update(created.id, { expectedRevision: 1, name: ` ${name('Sin cambios')} `, hourlyCost: '50', currency: 'usd', active: true }, admin)).rejects.toMatchObject({
      response: { code: 'RESOURCE_PROFILE_NO_CHANGES' },
    });
    expect(await raw(created.id)).toEqual(before);
    expect((await audits(created.id)).length).toBe(1);
  });
  it('nombre repetido en la misma moneda al editar: 409 RESOURCE_PROFILE_NAME_CONFLICT y nada cambia; cambiar la moneda a una libre sí funciona', async () => {
    await make('Choque', { currency: 'USD' });
    const other = await make('Choque otro', { currency: 'USD' });
    await expect(service.update(other.id, { expectedRevision: 1, name: name('CHOQUE') }, admin)).rejects.toMatchObject({ response: { code: 'RESOURCE_PROFILE_NAME_CONFLICT' } });
    expect((await raw(other.id)).revision).toBe(1);
    const arsCopy = await make('Choque', { currency: 'ARS' });
    await expect(service.update(arsCopy.id, { expectedRevision: 1, currency: 'USD' }, admin)).rejects.toMatchObject({ response: { code: 'RESOURCE_PROFILE_NAME_CONFLICT' } });
    await expect(service.update(arsCopy.id, { expectedRevision: 1, currency: 'EUR' }, admin)).resolves.toMatchObject({ currency: 'EUR' });
  });

  describe('active', () => {
    it('desactivar y reactivar: audita DEACTIVATED / REACTIVATED, el perfil no se borra y la asignación (snapshot) no se toca', async () => {
      const created = await make('Activo');
      const [{ id: userId }] = await dataSource.query(`SELECT id FROM users WHERE email = $1`, [`admin-${SUFFIX}@tema-test.com`]);
      const [{ id: projectId }] = await dataSource.query(
        `INSERT INTO projects (name, slug, status, leader_id, created_by) VALUES ($1, $2, 'PLANNED', $3, $3) RETURNING id`,
        [name('Proyecto RP'), `rp-${SUFFIX}`, userId],
      );
      const [{ id: memberId }] = await dataSource.query(
        `INSERT INTO project_members (project_id, user_id, project_role) VALUES ($1, $2, 'COLLABORATOR') RETURNING id`,
        [projectId, userId],
      );
      await dataSource.query(
        `INSERT INTO project_member_allocations (project_member_id, revision, is_current, resource_profile_id, profile_name_snapshot, hourly_cost_snapshot, currency_snapshot, changed_by, created_at)
         VALUES ($1, 1, true, $2, 'Snapshot', 50, 'USD', $3, now())`,
        [memberId, created.id, userId],
      );
      try {
        const off = await service.update(created.id, { expectedRevision: 1, active: false }, admin);
        expect(off).toMatchObject({ active: false, revision: 2 });
        const on = await service.update(created.id, { expectedRevision: 2, active: true }, admin);
        expect(on).toMatchObject({ active: true, revision: 3 });
        expect((await audits(created.id)).map((a) => a.action).sort()).toEqual(['RESOURCE_PROFILE_CREATED', 'RESOURCE_PROFILE_DEACTIVATED', 'RESOURCE_PROFILE_REACTIVATED']);
        const [allocation] = await dataSource.query(
          `SELECT resource_profile_id, hourly_cost_snapshot::text AS rate FROM project_member_allocations WHERE project_member_id = $1`,
          [memberId],
        );
        expect(allocation).toEqual({ resource_profile_id: created.id, rate: '50.00' }); // sigue asociada con su snapshot; nada de poner NULL
      } finally {
        await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
      }
    });
    it('desactivar junto con otro campo: acción UPDATED con ambos campos', async () => {
      const created = await make('Mixto');
      await service.update(created.id, { expectedRevision: 1, active: false, hourlyCost: '70.00' }, admin);
      const updated = (await audits(created.id)).find((a) => a.action === 'RESOURCE_PROFILE_UPDATED')!;
      expect(updated.new_values.change?.changedFields).toEqual(['hourlyCost', 'active']);
    });
  });

  describe('auditoría', () => {
    it('UPDATED: snapshots completos antes/después con revision N / N+1 y changedFields, en la misma transacción', async () => {
      const created = await make('Snap', { hourlyCost: '50.00' });
      await service.update(created.id, { expectedRevision: 1, hourlyCost: '60.00', currency: 'ARS' }, admin);
      const updated = (await audits(created.id)).find((a) => a.action === 'RESOURCE_PROFILE_UPDATED')!;
      expect(updated.user_id).toBe(admin.id);
      expect(updated.origin).toBe('UI');
      expect(updated.old_values).toEqual({ name: name('Snap'), hourlyCost: '50.00', currency: 'USD', active: true, revision: 1 });
      expect(updated.new_values).toEqual({
        name: name('Snap'), hourlyCost: '60.00', currency: 'ARS', active: true, revision: 2, change: { changedFields: ['hourlyCost', 'currency'] },
      });
      const [{ same }] = await dataSource.query(
        `SELECT (SELECT xmin::text FROM resource_profiles WHERE id = $1) = (SELECT xmin::text FROM audit_logs WHERE entity_id = $1 AND action = 'RESOURCE_PROFILE_UPDATED') AS same`,
        [created.id],
      );
      expect(same).toBe(true);
    });
    it('rollback: si falla la auditoría con el UPDATE ya hecho, el perfil conserva valores, revision y updated_at', async () => {
      const created = await make('Rollback');
      await sleep(5);
      const before = await raw(created.id);
      const failing = buildService({
        transaction: (run: (manager: unknown) => Promise<unknown>) =>
          dataSource.transaction(async (manager) =>
            run(
              new Proxy(manager, {
                get(target, prop, receiver) {
                  if (prop !== 'save') return Reflect.get(target, prop, receiver);
                  return async (row: object) => {
                    if (row instanceof AuditLogEntity) throw new Error('fallo simulado en la auditoría');
                    return target.save(row);
                  };
                },
              }),
            ),
          ),
        manager: dataSource.manager,
      });
      await expect(failing.update(created.id, { expectedRevision: 1, hourlyCost: '99.00', name: name('No debe quedar') }, admin)).rejects.toThrow('fallo simulado');
      expect(await raw(created.id)).toEqual(before);
      expect((await audits(created.id)).length).toBe(1);
      await expect(service.update(created.id, { expectedRevision: 1, hourlyCost: '99.00' }, admin)).resolves.toMatchObject({ revision: 2 });
    });
  });

  describe('concurrencia', () => {
    it.each([2, 5])('%s PATCH con expectedRevision = 1 al mismo tiempo: UNO gana (revision 2), el resto 409 con currentRevision 2; una sola auditoría UPDATED', async (editors) => {
      const created = await make(`Editores ${editors}`);
      const results = await Promise.allSettled(Array.from({ length: editors }, (_, i) => service.update(created.id, { expectedRevision: 1, hourlyCost: `${i + 1}.00` }, admin)));
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of rejected) expect(r.reason.getResponse()).toMatchObject({ code: 'RESOURCE_PROFILE_VERSION_CONFLICT', currentRevision: 2 });
      const winner = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ hourlyCost: string }>).value;
      const row = await raw(created.id);
      expect([row.revision, row.hourly]).toEqual([2, winner.hourlyCost]); // nunca last-write-wins silencioso
      expect((await audits(created.id)).filter((a) => a.action === 'RESOURCE_PROFILE_UPDATED')).toHaveLength(1);
    });
    it('ediciones consecutivas muy rápidas: cada token viejo se rechaza y revision sube de a 1', async () => {
      const created = await make('Rapidas');
      for (let revision = 1; revision <= 12; revision++) {
        await service.update(created.id, { expectedRevision: revision, hourlyCost: `${revision}.00` }, admin);
        await expect(service.update(created.id, { expectedRevision: revision, hourlyCost: '999.00' }, admin)).rejects.toMatchObject({
          response: { code: 'RESOURCE_PROFILE_VERSION_CONFLICT', currentRevision: revision + 1 },
        });
      }
      expect((await raw(created.id)).revision).toBe(13);
    });
    it('dos edición que renombran al mismo nombre libre: gana una, la otra 409 (índice o revisión)', async () => {
      const x = await make('Carrera x');
      const y = await make('Carrera y');
      const target = name('Carrera destino');
      const results = await Promise.allSettled([
        service.update(x.id, { expectedRevision: 1, name: target }, admin),
        service.update(y.id, { expectedRevision: 1, name: target }, admin),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const loser = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
      expect(loser.reason).toMatchObject({ response: { code: 'RESOURCE_PROFILE_NAME_CONFLICT' } });
      expect(await count(`SELECT count(*)::int AS n FROM resource_profiles WHERE name = $1`, [target])).toBe(1);
    });
  });
});
