import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { ResourceAllocationsService } from './resource-allocations.service';
import { PermissionsService } from '../auth/permissions.service';
import { ProjectEntity } from '../projects/project.entity';
import { RoleName } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const PROFILE_SENIOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROFILE_ARCH = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BUDGET_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LEADER_ID = 'leader-1';
const user = (id: string, roles: RoleName[]): RequestUser => ({ id, name: `Nombre ${id}`, roles }) as RequestUser;
const admin = user('admin-1', [RoleName.ADMIN]);
const pm = user('pm-1', [RoleName.PROGRAM_MANAGER]);
const realLeader = user(LEADER_ID, [RoleName.PROJECT_LEADER]);
const foreignLeader = user('otro', [RoleName.PROJECT_LEADER]);
const collaborator = user('c', [RoleName.COLLABORATOR]);
const observer = user('o', [RoleName.OBSERVER]);
const project = { id: PROJECT_ID, leaderId: LEADER_ID, slug: 'mi-proyecto' } as ProjectEntity;

type Current = { revision: number; resourceProfileId: string | null; profileName: string | null; hourlyCost: string | null; currency: string | null; estimatedHours: string | null };
// Revisión 3 vigente: Senior USD 50/h, 100 h
const current: Current = { revision: 3, resourceProfileId: PROFILE_SENIOR, profileName: 'Consultor Senior', hourlyCost: '50.00', currency: 'USD', estimatedHours: '100.00' };
const emptyProfile: Current = { revision: 1, resourceProfileId: null, profileName: null, hourlyCost: null, currency: null, estimatedHours: null };

type Opts = {
  current?: Current | null;
  memberExists?: boolean;
  catalog?: { id: string; name: string; hourlyCost: string; currency: string; active: boolean } | null;
  budget?: { id: string; version: number; maxVersion: number } | null;
  budgetVersions?: number;
  supersededRows?: number;
};

function build(opts: Opts = {}) {
  const calls: string[] = [];
  const inserts: unknown[][] = [];
  const updates: unknown[][] = [];
  const queries: string[] = [];
  const cur = opts.current === undefined ? current : opts.current;
  const NOW = '2026-10-25 15:00:00.123456-03';

  const manager = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push(sql);
      if (sql.includes('FROM projects')) {
        calls.push('lock-project');
        expect(sql).toContain('FOR SHARE');
        return [{ id: PROJECT_ID }];
      }
      if (sql.includes('FROM project_members') && sql.includes('FOR UPDATE')) {
        calls.push('lock-member');
        expect(sql).toContain('removed_at IS NULL');
        return opts.memberExists === false ? [] : [{ id: MEMBER_ID }];
      }
      if (sql.includes('FROM project_member_allocations WHERE project_member_id = $1 AND is_current')) {
        calls.push('read-current');
        return cur ? [cur] : [];
      }
      if (sql.includes('FROM resource_profiles')) {
        calls.push('lock-profile');
        expect(sql).toContain('FOR SHARE');
        return opts.catalog === null ? [] : [opts.catalog ?? { id: PROFILE_ARCH, name: 'Arquitecto', hourlyCost: '80.00', currency: 'USD', active: true }];
      }
      if (sql.includes('COUNT(*)::int AS total FROM budgets')) {
        calls.push('count-budgets');
        return [{ total: opts.budgetVersions ?? 0 }];
      }
      if (sql.includes('FROM budgets')) {
        calls.push('read-budget');
        expect(sql).toContain('is_current = true');
        return opts.budget === null ? [] : [opts.budget ?? { id: BUDGET_ID, version: 2, maxVersion: 2 }];
      }
      if (sql.includes('clock_timestamp()')) {
        calls.push('clock');
        return [{ now: NOW, nextRevision: (cur?.revision ?? 0) + 1 }];
      }
      if (sql.startsWith('UPDATE project_member_allocations')) {
        calls.push('supersede');
        updates.push(params);
        return opts.supersededRows === 0 ? [[], 0] : [[{ id: 'x' }], 1];
      }
      if (sql.includes('INSERT INTO project_member_allocations')) {
        calls.push('insert');
        inserts.push(params);
        return [];
      }
      calls.push('read-result');
      return [
        {
          projectMemberId: MEMBER_ID, userId: 'u1', userName: 'Ana', revision: 4, isCurrent: true, resourceProfileId: PROFILE_SENIOR, profileName: 'Consultor Senior',
          hourlyCost: '50.00', currency: 'USD', estimatedHours: '120.00', estimatedCost: '6000.00', budgetId: BUDGET_ID, budgetVersion: 2,
          createdAt: new Date('2026-10-25T18:00:00Z'), supersededAt: null, origin: 'UI', changedById: 'admin-1', changedByName: 'Alicia',
        },
      ];
    }),
  };
  const dataSource = { transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)), manager };
  const projectRepo = { findOneBy: jest.fn(async (where: { id?: string; slug?: string }) => (where.id === PROJECT_ID || where.slug === 'mi-proyecto' ? project : null)) };
  const slugHistoryRepo = { findOneBy: jest.fn(async (where: { slug: string }) => (where.slug === 'slug-viejo' ? { projectId: PROJECT_ID } : null)) };
  const service = new ResourceAllocationsService(projectRepo as never, slugHistoryRepo as never, new PermissionsService({ findOne: jest.fn() } as never), dataSource as never);
  return { service, manager, dataSource, calls, inserts, updates, queries, NOW };
}

