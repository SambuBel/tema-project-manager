import { ConflictException, ForbiddenException, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { BudgetsService, BUDGET_CREATED_ACTION } from './budgets.service';
import { PermissionsService } from '../auth/permissions.service';
import { BudgetEntity } from '../database/entities/budget.entity';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { ProjectEntity } from '../projects/project.entity';
import { AuditEntityType, AuditOrigin, ProjectMemberRole, RoleName } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateBudgetDto } from './dto/create-budget.dto';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const LEADER_ID = 'leader-1';
const user = (id: string, roles: RoleName[]): RequestUser => ({ id, roles }) as RequestUser;
const admin = user('admin-1', [RoleName.ADMIN]);
const pm = user('pm-1', [RoleName.PROGRAM_MANAGER]);
const realLeader = user(LEADER_ID, [RoleName.PROJECT_LEADER]);
const staleLeader = user(LEADER_ID, [RoleName.COLLABORATOR]); // leaderId histórico sin el rol
const foreignLeader = user('otro-leader', [RoleName.PROJECT_LEADER]);
const collaborator = user('collab-1', [RoleName.COLLABORATOR]);
const observer = user('obs-1', [RoleName.OBSERVER]);

const dto: CreateBudgetDto = { totalAmount: '1500000.50', currency: 'ARS', approvalDate: '2026-10-12' };
const project = { id: PROJECT_ID, leaderId: LEADER_ID } as ProjectEntity;

const NOT_ALLOWED_TO_DEFINE: Array<[string, RequestUser]> = [
  ['líder real del proyecto', realLeader],
  ['COLLABORATOR', collaborator],
  ['OBSERVER', observer],
  ['PROJECT_LEADER ajeno', foreignLeader],
];

function build(opts: { projectExists?: boolean; existingVersions?: number; failOn?: 'audit' | 'budget' | 'unique'; membership?: ProjectMemberRole } = {}) {
  /** Orden en el que se tocó cada cosa dentro de la transacción. */
  const calls: string[] = [];
  const saved: Array<Record<string, unknown>> = [];

  const manager = {
    query: jest.fn(async (sql: string) => {
      calls.push('lock');
      expect(sql).toContain('FOR UPDATE');
      return opts.projectExists === false ? [] : [{ id: PROJECT_ID }];
    }),
    count: jest.fn(async () => {
      calls.push('count');
      return opts.existingVersions ?? 0;
    }),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => ({ __entity: entity, ...data })),
    save: jest.fn(async (row: Record<string, unknown>) => {
      const isAudit = row.__entity === AuditLogEntity;
      calls.push(isAudit ? 'save-audit' : 'save-budget');
      if (opts.failOn === 'audit' && isAudit) throw new Error('falló la auditoría');
      if (opts.failOn === 'unique' && !isAudit) throw Object.assign(new Error('dup'), { driverError: { code: '23505' } });
      const result = isAudit ? row : { id: 'budget-1', createdAt: new Date('2026-10-12T15:00:00Z'), ...row };
      saved.push(result);
      return result;
    }),
  };
  const dataSource = { transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)) };

  const currentBudget = {
    id: 'b1', projectId: PROJECT_ID, version: 1, totalAmount: '1500000.50', currency: 'ARS', approvalDate: '2026-10-12',
    isCurrent: true, supersededAt: null, createdBy: 'admin-1', createdAt: new Date('2026-10-12T15:00:00Z'),
  };
  const budgetRepo = {
    findOneBy: jest.fn(async () => (opts.existingVersions && opts.existingVersions > 0 && opts.failOn !== 'budget' ? currentBudget : null)),
    count: jest.fn(async () => opts.existingVersions ?? 0),
  };
  const projectRepo = { findOneBy: jest.fn(async () => (opts.projectExists === false ? null : project)) };
  const membersRepo = { findOne: jest.fn(async () => (opts.membership ? { projectRole: opts.membership } : null)) };

  const service = new BudgetsService(budgetRepo as never, projectRepo as never, new PermissionsService(membersRepo as never), dataSource as never);
  return { service, manager, dataSource, calls, saved, budgetRepo, projectRepo };
}

