import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { CostsController } from './costs.controller';
import { CostsService } from './costs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestUser } from '../auth/types/authenticated-request-user';

describe('CostsController', () => {
  const user = { id: 'u1', roles: [] } as unknown as RequestUser;
  const service = { create: jest.fn(async () => ({ id: 'c1' })), list: jest.fn(async () => ({ data: [] })), getOne: jest.fn(async () => ({ id: 'c1' })), update: jest.fn(async () => ({ id: 'c1' })) };
  const controller = new CostsController(service as unknown as CostsService);

  it('rutas: POST y GET /projects/:projectId/costs, con sesión obligatoria', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CostsController)).toBe('projects');
    expect(Reflect.getMetadata(PATH_METADATA, CostsController.prototype.create)).toBe(':projectId/costs');
    expect(Reflect.getMetadata(METHOD_METADATA, CostsController.prototype.create)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, CostsController.prototype.list)).toBe(':projectId/costs');
    expect(Reflect.getMetadata(METHOD_METADATA, CostsController.prototype.list)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata('__guards__', CostsController)).toContain(JwtAuthGuard);
  });

  it('rutas de detalle y edición: GET y PATCH /projects/:projectId/costs/:costId', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CostsController.prototype.getOne)).toBe(':projectId/costs/:costId');
    expect(Reflect.getMetadata(METHOD_METADATA, CostsController.prototype.getOne)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, CostsController.prototype.update)).toBe(':projectId/costs/:costId');
    expect(Reflect.getMetadata(METHOD_METADATA, CostsController.prototype.update)).toBe(RequestMethod.PATCH);
  });

  it('NO expone la baja (COST-DELETE está diferida hasta que TEMA defina quién puede darla)', () => {
    expect(Object.getOwnPropertyNames(CostsController.prototype).sort()).toEqual(['constructor', 'create', 'getOne', 'list', 'update']);
    expect(Reflect.getMetadata(METHOD_METADATA, CostsController.prototype.getOne)).not.toBe(RequestMethod.DELETE);
  });

  it('delega con el proyecto, el DTO/consulta y el usuario autenticado', async () => {
    const dto = { costDate: '2026-10-25', amount: '1.00', currency: 'ARS', costCategoryId: 'c', description: 'd' };
    await controller.create('p1', dto, user);
    await controller.list('p1', { page: 2 }, user);
    expect(service.create).toHaveBeenCalledWith('p1', dto, user);
    expect(service.list).toHaveBeenCalledWith('p1', { page: 2 }, user);
  });

  it('detalle y edición delegan con proyecto, costo, DTO y usuario', async () => {
    await controller.getOne('p1', 'c1', user);
    await controller.update('p1', 'c1', { expectedRevision: 1, description: 'x' }, user);
    expect(service.getOne).toHaveBeenCalledWith('p1', 'c1', user);
    expect(service.update).toHaveBeenCalledWith('p1', 'c1', { expectedRevision: 1, description: 'x' }, user);
  });
});
