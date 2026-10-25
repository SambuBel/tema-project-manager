import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { COST_CREATED_ACTION, CostsService } from './costs.service';
import { PermissionsService } from '../auth/permissions.service';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { CostEntity } from '../database/entities/cost.entity';
import { ProjectEntity } from '../projects/project.entity';
import { AuditEntityType, AuditOrigin, RoleName } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateCostDto } from './dto/create-cost.dto';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const LEADER_ID = 'leader-1';
const CAT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const user = (id: string, roles: RoleName[]): RequestUser => ({ id, name: `Nombre ${id}`, roles }) as RequestUser;
const admin = user('admin-1', [RoleName.ADMIN]);
const pm = user('pm-1', [RoleName.PROGRAM_MANAGER]);
const realLeader = user(LEADER_ID, [RoleName.PROJECT_LEADER]);
const foreignLeader = user('otro-leader', [RoleName.PROJECT_LEADER]);
const staleLeader = user(LEADER_ID, [RoleName.COLLABORATOR]);
const collaborator = user('collab-1', [RoleName.COLLABORATOR]);
const observer = user('obs-1', [RoleName.OBSERVER]);
const project = { id: PROJECT_ID, leaderId: LEADER_ID } as ProjectEntity;

const dto: CreateCostDto = { costDate: '2026-10-25', amount: '150000.50', currency: 'ARS', costCategoryId: CAT, description: 'Licencias de software' };

type Opts = {
  projectCurrency?: string;
  projectExists?: boolean;
  lockedProjectExists?: boolean;
  startDate?: string | null;
  category?: { id: string; name: string; active: boolean } | null;
  budget?: { id: string; version: number } | null;
  budgetVersions?: number;
  inBudget?: boolean;
  taskInProject?: boolean;
  failOn?: 'audit' | 'cost';
};

function build(opts: Opts = {}) {
  const calls: string[] = [];
  const saved: Array<Record<string, unknown>> = [];
  const category = opts.category === undefined ? { id: CAT, name: 'Licencias y software', active: true } : opts.category;
  const budget = opts.budget === undefined ? { id: 'budget-3', version: 3 } : opts.budget;

  const manager = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      void params;
      if (sql.includes('FROM projects')) {
        calls.push('lock-project');
        expect(sql).toContain('FOR SHARE');
        expect(sql).not.toContain('FOR UPDATE');
        return opts.lockedProjectExists === false ? [] : [{ startDate: opts.startDate === undefined ? '2026-10-01' : opts.startDate, economicCurrency: opts.projectCurrency ?? 'ARS' }];
      }
      if (sql.includes('FROM cost_categories')) {
        calls.push('lock-category');
        expect(sql).toContain('FOR SHARE');
        return category ? [category] : [];
      }
      if (sql.includes('COUNT(*)::int AS total FROM budgets')) {
        calls.push('count-budgets');
        return [{ total: opts.budgetVersions ?? 0 }];
      }
      if (sql.includes('FROM budgets')) {
        calls.push('read-budget');
        expect(sql).toContain('is_current = true');
        return budget ? [budget] : [];
      }
      if (sql.includes('FROM budget_items')) {
        calls.push('read-item');
        return opts.inBudget === false ? [] : [{ '?column?': 1 }];
      }
      if (sql.includes('FROM tasks')) {
        calls.push('read-task');
        return opts.taskInProject === false ? [] : [{ title: 'Comprar licencias' }];
      }
      calls.push('read-cost');
      return [
        {
          id: 'cost-1', projectId: PROJECT_ID, taskId: null, taskTitle: null, costCategoryId: CAT, categoryName: 'Licencias y software',
          amount: '150000.50', currency: 'ARS', costDate: '2026-10-25', description: 'Licencias de software', createdBy: 'admin-1',
          createdByName: 'Alicia', createdAt: new Date('2026-10-25T15:00:00Z'), updatedAt: new Date('2026-10-25T15:00:00Z'), revision: 1,
        },
      ];
    }),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => ({ __entity: entity, ...data })),
    save: jest.fn(async (row: Record<string, unknown>) => {
      const isAudit = row.__entity === AuditLogEntity;
      calls.push(isAudit ? 'save-audit' : 'save-cost');
      if (opts.failOn === 'audit' && isAudit) throw new Error('falló la auditoría');
      if (opts.failOn === 'cost' && !isAudit) throw new Error('falló el insert');
      const result = isAudit ? row : { id: 'cost-1', ...row };
      saved.push(result);
      return result;
    }),
  };
  const dataSource = { transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)), manager };
  const projectRepo = { findOneBy: jest.fn(async () => (opts.projectExists === false ? null : project)) };
  const membersRepo = { findOne: jest.fn() };
  const service = new CostsService(projectRepo as never, new PermissionsService(membersRepo as never), dataSource as never);
  return { service, manager, dataSource, calls, saved, projectRepo };
}