const errorOf = async (p: Promise<unknown>) => p.catch((e: unknown) => e);
const WRITES = ['supersede', 'insert'];
// columnas del INSERT: [member, revision, profileId, profileName, hourlyCost, currency, hours, cost, budgetId, changedBy, origin, createdAt]
const insertOf = (inserts: unknown[][]) => {
  const p = inserts[0]!;
  return { memberId: p[0], revision: p[1], profileId: p[2], profileName: p[3], hourlyCost: p[4], currency: p[5], hours: p[6], cost: p[7], budgetId: p[8], changedBy: p[9], origin: p[10], createdAt: p[11] };
};

describe('ResourceAllocationsService.update', () => {
  const patch = (extra: Record<string, unknown> = {}) => ({ expectedRevision: 3, ...extra });

  describe('permisos y recursos', () => {
    it.each([['ADMIN', admin], ['PROGRAM_MANAGER', pm], ['líder real', realLeader]])('%s asigna', async (_n, actor) => {
      const { service } = build();
      await expect(service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '120' }), actor)).resolves.toMatchObject({ projectMemberId: MEMBER_ID });
    });
    it.each([['líder ajeno', foreignLeader], ['COLLABORATOR', collaborator], ['OBSERVER', observer]])('%s: 403 y no abre transacción', async (_n, actor) => {
      const { service, dataSource } = build();
      await expect(service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '120' }), actor)).rejects.toBeInstanceOf(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
    it('proyecto inexistente: 404 (antes que el 403)', async () => {
      const { service } = build();
      await expect(service.update('99999999-9999-4999-8999-999999999999', MEMBER_ID, patch(), collaborator)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('acepta UUID, slug y slug anterior (histórico) del proyecto', async () => {
      const { service } = build();
      for (const ref of [PROJECT_ID, 'mi-proyecto', 'slug-viejo']) {
        await expect(service.update(ref, MEMBER_ID, patch({ estimatedHours: '120' }), admin)).resolves.toBeDefined();
      }
    });
    it('miembro inexistente, de otro proyecto o dado de baja: 404 PROJECT_MEMBER_NOT_FOUND y no se escribe nada', async () => {
      const { service, calls } = build({ memberExists: false });
      const error = (await errorOf(service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '120' }), admin))) as NotFoundException;
      expect(error.getResponse()).toMatchObject({ code: 'PROJECT_MEMBER_NOT_FOUND' });
      for (const write of WRITES) expect(calls).not.toContain(write);
    });
  });

  describe('expectedRevision', () => {
    it('primera asignación: expectedRevision 0 crea la revisión 1', async () => {
      const { service, inserts } = build({ current: null });
      await service.update(PROJECT_ID, MEMBER_ID, { expectedRevision: 0, resourceProfileId: PROFILE_ARCH }, admin);
      expect(insertOf(inserts).revision).toBe(1);
    });
    it('sin asignación y expectedRevision ≠ 0: 409 con currentRevision 0', async () => {
      const { service } = build({ current: null });
      const error = (await errorOf(service.update(PROJECT_ID, MEMBER_ID, { expectedRevision: 2, estimatedHours: '1' }, admin))) as ConflictException;
      expect(error.getResponse()).toMatchObject({ code: 'RESOURCE_ALLOCATION_VERSION_CONFLICT', currentRevision: 0 });
    });
    it('desactualizada: 409 con currentRevision y sin escrituras', async () => {
      const { service, calls } = build();
      const error = (await errorOf(service.update(PROJECT_ID, MEMBER_ID, patch({ expectedRevision: 2, estimatedHours: '120' }), admin))) as ConflictException;
      expect(error.getResponse()).toMatchObject({ code: 'RESOURCE_ALLOCATION_VERSION_CONFLICT', currentRevision: 3 });
      for (const write of WRITES) expect(calls).not.toContain(write);
    });
    it('se valida ANTES de "sin cambios" y ANTES de consultar el catálogo', async () => {
      const { service, calls } = build();
      const error = (await errorOf(service.update(PROJECT_ID, MEMBER_ID, patch({ expectedRevision: 1, estimatedHours: '100' }), admin))) as ConflictException;
      expect(error.getResponse()).toMatchObject({ code: 'RESOURCE_ALLOCATION_VERSION_CONFLICT' });
      expect(calls).not.toContain('lock-profile');
    });
  });

  describe('sin cambios', () => {
    it('mismas horas y sin cambiar el perfil: 409 RESOURCE_ALLOCATION_NO_CHANGES, sin revisión nueva', async () => {
      const { service, calls } = build();
      const error = (await errorOf(service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '100' }), admin))) as ConflictException;
      expect(error.getResponse()).toMatchObject({ code: 'RESOURCE_ALLOCATION_NO_CHANGES' });
      for (const write of WRITES) expect(calls).not.toContain(write);
    });
    it('reenviar el MISMO perfil no refresca la tarifa: sin cambios (y sin tocar el catálogo)', async () => {
      const { service, calls } = build({ catalog: { id: PROFILE_SENIOR, name: 'Consultor Senior', hourlyCost: '60.00', currency: 'ARS', active: true } });
      await expect(service.update(PROJECT_ID, MEMBER_ID, patch({ resourceProfileId: PROFILE_SENIOR.toUpperCase(), estimatedHours: '100.00' }), admin)).rejects.toMatchObject({
        response: { code: 'RESOURCE_ALLOCATION_NO_CHANGES' },
      });
      expect(calls).not.toContain('lock-profile');
    });
    it('un body vacío sobre una miembro sin asignación también es "sin cambios" (no crea una revisión vacía)', async () => {
      const { service } = build({ current: null });
      await expect(service.update(PROJECT_ID, MEMBER_ID, { expectedRevision: 0 }, admin)).rejects.toMatchObject({ response: { code: 'RESOURCE_ALLOCATION_NO_CHANGES' } });
    });
  });

  describe('TARIFA HISTÓRICA: solo cambian las horas', () => {
    it('100 h → 120 h con el perfil Senior a USD 50 (el catálogo ya dice USD 60): 120 × 50 = 6000.00, NO 7200.00', async () => {
      const { service, inserts, calls } = build({ catalog: { id: PROFILE_SENIOR, name: 'Consultor Senior', hourlyCost: '60.00', currency: 'USD', active: true } });
      await service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '120' }), admin);
      expect(insertOf(inserts)).toMatchObject({ revision: 4, profileId: PROFILE_SENIOR, profileName: 'Consultor Senior', hourlyCost: '50.00', currency: 'USD', hours: '120.00', cost: '6000.00' });
      expect(calls).not.toContain('lock-profile'); // ni siquiera consulta el catálogo
    });
    it('si el perfil quedó inactivo después, editar solo las horas SIGUE permitido con la tarifa histórica', async () => {
      const { service, inserts } = build({ catalog: { id: PROFILE_SENIOR, name: 'Consultor Senior', hourlyCost: '999.00', currency: 'ARS', active: false } });
      await expect(service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '120' }), admin)).resolves.toBeDefined();
      expect(insertOf(inserts)).toMatchObject({ hourlyCost: '50.00', currency: 'USD', cost: '6000.00' });
    });
    it('la moneda histórica tampoco cambia', async () => {
      const { service, inserts } = build({ catalog: { id: PROFILE_SENIOR, name: 'Consultor Senior', hourlyCost: '60000.00', currency: 'ARS', active: true } });
      await service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '120' }), admin);
      expect(insertOf(inserts).currency).toBe('USD');
    });
  });

  describe('CAMBIO DE PERFIL', () => {
    it('Senior USD 50 → Arquitecto USD 80 con 100 h: lee el catálogo ACTUAL (FOR SHARE), congela nombre/tarifa/moneda y recalcula', async () => {
      const { service, inserts, calls } = build();
      await service.update(PROJECT_ID, MEMBER_ID, patch({ resourceProfileId: PROFILE_ARCH, estimatedHours: '120' }), admin);
      expect(calls).toContain('lock-profile');
      expect(insertOf(inserts)).toMatchObject({ profileId: PROFILE_ARCH, profileName: 'Arquitecto', hourlyCost: '80.00', currency: 'USD', hours: '120.00', cost: '9600.00' });
    });
    it('al cambiar de perfil sin enviar horas, conserva las horas anteriores y recalcula con la tarifa nueva', async () => {
      const { service, inserts } = build();
      await service.update(PROJECT_ID, MEMBER_ID, patch({ resourceProfileId: PROFILE_ARCH }), admin);
      expect(insertOf(inserts)).toMatchObject({ hours: '100.00', hourlyCost: '80.00', cost: '8000.00' });
    });
    it('toma también la MONEDA actual del perfil nuevo', async () => {
      const { service, inserts } = build({ catalog: { id: PROFILE_ARCH, name: 'Arquitecto', hourlyCost: '60000.00', currency: 'ARS', active: true } });
      await service.update(PROJECT_ID, MEMBER_ID, patch({ resourceProfileId: PROFILE_ARCH }), admin);
      expect(insertOf(inserts)).toMatchObject({ currency: 'ARS', hourlyCost: '60000.00', cost: '6000000.00' });
    });
    it('perfil inactivo: 400 RESOURCE_PROFILE_INACTIVE y no se escribe nada', async () => {
      const { service, calls } = build({ catalog: { id: PROFILE_ARCH, name: 'Arq', hourlyCost: '80.00', currency: 'USD', active: false } });
      const error = (await errorOf(service.update(PROJECT_ID, MEMBER_ID, patch({ resourceProfileId: PROFILE_ARCH }), admin))) as BadRequestException;
      expect(error.getResponse()).toMatchObject({ code: 'RESOURCE_PROFILE_INACTIVE' });
      for (const write of WRITES) expect(calls).not.toContain(write);
    });
    it('perfil inexistente: 400 RESOURCE_PROFILE_NOT_FOUND', async () => {
      const { service } = build({ catalog: null });
      await expect(service.update(PROJECT_ID, MEMBER_ID, patch({ resourceProfileId: PROFILE_ARCH }), admin)).rejects.toMatchObject({ response: { code: 'RESOURCE_PROFILE_NOT_FOUND' } });
    });
  });

  describe('perfil y horas independientes (el costo NUNCA se inventa como 0)', () => {
    it('solo perfil: costo null', async () => {
      const { service, inserts } = build({ current: null });
      await service.update(PROJECT_ID, MEMBER_ID, { expectedRevision: 0, resourceProfileId: PROFILE_ARCH }, admin);
      expect(insertOf(inserts)).toMatchObject({ profileId: PROFILE_ARCH, hours: null, cost: null });
    });
    it('solo horas (sin perfil): costo null y snapshot de perfil vacío', async () => {
      const { service, inserts } = build({ current: null });
      await service.update(PROJECT_ID, MEMBER_ID, { expectedRevision: 0, estimatedHours: '40' }, admin);
      expect(insertOf(inserts)).toMatchObject({ profileId: null, profileName: null, hourlyCost: null, currency: null, hours: '40.00', cost: null });
    });
    it('perfil primero y horas después: la segunda revisión completa el costo con el snapshot de la primera', async () => {
      const { service, inserts } = build({ current: { ...current, revision: 1, estimatedHours: null } });
      await service.update(PROJECT_ID, MEMBER_ID, { expectedRevision: 1, estimatedHours: '10' }, admin);
      expect(insertOf(inserts)).toMatchObject({ hourlyCost: '50.00', cost: '500.00', revision: 2 });
    });
    it('horas 0.00 son válidas y dan costo 0.00 (no null)', async () => {
      const { service, inserts } = build();
      await service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '0.00' }), admin);
      expect(insertOf(inserts)).toMatchObject({ hours: '0.00', cost: '0.00' });
    });
  });

  describe('quitar datos', () => {
    it('resourceProfileId null: snapshot de perfil vacío, horas conservadas, costo null', async () => {
      const { service, inserts } = build();
      await service.update(PROJECT_ID, MEMBER_ID, patch({ resourceProfileId: null }), admin);
      expect(insertOf(inserts)).toMatchObject({ profileId: null, profileName: null, hourlyCost: null, currency: null, hours: '100.00', cost: null });
    });
    it('resourceProfileId null con estimatedHours null: ambos vacíos', async () => {
      const { service, inserts } = build();
      await service.update(PROJECT_ID, MEMBER_ID, patch({ resourceProfileId: null, estimatedHours: null }), admin);
      expect(insertOf(inserts)).toMatchObject({ profileId: null, hours: null, cost: null });
    });
    it('estimatedHours null: conserva el snapshot del perfil y el costo queda null', async () => {
      const { service, inserts, calls } = build();
      await service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: null }), admin);
      expect(insertOf(inserts)).toMatchObject({ profileId: PROFILE_SENIOR, hourlyCost: '50.00', currency: 'USD', hours: null, cost: null });
      expect(calls).not.toContain('lock-profile');
    });
    it('quitar el perfil de una asignación que ya no tenía perfil es "sin cambios"', async () => {
      const { service } = build({ current: emptyProfile });
      await expect(service.update(PROJECT_ID, MEMBER_ID, { expectedRevision: 1, resourceProfileId: null }, admin)).rejects.toMatchObject({ response: { code: 'RESOURCE_ALLOCATION_NO_CHANGES' } });
    });
  });

  describe('presupuesto vigente', () => {
    it('registra el budget_id vigente en cada revisión', async () => {
      const { service, inserts } = build();
      await service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '120' }), admin);
      expect(insertOf(inserts).budgetId).toBe(BUDGET_ID);
    });
    it('sin presupuesto (nunca hubo): budget_id NULL y la asignación se permite', async () => {
      const { service, inserts } = build({ budget: null, budgetVersions: 0 });
      await expect(service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '120' }), admin)).resolves.toBeDefined();
      expect(insertOf(inserts).budgetId).toBeNull();
    });
    it('versiones pero ninguna vigente: 500 BUDGET_NO_CURRENT_VERSION (se loguea), NO guarda budget_id null y no escribe nada', async () => {
      const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const { service, calls } = build({ budget: null, budgetVersions: 2 });
      const error = (await errorOf(service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '120' }), admin))) as InternalServerErrorException;
      expect(error.getResponse()).toMatchObject({ code: 'BUDGET_NO_CURRENT_VERSION' });
      expect(logger).toHaveBeenCalledWith(expect.stringContaining(PROJECT_ID));
      for (const write of WRITES) expect(calls).not.toContain(write);
      logger.mockRestore();
    });
    it('vigente distinta de MAX(version): 500 BUDGET_VERSION_STATE_INVALID', async () => {
      const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const { service } = build({ budget: { id: BUDGET_ID, version: 2, maxVersion: 3 } });
      await expect(service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '120' }), admin)).rejects.toMatchObject({ response: { code: 'BUDGET_VERSION_STATE_INVALID' } });
      logger.mockRestore();
    });
  });

  describe('versionado, locks y trazabilidad', () => {
    it('orden: proyecto FOR SHARE → miembro FOR UPDATE → vigente → [perfil FOR SHARE] → presupuesto → reloj → archiva la anterior → inserta la nueva', async () => {
      const { service, calls } = build();
      await service.update(PROJECT_ID, MEMBER_ID, patch({ resourceProfileId: PROFILE_ARCH }), admin);
      expect(calls).toEqual(['lock-project', 'lock-member', 'read-current', 'lock-profile', 'read-budget', 'clock', 'supersede', 'insert', 'read-result']);
    });
    it('sin cambiar el perfil no se bloquea ni se lee el catálogo', async () => {
      const { service, calls } = build();
      await service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '120' }), admin);
      expect(calls).toEqual(['lock-project', 'lock-member', 'read-current', 'read-budget', 'clock', 'supersede', 'insert', 'read-result']);
    });
    it('primera asignación: no hay nada que archivar (sin UPDATE)', async () => {
      const { service, calls } = build({ current: null });
      await service.update(PROJECT_ID, MEMBER_ID, { expectedRevision: 0, estimatedHours: '1' }, admin);
      expect(calls).not.toContain('supersede');
    });
    it('la anterior se archiva y la nueva nace con el MISMO instante lógico (clock_timestamp)', async () => {
      const { service, inserts, updates, NOW } = build();
      await service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '120' }), admin);
      expect(updates[0]).toEqual([MEMBER_ID, NOW]);
      expect(insertOf(inserts).createdAt).toBe(NOW);
    });
    it('la nueva revisión es MAX(revision) + 1 y la crea el usuario autenticado con origen UI', async () => {
      const { service, inserts } = build();
      await service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '120' }), realLeader);
      expect(insertOf(inserts)).toMatchObject({ revision: 4, changedBy: LEADER_ID, origin: 'UI' });
    });
    it('si no se pudo archivar exactamente una fila, falla antes de insertar', async () => {
      const { service, calls } = build({ supersededRows: 0 });
      await expect(service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '120' }), admin)).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(calls).not.toContain('insert');
    });
    it('una sola transacción', async () => {
      const { service, dataSource } = build();
      await service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '120' }), admin);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });
    it('NO escribe en audit_logs ni en project_activities (la tabla de asignaciones es la trazabilidad)', async () => {
      const { service, queries } = build();
      await service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '120' }), admin);
      for (const sql of queries) expect(sql).not.toMatch(/audit_logs|project_activities/);
    });
    it('el importe y las horas viajan como texto exacto (sin Number)', async () => {
      const { service, inserts } = build();
      await service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '125.50' }), admin);
      expect(typeof insertOf(inserts).hours).toBe('string');
      expect(insertOf(inserts).cost).toBe('6275.00');
    });
    it('ejemplo de TEMA: 125.50 h × USD 50.25 → 6306.38', async () => {
      const { service, inserts } = build({ current: { ...current, hourlyCost: '50.25' } });
      await service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '125.50' }), admin);
      expect(insertOf(inserts).cost).toBe('6306.38');
    });
  });

  it('la respuesta es la asignación vigente con perfil/tarifa/moneda DEL SNAPSHOT', async () => {
    const { service } = build();
    const result = await service.update(PROJECT_ID, MEMBER_ID, patch({ estimatedHours: '120' }), admin);
    expect(result).toEqual({
      projectMemberId: MEMBER_ID,
      user: { id: 'u1', name: 'Ana' },
      allocation: {
        revision: 4,
        resourceProfile: { id: PROFILE_SENIOR, name: 'Consultor Senior', hourlyCost: '50.00', currency: 'USD' },
        estimatedHours: '120.00',
        estimatedResourceCost: { amount: '6000.00', currency: 'USD' },
        budgetId: BUDGET_ID,
        budgetVersion: 2,
        createdAt: '2026-10-25T18:00:00.000Z',
        changedBy: { id: 'admin-1', name: 'Alicia' },
      },
    });
  });
});

