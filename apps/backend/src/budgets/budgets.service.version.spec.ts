import 'reflect-metadata';
import { ConflictException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { PermissionsService } from '../auth/permissions.service';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { BudgetEntity } from '../database/entities/budget.entity';
import { RoleName } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateBudgetVersionDto } from './dto/create-budget-version.dto';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const user = (id: string, roles: RoleName[]): RequestUser => ({ id, roles }) as RequestUser;
const admin = user('admin-1', [RoleName.ADMIN]);
const pm = user('pm-1', [RoleName.PROGRAM_MANAGER]);

const dto: CreateBudgetVersionDto = { expectedVersion: 1, totalAmount: '1200000.00', currency: 'ARS', approvalDate: '2026-11-01' };
const v1 = {
  id: 'b1', projectId: PROJECT_ID, version: 1, totalAmount: '1000000.00', currency: 'ARS', approvalDate: '2026-10-12',
  isCurrent: true, supersededAt: null, createdBy: 'admin-1', createdAt: new Date('2026-10-12T15:00:00Z'),
};

function build(opts: { projectExists?: boolean; current?: typeof v1 | null; maxVersion?: number; total?: number; failOn?: 'audit' | 'budget' | 'update' } = {}) {
  const calls: string[] = [];
  const updateSet: Array<Record<string, unknown>> = [];
  const saved: Array<Record<string, unknown>> = [];
  const current = opts.current === undefined ? v1 : opts.current;

  const manager = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) {
        calls.push('lock');
        return opts.projectExists === false ? [] : [{ id: PROJECT_ID }];
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
  };
  const dataSource = { transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)) };
  const projectRepo = { findOneBy: jest.fn() };
  const service = new BudgetsService({} as never, projectRepo as never, new PermissionsService({ findOne: jest.fn() } as never), dataSource as never);
  return { service, manager, dataSource, calls, updateSet, saved };
}

const errorOf = async (p: Promise<unknown>) => p.catch((e: unknown) => e);

