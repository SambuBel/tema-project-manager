import { useEffect } from 'react';

export interface MoveTaskWithSubtasksModalProps {
  open: boolean;
  taskTitle?: string;
  subtaskCount?: number;
  targetStatusLabel?: string;
  isConfirming?: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Modal de confirmación cuando se mueve en el tablero una tarea principal que tiene subtareas:
 * las subtareas pasan al mismo estado que la tarea principal.
 */
export function MoveTaskWithSubtasksModal({
  open,
  taskTitle,
  subtaskCount,
  targetStatusLabel,
  isConfirming = false,
  errorMessage = null,
  onCancel,
  onConfirm,
}: MoveTaskWithSubtasksModalProps) {
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

  const plural = typeof subtaskCount === 'number' && subtaskCount !== 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-with-subtasks-title"
      data-testid="move-task-with-subtasks-modal"
    >
      <div className="w-full max-w-md rounded-xl border border-[#DEE5EC] bg-white p-6 shadow-xl space-y-4">
        <div className="space-y-1">
          <h3 id="move-with-subtasks-title" className="text-lg font-bold text-[#172B42]">
            Esta tarea tiene subtareas
          </h3>
          {taskTitle && (
            <p className="text-xs font-medium text-[#245B78]">
              {`Tarea principal: «${taskTitle}»`}
              {typeof subtaskCount === 'number' && subtaskCount > 0
                ? ` · ${subtaskCount} ${plural ? 'subtareas' : 'subtarea'}`
                : ''}
            </p>
          )}
        </div>

        <p className="text-sm text-[#607185] leading-relaxed">
          {`Al mover esta tarea${targetStatusLabel ? ` a «${targetStatusLabel}»` : ''}, sus subtareas también pasarán a ese estado. ¿Querés continuar?`}
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
            data-testid="btn-cancel-move-with-subtasks"
            onClick={onCancel}
            disabled={isConfirming}
            className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-xs font-medium text-[#172B42] hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            data-testid="btn-confirm-move-with-subtasks"
            onClick={onConfirm}
            disabled={isConfirming}
            className="rounded-lg bg-[#245B78] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1c4a62] disabled:opacity-50"
          >
            {isConfirming ? 'Moviendo...' : 'Mover tarea y subtareas'}
          </button>
        </div>
      </div>
    </div>
  );
}
