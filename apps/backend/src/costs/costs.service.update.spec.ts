import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { COST_UPDATED_ACTION, CostsService } from './costs.service';
import { PermissionsService } from '../auth/permissions.service';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { ProjectEntity } from '../projects/project.entity';
import { AuditEntityType, AuditOrigin, RoleName } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { UpdateCostDto } from './dto/update-cost.dto';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const COST_ID = '99999999-9999-4999-8999-999999999999';
const LEADER_ID = 'leader-1';
const CAT_LIC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAT_RRHH = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TASK_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TASK_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const user = (id: string, roles: RoleName[]): RequestUser => ({ id, name: `Nombre ${id}`, roles }) as RequestUser;
const admin = user('admin-1', [RoleName.ADMIN]);
const pm = user('pm-1', [RoleName.PROGRAM_MANAGER]);
const realLeader = user(LEADER_ID, [RoleName.PROJECT_LEADER]);
const foreignLeader = user('otro', [RoleName.PROJECT_LEADER]);
const collaborator = user('c', [RoleName.COLLABORATOR]);
const observer = user('o', [RoleName.OBSERVER]);
const project = { id: PROJECT_ID, leaderId: LEADER_ID } as ProjectEntity;

// Costo actual: revision 3, rubro Licencias, con tarea A, fecha ANTERIOR al inicio del proyecto (histórico).
const current = {
  id: COST_ID, taskId: TASK_A, costCategoryId: CAT_LIC, categoryName: 'Licencias y software', amount: '150000.50', currency: 'ARS',
  costDate: '2026-09-15', description: 'Licencias de software', revision: 3,
};
const patch = (extra: Partial<UpdateCostDto> = {}): UpdateCostDto => ({ expectedRevision: 3, ...extra });

type Opts = {
  projectCurrency?: string;
  projectExists?: boolean;
  startDate?: string | null;
  cost?: typeof current | null;
  category?: { id: string; name: string; active: boolean } | null;
  budget?: { id: string; version: number } | null;
  budgetVersions?: number;
  inBudget?: boolean;
  taskInProject?: boolean;
  updateResult?: unknown;
  failOn?: 'audit' | 'update';
};

function build(opts: Opts = {}) {
  const calls: string[] = [];
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  const saved: Array<Record<string, unknown>> = [];
  const cost = opts.cost === undefined ? current : opts.cost;

  const manager = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM projects')) {
        calls.push('lock-project');
        expect(sql).toContain('FOR SHARE');
        return [{ startDate: opts.startDate === undefined ? '2026-10-01' : opts.startDate, economicCurrency: opts.projectCurrency ?? 'ARS' }];
      }
      if (sql.includes('FOR UPDATE OF c')) {
        calls.push('lock-cost');
        return cost ? [cost] : [];
      }
      if (sql.includes('FROM cost_categories')) {
        calls.push('lock-category');
        expect(sql).toContain('FOR SHARE');
        return opts.category === undefined ? [{ id: CAT_RRHH, name: 'Recursos humanos', active: true }] : opts.category ? [opts.category] : [];
      }
      if (sql.includes('COUNT(*)::int AS total FROM budgets')) {
        calls.push('count-budgets');
        return [{ total: opts.budgetVersions ?? 0 }];
      }
      if (sql.includes('FROM budgets')) {
        calls.push('read-budget');
        return opts.budget === undefined ? [{ id: 'budget-5', version: 5 }] : opts.budget ? [opts.budget] : [];
      }
      if (sql.includes('FROM budget_items')) {
        calls.push('read-item');
        return opts.inBudget === false ? [] : [{ x: 1 }];
      }
      if (sql.includes('FROM tasks')) {
        calls.push('read-task');
        return opts.taskInProject === false ? [] : [{ x: 1 }];
      }
      if (sql.startsWith('UPDATE costs')) {
        calls.push('update-cost');
        if (opts.failOn === 'update') throw new Error('falló el update');
        updates.push({ sql, params });
        return opts.updateResult ?? [[{ revision: current.revision + 1 }], 1];
      }
      calls.push('read-cost');
      return [{
        id: COST_ID, projectId: PROJECT_ID, taskId: null, taskTitle: null, costCategoryId: CAT_LIC, categoryName: 'Licencias y software',
        amount: '150000.50', currency: 'ARS', costDate: '2026-09-15', description: 'Licencias de software', createdBy: 'admin-1',
        createdByName: 'Alicia', createdAt: new Date('2026-10-25T15:00:00Z'), updatedAt: new Date('2026-10-26T15:00:00Z'), revision: 4,
      }];
    }),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => ({ __entity: entity, ...data })),
    save: jest.fn(async (row: Record<string, unknown>) => {
      calls.push('save-audit');
      if (opts.failOn === 'audit') throw new Error('falló la auditoría');
      saved.push(row);
      return row;
    }),
  };
  const dataSource = { transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)), manager };
  const projectRepo = { findOneBy: jest.fn(async () => (opts.projectExists === false ? null : project)) };
  const service = new CostsService(projectRepo as never, new PermissionsService({ findOne: jest.fn() } as never), dataSource as never);
  return { service, manager, dataSource, calls, updates, saved };
}

