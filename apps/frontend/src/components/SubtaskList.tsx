import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Pagination } from './Pagination';
import type { TaskStatus } from '@tema/shared-types';

interface SubtaskListProps {
  parentTaskId: string;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  IN_REVIEW: 'En revisión',
  COMPLETED: 'Completada',
  BLOCKED: 'Bloqueada',
};

export function SubtaskList({ parentTaskId }: SubtaskListProps) {
  const [page, setPage] = useState(1);

  const { data: response, isLoading, isError } = useQuery({
    queryKey: ['subtasks', parentTaskId, page],
    queryFn: () => api.getSubtasks(parentTaskId, page, 5),
    placeholderData: keepPreviousData,
  });

  if (isLoading) {
    return <p className="text-sm text-[#607185]">Cargando subtareas...</p>;
  }

  if (isError) {
    return <p className="text-sm text-red-600">Error al cargar las subtareas.</p>;
  }

  const subtasks = response?.data ?? [];

  if (subtasks.length === 0 && page === 1) {
    return <p className="text-sm italic text-[#607185]">Todavía no hay subtareas.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
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
            </div>
          </li>
        ))}
      </ul>

      <Pagination
        page={page}
        totalPages={response?.totalPages ?? 1}
        onPageChange={setPage}
      />
    </div>
  );
}