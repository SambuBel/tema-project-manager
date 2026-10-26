import 'reflect-metadata';
import { ForbiddenException, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { PermissionsService } from '../auth/permissions.service';
import { ProjectEntity } from '../projects/project.entity';
import { RoleName } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const LEADER_ID = 'leader-1';
const CAT_RRHH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAT_LIC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user = (id: string, roles: RoleName[]): RequestUser => ({ id, roles }) as RequestUser;
const admin = user('admin-1', [RoleName.ADMIN]);
const pm = user('pm-1', [RoleName.PROGRAM_MANAGER]);
const realLeader = user(LEADER_ID, [RoleName.PROJECT_LEADER]);
const foreignLeader = user('otro', [RoleName.PROJECT_LEADER]);
const collaborator = user('c', [RoleName.COLLABORATOR]);
const observer = user('o', [RoleName.OBSERVER]);
const project = { id: PROJECT_ID, leaderId: LEADER_ID } as ProjectEntity;

type Version = {
  id: string; projectId: string; version: number; totalAmount: string; currency: string; approvalDate: string;
  isCurrent: boolean; supersededAt: Date | null; createdBy: string; createdAt: Date; createdByName: string;
};
const v = (version: number, extra: Partial<Version> = {}): Version => ({
  id: `b${version}`, projectId: PROJECT_ID, version, totalAmount: `${version}00.00`, currency: 'ARS', approvalDate: '2026-10-25',
  isCurrent: false, supersededAt: new Date('2026-10-26T10:00:00Z'), createdBy: 'admin-1', createdAt: new Date('2026-10-25T10:00:00Z'),
  createdByName: 'Alicia', ...extra,
});
// V3 vigente, V2 y V1 históricas (la consulta ya viene en version DESC)
const THREE = [v(3, { isCurrent: true, supersededAt: null }), v(2), v(1)];
const ITEMS = [
  { budgetId: 'b1', costCategoryId: CAT_RRHH, categoryName: 'Recursos humanos', amount: '70.00' },
  { budgetId: 'b1', costCategoryId: CAT_LIC, categoryName: 'Licencias y software', amount: '30.00' },
  { budgetId: 'b2', costCategoryId: CAT_RRHH, categoryName: 'Recursos humanos', amount: '200.00' },
  { budgetId: 'b3', costCategoryId: CAT_RRHH, categoryName: 'Recursos humanos', amount: '100.00' },
  { budgetId: 'b3', costCategoryId: CAT_LIC, categoryName: 'Licencias y software', amount: '200.00' },
];

function build(opts: { projectExists?: boolean; versions?: Version[]; items?: typeof ITEMS } = {}) {
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    void params;
    return sql.includes('FROM budget_items') ? (opts.items ?? ITEMS) : (opts.versions ?? THREE);
  });
  const projectRepo = { findOneBy: jest.fn(async () => (opts.projectExists === false ? null : project)) };
  const dataSource = { manager: { query } };
  const service = new BudgetsService({} as never, projectRepo as never, new PermissionsService({ findOne: jest.fn() } as never), dataSource as never);
  return { service, query, projectRepo };
}

