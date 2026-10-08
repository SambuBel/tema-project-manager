import type { Task, TaskStatus } from '@tema/shared-types';
import { BoardCard } from './BoardCard';

interface BoardColumnProps {
  status: TaskStatus;
  title: string;
  tasks: Task[];
  onSelectTask: (taskId: string) => void;
}

export function BoardColumn({ status, title, tasks, onSelectTask }: BoardColumnProps) {
  return (
    <div className="flex w-80 shrink-0 flex-col rounded-xl bg-[#F7F9FB] p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-[#172B42]">{title}</h3>
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#EAF2F7] text-xs font-medium text-[#607185]">
          {tasks.length}
        </span>
      </div>
      
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-[#DEE5EC] bg-white/50 text-sm text-[#607185]">
            Sin tareas
          </div>
        ) : (
          tasks.map((task) => (
            <BoardCard key={task.id} task={task} onSelectTask={onSelectTask} />
          ))
        )}
      </div>
    </div>
  );
}