describe('BudgetsService.createVersion', () => {
  it.each([['ADMIN', admin], ['PROGRAM_MANAGER', pm]])('%s crea la versión 2 y devuelve 201 con la nueva', async (_n, actor) => {
    const { service } = build();
    await expect(service.createVersion(PROJECT_ID, dto, actor)).resolves.toMatchObject({
      id: 'b2', version: 2, isCurrent: true, supersededAt: null, totalAmount: '1200000.00', createdBy: actor.id,
    });
  });

  it('orden: lock → vigente → máx → UPDATE de la anterior → INSERT nueva → auditoría', async () => {
    const { service, calls } = build();
    await service.createVersion(PROJECT_ID, dto, admin);
    expect(calls).toEqual(['lock', 'find-current', 'stats', 'update-old', 'save-budget', 'save-audit']);
  });

  it('el UPDATE de la anterior toca SOLO is_current y superseded_at', async () => {
    const { service, updateSet } = build();
    await service.createVersion(PROJECT_ID, dto, admin);
    expect(updateSet).toHaveLength(1);
    expect(Object.keys(updateSet[0]!).sort()).toEqual(['isCurrent', 'supersededAt']);
    expect(updateSet[0]!.isCurrent).toBe(false);
    expect(typeof updateSet[0]!.supersededAt).toBe('function'); // now() de la base
  });

  it('nextVersion = MAX(version) + 1', async () => {
    const v4 = { ...v1, id: 'b4', version: 4 };
    const { service } = build({ current: v4, maxVersion: 4, total: 4 });
    await expect(service.createVersion(PROJECT_ID, { ...dto, expectedVersion: 4 }, admin)).resolves.toMatchObject({ version: 5 });
  });

  it('auditoría BUDGET_VERSION_CREATED: entityId = nueva, old = anterior, new = nueva; sin project_activities', async () => {
    const { service, saved } = build();
    await service.createVersion(PROJECT_ID, dto, admin);
    const audit = saved.find((r) => r.__entity === AuditLogEntity)!;
    expect(audit).toMatchObject({
      entityType: 'BUDGET', entityId: 'b2', action: 'BUDGET_VERSION_CREATED', userId: 'admin-1', origin: 'UI',
      oldValues: { budgetId: 'b1', projectId: PROJECT_ID, version: 1, totalAmount: '1000000.00', currency: 'ARS', approvalDate: '2026-10-12' },
      newValues: { budgetId: 'b2', projectId: PROJECT_ID, version: 2, totalAmount: '1200000.00', currency: 'ARS', approvalDate: '2026-11-01' },
    });
    expect(saved.every((r) => r.__entity === AuditLogEntity || r.__entity === BudgetEntity)).toBe(true);
  });

  it('permite cambiar SOLO la moneda', async () => {
    const { service } = build();
    await expect(service.createVersion(PROJECT_ID, { ...dto, totalAmount: v1.totalAmount, approvalDate: v1.approvalDate, currency: 'USD' }, admin)).resolves.toMatchObject({ version: 2, currency: 'USD' });
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
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.getResponse()).toMatchObject({ code: 'BUDGET_NO_CURRENT_VERSION' });
    expect(calls).not.toContain('update-old');
    expect(calls).not.toContain('save-budget');
  });

  it('vigente distinta de MAX(version): 500 BUDGET_VERSION_STATE_INVALID, sin escrituras', async () => {
    const { service, calls } = build({ current: { ...v1, version: 2 }, maxVersion: 3, total: 3 });
    const error = (await errorOf(service.createVersion(PROJECT_ID, { ...dto, expectedVersion: 2 }, admin))) as InternalServerErrorException;
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.getResponse()).toMatchObject({ code: 'BUDGET_VERSION_STATE_INVALID' });
    expect(calls).not.toContain('update-old');
    expect(calls).not.toContain('save-budget');
  });

  it('expectedVersion desactualizado: 409 BUDGET_VERSION_CONFLICT con currentVersion, sin escrituras', async () => {
    const { service, calls } = build({ current: { ...v1, version: 3 }, maxVersion: 3, total: 3 });
    const error = (await errorOf(service.createVersion(PROJECT_ID, { ...dto, expectedVersion: 1 }, admin))) as ConflictException;
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'BUDGET_VERSION_CONFLICT', currentVersion: 3 });
    expect(calls).not.toContain('update-old');
  });

  it('la integridad se valida ANTES que expectedVersion', async () => {
    const { service } = build({ current: { ...v1, version: 2 }, maxVersion: 3, total: 3 });
    const error = (await errorOf(service.createVersion(PROJECT_ID, { ...dto, expectedVersion: 99 }, admin))) as InternalServerErrorException;
    expect(error.getResponse()).toMatchObject({ code: 'BUDGET_VERSION_STATE_INVALID' });
  });

  it('mismos importe, moneda y fecha: 409 BUDGET_NO_CHANGES, sin escrituras', async () => {
    const { service, calls } = build();
    const same = { expectedVersion: 1, totalAmount: v1.totalAmount, currency: v1.currency, approvalDate: v1.approvalDate };
    const error = (await errorOf(service.createVersion(PROJECT_ID, same, admin))) as ConflictException;
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'BUDGET_NO_CHANGES' });
    expect(calls).not.toContain('update-old');
  });

  it('expectedVersion se valida ANTES de detectar "sin cambios"', async () => {
    const { service } = build({ current: { ...v1, version: 2 }, maxVersion: 2, total: 2 });
    const same = { expectedVersion: 1, totalAmount: v1.totalAmount, currency: v1.currency, approvalDate: v1.approvalDate };
    const error = (await errorOf(service.createVersion(PROJECT_ID, same, admin))) as ConflictException;
    expect(error.getResponse()).toMatchObject({ code: 'BUDGET_VERSION_CONFLICT', currentVersion: 2 });
  });

  it.each(['audit', 'budget', 'update'] as const)('si falla %s la transacción se aborta (el error se propaga: rollback)', async (failOn) => {
    const { service } = build({ failOn });
    await expect(service.createVersion(PROJECT_ID, dto, admin)).rejects.toBeDefined();
  });
});
