import { ExecutionContext, INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserEntity } from '../database/entities/user.entity';
import { UsersService } from '../users/users.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const currentUser = { id: '33333333-3333-4333-8333-333333333333' } as UserEntity;

/**
 * Prueba POST /tasks de punta a punta (HTTP + ValidationPipe + DTO + guard) sin base de datos:
 * el service va mockeado. El pipe es el mismo de main.ts.
 */
describe('TasksController - POST /tasks', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tasksService: { create: jest.Mock };

  async function startApp(opts: { authenticated: boolean }) {
    tasksService = { create: jest.fn() };

    const builder = Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        { provide: TasksService, useValue: tasksService },
        // Dependencias del JwtAuthGuard real (solo se usan cuando NO se pisa el guard).
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: UsersService, useValue: { findById: jest.fn() } },
      ],
    });

    if (opts.authenticated) {
      builder.overrideGuard(JwtAuthGuard).useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = currentUser;
          return true;
        },
      });
    }

    const moduleRef = await builder.compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }

  const post = (body: unknown) =>
    fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  afterEach(async () => {
    await app.close();
  });

  describe('con usuario autenticado', () => {
    beforeEach(() => startApp({ authenticated: true }));

    it('responde 201 y delega en el service con el DTO y el usuario autenticado', async () => {
      tasksService.create.mockResolvedValue({ id: 'task-1', title: 'Preparar informe' });

      const res = await post({ projectId: PROJECT_ID, title: 'Preparar informe', priority: 'CRITICAL' });

      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ id: 'task-1', title: 'Preparar informe' });
      expect(tasksService.create).toHaveBeenCalledTimes(1);
      const [dto, user] = tasksService.create.mock.calls[0] as [Record<string, unknown>, UserEntity];
      expect(dto).toMatchObject({ projectId: PROJECT_ID, title: 'Preparar informe', priority: 'CRITICAL' });
      expect(user).toBe(currentUser);
    });

    it('responde 400 con mensajes claros si el DTO es inválido y no llama al service', async () => {
      const res = await post({ projectId: 'no-uuid', title: '   ', status: 'HECHO' });
      const body = (await res.json()) as { message: string[] };

      expect(res.status).toBe(400);
      expect(body.message).toEqual(
        expect.arrayContaining([
          'projectId debe ser un id de proyecto válido',
          'El título es obligatorio',
          'El estado no es válido',
        ]),
      );
      expect(tasksService.create).not.toHaveBeenCalled();
    });

    it('responde 400 si el vencimiento es anterior al inicio', async () => {
      const res = await post({ projectId: PROJECT_ID, title: 'x', startDate: '2026-09-30', dueDate: '2026-09-21' });
      const body = (await res.json()) as { message: string[] };

      expect(res.status).toBe(400);
      expect(body.message).toContain('La fecha de vencimiento no puede ser anterior a la de inicio');
      expect(tasksService.create).not.toHaveBeenCalled();
    });

    it('ignora campos que no son del DTO (whitelist), ej. createdBy', async () => {
      tasksService.create.mockResolvedValue({ id: 'task-1' });

      await post({ projectId: PROJECT_ID, title: 'x', createdBy: 'otro-usuario' });

      const [dto] = tasksService.create.mock.calls[0] as [Record<string, unknown>];
      expect(dto).not.toHaveProperty('createdBy');
    });

    it('responde 404 si el proyecto no existe', async () => {
      tasksService.create.mockRejectedValue(new NotFoundException(`Project ${PROJECT_ID} no encontrado`));

      const res = await post({ projectId: PROJECT_ID, title: 'x' });

      expect(res.status).toBe(404);
    });
  });

  describe('sin sesión', () => {
    beforeEach(() => startApp({ authenticated: false }));

    it('responde 401 (JwtAuthGuard) y no llama al service', async () => {
      const res = await post({ projectId: PROJECT_ID, title: 'x' });

      expect(res.status).toBe(401);
      expect(tasksService.create).not.toHaveBeenCalled();
    });
  });
});
