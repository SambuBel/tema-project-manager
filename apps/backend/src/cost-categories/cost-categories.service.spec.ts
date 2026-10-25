import { ForbiddenException } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { CostCategoriesService } from './cost-categories.service';
import { CostCategoriesController } from './cost-categories.controller';
import { PermissionsService } from '../auth/permissions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoleName } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';

const user = (roles: RoleName[]): RequestUser => ({ id: 'u1', roles }) as RequestUser;

function build() {
  const find = jest.fn(async () => [
    { id: 'c1', name: 'Licencias y software', active: true, createdAt: new Date() },
    { id: 'c2', name: 'Recursos humanos', active: true, createdAt: new Date() },
  ]);
  const service = new CostCategoriesService({ find } as never, new PermissionsService({ findOne: jest.fn() } as never));
  return { service, find };
}

describe('CostCategoriesService.listActive', () => {
  it.each([
    ['ADMIN', RoleName.ADMIN],
    ['PROGRAM_MANAGER', RoleName.PROGRAM_MANAGER],
    ['PROJECT_LEADER', RoleName.PROJECT_LEADER],
  ])('%s: ve el catálogo, solo id y nombre', async (_label, role) => {
    const { service } = build();
    await expect(service.listActive(user([role]))).resolves.toEqual([
      { id: 'c1', name: 'Licencias y software' },
      { id: 'c2', name: 'Recursos humanos' },
    ]);
  });

  it('consulta SOLO los activos, ordenados por nombre', async () => {
    const { service, find } = build();
    await service.listActive(user([RoleName.ADMIN]));
    expect(find).toHaveBeenCalledWith({ where: { active: true }, order: { name: 'ASC', id: 'ASC' } });
  });

  it.each([
    ['COLLABORATOR', RoleName.COLLABORATOR],
    ['OBSERVER', RoleName.OBSERVER],
  ])('%s: 403 y no consulta la base', async (_label, role) => {
    const { service, find } = build();
    await expect(service.listActive(user([role]))).rejects.toBeInstanceOf(ForbiddenException);
    expect(find).not.toHaveBeenCalled();
  });

  it('no devuelve datos de presupuestos ni costos', async () => {
    const { service } = build();
    const result = await service.listActive(user([RoleName.ADMIN]));
    for (const row of result) expect(Object.keys(row).sort()).toEqual(['id', 'name']);
  });
});

describe('CostCategoriesController', () => {
  it('GET /cost-categories con sesión obligatoria', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CostCategoriesController)).toBe('cost-categories');
    expect(Reflect.getMetadata(METHOD_METADATA, CostCategoriesController.prototype.list)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata('__guards__', CostCategoriesController)).toContain(JwtAuthGuard);
  });

  it('delega en el servicio con el usuario autenticado', async () => {
    const service = { listActive: jest.fn(async () => []) };
    const controller = new CostCategoriesController(service as never);
    const u = user([RoleName.ADMIN]);
    await controller.list(u);
    expect(service.listActive).toHaveBeenCalledWith(u);
  });
});
