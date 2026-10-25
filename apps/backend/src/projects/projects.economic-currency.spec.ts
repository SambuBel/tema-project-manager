import 'reflect-metadata';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { validate } from 'class-validator';
import { getMetadataArgsStorage } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { ProjectsService } from './projects.service';
import { ProjectEntity } from './project.entity';
import { PermissionsService } from '../auth/permissions.service';
import { RoleName } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateProjectDto } from './create-project.dto';
import { UpdateProjectDtoImpl } from './update-project.dto';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const LEADER_ID = 'leader-1';
const user = (id: string, roles: RoleName[]): RequestUser => ({ id, roles }) as RequestUser;
const admin = user('admin-1', [RoleName.ADMIN]);
const pm = user('pm-1', [RoleName.PROGRAM_MANAGER]);
const realLeader = user(LEADER_ID, [RoleName.PROJECT_LEADER]);
const foreignLeader = user('otro', [RoleName.PROJECT_LEADER]);
const collaborator = user('c', [RoleName.COLLABORATOR]);

type Usage = { used: boolean };

function build(opts: { used?: boolean; currency?: string; projectExists?: boolean } = {}) {
  const calls: string[] = [];
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  const project = { id: PROJECT_ID, slug: 'p', name: 'P', description: null, startDate: null, estimatedEndDate: null, leaderId: LEADER_ID, leader: { id: LEADER_ID } } as unknown as ProjectEntity;
  const currentCurrency = opts.currency ?? 'ARS';
  let stored = currentCurrency; // lo que "tiene la base": el UPDATE la modifica

  const manager = {
    findOneBy: jest.fn(async () => project),
    findOne: jest.fn(async () => project),
    query: jest.fn(async (sql: string, params: unknown[] = []): Promise<unknown> => {
      if (sql.includes('FOR UPDATE')) {
        calls.push('lock-project');
        return opts.projectExists === false ? [] : [{ economicCurrency: currentCurrency }];
      }
      if (sql.includes('EXISTS')) {
        calls.push('check-usage');
        expect(sql).toMatch(/FROM budgets/);
        expect(sql).toMatch(/FROM costs/);
        expect(sql).toMatch(/project_member_allocations/);
        expect(sql).not.toMatch(/deleted_at/); // los dados de baja también cuentan
        return [{ used: opts.used ?? false } satisfies Usage];
      }
      if (sql.startsWith('UPDATE projects')) {
        calls.push('update-currency');
        updates.push({ sql, params });
        stored = params[1] as string;
        return [];
      }
      throw new Error(`consulta inesperada: ${sql}`);
    }),
    save: jest.fn(async (p: unknown) => p),
    create: jest.fn((_e: unknown, data: Record<string, unknown>) => ({ ...data })),
  };
  const visibleQuery = jest.fn(async (_sql: string, params: unknown[]) => (params[0] as string[]).map((id) => ({ id, economicCurrency: stored, locked: opts.used ?? false })));
  const dataSource = { transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(manager)), query: visibleQuery };
  const activity = { logEvent: jest.fn(async () => undefined) };
  const permissions = new PermissionsService({ findOne: jest.fn(async () => null) } as never);
  const repo = { findOne: jest.fn(async () => project), findOneBy: jest.fn(async () => project) };
  const service = new ProjectsService(repo as never, {} as never, {} as never, {} as never, permissions, dataSource as never, activity as never);
  return { service, manager, calls, updates, activity, dataSource, visibleQuery, project };
}