describe('BudgetsService.getHistory', () => {
  it.each([['ADMIN', admin], ['PROGRAM_MANAGER', pm], ['líder real', realLeader]])('%s: ve el historial completo', async (_n, actor) => {
    const { service } = build();
    const history = await service.getHistory(PROJECT_ID, actor);
    expect(history.map((h) => h.version)).toEqual([3, 2, 1]);
  });

  it.each([['líder ajeno', foreignLeader], ['COLLABORATOR', collaborator], ['OBSERVER', observer]])(
    '%s: 403 (nunca [] ni datos parciales) y no consulta presupuestos',
    async (_n, actor) => {
      const { service, query } = build();
      const error = await service.getHistory(PROJECT_ID, actor).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(query).not.toHaveBeenCalled();
      expect(JSON.stringify((error as ForbiddenException).getResponse())).not.toMatch(/Alicia|ARS|100\.00/);
    },
  );

  it('proyecto inexistente: 404', async () => {
    const { service, query } = build({ projectExists: false });
    await expect(service.getHistory(PROJECT_ID, admin)).rejects.toBeInstanceOf(NotFoundException);
    expect(query).not.toHaveBeenCalled();
  });

  it('proyecto sin presupuestos: 404 BUDGET_NOT_FOUND (igual que el GET vigente)', async () => {
    const { service } = build({ versions: [] });
    const error = (await service.getHistory(PROJECT_ID, admin).catch((e: unknown) => e)) as NotFoundException;
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toMatchObject({ code: 'BUDGET_NOT_FOUND' });
  });

  it('cada versión trae SUS propias partidas, con el orden estable por rubro', async () => {
    const { service } = build();
    const history = await service.getHistory(PROJECT_ID, admin);
    const amountsOf = (version: number) => history.find((h) => h.version === version)!.items.map((i) => [i.categoryName, i.amount]);
    expect(amountsOf(1)).toEqual([['Licencias y software', '30.00'], ['Recursos humanos', '70.00']]);
    expect(amountsOf(2)).toEqual([['Recursos humanos', '200.00']]);
    expect(amountsOf(3)).toEqual([['Licencias y software', '200.00'], ['Recursos humanos', '100.00']]);
  });

  it('el orden es el de la consulta: version DESC', async () => {
    const { service, query } = build();
    await service.getHistory(PROJECT_ID, admin);
    expect(query.mock.calls[0]![0]).toMatch(/ORDER BY b\.version DESC/);
  });

  it('contrato: campos de Budget + createdByUser {id, name}; fechas ISO; importes como texto', async () => {
    const { service } = build();
    const [latest, , oldest] = await service.getHistory(PROJECT_ID, admin);
    expect(latest).toEqual({
      id: 'b3', projectId: PROJECT_ID, version: 3, totalAmount: '300.00', currency: 'ARS', approvalDate: '2026-10-25', isCurrent: true,
      supersededAt: null, createdBy: 'admin-1', createdAt: '2026-10-25T10:00:00.000Z',
      items: [
        { costCategoryId: CAT_LIC, categoryName: 'Licencias y software', amount: '200.00' },
        { costCategoryId: CAT_RRHH, categoryName: 'Recursos humanos', amount: '100.00' },
      ],
      createdByUser: { id: 'admin-1', name: 'Alicia' },
    });
    expect(oldest!.supersededAt).toBe('2026-10-26T10:00:00.000Z');
    expect(typeof oldest!.totalAmount).toBe('string');
  });

  it('el cambio de moneda se ve por versión, sin conversión', async () => {
    const { service } = build({ versions: [v(2, { isCurrent: true, supersededAt: null, currency: 'USD' }), v(1)] });
    const history = await service.getHistory(PROJECT_ID, admin);
    expect(history.map((h) => [h.version, h.currency])).toEqual([[2, 'USD'], [1, 'ARS']]);
  });

  it('una versión sin partidas (previa a PRES-04) se devuelve con items []', async () => {
    const { service } = build({ items: [] });
    const history = await service.getHistory(PROJECT_ID, admin);
    expect(history.every((h) => Array.isArray(h.items) && h.items.length === 0)).toBe(true);
  });

  it('NO filtra partidas por rubro activo: la consulta de partidas no mira cost_categories.active', async () => {
    const { service, query } = build();
    await service.getHistory(PROJECT_ID, admin);
    const itemsSql = query.mock.calls.find((c) => String(c[0]).includes('FROM budget_items'))![0] as string;
    expect(itemsSql).not.toMatch(/active/i);
  });

  it('NO lee audit_logs', async () => {
    const { service, query } = build();
    await service.getHistory(PROJECT_ID, admin);
    for (const call of query.mock.calls) expect(String(call[0])).not.toMatch(/audit_logs/);
  });

  it('sin N+1: exactamente 2 consultas sin importar cuántas versiones haya', async () => {
    const many = Array.from({ length: 40 }, (_, i) => v(40 - i, i === 0 ? { isCurrent: true, supersededAt: null } : {}));
    const { service, query } = build({ versions: many, items: [] });
    await service.getHistory(PROJECT_ID, admin);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]![1]).toEqual([many.map((m) => m.id)]); // una sola consulta de partidas para TODAS las versiones
  });

  describe('integridad: no se corrige ni se infiere nada', () => {
    let logger: jest.SpyInstance;
    beforeEach(() => {
      logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => logger.mockRestore());

    it('versiones pero NINGUNA vigente: 500 BUDGET_NO_CURRENT_VERSION y no consulta partidas', async () => {
      const { service, query } = build({ versions: [v(2), v(1)] });
      const error = (await service.getHistory(PROJECT_ID, admin).catch((e: unknown) => e)) as InternalServerErrorException;
      expect(error.getResponse()).toMatchObject({ code: 'BUDGET_NO_CURRENT_VERSION' });
      expect(logger).toHaveBeenCalledWith(expect.stringContaining(PROJECT_ID));
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('MÁS DE UNA vigente: 500 BUDGET_VERSION_STATE_INVALID', async () => {
      const { service } = build({ versions: [v(2, { isCurrent: true }), v(1, { isCurrent: true })] });
      const error = (await service.getHistory(PROJECT_ID, admin).catch((e: unknown) => e)) as InternalServerErrorException;
      expect(error.getResponse()).toMatchObject({ code: 'BUDGET_VERSION_STATE_INVALID' });
    });

    it('la vigente NO es la de mayor número: 500 BUDGET_VERSION_STATE_INVALID', async () => {
      const { service } = build({ versions: [v(3), v(2, { isCurrent: true, supersededAt: null }), v(1)] });
      const error = (await service.getHistory(PROJECT_ID, admin).catch((e: unknown) => e)) as InternalServerErrorException;
      expect(error.getResponse()).toMatchObject({ code: 'BUDGET_VERSION_STATE_INVALID' });
      expect(logger).toHaveBeenCalledWith(expect.stringMatching(/vigente la versión 2.*máxima es 3/));
    });

    it('los errores no filtran importes', async () => {
      const { service } = build({ versions: [v(2), v(1)] });
      const error = (await service.getHistory(PROJECT_ID, admin).catch((e: unknown) => e)) as InternalServerErrorException;
      expect(JSON.stringify(error.getResponse())).not.toMatch(/\d00\.00|Alicia/);
    });
  });
});
