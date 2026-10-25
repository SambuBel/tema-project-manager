import 'reflect-metadata';
import { ConflictException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import {
  RESOURCE_PROFILE_CREATED_ACTION,
  RESOURCE_PROFILE_DEACTIVATED_ACTION,
  RESOURCE_PROFILE_REACTIVATED_ACTION,
  RESOURCE_PROFILE_UPDATED_ACTION,
  ResourceProfilesService,
} from './resource-profiles.service';
import { PermissionsService } from '../auth/permissions.service';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { ResourceProfileEntity } from '../database/entities/resource-profile.entity';
import { AuditEntityType, AuditOrigin, RoleName } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const user = (id: string, roles: RoleName[]): RequestUser => ({ id, name: id, roles }) as RequestUser;
const admin = user('admin-1', [RoleName.ADMIN]);
const pm = user('pm-1', [RoleName.PROGRAM_MANAGER]);
const leader = user('lead-1', [RoleName.PROJECT_LEADER]);
const collaborator = user('c', [RoleName.COLLABORATOR]);
const observer = user('o', [RoleName.OBSERVER]);

const current = { id: PROFILE_ID, name: 'Consultor Senior', hourlyCost: '50.00', currency: 'USD', active: true, revision: 2 };
const row = (extra: Record<string, unknown> = {}) => ({
  ...current, revision: 3, createdAt: new Date('2026-10-25T15:00:00Z'), updatedAt: new Date('2026-10-26T15:00:00.123Z'), ...extra,
});

type Opts = { profile?: typeof current | null; failOn?: 'audit' | 'update'; unique?: boolean; updateResult?: unknown };

function build(opts: Opts = {}) {
  const calls: string[] = [];
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  const saved: Array<Record<string, unknown>> = [];
  const profile = opts.profile === undefined ? current : opts.profile;
  const manager = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FOR UPDATE')) {
        calls.push('lock-profile');
        return profile ? [profile] : [];
      }
      if (sql.startsWith('UPDATE resource_profiles')) {
        calls.push('update-profile');
        if (opts.failOn === 'update') throw new Error('falló el update');
        if (opts.unique) throw Object.assign(new Error('dup'), { driverError: { code: '23505', constraint: 'ux_resource_profiles_name_currency' } });
        updates.push({ sql, params });
        return opts.updateResult ?? [[{ revision: current.revision + 1 }], 1];
      }
      calls.push('read-profile');
      return [row()];
    }),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => ({ __entity: entity, ...data })),
    save: jest.fn(async (r: Record<string, unknown>) => {
      const isAudit = r.__entity === AuditLogEntity;
      calls.push(isAudit ? 'save-audit' : 'save-profile');
      if (opts.failOn === 'audit' && isAudit) throw new Error('falló la auditoría');
      if (opts.unique && !isAudit) throw Object.assign(new Error('dup'), { driverError: { code: '23505', constraint: 'ux_resource_profiles_name_currency' } });
      const result = isAudit ? r : { id: PROFILE_ID, ...r };
      saved.push(result);
      return result;
    }),
  };
  const listQuery = jest.fn(async () => [row()]);
  const dataSource = { transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)), manager: { query: listQuery } };
  const service = new ResourceProfilesService(new PermissionsService({ findOne: jest.fn() } as never), dataSource as never);
  return { service, manager, dataSource, calls, updates, saved, listQuery };
}

const errorOf = async (p: Promise<unknown>) => p.catch((e: unknown) => e);
type SavedAudit = { action: string; newValues: { change: { changedFields: string[] } } };
const audit = (saved: Array<Record<string, unknown>>) => saved.find((r) => r.__entity === AuditLogEntity) as unknown as SavedAudit;

describe('ResourceProfilesService.list', () => {
  it.each([['ADMIN', admin], ['PROGRAM_MANAGER', pm], ['PROJECT_LEADER', leader]])('%s: ve el catálogo', async (_n, actor) => {
    const { service } = build();
    const result = await service.list({}, actor);
    expect(result[0]).toEqual({
      id: PROFILE_ID, name: 'Consultor Senior', hourlyCost: '50.00', currency: 'USD', active: true, revision: 3,
      createdAt: '2026-10-25T15:00:00.000Z', updatedAt: '2026-10-26T15:00:00.123Z',
    });
  });
  it.each([['COLLABORATOR', collaborator], ['OBSERVER', observer]])('%s: 403 COMPLETO (nunca una lista parcial) y no consulta nada', async (_n, actor) => {
    const { service, listQuery } = build();
    const error = await errorOf(service.list({ includeInactive: true }, actor));
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(listQuery).not.toHaveBeenCalled();
    expect(JSON.stringify((error as ForbiddenException).getResponse())).not.toMatch(/Consultor|50\.00|USD/);
  });
  it('por defecto trae solo activos; con includeInactive trae todos (el permiso no cambia)', async () => {
    const { service, listQuery } = build();
    await service.list({}, admin);
    await service.list({ includeInactive: true }, admin);
    await service.list({ includeInactive: false }, admin);
    expect(listQuery.mock.calls.map((c) => (c as unknown as unknown[][])[1])).toEqual([[false], [true], [false]]);
    expect(String((listQuery.mock.calls[0] as unknown[])[0])).toMatch(/\(\$1::boolean OR active\)/);
  });
  it('orden determinístico: lower(name), name, currency, id', async () => {
    const { service, listQuery } = build();
    await service.list({}, admin);
    expect(String((listQuery.mock.calls[0] as unknown[])[0])).toMatch(/ORDER BY lower\(name\) ASC, name ASC, currency ASC, id ASC/);
  });
  it('el costo/hora siempre es texto', async () => {
    const { service } = build();
    expect(typeof (await service.list({}, admin))[0]!.hourlyCost).toBe('string');
  });
});

