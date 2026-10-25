import 'reflect-metadata';
import { BadRequestException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import dataSource from '../database/data-source';
import { ResourceAllocationsService } from './resource-allocations.service';
import { calculateEstimatedCost } from './dto/estimated-cost';
import { BudgetsService } from '../budgets/budgets.service';
import { PermissionsService } from '../auth/permissions.service';
import { BudgetEntity } from '../database/entities/budget.entity';
import { ProjectEntity } from '../projects/project.entity';
import { ProjectSlugHistoryEntity } from '../projects/project-slug-history.entity';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { RoleName } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';

/**
 * ResourceAllocationsService contra PostgreSQL REAL: snapshots, versionado, redondeo contra round() de Postgres, concurrencia,
 * rollback, carreras con el catálogo y con el presupuesto.
 *   pnpm --filter @tema/backend test:db
 * El servicio abre SUS PROPIAS transacciones (se confirman): los datos de prueba se crean y se BORRAN explícitamente (sufijo único).
 */
const SUFFIX = `res02-${Date.now()}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let admin: RequestUser;
let pm: RequestUser;
let leader: RequestUser;
let foreignLeader: RequestUser;
let collaborator: RequestUser;
let observer: RequestUser;
const userIds: string[] = [];
const projectIds: string[] = [];
const profileIds: string[] = [];
let senior: string; // Senior USD 50
let architect: string; // Arquitecto USD 80
let inactiveProfile: string; // inactivo
let pesos: string; // ARS 60000
const cats = { rrhh: '', lic: '' };
let projectId: string;
let memberId: string;
let service: ResourceAllocationsService;

const permissions = () => new PermissionsService(dataSource.getRepository(ProjectMemberEntity));
const buildService = (ds: object = dataSource) =>
  new ResourceAllocationsService(dataSource.getRepository(ProjectEntity), dataSource.getRepository(ProjectSlugHistoryEntity), permissions(), ds as DataSource);
const buildBudgets = () => new BudgetsService(dataSource.getRepository(BudgetEntity), dataSource.getRepository(ProjectEntity), permissions(), dataSource);

async function createUser(label: string, roles: RoleName[]): Promise<RequestUser> {
  const [{ id }] = await dataSource.query(`INSERT INTO users (email, name, active) VALUES ($1, $2, true) RETURNING id`, [`${label}-${SUFFIX}@tema-test.com`, label]);
  userIds.push(id);
  return { id, name: label, roles } as RequestUser;
}
/** Moneda ÚNICA del proyecto: USD por defecto en este spec (los perfiles de prueba son USD); `currency` la cambia. */
async function createProject(leaderId: string, slug?: string, currency = 'USD'): Promise<string> {
  const n = `${SUFFIX}-${projectIds.length}`;
  const [{ id }] = await dataSource.query(
    `INSERT INTO projects (name, slug, status, leader_id, created_by, economic_currency) VALUES ($1, $2, 'PLANNED', $3, $3, $4) RETURNING id`,
    [`Test ${n}`, slug ?? `test-${n}`, leaderId, currency],
  );
  projectIds.push(id);
  return id as string;
}
async function createMember(project: string, label: string): Promise<{ memberId: string; user: RequestUser }> {
  const user = await createUser(label, [RoleName.COLLABORATOR]);
  const [{ id }] = await dataSource.query(`INSERT INTO project_members (project_id, user_id, project_role) VALUES ($1, $2, 'COLLABORATOR') RETURNING id`, [project, user.id]);
  return { memberId: id as string, user };
}
async function createProfile(label: string, hourly: string, currency: string, active = true): Promise<string> {
  const [{ id }] = await dataSource.query(`INSERT INTO resource_profiles (name, hourly_cost, currency, active) VALUES ($1, $2, $3, $4) RETURNING id`, [`${label} ${SUFFIX}`, hourly, currency, active]);
  profileIds.push(id);
  return id as string;
}
async function withBudget(project: string) {
  await buildBudgets().create(
    project,
    { totalAmount: '1000.00', approvalDate: '2026-10-01', items: [{ costCategoryId: cats.rrhh, amount: '600.00' }, { costCategoryId: cats.lic, amount: '400.00' }] },
    admin,
  );
}

type Rev = {
  revision: number; is_current: boolean; superseded_at: Date | null; resource_profile_id: string | null; profile_name_snapshot: string | null;
  hourly_cost_snapshot: string | null; currency_snapshot: string | null; estimated_hours: string | null; estimated_cost_snapshot: string | null;
  budget_id: string | null; changed_by: string; origin: string; created_at: Date; created_micro: string; superseded_micro: string | null;
};
const revisions = async (member: string): Promise<Rev[]> =>
  dataSource.query(
    `SELECT revision, is_current, superseded_at, resource_profile_id, profile_name_snapshot, hourly_cost_snapshot::text, currency_snapshot, estimated_hours::text,
            estimated_cost_snapshot::text, budget_id, changed_by, origin::text, created_at,
            to_char(created_at, 'YYYY-MM-DD HH24:MI:SS.US') AS created_micro, to_char(superseded_at, 'YYYY-MM-DD HH24:MI:SS.US') AS superseded_micro
       FROM project_member_allocations WHERE project_member_id = $1 ORDER BY revision`,
    [member],
  );
const countCurrent = async (member: string) => (await dataSource.query(`SELECT count(*)::int AS n FROM project_member_allocations WHERE project_member_id = $1 AND is_current`, [member]))[0].n as number;
const count = async (sql: string, params: unknown[] = []): Promise<number> => (await dataSource.query(sql, params))[0].n as number;

/** Servicio cuya transacción ejecuta `afterQuery` apenas termina una consulta que contiene `marker`. */
function hooked(marker: string, afterQuery: () => Promise<void>): ResourceAllocationsService {
  return buildService({
    transaction: (run: (manager: unknown) => Promise<unknown>) =>
      dataSource.transaction(async (manager) =>
        run(
          new Proxy(manager, {
            get(target, prop, receiver) {
              if (prop !== 'query') return Reflect.get(target, prop, receiver);
              return async (sql: string, params?: unknown[]) => {
                const result = await target.query(sql, params);
                if (sql.includes(marker)) await afterQuery();
                return result;
              };
            },
          }),
        ),
    ),
    manager: dataSource.manager,
  });
}

beforeAll(async () => {
  if (!dataSource.isInitialized) await dataSource.initialize();
  admin = await createUser('admin', [RoleName.ADMIN]);
  pm = await createUser('pm', [RoleName.PROGRAM_MANAGER]);
  leader = await createUser('leader', [RoleName.PROJECT_LEADER]);
  foreignLeader = await createUser('ajeno', [RoleName.PROJECT_LEADER]);
  collaborator = await createUser('collab', [RoleName.COLLABORATOR]);
  observer = await createUser('obs', [RoleName.OBSERVER]);
  service = buildService();
  const rows: Array<{ id: string; name: string }> = await dataSource.query(`SELECT id, name FROM cost_categories WHERE active`);
  cats.rrhh = rows.find((r) => r.name === 'Recursos humanos')!.id;
  cats.lic = rows.find((r) => r.name === 'Licencias y software')!.id;
  senior = await createProfile('Consultor Senior', '50.00', 'USD');
  architect = await createProfile('Arquitecto', '80.00', 'USD');
  inactiveProfile = await createProfile('Perfil inactivo', '10.00', 'USD', false);
  pesos = await createProfile('Senior pesos', '60000.00', 'ARS');
});

beforeEach(async () => {
  projectId = await createProject(leader.id);
  memberId = (await createMember(projectId, `miembro-${projectIds.length}`)).memberId;
});

afterAll(async () => {
  await dataSource.query(`DELETE FROM audit_logs WHERE entity_type = 'BUDGET' AND entity_id IN (SELECT id FROM budgets WHERE project_id = ANY($1::uuid[]))`, [projectIds]);
  await dataSource.query(`DELETE FROM projects WHERE id = ANY($1::uuid[])`, [projectIds]); // arrastra miembros, asignaciones y presupuestos
  await dataSource.query(`DELETE FROM resource_profiles WHERE id = ANY($1::uuid[])`, [profileIds]);
  await dataSource.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
  if (dataSource.isInitialized) await dataSource.destroy();
});

describe('asignación, snapshot y versionado', () => {
  it('primera asignación (expectedRevision 0): revision 1, snapshot congelado, quién y cuándo, origen UI', async () => {
    const result = await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '100' }, leader);
    expect(result.allocation).toMatchObject({
      revision: 1,
      resourceProfile: { id: senior, name: `Consultor Senior ${SUFFIX}`, hourlyCost: '50.00', currency: 'USD' },
      estimatedHours: '100.00',
      estimatedResourceCost: { amount: '5000.00', currency: 'USD' },
      budgetId: null,
      budgetVersion: null,
      changedBy: { id: leader.id, name: 'leader' },
    });
    const [only] = await revisions(memberId);
    expect(only).toMatchObject({ revision: 1, is_current: true, superseded_at: null, changed_by: leader.id, origin: 'UI', hourly_cost_snapshot: '50.00', estimated_cost_snapshot: '5000.00' });
  });

  it('TARIFA HISTÓRICA: el catálogo pasa de 50 a 60 y solo cambian las horas 100 → 120: 120 × 50 = 6000, NO 7200', async () => {
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '100' }, admin);
    await dataSource.query(`UPDATE resource_profiles SET hourly_cost = 60, revision = revision + 1 WHERE id = $1`, [senior]);
    try {
      const result = await service.update(projectId, memberId, { expectedRevision: 1, estimatedHours: '120' }, admin);
      expect(result.allocation!.estimatedResourceCost).toEqual({ amount: '6000.00', currency: 'USD' });
      expect(result.allocation!.resourceProfile).toMatchObject({ hourlyCost: '50.00' });
      const history = await revisions(memberId);
      expect(history.map((r) => [r.revision, r.hourly_cost_snapshot, r.estimated_hours, r.estimated_cost_snapshot])).toEqual([
        [1, '50.00', '100.00', '5000.00'],
        [2, '50.00', '120.00', '6000.00'],
      ]);
    } finally {
      await dataSource.query(`UPDATE resource_profiles SET hourly_cost = 50 WHERE id = $1`, [senior]);
    }
  });

  it('el catálogo cambia nombre, tarifa, moneda y active: ninguna asignación existente se toca (y la lectura sigue mostrando el snapshot)', async () => {
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '100' }, admin);
    const before = await revisions(memberId);
    await dataSource.query(`UPDATE resource_profiles SET name = $2, hourly_cost = 99999, currency = 'ARS', active = false WHERE id = $1`, [senior, `Renombrado ${SUFFIX}`]);
    try {
      expect(await revisions(memberId)).toEqual(before);
      const current = await service.getCurrent(projectId, admin);
      expect(current.members[0]!.allocation).toMatchObject({
        resourceProfile: { name: `Consultor Senior ${SUFFIX}`, hourlyCost: '50.00', currency: 'USD' },
        estimatedResourceCost: { amount: '5000.00', currency: 'USD' },
      });
      // y como el perfil quedó inactivo, solo las horas se pueden seguir editando con la tarifa histórica
      const edited = await service.update(projectId, memberId, { expectedRevision: 1, estimatedHours: '110' }, admin);
      expect(edited.allocation!.estimatedResourceCost).toEqual({ amount: '5500.00', currency: 'USD' });
    } finally {
      await dataSource.query(`UPDATE resource_profiles SET name = $2, hourly_cost = 50, currency = 'USD', active = true WHERE id = $1`, [senior, `Consultor Senior ${SUFFIX}`]);
    }
  });

  it('cambio de perfil Senior USD 50 → Arquitecto USD 80 con 120 h: toma la tarifa NUEVA (9600) y conserva la anterior en el histórico', async () => {
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '100' }, admin);
    await service.update(projectId, memberId, { expectedRevision: 1, estimatedHours: '120' }, admin);
    const result = await service.update(projectId, memberId, { expectedRevision: 2, resourceProfileId: architect }, admin);
    expect(result.allocation).toMatchObject({ revision: 3, resourceProfile: { name: `Arquitecto ${SUFFIX}`, hourlyCost: '80.00' }, estimatedResourceCost: { amount: '9600.00', currency: 'USD' } });
    const history = await revisions(memberId);
    expect(history.map((r) => [r.revision, r.is_current, r.profile_name_snapshot?.split(' ')[0], r.hourly_cost_snapshot, r.estimated_cost_snapshot])).toEqual([
      [1, false, 'Consultor', '50.00', '5000.00'],
      [2, false, 'Consultor', '50.00', '6000.00'],
      [3, true, 'Arquitecto', '80.00', '9600.00'],
    ]);
    expect(await countCurrent(memberId)).toBe(1);
  });

  it('MONEDA ÚNICA: un perfil de otra moneda que la del proyecto se rechaza (400 RESOURCE_PROFILE_CURRENCY_MISMATCH) y no deja ninguna revisión nueva', async () => {
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '10' }, admin);
    await expect(service.update(projectId, memberId, { expectedRevision: 1, resourceProfileId: pesos }, admin)).rejects.toMatchObject({
      response: { code: 'RESOURCE_PROFILE_CURRENCY_MISMATCH', profileCurrency: 'ARS', projectCurrency: 'USD' },
    });
    expect((await revisions(memberId)).map((r) => [r.revision, r.currency_snapshot, r.is_current])).toEqual([[1, 'USD', true]]);
    expect(await countCurrent(memberId)).toBe(1);
  });

  it('proyecto ARS: un perfil ARS se asigna (✅) y uno USD se rechaza (❌); sin conversión', async () => {
    const arsProject = await createProject(leader.id, undefined, 'ARS');
    const arsMember = await createMember(arsProject, 'ars');
    const ok = await service.update(arsProject, arsMember.memberId, { expectedRevision: 0, resourceProfileId: pesos, estimatedHours: '10' }, admin);
    expect(ok.allocation!.estimatedResourceCost).toEqual({ amount: '600000.00', currency: 'ARS' });
    await expect(service.update(arsProject, arsMember.memberId, { expectedRevision: 1, resourceProfileId: senior }, admin)).rejects.toMatchObject({
      response: { code: 'RESOURCE_PROFILE_CURRENCY_MISMATCH', profileCurrency: 'USD', projectCurrency: 'ARS' },
    });
    expect((await service.getCurrent(arsProject, admin)).totalsByCurrency).toEqual([{ currency: 'ARS', amount: '600000.00' }]);
  });

  it('conservar el perfil actual cuando el catálogo ya cambió de moneda NO se vuelve a validar: cambiar solo las horas mantiene el snapshot', async () => {
    const own = await createProfile('Propio cambia de moneda', '50.00', 'USD'); // perfil propio: no tocar los compartidos
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: own, estimatedHours: '100' }, admin);
    await dataSource.query(`UPDATE resource_profiles SET currency = 'ARS', hourly_cost = 70 WHERE id = $1`, [own]);
    const result = await service.update(projectId, memberId, { expectedRevision: 1, estimatedHours: '120' }, admin);
    expect(result.allocation).toMatchObject({ resourceProfile: { hourlyCost: '50.00', currency: 'USD' }, estimatedResourceCost: { amount: '6000.00', currency: 'USD' } });
  });

  it('reenviar el mismo perfil NO refresca la tarifa del catálogo (y sin otro cambio es NO_CHANGES)', async () => {
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '100' }, admin);
    await dataSource.query(`UPDATE resource_profiles SET hourly_cost = 70 WHERE id = $1`, [senior]);
    try {
      await expect(service.update(projectId, memberId, { expectedRevision: 1, resourceProfileId: senior, estimatedHours: '100' }, admin)).rejects.toMatchObject({ response: { code: 'RESOURCE_ALLOCATION_NO_CHANGES' } });
      const edited = await service.update(projectId, memberId, { expectedRevision: 1, resourceProfileId: senior, estimatedHours: '101' }, admin);
      expect(edited.allocation!.resourceProfile!.hourlyCost).toBe('50.00');
    } finally {
      await dataSource.query(`UPDATE resource_profiles SET hourly_cost = 50 WHERE id = $1`, [senior]);
    }
  });

  it('perfil y horas independientes: perfil primero (costo null), horas después (costo calculado); y quitar datos', async () => {
    const first = await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior }, admin);
    expect(first.allocation).toMatchObject({ estimatedHours: null, estimatedResourceCost: null });
    const second = await service.update(projectId, memberId, { expectedRevision: 1, estimatedHours: '10' }, admin);
    expect(second.allocation!.estimatedResourceCost).toEqual({ amount: '500.00', currency: 'USD' });
    const noHours = await service.update(projectId, memberId, { expectedRevision: 2, estimatedHours: null }, admin);
    expect(noHours.allocation).toMatchObject({ estimatedHours: null, estimatedResourceCost: null, resourceProfile: { hourlyCost: '50.00' } });
    const noProfile = await service.update(projectId, memberId, { expectedRevision: 3, estimatedHours: '8', resourceProfileId: null }, admin);
    expect(noProfile.allocation).toMatchObject({ resourceProfile: null, estimatedHours: '8.00', estimatedResourceCost: null });
    const rows = await revisions(memberId);
    expect(rows.at(-1)).toMatchObject({ resource_profile_id: null, profile_name_snapshot: null, hourly_cost_snapshot: null, currency_snapshot: null, estimated_cost_snapshot: null });
  });

  it('horas 0.00 válidas: el costo es 0.00 (no null)', async () => {
    const result = await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '0' }, admin);
    expect(result.allocation!.estimatedResourceCost).toEqual({ amount: '0.00', currency: 'USD' });
  });

  it('el redondeo en BigInt coincide con round(numeric, 2) de PostgreSQL (incluye mitades y el ejemplo de TEMA)', async () => {
    const cases: Array<[string, string]> = [['125.50', '50.25'], ['0.01', '0.50'], ['0.03', '0.50'], ['0.05', '0.50'], ['0.01', '0.49'], ['999999.99', '9999999999.99'], ['33.33', '7.77'], ['1.00', '0.01'], ['0.00', '12.34']];
    for (const [hours, rate] of cases) {
      const [{ cost }] = await dataSource.query(`SELECT round($1::numeric * $2::numeric, 2)::text AS cost`, [hours, rate]);
      expect(calculateEstimatedCost(hours, rate)).toBe(cost);
    }
  });

  it('el ejemplo de TEMA 125.50 × 50.25 se guarda como 6306.38', async () => {
    const odd = await createProfile('Tarifa 50.25', '50.25', 'USD');
    const result = await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: odd, estimatedHours: '125.50' }, admin);
    expect(result.allocation!.estimatedResourceCost).toEqual({ amount: '6306.38', currency: 'USD' });
  });

  it('no escribe nada en audit_logs ni en project_activities', async () => {
    const auditsBefore = await count(`SELECT count(*)::int AS n FROM audit_logs`);
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '1' }, admin);
    expect(await count(`SELECT count(*)::int AS n FROM audit_logs`)).toBe(auditsBefore);
    expect(await count(`SELECT count(*)::int AS n FROM project_activities WHERE project_id = $1`, [projectId])).toBe(0);
  });
});

describe('perfil inactivo e inexistente', () => {
  it('asignar o cambiar HACIA un perfil inactivo: 400 RESOURCE_PROFILE_INACTIVE y no deja nada', async () => {
    await expect(service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: inactiveProfile }, admin)).rejects.toMatchObject({ response: { code: 'RESOURCE_PROFILE_INACTIVE' } });
    expect(await revisions(memberId)).toEqual([]);
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '1' }, admin);
    await expect(service.update(projectId, memberId, { expectedRevision: 1, resourceProfileId: inactiveProfile }, admin)).rejects.toBeInstanceOf(BadRequestException);
    expect((await revisions(memberId)).length).toBe(1);
  });
  it('perfil inexistente: 400 RESOURCE_PROFILE_NOT_FOUND', async () => {
    await expect(service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: '00000000-0000-4000-8000-000000000000' }, admin)).rejects.toMatchObject({
      response: { code: 'RESOURCE_PROFILE_NOT_FOUND' },
    });
  });
});

describe('presupuesto vigente al crear cada revisión', () => {
  it('sin presupuesto: budget_id NULL y la asignación se permite', async () => {
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior }, admin);
    expect((await revisions(memberId))[0]!.budget_id).toBeNull();
  });
  it('cada revisión registra el presupuesto vigente de ese momento; un presupuesto nuevo no cambia el budget_id de las anteriores; la versión sale por join', async () => {
    await withBudget(projectId);
    const first = await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '10' }, admin);
    expect(first.allocation).toMatchObject({ budgetVersion: 1 });
    await buildBudgets().createVersion(
      projectId,
      { expectedVersion: 1, totalAmount: '2000.00', approvalDate: '2026-10-02', items: [{ costCategoryId: cats.rrhh, amount: '1500.00' }, { costCategoryId: cats.lic, amount: '500.00' }] },
      admin,
    );
    const second = await service.update(projectId, memberId, { expectedRevision: 1, estimatedHours: '20' }, admin);
    expect(second.allocation).toMatchObject({ budgetVersion: 2 });
    const history = await service.getHistory(projectId, memberId, admin);
    expect(history.map((h) => [h.revision, h.budgetVersion])).toEqual([[2, 2], [1, 1]]);
    const rows = await revisions(memberId);
    expect(rows[0]!.budget_id).not.toBe(rows[1]!.budget_id);
  });
  it('versiones pero ninguna vigente: 500 BUDGET_NO_CURRENT_VERSION y NO se guarda un budget_id null', async () => {
    await withBudget(projectId);
    await dataSource.query(`UPDATE budgets SET is_current = false, superseded_at = now() WHERE project_id = $1`, [projectId]);
    const error = (await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior }, admin).catch((e: unknown) => e)) as InternalServerErrorException;
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.getResponse()).toMatchObject({ code: 'BUDGET_NO_CURRENT_VERSION' });
    expect(await revisions(memberId)).toEqual([]);
  });
  it('vigente distinta de MAX(version): 500 BUDGET_VERSION_STATE_INVALID', async () => {
    await withBudget(projectId);
    await dataSource.query(
      `INSERT INTO budgets (project_id, version, total_amount, currency, approval_date, is_current, superseded_at, created_by) VALUES ($1, 5, 1.00, 'USD', '2026-01-01', false, now(), $2)`,
      [projectId, admin.id],
    );
    await expect(service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior }, admin)).rejects.toMatchObject({ response: { code: 'BUDGET_VERSION_STATE_INVALID' } });
  });
});

describe('permisos, miembros y proyectos', () => {
  it.each([['ADMIN', () => admin], ['PROGRAM_MANAGER', () => pm], ['líder real', () => leader]])('%s asigna y lee', async (_n, actor) => {
    await expect(service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior }, actor())).resolves.toBeDefined();
    await expect(service.getCurrent(projectId, actor())).resolves.toBeDefined();
  });
  it.each([['líder ajeno', () => foreignLeader], ['COLLABORATOR', () => collaborator], ['OBSERVER', () => observer]])('%s: 403 en escritura, lectura e historial; nada cambia', async (_n, actor) => {
    await expect(service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior }, actor())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getCurrent(projectId, actor())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getHistory(projectId, memberId, actor())).rejects.toBeInstanceOf(ForbiddenException);
    expect(await revisions(memberId)).toEqual([]);
  });
  it('el proyecto se resuelve por UUID, slug y slug anterior (histórico)', async () => {
    const slugged = await createProject(leader.id, `slug-${SUFFIX}`);
    const m = await createMember(slugged, 'con-slug');
    await dataSource.query(`INSERT INTO project_slug_histories (project_id, slug) VALUES ($1, $2)`, [slugged, `slug-viejo-${SUFFIX}`]).catch(() => undefined);
    await expect(service.update(`slug-${SUFFIX}`, m.memberId, { expectedRevision: 0, resourceProfileId: senior }, admin)).resolves.toBeDefined();
    await expect(service.getCurrent(slugged, admin)).resolves.toBeDefined();
    await expect(service.getCurrent('slug-inexistente-' + SUFFIX, admin)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('miembro de OTRO proyecto, dado de baja o inexistente: 404 PROJECT_MEMBER_NOT_FOUND (escritura); nada se crea', async () => {
    const other = await createProject(leader.id);
    const foreign = await createMember(other, 'miembro-otro-proyecto');
    await expect(service.update(projectId, foreign.memberId, { expectedRevision: 0, resourceProfileId: senior }, admin)).rejects.toMatchObject({ response: { code: 'PROJECT_MEMBER_NOT_FOUND' } });
    await dataSource.query(`UPDATE project_members SET removed_at = now() WHERE id = $1`, [memberId]);
    await expect(service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior }, admin)).rejects.toMatchObject({ response: { code: 'PROJECT_MEMBER_NOT_FOUND' } });
    expect(await revisions(memberId)).toEqual([]);
  });
});

describe('lectura vigente, totales por moneda e historial', () => {
  it('solo miembros ACTIVOS; los sin asignación aparecen con allocation null', async () => {
    const m2 = await createMember(projectId, 'zeta-sin-asignar');
    const m3 = await createMember(projectId, 'removido');
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '100' }, admin);
    await service.update(projectId, m3.memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '999' }, admin);
    await dataSource.query(`UPDATE project_members SET removed_at = now() WHERE id = $1`, [m3.memberId]);
    const current = await service.getCurrent(projectId, admin);
    expect(current.members.map((m) => m.projectMemberId).sort()).toEqual([memberId, m2.memberId].sort());
    expect(current.members.find((m) => m.projectMemberId === m2.memberId)!.allocation).toBeNull();
    expect(current.totalsByCurrency).toEqual([{ currency: 'USD', amount: '5000.00' }]); // el removido no suma
  });
  it('totalsByCurrency (moneda única: UNA sola línea): suma de importes ya redondeados, sin convertir; ignora los miembros sin costo', async () => {
    const odd = await createProfile('Tarifa 50.25 b', '50.25', 'USD');
    const members = [memberId, (await createMember(projectId, 'm-b')).memberId, (await createMember(projectId, 'm-c')).memberId, (await createMember(projectId, 'm-d')).memberId, (await createMember(projectId, 'm-e')).memberId];
    for (const id of members.slice(0, 3)) await service.update(projectId, id, { expectedRevision: 0, resourceProfileId: odd, estimatedHours: '125.50' }, admin);
    await service.update(projectId, members[3]!, { expectedRevision: 0, estimatedHours: '1.50' }, admin); // sin perfil: no suma
    await service.update(projectId, members[4]!, { expectedRevision: 0, resourceProfileId: senior }, admin); // sin horas: no suma
    const { totalsByCurrency } = await service.getCurrent(projectId, admin);
    expect(totalsByCurrency).toEqual([{ currency: 'USD', amount: '18919.14' }]); // 3 × 6306.38 (redondeado por miembro)
    expect(totalsByCurrency.length).toBeLessThanOrEqual(1);
    const [{ total }] = await dataSource.query(
      `SELECT sum(a.estimated_cost_snapshot)::text AS total FROM project_member_allocations a JOIN project_members pm ON pm.id = a.project_member_id
        WHERE pm.project_id = $1 AND a.is_current AND a.currency_snapshot = 'USD'`,
      [projectId],
    );
    expect(total).toBe('18919.14'); // y coincide con el SUM de SQL
  });
  it('historial: TODAS las revisiones (DESC) con snapshots, aunque el perfil y el presupuesto cambien después y aunque el miembro esté dado de baja', async () => {
    await withBudget(projectId);
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '100' }, leader);
    await service.update(projectId, memberId, { expectedRevision: 1, estimatedHours: '120' }, admin);
    await service.update(projectId, memberId, { expectedRevision: 2, resourceProfileId: architect }, pm);
    await dataSource.query(`UPDATE resource_profiles SET hourly_cost = 1, currency = 'ARS', name = $2 WHERE id = $1`, [senior, `Cambiado ${SUFFIX}`]);
    await dataSource.query(`UPDATE project_members SET removed_at = now() WHERE id = $1`, [memberId]);
    try {
      const history = await service.getHistory(projectId, memberId, admin);
      expect(history.map((h) => [h.revision, h.isCurrent, h.hourlyCostSnapshot, h.currencySnapshot, h.estimatedHours, h.estimatedCostSnapshot, h.changedBy.name, h.origin])).toEqual([
        [3, true, '80.00', 'USD', '120.00', '9600.00', 'pm', 'UI'],
        [2, false, '50.00', 'USD', '120.00', '6000.00', 'admin', 'UI'],
        [1, false, '50.00', 'USD', '100.00', '5000.00', 'leader', 'UI'],
      ]);
      expect(history[2]!.profileNameSnapshot).toBe(`Consultor Senior ${SUFFIX}`);
      expect(history.every((h) => h.budgetVersion === 1 && h.budgetId)).toBe(true);
      expect(history[2]!.supersededAt).toBe(history[1]!.createdAt); // mismo instante lógico: V2 nació cuando V1 dejó de regir
      expect(history[1]!.supersededAt).toBe(history[0]!.createdAt);
      expect(history[0]!.supersededAt).toBeNull();
      // y el GET vigente NO lo muestra (miembro removido)
      expect((await service.getCurrent(projectId, admin)).members.find((m) => m.projectMemberId === memberId)).toBeUndefined();
    } finally {
      await dataSource.query(`UPDATE resource_profiles SET hourly_cost = 50, currency = 'USD', name = $2 WHERE id = $1`, [senior, `Consultor Senior ${SUFFIX}`]);
    }
  });
  it('historial de un miembro de otro proyecto: 404; miembro sin asignaciones: []', async () => {
    const other = await createProject(leader.id);
    const foreign = await createMember(other, 'otro-hist');
    await expect(service.getHistory(projectId, foreign.memberId, admin)).rejects.toMatchObject({ response: { code: 'PROJECT_MEMBER_NOT_FOUND' } });
    await expect(service.getHistory(projectId, memberId, admin)).resolves.toEqual([]);
  });
  it('GET members (la entidad organizativa) jamás trae datos económicos aunque el miembro tenga asignación', async () => {
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '100' }, admin);
    const members = await dataSource.getRepository(ProjectMemberEntity).find({ where: { projectId }, relations: ['user'] });
    expect(JSON.stringify(members)).not.toMatch(/Consultor|5000|hourly|estimated|resourceProfile/i);
  });
  it('la re-alta (PENDIENTE de TEMA) conserva la asignación vigente sin refrescar la tarifa', async () => {
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '100' }, admin);
    await dataSource.query(`UPDATE project_members SET removed_at = now() WHERE id = $1`, [memberId]);
    await dataSource.query(`UPDATE resource_profiles SET hourly_cost = 70 WHERE id = $1`, [senior]);
    await dataSource.query(`UPDATE project_members SET removed_at = NULL WHERE id = $1`, [memberId]); // lo que hace addMember al reactivar
    try {
      const current = await service.getCurrent(projectId, admin);
      expect(current.members.find((m) => m.projectMemberId === memberId)!.allocation).toMatchObject({ revision: 1, resourceProfile: { hourlyCost: '50.00' } });
    } finally {
      await dataSource.query(`UPDATE resource_profiles SET hourly_cost = 50 WHERE id = $1`, [senior]);
    }
  });
});

describe('expectedRevision y concurrencia', () => {
  it('revisión desactualizada o incorrecta: 409 con currentRevision; sin asignación currentRevision es 0', async () => {
    await expect(service.update(projectId, memberId, { expectedRevision: 3, resourceProfileId: senior }, admin)).rejects.toMatchObject({ response: { code: 'RESOURCE_ALLOCATION_VERSION_CONFLICT', currentRevision: 0 } });
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '1' }, admin);
    await service.update(projectId, memberId, { expectedRevision: 1, estimatedHours: '2' }, admin);
    await expect(service.update(projectId, memberId, { expectedRevision: 1, estimatedHours: '3' }, admin)).rejects.toMatchObject({ response: { code: 'RESOURCE_ALLOCATION_VERSION_CONFLICT', currentRevision: 2 } });
    // aunque su contenido sea idéntico: conflicto, no NO_CHANGES
    await expect(service.update(projectId, memberId, { expectedRevision: 1, estimatedHours: '2' }, admin)).rejects.toMatchObject({ response: { code: 'RESOURCE_ALLOCATION_VERSION_CONFLICT' } });
  });
  it('PRIMERA asignación con 2 y 5 editores simultáneos (expectedRevision 0): UNO gana la revisión 1, el resto 409 con currentRevision 1', async () => {
    for (const editors of [2, 5]) {
      const target = (await createMember(projectId, `primera-${editors}`)).memberId;
      const results = await Promise.allSettled(
        Array.from({ length: editors }, (_, i) => service.update(projectId, target, { expectedRevision: 0, resourceProfileId: i % 2 ? architect : senior, estimatedHours: `${i + 1}` }, i % 2 ? pm : admin)),
      );
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of rejected) expect(r.reason).toMatchObject({ response: { code: 'RESOURCE_ALLOCATION_VERSION_CONFLICT', currentRevision: 1 } });
      expect((await revisions(target)).map((r) => r.revision)).toEqual([1]);
      expect(await countCurrent(target)).toBe(1);
    }
  });
  it.each([2, 5])('%s editores con expectedRevision 1: UNO crea la revisión 2, el resto 409 con currentRevision 2; queda UNA vigente', async (editors) => {
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '1' }, admin);
    const results = await Promise.allSettled(Array.from({ length: editors }, (_, i) => service.update(projectId, memberId, { expectedRevision: 1, estimatedHours: `${i + 10}` }, i % 2 ? pm : admin)));
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of rejected) expect(r.reason).toMatchObject({ response: { code: 'RESOURCE_ALLOCATION_VERSION_CONFLICT', currentRevision: 2 } });
    const rows = await revisions(memberId);
    expect(rows.map((r) => [r.revision, r.is_current])).toEqual([[1, false], [2, true]]);
    expect(await countCurrent(memberId)).toBe(1);
  });
  it('perfil por uno y horas por otro con el mismo token: el segundo recibe el conflicto (nunca se pisan en silencio)', async () => {
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '10' }, admin);
    const [a, b] = await Promise.allSettled([
      service.update(projectId, memberId, { expectedRevision: 1, resourceProfileId: architect }, leader),
      service.update(projectId, memberId, { expectedRevision: 1, estimatedHours: '99' }, pm),
    ]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect((await revisions(memberId)).length).toBe(2);
  });
  it('ediciones consecutivas muy rápidas: la revisión sube de a 1 y siempre hay una sola vigente', async () => {
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '1' }, admin);
    for (let revision = 1; revision <= 12; revision++) await service.update(projectId, memberId, { expectedRevision: revision, estimatedHours: `${revision + 1}` }, admin);
    const rows = await revisions(memberId);
    expect(rows.map((r) => r.revision)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(rows.filter((r) => r.is_current)).toHaveLength(1);
    expect(rows.at(-1)!.is_current).toBe(true);
  });
  it('proyectos/miembros distintos son independientes', async () => {
    const other = await createProject(leader.id);
    const m2 = await createMember(other, 'indep');
    const results = await Promise.all([
      service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior }, admin),
      service.update(other, m2.memberId, { expectedRevision: 0, resourceProfileId: architect }, admin),
    ]);
    expect(results.map((r) => r.allocation!.revision)).toEqual([1, 1]);
  });
});

describe('carreras con el catálogo y con el presupuesto', () => {
  it('asignación gana el lock del perfil: queda asignado con el perfil activo y la DESACTIVACIÓN espera hasta el commit', async () => {
    const racing = await createProfile('Carrera perfil', '10.00', 'USD');
    let deactivated = false;
    let deactivation: Promise<unknown> | undefined;
    let waited = false;
    const holding = hooked('FROM resource_profiles', async () => {
      deactivation = dataSource.query(`UPDATE resource_profiles SET active = false WHERE id = $1`, [racing]).then(() => {
        deactivated = true;
      });
      await sleep(400);
      waited = !deactivated;
    });
    const result = await holding.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: racing, estimatedHours: '3' }, admin);
    await deactivation;
    expect(waited).toBe(true);
    expect(result.allocation!.resourceProfile!.id).toBe(racing);
    expect(await count(`SELECT count(*)::int AS n FROM resource_profiles WHERE id = $1 AND NOT active`, [racing])).toBe(1); // y la desactivación se aplicó después
    // desde ahí la asignación sigue vigente (snapshot) y solo se puede editar horas
    await expect(service.update(projectId, memberId, { expectedRevision: 1, estimatedHours: '4' }, admin)).resolves.toBeDefined();
  });
  it('desactivación gana: la asignación ve el perfil inactivo → 400 RESOURCE_PROFILE_INACTIVE', async () => {
    const racing = await createProfile('Carrera perfil 2', '10.00', 'USD', false);
    await expect(service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: racing }, admin)).rejects.toMatchObject({ response: { code: 'RESOURCE_PROFILE_INACTIVE' } });
  });
  it('asignación gana el lock del proyecto: captura la V1 y la V2 del presupuesto ESPERA; nunca una referencia ambigua', async () => {
    await withBudget(projectId);
    let v2Done = false;
    let v2: Promise<void> | undefined;
    let v2Waited = false;
    const holding = hooked('FROM projects', async () => {
      v2 = buildBudgets()
        .createVersion(projectId, { expectedVersion: 1, totalAmount: '500.00', approvalDate: '2026-10-03', items: [{ costCategoryId: cats.rrhh, amount: '500.00' }] }, admin)
        .then(() => {
          v2Done = true;
        });
      await sleep(500);
      v2Waited = !v2Done;
    });
    const result = await holding.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '1' }, admin);
    await v2;
    expect(v2Waited).toBe(true);
    expect(result.allocation!.budgetVersion).toBe(1);
    const [row] = await dataSource.query(`SELECT b.version FROM project_member_allocations a JOIN budgets b ON b.id = a.budget_id WHERE a.project_member_id = $1`, [memberId]);
    expect(row.version).toBe(1);
  });
  it('presupuesto V2 gana: la asignación captura la V2', async () => {
    await withBudget(projectId);
    await buildBudgets().createVersion(projectId, { expectedVersion: 1, totalAmount: '500.00', approvalDate: '2026-10-03', items: [{ costCategoryId: cats.rrhh, amount: '500.00' }] }, admin);
    const result = await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '1' }, admin);
    expect(result.allocation!.budgetVersion).toBe(2);
  });
  it('carrera real asignación vs nueva versión del presupuesto: la revisión referencia exactamente UNA versión coherente', async () => {
    await withBudget(projectId);
    const [allocation, version] = await Promise.allSettled([
      service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '1' }, admin),
      buildBudgets().createVersion(projectId, { expectedVersion: 1, totalAmount: '500.00', approvalDate: '2026-10-03', items: [{ costCategoryId: cats.rrhh, amount: '500.00' }] }, admin),
    ]);
    expect(allocation.status).toBe('fulfilled');
    expect(version.status).toBe('fulfilled');
    const [row] = await dataSource.query(`SELECT b.version FROM project_member_allocations a JOIN budgets b ON b.id = a.budget_id WHERE a.project_member_id = $1`, [memberId]);
    expect([1, 2]).toContain(row.version);
  });
  it('baja del miembro en paralelo: la asignación (que tiene el lock del miembro) termina y la baja espera', async () => {
    let removed = false;
    let removal: Promise<unknown> | undefined;
    let waited = false;
    const holding = hooked('FOR UPDATE', async () => {
      removal = dataSource.query(`UPDATE project_members SET removed_at = now() WHERE id = $1`, [memberId]).then(() => {
        removed = true;
      });
      await sleep(400);
      waited = !removed;
    });
    await expect(holding.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior }, admin)).resolves.toBeDefined();
    await removal;
    expect(waited).toBe(true);
  });
});

describe('rollback: nunca quedan revisiones parciales', () => {
  const failing = (shouldFail: (sql: string) => boolean) =>
    buildService({
      transaction: (run: (manager: unknown) => Promise<unknown>) =>
        dataSource.transaction(async (manager) =>
          run(
            new Proxy(manager, {
              get(target, prop, receiver) {
                if (prop !== 'query') return Reflect.get(target, prop, receiver);
                return async (sql: string, params?: unknown[]) => {
                  const result = await target.query(sql, params);
                  if (shouldFail(sql)) throw new Error('fallo simulado');
                  return result;
                };
              },
            }),
          ),
        ),
      manager: dataSource.manager,
    });

  it('falla DESPUÉS de archivar la vigente y ANTES de insertar la nueva: la anterior sigue vigente e intacta', async () => {
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '100' }, admin);
    const before = await revisions(memberId);
    await expect(failing((sql) => sql.startsWith('UPDATE project_member_allocations')).update(projectId, memberId, { expectedRevision: 1, estimatedHours: '120' }, admin)).rejects.toThrow('fallo simulado');
    expect(await revisions(memberId)).toEqual(before);
    expect(await countCurrent(memberId)).toBe(1);
    await expect(service.update(projectId, memberId, { expectedRevision: 1, estimatedHours: '120' }, admin)).resolves.toBeDefined(); // los locks se liberaron
  });
  it('falla DESPUÉS de insertar la nueva y ANTES del commit: no queda la nueva y la anterior sigue vigente', async () => {
    await service.update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior, estimatedHours: '100' }, admin);
    const before = await revisions(memberId);
    await expect(failing((sql) => sql.includes('INSERT INTO project_member_allocations')).update(projectId, memberId, { expectedRevision: 1, estimatedHours: '120' }, admin)).rejects.toThrow('fallo simulado');
    expect(await revisions(memberId)).toEqual(before);
    expect((await revisions(memberId))[0]!.is_current).toBe(true);
  });
  it('falla en la PRIMERA asignación después de insertar: no queda ninguna revisión', async () => {
    await expect(failing((sql) => sql.includes('INSERT INTO project_member_allocations')).update(projectId, memberId, { expectedRevision: 0, resourceProfileId: senior }, admin)).rejects.toThrow('fallo simulado');
    expect(await revisions(memberId)).toEqual([]);
  });
});