describe('BudgetsService.create (presupuesto inicial)', () => {
  it.each([
    ['ADMIN', admin],
    ['PROGRAM_MANAGER', pm],
  ])('%s: crea la versión 1 vigente', async (_label, actor) => {
    const { service, saved } = build();
    const result = await service.create(PROJECT_ID, dto, actor);

    expect(result).toEqual({
      id: 'budget-1', projectId: PROJECT_ID, version: 1, totalAmount: '1500000.50', currency: 'ARS', approvalDate: '2026-10-12',
      isCurrent: true, supersededAt: null, createdBy: actor.id, createdAt: '2026-10-12T15:00:00.000Z',
    });
    expect(saved[0]).toMatchObject({ __entity: BudgetEntity, version: 1, isCurrent: true, supersededAt: null, createdBy: actor.id });
  });

  it('totalAmount viaja y se guarda como TEXTO, sin pasar por Number', async () => {
    const { service, saved } = build();
    await service.create(PROJECT_ID, { ...dto, totalAmount: '123456789012.34' }, admin);
    expect(saved[0]!.totalAmount).toBe('123456789012.34');
    expect(typeof saved[0]!.totalAmount).toBe('string');
  });

  it.each(NOT_ALLOWED_TO_DEFINE)('%s: 403 y no abre transacción ni toca nada', async (_label, actor) => {
    const { service, dataSource, projectRepo } = build();
    await expect(service.create(PROJECT_ID, dto, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(projectRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('el 403 va ANTES del 404: un usuario sin permiso no puede averiguar si el proyecto existe', async () => {
    const { service } = build({ projectExists: false });
    await expect(service.create(PROJECT_ID, dto, collaborator)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('proyecto inexistente: 404 y no se escribe nada', async () => {
    const { service, manager } = build({ projectExists: false });
    await expect(service.create(PROJECT_ID, dto, admin)).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('ya existe un presupuesto: 409 BUDGET_ALREADY_EXISTS y no se escribe nada', async () => {
    const { service, manager } = build({ existingVersions: 1 });
    const error = await service.create(PROJECT_ID, dto, admin).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'BUDGET_ALREADY_EXISTS' });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('si el proyecto solo tiene versiones HISTÓRICAS (ninguna vigente) tampoco se crea otra versión 1: 409', async () => {
    const { service, manager } = build({ existingVersions: 3 });
    await expect(service.create(PROJECT_ID, dto, admin)).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('orden dentro de la transacción: lock del proyecto → verificación → presupuesto → auditoría', async () => {
    const { service, calls } = build();
    await service.create(PROJECT_ID, dto, admin);
    expect(calls).toEqual(['lock', 'count', 'save-budget', 'save-audit']);
  });

  it('toda la operación corre en UNA transacción (presupuesto y auditoría juntos)', async () => {
    const { service, dataSource } = build();
    await service.create(PROJECT_ID, dto, admin);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('auditoría en audit_logs: BUDGET / BUDGET_CREATED / actor / UI / valores nuevos, sin valores anteriores', async () => {
    const { service, saved } = build();
    await service.create(PROJECT_ID, dto, admin);

    expect(BUDGET_CREATED_ACTION).toBe('BUDGET_CREATED');
    expect(saved[1]).toMatchObject({
      __entity: AuditLogEntity,
      entityType: AuditEntityType.BUDGET,
      entityId: 'budget-1',
      action: 'BUDGET_CREATED',
      userId: 'admin-1',
      origin: AuditOrigin.UI,
      oldValues: null,
      newValues: { projectId: PROJECT_ID, version: 1, totalAmount: '1500000.50', currency: 'ARS', approvalDate: '2026-10-12' },
    });
  });

  it('NO escribe en project_activities (su feed lo ven todos los miembros: filtraría datos económicos, RN-25)', async () => {
    const { service, manager } = build();
    await service.create(PROJECT_ID, dto, admin);
    const entities = manager.create.mock.calls.map((call) => call[0]);
    expect(entities).toEqual([BudgetEntity, AuditLogEntity]);
  });

  it('si falla la auditoría el error se propaga (la transacción real revierte también el presupuesto)', async () => {
    const { service } = build({ failOn: 'audit' });
    await expect(service.create(PROJECT_ID, dto, admin)).rejects.toThrow('falló la auditoría');
  });

  it('violación de UNIQUE (carrera extrema que el lock no ordenó) → 409, no 500', async () => {
    const { service } = build({ failOn: 'unique' });
    const error = await service.create(PROJECT_ID, dto, admin).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'BUDGET_ALREADY_EXISTS' });
  });
});

describe('BudgetsService.getCurrent (presupuesto vigente)', () => {
  it.each([
    ['ADMIN', admin],
    ['PROGRAM_MANAGER', pm],
    ['líder real del proyecto', realLeader],
  ])('%s: ve el presupuesto vigente', async (_label, actor) => {
    const { service } = build({ existingVersions: 1 });
    await expect(service.getCurrent(PROJECT_ID, actor)).resolves.toMatchObject({ version: 1, isCurrent: true, totalAmount: '1500000.50' });
  });

  it.each([
    ['COLLABORATOR', collaborator],
    ['OBSERVER', observer],
    ['PROJECT_LEADER ajeno', foreignLeader],
    ['leaderId histórico sin el rol PROJECT_LEADER', staleLeader],
  ])('%s: 403 (nunca un 200 vacío ni un null: RN-25) y no consulta presupuestos', async (_label, actor) => {
    const { service, budgetRepo } = build({ existingVersions: 1 });
    const error = await service.getCurrent(PROJECT_ID, actor).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(budgetRepo.findOneBy).not.toHaveBeenCalled();
    expect(budgetRepo.count).not.toHaveBeenCalled();
    expect(JSON.stringify((error as ForbiddenException).getResponse())).not.toMatch(/1500000|ARS/);
  });

  it('proyecto inexistente: 404', async () => {
    const { service } = build({ projectExists: false });
    await expect(service.getCurrent(PROJECT_ID, admin)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('consulta EXCLUSIVAMENTE is_current = true (no max(version) ni "el último")', async () => {
    const { service, budgetRepo } = build({ existingVersions: 2 });
    await service.getCurrent(PROJECT_ID, admin);
    expect(budgetRepo.findOneBy).toHaveBeenCalledWith({ projectId: PROJECT_ID, isCurrent: true });
  });

  it('sin presupuesto (usuario autorizado): 404 BUDGET_NOT_FOUND', async () => {
    const { service } = build({ existingVersions: 0 });
    const error = await service.getCurrent(PROJECT_ID, admin).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toMatchObject({ code: 'BUDGET_NOT_FOUND' });
  });

  it('versiones históricas pero NINGUNA vigente: inconsistencia → 500 BUDGET_NO_CURRENT_VERSION, se loguea y NO se elige ninguna', async () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    // findOneBy(is_current) → null, pero count > 0
    const { service } = build({ existingVersions: 2, failOn: 'budget' });

    const error = await service.getCurrent(PROJECT_ID, admin).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect((error as InternalServerErrorException).getResponse()).toMatchObject({ code: 'BUDGET_NO_CURRENT_VERSION' });
    expect(logger).toHaveBeenCalledWith(expect.stringContaining(PROJECT_ID));
    expect(JSON.stringify((error as InternalServerErrorException).getResponse())).not.toMatch(/totalAmount|1500000/);
    logger.mockRestore();
  });

  it('la respuesta conserva los importes como texto con 2 decimales', async () => {
    const { service } = build({ existingVersions: 1 });
    const result = await service.getCurrent(PROJECT_ID, admin);
    expect(typeof result.totalAmount).toBe('string');
    expect(result.totalAmount).toBe('1500000.50');
  });
});

describe('la membresía local en el proyecto no da acceso económico', () => {
  it.each([
    ['COLLABORATOR con rol local COLLABORATOR', collaborator, ProjectMemberRole.COLLABORATOR],
    ['OBSERVER con rol local OBSERVER', observer, ProjectMemberRole.OBSERVER],
    ['COLLABORATOR global con rol local OBSERVER', collaborator, ProjectMemberRole.OBSERVER],
  ])('%s: aunque pertenezca al proyecto, GET → 403 y POST → 403', async (_label, actor, membership) => {
    const { service, budgetRepo } = build({ existingVersions: 1, membership });
    await expect(service.getCurrent(PROJECT_ID, actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.create(PROJECT_ID, dto, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(budgetRepo.findOneBy).not.toHaveBeenCalled();
  });
});
