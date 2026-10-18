import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestUser } from '../auth/types/authenticated-request-user';

describe('BudgetsController', () => {
  const user = { id: 'u1', roles: [] } as unknown as RequestUser;
  const service = { create: jest.fn(async () => ({ id: 'b1' })), createVersion: jest.fn(async () => ({ id: 'b2' })), getCurrent: jest.fn(async () => ({ id: 'b1' })) };
  const controller = new BudgetsController(service as unknown as BudgetsService);

  it('rutas: POST y GET /projects/:projectId/budget, con sesión obligatoria', () => {
    expect(Reflect.getMetadata(PATH_METADATA, BudgetsController)).toBe('projects');
    expect(Reflect.getMetadata(PATH_METADATA, BudgetsController.prototype.create)).toBe(':projectId/budget');
    expect(Reflect.getMetadata(METHOD_METADATA, BudgetsController.prototype.create)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, BudgetsController.prototype.getCurrent)).toBe(':projectId/budget');
    expect(Reflect.getMetadata(METHOD_METADATA, BudgetsController.prototype.getCurrent)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, BudgetsController.prototype.createVersion)).toBe(':projectId/budget/versions');
    expect(Reflect.getMetadata(METHOD_METADATA, BudgetsController.prototype.createVersion)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata('__guards__', BudgetsController)).toContain(JwtAuthGuard);
  });

  it('delega en el servicio con el proyecto, el DTO y el usuario autenticado', async () => {
    const dto = { totalAmount: '10.00', currency: 'ARS', approvalDate: '2026-10-12' };
    await controller.create('p1', dto, user);
    await controller.getCurrent('p1', user);
    expect(service.create).toHaveBeenCalledWith('p1', dto, user);
    expect(service.getCurrent).toHaveBeenCalledWith('p1', user);
  });

  it('createVersion delega con el proyecto, el DTO y el usuario', async () => {
    const dto = { expectedVersion: 1, totalAmount: '10.00', currency: 'ARS', approvalDate: '2026-10-12' };
    await controller.createVersion('p1', dto, user);
    expect(service.createVersion).toHaveBeenCalledWith('p1', dto, user);
  });
});