describe('ResourceProfilesService.create', () => {
  const dto = { name: 'Consultor Senior', hourlyCost: '50.00', currency: 'USD' };

  it('ADMIN crea: activo, revision 1, y devuelve el perfil', async () => {
    const { service, saved } = build();
    await expect(service.create(dto, admin)).resolves.toMatchObject({ id: PROFILE_ID, name: 'Consultor Senior' });
    expect(saved[0]).toMatchObject({ __entity: ResourceProfileEntity, name: 'Consultor Senior', hourlyCost: '50.00', currency: 'USD', active: true, revision: 1 });
  });
  it.each([['PROGRAM_MANAGER (provisional)', pm], ['PROJECT_LEADER', leader], ['COLLABORATOR', collaborator], ['OBSERVER', observer]])('%s: 403 y no abre transacción', async (_n, actor) => {
    const { service, dataSource } = build();
    await expect(service.create(dto, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
  it('el costo/hora cero se guarda', async () => {
    const { service, saved } = build();
    await service.create({ ...dto, hourlyCost: '0.00' }, admin);
    expect(saved[0]!.hourlyCost).toBe('0.00');
  });
  it('conserva el nombre tal cual (no cambia mayúsculas)', async () => {
    const { service, saved } = build();
    await service.create({ ...dto, name: 'consultor SENIOR' }, admin);
    expect(saved[0]!.name).toBe('consultor SENIOR');
  });
  it('auditoría RESOURCE_PROFILE_CREATED: oldValues null, snapshot con revision 1, origen UI', async () => {
    const { service, saved } = build();
    await service.create(dto, admin);
    expect(RESOURCE_PROFILE_CREATED_ACTION).toBe('RESOURCE_PROFILE_CREATED');
    expect(audit(saved)).toMatchObject({
      entityType: AuditEntityType.RESOURCE_PROFILE, entityId: PROFILE_ID, action: 'RESOURCE_PROFILE_CREATED', userId: 'admin-1', origin: AuditOrigin.UI,
      oldValues: null, newValues: { name: 'Consultor Senior', hourlyCost: '50.00', currency: 'USD', active: true, revision: 1 },
    });
  });
  it('perfil y auditoría en UNA transacción; solo esas dos entidades (nada en project_activities)', async () => {
    const { service, dataSource, manager } = build();
    await service.create(dto, admin);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.create.mock.calls.map((c) => c[0])).toEqual([ResourceProfileEntity, AuditLogEntity]);
  });
  it('nombre duplicado en la misma moneda (violación del índice 23505): 409 RESOURCE_PROFILE_NAME_CONFLICT', async () => {
    const { service } = build({ unique: true });
    const error = (await errorOf(service.create(dto, admin))) as ConflictException;
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'RESOURCE_PROFILE_NAME_CONFLICT' });
  });
  it('otro error de unicidad (de otra restricción) NO se disfraza de conflicto de nombre', async () => {
    const { service, manager } = build();
    manager.save.mockRejectedValueOnce(Object.assign(new Error('pk'), { driverError: { code: '23505', constraint: 'pk_resource_profiles' } }));
    await expect(service.create(dto, admin)).rejects.not.toBeInstanceOf(ConflictException);
  });
  it('si falla la auditoría el error se propaga (rollback)', async () => {
    const { service } = build({ failOn: 'audit' });
    await expect(service.create(dto, admin)).rejects.toThrow('falló la auditoría');
  });
});

describe('ResourceProfilesService.update', () => {
  const patch = (extra: Record<string, unknown> = {}) => ({ expectedRevision: 2, ...extra });

  it('ADMIN edita; PROGRAM_MANAGER, PROJECT_LEADER, COLLABORATOR y OBSERVER reciben 403 sin abrir transacción', async () => {
    const ok = build();
    await expect(ok.service.update(PROFILE_ID, patch({ name: 'Otro' }), admin)).resolves.toBeDefined();
    for (const actor of [pm, leader, collaborator, observer]) {
      const { service, dataSource } = build();
      await expect(service.update(PROFILE_ID, patch({ name: 'Otro' }), actor)).rejects.toBeInstanceOf(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    }
  });
  it('perfil inexistente: 404 RESOURCE_PROFILE_NOT_FOUND y no se escribe nada', async () => {
    const { service, calls } = build({ profile: null });
    const error = (await errorOf(service.update(PROFILE_ID, patch({ name: 'x' }), admin))) as NotFoundException;
    expect(error.getResponse()).toMatchObject({ code: 'RESOURCE_PROFILE_NOT_FOUND' });
    expect(calls).toEqual(['lock-profile']);
  });
  it('bloquea la fila FOR UPDATE, escribe y audita (sin lock de proyecto: es un catálogo global)', async () => {
    const { service, calls, manager } = build();
    await service.update(PROFILE_ID, patch({ name: 'Otro' }), admin);
    expect(calls).toEqual(['lock-profile', 'update-profile', 'save-audit', 'read-profile']);
    for (const call of manager.query.mock.calls) expect(String(call[0])).not.toMatch(/FROM projects/);
  });

  describe('expectedRevision', () => {
    it('desactualizado: 409 RESOURCE_PROFILE_VERSION_CONFLICT con currentRevision, sin tarifa, sin escrituras', async () => {
      const { service, calls } = build();
      const error = (await errorOf(service.update(PROFILE_ID, patch({ expectedRevision: 1, name: 'Otro' }), admin))) as ConflictException;
      expect(error.getResponse()).toMatchObject({ code: 'RESOURCE_PROFILE_VERSION_CONFLICT', currentRevision: 2 });
      expect(JSON.stringify(error.getResponse())).not.toMatch(/50\.00|USD/);
      expect(calls).not.toContain('update-profile');
      expect(calls).not.toContain('save-audit');
    });
    it('se valida ANTES de "sin cambios": revisión vieja con contenido idéntico → VERSION_CONFLICT', async () => {
      const { service } = build();
      await expect(service.update(PROFILE_ID, patch({ expectedRevision: 1, name: current.name }), admin)).rejects.toMatchObject({
        response: { code: 'RESOURCE_PROFILE_VERSION_CONFLICT' },
      });
    });
    it('el incremento es una sola sentencia: revision = revision + 1 con clock_timestamp()', async () => {
      const { service, updates } = build();
      await service.update(PROFILE_ID, patch({ hourlyCost: '60.00' }), admin);
      expect(updates[0]!.sql).toMatch(/revision = revision \+ 1/);
      expect(updates[0]!.sql).toMatch(/updated_at = clock_timestamp\(\)/);
    });
  });

  describe('sin cambios', () => {
    it('todo igual → 409 RESOURCE_PROFILE_NO_CHANGES, sin UPDATE ni auditoría', async () => {
      const { service, calls } = build();
      const error = (await errorOf(service.update(PROFILE_ID, patch({ name: ' Consultor Senior ', hourlyCost: '50', currency: ' usd ', active: true }), admin))) as ConflictException;
      expect(error.getResponse()).toMatchObject({ code: 'RESOURCE_PROFILE_NO_CHANGES' });
      expect(calls).not.toContain('update-profile');
      expect(calls).not.toContain('save-audit');
    });
    it('solo expectedRevision también es "sin cambios"', async () => {
      const { service } = build();
      await expect(service.update(PROFILE_ID, patch(), admin)).rejects.toMatchObject({ response: { code: 'RESOURCE_PROFILE_NO_CHANGES' } });
    });
    it('cambiar solo las mayúsculas del nombre SÍ es un cambio (el texto original se conserva)', async () => {
      const { service, updates } = build();
      await service.update(PROFILE_ID, patch({ name: 'consultor senior' }), admin);
      expect(updates[0]!.params[0]).toBe('consultor senior');
    });
  });

  describe('qué se escribe', () => {
    it.each([
      ['name', { name: ' Nuevo ' }, 'name = $1', 'Nuevo'],
      ['hourlyCost', { hourlyCost: '60' }, 'hourly_cost = $1', '60.00'],
      ['currency', { currency: 'ars' }, 'currency = $1', 'ARS'],
      ['active', { active: false }, 'active = $1', false],
    ])('solo %s: UPDATE de esa columna', async (_f, body, assignment, value) => {
      const { service, updates } = build();
      await service.update(PROFILE_ID, patch(body), admin);
      expect(updates[0]!.sql).toContain(assignment);
      expect(updates[0]!.params).toEqual([value, PROFILE_ID]);
    });
    it('varios campos juntos: solo los que cambian', async () => {
      const { service, updates } = build();
      await service.update(PROFILE_ID, patch({ name: 'Otro', currency: 'USD', hourlyCost: '70.50' }), admin);
      expect(updates[0]!.sql).toMatch(/name = \$1, hourly_cost = \$2/);
      expect(updates[0]!.sql).not.toMatch(/currency =/);
    });
    it('la tarifa viaja como texto exacto (sin Number)', async () => {
      const { service, updates } = build();
      await service.update(PROFILE_ID, patch({ hourlyCost: '9999999999.99' }), admin);
      expect(updates[0]!.params[0]).toBe('9999999999.99');
    });
    it('nombre duplicado en la misma moneda al editar (índice): 409 RESOURCE_PROFILE_NAME_CONFLICT', async () => {
      const { service } = build({ unique: true });
      await expect(service.update(PROFILE_ID, patch({ name: 'Existente' }), admin)).rejects.toMatchObject({ response: { code: 'RESOURCE_PROFILE_NAME_CONFLICT' } });
    });
  });

  describe('auditoría', () => {
    it('UPDATED: snapshots completos con revision N / N+1 y changedFields en orden determinístico', async () => {
      const { service, saved } = build();
      await service.update(PROFILE_ID, patch({ currency: 'ARS', name: 'Otro', hourlyCost: '40000', active: false }), admin);
      expect(RESOURCE_PROFILE_UPDATED_ACTION).toBe('RESOURCE_PROFILE_UPDATED');
      expect(audit(saved)).toMatchObject({
        entityType: AuditEntityType.RESOURCE_PROFILE, entityId: PROFILE_ID, action: 'RESOURCE_PROFILE_UPDATED', userId: 'admin-1', origin: AuditOrigin.UI,
        oldValues: { name: 'Consultor Senior', hourlyCost: '50.00', currency: 'USD', active: true, revision: 2 },
        newValues: { name: 'Otro', hourlyCost: '40000.00', currency: 'ARS', active: false, revision: 3, change: { changedFields: ['name', 'hourlyCost', 'currency', 'active'] } },
      });
    });
    it('solo active true → false: RESOURCE_PROFILE_DEACTIVATED', async () => {
      const { service, saved } = build();
      await service.update(PROFILE_ID, patch({ active: false }), admin);
      expect(RESOURCE_PROFILE_DEACTIVATED_ACTION).toBe('RESOURCE_PROFILE_DEACTIVATED');
      expect(audit(saved).action).toBe('RESOURCE_PROFILE_DEACTIVATED');
      expect(audit(saved).newValues.change.changedFields).toEqual(['active']);
    });
    it('solo active false → true: RESOURCE_PROFILE_REACTIVATED', async () => {
      const { service, saved } = build({ profile: { ...current, active: false } });
      await service.update(PROFILE_ID, patch({ active: true }), admin);
      expect(RESOURCE_PROFILE_REACTIVATED_ACTION).toBe('RESOURCE_PROFILE_REACTIVATED');
      expect(audit(saved).action).toBe('RESOURCE_PROFILE_REACTIVATED');
    });
    it('active junto con otro campo: RESOURCE_PROFILE_UPDATED (no oculta el resto bajo una acción de estado)', async () => {
      const { service, saved } = build();
      await service.update(PROFILE_ID, patch({ active: false, hourlyCost: '1.00' }), admin);
      expect(audit(saved).action).toBe('RESOURCE_PROFILE_UPDATED');
      expect(audit(saved).newValues.change.changedFields).toEqual(['hourlyCost', 'active']);
    });
    it('una sola fila de auditoría, nada fuera de audit_logs', async () => {
      const { service, manager } = build();
      await service.update(PROFILE_ID, patch({ name: 'x' }), admin);
      expect(manager.create.mock.calls.map((c) => c[0])).toEqual([AuditLogEntity]);
    });
    it.each(['audit', 'update'] as const)('si falla %s el error se propaga (rollback)', async (failOn) => {
      const { service } = build({ failOn });
      await expect(service.update(PROFILE_ID, patch({ name: 'x' }), admin)).rejects.toBeDefined();
    });
    it('si el UPDATE no devuelve la revisión esperada falla en vez de seguir', async () => {
      const { service, saved } = build({ updateResult: [[], 0] });
      await expect(service.update(PROFILE_ID, patch({ name: 'x' }), admin)).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(saved).toHaveLength(0);
    });
  });

  it('cambiar tarifa o moneda NO propaga nada: ninguna consulta toca project_members, costos ni presupuestos', async () => {
    const { service, manager } = build();
    await service.update(PROFILE_ID, patch({ hourlyCost: '60', currency: 'ARS' }), admin);
    for (const call of manager.query.mock.calls) expect(String(call[0])).not.toMatch(/project_members|costs|budgets|exchange_rates/);
  });
});
