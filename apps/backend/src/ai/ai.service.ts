import { Injectable, Logger } from '@nestjs/common';
import { Content } from '@google/genai';
import { ProjectsService } from '../projects/projects.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { ProjectEntity } from '../projects/project.entity';
import { TaskStatus } from '../database/enums';
import { ChatMessageDto } from './dto/chat-message.dto';
import { AiToolsService, TOOL_NAMES, ToolArgs, ToolContext, ToolResult } from './ai-tools.service';
import { GeminiClient } from './gemini.client';
import { buildSystemPrompt } from './ai.prompt';

/** Vueltas maximas modelo -> tools -> modelo por mensaje (evita loops si el modelo se encapricha). */
export const MAX_TOOL_ROUNDS = 5;

export type AssistantMode = 'gemini' | 'rules';

interface TaskSummary {
  title: string;
  status: string;
  dueDate: string | null;
  assignedTo: string | null;
}

/**
 * Orquesta el asistente. Con GEMINI_API_KEY usa Gemini con function calling
 * (AiToolsService); sin key, o si Gemini falla, responde con un reconocimiento
 * de intents por palabras clave que llama a las MISMAS tools. Enchufar la key
 * no requiere tocar codigo: solo cargarla en el .env y reiniciar.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly tools: AiToolsService,
    private readonly projectsService: ProjectsService,
    private readonly gemini: GeminiClient,
  ) {}

  get mode(): AssistantMode {
    return this.gemini.isConfigured() ? 'gemini' : 'rules';
  }

  async answer(dto: ChatMessageDto, user: RequestUser): Promise<string> {
    const ctx: ToolContext = { user, project: await this.resolveCurrentProject(dto.projectId, user) };

    if (this.gemini.isConfigured()) {
      try {
        return await this.answerWithGemini(dto, ctx);
      } catch (error) {
        this.logger.error(`Gemini falló, sigo con el asistente por reglas: ${(error as Error).message}`);
      }
    }

    return this.answerWithRules(dto.message, ctx);
  }

  /** Proyecto abierto en pantalla. Si no existe o no tiene acceso, se sigue sin proyecto (las tools vuelven a chequear). */
  private async resolveCurrentProject(idOrSlug: string | undefined, user: RequestUser): Promise<ProjectEntity | null> {
    if (!idOrSlug) return null;
    try {
      return await this.projectsService.findOne(idOrSlug, user);
    } catch {
      return null;
    }
  }

  // --- Gemini ---

  private async answerWithGemini(dto: ChatMessageDto, ctx: ToolContext): Promise<string> {
    const systemPrompt = buildSystemPrompt({ user: ctx.user, project: ctx.project, today: new Date() });
    const contents: Content[] = [
      ...(dto.history ?? []).map(
        (turn): Content => ({ role: turn.role === 'assistant' ? 'model' : 'user', parts: [{ text: turn.text }] }),
      ),
      { role: 'user', parts: [{ text: dto.message }] },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const turn = await this.gemini.generate(contents, systemPrompt, this.tools.declarations);

      if (turn.functionCalls.length === 0) {
        return turn.text.trim() || 'No tengo una respuesta para eso, ¿podés reformular la pregunta?';
      }

      contents.push(turn.content ?? { role: 'model', parts: turn.functionCalls.map((call) => ({ functionCall: call })) });

      const responses = [];
      for (const call of turn.functionCalls) {
        const name = call.name ?? '';
        const result = await this.tools.execute(name, (call.args ?? {}) as ToolArgs, ctx);
        responses.push({ functionResponse: { id: call.id, name, response: result } });
      }
      contents.push({ role: 'user', parts: responses });
    }

    return 'La consulta se volvió demasiado larga, probá preguntando algo más puntual.';
  }

  // --- Asistente por reglas (sin Gemini) ---

  private async answerWithRules(rawMessage: string, ctx: ToolContext): Promise<string> {
    const message = rawMessage.toLowerCase();
    const has = (...words: string[]) => words.some((w) => message.includes(w));
    const onlyMine = has('mis ', 'mías', 'mias', 'asignad');

    if (has('ayuda', 'qué podés', 'que podes', 'qué sabés', 'que sabes')) {
      return HELP_TEXT;
    }

    if (has('proyectos')) {
      const result = await this.tools.execute(TOOL_NAMES.listProjects, {}, ctx);
      const projects = (result.projects ?? []) as { name: string }[];
      if (result.error) return String(result.error);
      if (projects.length === 0) return 'No tenés proyectos activos.';
      return `Tenés acceso a ${projects.length} proyecto${plural(projects.length)}:\n${projects.map((p) => `- ${p.name}`).join('\n')}`;
    }

    if (!ctx.project && has('vencid', 'bloquead', 'miembro', 'equipo', 'tarea')) {
      return 'Para eso necesito saber de qué proyecto — decime el proyecto primero (abrilo y preguntame de nuevo).';
    }

    if (has('vencid')) {
      return this.describeTasks(
        await this.tools.execute(TOOL_NAMES.listOverdueTasks, { onlyMine }, ctx),
        'vencida',
        'No hay tareas vencidas en este proyecto.',
        (t) => `vencía ${t.dueDate}`,
      );
    }

    if (has('bloquead')) {
      return this.describeTasks(
        await this.tools.execute(TOOL_NAMES.listTasks, { status: TaskStatus.BLOCKED, onlyMine }, ctx),
        'bloqueada',
        'No hay tareas bloqueadas en este proyecto.',
        (t) => t.assignedTo ?? 'sin responsable',
      );
    }

    if (has('miembro', 'equipo', 'quién está', 'quien esta')) {
      const result = await this.tools.execute(TOOL_NAMES.listProjectMembers, {}, ctx);
      if (result.error) return String(result.error);
      const members = (result.members ?? []) as { name: string | null; role: string }[];
      if (members.length === 0) return 'Este proyecto todavía no tiene miembros.';
      return `El equipo de ${result.project}:\n${members.map((m) => `- ${m.name ?? 'Sin nombre'} (${m.role})`).join('\n')}`;
    }

    if (has('tarea') && onlyMine) {
      return this.describeTasks(
        await this.tools.execute(TOOL_NAMES.listTasks, { onlyMine: true }, ctx),
        'asignada',
        'No tenés tareas asignadas en este proyecto.',
        (t) => STATUS_LABELS[t.status] ?? t.status,
      );
    }

    return 'Todavía no sé responder eso — esta es la versión de prueba del asistente. Escribí "ayuda" para ver qué puedo hacer.';
  }

  private describeTasks(
    result: ToolResult,
    adjective: string,
    emptyMessage: string,
    detail: (task: TaskSummary) => string,
  ): string {
    if (result.error) return String(result.error);
    const tasks = (result.tasks ?? []) as TaskSummary[];
    if (tasks.length === 0) return emptyMessage;
    const s = plural(tasks.length);
    const list = tasks.map((t) => `- ${t.title} (${detail(t)})`).join('\n');
    return `Tenés ${tasks.length} tarea${s} ${adjective}${s}:\n${list}`;
  }
}

const STATUS_LABELS: Record<string, string> = {
  [TaskStatus.PENDING]: 'pendiente',
  [TaskStatus.IN_PROGRESS]: 'en progreso',
  [TaskStatus.IN_REVIEW]: 'en revisión',
  [TaskStatus.BLOCKED]: 'bloqueada',
  [TaskStatus.COMPLETED]: 'completada',
};

const HELP_TEXT = [
  'Por ahora puedo:',
  '- Listar tus proyectos ("¿qué proyectos tengo?")',
  '- Mostrar tareas vencidas ("¿qué tareas están vencidas?")',
  '- Mostrar tareas bloqueadas ("¿hay tareas bloqueadas?")',
  '- Mostrar tus tareas ("¿cuáles son mis tareas?")',
  '- Mostrar el equipo del proyecto ("¿quiénes son los miembros?")',
  'Las preguntas sobre tareas y equipo son del proyecto que tengas abierto.',
].join('\n');

function plural(n: number): string {
  return n === 1 ? '' : 's';
}
