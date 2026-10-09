import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { TasksService } from '../tasks/tasks.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { TaskEntity } from '../tasks/task.entity';
import { TaskStatus } from '../database/enums';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const currentUser = { id: '33333333-3333-4333-8333-333333333333' } as RequestUser;

describe('AiService', () => {
  let service: AiService;
  let mockTasksService: { findAllByProject: jest.Mock };

  beforeEach(async () => {
    mockTasksService = { findAllByProject: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AiService, { provide: TasksService, useValue: mockTasksService }],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  it('responde que no sabe si el mensaje no coincide con ningun intent reconocido', async () => {
    const reply = await service.answer({ message: 'hola, como estas?' }, currentUser);

    expect(reply).toMatch(/todavía no sé/i);
    expect(mockTasksService.findAllByProject).not.toHaveBeenCalled();
  });

  it('pide el proyecto si preguntan por vencidas sin projectId', async () => {
    const reply = await service.answer({ message: 'qué tareas tengo vencidas?' }, currentUser);

    expect(reply).toMatch(/proyecto/i);
    expect(mockTasksService.findAllByProject).not.toHaveBeenCalled();
  });

  it('usa TasksService.findAllByProject (no repite la logica de negocio) y filtra las vencidas', async () => {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);

    mockTasksService.findAllByProject.mockResolvedValue([
      { title: 'Tarea vieja', dueDate: ayer.toISOString().split('T')[0], status: TaskStatus.PENDING } as TaskEntity,
      { title: 'Tarea al dia', dueDate: manana.toISOString().split('T')[0], status: TaskStatus.PENDING } as TaskEntity,
      { title: 'Tarea vieja pero completa', dueDate: ayer.toISOString().split('T')[0], status: TaskStatus.COMPLETED } as TaskEntity,
    ]);

    const reply = await service.answer({ message: 'qué tareas tengo vencidas?', projectId: PROJECT_ID }, currentUser);

    expect(mockTasksService.findAllByProject).toHaveBeenCalledWith({ projectId: PROJECT_ID }, currentUser);
    expect(reply).toContain('Tarea vieja');
    expect(reply).not.toContain('Tarea al dia');
    expect(reply).not.toContain('Tarea vieja pero completa');
  });

  it('avisa si no hay vencidas, en vez de inventar', async () => {
    mockTasksService.findAllByProject.mockResolvedValue([]);

    const reply = await service.answer({ message: 'vencidas?', projectId: PROJECT_ID }, currentUser);

    expect(reply).toMatch(/no hay tareas vencidas/i);
  });
});
