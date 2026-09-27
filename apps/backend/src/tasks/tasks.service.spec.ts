import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TaskEntity } from './task.entity';
import { ProjectEntity } from '../projects/project.entity';
import { UserEntity } from '../database/entities/user.entity';
import { TaskPriority, TaskStatus } from '../database/enums';
import { UsersService } from '../users/users.service';
import { CreateTaskDto } from './dto/create-task.dto';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ASSIGNEE_ID = '22222222-2222-4222-8222-222222222222';
const currentUser = { id: '33333333-3333-4333-8333-333333333333' } as UserEntity;

describe('TasksService - create', () => {
  let service: TasksService;
  let mockRepo: { save: jest.Mock };
  let mockProjectRepo: { existsBy: jest.Mock };
  let mockUsersService: { findById: jest.Mock };

  beforeEach(async () => {
    mockRepo = {
      save: jest.fn().mockImplementation((t: TaskEntity) => Promise.resolve({ ...t, id: 'task-1' })),
    };
    mockProjectRepo = { existsBy: jest.fn().mockResolvedValue(true) };
    mockUsersService = { findById: jest.fn().mockResolvedValue({ id: ASSIGNEE_ID }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: getRepositoryToken(TaskEntity), useValue: mockRepo },
        { provide: getRepositoryToken(ProjectEntity), useValue: mockProjectRepo },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  it('crea la tarea con los valores por defecto (PENDING, MEDIUM, sin responsable ni fechas)', async () => {
    const dto: CreateTaskDto = { projectId: PROJECT_ID, title: 'Preparar informe' };

    const result = await service.create(dto, currentUser);

    expect(mockProjectRepo.existsBy).toHaveBeenCalledWith({ id: PROJECT_ID });
    expect(mockRepo.save).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      id: 'task-1',
      projectId: PROJECT_ID,
      title: 'Preparar informe',
      description: null,
      status: TaskStatus.PENDING,
      priority: TaskPriority.MEDIUM,
      assignedToId: null,
      startDate: null,
      dueDate: null,
    });
  });

  it('guarda como createdBy al usuario autenticado', async () => {
    await service.create({ projectId: PROJECT_ID, title: 'x' }, currentUser);

    const saved = mockRepo.save.mock.calls[0]?.[0] as TaskEntity;
    expect(saved.createdBy).toBe(currentUser.id);
  });

  it('respeta los valores enviados (estado, prioridad, responsable, fechas)', async () => {
    const dto: CreateTaskDto = {
      projectId: PROJECT_ID,
      title: 'Revisar entrega',
      description: 'Detalle',
      status: TaskStatus.IN_REVIEW,
      priority: TaskPriority.CRITICAL,
      assignedToId: ASSIGNEE_ID,
      startDate: '2026-09-21',
      dueDate: '2026-09-30',
    };

    const result = await service.create(dto, currentUser);

    expect(mockUsersService.findById).toHaveBeenCalledWith(ASSIGNEE_ID);
    expect(result).toMatchObject({
      description: 'Detalle',
      status: TaskStatus.IN_REVIEW,
      priority: TaskPriority.CRITICAL,
      assignedToId: ASSIGNEE_ID,
      startDate: '2026-09-21',
      dueDate: '2026-09-30',
    });
  });

  it('lanza NotFoundException (404) si el proyecto no existe y no guarda nada', async () => {
    mockProjectRepo.existsBy.mockResolvedValue(false);

    await expect(service.create({ projectId: PROJECT_ID, title: 'x' }, currentUser)).rejects.toThrow(NotFoundException);
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  it('lanza NotFoundException (404) si el responsable no existe y no guarda nada', async () => {
    mockUsersService.findById.mockResolvedValue(null);

    await expect(
      service.create({ projectId: PROJECT_ID, title: 'x', assignedToId: ASSIGNEE_ID }, currentUser),
    ).rejects.toThrow(NotFoundException);
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  it('no consulta usuarios si no se indica responsable', async () => {
    await service.create({ projectId: PROJECT_ID, title: 'x' }, currentUser);

    expect(mockUsersService.findById).not.toHaveBeenCalled();
  });
});
