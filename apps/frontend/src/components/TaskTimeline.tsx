import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { TaskTimelineItem } from '../types/task';

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
      qc.invalidateQueries({ queryKey: ['task', taskId, 'timeline'] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newComment.trim()) {
      addCommentMutation.mutate(newComment.trim());
    }
  };

  const getActionText = (item: TaskTimelineItem) => {
    switch (item.actionType) {
      case 'TASK_CREATED':
        return 'creó la tarea';
      case 'TASK_UPDATED':
        // Optional: you can show what changed using item.metadata.changes
        return 'actualizó la tarea';
      case 'TASK_DELETED':
        return 'archivó la tarea';
      default:
        return 'realizó un cambio';
    }
  };

  if (isLoading) {
    return <div className="text-sm text-[#607185]">Cargando línea de tiempo...</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        {timeline?.length === 0 ? (
          <p className="text-sm italic text-[#607185]">No hay actividad registrada.</p>
        ) : (
          timeline?.map((item: TaskTimelineItem) => (
            <div key={item.id} className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EAF2F7] text-xs font-semibold text-[#245B78]">
                {item.actor.avatar}
              </div>
              <div className="flex flex-col text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[#172B42]">{item.actor.name}</span>
                  <span className="text-xs text-[#607185]">
                    {formatRelativeTime(item.createdAt)}
                  </span>
                </div>
                {item.type === 'COMMENT' ? (
                  <div className="mt-1 rounded-lg bg-gray-50 p-3 text-[#172B42]">
                    {item.content}
                  </div>
                ) : (
                  <div className="mt-1 text-[#607185]">
                    {getActionText(item)}
                  </div>
                )}
              </div>
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