const errorOf = async (p: Promise<unknown>) => p.catch((e: unknown) => e);
const WRITES = ['save-cost', 'save-audit'];

describe('CostsService.create', () => {
  it.each([['ADMIN', admin], ['PROGRAM_MANAGER', pm], ['líder real del proyecto', realLeader]])('%s: registra el costo', async (_n, actor) => {
    const { service, saved } = build();
    const result = await service.create(PROJECT_ID, dto, actor);
    expect(result).toMatchObject({ id: 'cost-1', projectId: PROJECT_ID, amount: '150000.50', currency: 'ARS', costDate: '2026-10-25', createdByUser: { id: 'admin-1', name: 'Alicia' } });
    expect(saved[0]).toMatchObject({ __entity: CostEntity, projectId: PROJECT_ID, taskId: null, createdBy: actor.id, amount: '150000.50' });
  });

  it.each([['PROJECT_LEADER ajeno', foreignLeader], ['COLLABORATOR', collaborator], ['OBSERVER', observer], ['leaderId histórico sin el rol', staleLeader]])(
    '%s: 403 y no abre transacción',
    async (_n, actor) => {
      const { service, dataSource } = build();
      await expect(service.create(PROJECT_ID, dto, actor)).rejects.toBeInstanceOf(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    },
  );

  it('proyecto inexistente: 404 (la convención es 404 ANTES que 403, porque el permiso depende del proyecto)', async () => {
    const { service } = build({ projectExists: false });
    await expect(service.create(PROJECT_ID, dto, collaborator)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('el proyecto desaparece entre la verificación y el lock: 404 y no se escribe nada', async () => {
    const { service, calls } = build({ lockedProjectExists: false });
    await expect(service.create(PROJECT_ID, dto, admin)).rejects.toBeInstanceOf(NotFoundException);
    for (const write of WRITES) expect(calls).not.toContain(write);
  });

  it('el costo conserva el importe como TEXTO (sin pasar por Number)', async () => {
    const { service, saved } = build();
    await service.create(PROJECT_ID, { ...dto, amount: '123456789012.34' }, admin);
    expect(saved[0]!.amount).toBe('123456789012.34');
    expect(typeof saved[0]!.amount).toBe('string');
  });

  describe('locks y orden', () => {
    it('proyecto FOR SHARE → rubro FOR SHARE → presupuesto vigente → partida → costo → auditoría → lectura', async () => {
      const { service, calls } = build();
      await service.create(PROJECT_ID, dto, admin);
      expect(calls).toEqual(['lock-project', 'lock-category', 'read-budget', 'read-item', 'save-cost', 'save-audit', 'read-cost']);
    });
    it('con tarea: la valida antes de insertar', async () => {
      const { service, calls } = build();
      await service.create(PROJECT_ID, { ...dto, taskId: TASK }, admin);
      expect(calls).toEqual(['lock-project', 'lock-category', 'read-budget', 'read-item', 'read-task', 'save-cost', 'save-audit', 'read-cost']);
    });
    it('una sola transacción para todo', async () => {
      const { service, dataSource } = build();
      await service.create(PROJECT_ID, dto, admin);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('presupuesto', () => {
    it('nunca hubo presupuesto: 409 PROJECT_HAS_NO_CURRENT_BUDGET y no se escribe nada', async () => {
      const { service, calls } = build({ budget: null, budgetVersions: 0 });
      const error = (await errorOf(service.create(PROJECT_ID, dto, admin))) as ConflictException;
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({ code: 'PROJECT_HAS_NO_CURRENT_BUDGET' });
      for (const write of WRITES) expect(calls).not.toContain(write);
    });
    it('hay versiones pero ninguna vigente: 500 BUDGET_NO_CURRENT_VERSION (se loguea) y no se escribe nada', async () => {
      const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const { service, calls } = build({ budget: null, budgetVersions: 2 });
      const error = (await errorOf(service.create(PROJECT_ID, dto, admin))) as InternalServerErrorException;
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect(error.getResponse()).toMatchObject({ code: 'BUDGET_NO_CURRENT_VERSION' });
      expect(logger).toHaveBeenCalledWith(expect.stringContaining(PROJECT_ID));
      for (const write of WRITES) expect(calls).not.toContain(write);
      logger.mockRestore();
    });
    it('sin presupuesto el 409 va antes que cualquier error de rubro', async () => {
      const { service } = build({ budget: null, category: null });
      const error = (await errorOf(service.create(PROJECT_ID, dto, admin))) as ConflictException;
      expect(error.getResponse()).toMatchObject({ code: 'PROJECT_HAS_NO_CURRENT_BUDGET' });
    });
  });

  describe('RN-20: rubro', () => {
    it('rubro inexistente: 400 COST_CATEGORY_NOT_FOUND', async () => {
      const { service, calls } = build({ category: null });
      const error = (await errorOf(service.create(PROJECT_ID, dto, admin))) as BadRequestException;
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toMatchObject({ code: 'COST_CATEGORY_NOT_FOUND' });
      for (const write of WRITES) expect(calls).not.toContain(write);
    });
    it('rubro inactivo: 400 COST_CATEGORY_INACTIVE', async () => {
      const { service } = build({ category: { id: CAT, name: 'X', active: false } });
      const error = (await errorOf(service.create(PROJECT_ID, dto, admin))) as BadRequestException;
      expect(error.getResponse()).toMatchObject({ code: 'COST_CATEGORY_INACTIVE' });
    });
    it('existe en el catálogo pero NO en el presupuesto vigente: 400 COST_CATEGORY_NOT_IN_CURRENT_BUDGET', async () => {
      const { service, calls } = build({ inBudget: false });
      const error = (await errorOf(service.create(PROJECT_ID, dto, admin))) as BadRequestException;
      expect(error.getResponse()).toMatchObject({ code: 'COST_CATEGORY_NOT_IN_CURRENT_BUDGET' });
      for (const write of WRITES) expect(calls).not.toContain(write);
    });
  });

  describe('tarea opcional', () => {
    it('tarea del proyecto: OK, la respuesta trae el título', async () => {
      const { service } = build();
      const result = await service.create(PROJECT_ID, { ...dto, taskId: TASK }, admin);
      expect(result.taskTitle).toBe('Comprar licencias');
    });
    it('tarea inexistente o de otro proyecto: el MISMO error 400 TASK_NOT_AVAILABLE_FOR_PROJECT, sin escrituras', async () => {
      const { service, calls, manager } = build({ taskInProject: false });
      const error = (await errorOf(service.create(PROJECT_ID, { ...dto, taskId: TASK }, admin))) as BadRequestException;
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toMatchObject({ code: 'TASK_NOT_AVAILABLE_FOR_PROJECT' });
      expect(JSON.stringify(error.getResponse())).not.toMatch(/otro proyecto/i); // no revela que el UUID existe en otro proyecto
      for (const write of WRITES) expect(calls).not.toContain(write);
      const taskQuery = manager.query.mock.calls.find((c) => String(c[0]).includes('FROM tasks'))!;
      expect(String(taskQuery[0])).toContain('project_id = $2'); // una sola consulta que exige el proyecto
    });
    it('no restringe por estado de la tarea (la consulta no mira status ni archived_at)', async () => {
      const { service, manager } = build();
      await service.create(PROJECT_ID, { ...dto, taskId: TASK }, admin);
      const sql = String(manager.query.mock.calls.find((c) => String(c[0]).includes('FROM tasks'))![0]);
      expect(sql).not.toMatch(/status|archived/i);
    });
  });

  describe('RN-21: fecha anterior al inicio del proyecto', () => {
    it('anterior y sin confirmar: 409 con code, costDate y projectStartDate (sin importes), sin escrituras', async () => {
      const { service, calls } = build({ startDate: '2026-10-25' });
      const error = (await errorOf(service.create(PROJECT_ID, { ...dto, costDate: '2026-10-24' }, admin))) as ConflictException;
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual({
        code: 'COST_BEFORE_PROJECT_START_CONFIRMATION_REQUIRED',
        message: expect.any(String),
        costDate: '2026-10-24',
        projectStartDate: '2026-10-25',
      });
      expect(JSON.stringify(error.getResponse())).not.toMatch(/150000|amount/);
      for (const write of WRITES) expect(calls).not.toContain(write);
    });
    it('confirmBeforeProjectStart = false equivale a no confirmar', async () => {
      const { service } = build({ startDate: '2026-10-25' });
      await expect(service.create(PROJECT_ID, { ...dto, costDate: '2026-10-24', confirmBeforeProjectStart: false }, admin)).rejects.toBeInstanceOf(ConflictException);
    });
    it('anterior con confirmación: se registra y la auditoría deja confirmedBeforeProjectStart: true', async () => {
      const { service, saved } = build({ startDate: '2026-10-25' });
      await service.create(PROJECT_ID, { ...dto, costDate: '2026-10-24', confirmBeforeProjectStart: true }, admin);
      expect(saved.find((r) => r.__entity === AuditLogEntity)!.newValues).toMatchObject({ confirmedBeforeProjectStart: true });
    });
    it.each([['igual', '2026-10-25'], ['posterior', '2026-10-26']])('fecha %s al inicio: se registra sin pedir confirmación (confirmed = false)', async (_n, costDate) => {
      const { service, saved } = build({ startDate: '2026-10-25' });
      await service.create(PROJECT_ID, { ...dto, costDate }, admin);
      expect(saved.find((r) => r.__entity === AuditLogEntity)!.newValues).toMatchObject({ confirmedBeforeProjectStart: false });
    });
    it('confirmar sin necesidad no deja el flag en true', async () => {
      const { service, saved } = build({ startDate: '2026-10-25' });
      await service.create(PROJECT_ID, { ...dto, costDate: '2026-11-01', confirmBeforeProjectStart: true }, admin);
      expect(saved.find((r) => r.__entity === AuditLogEntity)!.newValues).toMatchObject({ confirmedBeforeProjectStart: false });
    });
    it('el proyecto SIN fecha de inicio: no se compara ni se pide confirmación (decisión provisional pendiente de TEMA)', async () => {
      const { service } = build({ startDate: null });
      await expect(service.create(PROJECT_ID, { ...dto, costDate: '1999-01-01' }, admin)).resolves.toBeDefined();
    });
    it('una fecha futura se acepta', async () => {
      const { service } = build();
      await expect(service.create(PROJECT_ID, { ...dto, costDate: '2099-12-31' }, admin)).resolves.toBeDefined();
    });
  });

  describe('moneda ÚNICA del proyecto (sin multimoneda ni conversión)', () => {
    it('sin currency en el request: guarda la moneda del proyecto', async () => {
      const { service, saved } = build({ projectCurrency: 'USD' });
      const { currency: _omit, ...withoutCurrency } = dto;
      void _omit;
      await service.create(PROJECT_ID, withoutCurrency, admin);
      expect(saved[0]).toMatchObject({ currency: 'USD', amount: '150000.50' });
    });
    it.each([['ARS', 'ARS'], ['USD', 'USD']])('proyecto %s: un costo en %s se acepta', async (projectCurrency, currency) => {
      const { service, saved } = build({ projectCurrency });
      await service.create(PROJECT_ID, { ...dto, currency }, admin);
      expect(saved[0]).toMatchObject({ currency });
    });
    it.each([['ARS', 'USD'], ['USD', 'ARS']])('proyecto %s: un costo en %s se rechaza con 400 PROJECT_CURRENCY_MISMATCH y no escribe nada', async (projectCurrency, currency) => {
      const { service, saved, calls } = build({ projectCurrency });
      const error = (await service.create(PROJECT_ID, { ...dto, currency }, admin).catch((e: unknown) => e)) as BadRequestException;
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toMatchObject({ code: 'PROJECT_CURRENCY_MISMATCH', projectCurrency });
      expect(saved).toEqual([]);
      expect(calls).not.toContain('lock-category');
    });
    it('no convierte ni consulta tipos de cambio ni importes de presupuesto', async () => {
      const { service, manager } = build();
      await service.create(PROJECT_ID, dto, admin);
      const consulted = manager.query.mock.calls.map((c) => String(c[0])).filter((sql) => !sql.includes('FROM costs c') && !sql.includes('FROM projects'));
      for (const sql of consulted) expect(sql).not.toMatch(/exchange_rates|currency|total_amount|SUM\(/i);
    });
  });

  describe('RN-19', () => {
    it('no bloquea un costo que supera la partida o el total: nunca consulta importes de presupuesto', async () => {
      const { service, manager } = build();
      await expect(service.create(PROJECT_ID, { ...dto, amount: '999999999999.99' }, admin)).resolves.toBeDefined();
      for (const call of manager.query.mock.calls) expect(String(call[0])).not.toMatch(/total_amount|bi\.amount|SUM\(/i);
    });
    it('la respuesta no trae banderas de exceso ni métricas', async () => {
      const { service } = build();
      const result = await service.create(PROJECT_ID, dto, admin);
      expect(Object.keys(result).sort()).toEqual(
        ['amount', 'categoryName', 'costCategoryId', 'costDate', 'createdAt', 'createdBy', 'createdByUser', 'currency', 'description', 'id', 'projectId', 'revision', 'taskId', 'taskTitle', 'updatedAt'],
      );
    });
  });

  describe('auditoría', () => {
    it('COST_CREATED con COST / actor / UI / valores nuevos (incluye budgetVersion), sin valores anteriores', async () => {
      const { service, saved } = build();
      await service.create(PROJECT_ID, { ...dto, taskId: TASK }, realLeader);
      expect(COST_CREATED_ACTION).toBe('COST_CREATED');
      expect(saved.find((r) => r.__entity === AuditLogEntity)).toMatchObject({
        entityType: AuditEntityType.COST,
        entityId: 'cost-1',
        action: 'COST_CREATED',
        userId: LEADER_ID,
        origin: AuditOrigin.UI,
        oldValues: null,
        newValues: {
          projectId: PROJECT_ID, taskId: TASK, costCategoryId: CAT, categoryName: 'Licencias y software', amount: '150000.50', currency: 'ARS',
          costDate: '2026-10-25', description: 'Licencias de software', budgetVersion: 3, confirmedBeforeProjectStart: false,
        },
      });
    });
    it('NO escribe en project_activities: solo CostEntity y AuditLogEntity', async () => {
      const { service, manager } = build();
      await service.create(PROJECT_ID, dto, admin);
      expect(manager.create.mock.calls.map((c) => c[0])).toEqual([CostEntity, AuditLogEntity]);
    });
    it.each(['audit', 'cost'] as const)('si falla %s el error se propaga (la transacción real revierte todo)', async (failOn) => {
      const { service } = build({ failOn });
      await expect(service.create(PROJECT_ID, dto, admin)).rejects.toBeDefined();
    });
  });
});

describe('CostsService.list', () => {
  function buildList(opts: { projectExists?: boolean; rows?: unknown[]; total?: number } = {}) {
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      void params;
      if (sql.includes('COUNT(*)')) return [{ total: opts.total ?? 1 }];
      return opts.rows ?? [
        {
          id: 'cost-1', projectId: PROJECT_ID, taskId: TASK, taskTitle: 'Comprar', costCategoryId: CAT, categoryName: 'Licencias y software',
          amount: '10.00', currency: 'USD', costDate: '2026-10-25', description: 'd', createdBy: 'admin-1', createdByName: 'Alicia',
          createdAt: new Date('2026-10-25T15:00:00Z'), updatedAt: new Date('2026-10-26T15:00:00Z'), revision: 4,
        },
      ];
    });
    const projectRepo = { findOneBy: jest.fn(async () => (opts.projectExists === false ? null : project)) };
    const service = new CostsService(projectRepo as never, new PermissionsService({ findOne: jest.fn() } as never), { manager: { query } } as never);
    return { service, query };
  }

  it.each([['ADMIN', admin], ['PROGRAM_MANAGER', pm], ['líder real', realLeader]])('%s: ve el listado', async (_n, actor) => {
    const { service } = buildList();
    const result = await service.list(PROJECT_ID, {}, actor);
    expect(result).toMatchObject({ total: 1, page: 1, limit: 10, totalPages: 1 });
    expect(result.data[0]).toEqual({
      id: 'cost-1', projectId: PROJECT_ID, taskId: TASK, taskTitle: 'Comprar', costCategoryId: CAT, categoryName: 'Licencias y software',
      amount: '10.00', currency: 'USD', costDate: '2026-10-25', description: 'd', createdBy: 'admin-1', createdByUser: { id: 'admin-1', name: 'Alicia' },
      createdAt: '2026-10-25T15:00:00.000Z', updatedAt: '2026-10-26T15:00:00.000Z', revision: 4,
    });
  });

  it.each([['líder ajeno', foreignLeader], ['COLLABORATOR', collaborator], ['OBSERVER', observer], ['leaderId histórico sin rol', staleLeader]])(
    '%s: 403 (nunca una lista vacía) y no consulta costos',
    async (_n, actor) => {
      const { service, query } = buildList();
      const error = await service.list(PROJECT_ID, {}, actor).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('proyecto inexistente: 404', async () => {
    const { service } = buildList({ projectExists: false });
    await expect(service.list(PROJECT_ID, {}, admin)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('orden costDate DESC, createdAt DESC, id DESC; excluye eliminados; sin N+1 (2 consultas)', async () => {
    const { service, query } = buildList();
    await service.list(PROJECT_ID, {}, admin);
    expect(query).toHaveBeenCalledTimes(2);
    for (const call of query.mock.calls) expect(String(call[0])).toContain('deleted_at IS NULL');
    expect(String(query.mock.calls[1]![0])).toMatch(/ORDER BY c\.cost_date DESC, c\.created_at DESC, c\.id DESC/);
  });

  it('paginación: offset y totalPages', async () => {
    const { service, query } = buildList({ total: 25, rows: [] });
    const result = await service.list(PROJECT_ID, { page: 3, limit: 10 }, admin);
    expect(query.mock.calls[1]![1]).toEqual([PROJECT_ID, 10, 20]);
    expect(result).toMatchObject({ data: [], total: 25, page: 3, limit: 10, totalPages: 3 });
  });

  it('no devuelve deletedAt ni campos internos', async () => {
    const { service } = buildList();
    const [row] = (await service.list(PROJECT_ID, {}, admin)).data;
    expect(Object.keys(row!)).not.toContain('deletedAt');
  });
});
