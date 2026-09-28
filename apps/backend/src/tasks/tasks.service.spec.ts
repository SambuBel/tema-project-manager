import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TaskEntity } from './task.entity';
import { ProjectEntity } from '../projects/project.entity';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
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
  let mockProjectRepo: { findOneBy: jest.Mock };
  let mockProjectMemberRepo: { existsBy: jest.Mock };
  let mockUsersService: { findById: jest.Mock };

  beforeEach(async () => {
    mockRepo = {
      save: jest.fn().mockImplementation((t: TaskEntity) => Promise.resolve({ ...t, id: 'task-1' })),
    };
    // Por defecto el usuario autenticado es el lider del proyecto: no interfiere con los
    // tests que no estan probando especificamente la regla de membresia.
    mockProjectRepo = {
      findOneBy: jest.fn().mockResolvedValue({ id: PROJECT_ID, leaderId: currentUser.id } as ProjectEntity),
    };
    mockProjectMemberRepo = { existsBy: jest.fn().mockResolvedValue(false) };
    mockUsersService = { findById: jest.fn().mockResolvedValue({ id: ASSIGNEE_ID }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: getRepositoryToken(TaskEntity), useValue: mockRepo },
        { provide: getRepositoryToken(ProjectEntity), useValue: mockProjectRepo },
        { provide: getRepositoryToken(ProjectMemberEntity), useValue: mockProjectMemberRepo },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  it('crea la tarea con los valores por defecto (PENDING, MEDIUM, sin responsable ni fechas)', async () => {
    const dto: CreateTaskDto = { projectId: PROJECT_ID, title: 'Preparar informe' };

    const result = await service.create(dto, currentUser);

    expect(mockProjectRepo.findOneBy).toHaveBeenCalledWith({ id: PROJECT_ID });
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
    mockProjectMemberRepo.existsBy.mockResolvedValue(true); // ASSIGNEE_ID es miembro activo, no lider

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
    mockProjectRepo.findOneBy.mockResolvedValue(null);

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

  it('lanza BadRequestException (400) si el responsable no es miembro del proyecto, y no guarda nada', async () => {
    mockProjectMemberRepo.existsBy.mockResolvedValue(false); // ASSIGNEE_ID no es lider ni miembro

    await expect(
      service.create({ projectId: PROJECT_ID, title: 'x', assignedToId: ASSIGNEE_ID }, currentUser),
    ).rejects.toThrow(BadRequestException);
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  it('lanza ForbiddenException (403) si el usuario no es lider ni miembro del proyecto, y no guarda nada', async () => {
    mockProjectRepo.findOneBy.mockResolvedValue({ id: PROJECT_ID, leaderId: 'otro-usuario' } as ProjectEntity);
    mockProjectMemberRepo.existsBy.mockResolvedValue(false);

    await expect(service.create({ projectId: PROJECT_ID, title: 'x' }, currentUser)).rejects.toThrow(ForbiddenException);
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  it('permite crear si el usuario es miembro activo del proyecto (sin ser el lider)', async () => {
    mockProjectRepo.findOneBy.mockResolvedValue({ id: PROJECT_ID, leaderId: 'otro-usuario' } as ProjectEntity);
    mockProjectMemberRepo.existsBy.mockResolvedValue(true);

    const result = await service.create({ projectId: PROJECT_ID, title: 'x' }, currentUser);

    expect(mockProjectMemberRepo.existsBy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: currentUser.id,
      removedAt: expect.anything(),
    });
    expect(result).toMatchObject({ id: 'task-1' });
  });
});

describe('TasksService - update / remove (membresia del proyecto)', () => {
  let service: TasksService;
  let mockRepo: { findOne: jest.Mock; save: jest.Mock; delete: jest.Mock };
  let mockProjectRepo: { findOneBy: jest.Mock };
  let mockProjectMemberRepo: { existsBy: jest.Mock };
  let mockUsersService: { findById: jest.Mock };
  let existingTask: TaskEntity;

  beforeEach(async () => {
    existingTask = { id: 'task-1', projectId: PROJECT_ID, title: 'x', archivedAt: null } as TaskEntity;
    mockRepo = {
      findOne: jest.fn().mockResolvedValue(existingTask),
      save: jest.fn().mockImplementation((t: TaskEntity) => Promise.resolve(t)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    mockProjectRepo = {
      findOneBy: jest.fn().mockResolvedValue({ id: PROJECT_ID, leaderId: currentUser.id } as ProjectEntity),
    };
    mockProjectMemberRepo = { existsBy: jest.fn().mockResolvedValue(false) };
    mockUsersService = { findById: jest.fn().mockResolvedValue({ id: ASSIGNEE_ID }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: getRepositoryToken(TaskEntity), useValue: mockRepo },
        { provide: getRepositoryToken(ProjectEntity), useValue: mockProjectRepo },
        { provide: getRepositoryToken(ProjectMemberEntity), useValue: mockProjectMemberRepo },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  it('update: permite al lider del proyecto editar la tarea', async () => {
    await expect(service.update('task-1', { title: 'nuevo' }, currentUser)).resolves.toMatchObject({
      title: 'nuevo',
    });
  });

  it('update: lanza ForbiddenException (403) si no es lider ni miembro', async () => {
    mockProjectRepo.findOneBy.mockResolvedValue({ id: PROJECT_ID, leaderId: 'otro-usuario' } as ProjectEntity);

    await expect(service.update('task-1', { title: 'nuevo' }, currentUser)).rejects.toThrow(ForbiddenException);
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  it('update: permite editar si es miembro activo (sin ser lider)', async () => {
    mockProjectRepo.findOneBy.mockResolvedValue({ id: PROJECT_ID, leaderId: 'otro-usuario' } as ProjectEntity);
    mockProjectMemberRepo.existsBy.mockResolvedValue(true);

    await expect(service.update('task-1', { title: 'nuevo' }, currentUser)).resolves.toMatchObject({
      title: 'nuevo',
    });
  });

  it('update: permite reasignar a un responsable que es miembro activo del proyecto', async () => {
    mockProjectMemberRepo.existsBy.mockResolvedValue(true); // ASSIGNEE_ID es miembro, currentUser sigue siendo lider

    await expect(
      service.update('task-1', { assignedToId: ASSIGNEE_ID }, currentUser),
    ).resolves.toMatchObject({ assignedToId: ASSIGNEE_ID });
  });

  it('update: lanza BadRequestException (400) si el nuevo responsable no es miembro del proyecto', async () => {
    await expect(service.update('task-1', { assignedToId: ASSIGNEE_ID }, currentUser)).rejects.toThrow(
      BadRequestException,
    );
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  it('remove: permite al lider del proyecto borrar la tarea', async () => {
    await service.remove('task-1', currentUser);

    expect(mockRepo.delete).toHaveBeenCalledWith({ id: 'task-1' });
  });

  it('remove: lanza ForbiddenException (403) si no es lider ni miembro, y no borra nada', async () => {
    mockProjectRepo.findOneBy.mockResolvedValue({ id: PROJECT_ID, leaderId: 'otro-usuario' } as ProjectEntity);

    await expect(service.remove('task-1', currentUser)).rejects.toThrow(ForbiddenException);
    expect(mockRepo.delete).not.toHaveBeenCalled();
  });

  it('archive: marca archivedAt si es lider y la tarea no estaba archivada', async () => {
    const result = await service.archive('task-1', currentUser);

    expect(result.archivedAt).toBeInstanceOf(Date);
    expect(mockRepo.save).toHaveBeenCalledTimes(1);
  });

  it('archive: es idempotente, no vuelve a guardar si ya estaba archivada', async () => {
    const alreadyArchivedAt = new Date('2026-01-01T00:00:00Z');
    mockRepo.findOne.mockResolvedValue({ ...existingTask, archivedAt: alreadyArchivedAt });

    const result = await service.archive('task-1', currentUser);

    expect(result.archivedAt).toBe(alreadyArchivedAt);
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  it('archive: lanza ForbiddenException (403) si no es lider ni miembro, y no guarda nada', async () => {
    mockProjectRepo.findOneBy.mockResolvedValue({ id: PROJECT_ID, leaderId: 'otro-usuario' } as ProjectEntity);

    await expect(service.archive('task-1', currentUser)).rejects.toThrow(ForbiddenException);
    expect(mockRepo.save).not.toHaveBeenCalled();
  });
});
