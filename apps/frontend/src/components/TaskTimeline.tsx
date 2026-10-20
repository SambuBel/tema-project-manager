import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { TaskTimelineItem, taskStatusLabels, taskPriorityLabels, CommentMention } from '../types/task';
import type { TaskPriority, TaskStatus } from '../types/task';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { MentionComposer } from './MentionComposer';
import { MentionContent } from './MentionContent';
import { ConfirmDialog } from './ConfirmDialog';
import { normalizeContentAndMentions } from '../lib/commentUtils';

interface TaskTimelineProps {
  taskId: string;
  projectId?: string;
  /** canCommentOnTaskUI del usuario actual. Sin permiso se oculta el composer (la lectura no cambia). */
  canComment: boolean;
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

const FIELD_LABELS: Record<string, { name: string; prefix: string }> = {
  priority: { name: 'prioridad', prefix: 'la' },
  status: { name: 'estado', prefix: 'el' },
  assignedToId: { name: 'responsable', prefix: 'el' },
  title: { name: 'título', prefix: 'el' },
  description: { name: 'descripción', prefix: 'la' },
  startDate: { name: 'fecha de inicio', prefix: 'la' },
  dueDate: { name: 'fecha de vencimiento', prefix: 'la' },
  archivedAt: { name: 'archivado', prefix: 'el' },
};

const mapStatus = (status: unknown) => {
  if (status === 'IN_PROGRESS') return 'En progreso';
  return taskStatusLabels[status as TaskStatus] || String(status ?? '');
};

const mapPriority = (priority: unknown) => {
  return taskPriorityLabels[priority as TaskPriority] || String(priority ?? '');
};

const formatValue = (field: string, value: unknown) => {
  if (value === null || value === undefined || value === '') return 'ninguno';
  if (field === 'status') return mapStatus(value);
  if (field === 'priority') return mapPriority(value);
  if (field === 'startDate' || field === 'dueDate') {
    try {
      const d = new Date(String(value));
      if (isNaN(d.getTime())) return String(value);
      return d.toLocaleDateString('es-ES');
    } catch {
      return String(value);
    }
  }
  return String(value);
};

export function TaskTimeline({ taskId, projectId, canComment }: TaskTimelineProps) {
  const qc = useQueryClient();
  const { user: currentUser } = useCurrentUser();

  // Estado para nuevo comentario
  const [newComment, setNewComment] = useState('');
  const [newMentions, setNewMentions] = useState<CommentMention[]>([]);
  const [addError, setAddError] = useState<string | null>(null);

  // Estado para edición de comentario (HM22)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentText, setEditCommentText] = useState('');
  const [editCommentMentions, setEditCommentMentions] = useState<CommentMention[]>([]);
  const [editError, setEditError] = useState<string | null>(null);

  // Estado para confirmación de eliminación (HM22)
  const [commentIdToDelete, setCommentIdToDelete] = useState<string | null>(null);

  // Consulta de miembros del proyecto para autocompletar menciones
  const { data: members = [] } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => (projectId ? api.getProjectMembers(projectId) : Promise.resolve([])),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });

  // Consulta de la línea de tiempo
  const { data: timeline, isLoading } = useQuery({
    queryKey: ['task', taskId, 'timeline'],
    queryFn: () => api.getTaskTimeline(taskId),
  });

  // Mutación para agregar comentario
  const addCommentMutation = useMutation({
    mutationFn: () => {
      const { content, mentions } = normalizeContentAndMentions(newComment, newMentions);
      return api.addTaskComment(taskId, content, mentions);
    },
    onSuccess: () => {
      setNewComment('');
      setNewMentions([]);
      setAddError(null);
      void qc.invalidateQueries({ queryKey: ['task', taskId, 'timeline'] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message;
      setAddError(msg || 'Error al enviar el comentario.');
    },
  });

  // Mutación para editar comentario (HM22)
  const updateCommentMutation = useMutation({
    mutationFn: () => {
      const { content, mentions } = normalizeContentAndMentions(editCommentText, editCommentMentions);
      return api.updateTaskComment(taskId, editingCommentId!, content, mentions);
    },
    onSuccess: () => {
      setEditingCommentId(null);
      setEditCommentText('');
      setEditCommentMentions([]);
      setEditError(null);
      void qc.invalidateQueries({ queryKey: ['task', taskId, 'timeline'] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message;
      setEditError(msg || 'Error al guardar los cambios del comentario.');
    },
  });

  // Mutación para eliminar comentario (HM22)
  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => api.deleteTaskComment(taskId, commentId),
    onSuccess: () => {
      setCommentIdToDelete(null);
      void qc.invalidateQueries({ queryKey: ['task', taskId, 'timeline'] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newComment.trim()) {
      addCommentMutation.mutate();
    }
  };

  const startEditComment = (item: TaskTimelineItem) => {
    setEditingCommentId(item.id);
    setEditCommentText(item.content || '');
    setEditCommentMentions(item.mentions ? [...item.mentions] : []);
    setEditError(null);
  };

  const cancelEditComment = () => {
    setEditingCommentId(null);
    setEditCommentText('');
    setEditCommentMentions([]);
    setEditError(null);
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
          {Object.entries(changes).map(([field, rawVals]) => {
            const vals = rawVals as { old?: unknown; new?: unknown } | null;
            const info = FIELD_LABELS[field] || { name: field, prefix: 'el' };
            if (field === 'assignedToId') {
              return <div key={field}>Cambió el responsable</div>;
            }
            if (field === 'description') {
              return <div key={field}>Cambió la descripción</div>;
            }
            const oldStr = formatValue(field, vals?.old);
            const newStr = formatValue(field, vals?.new);
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
          timeline?.map((item: TaskTimelineItem) => {
            const isAuthor = currentUser?.id === item.actor.id;
            const isEditing = editingCommentId === item.id;

            return (
              <div
                key={item.id}
                className="rounded-xl border border-[#DEE5EC] bg-white p-4 shadow-sm"
              >
                {/* Header: avatar + nombre + tiempo + badge editado + chip */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EAF2F7] text-xs font-semibold text-[#245B78]">
                    {item.actor.avatar}
                  </div>
                  <span className="font-medium text-sm text-[#172B42]">{item.actor.name}</span>
                  <span className="text-xs text-[#607185]">{formatRelativeTime(item.createdAt)}</span>
                  {item.type === 'COMMENT' && item.editedAt && (
                    <span className="text-xs text-[#607185] italic font-normal" title={`Editado el ${new Date(item.editedAt).toLocaleString('es-ES')}`}>
                      (editado)
                    </span>
                  )}

                  <div className="ml-auto flex items-center gap-2">
                    {item.type === 'COMMENT' ? (
                      <span className="text-[10px] uppercase font-bold tracking-wide text-[#245B78] bg-[#EAF2F7] px-2 py-0.5 rounded-full">
                        Comentario
                      </span>
                    ) : (
                      <span className="text-[10px] uppercase font-bold tracking-wide text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                        Actividad
                      </span>
                    )}

                    {/* Acciones de autor para comentarios (HM22: Editar y Eliminar) */}
                    {item.type === 'COMMENT' && isAuthor && !isEditing && (
                      <div className="flex items-center gap-1.5 ml-1">
                        <button
                          type="button"
                          onClick={() => startEditComment(item)}
                          className="rounded px-2 py-1 text-xs font-medium text-[#245B78] hover:bg-[#EAF2F7] transition-colors"
                          title="Editar comentario"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => setCommentIdToDelete(item.id)}
                          className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
                          title="Eliminar comentario"
                        >
                          Eliminar
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Cuerpo del comentario o de la actividad */}
                {item.type === 'COMMENT' ? (
                  isEditing ? (
                    <div className="pl-11 mt-2 flex flex-col gap-3">
                      <MentionComposer
                        value={editCommentText}
                        mentions={editCommentMentions}
                        onChange={(val, m) => {
                          setEditCommentText(val);
                          setEditCommentMentions(m);
                        }}
                        members={members}
                        rows={3}
                        autoFocus
                        disabled={updateCommentMutation.isPending}
                        onSubmitShortcut={() => {
                          if (editCommentText.trim() && !updateCommentMutation.isPending) {
                            updateCommentMutation.mutate();
                          }
                        }}
                      />
                      {editError && (
                        <div role="alert" className="rounded-lg bg-red-50 p-2.5 text-xs text-red-600 border border-red-200">
                          {editError}
                        </div>
                      )}
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={cancelEditComment}
                          disabled={updateCommentMutation.isPending}
                          className="rounded-lg border border-[#DEE5EC] px-3 py-1.5 text-xs font-medium text-[#607185] hover:bg-slate-50 transition-colors disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => updateCommentMutation.mutate()}
                          disabled={!editCommentText.trim() || updateCommentMutation.isPending}
                          className="rounded-lg bg-[#245B78] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1A4258] transition-colors disabled:opacity-50"
                        >
                          {updateCommentMutation.isPending ? 'Guardando...' : 'Guardar cambios'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-[#172B42] leading-relaxed pl-11">
                      <MentionContent content={item.content || ''} mentions={item.mentions} />
                    </div>
                  )
                ) : (
                  <div className="pl-11 text-sm">
                    {renderHistoryChanges(item)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Formulario para nuevo comentario con menciones */}
      {canComment && (
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <MentionComposer
            value={newComment}
            mentions={newMentions}
            onChange={(val, m) => {
              setNewComment(val);
              setNewMentions(m);
              if (addError) setAddError(null);
            }}
            members={members}
            rows={3}
            disabled={addCommentMutation.isPending}
            placeholder="Escribí un comentario... Usá @ para mencionar a alguien"
            onSubmitShortcut={() => {
              if (newComment.trim() && !addCommentMutation.isPending) {
                addCommentMutation.mutate();
              }
            }}
          />
          {addError && (
            <div role="alert" className="rounded-lg bg-red-50 p-2.5 text-xs text-red-600 border border-red-200">
              {addError}
            </div>
          )}
          <button
            type="submit"
            disabled={!newComment.trim() || addCommentMutation.isPending}
            className="self-end rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1A4258] transition-colors disabled:opacity-50"
          >
            {addCommentMutation.isPending ? 'Enviando...' : 'Comentar'}
          </button>
        </form>
      )}

      {/* Diálogo de confirmación para eliminar comentario (HM22) */}
      <ConfirmDialog
        open={!!commentIdToDelete}
        title="Eliminar comentario"
        description="¿Estás seguro de que deseás eliminar este comentario? Se dará de baja y no volverá a aparecer en la línea de tiempo."
        confirmLabel="Eliminar"
        variant="danger"
        isConfirming={deleteCommentMutation.isPending}
        onConfirm={() => commentIdToDelete && deleteCommentMutation.mutate(commentIdToDelete)}
        onCancel={() => setCommentIdToDelete(null)}
      />
    </div>
  );
}
