import { Injectable } from '@nestjs/common';
import { TasksService } from '../tasks/tasks.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { TaskStatus } from '../database/enums';
import { ChatMessageDto } from './dto/chat-message.dto';

/**
 * Primera version del asistente, sin Gemini todavia (credenciales pendientes).
 * El reconocimiento de intent es a mano a proposito: lo que importa de esta
 * version no es el modelo, es dejar probado el patron que van a seguir las
 * "tools" reales: nunca tocar el repositorio directo, siempre pasar por el
 * service que ya existe (ahi vive la validacion de permisos y las reglas de
 * negocio de cada entidad, no se duplica nada).
 */
@Injectable()
export class AiService {
  constructor(private readonly tasksService: TasksService) {}

  async answer(dto: ChatMessageDto, user: RequestUser): Promise<string> {
    const message = dto.message.toLowerCase();

    if (message.includes('vencid')) {
      if (!dto.projectId) {
        return 'Para ver tareas vencidas necesito saber de qué proyecto — decime el proyecto primero.';
      }
      return this.summarizeOverdueTasks(dto.projectId, user);
    }

    return 'Todavía no sé responder eso — esta es la primera versión del asistente.';
  }

  private async summarizeOverdueTasks(projectId: string, user: RequestUser): Promise<string> {
    const tasks = await this.tasksService.findAllByProject({ projectId }, user);
    const today = new Date();

    const overdue = tasks.filter(
      (task) =>
        task.dueDate !== null &&
        new Date(task.dueDate) < today &&
        task.status !== TaskStatus.COMPLETED,
    );

    if (overdue.length === 0) {
      return 'No hay tareas vencidas en este proyecto.';
    }

    const lista = overdue.map((task) => `- ${task.title} (vencía ${task.dueDate})`).join('\n');
    const plural = overdue.length > 1 ? 's' : '';
    return `Tenés ${overdue.length} tarea${plural} vencida${plural}:\n${lista}`;
  }
}
