import type {
  GanttAssignee as IGanttAssignee,
  GanttDependency as IGanttDependency,
  GanttDependencyType,
  GanttProject as IGanttProject,
  GanttResponse as IGanttResponse,
  GanttTask as IGanttTask,
} from '@tema/shared-types';
import { TaskPriority, TaskStatus } from '../../database/enums';

/**
 * Contrato del endpoint GET /projects/:projectId/gantt (la forma vive en @tema/shared-types; estas
 * clases la implementan en el backend). Deliberadamente SIN campos económicos: COLLABORATOR y
 * OBSERVER ven el Gantt pero no pueden recibir presupuesto, costos ni tarifas.
 */
export class GanttProjectDto implements IGanttProject {
  id!: string;
  name!: string;
  startDate!: string | null;
  estimatedEndDate!: string | null;
}

export class GanttAssigneeDto implements IGanttAssignee {
  id!: string;
  name!: string;
}

export class GanttTaskDto implements IGanttTask {
  id!: string;
  parentTaskId!: string | null;
  title!: string;
  status!: TaskStatus;
  priority!: TaskPriority;
  startDate!: string | null;
  dueDate!: string | null;
  assignedTo!: GanttAssigneeDto | null;
  blocked!: boolean;
}

export class GanttDependencyDto implements IGanttDependency {
  id!: string;
  predecessorTaskId!: string;
  successorTaskId!: string;
  type!: GanttDependencyType;
}

export class GanttResponseDto implements IGanttResponse {
  project!: GanttProjectDto;
  tasks!: GanttTaskDto[];
  dependencies!: GanttDependencyDto[];
}