describe('ProjectsService.update - moneda única del proyecto', () => {
  it.each([['ADMIN', admin], ['PROGRAM_MANAGER', pm], ['líder real', realLeader]])('%s: sin datos económicos, cambia ARS → USD', async (_n, actor) => {
    const { service, updates, activity, calls } = build();
    const result = await service.update(PROJECT_ID, { economicCurrency: 'USD' }, actor);
    expect(result.economicCurrency).toBe('USD');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.params).toEqual([PROJECT_ID, 'USD']);
    expect(calls).toEqual(['lock-project', 'check-usage', 'update-currency']); // lock FOR UPDATE primero, luego el chequeo, luego el UPDATE
    expect(activity.logEvent).not.toHaveBeenCalled(); // nada económico en project_activities
  });

  it.each([['ARS', 'USD'], ['USD', 'ARS']])('con presupuesto, costos o asignaciones: %s → %s se rechaza con 409 PROJECT_CURRENCY_IN_USE y no escribe', async (current, requested) => {
    const { service, updates } = build({ used: true, currency: current });
    const error = (await service.update(PROJECT_ID, { economicCurrency: requested }, admin).catch((e: unknown) => e)) as ConflictException;
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'PROJECT_CURRENCY_IN_USE', projectCurrency: current });
    expect(updates).toEqual([]);
  });

  it('la misma moneda no es un cambio: no consulta el uso ni escribe, aunque haya datos', async () => {
    const { service, updates, calls } = build({ used: true, currency: 'ARS' });
    const result = await service.update(PROJECT_ID, { economicCurrency: 'ARS' }, admin);
    expect(result.economicCurrency).toBe('ARS');
    expect(calls).toEqual(['lock-project']);
    expect(updates).toEqual([]);
  });

  it.each([['líder ajeno', foreignLeader], ['COLLABORATOR', collaborator]])('%s: 403 y no toca la moneda', async (_n, actor) => {
    const { service, updates, calls } = build();
    await expect(service.update(PROJECT_ID, { economicCurrency: 'USD' }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('no convierte nada: el UPDATE toca solo la columna de moneda del proyecto', async () => {
    const { service, updates } = build();
    await service.update(PROJECT_ID, { economicCurrency: 'USD' }, admin);
    expect(updates[0]!.sql).toBe('UPDATE projects SET economic_currency = $2 WHERE id = $1');
  });
});

describe('ProjectsService - la moneda del proyecto es información económica (RN-25)', () => {
  it.each([['ADMIN', admin], ['PROGRAM_MANAGER', pm], ['líder real', realLeader]])('GET detalle: %s recibe economicCurrency', async (_n, actor) => {
    const { service } = build();
    const result = await service.findOne(PROJECT_ID, actor);
    expect(result.economicCurrency).toBe('ARS');
  });

  it.each([['líder ajeno', foreignLeader], ['COLLABORATOR', collaborator]])('GET detalle: %s NO recibe economicCurrency y ni siquiera se consulta', async (_n, actor) => {
    const { service, visibleQuery } = build();
    // la lectura general del proyecto (canViewProject) se resuelve aparte; lo que importa es que el campo no sale
    jest.spyOn(PermissionsService.prototype, 'canViewProject').mockResolvedValue(true);
    const result = await service.findOne(PROJECT_ID, actor);
    expect(result.economicCurrency).toBeUndefined();
    expect(visibleQuery).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('GET detalle: informa si la moneda ya está bloqueada (hay datos económicos) para poder deshabilitar el selector', async () => {
    const free = await build({ used: false }).service.findOne(PROJECT_ID, admin);
    const locked = await build({ used: true }).service.findOne(PROJECT_ID, admin);
    expect(free.economicCurrencyLocked).toBe(false);
    expect(locked.economicCurrencyLocked).toBe(true);
  });

  it('la columna es select:false (no sale por defecto en ninguna consulta)', () => {
    const column = getMetadataArgsStorage().columns.find((c) => c.target === ProjectEntity && c.propertyName === 'economicCurrency');
    expect(column?.options.select).toBe(false);
    expect(column?.options.name).toBe('economic_currency');
  });
});

describe('DTOs de proyecto - moneda', () => {
  const errorsOf = async (cls: new () => object, plain: object) => (await validate(plainToInstance(cls, plain) as object)).flatMap((e) => Object.keys(e.constraints ?? {}).map(() => e.property));
  it('create: acepta ARS/USD (normalizada), la omite y rechaza basura', async () => {
    expect(await errorsOf(CreateProjectDto, { name: 'x', economicCurrency: ' usd ' })).toEqual([]);
    expect(plainToInstance(CreateProjectDto, { name: 'x', economicCurrency: ' usd ' }).economicCurrency).toBe('USD');
    expect(await errorsOf(CreateProjectDto, { name: 'x' })).toEqual([]);
    expect(await errorsOf(CreateProjectDto, { name: 'x', economicCurrency: 'DOLAR' })).toContain('economicCurrency');
    expect(await errorsOf(CreateProjectDto, { name: 'x', economicCurrency: 5 })).toContain('economicCurrency');
  });
  it('update: igual', async () => {
    expect(await errorsOf(UpdateProjectDtoImpl, { economicCurrency: 'ars' })).toEqual([]);
    expect(await errorsOf(UpdateProjectDtoImpl, { economicCurrency: 'A1S' })).toContain('economicCurrency');
  });
});
