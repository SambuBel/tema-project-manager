import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { TaskStatus } from '@tema/shared-types';
import { ConfirmDialog } from './ConfirmDialog';

interface SubtaskListProps {
  parentTaskId: string;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  IN_REVIEW: 'En revisión',
  COMPLETED: 'Completada',
  BLOCKED: 'Bloqueada',
  CANCELLED: 'Cancelada',
};

export function SubtaskList({ parentTaskId }: SubtaskListProps) {
  const qc = useQueryClient();
  const [toArchive, setToArchive] = useState<{ id: string; title: string } | null>(null);

  const { data: subtasks, isLoading, isError } = useQuery({
    queryKey: ['subtasks', parentTaskId],
    queryFn: () => api.getSubtasks(parentTaskId),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.archiveTask(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['subtasks', parentTaskId] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      setToArchive(null);
    },
  });

  if (isLoading) {
    return <p className="text-sm text-[#607185]">Cargando subtareas...</p>;
  }

  if (isError) {
    return <p className="text-sm text-red-600">Error al cargar las subtareas.</p>;
  }

  if (!subtasks || subtasks.length === 0) {
    return <p className="text-sm italic text-[#607185]">Todavía no hay subtareas.</p>;
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {subtasks.map((subtask) => (
          <li
            key={subtask.id}
            className="flex items-center justify-between rounded-lg border border-[#DEE5EC] px-4 py-2.5 text-sm"
          >
            <span className={subtask.status === 'COMPLETED' ? 'line-through text-[#607185]' : 'text-[#172B42]'}>
              {subtask.title}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#607185]">{STATUS_LABELS[subtask.status]}</span>
              <Link to={`/tasks/${subtask.id}/edit`} className="text-xs font-medium underline">
                Editar
              </Link>
              <button
                type="button"
                onClick={() => setToArchive({ id: subtask.id, title: subtask.title })}
                className="text-xs font-medium text-red-600 underline"
              >
                Eliminar
              </button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={!!toArchive}
        title={`¿Eliminar "${toArchive?.title}"?`}
        description="La subtarea se archiva y deja de verse en la lista. No se pierde la información, pero esta acción no se puede deshacer desde acá."
        confirmLabel="Eliminar"
        variant="danger"
        isConfirming={archive.isPending}
        onConfirm={() => toArchive && archive.mutate(toArchive.id)}
        onCancel={() => setToArchive(null)}
      />
    </>
  );
}
