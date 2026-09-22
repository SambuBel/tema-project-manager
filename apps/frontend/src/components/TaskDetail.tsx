import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { taskStatusLabels, taskPriorityLabels } from '../types/task';
import type { TaskStatus, TaskPriority } from '../types/task';


const statusColors: Record<TaskStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-700',
  IN_PROGRESS: 'bg-blue-50 text-blue-700',
  BLOCKED: 'bg-red-50 text-red-700',
  COMPLETED: 'bg-green-50 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-400',
};

const priorityColors: Record<TaskPriority, string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-amber-50 text-amber-700',
  HIGH: 'bg-red-50 text-red-700',
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'No definida';
  try {
    return new Date(dateStr).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}


interface TaskDetailProps {
  taskId: string;
  projectName: string;
  onBack: () => void;
}


export function TaskDetail({ taskId, projectName, onBack }: TaskDetailProps) {
  const { data: task, isLoading, isError } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api.getTask(taskId),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <button onClick={onBack} className="self-start text-sm text-[#607185] hover:underline">
          &larr; Volver a tareas
        </button>
        <p className="text-sm text-[#607185]">Cargando tarea...</p>
      </div>
    );
  }

  if (isError || !task) {
    return (
      <div className="flex flex-col gap-4">
        <button onClick={onBack} className="self-start text-sm text-[#607185] hover:underline">
          &larr; Volver a tareas
        </button>
        <p className="text-sm text-red-600">Error al cargar la tarea.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 text-[#172B42]">
      <div className="flex items-center text-sm text-[#607185]">
        <button onClick={onBack} className="hover:underline">
          {projectName}
        </button>
        <span className="mx-2">/</span>
        <button onClick={onBack} className="hover:underline">
          Tareas
        </button>
        <span className="mx-2">/</span>
        <span className="truncate">{task.title}</span>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">{task.title}</h1>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusColors[task.status]}`}>
            {taskStatusLabels[task.status]}
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${priorityColors[task.priority]}`}>
            {taskPriorityLabels[task.priority]}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="flex flex-col rounded-xl border border-[#DEE5EC] bg-white p-6 md:col-span-2">
          <h3 className="text-lg font-semibold text-[#172B42]">Descripción</h3>
          {task.description ? (
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-[#172B42]">
              {task.description}
            </p>
          ) : (
            <p className="mt-4 text-sm italic text-[#607185]">
              Sin descripción.
            </p>
          )}
        </div>

        {/* Info lateral */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-[#DEE5EC] bg-white p-6">
            <h3 className="text-sm font-medium text-[#607185]">Responsable</h3>
            {task.assignedTo ? (
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EAF2F7] text-xs font-semibold text-[#245B78]">
                  {task.assignedTo.name.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase()}
                </div>
                <span className="text-sm font-medium">{task.assignedTo.name}</span>
              </div>
            ) : (
              <p className="mt-3 text-sm text-[#607185]">Sin asignar</p>
            )}
          </div>

          <div className="rounded-xl border border-[#DEE5EC] bg-white p-6">
            <h3 className="text-sm font-medium text-[#607185]">Fechas</h3>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#607185]">Inicio</span>
                <span>{formatDate(task.startDate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#607185]">Vencimiento</span>
                <span>{formatDate(task.dueDate)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#DEE5EC] bg-white p-6">
            <h3 className="text-sm font-medium text-[#607185]">Actividad</h3>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#607185]">Creada</span>
                <span>{formatDate(task.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#607185]">Actualizada</span>
                <span>{formatDate(task.updatedAt)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Placeholder para subtareas (KAN-134) */}
      <div className="rounded-xl border border-[#DEE5EC] bg-white p-6">
        <h3 className="text-lg font-semibold text-[#172B42]">Subtareas</h3>
        <p className="mt-4 text-sm text-[#607185]">
          pendiente de KAN-134.
        </p>
      </div>
    </div>
  );
}