import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ResourceAllocationsController } from './resource-allocations.controller';
import { ResourceAllocationsService } from './resource-allocations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestUser } from '../auth/types/authenticated-request-user';

describe('ResourceAllocationsController', () => {
  const user = { id: 'u1', roles: [] } as unknown as RequestUser;
  const service = { getCurrent: jest.fn(async () => ({})), getHistory: jest.fn(async () => []), update: jest.fn(async () => ({})) };
  const controller = new ResourceAllocationsController(service as unknown as ResourceAllocationsService);
  const proto = ResourceAllocationsController.prototype;

  it('rutas bajo /projects/:id, con sesión obligatoria', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ResourceAllocationsController)).toBe('projects');
    expect(Reflect.getMetadata(PATH_METADATA, proto.getCurrent)).toBe(':id/resource-allocation');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.getCurrent)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, proto.getHistory)).toBe(':id/members/:memberId/resource-allocation/history');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.getHistory)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, proto.update)).toBe(':id/members/:memberId/resource-allocation');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.update)).toBe(RequestMethod.PATCH);
    expect(Reflect.getMetadata('__guards__', ResourceAllocationsController)).toContain(JwtAuthGuard);
  });

  it('solo expone esas tres operaciones (sin DELETE ni "actualizar a la tarifa vigente")', () => {
    expect(Object.getOwnPropertyNames(proto).sort()).toEqual(['constructor', 'getCurrent', 'getHistory', 'update']);
  });

  it('delega con proyecto (UUID o slug), miembro, DTO y usuario', async () => {
    await controller.getCurrent('mi-proyecto', user);
    await controller.getHistory('mi-proyecto', 'm1', user);
    await controller.update('mi-proyecto', 'm1', { expectedRevision: 0, estimatedHours: '1.00' }, user);
    expect(service.getCurrent).toHaveBeenCalledWith('mi-proyecto', user);
    expect(service.getHistory).toHaveBeenCalledWith('mi-proyecto', 'm1', user);
    expect(service.update).toHaveBeenCalledWith('mi-proyecto', 'm1', { expectedRevision: 0, estimatedHours: '1.00' }, user);
  });
});
