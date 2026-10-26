import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { PermissionsService } from '../auth/permissions.service';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { BudgetEntity } from '../database/entities/budget.entity';
import { BudgetItemEntity } from '../database/entities/budget-item.entity';
import { RoleName } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateBudgetVersionDto } from './dto/create-budget-version.dto';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const CAT_RRHH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAT_LIC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CATEGORIES = [
  { id: CAT_RRHH, name: 'Recursos humanos', active: true },
  { id: CAT_LIC, name: 'Licencias y software', active: true },
];
const user = (id: string, roles: RoleName[]): RequestUser => ({ id, roles }) as RequestUser;
const admin = user('admin-1', [RoleName.ADMIN]);
const pm = user('pm-1', [RoleName.PROGRAM_MANAGER]);

// V1 vigente: 1.000.000 = RRHH 700.000 + Licencias 300.000
const v1 = {
  id: 'b1', projectId: PROJECT_ID, version: 1, totalAmount: '1000000.00', currency: 'ARS', approvalDate: '2026-10-12',
  isCurrent: true, supersededAt: null, createdBy: 'admin-1', createdAt: new Date('2026-10-12T15:00:00Z'),
};
const V1_ITEMS = [
  { costCategoryId: CAT_LIC, categoryName: 'Licencias y software', amount: '300000.00' },
  { costCategoryId: CAT_RRHH, categoryName: 'Recursos humanos', amount: '700000.00' },
];
// Request que SÍ cambia: 1.200.000 = RRHH 800.000 + Licencias 400.000
const dto: CreateBudgetVersionDto = {
  expectedVersion: 1,
  totalAmount: '1200000.00',
  currency: 'ARS',
  approvalDate: '2026-11-01',
  items: [
    { costCategoryId: CAT_RRHH, amount: '800000.00' },
    { costCategoryId: CAT_LIC, amount: '400000.00' },
  ],
};
// Mismo contenido que V1 pero con las partidas en OTRO orden
const sameAsV1: CreateBudgetVersionDto = {
  expectedVersion: 1,
  totalAmount: '1000000.00',
  currency: 'ARS',
  approvalDate: '2026-10-12',
  items: [
    { costCategoryId: CAT_LIC, amount: '300000.00' },
    { costCategoryId: CAT_RRHH, amount: '700000.00' },
  ],
};

type Opts = {
  projectCurrency?: string;
  projectExists?: boolean;
  current?: typeof v1 | null;
  maxVersion?: number;
  total?: number;
  failOn?: 'audit' | 'budget' | 'update' | 'items';
  categories?: typeof CATEGORIES;
};

