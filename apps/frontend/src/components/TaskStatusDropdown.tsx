import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../lib/api';
import { taskStatusLabels, VALID_TRANSITIONS } from '../types/task';
import type { TaskStatus } from '../types/task';
import {
  CompleteTaskWithSubtasksModal,
  isPendingSubtasksCompletionError,
} from './CompleteTaskWithSubtasksModal';

const statusBadgeColors: Record<TaskStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-700',
  IN_PROGRESS: 'bg-blue-50 text-blue-700',
  IN_REVIEW: 'bg-purple-50 text-purple-700',
  BLOCKED: 'bg-red-50 text-red-700',
  COMPLETED: 'bg-green-50 text-green-700',
};

const statusDotColors: Record<TaskStatus, string> = {
  PENDING: 'bg-gray-400',
  IN_PROGRESS: 'bg-blue-500',
  IN_REVIEW: 'bg-purple-500',
  BLOCKED: 'bg-red-500',
  COMPLETED: 'bg-green-500',
};

interface TaskStatusDropdownProps {
  taskId: string;
  currentStatus: TaskStatus;
  /** canEditTaskUI del usuario actual. Sin permiso se muestra solo el badge, sin control interactivo. */
  canChange: boolean;
  taskTitle?: string;
}

/**
 * Badge de estado clickeable.
 */
export function TaskStatusDropdown({
  taskId,
  currentStatus,
  canChange,
  taskTitle,
}: TaskStatusDropdownProps) {
  const [open, setOpen] = useState(false);
  const [showCompleteSubtasksModal, setShowCompleteSubtasksModal] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const validTargets = VALID_TRANSITIONS[currentStatus];

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const invalidateAllViews = () => {
    void qc.invalidateQueries({ queryKey: ['task'] });
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['subtasks'] });
    void qc.invalidateQueries({ queryKey: ['milestones'] });
    void qc.invalidateQueries({ queryKey: ['milestones-upcoming'] });
    void qc.invalidateQueries({ queryKey: ['milestone-detail'] });
    void qc.invalidateQueries({ queryKey: ['gantt'] });
  };

  const mutation = useMutation({
    mutationFn: (newStatus: TaskStatus) => api.updateTaskStatus(taskId, newStatus),
    onSuccess: () => {
      invalidateAllViews();
      setOpen(false);
    },
    onError: (err, attemptedStatus) => {
      setOpen(false);
      if (attemptedStatus === 'COMPLETED' && isPendingSubtasksCompletionError(err)) {
        mutation.reset();
        setModalError(null);
        setShowCompleteSubtasksModal(true);
      }
    },
  });

  const confirmSubtasksMutation = useMutation({
    mutationFn: () => api.updateTaskStatus(taskId, 'COMPLETED', { completeSubtasks: true }),
    onSuccess: () => {
      setShowCompleteSubtasksModal(false);
      setModalError(null);
      setSuccessMessage('Se completaron las subtareas pendientes y la tarea principal.');
      invalidateAllViews();
    },
    onError: (err) => {
      if (err instanceof ApiRequestError) {
        setModalError(
          err.details && err.details.length > 0
            ? err.details.join(' ')
            : err.message || 'No se pudo completar la tarea ni sus subtareas.',
        );
      } else {
        setModalError('Error al completar las subtareas y la tarea principal.');
      }
    },
  });

  useEffect(() => {
    if (mutation.error && !showCompleteSubtasksModal) {
      const timer = setTimeout(() => {
        mutation.reset();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [mutation.error, showCompleteSubtasksModal]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  if (!canChange || validTargets.length === 0) {
    return (
      <span
        className={`rounded-full px-3 py-1 text-xs font-medium ${statusBadgeColors[currentStatus]}`}
        title={canChange ? 'Estado final — no se puede cambiar' : undefined}
      >
        {taskStatusLabels[currentStatus]}
      </span>
    );
  }

  const errorMessage =
    mutation.error && !isPendingSubtasksCompletionError(mutation.error)
      ? mutation.error instanceof ApiRequestError
        ? mutation.error.details[0] || 'Error al cambiar estado'
        : 'Error al cambiar estado'
      : null;

  return (
    <div className="relative" ref={ref}>
      {/* Badge */}
      <button
        onClick={() => {
          setOpen(!open);
          mutation.reset();
        }}
        disabled={mutation.isPending || confirmSubtasksMutation.isPending}
        className={`rounded-full px-3 py-1.3 text-sm font-medium transition-all ${statusBadgeColors[currentStatus]} ${
          mutation.isPending || confirmSubtasksMutation.isPending
            ? 'opacity-50 cursor-wait'
            : 'cursor-pointer hover:ring-2 hover:ring-[#245B78]/30'
        } border border-[#DEE5EC]`}
      >
        {mutation.isPending || confirmSubtasksMutation.isPending
          ? 'Cambiando…'
          : taskStatusLabels[currentStatus]}
        {!mutation.isPending && !confirmSubtasksMutation.isPending && (
          <span className="ml-1 text-xs">▾</span>
        )}
      </button>

      {/* Dropdown con transiciones válidas */}
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1.5 min-w-[200px] rounded-lg border border-[#DEE5EC] bg-white py-1 shadow-lg">
          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#607185]">
            Cambiar estado a
          </p>
          {validTargets.map((target) => (
            <button
              key={target}
              onClick={() => mutation.mutate(target)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-[#172B42] transition-colors hover:bg-[#EAF2F7]"
            >
              <span className={`inline-block h-2 w-2 rounded-full ${statusDotColors[target]}`} />
              {taskStatusLabels[target]}
            </button>
          ))}
        </div>
      )}

      {/* Error inline */}
      {errorMessage && !open && (
        <div className="absolute left-0 top-full z-20 mt-1.5 max-w-xs rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 shadow-md">
          {errorMessage}
        </div>
      )}

      {/* Confirmación inline de éxito */}
      {successMessage && !open && (
        <div
          role="status"
          className="absolute left-0 top-full z-20 mt-1.5 max-w-xs rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 shadow-md"
        >
          {successMessage}
        </div>
      )}

      <CompleteTaskWithSubtasksModal
        open={showCompleteSubtasksModal}
        taskTitle={taskTitle}
        isConfirming={confirmSubtasksMutation.isPending}
        errorMessage={modalError}
        onCancel={() => {
          if (confirmSubtasksMutation.isPending) return;
          setShowCompleteSubtasksModal(false);
          setModalError(null);
        }}
        onConfirm={() => confirmSubtasksMutation.mutate()}
      />
    </div>
  );
}
