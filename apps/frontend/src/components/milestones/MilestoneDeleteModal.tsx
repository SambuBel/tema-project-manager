import { useState, useEffect } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import type { MilestoneSummaryDto } from '@tema/shared-types';

interface MilestoneDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  milestone: MilestoneSummaryDto | null;
  onSuccess: () => void;
}

export function MilestoneDeleteModal({
  isOpen,
  onClose,
  milestone,
  onSuccess,
}: MilestoneDeleteModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);


  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !milestone) return null;

  const handleDelete = async () => {
    setIsDeleting(true);
    setErrorMessage(null);

    try {
      await api.deleteMilestone(milestone.id);
      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.details && err.details.length > 0) {
          setErrorMessage(err.details.join(' '));
        } else {
          setErrorMessage(`Error (${err.status}): no se pudo eliminar el hito.`);
        }
      } else {
        setErrorMessage('Ocurrió un error inesperado al eliminar el hito.');
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-milestone-title"
    >
      <div className="w-full max-w-md rounded-xl border border-[#DEE5EC] bg-white p-6 shadow-xl">
        <h2 id="delete-milestone-title" className="text-lg font-semibold text-rose-700">
          ¿Eliminar hito «{milestone.name}»?
        </h2>

        <div className="mt-3 space-y-2 text-sm text-[#607185]">
          <p>
            Esta acción eliminará el hito del proyecto de forma lógica para conservar trazabilidad.
          </p>
          <div className="rounded-lg bg-amber-50 p-3 text-amber-800 border border-amber-200">
            <strong>Importante:</strong> Las tareas asociadas ({milestone.taskCount}) <span className="underline">no se eliminarán</span> ni se alterarán sus estados; simplemente quedarán desvinculadas de este hito y continuarán en el proyecto.
          </div>
        </div>

        {errorMessage && (
          <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-200">
            {errorMessage}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50 flex items-center gap-2"
          >
            {isDeleting && (
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}
            Eliminar hito
          </button>
        </div>
      </div>
    </div>
  );
}
