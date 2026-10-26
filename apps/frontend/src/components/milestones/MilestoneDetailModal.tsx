import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../lib/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useMyMembership } from '../../hooks/useMyMembership';
import { canEditTaskUI } from '../../lib/permissions';
import { taskStatusLabels } from '../../types/task';
import type { TaskStatus } from '../../types/task';
import type { MilestoneTaskDto } from '@tema/shared-types';
import {
  CompleteTaskWithSubtasksModal,
  isPendingSubtasksCompletionError,
} from '../CompleteTaskWithSubtasksModal';
import { MilestoneStatusBadge } from './MilestoneStatusBadge';
import { MilestoneProgressBar } from './MilestoneProgressBar';
import { MilestoneFormModal } from './MilestoneFormModal';
import { MilestoneDeleteModal } from './MilestoneDeleteModal';
import { MilestoneTaskSelectorModal } from './MilestoneTaskSelectorModal';

interface MilestoneDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  milestoneId: string;
  projectId: string;
  canManage: boolean;
  onMilestoneUpdated: () => void;
}

const TASK_STATUS_BADGE_STYLES: Record<TaskStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-700 border-gray-200',
  IN_PROGRESS: 'bg-blue-50 text-blue-700 border-blue-200',
  IN_REVIEW: 'bg-purple-50 text-purple-700 border-purple-200',
  BLOCKED: 'bg-rose-50 text-rose-700 border-rose-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'No definida';
  try {
    const parts = dateStr.split('T')[0]?.split('-');
    if (!parts || parts.length < 3) return dateStr;
    const [year, month, day] = parts;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function MilestoneDetailModal({
  isOpen,
  onClose,
  milestoneId,
  projectId,
  canManage,
  onMilestoneUpdated,
}: MilestoneDetailModalProps) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const { membership } = useMyMembership(projectId);

  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSelectingTasks, setIsSelectingTasks] = useState(false);
  const [isConfirmingJointComplete, setIsConfirmingJointComplete] = useState(false);
  const [disassociatingTaskId, setDisassociatingTaskId] = useState<string | null>(null);
  const [togglingTaskIds, setTogglingTaskIds] = useState<Record<string, boolean>>({});
  const [taskPendingSubtasksConfirm, setTaskPendingSubtasksConfirm] = useState<MilestoneTaskDto | null>(null);
  const [isConfirmingTaskSubtasks, setIsConfirmingTaskSubtasks] = useState(false);
  const [taskSubtasksModalError, setTaskSubtasksModalError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
    enabled: isOpen && Boolean(projectId),
  });

  const { data: milestone, isLoading, isError, refetch } = useQuery({
    queryKey: ['milestone-detail', milestoneId],
    queryFn: () => api.getMilestone(milestoneId),
    enabled: isOpen && Boolean(milestoneId),
  });

  useEffect(() => {
    if (!actionSuccess) return;
    const timer = setTimeout(() => setActionSuccess(null), 4000);
    return () => clearTimeout(timer);
  }, [actionSuccess]);

  // Finalización manual (cuando no hay tareas pendientes): marca el hito como alcanzado.
  const completeMutation = useMutation({
    mutationFn: () => api.completeMilestone(milestoneId),
    onSuccess: () => {
      setActionError(null);
      setActionSuccess('Hito marcado como alcanzado.');
      void refetch();
      void qc.invalidateQueries({ queryKey: ['milestones', projectId] });
      void qc.invalidateQueries({ queryKey: ['milestones-upcoming', projectId] });
      void qc.invalidateQueries({ queryKey: ['gantt'] });
      onMilestoneUpdated();
    },
    onError: (err) => {
      setActionError(
        err instanceof ApiRequestError
          ? err.details.join(' ') || err.message
          : 'Error al completar manualmente el hito.',
      );
    },
  });

  // Finalización conjunta (KAN-250):
  // Completa atómicamente las subtareas pendientes, las tareas principales pendientes y el hito.
  const completeWithTasksMutation = useMutation({
    mutationFn: () => api.completeMilestoneWithTasks(milestoneId),
    onSuccess: () => {
      setActionError(null);
      setActionSuccess('Se completaron el hito y todas sus tareas asociadas.');
      setIsConfirmingJointComplete(false);
      void refetch();
      void qc.invalidateQueries({ queryKey: ['milestones', projectId] });
      void qc.invalidateQueries({ queryKey: ['milestones-upcoming', projectId] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['subtasks'] });
      void qc.invalidateQueries({ queryKey: ['task'] });
      void qc.invalidateQueries({ queryKey: ['gantt'] });
      onMilestoneUpdated();
    },
    onError: (err) => {
      setIsConfirmingJointComplete(false);
      setActionError(
        err instanceof ApiRequestError
          ? err.details.join(' ') || err.message
          : 'Error al finalizar conjuntamente el hito y sus tareas.',
      );
      void refetch();
    },
  });

  // Reapertura manual (KAN-244 / KAN-250): reabre solo el hito sin reabrir tareas completadas.
  const reopenMutation = useMutation({
    mutationFn: () => api.reopenMilestone(milestoneId),
    onSuccess: () => {
      setActionError(null);
      setActionSuccess(null);
      void refetch();
      void qc.invalidateQueries({ queryKey: ['milestones', projectId] });
      void qc.invalidateQueries({ queryKey: ['milestones-upcoming', projectId] });
      void qc.invalidateQueries({ queryKey: ['gantt'] });
      onMilestoneUpdated();
    },
    onError: (err) => {
      setActionError(
        err instanceof ApiRequestError ? err.details.join(' ') || err.message : 'Error al reabrir el hito.',
      );
    },
  });

  const canUserToggleTask = (task: MilestoneTaskDto): boolean => {
    if (canManage) return true;
    if (!user || !project) return false;
    return canEditTaskUI(
      user,
      {
        createdBy: task.createdBy ?? '',
        assignedToId: task.assignedToId ?? task.assignedTo?.id ?? null,
      },
      project,
      membership,
    );
  };

  /**
   * KAN-249 + Sección 2: Cambia el estado de una tarea principal desde el checkbox.
   * - Si la tarea tiene subtareas pendientes al intentar completarla, abre el modal de confirmación
   *   «Esta tarea tiene subtareas pendientes».
   */
  const handleToggleTaskCheckbox = async (task: MilestoneTaskDto) => {
    if (togglingTaskIds[task.id]) return;
    if (!canUserToggleTask(task)) return;

    const nextStatus: TaskStatus = task.status === 'COMPLETED' ? 'PENDING' : 'COMPLETED';
    setActionError(null);
    setActionSuccess(null);

    const pendingSubtasksOfTask = Math.max(0, (task.subtaskCount ?? 0) - (task.completedSubtaskCount ?? 0));
    if (nextStatus === 'COMPLETED' && pendingSubtasksOfTask > 0) {
      setTaskSubtasksModalError(null);
      setTaskPendingSubtasksConfirm(task);
      return;
    }

    setTogglingTaskIds((prev) => ({ ...prev, [task.id]: true }));

    try {
      await api.updateTaskStatus(task.id, nextStatus);
      await Promise.all([
        refetch(),
        qc.invalidateQueries({ queryKey: ['milestones', projectId] }),
        qc.invalidateQueries({ queryKey: ['milestones-upcoming', projectId] }),
        qc.invalidateQueries({ queryKey: ['tasks'] }),
        qc.invalidateQueries({ queryKey: ['subtasks'] }),
        qc.invalidateQueries({ queryKey: ['task', task.id] }),
        qc.invalidateQueries({ queryKey: ['gantt'] }),
      ]);
      onMilestoneUpdated();
    } catch (err) {
      if (nextStatus === 'COMPLETED' && isPendingSubtasksCompletionError(err)) {
        setTaskSubtasksModalError(null);
        setTaskPendingSubtasksConfirm(task);
      } else if (err instanceof ApiRequestError) {
        setActionError(
          err.details && err.details.length > 0
            ? err.details.join(' ')
            : err.message || 'No se pudo actualizar el estado de la tarea.',
        );
      } else {
        setActionError('Error inesperado al actualizar el estado de la tarea.');
      }
      await refetch();
    } finally {
      setTogglingTaskIds((prev) => {
        const next = { ...prev };
        delete next[task.id];
        return next;
      });
    }
  };

  const handleConfirmCompleteTaskWithSubtasks = async () => {
    if (!taskPendingSubtasksConfirm || isConfirmingTaskSubtasks) return;
    const targetTask = taskPendingSubtasksConfirm;
    setIsConfirmingTaskSubtasks(true);
    setTaskSubtasksModalError(null);
    setActionError(null);

    try {
      await api.updateTaskStatus(targetTask.id, 'COMPLETED', { completeSubtasks: true });
      setTaskPendingSubtasksConfirm(null);
      setActionSuccess(`Se completaron las subtareas pendientes y la tarea «${targetTask.title}».`);
      await Promise.all([
        refetch(),
        qc.invalidateQueries({ queryKey: ['milestones', projectId] }),
        qc.invalidateQueries({ queryKey: ['milestones-upcoming', projectId] }),
        qc.invalidateQueries({ queryKey: ['tasks'] }),
        qc.invalidateQueries({ queryKey: ['subtasks'] }),
        qc.invalidateQueries({ queryKey: ['task', targetTask.id] }),
        qc.invalidateQueries({ queryKey: ['gantt'] }),
      ]);
      onMilestoneUpdated();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setTaskSubtasksModalError(
          err.details && err.details.length > 0
            ? err.details.join(' ')
            : err.message || 'No se pudo completar la tarea ni sus subtareas.',
        );
      } else {
        setTaskSubtasksModalError('Error inesperado al completar las subtareas y la tarea.');
      }
      await refetch();
    } finally {
      setIsConfirmingTaskSubtasks(false);
    }
  };

  const handleDisassociateTask = async (taskId: string) => {
    setActionError(null);
    setActionSuccess(null);
    setDisassociatingTaskId(taskId);
    try {
      await api.disassociateMilestoneTask(milestoneId, taskId);
      await Promise.all([
        refetch(),
        qc.invalidateQueries({ queryKey: ['milestones', projectId] }),
        qc.invalidateQueries({ queryKey: ['milestones-upcoming', projectId] }),
        qc.invalidateQueries({ queryKey: ['all-tasks-for-milestone', projectId] }),
        qc.invalidateQueries({ queryKey: ['tasks'] }),
        qc.invalidateQueries({ queryKey: ['task', taskId] }),
        qc.invalidateQueries({ queryKey: ['gantt'] }),
      ]);
      onMilestoneUpdated();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setActionError(
          err.details && err.details.length > 0
            ? err.details.join(' ')
            : `Error (${err.status}): no se pudo desasociar la tarea.`,
        );
      } else {
        setActionError('Error inesperado al desasociar la tarea.');
      }
    } finally {
      setDisassociatingTaskId(null);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !isEditing &&
        !isDeleting &&
        !isSelectingTasks &&
        !isConfirmingJointComplete &&
        !taskPendingSubtasksConfirm
      ) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isOpen,
    isEditing,
    isDeleting,
    isSelectingTasks,
    isConfirmingJointComplete,
    taskPendingSubtasksConfirm,
    onClose,
  ]);

  if (!isOpen) return null;

  const associatedTasks = (milestone?.tasks ?? []).filter((t) => !t.parentTaskId);
  const pendingTasks = associatedTasks.filter((t) => t.status !== 'COMPLETED');
  const pendingRootTasksCount = pendingTasks.length;
  const pendingSubtasksCount = pendingTasks.reduce(
    (acc, t) => acc + Math.max(0, (t.subtaskCount ?? 0) - (t.completedSubtaskCount ?? 0)),
    0,
  );
  const isAlreadyCompleted =
    milestone?.status === 'COMPLETED' ||
    Boolean(milestone?.completedAt) ||
    (milestone !== undefined && milestone.taskCount > 0 && milestone.progress === 100 && Boolean(milestone.completedAt));

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="milestone-detail-title"
      >
        <div className="flex flex-col w-full max-w-3xl max-h-[90vh] rounded-xl border border-[#DEE5EC] bg-white shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-[#DEE5EC] p-5 bg-[#FAFCFD]">
            <div className="space-y-1 pr-4">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="milestone-detail-title" className="text-xl font-bold text-[#172B42]">
                  {milestone?.name || 'Cargando hito...'}
                </h2>
                {milestone && <MilestoneStatusBadge status={milestone.status} />}
              </div>
              {milestone && (
                <p className="text-xs text-[#607185]">
                  Fecha objetivo: <strong className="text-[#172B42]">{formatDate(milestone.dueDate)}</strong>
                  {milestone.creator && ` · Creado por ${milestone.creator.name}`}
                </p>
              )}
            </div>

            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 focus:outline-none p-1 rounded-md"
              aria-label="Cerrar modal de detalle"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {isLoading && (
              <div className="py-12 text-center text-sm text-[#607185]">
                Cargando información del hito...
              </div>
            )}

            {isError && (
              <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-200">
                No se pudo cargar el detalle del hito. Por favor intenta nuevamente.
              </div>
            )}

            {actionError && (
              <div
                role="alert"
                className="rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-200 flex justify-between items-center"
              >
                <span>{actionError}</span>
                <button
                  type="button"
                  onClick={() => setActionError(null)}
                  className="text-red-700 font-bold ml-2"
                  aria-label="Cerrar alerta de error"
                >
                  ✕
                </button>
              </div>
            )}

            {actionSuccess && (
              <div
                role="status"
                className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 border border-emerald-200 flex justify-between items-center"
              >
                <span>{actionSuccess}</span>
                <button
                  type="button"
                  onClick={() => setActionSuccess(null)}
                  className="text-emerald-800 font-bold ml-2"
                  aria-label="Cerrar confirmación"
                >
                  ✕
                </button>
              </div>
            )}

            {milestone && (
              <>
                {/* Descripción */}
                {milestone.description ? (
                  <div className="rounded-lg bg-gray-50/70 p-4 border border-[#DEE5EC]">
                    <h4 className="text-xs font-semibold text-[#607185] uppercase tracking-wider mb-1">
                      Descripción
                    </h4>
                    <p className="text-sm text-[#172B42] whitespace-pre-line leading-relaxed">
                      {milestone.description}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs italic text-[#607185]">Sin descripción definida.</p>
                )}

                {/* Métricas y Estado de Alcance */}
                <div className="rounded-xl border border-[#DEE5EC] bg-white p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-[#172B42]">Progreso del hito</h4>
                    {milestone.completedAt ? (
                      <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                        {milestone.completedBy
                          ? `✓ Confirmado el ${formatDate(milestone.completedAt)} por ${milestone.completedBy.name}`
                          : `✓ Alcanzado automáticamente el ${formatDate(milestone.completedAt)}`}
                      </span>
                    ) : (
                      <span className="text-xs text-[#607185]">
                        Se completa automáticamente al alcanzar el 100% de sus tareas principales
                      </span>
                    )}
                  </div>

                  <MilestoneProgressBar
                    progress={milestone.progress}
                    completedTasks={milestone.completedTaskCount}
                    totalTasks={milestone.taskCount}
                  />
                </div>

                {/* Barra de Acciones de Gestión */}
                {canManage && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#DEE5EC]">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setIsSelectingTasks(true)}
                        className="rounded-lg bg-[#245B78] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1b445a] flex items-center gap-1.5"
                      >
                        + Vincular tareas
                      </button>

                      {isAlreadyCompleted ? (
                        <button
                          type="button"
                          onClick={() => reopenMutation.mutate()}
                          disabled={reopenMutation.isPending}
                          title="Reabre manualmente el hito sin modificar el estado de sus tareas"
                          className="rounded-lg border border-[#DEE5EC] bg-white px-3.5 py-1.5 text-xs font-medium text-[#172B42] hover:bg-gray-50 disabled:opacity-50"
                        >
                          {reopenMutation.isPending ? 'Reabriendo...' : 'Reabrir hito'}
                        </button>
                      ) : pendingTasks.length > 0 ? (
                        <button
                          type="button"
                          data-testid="btn-joint-complete-milestone"
                          onClick={() => {
                            setActionError(null);
                            setIsConfirmingJointComplete(true);
                          }}
                          disabled={completeMutation.isPending || completeWithTasksMutation.isPending}
                          title="Completa el hito junto con todas sus tareas principales pendientes y sus subtareas"
                          className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {completeWithTasksMutation.isPending ? 'Finalizando...' : 'Finalizar hito y tareas'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => completeMutation.mutate()}
                          disabled={completeMutation.isPending || completeWithTasksMutation.isPending}
                          title="Marca el hito como alcanzado"
                          className="rounded-lg border border-emerald-600 bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          {completeMutation.isPending ? 'Confirmando...' : 'Marcar como alcanzado'}
                        </button>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setIsEditing(true)}
                        className="rounded-lg border border-[#DEE5EC] bg-white px-3 py-1.5 text-xs font-medium text-[#172B42] hover:bg-gray-50"
                      >
                        Editar hito
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsDeleting(true)}
                        className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                )}

                {/* Sección de Tareas Principales Asociadas (KAN-248 / KAN-249) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-[#172B42]">
                      {`Tareas vinculadas (${associatedTasks.length})`}
                    </h4>
                  </div>

                  {associatedTasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#DEE5EC] p-8 text-center space-y-2">
                      <p className="text-sm text-[#607185]">
                        No hay tareas principales asociadas a este hito todavía.
                      </p>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => setIsSelectingTasks(true)}
                          className="rounded-lg border border-[#DEE5EC] bg-white px-3 py-1.5 text-xs font-medium text-[#245B78] hover:bg-gray-50"
                        >
                          Vincular primera tarea
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="divide-y divide-[#DEE5EC] rounded-xl border border-[#DEE5EC] bg-white overflow-hidden">
                      {associatedTasks.map((task) => {
                        const isDisassociating = disassociatingTaskId === task.id;
                        const isToggling = Boolean(togglingTaskIds[task.id]);
                        const canToggle = canUserToggleTask(task);
                        const isCompleted = task.status === 'COMPLETED';
                        const statusLabel = taskStatusLabels[task.status] ?? task.status;
                        const statusStyle =
                          TASK_STATUS_BADGE_STYLES[task.status] ?? TASK_STATUS_BADGE_STYLES.PENDING;
                        const hasSubtasks = (task.subtaskCount ?? 0) > 0;
                        const subtaskProgressPct = hasSubtasks
                          ? Math.round(((task.completedSubtaskCount ?? 0) / (task.subtaskCount ?? 1)) * 100)
                          : 0;

                        return (
                          <div
                            key={task.id}
                            className="flex items-center justify-between gap-3 p-3.5 hover:bg-[#F8FAFC] transition-colors"
                          >
                            <div className="flex items-start gap-3 min-w-0 flex-1">
                              {/* Checkbox sincronizado con el estado de la tarea (KAN-249) */}
                              <div className="pt-0.5 shrink-0">
                                <input
                                  type="checkbox"
                                  id={`milestone-task-checkbox-${task.id}`}
                                  aria-label={`Marcar tarea ${task.title} como completada`}
                                  checked={isCompleted}
                                  disabled={!canToggle || isToggling || isDisassociating}
                                  onChange={() => void handleToggleTaskCheckbox(task)}
                                  title={
                                    !canToggle
                                      ? 'No tenés permisos para cambiar el estado de esta tarea'
                                      : isCompleted
                                        ? 'Desmarcar para volver a Pendiente'
                                        : 'Marcar como Completada'
                                  }
                                  className="h-4 w-4 rounded border-[#DEE5EC] text-[#245B78] focus:ring-[#245B78] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                                />
                              </div>

                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <label
                                    htmlFor={`milestone-task-checkbox-${task.id}`}
                                    className={`text-sm font-medium truncate max-w-md cursor-pointer ${
                                      isCompleted ? 'line-through text-[#607185]' : 'text-[#172B42]'
                                    }`}
                                    title={task.title}
                                  >
                                    {task.title}
                                  </label>

                                  {/* Badge de estado real legible (KAN-248) */}
                                  <span
                                    data-task-status={task.status}
                                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusStyle}`}
                                  >
                                    {statusLabel}
                                  </span>

                                  {/* Progreso de subtareas cuando corresponda (KAN-248) */}
                                  {hasSubtasks && (
                                    <span
                                      className="rounded-full bg-[#EAF2F7] px-2 py-0.5 text-[10px] font-medium text-[#245B78]"
                                      title={`Subtareas completadas: ${task.completedSubtaskCount ?? 0} de ${task.subtaskCount} (${subtaskProgressPct}%)`}
                                    >
                                      {`Subtareas: ${task.completedSubtaskCount ?? 0}/${task.subtaskCount} (${subtaskProgressPct}%)`}
                                    </span>
                                  )}

                                  {isToggling && (
                                    <span className="text-[10px] text-[#607185] italic">
                                      Actualizando estado…
                                    </span>
                                  )}
                                </div>

                                <div className="flex flex-wrap items-center gap-3 text-xs text-[#607185]">
                                  {task.dueDate && <span>Vencimiento: {formatDate(task.dueDate)}</span>}
                                  {task.assignedTo && <span>Responsable: {task.assignedTo.name}</span>}
                                </div>
                              </div>
                            </div>

                            {/* Desasociar Tarea */}
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => void handleDisassociateTask(task.id)}
                                disabled={isDisassociating || isToggling}
                                className="shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-red-700 disabled:opacity-50"
                                title="Desasociar del hito (la tarea permanecerá intacta en el proyecto)"
                              >
                                {isDisassociating ? 'Desasociando...' : 'Desasociar'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end border-t border-[#DEE5EC] p-4 bg-gray-50">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] hover:bg-gray-100"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>

      {/* Modal de confirmación para completar una tarea con subtareas pendientes (Sección 2) */}
      <CompleteTaskWithSubtasksModal
        open={Boolean(taskPendingSubtasksConfirm)}
        taskTitle={taskPendingSubtasksConfirm?.title}
        pendingSubtaskCount={
          taskPendingSubtasksConfirm
            ? Math.max(
                0,
                (taskPendingSubtasksConfirm.subtaskCount ?? 0) -
                  (taskPendingSubtasksConfirm.completedSubtaskCount ?? 0),
              )
            : undefined
        }
        isConfirming={isConfirmingTaskSubtasks}
        errorMessage={taskSubtasksModalError}
        onCancel={() => {
          if (isConfirmingTaskSubtasks) return;
          setTaskPendingSubtasksConfirm(null);
          setTaskSubtasksModalError(null);
        }}
        onConfirm={() => void handleConfirmCompleteTaskWithSubtasks()}
      />

      {/* Modal de confirmación para Finalización Conjunta (KAN-250 / Sección 4) */}
      {isConfirmingJointComplete && milestone && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="joint-complete-modal-title"
          data-testid="joint-complete-modal"
        >
          <div className="w-full max-w-md rounded-xl border border-[#DEE5EC] bg-white p-6 shadow-xl space-y-4">
            <h3 id="joint-complete-modal-title" className="text-lg font-bold text-[#172B42]">
              ¿Completar el hito y todas sus tareas?
            </h3>
            <p className="text-sm text-[#607185] leading-relaxed">
              Se marcarán como completadas todas las tareas pendientes de este hito y, si corresponde, sus subtareas pendientes. Esta acción cambiará el estado de esas tareas.
            </p>

            <div className="rounded-lg border border-[#DEE5EC] bg-[#F8FAFC] p-3 text-xs text-[#172B42] space-y-1">
              <div className="flex justify-between">
                <span className="text-[#607185]">Tareas principales afectadas:</span>
                <strong data-testid="joint-complete-root-count">{`${pendingRootTasksCount}`}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-[#607185]">Subtareas pendientes afectadas:</span>
                <strong data-testid="joint-complete-subtask-count">{`${pendingSubtasksCount}`}</strong>
              </div>
            </div>

            <div className="max-h-40 overflow-y-auto rounded-lg border border-[#DEE5EC] bg-[#F8FAFC] p-3 space-y-1.5">
              {pendingTasks.map((t) => {
                const subPending = Math.max(0, (t.subtaskCount ?? 0) - (t.completedSubtaskCount ?? 0));
                return (
                  <div key={t.id} className="flex items-center justify-between gap-2 text-xs text-[#172B42]">
                    <span className="truncate font-medium">
                      {`• ${t.title}`}
                      {subPending > 0 ? ` (+${subPending} subtarea/s)` : ''}
                    </span>
                    <span className="shrink-0 text-[10px] text-[#607185]">
                      {`${taskStatusLabels[t.status] ?? t.status} → Completada`}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsConfirmingJointComplete(false)}
                disabled={completeWithTasksMutation.isPending}
                className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-xs font-medium text-[#172B42] hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                data-testid="btn-confirm-joint-complete"
                onClick={() => completeWithTasksMutation.mutate()}
                disabled={completeWithTasksMutation.isPending}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {completeWithTasksMutation.isPending ? 'Completando...' : 'Sí, completar todo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-modales de Edición, Eliminación y Selector de Tareas */}
      {isEditing && milestone && (
        <MilestoneFormModal
          isOpen={isEditing}
          onClose={() => setIsEditing(false)}
          projectId={projectId}
          milestoneToEdit={milestone}
          onSuccess={() => {
            void refetch();
            onMilestoneUpdated();
          }}
        />
      )}

      {isDeleting && milestone && (
        <MilestoneDeleteModal
          isOpen={isDeleting}
          onClose={() => setIsDeleting(false)}
          milestone={milestone}
          onSuccess={() => {
            onClose();
            onMilestoneUpdated();
          }}
        />
      )}

      {isSelectingTasks && milestone && (
        <MilestoneTaskSelectorModal
          isOpen={isSelectingTasks}
          onClose={() => setIsSelectingTasks(false)}
          milestone={milestone}
          onTaskAssociated={() => {
            void refetch();
            onMilestoneUpdated();
          }}
        />
      )}
    </>
  );
}