const errorOf = async (p: Promise<unknown>) => p.catch((e: unknown) => e);
const WRITES = ['update-cost', 'save-audit'];
type AuditSaved = {
  newValues: { categoryName: string; change: { changedFields: string[]; categoryValidatedAgainstBudgetVersion: number | null; confirmedBeforeProjectStart: boolean } };
};
const auditOf = (saved: Array<Record<string, unknown>>) => saved.find((r) => r.__entity === AuditLogEntity) as unknown as AuditSaved;

describe('CostsService.update', () => {
  it.each([['ADMIN', admin], ['PROGRAM_MANAGER', pm], ['líder real', realLeader]])('%s: edita', async (_n, actor) => {
    const { service } = build();
    await expect(service.update(PROJECT_ID, COST_ID, patch({ description: 'Nueva' }), actor)).resolves.toMatchObject({ id: COST_ID, revision: 4 });
  });
  it.each([['líder ajeno', foreignLeader], ['COLLABORATOR', collaborator], ['OBSERVER', observer]])('%s: 403 y no abre transacción', async (_n, actor) => {
    const { service, dataSource } = build();
    await expect(service.update(PROJECT_ID, COST_ID, patch({ description: 'x' }), actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
  it('proyecto inexistente: 404 (antes que el 403)', async () => {
    const { service } = build({ projectExists: false });
    await expect(service.update(PROJECT_ID, COST_ID, patch({ description: 'x' }), collaborator)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('costo inexistente, de otro proyecto o dado de baja: 404 COST_NOT_FOUND y no se escribe nada', async () => {
    const { service, calls } = build({ cost: null });
    const error = (await errorOf(service.update(PROJECT_ID, COST_ID, patch({ description: 'x' }), admin))) as NotFoundException;
    expect(error.getResponse()).toMatchObject({ code: 'COST_NOT_FOUND' });
    for (const write of WRITES) expect(calls).not.toContain(write);
  });

  describe('locks y orden', () => {
    it('description: proyecto FOR SHARE → costo FOR UPDATE → UPDATE → auditoría (sin rubro, presupuesto ni tarea)', async () => {
      const { service, calls } = build();
      await service.update(PROJECT_ID, COST_ID, patch({ description: 'Nueva' }), admin);
      expect(calls).toEqual(['lock-project', 'lock-cost', 'update-cost', 'save-audit', 'read-cost']);
    });
    it('rubro + tarea: proyecto → costo → rubro → presupuesto → partida → tarea → UPDATE → auditoría', async () => {
      const { service, calls } = build();
      await service.update(PROJECT_ID, COST_ID, patch({ costCategoryId: CAT_RRHH, taskId: TASK_B }), admin);
      expect(calls).toEqual(['lock-project', 'lock-cost', 'lock-category', 'read-budget', 'read-item', 'read-task', 'update-cost', 'save-audit', 'read-cost']);
    });
    it('el costo se bloquea SIEMPRE después del proyecto', async () => {
      const { service, calls } = build();
      await service.update(PROJECT_ID, COST_ID, patch({ amount: '1' }), admin);
      expect(calls.indexOf('lock-project')).toBeLessThan(calls.indexOf('lock-cost'));
    });
    it('una sola transacción', async () => {
      const { service, dataSource } = build();
      await service.update(PROJECT_ID, COST_ID, patch({ amount: '1' }), admin);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('expectedRevision (RNF-20)', () => {
    it('desactualizado: 409 COST_VERSION_CONFLICT con currentRevision y sin contenido económico, sin escrituras', async () => {
      const { service, calls } = build();
      const error = (await errorOf(service.update(PROJECT_ID, COST_ID, patch({ expectedRevision: 2, amount: '5' }), admin))) as ConflictException;
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({ code: 'COST_VERSION_CONFLICT', currentRevision: 3 });
      expect(JSON.stringify(error.getResponse())).not.toMatch(/150000|Licencias/);
      for (const write of WRITES) expect(calls).not.toContain(write);
    });
    it('se valida ANTES de "sin cambios": revisión vieja con contenido idéntico → COST_VERSION_CONFLICT', async () => {
      const { service } = build();
      const error = (await errorOf(service.update(PROJECT_ID, COST_ID, patch({ expectedRevision: 1, description: current.description }), admin))) as ConflictException;
      expect(error.getResponse()).toMatchObject({ code: 'COST_VERSION_CONFLICT' });
    });
    it('el incremento es una sola sentencia: revision = revision + 1 junto con la edición', async () => {
      const { service, updates } = build();
      await service.update(PROJECT_ID, COST_ID, patch({ amount: '200' }), admin);
      expect(updates).toHaveLength(1);
      expect(updates[0]!.sql).toMatch(/revision = revision \+ 1/);
      expect(updates[0]!.sql).toMatch(/updated_at = clock_timestamp\(\)/);
      expect(updates[0]!.sql).toMatch(/deleted_at IS NULL/);
    });
  });

  describe('sin cambios', () => {
    it('todo igual → 409 COST_NO_CHANGES y no escribe, no incrementa, no audita', async () => {
      const { service, calls } = build();
      const error = (await errorOf(
        service.update(PROJECT_ID, COST_ID, patch({ description: current.description, amount: '150000.50', currency: 'ARS', costDate: '2026-09-15', costCategoryId: CAT_LIC, taskId: TASK_A }), admin),
      )) as ConflictException;
      expect(error.getResponse()).toMatchObject({ code: 'COST_NO_CHANGES' });
      for (const write of WRITES) expect(calls).not.toContain(write);
    });
    it('un body con solo expectedRevision también es "sin cambios"', async () => {
      const { service } = build();
      await expect(service.update(PROJECT_ID, COST_ID, patch(), admin)).rejects.toMatchObject({ response: { code: 'COST_NO_CHANGES' } });
    });
    it('reenviar el mismo rubro en otra capitalización de UUID no cuenta como cambio', async () => {
      const { service } = build();
      await expect(service.update(PROJECT_ID, COST_ID, patch({ costCategoryId: CAT_LIC.toUpperCase() }), admin)).rejects.toMatchObject({ response: { code: 'COST_NO_CHANGES' } });
    });
  });

  describe('qué se escribe', () => {
    it.each([
      ['description', { description: 'Nueva' }, 'description = $1', ['Nueva']],
      ['amount', { amount: '200000.00' }, 'amount = $1', ['200000.00']],
      ['costDate', { costDate: '2026-10-20' }, 'cost_date = $1', ['2026-10-20']],
    ])('solo %s: UPDATE de esa columna', async (_f, body, assignment, values) => {
      const { service, updates } = build();
      await service.update(PROJECT_ID, COST_ID, patch(body as Partial<UpdateCostDto>), admin);
      expect(updates[0]!.sql).toContain(assignment);
      expect(updates[0]!.params).toEqual([...values, COST_ID, PROJECT_ID]);
      expect(updates[0]!.sql).not.toMatch(/project_id =\s*\$1|created_by|deleted_at =/);
    });
    it('varios campos juntos: solo los que cambian (el que es igual no se toca)', async () => {
      const { service, updates } = build();
      await service.update(PROJECT_ID, COST_ID, patch({ amount: '1.00', currency: 'ARS', description: 'Otra' }), admin);
      expect(updates[0]!.sql).toMatch(/amount = \$1, description = \$2/);
      expect(updates[0]!.sql).not.toMatch(/currency =/);
    });
    it('el importe viaja como texto exacto (sin Number)', async () => {
      const { service, updates } = build();
      await service.update(PROJECT_ID, COST_ID, patch({ amount: '123456789012.34' }), admin);
      expect(updates[0]!.params[0]).toBe('123456789012.34');
    });
    it('taskId null quita la tarea', async () => {
      const { service, updates, calls } = build();
      await service.update(PROJECT_ID, COST_ID, patch({ taskId: null }), admin);
      expect(updates[0]!.sql).toContain('task_id = $1');
      expect(updates[0]!.params[0]).toBeNull();
      expect(calls).not.toContain('read-task');
    });
    it('taskId omitido conserva la tarea (no aparece en el UPDATE ni se valida)', async () => {
      const { service, updates, calls } = build();
      await service.update(PROJECT_ID, COST_ID, patch({ description: 'x' }), admin);
      expect(updates[0]!.sql).not.toContain('task_id');
      expect(calls).not.toContain('read-task');
    });
    it('taskId igual a la actual no se revalida', async () => {
      const { service, calls } = build();
      await service.update(PROJECT_ID, COST_ID, patch({ taskId: TASK_A, description: 'x' }), admin);
      expect(calls).not.toContain('read-task');
    });
  });

  describe('RN-20 al editar el rubro', () => {
    it('rubro SIN cambio: no se bloquea ni se revalida nada aunque ya no sirva (corregir un dato histórico)', async () => {
      const { service, calls } = build({ category: { id: CAT_LIC, name: 'x', active: false }, inBudget: false });
      await expect(service.update(PROJECT_ID, COST_ID, patch({ costCategoryId: CAT_LIC, description: 'Corrección' }), admin)).resolves.toBeDefined();
      expect(calls).not.toContain('lock-category');
      expect(calls).not.toContain('read-budget');
    });
    it('rubro CAMBIADO válido: se valida contra el presupuesto vigente y se audita su versión', async () => {
      const { service, saved } = build();
      await service.update(PROJECT_ID, COST_ID, patch({ costCategoryId: CAT_RRHH }), admin);
      expect(auditOf(saved).newValues.change.categoryValidatedAgainstBudgetVersion).toBe(5);
      expect(auditOf(saved).newValues.categoryName).toBe('Recursos humanos');
    });
    it('rubro CAMBIADO inexistente: 400 COST_CATEGORY_NOT_FOUND', async () => {
      const { service, calls } = build({ category: null });
      await expect(service.update(PROJECT_ID, COST_ID, patch({ costCategoryId: CAT_RRHH }), admin)).rejects.toMatchObject({ response: { code: 'COST_CATEGORY_NOT_FOUND' } });
      for (const write of WRITES) expect(calls).not.toContain(write);
    });
    it('rubro CAMBIADO inactivo: 400 COST_CATEGORY_INACTIVE', async () => {
      const { service } = build({ category: { id: CAT_RRHH, name: 'R', active: false } });
      await expect(service.update(PROJECT_ID, COST_ID, patch({ costCategoryId: CAT_RRHH }), admin)).rejects.toMatchObject({ response: { code: 'COST_CATEGORY_INACTIVE' } });
    });
    it('rubro CAMBIADO fuera del presupuesto vigente: 400 COST_CATEGORY_NOT_IN_CURRENT_BUDGET', async () => {
      const { service } = build({ inBudget: false });
      const error = (await errorOf(service.update(PROJECT_ID, COST_ID, patch({ costCategoryId: CAT_RRHH }), admin))) as BadRequestException;
      expect(error.getResponse()).toMatchObject({ code: 'COST_CATEGORY_NOT_IN_CURRENT_BUDGET' });
    });
    it('rubro CAMBIADO con versiones pero sin vigente: 500 BUDGET_NO_CURRENT_VERSION (se loguea)', async () => {
      const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const { service } = build({ budget: null, budgetVersions: 2 });
      const error = (await errorOf(service.update(PROJECT_ID, COST_ID, patch({ costCategoryId: CAT_RRHH }), admin))) as InternalServerErrorException;
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect(error.getResponse()).toMatchObject({ code: 'BUDGET_NO_CURRENT_VERSION' });
      expect(logger).toHaveBeenCalledWith(expect.stringContaining(PROJECT_ID));
      logger.mockRestore();
    });
    it('rubro CAMBIADO y nunca hubo presupuesto: 409 PROJECT_HAS_NO_CURRENT_BUDGET (mismo error que el alta)', async () => {
      const { service } = build({ budget: null, budgetVersions: 0 });
      await expect(service.update(PROJECT_ID, COST_ID, patch({ costCategoryId: CAT_RRHH }), admin)).rejects.toMatchObject({ response: { code: 'PROJECT_HAS_NO_CURRENT_BUDGET' } });
    });
  });

  describe('tarea', () => {
    it('tarea nueva del proyecto: OK', async () => {
      const { service, calls } = build();
      await expect(service.update(PROJECT_ID, COST_ID, patch({ taskId: TASK_B }), admin)).resolves.toBeDefined();
      expect(calls).toContain('read-task');
    });
    it('tarea inexistente o de otro proyecto: el MISMO 400 TASK_NOT_AVAILABLE_FOR_PROJECT, sin escrituras', async () => {
      const { service, calls } = build({ taskInProject: false });
      const error = (await errorOf(service.update(PROJECT_ID, COST_ID, patch({ taskId: TASK_B }), admin))) as BadRequestException;
      expect(error.getResponse()).toMatchObject({ code: 'TASK_NOT_AVAILABLE_FOR_PROJECT' });
      expect(JSON.stringify(error.getResponse())).not.toMatch(/otro proyecto/i);
      for (const write of WRITES) expect(calls).not.toContain(write);
    });
  });

  describe('RN-21 al editar (inicio del proyecto = 2026-10-01; el costo actual es del 2026-09-15, histórico)', () => {
    it('cambiar OTRO dato de un costo anterior al inicio NO vuelve a pedir confirmación', async () => {
      const { service } = build();
      await expect(service.update(PROJECT_ID, COST_ID, patch({ description: 'Corrección' }), admin)).resolves.toBeDefined();
    });
    it('reenviar la MISMA fecha anterior tampoco la pide (la fecha no cambió)', async () => {
      const { service } = build();
      await expect(service.update(PROJECT_ID, COST_ID, patch({ costDate: '2026-09-15', description: 'x' }), admin)).resolves.toBeDefined();
    });
    it('mover la fecha a otra anterior al inicio sin confirmar: 409 con costDate y projectStartDate (sin importes)', async () => {
      const { service, calls } = build();
      const error = (await errorOf(service.update(PROJECT_ID, COST_ID, patch({ costDate: '2026-09-01' }), admin))) as ConflictException;
      expect(error.getResponse()).toEqual({
        code: 'COST_BEFORE_PROJECT_START_CONFIRMATION_REQUIRED', message: expect.any(String), costDate: '2026-09-01', projectStartDate: '2026-10-01',
      });
      for (const write of WRITES) expect(calls).not.toContain(write);
    });
    it('con confirmación: se guarda y la auditoría deja confirmedBeforeProjectStart = true', async () => {
      const { service, saved } = build();
      await service.update(PROJECT_ID, COST_ID, patch({ costDate: '2026-09-01', confirmBeforeProjectStart: true }), admin);
      expect(auditOf(saved).newValues.change.confirmedBeforeProjectStart).toBe(true);
    });
    it.each([['igual al inicio', '2026-10-01'], ['posterior', '2026-10-20']])('fecha %s: sin confirmación y flag en false', async (_n, costDate) => {
      const { service, saved } = build();
      await service.update(PROJECT_ID, COST_ID, patch({ costDate, confirmBeforeProjectStart: true }), admin);
      expect(auditOf(saved).newValues.change.confirmedBeforeProjectStart).toBe(false);
    });
    it('proyecto sin fecha de inicio: no se compara (decisión provisional pendiente de TEMA)', async () => {
      const { service } = build({ startDate: null });
      await expect(service.update(PROJECT_ID, COST_ID, patch({ costDate: '1990-01-01' }), admin)).resolves.toBeDefined();
    });
  });

  describe('RN-19 y multimoneda', () => {
    it('no bloquea un importe que supera presupuesto o partida ni consulta importes de presupuesto', async () => {
      const { service, manager } = build();
      await expect(service.update(PROJECT_ID, COST_ID, patch({ amount: '999999999999.99' }), admin)).resolves.toBeDefined();
      for (const call of manager.query.mock.calls) expect(String(call[0])).not.toMatch(/total_amount|bi\.amount|SUM\(|exchange_rates/i);
    });
    it('la moneda de un costo NO se edita: otra moneda → 400 PROJECT_CURRENCY_MISMATCH, sin escrituras', async () => {
      const { service, updates } = build({ projectCurrency: 'ARS' });
      const error = (await service.update(PROJECT_ID, COST_ID, patch({ currency: 'USD' }), admin).catch((e: unknown) => e)) as BadRequestException;
      expect(error.getResponse()).toMatchObject({ code: 'PROJECT_CURRENCY_MISMATCH', projectCurrency: 'ARS' });
      expect(updates).toEqual([]);
    });
    it('reenviar la MISMA moneda del proyecto no cuenta como cambio (COST_NO_CHANGES si no hay nada más)', async () => {
      const { service, updates } = build({ projectCurrency: 'ARS' });
      const error = (await service.update(PROJECT_ID, COST_ID, patch({ currency: 'ARS' }), admin).catch((e: unknown) => e)) as ConflictException;
      expect(error.getResponse()).toMatchObject({ code: 'COST_NO_CHANGES' });
      expect(updates).toEqual([]);
    });
  });

  describe('auditoría COST_UPDATED', () => {
    it('snapshots COMPLETOS antes y después, con revision N / N+1 y changedFields', async () => {
      const { service, saved } = build();
      await service.update(PROJECT_ID, COST_ID, patch({ amount: '200000.00', description: 'Nueva' }), realLeader);
      expect(COST_UPDATED_ACTION).toBe('COST_UPDATED');
      expect(auditOf(saved)).toMatchObject({
        entityType: AuditEntityType.COST, entityId: COST_ID, action: 'COST_UPDATED', userId: LEADER_ID, origin: AuditOrigin.UI,
        oldValues: {
          projectId: PROJECT_ID, taskId: TASK_A, costCategoryId: CAT_LIC, categoryName: 'Licencias y software', amount: '150000.50',
          currency: 'ARS', costDate: '2026-09-15', description: 'Licencias de software', revision: 3,
        },
        newValues: {
          projectId: PROJECT_ID, taskId: TASK_A, costCategoryId: CAT_LIC, categoryName: 'Licencias y software', amount: '200000.00',
          currency: 'ARS', costDate: '2026-09-15', description: 'Nueva', revision: 4,
          change: { changedFields: ['amount', 'description'], categoryValidatedAgainstBudgetVersion: null, confirmedBeforeProjectStart: false },
        },
      });
    });
    it('changedFields: orden determinístico y solo lo que cambió', async () => {
      const { service, saved } = build();
      await service.update(PROJECT_ID, COST_ID, patch({ taskId: null, description: 'd', costDate: '2026-10-20', amount: '1.00', costCategoryId: CAT_RRHH }), admin);
      expect(auditOf(saved).newValues.change.changedFields).toEqual(['costDate', 'amount', 'costCategoryId', 'description', 'taskId']);
    });
    it('un cambio solo de descripción NO afirma que se revalidó el rubro (categoryValidatedAgainstBudgetVersion = null)', async () => {
      const { service, saved } = build();
      await service.update(PROJECT_ID, COST_ID, patch({ description: 'Nueva' }), admin);
      expect(auditOf(saved).newValues.change.categoryValidatedAgainstBudgetVersion).toBeNull();
    });
    it('una sola fila de auditoría, y nada fuera de audit_logs (no project_activities)', async () => {
      const { service, manager } = build();
      await service.update(PROJECT_ID, COST_ID, patch({ description: 'x' }), admin);
      expect(manager.create.mock.calls.map((c) => c[0])).toEqual([AuditLogEntity]);
    });
    it.each(['audit', 'update'] as const)('si falla %s el error se propaga (la transacción real revierte todo)', async (failOn) => {
      const { service } = build({ failOn });
      await expect(service.update(PROJECT_ID, COST_ID, patch({ description: 'x' }), admin)).rejects.toBeDefined();
    });
    it('si el UPDATE no devuelve la revisión esperada (fila perdida) falla en vez de seguir', async () => {
      const { service, saved } = build({ updateResult: [[], 0] });
      await expect(service.update(PROJECT_ID, COST_ID, patch({ description: 'x' }), admin)).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(saved).toHaveLength(0);
    });
  });
});

describe('CostsService.getOne', () => {
  function buildOne(opts: { projectExists?: boolean; row?: unknown } = {}) {
    const query = jest.fn(async () => (opts.row === undefined ? [{
      id: COST_ID, projectId: PROJECT_ID, taskId: null, taskTitle: null, costCategoryId: CAT_LIC, categoryName: 'Licencias', amount: '10.00', currency: 'ARS',
      costDate: '2026-10-25', description: 'd', createdBy: 'admin-1', createdByName: 'Alicia', createdAt: new Date('2026-10-25T15:00:00Z'),
      updatedAt: new Date('2026-10-25T16:00:00Z'), revision: 7,
    }] : opts.row ? [opts.row] : []));
    const projectRepo = { findOneBy: jest.fn(async () => (opts.projectExists === false ? null : project)) };
    const service = new CostsService(projectRepo as never, new PermissionsService({ findOne: jest.fn() } as never), { manager: { query } } as never);
    return { service, query };
  }

  it.each([['ADMIN', admin], ['PROGRAM_MANAGER', pm], ['líder real', realLeader]])('%s: ve el detalle con revision', async (_n, actor) => {
    const { service } = buildOne();
    await expect(service.getOne(PROJECT_ID, COST_ID, actor)).resolves.toMatchObject({ id: COST_ID, revision: 7, createdByUser: { id: 'admin-1', name: 'Alicia' } });
  });
  it.each([['líder ajeno', foreignLeader], ['COLLABORATOR', collaborator], ['OBSERVER', observer]])('%s: 403 y no consulta costos', async (_n, actor) => {
    const { service, query } = buildOne();
    await expect(service.getOne(PROJECT_ID, COST_ID, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });
  it('proyecto inexistente: 404', async () => {
    const { service } = buildOne({ projectExists: false });
    await expect(service.getOne(PROJECT_ID, COST_ID, admin)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('costo inexistente / de otro proyecto / dado de baja: 404 COST_NOT_FOUND (la consulta exige proyecto Y deleted_at IS NULL)', async () => {
    const { service, query } = buildOne({ row: null });
    const error = (await errorOf(service.getOne(PROJECT_ID, COST_ID, admin))) as NotFoundException;
    expect(error.getResponse()).toMatchObject({ code: 'COST_NOT_FOUND' });
    const sql = String((query.mock.calls[0] as unknown[])[0]);
    expect(sql).toContain('c.project_id = $2');
    expect(sql).toContain('c.deleted_at IS NULL');
  });
  it('un usuario sin permiso nunca llega a saber si el costo existe', async () => {
    const { service } = buildOne({ row: null });
    await expect(service.getOne(PROJECT_ID, COST_ID, collaborator)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('no devuelve deletedAt', async () => {
    const { service } = buildOne();
    expect(Object.keys(await service.getOne(PROJECT_ID, COST_ID, admin))).not.toContain('deletedAt');
  });
});