type ReadRow = Record<string, unknown>;
const row = (extra: ReadRow = {}): ReadRow => ({
  projectMemberId: MEMBER_ID, userId: 'u1', userName: 'Ana', revision: 2, isCurrent: true, resourceProfileId: PROFILE_SENIOR, profileName: 'Consultor Senior',
  hourlyCost: '50.00', currency: 'USD', estimatedHours: '100.00', estimatedCost: '5000.00', budgetId: BUDGET_ID, budgetVersion: 2,
  createdAt: new Date('2026-10-25T18:00:00Z'), supersededAt: null, origin: 'UI', changedById: 'admin-1', changedByName: 'Alicia', ...extra,
});
const emptyRow = (id: string, name: string): ReadRow => ({
  projectMemberId: id, userId: `u-${id}`, userName: name, revision: null, isCurrent: null, resourceProfileId: null, profileName: null, hourlyCost: null,
  currency: null, estimatedHours: null, estimatedCost: null, budgetId: null, budgetVersion: null, createdAt: null, supersededAt: null, origin: null,
  changedById: null, changedByName: null,
});

function buildReader(rows: ReadRow[], opts: { memberExists?: boolean } = {}) {
  const query = jest.fn(async (sql: string) => (sql.includes('SELECT id FROM project_members') ? (opts.memberExists === false ? [] : [{ id: MEMBER_ID }]) : rows));
  const projectRepo = { findOneBy: jest.fn(async () => project) };
  const service = new ResourceAllocationsService(projectRepo as never, { findOneBy: jest.fn() } as never, new PermissionsService({ findOne: jest.fn() } as never), { manager: { query } } as never);
  return { service, query };
}

