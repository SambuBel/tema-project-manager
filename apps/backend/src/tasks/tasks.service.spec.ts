import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TaskEntity } from './task.entity';
import { TaskStatus, TaskPriority } from '../database/enums';

describe('TasksService', () => {
  let service: TasksService;
  let mockRepo: {
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
    };

  beforeEach(async () => {
    mockRepo = {
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        {
          provide: getRepositoryToken(TaskEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('updateStatus', () => {
    const makeTask = (status: TaskStatus): TaskEntity => {
      const task = new TaskEntity();
      task.id = 'task-1';
      task.projectId = 'proj-1';
      task.title = 'Tarea de prueba';
      task.description = null;
      task.status = status;
      task.priority = TaskPriority.MEDIUM;
      task.assignedToId = null;
      task.startDate = null;
      task.dueDate = null;
      task.createdAt = new Date();
      task.updatedAt = new Date();
      return task;
    };

    it('debería cambiar el estado con una transición válida', async () => {
      const task = makeTask(TaskStatus.PENDING);
      mockRepo.findOne.mockResolvedValue(task);
      mockRepo.save.mockImplementation((t) => Promise.resolve(t));

      const result = await service.updateStatus('task-1', {
        status: TaskStatus.IN_PROGRESS,
      });

      expect(result.status).toBe(TaskStatus.IN_PROGRESS);
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('debería devolver la tarea sin cambios si el estado es el mismo (no-op)', async () => {
      const task = makeTask(TaskStatus.IN_PROGRESS);
      mockRepo.findOne.mockResolvedValue(task);

      const result = await service.updateStatus('task-1', {
        status: TaskStatus.IN_PROGRESS,
      });

      expect(result.status).toBe(TaskStatus.IN_PROGRESS);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('debería lanzar BadRequestException para una transición inválida', async () => {
      const task = makeTask(TaskStatus.PENDING);
      mockRepo.findOne.mockResolvedValue(task);

      await expect(
        service.updateStatus('task-1', { status: TaskStatus.COMPLETED }),
      ).rejects.toThrow(BadRequestException);
    });

    it('debería lanzar BadRequestException desde un estado final', async () => {
      const task = makeTask(TaskStatus.COMPLETED);
      mockRepo.findOne.mockResolvedValue(task);

      await expect(
        service.updateStatus('task-1', { status: TaskStatus.IN_PROGRESS }),
      ).rejects.toThrow(BadRequestException);
    });

    it('debería lanzar NotFoundException si la tarea no existe', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateStatus('no-existe', { status: TaskStatus.IN_PROGRESS }),
      ).rejects.toThrow(NotFoundException);
    });

    it('debería permitir la transición IN_PROGRESS → IN_REVIEW', async () => {
      const task = makeTask(TaskStatus.IN_PROGRESS);
      mockRepo.findOne.mockResolvedValue(task);
      mockRepo.save.mockImplementation((t) => Promise.resolve(t));

      const result = await service.updateStatus('task-1', {
        status: TaskStatus.IN_REVIEW,
      });

      expect(result.status).toBe(TaskStatus.IN_REVIEW);
    });

    it('debería permitir la transición BLOCKED → PENDING', async () => {
      const task = makeTask(TaskStatus.BLOCKED);
      mockRepo.findOne.mockResolvedValue(task);
      mockRepo.save.mockImplementation((t) => Promise.resolve(t));

      const result = await service.updateStatus('task-1', {
        status: TaskStatus.PENDING,
      });

      expect(result.status).toBe(TaskStatus.PENDING);
    });
  });

  describe('update (con validación de transición)', () => {
    it('debería validar la transición al cambiar status desde update genérico', async () => {
      const task = new TaskEntity();
      task.id = 'task-1';
      task.status = TaskStatus.PENDING;
      mockRepo.findOne.mockResolvedValue(task);

      await expect(
        service.update('task-1', { status: TaskStatus.COMPLETED }),
      ).rejects.toThrow(BadRequestException);
    });

    it('debería permitir update sin cambio de status', async () => {
      const task = new TaskEntity();
      task.id = 'task-1';
      task.status = TaskStatus.PENDING;
      task.title = 'Título viejo';
      mockRepo.findOne.mockResolvedValue(task);
      mockRepo.save.mockImplementation((t) => Promise.resolve(t));

      const result = await service.update('task-1', { title: 'Título nuevo' });

      expect(result.title).toBe('Título nuevo');
      expect(mockRepo.save).toHaveBeenCalled();
    });
  });
});