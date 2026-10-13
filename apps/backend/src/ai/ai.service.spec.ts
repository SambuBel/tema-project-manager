import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AiService, MAX_TOOL_ROUNDS } from './ai.service';
import { AiToolsService } from './ai-tools.service';
import { GeminiClient, GeminiTurn } from './gemini.client';
import { TasksService } from '../tasks/tasks.service';
import { ProjectsService } from '../projects/projects.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { TaskEntity } from '../tasks/task.entity';
import { ProjectEntity } from '../projects/project.entity';
import { TaskStatus } from '../database/enums';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const project = { id: PROJECT_ID, slug: 'proyecto-demo', name: 'Proyecto Demo' } as ProjectEntity;
const currentUser = { id: '33333333-3333-4333-8333-333333333333', name: 'Gabi', roles: [] } as unknown as RequestUser;

const daysFromToday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
};

describe('AiService', () => {
  let service: AiService;
  let mockTasksService: { findAllByProject: jest.Mock };
  let mockProjectsService: { findOne: jest.Mock; findAll: jest.Mock; getMembers: jest.Mock };
  let mockGemini: { isConfigured: jest.Mock; generate: jest.Mock };

  beforeEach(async () => {
    mockTasksService = { findAllByProject: jest.fn().mockResolvedValue([]) };
    mockProjectsService = {
      findOne: jest.fn().mockResolvedValue(project),
      findAll: jest.fn().mockResolvedValue([]),
      getMembers: jest.fn().mockResolvedValue([]),
    };
    mockGemini = { isConfigured: jest.fn().mockReturnValue(false), generate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        AiToolsService,
        { provide: TasksService, useValue: mockTasksService },
        { provide: ProjectsService, useValue: mockProjectsService },
        { provide: GeminiClient, useValue: mockGemini },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  describe('sin Gemini (modo reglas)', () => {
    it('informa el modo "rules"', () => {
      expect(service.mode).toBe('rules');
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

    it('acepta el slug del proyecto (las URLs usan slug) y lo resuelve con ProjectsService', async () => {
      await service.answer({ message: 'vencidas?', projectId: 'proyecto-demo' }, currentUser);

      expect(mockProjectsService.findOne).toHaveBeenCalledWith('proyecto-demo', currentUser);
      expect(mockTasksService.findAllByProject).toHaveBeenCalledWith({ projectId: PROJECT_ID }, currentUser);
    });

    it('si no tiene acceso al proyecto abierto, sigue como si no hubiera proyecto', async () => {
      mockProjectsService.findOne.mockRejectedValue(new ForbiddenException());

      const reply = await service.answer({ message: 'vencidas?', projectId: PROJECT_ID }, currentUser);

      expect(reply).toMatch(/proyecto/i);
      expect(mockTasksService.findAllByProject).not.toHaveBeenCalled();
    });

    it('usa TasksService.findAllByProject (no repite la logica de negocio) y filtra las vencidas', async () => {
      mockTasksService.findAllByProject.mockResolvedValue([
        { title: 'Tarea vieja', dueDate: daysFromToday(-1), status: TaskStatus.PENDING } as TaskEntity,
        { title: 'Tarea al dia', dueDate: daysFromToday(1), status: TaskStatus.PENDING } as TaskEntity,
        { title: 'Tarea vieja pero completa', dueDate: daysFromToday(-1), status: TaskStatus.COMPLETED } as TaskEntity,
      ]);

      const reply = await service.answer({ message: 'qué tareas tengo vencidas?', projectId: PROJECT_ID }, currentUser);

      expect(mockTasksService.findAllByProject).toHaveBeenCalledWith({ projectId: PROJECT_ID }, currentUser);
      expect(reply).toContain('Tarea vieja');
      expect(reply).not.toContain('Tarea al dia');
      expect(reply).not.toContain('Tarea vieja pero completa');
    });

    it('avisa si no hay vencidas, en vez de inventar', async () => {
      const reply = await service.answer({ message: 'vencidas?', projectId: PROJECT_ID }, currentUser);

      expect(reply).toMatch(/no hay tareas vencidas/i);
    });

    it('lista las bloqueadas filtrando por estado en el service', async () => {
      mockTasksService.findAllByProject.mockResolvedValue([
        { title: 'Esperando proveedor', status: TaskStatus.BLOCKED, dueDate: null, assignedTo: null } as TaskEntity,
      ]);

      const reply = await service.answer({ message: 'hay tareas bloqueadas?', projectId: PROJECT_ID }, currentUser);

      expect(mockTasksService.findAllByProject).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT_ID, status: TaskStatus.BLOCKED }),
        currentUser,
      );
      expect(reply).toContain('Esperando proveedor');
    });

    it('"mis tareas" filtra por el usuario actual', async () => {
      await service.answer({ message: 'cuáles son mis tareas?', projectId: PROJECT_ID }, currentUser);

      expect(mockTasksService.findAllByProject).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT_ID, assignedToId: currentUser.id }),
        currentUser,
      );
    });

    it('lista los proyectos del usuario', async () => {
      mockProjectsService.findAll.mockResolvedValue([{ name: 'Alfa' }, { name: 'Beta' }]);

      const reply = await service.answer({ message: 'qué proyectos tengo?' }, currentUser);

      expect(reply).toContain('Alfa');
      expect(reply).toContain('Beta');
    });

    it('lista el equipo del proyecto abierto', async () => {
      mockProjectsService.getMembers.mockResolvedValue([{ userId: 'u1', user: { name: 'Cris' }, projectRole: 'MEMBER' }]);

      const reply = await service.answer({ message: 'quiénes son los miembros del equipo?', projectId: PROJECT_ID }, currentUser);

      expect(reply).toContain('Cris');
    });

    it('nunca llama a Gemini', async () => {
      await service.answer({ message: 'vencidas?', projectId: PROJECT_ID }, currentUser);

      expect(mockGemini.generate).not.toHaveBeenCalled();
    });
  });

  describe('con Gemini', () => {
    const textTurn = (text: string): GeminiTurn => ({ functionCalls: [], text, content: { role: 'model', parts: [{ text }] } });

    beforeEach(() => {
      mockGemini.isConfigured.mockReturnValue(true);
    });

    it('informa el modo "gemini"', () => {
      expect(service.mode).toBe('gemini');
    });

    it('devuelve el texto del modelo y le pasa el historial con los roles de Gemini', async () => {
      mockGemini.generate.mockResolvedValue(textTurn('Hola!'));

      const reply = await service.answer(
        { message: 'y ahora?', history: [{ role: 'user', text: 'hola' }, { role: 'assistant', text: 'buenas' }] },
        currentUser,
      );

      expect(reply).toBe('Hola!');
      const [contents, systemPrompt, declarations] = mockGemini.generate.mock.calls[0];
      expect(contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
      expect(systemPrompt).toContain('TEMA');
      expect(declarations.length).toBeGreaterThan(0);
    });

    it('ejecuta las tools que pide el modelo y le devuelve el resultado', async () => {
      mockTasksService.findAllByProject.mockResolvedValue([
        { id: 't1', title: 'Tarea vieja', dueDate: daysFromToday(-3), status: TaskStatus.PENDING } as TaskEntity,
      ]);
      mockGemini.generate
        .mockResolvedValueOnce({
          functionCalls: [{ id: 'c1', name: 'list_overdue_tasks', args: {} }],
          text: '',
          content: { role: 'model', parts: [{ functionCall: { id: 'c1', name: 'list_overdue_tasks', args: {} } }] },
        })
        .mockResolvedValueOnce(textTurn('Tenés 1 tarea vencida: Tarea vieja'));

      const reply = await service.answer({ message: 'vencidas?', projectId: PROJECT_ID }, currentUser);

      expect(reply).toBe('Tenés 1 tarea vencida: Tarea vieja');
      expect(mockTasksService.findAllByProject).toHaveBeenCalledWith({ projectId: PROJECT_ID }, currentUser);
      const secondCallContents = mockGemini.generate.mock.calls[1][0];
      const toolResponse = secondCallContents[secondCallContents.length - 1].parts[0].functionResponse;
      expect(toolResponse.name).toBe('list_overdue_tasks');
      expect(toolResponse.response.tasks[0].title).toBe('Tarea vieja');
    });

    it('corta despues de MAX_TOOL_ROUNDS si el modelo no para de pedir tools', async () => {
      mockGemini.generate.mockResolvedValue({
        functionCalls: [{ name: 'list_projects', args: {} }],
        text: '',
        content: undefined,
      });

      const reply = await service.answer({ message: 'loop' }, currentUser);

      expect(mockGemini.generate).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
      expect(reply).toMatch(/más puntual/i);
    });

    it('si Gemini falla (key invalida, cuota, red) responde igual con el modo reglas', async () => {
      mockGemini.generate.mockRejectedValue(new Error('API key not valid'));

      const reply = await service.answer({ message: 'vencidas?', projectId: PROJECT_ID }, currentUser);

      expect(reply).toMatch(/no hay tareas vencidas/i);
    });
  });
});
