import type { Project, Task, TaskPriority } from '@tema/shared-types';
import { canEditTaskUI } from '../../lib/permissions';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useMyMembership } from '../../hooks/useMyMembership';
import { taskPriorityLabels } from '../../types/task';
import { Draggable } from '@hello-pangea/dnd';

interface BoardCardProps {
  task: Task;
  index: number;
  project: Project;
  onSelectTask: (taskId: string) => void;
}

const priorityColors: Record<TaskPriority, string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-amber-50 text-amber-700',
  HIGH: 'bg-red-50 text-red-700',
  CRITICAL: 'bg-red-100 text-red-800'
};

function initials(name: string) {
  return name.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

export function BoardCard({ task, index, project, onSelectTask }: BoardCardProps) {
  const { user } = useCurrentUser();
  const { membership } = useMyMembership(task.projectId);

  const canEdit = user && project ? canEditTaskUI(user, task, project, membership) : false;

  return (
    <Draggable draggableId={task.id} index={index} isDragDisabled={!canEdit}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => onSelectTask(task.slug || task.id)}
          className={`group relative flex cursor-pointer flex-col gap-3 rounded-lg border bg-white p-3 shadow-sm transition-all hover:border-[#245B78] hover:shadow-md
            ${!canEdit ? 'opacity-80' : ''}
            ${snapshot.isDragging ? 'border-[#245B78] shadow-lg rotate-2 scale-105 z-10' : 'border-[#DEE5EC]'}`}
          title={!canEdit ? 'No tenés permisos para mover/editar esta tarea' : undefined}
          style={provided.draggableProps.style}
        >
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-sm font-medium text-[#172B42] line-clamp-2 leading-tight">
              {task.title}
            </h4>
            {!canEdit && (
              <div className="text-[#607185]" title="Solo lectura">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider ${priorityColors[task.priority] || priorityColors.LOW}`}>
              {taskPriorityLabels[task.priority]}
            </span>

            {task.assignedTo ? (
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EAF2F7] text-[9px] font-bold text-[#245B78]"
                title={task.assignedTo.name}
              >
                {initials(task.assignedTo.name)}
              </div>
            ) : (
              <div
                className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-[#DEE5EC] text-[10px] text-[#607185]"
                title="Sin asignar"
              >
                -
              </div>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}
