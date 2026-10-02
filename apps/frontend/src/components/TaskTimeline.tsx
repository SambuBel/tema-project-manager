import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { TaskTimelineItem, taskStatusLabels, taskPriorityLabels } from '../types/task';
import type { TaskPriority, TaskStatus } from '../types/task';

interface TaskTimelineProps {
  taskId: string;
}

function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return 'hace un momento';
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `hace ${diffInMinutes} minuto${diffInMinutes === 1 ? '' : 's'}`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `hace ${diffInHours} hora${diffInHours === 1 ? '' : 's'}`;
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 30) return `hace ${diffInDays} día${diffInDays === 1 ? '' : 's'}`;
  return date.toLocaleDateString('es-ES');
}

const FIELD_LABELS: Record<string, { name: string, prefix: string }> = {
  priority: { name: 'prioridad', prefix: 'la' },
  status: { name: 'estado', prefix: 'el' },
  assignedToId: { name: 'responsable', prefix: 'el' },
  title: { name: 'título', prefix: 'el' },
  description: { name: 'descripción', prefix: 'la' },
  startDate: { name: 'fecha de inicio', prefix: 'la' },
  dueDate: { name: 'fecha de vencimiento', prefix: 'la' },
  archivedAt: { name: 'archivado', prefix: 'el' }
};

const mapStatus = (status: any) => {
  if (status === 'IN_PROGRESS') return 'En progreso';
  return taskStatusLabels[status as TaskStatus] || status;
};

const mapPriority = (priority: any) => {
  return taskPriorityLabels[priority as TaskPriority] || priority;
};

const formatValue = (field: string, value: any) => {
  if (value === null || value === undefined || value === '') return 'ninguno';
  if (field === 'status') return mapStatus(value);
  if (field === 'priority') return mapPriority(value);
  if (field === 'startDate' || field === 'dueDate') {
    try {
      // Intentar forzar la interpretacin de fecha y verificar si es vlida
      const d = new Date(value);
      if (isNaN(d.getTime())) return value;
      return d.toLocaleDateString('es-ES');
    } catch {
      return value;
    }
  }
  return value;
};

export function TaskTimeline({ taskId }: TaskTimelineProps) {
  const qc = useQueryClient();
  const [newComment, setNewComment] = useState('');

  const { data: timeline, isLoading } = useQuery({
    queryKey: ['task', taskId, 'timeline'],
    queryFn: () => api.getTaskTimeline(taskId),
  });

  const addCommentMutation = useMutation({
    mutationFn: (content: string) => api.addTaskComment(taskId, content),
    onSuccess: () => {
      setNewComment('');
      void qc.invalidateQueries({ queryKey: ['task', taskId, 'timeline'] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newComment.trim()) {
      addCommentMutation.mutate(newComment.trim());
    }
  };

  const renderHistoryChanges = (item: TaskTimelineItem) => {
    if (item.actionType === 'TASK_CREATED') {
      return <div className="text-[#607185]">Creó la tarea</div>;
    }
    if (item.actionType === 'TASK_DELETED') {
      return <div className="text-[#607185]">Archivó la tarea</div>;
    }
    if (item.actionType === 'TASK_UPDATED') {
      const changes = item.metadata?.changes;
      if (!changes || Object.keys(changes).length === 0) {
        return <div className="text-[#607185]">Actualizó la tarea</div>;
      }
      
      return (
        <div className="flex flex-col gap-1 text-[#607185]">
          {Object.entries(changes).map(([field, vals]: [string, any]) => {
            const info = FIELD_LABELS[field] || { name: field, prefix: 'el' };
            if (field === 'assignedToId') {
              return <div key={field}>Cambió el responsable</div>;
            }
            if (field === 'description') {
              return <div key={field}>Cambió la descripción</div>;
            }
            const oldStr = formatValue(field, vals.old);
            const newStr = formatValue(field, vals.new);
            return (
              <div key={field}>
                Cambió {info.prefix} {info.name} de {oldStr} a {newStr}
              </div>
            );
          })}
        </div>
      );
    }
    return <div className="text-[#607185]">Realizó un cambio</div>;
  };

  if (isLoading) {
    return <div className="text-sm text-[#607185]">Cargando línea de tiempo...</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {timeline?.length === 0 ? (
          <p className="text-sm italic text-[#607185]">No hay actividad registrada.</p>
        ) : (
          timeline?.map((item: TaskTimelineItem) => (
            <div
              key={item.id}
              className="rounded-xl border border-[#DEE5EC] bg-white p-4 shadow-sm"
            >
              {/* Header: avatar + nombre + tiempo + chip */}
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EAF2F7] text-xs font-semibold text-[#245B78]">
                  {item.actor.avatar}
                </div>
                <span className="font-medium text-sm text-[#172B42]">{item.actor.name}</span>
                <span className="text-xs text-[#607185]">{formatRelativeTime(item.createdAt)}</span>
                {item.type === 'COMMENT' ? (
                  <span className="ml-auto text-[10px] uppercase font-bold tracking-wide text-[#245B78] bg-[#EAF2F7] px-2 py-0.5 rounded-full">
                    Comentario
                  </span>
                ) : (
                  <span className="ml-auto text-[10px] uppercase font-bold tracking-wide text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    Actividad
                  </span>
                )}
              </div>

              {/* Cuerpo */}
              {item.type === 'COMMENT' ? (
                <div className="text-sm text-[#172B42] leading-relaxed pl-11">
                  {item.content}
                </div>
              ) : (
                <div className="pl-11 text-sm">
                  {renderHistoryChanges(item)}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Escribí un comentario..."
          className="w-full resize-none rounded-lg border border-[#DEE5EC] bg-white p-3 text-sm text-[#172B42] placeholder:text-[#607185] focus:border-[#245B78] focus:outline-none focus:ring-1 focus:ring-[#245B78]"
          rows={3}
        />
        <button
          type="submit"
          disabled={!newComment.trim() || addCommentMutation.isPending}
          className="self-end rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1A4258] disabled:opacity-50"
        >
          {addCommentMutation.isPending ? 'Enviando...' : 'Comentar'}
        </button>
      </form>
    </div>
  );
}
