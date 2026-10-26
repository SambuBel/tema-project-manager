import { MilestonesController } from './milestones.controller';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { RoleName } from '../database/enums';

describe('MilestonesController (KAN-243..KAN-250)', () => {
  let controller: MilestonesController;
  let service: any;

  const mockUser = {
    id: 'user-1',
    email: 'user@example.com',
    name: 'User One',
    roles: [RoleName.PROJECT_LEADER],
  } as RequestUser;

  const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
  const MILESTONE_ID = '22222222-2222-4222-8222-222222222222';
  const TASK_ID = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    service = {
      create: jest.fn(),
      findAllByProject: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      complete: jest.fn(),
      completeWithTasks: jest.fn(),
      reopen: jest.fn(),
      associateTask: jest.fn(),
      disassociateTask: jest.fn(),
    };
    controller = new MilestonesController(service);
  });

  it('POST projects/:projectId/milestones delega al servicio create (KAN-243)', async () => {
    const dto = { name: 'Entrega Fase 1', dueDate: '2026-11-30' };
    const expected = { id: MILESTONE_ID, ...dto, progress: 0 };
    service.create.mockResolvedValue(expected);

    const result = await controller.create(PROJECT_ID, dto, mockUser);

    expect(service.create).toHaveBeenCalledWith(PROJECT_ID, dto, mockUser);
    expect(result).toBe(expected);
  });

  it('GET projects/:projectId/milestones delega al servicio findAllByProject (KAN-243)', async () => {
    const query = { upcoming: true, limit: 5 };
    const expected = [{ id: MILESTONE_ID, name: 'Hito', progress: 50 }];
    service.findAllByProject.mockResolvedValue(expected);

    const result = await controller.findAllByProject(PROJECT_ID, query, mockUser);

    expect(service.findAllByProject).toHaveBeenCalledWith(PROJECT_ID, query, mockUser);
    expect(result).toBe(expected);
  });

  it('GET milestones/:id delega al servicio findOne (KAN-243)', async () => {
    const expected = { id: MILESTONE_ID, name: 'Hito Detalle', tasks: [] };
    service.findOne.mockResolvedValue(expected);

    const result = await controller.findOne(MILESTONE_ID, mockUser);

    expect(service.findOne).toHaveBeenCalledWith(MILESTONE_ID, mockUser);
    expect(result).toBe(expected);
  });

  it('PATCH milestones/:id delega al servicio update (KAN-244)', async () => {
    const dto = { name: 'Hito Renombrado' };
    const expected = { id: MILESTONE_ID, name: 'Hito Renombrado', progress: 0 };
    service.update.mockResolvedValue(expected);

    const result = await controller.update(MILESTONE_ID, dto, mockUser);

    expect(service.update).toHaveBeenCalledWith(MILESTONE_ID, dto, mockUser);
    expect(result).toBe(expected);
  });

  it('DELETE milestones/:id delega al servicio remove (KAN-244)', async () => {
    service.remove.mockResolvedValue(undefined);

    await controller.remove(MILESTONE_ID, mockUser);

    expect(service.remove).toHaveBeenCalledWith(MILESTONE_ID, mockUser);
  });

  it('PATCH milestones/:id/complete delega al servicio complete (KAN-244 / KAN-250)', async () => {
    const expected = { id: MILESTONE_ID, status: 'COMPLETED' };
    service.complete.mockResolvedValue(expected);

    const result = await controller.complete(MILESTONE_ID, mockUser);

    expect(service.complete).toHaveBeenCalledWith(MILESTONE_ID, mockUser);
    expect(result).toBe(expected);
  });

  it('PATCH milestones/:id/complete-with-tasks delega al servicio completeWithTasks (KAN-250)', async () => {
    const expected = { id: MILESTONE_ID, status: 'COMPLETED', progress: 100 };
    service.completeWithTasks.mockResolvedValue(expected);

    const result = await controller.completeWithTasks(MILESTONE_ID, mockUser);

    expect(service.completeWithTasks).toHaveBeenCalledWith(MILESTONE_ID, mockUser);
    expect(result).toBe(expected);
  });

  it('PATCH milestones/:id/reopen delega al servicio reopen (KAN-244 / KAN-250)', async () => {
    const expected = { id: MILESTONE_ID, status: 'PENDING' };
    service.reopen.mockResolvedValue(expected);

    const result = await controller.reopen(MILESTONE_ID, mockUser);

    expect(service.reopen).toHaveBeenCalledWith(MILESTONE_ID, mockUser);
    expect(result).toBe(expected);
  });

  it('PUT milestones/:id/tasks/:taskId delega al servicio associateTask (KAN-245)', async () => {
    const expected = { id: MILESTONE_ID, taskCount: 1, completedTaskCount: 0, progress: 0 };
    service.associateTask.mockResolvedValue(expected);

    const result = await controller.associateTask(MILESTONE_ID, TASK_ID, mockUser);

    expect(service.associateTask).toHaveBeenCalledWith(MILESTONE_ID, TASK_ID, mockUser);
    expect(result).toBe(expected);
  });

  it('DELETE milestones/:id/tasks/:taskId delega al servicio disassociateTask (KAN-245)', async () => {
    const expected = { id: MILESTONE_ID, taskCount: 0, completedTaskCount: 0, progress: 0 };
    service.disassociateTask.mockResolvedValue(expected);

    const result = await controller.disassociateTask(MILESTONE_ID, TASK_ID, mockUser);

    expect(service.disassociateTask).toHaveBeenCalledWith(MILESTONE_ID, TASK_ID, mockUser);
    expect(result).toBe(expected);
  });
});
