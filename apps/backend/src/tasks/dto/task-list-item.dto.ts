import { TaskEntity } from '../task.entity';
import { TaskPriority, TaskStatus } from '../../database/enums';

/**
 * Fila del listado GET /tasks. Solo lleva lo que usan la lista y el tablero: no repite el
 * proyecto completo en cada tarea y del responsable manda solo id y nombre.
 * El detalle (GET /tasks/:id) sigue devolviendo la tarea completa con su proyecto.
 */
export interface TaskListItemDto {
  id: string;
  slug: string;
  projectId: string;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignedToId: string | null;
  assignedTo: { id: string; name: string } | null;
  startDate: string | null;
  dueDate: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export function toTaskListItem(task: TaskEntity): TaskListItemDto {
  return {
    id: task.id,
    slug: task.slug,
    projectId: task.projectId,
    parentTaskId: task.parentTaskId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assignedToId: task.assignedToId,
    assignedTo: task.assignedTo ? { id: task.assignedTo.id, name: task.assignedTo.name } : null,
    startDate: task.startDate,
    dueDate: task.dueDate,
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    archivedAt: task.archivedAt,
  };
}
