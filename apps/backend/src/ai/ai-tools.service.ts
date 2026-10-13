import { HttpException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FunctionDeclaration } from '@google/genai';
import { TasksService } from '../tasks/tasks.service';
import { ProjectsService } from '../projects/projects.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { ProjectStatus, TaskPriority, TaskStatus } from '../database/enums';
import { TaskEntity } from '../tasks/task.entity';
import { ProjectEntity } from '../projects/project.entity';
import { CreateTaskDto } from '../tasks/dto/create-task.dto';

export interface ToolContext {
  user: RequestUser;
  /** Proyecto que el usuario tiene abierto en pantalla (si hay), ya resuelto y con permiso verificado. */
  project: ProjectEntity | null;
}

export type ToolArgs = Record<string, unknown>;
export type ToolResult = Record<string, unknown>;

/** Error "esperable" de una tool (falta un dato, valor invalido): se le devuelve al modelo, no rompe el chat. */
export class ToolInputError extends Error {}

export const TOOL_NAMES = {
  listProjects: 'list_projects',
  listTasks: 'list_tasks',
  listOverdueTasks: 'list_overdue_tasks',
  getTask: 'get_task',
  listProjectMembers: 'list_project_members',
  updateTaskStatus: 'update_task_status',
  createTask: 'create_task',
} as const;

const PROJECT_ID_PARAM = {
  type: 'string',
  description:
    'Id (UUID) o slug del proyecto. Omitir para usar el proyecto que el usuario tiene abierto en pantalla.',
};

/**
 * Las "tools" que Gemini puede llamar. Regla de oro: ninguna toca un repositorio
 * directo, todas pasan por TasksService/ProjectsService con el usuario real, asi
 * los permisos y reglas de negocio son exactamente los mismos que en la UI (si el
 * usuario no puede ver/editar algo desde la app, tampoco puede via el asistente).
 *
 * El asistente por reglas (sin Gemini) usa este mismo executor, asi que lo que
 * se prueba hoy en la demo es el mismo codigo que va a correr con el modelo real.
 */