function build(opts: Opts = {}) {
  const calls: string[] = [];
  const updateSet: Array<Record<string, unknown>> = [];
  const saved: Array<Record<string, unknown>> = [];
  const current = opts.current === undefined ? v1 : opts.current;

  const manager = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM cost_categories')) {
        calls.push('lock-categories');
        expect(sql).toContain('FOR SHARE');
        return opts.categories ?? CATEGORIES;
      }
      if (sql.includes('FROM budget_items')) {
        calls.push('load-items');
        return V1_ITEMS;
      }
      if (sql.includes('FOR UPDATE')) {
        calls.push('lock');
        return opts.projectExists === false ? [] : [{ id: PROJECT_ID, economicCurrency: opts.projectCurrency ?? 'ARS' }];
      }
      calls.push('stats');
      return [{ maxVersion: opts.maxVersion ?? (current ? current.version : 0), total: opts.total ?? (current ? 1 : 0) }];
    }),
    findOne: jest.fn(async () => {
      calls.push('find-current');
      return current;
    }),
    createQueryBuilder: jest.fn(() => {
      const qb = {
        update: () => qb,
        set: (values: Record<string, unknown>) => {
          updateSet.push(values);
          return qb;
        },
        where: () => qb,
        execute: async () => {
          calls.push('update-old');
          if (opts.failOn === 'update') return { affected: 0 };
          return { affected: 1 };
        },
      };
      return qb;
    }),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => ({ __entity: entity, ...data })),
    save: jest.fn(async (row: Record<string, unknown>) => {
      const isAudit = row.__entity === AuditLogEntity;
      calls.push(isAudit ? 'save-audit' : 'save-budget');
      if (opts.failOn === 'audit' && isAudit) throw new Error('falló la auditoría');
      if (opts.failOn === 'budget' && !isAudit) throw new Error('falló el insert');
      const result = isAudit ? row : { id: 'b2', createdAt: new Date('2026-11-01T10:00:00Z'), ...row };
      saved.push(result);
      return result;
    }),
    insert: jest.fn(async (entity: unknown, rows: Array<Record<string, unknown>>) => {
      calls.push('insert-items');
      if (opts.failOn === 'items') throw new Error('falló una partida');
      saved.push({ __entity: entity, rows });
    }),
  };
  const dataSource = { transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)) };
  const projectRepo = { findOneBy: jest.fn() };
  const service = new BudgetsService({} as never, projectRepo as never, new PermissionsService({ findOne: jest.fn() } as never), dataSource as never);
  return { service, manager, dataSource, calls, updateSet, saved };
}

const errorOf = async (p: Promise<unknown>) => p.catch((e: unknown) => e);
const WRITES = ['update-old', 'save-budget', 'insert-items', 'save-audit'];

