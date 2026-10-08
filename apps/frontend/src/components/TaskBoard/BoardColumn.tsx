import type { Task, TaskStatus } from '@tema/shared-types';
import { BoardCard } from './BoardCard';
import { Droppable } from '@hello-pangea/dnd';

interface BoardColumnProps {
  status: TaskStatus;
  title: string;
  tasks: Task[];
  onSelectTask: (taskId: string) => void;
}

export function BoardColumn({ status, title, tasks, onSelectTask }: BoardColumnProps) {
  return (
    <div className="relative flex flex-1 shrink-0 basis-[280px] min-w-[280px] max-w-[400px] flex-col rounded-xl bg-[#F7F9FB] mx-3 pt-4">
      <div className="mb-4 px-4 flex items-center justify-between">
        <h3 className="font-semibold text-[#172B42]">{title}</h3>
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#EAF2F7] text-xs font-medium text-[#607185]">
          {tasks.length}
        </span>
      </div>
      
      <Droppable droppableId={status}>
        {(provided, snapshot) => (
          <>
            {snapshot.isDraggingOver && (
              <div className="absolute inset-0 top-[60px] bg-[#EAF2F7]/50 rounded-b-xl pointer-events-none" />
            )}
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              // -mx-3 expands the drop zone to cover the margin gap. px-7 (28px) restores the visual padding (12px margin + 16px padding).
              className="flex flex-1 flex-col gap-3 overflow-y-auto -mx-3 px-7 pb-4 z-10"
            >
              {tasks.length === 0 ? (
                <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-[#DEE5EC] bg-white/50 text-sm text-[#607185]">
                  Sin tareas
                </div>
              ) : (
                tasks.map((task, index) => (
                  <BoardCard key={task.id} task={task} index={index} onSelectTask={onSelectTask} />
                ))
              )}
              {provided.placeholder}
            </div>
          </>
        )}
      </Droppable>
    </div>
  );
}
