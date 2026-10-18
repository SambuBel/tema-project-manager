import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AiToolsService, TOOL_NAMES, ToolContext } from './ai-tools.service';
import { TasksService } from '../tasks/tasks.service';
import { ProjectsService } from '../projects/projects.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { ProjectEntity } from '../projects/project.entity';
import { TaskStatus } from '../database/enums';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const project = { id: PROJECT_ID, slug: 'demo', name: 'Demo' } as ProjectEntity;
const user = { id: '33333333-3333-4333-8333-333333333333', roles: [] } as unknown as RequestUser;

describe('AiToolsService', () => {
  let tools: AiToolsService;
  let mockTasksService: { findAllByProject: jest.Mock; findOne: jest.Mock; updateStatus: jest.Mock; create: jest.Mock };
  let mockProjectsService: { findOne: jest.Mock; findAll: jest.Mock; getMembers: jest.Mock };
  const ctx: ToolContext = { user, project };

  beforeEach(async () => {
    mockTasksService = {
      findAllByProject: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      updateStatus: jest.fn(),
      create: jest.fn(),
    };
    mockProjectsService = { findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]), getMembers: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiToolsService,
        { provide: TasksService, useValue: mockTasksService },
        { provide: ProjectsService, useValue: mockProjectsService },
      ],
    }).compile();

    tools = module.get(AiToolsService);
  });

  it('declara una funcion por cada tool que sabe ejecutar', () => {
    expect(tools.declarations.map((d) => d.name).sort()).toEqual(Object.values(TOOL_NAMES).sort());
  });

  it('sin projectId usa el proyecto abierto en pantalla', async () => {
    await tools.execute(TOOL_NAMES.listTasks, {}, ctx);

    expect(mockProjectsService.findOne).not.toHaveBeenCalled();
    expect(mockTasksService.findAllByProject).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJECT_ID }), user);
  });

  it('con otro projectId lo resuelve via ProjectsService (que valida el permiso)', async () => {
    mockProjectsService.findOne.mockResolvedValue({ id: OTHER_PROJECT_ID, name: 'Otro' });

    await tools.execute(TOOL_NAMES.listTasks, { projectId: 'otro' }, ctx);

    expect(mockProjectsService.findOne).toHaveBeenCalledWith('otro', user);
    expect(mockTasksService.findAllByProject).toHaveBeenCalledWith(expect.objectContaining({ projectId: OTHER_PROJECT_ID }), user);
  });

  it('sin proyecto en ningun lado devuelve un error para el modelo, no tira', async () => {
    const result = await tools.execute(TOOL_NAMES.listTasks, {}, { user, project: null });

    expect(result.error).toMatch(/proyecto/i);
  });

  it('los errores HTTP de los services (ej. permisos) vuelven como { error }', async () => {
    mockTasksService.updateStatus.mockRejectedValue(new ForbiddenException('No podés cambiar el estado de esta tarea.'));

    const result = await tools.execute(TOOL_NAMES.updateTaskStatus, { taskId: TASK_ID, status: TaskStatus.COMPLETED }, ctx);

    expect(result).toEqual({ error: 'No podés cambiar el estado de esta tarea.' });
  });

  it('una lista vacia de tareas o proyectos se marca como empty para que el modelo no invente', async () => {
    const tasks = await tools.execute(TOOL_NAMES.listTasks, {}, ctx);
    const overdue = await tools.execute(TOOL_NAMES.listOverdueTasks, {}, ctx);
    const projects = await tools.execute(TOOL_NAMES.listProjects, {}, ctx);

    for (const result of [tasks, overdue, projects]) {
      expect(result).toMatchObject({ empty: true, note: expect.any(String) });
    }
  });

  it('una lista con datos no lleva la marca empty', async () => {
    mockTasksService.findAllByProject.mockResolvedValue([{ id: TASK_ID, title: 'X', status: TaskStatus.PENDING, dueDate: null }]);

    const result = await tools.execute(TOOL_NAMES.listTasks, {}, ctx);

    expect(result.empty).toBeUndefined();
    expect(result.tasks).toHaveLength(1);
  });

  it('rechaza enums invalidos sin llamar al service', async () => {
    const result = await tools.execute(TOOL_NAMES.updateTaskStatus, { taskId: TASK_ID, status: 'DONE' }, ctx);

    expect(result.error).toMatch(/inválido/i);
    expect(mockTasksService.updateStatus).not.toHaveBeenCalled();
  });

  it('cambia el estado via TasksService.updateStatus', async () => {
    mockTasksService.updateStatus.mockResolvedValue({ id: TASK_ID, title: 'X', status: TaskStatus.COMPLETED, dueDate: null });

    const result = await tools.execute(TOOL_NAMES.updateTaskStatus, { taskId: TASK_ID, status: TaskStatus.COMPLETED }, ctx);

    expect(mockTasksService.updateStatus).toHaveBeenCalledWith(TASK_ID, { status: TaskStatus.COMPLETED }, user);
    expect(result.updated).toMatchObject({ id: TASK_ID, status: TaskStatus.COMPLETED });
  });

  it('crea tareas validando con el mismo CreateTaskDto que la API', async () => {
    const invalid = await tools.execute(TOOL_NAMES.createTask, { title: 'X', dueDate: '13/10/2026' }, ctx);
    expect(invalid.error).toMatch(/fecha de vencimiento/i);
    expect(mockTasksService.create).not.toHaveBeenCalled();

    mockTasksService.create.mockResolvedValue({ id: TASK_ID, title: 'Nueva', status: TaskStatus.PENDING, dueDate: '2026-10-20' });
    const ok = await tools.execute(TOOL_NAMES.createTask, { title: '  Nueva  ', dueDate: '2026-10-20' }, ctx);

    expect(mockTasksService.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, title: 'Nueva', dueDate: '2026-10-20' }),
      user,
    );
    expect(ok.created).toMatchObject({ id: TASK_ID });
  });

  it('incluye al lider en el equipo aunque no tenga fila de miembro (puede ser responsable)', async () => {
    mockProjectsService.getMembers.mockResolvedValue([{ userId: 'u1', user: { name: 'Cris' }, projectRole: 'MEMBER' }]);
    const withLeader = { ...project, leaderId: 'lider-1', leader: { name: 'Gabi', email: 'g@x' } } as unknown as ProjectEntity;

    const result = await tools.execute(TOOL_NAMES.listProjectMembers, {}, { user, project: withLeader });

    expect(result.members).toEqual([
      expect.objectContaining({ userId: 'lider-1', name: 'Gabi' }),
      expect.objectContaining({ userId: 'u1', name: 'Cris' }),
    ]);
  });

  it('una tool desconocida devuelve error', async () => {
    const result = await tools.execute('borrar_todo', {}, ctx);

    expect(result.error).toMatch(/no existe/i);
  });
});
