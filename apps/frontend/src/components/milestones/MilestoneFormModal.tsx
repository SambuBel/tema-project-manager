import { useState, useEffect } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import type { MilestoneSummaryDto, CreateMilestoneDto, UpdateMilestoneDto } from '@tema/shared-types';

interface MilestoneFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  milestoneToEdit?: MilestoneSummaryDto | null;
  onSuccess: (savedMilestone: MilestoneSummaryDto) => void;
}

export function MilestoneFormModal({
  isOpen,
  onClose,
  projectId,
  milestoneToEdit,
  onSuccess,
}: MilestoneFormModalProps) {
  const isEditing = Boolean(milestoneToEdit);

  const [name, setName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (milestoneToEdit) {
        setName(milestoneToEdit.name);
        setDueDate(milestoneToEdit.dueDate ? milestoneToEdit.dueDate.slice(0, 10) : '');
        setDescription(milestoneToEdit.description || '');
      } else {
        setName('');
        setDueDate('');
        setDescription('');
      }
      setErrorMessage(null);
      setIsSubmitting(false);
    }
  }, [isOpen, milestoneToEdit]);


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

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMessage('El nombre del hito es obligatorio.');
      return;
    }
    if (trimmedName.length > 100) {
      setErrorMessage('El nombre del hito no puede superar los 100 caracteres.');
      return;
    }
    if (!dueDate) {
      setErrorMessage('La fecha objetivo es obligatoria.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEditing && milestoneToEdit) {
        const dto: UpdateMilestoneDto = {
          name: trimmedName,
          dueDate,
          description: description.trim() ? description.trim() : undefined,
        };
        const updated = await api.updateMilestone(milestoneToEdit.id, dto);
        onSuccess(updated);
        onClose();
      } else {
        const dto: CreateMilestoneDto = {
          name: trimmedName,
          dueDate,
          description: description.trim() ? description.trim() : undefined,
        };
        const created = await api.createMilestone(projectId, dto);
        onSuccess(created);
        onClose();
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.status === 409) {
          setErrorMessage('Ya existe un hito activo con ese nombre en este proyecto (los nombres deben ser únicos).');
        } else if (err.details && err.details.length > 0) {
          setErrorMessage(err.details.join(' '));
        } else {
          setErrorMessage(`Error (${err.status}): no se pudo guardar el hito.`);
        }
      } else {
        setErrorMessage('Ocurrió un error inesperado al guardar el hito.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="milestone-modal-title"
    >
      <div className="w-full max-w-md rounded-xl border border-[#DEE5EC] bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-[#DEE5EC] pb-3">
          <h2 id="milestone-modal-title" className="text-lg font-semibold text-[#172B42]">
            {isEditing ? 'Editar Hito' : 'Nuevo Hito'}
          </h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-gray-400 hover:text-gray-600 focus:outline-none"
            aria-label="Cerrar modal"
          >
            ✕
          </button>
        </div>

        {errorMessage && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-200">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="milestone-name" className="block text-sm font-medium text-[#172B42]">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              id="milestone-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="Ej. Entrega Fase 1, MVP Beta..."
              disabled={isSubmitting}
              className="mt-1 w-full rounded-lg border border-[#DEE5EC] px-3 py-2 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none"
              autoFocus
            />
            <p className="mt-1 text-xs text-[#607185]">Máximo 200 caracteres.</p>
          </div>

          <div>
            <label htmlFor="milestone-due-date" className="block text-sm font-medium text-[#172B42]">
              Fecha objetivo <span className="text-red-500">*</span>
            </label>
            <input
              id="milestone-due-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={isSubmitting}
              className="mt-1 w-full rounded-lg border border-[#DEE5EC] px-3 py-2 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="milestone-description" className="block text-sm font-medium text-[#172B42]">
              Descripción (opcional)
            </label>
            <textarea
              id="milestone-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Detalles sobre los entregables o alcance de este hito..."
              disabled={isSubmitting}
              className="mt-1 w-full rounded-lg border border-[#DEE5EC] px-3 py-2 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-[#DEE5EC]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1b445a] disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting && (
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              {isEditing ? 'Guardar cambios' : 'Crear hito'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
