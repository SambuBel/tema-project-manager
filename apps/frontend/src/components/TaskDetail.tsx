import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../lib/api';
import { taskPriorityLabels } from '../types/task';
import type { Task, TaskPriority } from '../types/task';
import { SubtaskList } from './SubtaskList';
import { ConfirmDialog } from './ConfirmDialog';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useMyMembership } from '../hooks/useMyMembership';
import {
  canCommentOnTaskUI,
  canCreateTaskUI,
  canDeleteTaskUI,
  canEditTaskUI,
  canManageMilestonesUI,
} from '../lib/permissions';
import { SubtaskCreateModal } from './SubtaskCreateModal';
import { MilestoneStatusBadge } from './milestones/MilestoneStatusBadge';

import { TaskStatusDropdown } from './TaskStatusDropdown';
import { TaskTimeline } from './TaskTimeline';
import { isTaskExceedingProjectEnd } from '../lib/projectDates';

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
  projectId?: string;
  onBack: () => void;
}

/**
 * Detalle de una tarea individual.
 */
export function TaskDetail({ taskId, projectId, onBack }: TaskDetailProps) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [showSubtaskModal, setShowSubtaskModal] = useState(false);
  const [milestoneError, setMilestoneError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: task, isLoading, isError } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api.getTask(taskId, projectId),
  });

  const { membership } = useMyMembership(task?.projectId);

  const { data: projectMilestones, isLoading: loadingMilestones } = useQuery({
    queryKey: ['milestones', task?.projectId],
    queryFn: () => api.listMilestones(task!.projectId),
    enabled: Boolean(task?.projectId && !task?.parentTaskId),
  });

  // Reemplazo transparente en la barra de direcciones:
  // Si se ingresó con ?taskId=<UUID> o con un slug histórico anterior,
  // se reemplaza en la URL por ?task=<currentSlug> sin recargar la página.
  useEffect(() => {
    const slug = task?.slug;
    if (!slug) return;
    const currentTask = searchParams.get('task');
    const currentTaskId = searchParams.get('taskId');
    if (currentTaskId || (currentTask && currentTask !== slug)) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('taskId');
          next.set('task', slug);
          return next;
        },
        { replace: true },
      );
    }
  }, [task?.slug, searchParams, setSearchParams]);

  const archive = useMutation({
    mutationFn: () => api.archiveTask(task?.id ?? taskId),
    onSuccess: () => {
      setConfirmArchive(false);
      if (task?.parentTaskId) {
        qc.setQueryData<Task[]>(['subtasks', task.parentTaskId], (old) => {
          if (!old) return old;
          return old.filter((s) => s.id !== (task?.id ?? taskId));
        });
        qc.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) => {
          if (!Array.isArray(old)) return old;
          return old.map((t) =>
            t.id === task.parentTaskId
              ? {
                  ...t,
                  subtaskCount: Math.max(0, (t.subtaskCount ?? 1) - 1),
                }
              : t,
          );
        });
      }
      void qc.invalidateQueries({ queryKey: ['task'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['subtasks'] });
      if (task?.projectId) {
        void qc.invalidateQueries({ queryKey: ['milestones', task.projectId] });
        void qc.invalidateQueries({ queryKey: ['milestones-upcoming', task.projectId] });
      }
      void qc.invalidateQueries({ queryKey: ['milestone-detail'] });
      void qc.invalidateQueries({ queryKey: ['gantt'] });
    },
  });

  const milestoneMutation = useMutation({
    mutationFn: async (nextMilestoneId: string) => {
      if (!task || task.parentTaskId) return;
      const previousMilestoneId = task.milestoneId ?? '';
      if (nextMilestoneId === previousMilestoneId) return;

      if (previousMilestoneId) {
        await api.disassociateMilestoneTask(previousMilestoneId, task.id);
      }
      if (nextMilestoneId) {
        await api.associateMilestoneTask(nextMilestoneId, task.id);
      }
    },
    onSuccess: (_data, nextMilestoneId) => {
      setMilestoneError(null);
      if (task) {
        qc.setQueryData(['task', taskId], { ...task, milestoneId: nextMilestoneId || null });
        if (task.slug) {
          qc.setQueryData(['task', task.slug], { ...task, milestoneId: nextMilestoneId || null });
        }
        void qc.invalidateQueries({ queryKey: ['task', taskId] });
        void qc.invalidateQueries({ queryKey: ['tasks'] });
        void qc.invalidateQueries({ queryKey: ['subtasks'] });
        void qc.invalidateQueries({ queryKey: ['milestones', task.projectId] });
        void qc.invalidateQueries({ queryKey: ['milestones-upcoming', task.projectId] });
        void qc.invalidateQueries({ queryKey: ['milestone-detail'] });
        void qc.invalidateQueries({ queryKey: ['gantt'] });
      }
    },
    onError: (err) => {
      if (err instanceof ApiRequestError) {
        setMilestoneError(err.details[0] || err.message || 'No se pudo actualizar el hito de la tarea.');
      } else {
        setMilestoneError('No se pudo actualizar el hito de la tarea.');
      }
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

  const isSubtask = Boolean(task.parentTaskId);
  const canEdit = !!user && canEditTaskUI(user, task, task.project, membership);
  const canDelete = !!user && canDeleteTaskUI(user, task.project);
  const canComment = !!user && canCommentOnTaskUI(user, task.project, membership);
  const canManageMilestone =
    !isSubtask && !!user && !!task.project && canManageMilestonesUI(user, task.project) && !task.archivedAt;
  const canAddSubtask =
    !!user && canCreateTaskUI(user, task.project, membership) && !task.parentTaskId && !task.archivedAt;

  const activeMilestones = projectMilestones ?? [];
  const associatedMilestone = activeMilestones.find((m) => m.id === task.milestoneId) ?? null;

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
          <TaskStatusDropdown
            taskId={task.id}
            currentStatus={task.status}
            canChange={canEdit}
            taskTitle={task.title}
          />
          <span className={'rounded-full px-3 py-1 text-xs font-medium ' + priorityColors[task.priority]}>
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
                to={'/tasks/' + task.id + '/edit'}
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

          {/* Hito asociado (KAN-247): solo para tareas principales (parentTaskId === null) */}
          {!isSubtask && (
            <div className="rounded-xl border border-[#DEE5EC] bg-white p-6" data-testid="task-detail-milestone-card">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-[#607185]">Hito (Milestone)</h3>
                {associatedMilestone && <MilestoneStatusBadge status={associatedMilestone.status} />}
              </div>

              {associatedMilestone ? (
                <div className="mt-3 space-y-1">
                  <p className="text-sm font-semibold text-[#172B42]">{associatedMilestone.name}</p>
                  <p className="text-xs text-[#607185]">
                    Objetivo: {formatDate(associatedMilestone.dueDate)} · Avance: {associatedMilestone.progress}%
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-[#607185]">
                  {loadingMilestones && task.milestoneId ? 'Cargando hito…' : 'Sin hito asignado'}
                </p>
              )}

              {canManageMilestone && (
                <div className="mt-3 space-y-2 border-t border-[#DEE5EC] pt-3">
                  <label htmlFor="task-detail-milestone-select" className="block text-xs font-medium text-[#607185]">
                    Cambiar o asignar hito
                  </label>
                  <select
                    id="task-detail-milestone-select"
                    aria-label="Hito de la tarea"
                    value={task.milestoneId ?? ''}
                    disabled={milestoneMutation.isPending || loadingMilestones}
                    onChange={(e) => {
                      setMilestoneError(null);
                      milestoneMutation.mutate(e.target.value);
                    }}
                    className="w-full rounded-lg border border-[#DEE5EC] bg-white px-3 py-2 text-xs text-[#172B42] focus:border-[#245B78] focus:outline-none disabled:opacity-50"
                  >
                    <option value="">Sin hito asignado</option>
                    {activeMilestones.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({formatDate(m.dueDate)})
                      </option>
                    ))}
                  </select>

                  {task.milestoneId && (
                    <button
                      type="button"
                      disabled={milestoneMutation.isPending}
                      onClick={() => {
                        setMilestoneError(null);
                        milestoneMutation.mutate('');
                      }}
                      className="text-xs font-medium text-rose-700 hover:underline disabled:opacity-50"
                    >
                      {milestoneMutation.isPending ? 'Actualizando hito…' : 'Desasociar del hito'}
                    </button>
                  )}

                  {milestoneMutation.isPending && !task.milestoneId && (
                    <p className="text-xs text-[#607185]">Actualizando hito…</p>
                  )}

                  {milestoneError && (
                    <p role="alert" className="text-xs font-medium text-red-600">
                      {milestoneError}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border border-[#DEE5EC] bg-white p-6">
            <h3 className="text-sm font-medium text-[#607185]">Fechas</h3>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#607185]">Inicio</span>
                <span>{formatDate(task.startDate)}</span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-[#607185]">Vencimiento</span>
                <div className="flex flex-col items-end">
                  <span>{formatDate(task.dueDate)}</span>
                  {isTaskExceedingProjectEnd(task.dueDate, task.project?.estimatedEndDate) && (
                    <span
                      role="status"
                      className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
                      title="El vencimiento supera el fin estimado del proyecto (RN-08)"
                    >
                      ⚠️ Supera fin del proyecto
                    </span>
                  )}
                </div>
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-[#172B42]">Subtareas</h3>
          {canAddSubtask && (
            <button
              type="button"
              onClick={() => setShowSubtaskModal(true)}
              className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#245B78] hover:bg-[#EAF2F7]"
            >
              + Agregar subtarea
            </button>
          )}
        </div>
        <div className="mt-4">
          <SubtaskList parentTaskId={task.id} />
        </div>
      </div>

      <div className="rounded-xl border border-[#DEE5EC] bg-white p-6">
        <h3 className="text-lg font-semibold text-[#172B42]">Actividad y Comentarios</h3>
        <div className="mt-4">
          <TaskTimeline taskId={task.id} projectId={task.projectId} canComment={canComment} />
        </div>
      </div>

      {showSubtaskModal && (
        <SubtaskCreateModal
          projectId={task.projectId}
          parentTask={{ id: task.id, title: task.title }}
          onClose={() => setShowSubtaskModal(false)}
        />
      )}

      <ConfirmDialog
        open={confirmArchive}
        title="Archivar tarea"
        description="La tarea deja de aparecer como activa. Esta acción corresponde a 'eliminar tarea' (RN-08): la tarea no se borra, queda archivada."
        confirmLabel="Archivar"
        variant="danger"
        isConfirming={archive.isPending}
        onConfirm={() => archive.mutate()}
        onCancel={() => setConfirmArchive(false)}
      />
    </div>
  );
}