@Injectable()
export class AiToolsService {
  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  readonly declarations: FunctionDeclaration[] = [
    {
      name: TOOL_NAMES.listProjects,
      description: 'Lista los proyectos (no archivados) a los que el usuario tiene acceso.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Filtra por nombre (coincidencia parcial).' },
          status: { type: 'string', enum: Object.values(ProjectStatus) },
        },
      },
    },
    {
      name: TOOL_NAMES.listTasks,
      description: 'Lista las tareas principales (sin subtareas) de un proyecto, con filtros opcionales.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          projectId: PROJECT_ID_PARAM,
          status: { type: 'string', enum: Object.values(TaskStatus) },
          priority: { type: 'string', enum: Object.values(TaskPriority) },
          search: { type: 'string', description: 'Texto a buscar en título o descripción.' },
          onlyMine: { type: 'boolean', description: 'true = solo las tareas asignadas al usuario actual.' },
        },
      },
    },
    {
      name: TOOL_NAMES.listOverdueTasks,
      description: 'Lista las tareas vencidas (fecha de vencimiento pasada y no completadas) de un proyecto.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          projectId: PROJECT_ID_PARAM,
          onlyMine: { type: 'boolean', description: 'true = solo las asignadas al usuario actual.' },
        },
      },
    },
    {
      name: TOOL_NAMES.getTask,
      description: 'Devuelve el detalle de una tarea por su id.',
      parametersJsonSchema: {
        type: 'object',
        properties: { taskId: { type: 'string', description: 'UUID de la tarea.' } },
        required: ['taskId'],
      },
    },
    {
      name: TOOL_NAMES.listProjectMembers,
      description: 'Lista los miembros activos de un proyecto (id de usuario, nombre, email y rol en el proyecto).',
      parametersJsonSchema: {
        type: 'object',
        properties: { projectId: PROJECT_ID_PARAM },
      },
    },
    {
      name: TOOL_NAMES.updateTaskStatus,
      description:
        'Cambia el estado de una tarea. Es una acción que modifica datos: solo llamarla después de que el usuario lo confirme explícitamente.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'UUID de la tarea.' },
          status: { type: 'string', enum: Object.values(TaskStatus) },
        },
        required: ['taskId', 'status'],
      },
    },
    {
      name: TOOL_NAMES.createTask,
      description:
        'Crea una tarea en un proyecto. Es una acción que modifica datos: solo llamarla después de que el usuario confirme los datos.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          projectId: PROJECT_ID_PARAM,
          title: { type: 'string', description: 'Título de la tarea (máx. 200 caracteres).' },
          description: { type: 'string' },
          priority: { type: 'string', enum: Object.values(TaskPriority) },
          assignedToId: {
            type: 'string',
            description: 'UUID del usuario responsable (sacarlo de list_project_members, nunca inventarlo).',
          },
          startDate: { type: 'string', description: 'Formato AAAA-MM-DD.' },
          dueDate: { type: 'string', description: 'Formato AAAA-MM-DD.' },
        },
        required: ['title'],
      },
    },
  ];

  /**
   * Ejecuta una tool y devuelve un objeto serializable para el modelo. Nunca tira:
   * los errores (permisos, validacion, not found) vuelven como { error } para que el
   * modelo se lo explique al usuario en vez de cortar la conversacion.
   */
  async execute(name: string, args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    try {
      return await this.run(name, args ?? {}, ctx);
    } catch (error) {
      if (error instanceof ToolInputError) return { error: error.message };
      if (error instanceof HttpException) return { error: httpErrorMessage(error) };
      throw error;
    }
  }

  private async run(name: string, args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    switch (name) {
      case TOOL_NAMES.listProjects: {
        const projects = await this.projectsService.findAll(
          {
            name: optionalString(args.name),
            status: optionalEnum(args.status, ProjectStatus, 'status'),
          },
          ctx.user,
        );
        return { projects: projects.map(toProjectSummary) };
      }

      case TOOL_NAMES.listTasks: {
        const project = await this.resolveProject(args.projectId, ctx);
        const tasks = await this.tasksService.findAllByProject(
          {
            projectId: project.id,
            status: optionalEnum(args.status, TaskStatus, 'status'),
            priority: optionalEnum(args.priority, TaskPriority, 'priority'),
            search: optionalString(args.search),
            assignedToId: args.onlyMine === true ? ctx.user.id : undefined,
          },
          ctx.user,
        );
        return { project: project.name, tasks: tasks.map(toTaskSummary) };
      }

      case TOOL_NAMES.listOverdueTasks: {
        const project = await this.resolveProject(args.projectId, ctx);
        const tasks = await this.tasksService.findAllByProject(
          args.onlyMine === true
            ? { projectId: project.id, assignedToId: ctx.user.id }
            : { projectId: project.id },
          ctx.user,
        );
        return { project: project.name, tasks: tasks.filter((task) => isOverdue(task)).map(toTaskSummary) };
      }

      case TOOL_NAMES.getTask: {
        const task = await this.tasksService.findOne(requiredString(args.taskId, 'taskId'), ctx.user);
        return { task: { ...toTaskSummary(task), description: task.description, project: task.project?.name } };
      }

      case TOOL_NAMES.listProjectMembers: {
        const project = await this.resolveProject(args.projectId, ctx);
        const members = await this.projectsService.getMembers(project.id, ctx.user);
        return {
          project: project.name,
          members: members.map((m) => ({
            userId: m.userId,
            name: m.user?.name ?? null,
            email: m.user?.email ?? null,
            role: m.projectRole,
          })),
        };
      }

      case TOOL_NAMES.updateTaskStatus: {
        const status = optionalEnum(args.status, TaskStatus, 'status');
        if (!status) throw new ToolInputError('Falta el estado nuevo de la tarea.');
        const task = await this.tasksService.updateStatus(requiredString(args.taskId, 'taskId'), { status }, ctx.user);
        return { updated: toTaskSummary(task) };
      }

      case TOOL_NAMES.createTask: {
        const project = await this.resolveProject(args.projectId, ctx);
        const dto = plainToInstance(CreateTaskDto, {
          projectId: project.id,
          title: args.title,
          description: args.description,
          priority: args.priority,
          assignedToId: args.assignedToId,
          startDate: args.startDate,
          dueDate: args.dueDate,
        });
        // El ValidationPipe global no corre aca (no es un request HTTP): se valida a mano con el mismo DTO.
        const errors = await validate(dto, { whitelist: true });
        if (errors.length > 0) {
          throw new ToolInputError(errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; '));
        }
        const task = await this.tasksService.create(dto, ctx.user);
        return { created: toTaskSummary(task) };
      }

      default:
        throw new ToolInputError(`La herramienta "${name}" no existe.`);
    }
  }

  /** projectId explicito (UUID o slug) o, si no viene, el proyecto abierto en pantalla. */
  private async resolveProject(projectId: unknown, ctx: ToolContext): Promise<ProjectEntity> {
    const idOrSlug = optionalString(projectId);
    if (idOrSlug && idOrSlug !== ctx.project?.id && idOrSlug !== ctx.project?.slug) {
      return this.projectsService.findOne(idOrSlug, ctx.user);
    }
    if (ctx.project) return ctx.project;
    throw new ToolInputError('No sé de qué proyecto hablás: abrí un proyecto o decime cuál.');
  }
}

export function isOverdue(task: Pick<TaskEntity, 'dueDate' | 'status'>, today = new Date()): boolean {
  return task.dueDate !== null && new Date(task.dueDate) < today && task.status !== TaskStatus.COMPLETED;
}

function toTaskSummary(task: TaskEntity) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    startDate: task.startDate,
    dueDate: task.dueDate,
    assignedTo: task.assignedTo?.name ?? null,
    overdue: isOverdue(task),
  };
}

function toProjectSummary(project: ProjectEntity) {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    status: project.status,
    startDate: project.startDate,
    estimatedEndDate: project.estimatedEndDate,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function requiredString(value: unknown, field: string): string {
  const str = optionalString(value);
  if (!str) throw new ToolInputError(`Falta el campo "${field}".`);
  return str;
}

function optionalEnum<T extends Record<string, string>>(value: unknown, enumObj: T, field: string): T[keyof T] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const allowed = Object.values(enumObj);
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ToolInputError(`Valor inválido para "${field}". Valores permitidos: ${allowed.join(', ')}.`);
  }
  return value as T[keyof T];
}

function httpErrorMessage(error: HttpException): string {
  const response = error.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  return Array.isArray(message) ? message.join('; ') : String(message ?? error.message);
}
