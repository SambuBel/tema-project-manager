import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ResourceProfilesController } from './resource-profiles.controller';
import { ResourceProfilesService } from './resource-profiles.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestUser } from '../auth/types/authenticated-request-user';

describe('ResourceProfilesController', () => {
  const user = { id: 'u1', roles: [] } as unknown as RequestUser;
  const service = { list: jest.fn(async () => []), create: jest.fn(async () => ({ id: 'p1' })), update: jest.fn(async () => ({ id: 'p1' })) };
  const controller = new ResourceProfilesController(service as unknown as ResourceProfilesService);

  it('rutas: GET y POST /resource-profiles, PATCH /resource-profiles/:profileId, con sesión obligatoria', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ResourceProfilesController)).toBe('resource-profiles');
    expect(Reflect.getMetadata(METHOD_METADATA, ResourceProfilesController.prototype.list)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(METHOD_METADATA, ResourceProfilesController.prototype.create)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(METHOD_METADATA, ResourceProfilesController.prototype.update)).toBe(RequestMethod.PATCH);
    expect(Reflect.getMetadata(PATH_METADATA, ResourceProfilesController.prototype.update)).toBe(':profileId');
    expect(Reflect.getMetadata('__guards__', ResourceProfilesController)).toContain(JwtAuthGuard);
  });

  it('NO expone DELETE ni detalle individual', () => {
    expect(Object.getOwnPropertyNames(ResourceProfilesController.prototype).sort()).toEqual(['constructor', 'create', 'list', 'update']);
  });

  it('delega con DTO/consulta y usuario autenticado', async () => {
    const dto = { name: 'Consultor', hourlyCost: '1.00', currency: 'USD' };
    await controller.list({ includeInactive: true }, user);
    await controller.create(dto, user);
    await controller.update('p1', { expectedRevision: 1, name: 'x' }, user);
    expect(service.list).toHaveBeenCalledWith({ includeInactive: true }, user);
    expect(service.create).toHaveBeenCalledWith(dto, user);
    expect(service.update).toHaveBeenCalledWith('p1', { expectedRevision: 1, name: 'x' }, user);
  });
});
