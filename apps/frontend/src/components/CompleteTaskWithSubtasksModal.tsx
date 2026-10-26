import { useEffect } from 'react';

export interface CompleteTaskWithSubtasksModalProps {
  open: boolean;
  taskTitle?: string;
  pendingSubtaskCount?: number;
  isConfirming?: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Detecta si un error devuelto por la API corresponde a la restricción RN-04
 * ("No se puede completar una tarea con subtareas pendientes").
 */
export function isPendingSubtasksCompletionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const details = Array.isArray((err as { details?: unknown }).details)
    ? ((err as { details: unknown[] }).details.filter((d) => typeof d === 'string') as string[]).join(' ')
    : '';
  const message = typeof (err as { message?: unknown }).message === 'string' ? (err as { message: string }).message : '';
  const combined = `${details} ${message}`.toLowerCase();
  return combined.includes('subtareas pendientes');
}

/**
 * Modal de confirmación reutilizable cuando el usuario intenta completar una tarea principal
 * que todavía posee subtareas pendientes.
 */
export function CompleteTaskWithSubtasksModal({
  open,
  taskTitle,
  pendingSubtaskCount,
  isConfirming = false,
  errorMessage = null,
  onCancel,
  onConfirm,
}: CompleteTaskWithSubtasksModalProps) {
  useEffect(() => {
    if (!open || isConfirming) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isConfirming, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="complete-with-subtasks-title"
      data-testid="complete-task-with-subtasks-modal"
    >
      <div className="w-full max-w-md rounded-xl border border-[#DEE5EC] bg-white p-6 shadow-xl space-y-4">
        <div className="space-y-1">
          <h3 id="complete-with-subtasks-title" className="text-lg font-bold text-[#172B42]">
            Esta tarea tiene subtareas pendientes
          </h3>
          {taskTitle && (
            <p className="text-xs font-medium text-[#245B78]">
              {`Tarea principal: «${taskTitle}»`}
              {typeof pendingSubtaskCount === 'number' && pendingSubtaskCount > 0
                ? ` · ${pendingSubtaskCount} ${pendingSubtaskCount === 1 ? 'subtarea pendiente' : 'subtareas pendientes'}`
                : ''}
            </p>
          )}
        </div>

        <p className="text-sm text-[#607185] leading-relaxed">
          Para completar esta tarea, primero deben completarse sus subtareas. ¿Querés marcar todas las subtareas pendientes como completadas y finalizar también la tarea principal?
        </p>

        {errorMessage && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700"
          >
            {errorMessage}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            data-testid="btn-cancel-complete-with-subtasks"
            onClick={onCancel}
            disabled={isConfirming}
            className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-xs font-medium text-[#172B42] hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            data-testid="btn-confirm-complete-with-subtasks"
            onClick={onConfirm}
            disabled={isConfirming}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {isConfirming ? 'Completando...' : 'Completar subtareas y tarea'}
          </button>
        </div>
      </div>
    </div>
  );
}