describe('ResourceAllocationsService.getCurrent', () => {
  it.each([['ADMIN', admin], ['PROGRAM_MANAGER', pm], ['líder real', realLeader]])('%s ve la asignación vigente', async (_n, actor) => {
    const { service } = buildReader([row()]);
    const result = await service.getCurrent(PROJECT_ID, actor);
    expect(result.members[0]!.allocation).toMatchObject({ revision: 2, estimatedResourceCost: { amount: '5000.00', currency: 'USD' } });
  });
  it.each([['líder ajeno', foreignLeader], ['COLLABORATOR', collaborator], ['OBSERVER', observer]])('%s: 403 completo (nunca datos parciales) y no consulta nada', async (_n, actor) => {
    const { service, query } = buildReader([row()]);
    const error = await errorOf(service.getCurrent(PROJECT_ID, actor));
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
    expect(JSON.stringify((error as ForbiddenException).getResponse())).not.toMatch(/Consultor|50\.00|USD/);
  });
  it('un miembro sin asignación aparece con allocation: null (sin inventar revisión 0)', async () => {
    const { service } = buildReader([emptyRow('m1', 'Beto')]);
    expect((await service.getCurrent(PROJECT_ID, admin)).members).toEqual([{ projectMemberId: 'm1', user: { id: 'u-m1', name: 'Beto' }, allocation: null }]);
  });
  it('solo miembros activos, en orden estable, leyendo SNAPSHOTS (no el catálogo de perfiles)', async () => {
    const { service, query } = buildReader([row()]);
    await service.getCurrent(PROJECT_ID, admin);
    const sql = String((query.mock.calls[0] as unknown[])[0]);
    expect(sql).toContain('pm.removed_at IS NULL');
    expect(sql).toContain('a.is_current');
    expect(sql).toMatch(/ORDER BY lower\(u\.name\) ASC, pm\.joined_at ASC, pm\.id ASC/);
    expect(sql).not.toMatch(/resource_profiles|rp\./);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('totalsByCurrency: suma por moneda de los importes YA redondeados, sin convertir ni mezclar, ignora los null', async () => {
    const rows = [
      row({ projectMemberId: 'm1', estimatedCost: '6306.38' }),
      row({ projectMemberId: 'm2', estimatedCost: '6306.38' }),
      row({ projectMemberId: 'm3', estimatedCost: '6306.38' }),
      row({ projectMemberId: 'm4', currency: 'ARS', estimatedCost: '1000000.10' }),
      row({ projectMemberId: 'm5', currency: 'ARS', estimatedCost: '0.05' }),
      row({ projectMemberId: 'm6', estimatedHours: null, estimatedCost: null }),
      emptyRow('m7', 'Sin asignar'),
    ];
    const { service } = buildReader(rows);
    expect((await service.getCurrent(PROJECT_ID, admin)).totalsByCurrency).toEqual([
      { currency: 'ARS', amount: '1000000.15' },
      { currency: 'USD', amount: '18919.14' }, // 6306.38 × 3: suma de redondeados, no 18919.13
    ]);
  });
  it('sin ningún costo calculable: totalsByCurrency vacío', async () => {
    const { service } = buildReader([emptyRow('m1', 'A')]);
    expect((await service.getCurrent(PROJECT_ID, admin)).totalsByCurrency).toEqual([]);
  });
  it('perfil y tarifa de la respuesta son los del snapshot', async () => {
    const { service } = buildReader([row({ profileName: 'Nombre congelado', hourlyCost: '50.00', currency: 'USD' })]);
    expect((await service.getCurrent(PROJECT_ID, admin)).members[0]!.allocation!.resourceProfile).toEqual({ id: PROFILE_SENIOR, name: 'Nombre congelado', hourlyCost: '50.00', currency: 'USD' });
  });
});

describe('ResourceAllocationsService.getHistory', () => {
  const history = [
    row({ revision: 3, isCurrent: true, profileName: 'Arquitecto', hourlyCost: '80.00', estimatedHours: '120.00', estimatedCost: '9600.00', supersededAt: null }),
    row({ revision: 2, isCurrent: false, estimatedHours: '120.00', estimatedCost: '6000.00', supersededAt: new Date('2026-10-26T10:00:00Z') }),
    row({ revision: 1, isCurrent: false, estimatedHours: '100.00', estimatedCost: '5000.00', budgetId: null, budgetVersion: null, supersededAt: new Date('2026-10-25T20:00:00Z') }),
  ];

  it.each([['ADMIN', admin], ['PROGRAM_MANAGER', pm], ['líder real', realLeader]])('%s ve el historial', async (_n, actor) => {
    const { service } = buildReader(history);
    expect((await service.getHistory(PROJECT_ID, MEMBER_ID, actor)).map((h) => h.revision)).toEqual([3, 2, 1]);
  });
  it.each([['líder ajeno', foreignLeader], ['COLLABORATOR', collaborator], ['OBSERVER', observer]])('%s: 403', async (_n, actor) => {
    const { service, query } = buildReader(history);
    await expect(service.getHistory(PROJECT_ID, MEMBER_ID, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });
  it('miembro de otro proyecto o inexistente: 404 PROJECT_MEMBER_NOT_FOUND', async () => {
    const { service } = buildReader(history, { memberExists: false });
    await expect(service.getHistory(PROJECT_ID, MEMBER_ID, admin)).rejects.toMatchObject({ response: { code: 'PROJECT_MEMBER_NOT_FOUND' } });
  });
  it('entradas con todos los campos del snapshot, versión del presupuesto por join, fechas ISO y origen', async () => {
    const { service } = buildReader(history);
    const [latest, , first] = await service.getHistory(PROJECT_ID, MEMBER_ID, admin);
    expect(latest).toEqual({
      revision: 3, isCurrent: true, resourceProfileId: PROFILE_SENIOR, profileNameSnapshot: 'Arquitecto', hourlyCostSnapshot: '80.00', currencySnapshot: 'USD',
      estimatedHours: '120.00', estimatedCostSnapshot: '9600.00', budgetId: BUDGET_ID, budgetVersion: 2, changedBy: { id: 'admin-1', name: 'Alicia' },
      createdAt: '2026-10-25T18:00:00.000Z', supersededAt: null, origin: 'UI',
    });
    expect(first).toMatchObject({ revision: 1, budgetId: null, budgetVersion: null, supersededAt: '2026-10-25T20:00:00.000Z' });
  });
  it('lee solo snapshots: orden revision DESC, sin filtrar por baja del miembro y sin tocar el catálogo de perfiles', async () => {
    const { service, query } = buildReader(history);
    await service.getHistory(PROJECT_ID, MEMBER_ID, admin);
    const sql = String((query.mock.calls[1] as unknown[])[0]);
    expect(sql).toMatch(/ORDER BY a\.revision DESC/);
    expect(sql).not.toMatch(/removed_at|resource_profiles/);
  });
  it('un miembro sin asignaciones devuelve []', async () => {
    const { service } = buildReader([]);
    await expect(service.getHistory(PROJECT_ID, MEMBER_ID, admin)).resolves.toEqual([]);
  });
});