describe('BudgetsService.createVersion', () => {
  it.each([['ADMIN', admin], ['PROGRAM_MANAGER', pm]])('%s crea la versión 2 con sus partidas y devuelve la nueva', async (_n, actor) => {
    const { service } = build();
    await expect(service.createVersion(PROJECT_ID, dto, actor)).resolves.toMatchObject({
      id: 'b2', version: 2, isCurrent: true, supersededAt: null, totalAmount: '1200000.00', createdBy: actor.id,
      items: [
        { costCategoryId: CAT_LIC, categoryName: 'Licencias y software', amount: '400000.00' },
        { costCategoryId: CAT_RRHH, categoryName: 'Recursos humanos', amount: '800000.00' },
      ],
    });
  });

  it('orden: lock proyecto → vigente → máx → partidas vigentes → lock rubros → UPDATE anterior → INSERT nueva → partidas → auditoría', async () => {
    const { service, calls } = build();
    await service.createVersion(PROJECT_ID, dto, admin);
    expect(calls).toEqual(['lock', 'find-current', 'stats', 'load-items', 'lock-categories', 'update-old', 'save-budget', 'insert-items', 'save-audit']);
  });

  it('el lock del proyecto SIEMPRE va antes que el de los rubros (orden global anti-deadlock)', async () => {
    const { service, calls } = build();
    await service.createVersion(PROJECT_ID, dto, admin);
    expect(calls.indexOf('lock')).toBeLessThan(calls.indexOf('lock-categories'));
  });

  it('el UPDATE de la anterior toca SOLO is_current y superseded_at', async () => {
    const { service, updateSet } = build();
    await service.createVersion(PROJECT_ID, dto, admin);
    expect(updateSet).toHaveLength(1);
    expect(Object.keys(updateSet[0]!).sort()).toEqual(['isCurrent', 'supersededAt']);
    expect(updateSet[0]!.isCurrent).toBe(false);
    expect(typeof updateSet[0]!.supersededAt).toBe('function'); // now() de la base
  });

  it('las partidas de la versión anterior no se tocan: solo se inserta (sin UPDATE ni DELETE de budget_items)', async () => {
    const { service, manager, saved } = build();
    await service.createVersion(PROJECT_ID, dto, admin);
    expect(manager.createQueryBuilder).toHaveBeenCalledTimes(1); // el único UPDATE es el de budgets
    const inserted = saved.find((row) => row.__entity === BudgetItemEntity)!;
    expect(inserted.rows).toEqual([
      { budgetId: 'b2', costCategoryId: CAT_LIC, amount: '400000.00' },
      { budgetId: 'b2', costCategoryId: CAT_RRHH, amount: '800000.00' },
    ]);
  });

  it('nextVersion = MAX(version) + 1', async () => {
    const v4 = { ...v1, id: 'b4', version: 4 };
    const { service } = build({ current: v4, maxVersion: 4, total: 4 });
    await expect(service.createVersion(PROJECT_ID, { ...dto, expectedVersion: 4 }, admin)).resolves.toMatchObject({ version: 5 });
  });

  it('auditoría BUDGET_VERSION_CREATED: old = versión anterior con sus partidas, new = la nueva con las suyas', async () => {
    const { service, saved } = build();
    await service.createVersion(PROJECT_ID, dto, admin);
    const audit = saved.find((r) => r.__entity === AuditLogEntity)!;
    expect(audit).toMatchObject({
      entityType: 'BUDGET', entityId: 'b2', action: 'BUDGET_VERSION_CREATED', userId: 'admin-1', origin: 'UI',
      oldValues: {
        budgetId: 'b1', projectId: PROJECT_ID, version: 1, totalAmount: '1000000.00', currency: 'ARS', approvalDate: '2026-10-12',
        items: V1_ITEMS,
      },
      newValues: {
        budgetId: 'b2', projectId: PROJECT_ID, version: 2, totalAmount: '1200000.00', currency: 'ARS', approvalDate: '2026-11-01',
        items: [
          { costCategoryId: CAT_LIC, categoryName: 'Licencias y software', amount: '400000.00' },
          { costCategoryId: CAT_RRHH, categoryName: 'Recursos humanos', amount: '800000.00' },
        ],
      },
    });
    // una sola fila de auditoría por operación y nada fuera de budgets / budget_items / audit_logs
    expect(saved.filter((r) => r.__entity === AuditLogEntity)).toHaveLength(1);
    expect(saved.every((r) => [AuditLogEntity, BudgetEntity, BudgetItemEntity].includes(r.__entity as never))).toBe(true);
  });

  describe('moneda ÚNICA del proyecto', () => {
    it('una versión nueva NO puede cambiar de moneda: V1 ARS → V2 USD se rechaza con 400 PROJECT_CURRENCY_MISMATCH, sin escrituras', async () => {
      const { service, calls } = build();
      const error = (await errorOf(service.createVersion(PROJECT_ID, { ...sameAsV1, currency: 'USD' }, admin))) as BadRequestException;
      expect(error.getResponse()).toMatchObject({ code: 'PROJECT_CURRENCY_MISMATCH', projectCurrency: 'ARS' });
      expect(calls).not.toContain('save-budget');
    });
    it('sin currency en el request: usa la del proyecto', async () => {
      const { service } = build({ projectCurrency: 'USD' });
      const { currency: _omit, ...withoutCurrency } = { ...dto, expectedVersion: 1 };
      void _omit;
      await expect(service.createVersion(PROJECT_ID, withoutCurrency, admin)).resolves.toMatchObject({ currency: 'USD' });
    });
    it('proyecto USD: una versión en USD se acepta y en ARS se rechaza', async () => {
      const { service } = build({ projectCurrency: 'USD' });
      await expect(service.createVersion(PROJECT_ID, { ...dto, currency: 'USD' }, admin)).resolves.toMatchObject({ currency: 'USD' });
      await expect(errorOf(service.createVersion(PROJECT_ID, { ...dto, currency: 'ARS' }, admin))).resolves.toMatchObject({ response: { code: 'PROJECT_CURRENCY_MISMATCH' } });
    });
  });

  describe('permisos', () => {
    it.each([
      ['PROJECT_LEADER', user('leader-1', [RoleName.PROJECT_LEADER])],
      ['COLLABORATOR', user('c', [RoleName.COLLABORATOR])],
      ['OBSERVER', user('o', [RoleName.OBSERVER])],
    ])('%s: 403 ANTES de tocar la base', async (_n, actor) => {
      const { service, dataSource } = build();
      await expect(service.createVersion(PROJECT_ID, dto, actor)).rejects.toBeInstanceOf(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  it('proyecto inexistente: 404 y nada más', async () => {
    const { service, calls } = build({ projectExists: false });
    await expect(service.createVersion(PROJECT_ID, dto, admin)).rejects.toBeInstanceOf(NotFoundException);
    expect(calls).toEqual(['lock']);
  });

  it('sin presupuesto inicial: 404 BUDGET_NOT_FOUND', async () => {
    const { service } = build({ current: null, total: 0, maxVersion: 0 });
    const error = (await errorOf(service.createVersion(PROJECT_ID, dto, admin))) as NotFoundException;
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toMatchObject({ code: 'BUDGET_NOT_FOUND' });
  });

  it('versiones pero ninguna vigente: 500 BUDGET_NO_CURRENT_VERSION, sin escrituras', async () => {
    const { service, calls } = build({ current: null, total: 2, maxVersion: 2 });
    const error = (await errorOf(service.createVersion(PROJECT_ID, dto, admin))) as InternalServerErrorException;
    expect(error.getResponse()).toMatchObject({ code: 'BUDGET_NO_CURRENT_VERSION' });
    for (const write of WRITES) expect(calls).not.toContain(write);
  });

  it('vigente distinta de MAX(version): 500 BUDGET_VERSION_STATE_INVALID, sin escrituras', async () => {
    const { service, calls } = build({ current: { ...v1, version: 2 }, maxVersion: 3, total: 3 });
    const error = (await errorOf(service.createVersion(PROJECT_ID, { ...dto, expectedVersion: 2 }, admin))) as InternalServerErrorException;
    expect(error.getResponse()).toMatchObject({ code: 'BUDGET_VERSION_STATE_INVALID' });
    for (const write of WRITES) expect(calls).not.toContain(write);
  });

  it('la integridad se valida ANTES que expectedVersion', async () => {
    const { service } = build({ current: { ...v1, version: 2 }, maxVersion: 3, total: 3 });
    const error = (await errorOf(service.createVersion(PROJECT_ID, { ...dto, expectedVersion: 99 }, admin))) as InternalServerErrorException;
    expect(error.getResponse()).toMatchObject({ code: 'BUDGET_VERSION_STATE_INVALID' });
  });

  it('expectedVersion desactualizado: 409 BUDGET_VERSION_CONFLICT con currentVersion, sin escrituras', async () => {
    const { service, calls } = build({ current: { ...v1, version: 3 }, maxVersion: 3, total: 3 });
    const error = (await errorOf(service.createVersion(PROJECT_ID, { ...dto, expectedVersion: 1 }, admin))) as ConflictException;
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'BUDGET_VERSION_CONFLICT', currentVersion: 3 });
    for (const write of WRITES) expect(calls).not.toContain(write);
  });

  describe('BUDGET_NO_CHANGES (encabezado + desglose)', () => {
    it('mismo encabezado y mismas partidas en OTRO orden: 409 sin escrituras', async () => {
      const { service, calls } = build();
      const error = (await errorOf(service.createVersion(PROJECT_ID, sameAsV1, admin))) as ConflictException;
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({ code: 'BUDGET_NO_CHANGES' });
      for (const write of WRITES) expect(calls).not.toContain(write);
    });

    it('importes equivalentes ("700000" = "700000.00") tampoco cuentan como cambio', async () => {
      const { service } = build();
      const error = (await errorOf(
        service.createVersion(PROJECT_ID, { ...sameAsV1, items: [{ costCategoryId: CAT_RRHH, amount: '700000' }, { costCategoryId: CAT_LIC, amount: '300000.0' }] }, admin),
      )) as ConflictException;
      expect(error.getResponse()).toMatchObject({ code: 'BUDGET_NO_CHANGES' });
    });

    it('mismo encabezado y mismo total pero OTRA distribución (600/400 en vez de 700/300): SÍ crea la versión', async () => {
      const { service } = build();
      await expect(
        service.createVersion(
          PROJECT_ID,
          { ...sameAsV1, items: [{ costCategoryId: CAT_RRHH, amount: '600000.00' }, { costCategoryId: CAT_LIC, amount: '400000.00' }] },
          admin,
        ),
      ).resolves.toMatchObject({ version: 2, totalAmount: '1000000.00' });
    });

    it('solo cambia el encabezado (mismas partidas): SÍ crea la versión', async () => {
      const { service } = build();
      await expect(service.createVersion(PROJECT_ID, { ...sameAsV1, approvalDate: '2026-12-01' }, admin)).resolves.toMatchObject({ version: 2 });
    });

    it('expectedVersion se valida ANTES de detectar "sin cambios"', async () => {
      const { service } = build({ current: { ...v1, version: 2 }, maxVersion: 2, total: 2 });
      const error = (await errorOf(service.createVersion(PROJECT_ID, sameAsV1, admin))) as ConflictException;
      expect(error.getResponse()).toMatchObject({ code: 'BUDGET_VERSION_CONFLICT', currentVersion: 2 });
    });
  });

  describe('desglose', () => {
    it('suma distinta del total: 400 BUDGET_ITEMS_TOTAL_MISMATCH con totalAmount e itemsTotal, sin tocar la base', async () => {
      const { service, dataSource } = build();
      const error = (await errorOf(
        service.createVersion(PROJECT_ID, { ...dto, items: [{ costCategoryId: CAT_RRHH, amount: '800000.00' }] }, admin),
      )) as BadRequestException;
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toMatchObject({ code: 'BUDGET_ITEMS_TOTAL_MISMATCH', totalAmount: '1200000.00', itemsTotal: '800000.00' });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rubros repetidos: 400 BUDGET_ITEM_DUPLICATED_CATEGORY', async () => {
      const { service } = build();
      const error = (await errorOf(
        service.createVersion(PROJECT_ID, { ...dto, items: [{ costCategoryId: CAT_RRHH, amount: '800000.00' }, { costCategoryId: CAT_RRHH, amount: '400000.00' }] }, admin),
      )) as BadRequestException;
      expect(error.getResponse()).toMatchObject({ code: 'BUDGET_ITEM_DUPLICATED_CATEGORY' });
    });

    it('rubro inexistente o inactivo: 400 y la versión vigente NO se desactiva', async () => {
      const missing = build({ categories: [CATEGORIES[0]!] });
      const notFound = (await errorOf(missing.service.createVersion(PROJECT_ID, dto, admin))) as BadRequestException;
      expect(notFound.getResponse()).toMatchObject({ code: 'COST_CATEGORY_NOT_FOUND', costCategoryIds: [CAT_LIC] });
      expect(missing.calls).not.toContain('update-old');

      const inactive = build({ categories: [CATEGORIES[0]!, { ...CATEGORIES[1]!, active: false }] });
      const inactiveError = (await errorOf(inactive.service.createVersion(PROJECT_ID, dto, admin))) as BadRequestException;
      expect(inactiveError.getResponse()).toMatchObject({ code: 'COST_CATEGORY_INACTIVE', costCategoryIds: [CAT_LIC] });
      expect(inactive.calls).not.toContain('update-old');
    });
  });

  it.each(['audit', 'budget', 'update', 'items'] as const)('si falla %s la transacción se aborta (el error se propaga: rollback)', async (failOn) => {
    const { service } = build({ failOn });
    await expect(service.createVersion(PROJECT_ID, dto, admin)).rejects.toBeDefined();
  });
});
