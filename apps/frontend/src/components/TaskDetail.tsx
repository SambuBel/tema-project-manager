import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { taskPriorityLabels } from '../types/task';
import type { TaskPriority } from '../types/task';
import { SubtaskList } from './SubtaskList';
import { ConfirmDialog } from './ConfirmDialog';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useMyMembership } from '../hooks/useMyMembership';
import { canDeleteTaskUI, canEditTaskUI } from '../lib/permissions';

const statusColors: Record<TaskStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-700',
  IN_PROGRESS: 'bg-blue-50 text-blue-700',
  IN_REVIEW: 'bg-purple-50 text-purple-700',
  BLOCKED: 'bg-red-50 text-red-700',
  COMPLETED: 'bg-green-50 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-400',
};
import { TaskStatusDropdown } from './TaskStatusDropdown';

const priorityColors: Record<TaskPriority, string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-amber-50 text-amber-700',
  HIGH: 'bg-red-50 text-red-700',
  CRITICAL: 'bg-red-100 text-red-800',
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
  onBack: () => void;
}

/* Componente */

/**
 * Detalle de una tarea individual.
 */
export function TaskDetail({ taskId, onBack }: TaskDetailProps) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const [confirmArchive, setConfirmArchive] = useState(false);

  const { data: task, isLoading, isError } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api.getTask(taskId),
  });

  const { membership } = useMyMembership(task?.projectId);

  const archive = useMutation({
    mutationFn: () => api.archiveTask(taskId),
    onSuccess: () => {
      setConfirmArchive(false);
      void qc.invalidateQueries({ queryKey: ['task', taskId] });
      void qc.invalidateQueries({ queryKey: ['tasks', task?.projectId] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <button onClick={onBack} className="self-start text-sm text-[#607185] hover:underline">
          &larr; Volver a tareas
        </button>
        <p className="text-sm text-[#607185]">Cargando tarea…</p>
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

  const canEdit = !!user && canEditTaskUI(user, task, task.project, membership);
  const canDelete = !!user && canDeleteTaskUI(user, task.project);

  return (
    <div className="flex flex-col gap-8 text-[#172B42]">
      {/* Botón volver */}
      <button onClick={onBack} className="self-start text-sm text-[#607185] hover:underline">
        &larr; Volver a tareas
      </button>

      {/* Título + badges + acciones */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-4xl font-semibold">{task.title}</h1>
          <TaskStatusDropdown taskId={taskId} currentStatus={task.status} />
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${priorityColors[task.priority]}`}>
            {taskPriorityLabels[task.priority]}
          </span>
          {task.archivedAt && (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">Archivada</span>
          )}
        </div>

        {/* Nunca puede -> no se renderiza; puede pero está archivada -> deshabilitado con motivo */}
        {(canEdit || canDelete) && (
          <div className="flex gap-2">
            {canEdit && (
              <Link
                to={`/tasks/${task.id}/edit`}
                className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] hover:bg-gray-50"
              >
                Editar tarea
              </Link>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => setConfirmArchive(true)}
                disabled={!!task.archivedAt}
                title={task.archivedAt ? 'Esta tarea ya está archivada' : undefined}
                className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
              >
                {task.archivedAt ? 'Tarea archivada' : 'Archivar tarea'}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Descripción */}
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
                  {task.assignedTo.name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .substring(0, 2)
                    .toUpperCase()}
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

      {/* Subtareas */}
      <div className="rounded-xl border border-[#DEE5EC] bg-white p-6">
        <h3 className="text-lg font-semibold text-[#172B42]">Subtareas</h3>
        <div className="mt-4">
          <SubtaskList parentTaskId={taskId} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmArchive}
        title="Archivar tarea"
        description="La tarea deja de aparecer como activa. Esta acción corresponde a 'eliminar tarea' (RN-07): la tarea no se borra, queda archivada."
        confirmLabel="Archivar"
        variant="danger"
        isConfirming={archive.isPending}
        onConfirm={() => archive.mutate()}
        onCancel={() => setConfirmArchive(false)}
      />
    </div>
  );
}
