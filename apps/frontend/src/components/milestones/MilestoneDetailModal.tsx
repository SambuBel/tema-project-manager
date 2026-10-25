import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../lib/api';
// import types
import { MilestoneStatusBadge } from './MilestoneStatusBadge';
import { MilestoneProgressBar } from './MilestoneProgressBar';
import { MilestoneFormModal } from './MilestoneFormModal';
import { MilestoneDeleteModal } from './MilestoneDeleteModal';
import { MilestoneTaskSelectorModal } from './MilestoneTaskSelectorModal';

interface MilestoneDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  milestoneId: string;
  projectId: string;
  canManage: boolean;
  onMilestoneUpdated: () => void;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'No definida';
  try {
    const parts = dateStr.split('T')[0]?.split('-');
    if (!parts || parts.length < 3) return dateStr;
    const [year, month, day] = parts;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function MilestoneDetailModal({
  isOpen,
  onClose,
  milestoneId,
  projectId,
  canManage,
  onMilestoneUpdated,
}: MilestoneDetailModalProps) {
  const qc = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSelectingTasks, setIsSelectingTasks] = useState(false);
  const [disassociatingTaskId, setDisassociatingTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: milestone, isLoading, isError, refetch } = useQuery({
    queryKey: ['milestone-detail', milestoneId],
    queryFn: () => api.getMilestone(milestoneId),
    enabled: isOpen && Boolean(milestoneId),
  });

  const completeMutation = useMutation({
    mutationFn: () => api.completeMilestone(milestoneId),
    onSuccess: () => {
      refetch();
      qc.invalidateQueries({ queryKey: ['milestones', projectId] });
      qc.invalidateQueries({ queryKey: ['milestones-upcoming', projectId] });
      onMilestoneUpdated();
    },
    onError: (err) => {
      setActionError(err instanceof ApiRequestError ? err.details.join(' ') || err.message : 'Error al completar el hito.');
    },
  });

  const reopenMutation = useMutation({
    mutationFn: () => api.reopenMilestone(milestoneId),
    onSuccess: () => {
      refetch();
      qc.invalidateQueries({ queryKey: ['milestones', projectId] });
      qc.invalidateQueries({ queryKey: ['milestones-upcoming', projectId] });
      onMilestoneUpdated();
    },
    onError: (err) => {
      setActionError(err instanceof ApiRequestError ? err.details.join(' ') || err.message : 'Error al reabrir el hito.');
    },
  });

  const handleDisassociateTask = async (taskId: string) => {
    setActionError(null);
    setDisassociatingTaskId(taskId);
    try {
      await api.disassociateMilestoneTask(milestoneId, taskId);
      await Promise.all([
        refetch(),
        qc.invalidateQueries({ queryKey: ['milestones', projectId] }),
        qc.invalidateQueries({ queryKey: ['milestones-upcoming', projectId] }),
        qc.invalidateQueries({ queryKey: ['all-tasks-for-milestone', projectId] }),
      ]);
      onMilestoneUpdated();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setActionError(err.details && err.details.length > 0 ? err.details.join(' ') : `Error (${err.status}): no se pudo desasociar la tarea.`);
      } else {
        setActionError('Error inesperado al desasociar la tarea.');
      }
    } finally {
      setDisassociatingTaskId(null);
    }
  };


  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isEditing && !isDeleting && !isSelectingTasks) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isEditing, isDeleting, isSelectingTasks, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="milestone-detail-title"
      >
        <div className="flex flex-col w-full max-w-3xl max-h-[90vh] rounded-xl border border-[#DEE5EC] bg-white shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-[#DEE5EC] p-5 bg-[#FAFCFD]">
            <div className="space-y-1 pr-4">
              <div className="flex items-center gap-3">
                <h2 id="milestone-detail-title" className="text-xl font-bold text-[#172B42]">
                  {milestone?.name || 'Cargando hito...'}
                </h2>
                {milestone && <MilestoneStatusBadge status={milestone.status} />}
              </div>
              {milestone && (
                <p className="text-xs text-[#607185]">
                  Fecha objetivo: <strong className="text-[#172B42]">{formatDate(milestone.dueDate)}</strong>
                  {milestone.creator && ` · Creado por ${milestone.creator.name}`}
                </p>
              )}
            </div>

            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 focus:outline-none p-1 rounded-md"
              aria-label="Cerrar modal de detalle"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {isLoading && (
              <div className="py-12 text-center text-sm text-[#607185]">
                Cargando información del hito...
              </div>
            )}

            {isError && (
              <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-200">
                No se pudo cargar el detalle del hito. Por favor intenta nuevamente.
              </div>
            )}

            {actionError && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-200 flex justify-between items-center">
                <span>{actionError}</span>
                <button onClick={() => setActionError(null)} className="text-red-700 font-bold ml-2">✕</button>
              </div>
            )}

            {milestone && (
              <>
                {/* Descripción */}
                {milestone.description ? (
                  <div className="rounded-lg bg-gray-50/70 p-4 border border-[#DEE5EC]">
                    <h4 className="text-xs font-semibold text-[#607185] uppercase tracking-wider mb-1">
                      Descripción
                    </h4>
                    <p className="text-sm text-[#172B42] whitespace-pre-line leading-relaxed">
                      {milestone.description}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs italic text-[#607185]">Sin descripción definida.</p>
                )}

                {/* Métricas y Estado de Alcance */}
                <div className="rounded-xl border border-[#DEE5EC] bg-white p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-[#172B42]">Progreso del hito</h4>
                    {milestone.completedAt ? (
                      <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                        ✓ Confirmado el {formatDate(milestone.completedAt)}
                        {milestone.completedBy ? ` por ${milestone.completedBy.name}` : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-[#607185]">
                        Progreso automático calculado según tareas completadas
                      </span>
                    )}
                  </div>

                  <MilestoneProgressBar
                    progress={milestone.progress}
                    completedTasks={milestone.completedTaskCount}
                    totalTasks={milestone.taskCount}
                  />
                </div>

                {/* Barra de Acciones de Gestión */}
                {canManage && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#DEE5EC]">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setIsSelectingTasks(true)}
                        className="rounded-lg bg-[#245B78] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1b445a] flex items-center gap-1.5"
                      >
                        + Vincular tareas
                      </button>

                      {milestone.status === 'COMPLETED' ? (
                        <button
                          type="button"
                          onClick={() => reopenMutation.mutate()}
                          disabled={reopenMutation.isPending}
                          className="rounded-lg border border-[#DEE5EC] bg-white px-3.5 py-1.5 text-xs font-medium text-[#172B42] hover:bg-gray-50 disabled:opacity-50"
                        >
                          {reopenMutation.isPending ? 'Reabriendo...' : 'Reabrir hito'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => completeMutation.mutate()}
                          disabled={completeMutation.isPending}
                          className="rounded-lg border border-emerald-600 bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          {completeMutation.isPending ? 'Confirmando...' : '✓ Marcar como alcanzado'}
                        </button>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setIsEditing(true)}
                        className="rounded-lg border border-[#DEE5EC] bg-white px-3 py-1.5 text-xs font-medium text-[#172B42] hover:bg-gray-50"
                      >
                        Editar hito
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsDeleting(true)}
                        className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                )}

                {/* Sección de Tareas Asociadas */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-[#172B42]">
                      Tareas vinculadas ({milestone.tasks?.length || 0})
                    </h4>
                  </div>

                  {(!milestone.tasks || milestone.tasks.length === 0) ? (
                    <div className="rounded-xl border border-dashed border-[#DEE5EC] p-8 text-center space-y-2">
                      <p className="text-sm text-[#607185]">
                        No hay tareas asociadas a este hito todavía.
                      </p>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => setIsSelectingTasks(true)}
                          className="rounded-lg border border-[#DEE5EC] bg-white px-3 py-1.5 text-xs font-medium text-[#245B78] hover:bg-gray-50"
                        >
                          Vincular primera tarea
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="divide-y divide-[#DEE5EC] rounded-xl border border-[#DEE5EC] bg-white overflow-hidden">
                      {milestone.tasks.map((task) => {
                        const isDisassociating = disassociatingTaskId === task.id;
                        return (
                          <div
                            key={task.id}
                            className="flex items-center justify-between gap-3 p-3.5 hover:bg-[#F8FAFC] transition-colors"
                          >
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-[#172B42] truncate max-w-md" title={task.title}>
                                  {task.title}
                                </span>
                                {task.parentTaskId && (
                                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                                    Subtarea
                                  </span>
                                )}
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                    task.status === 'COMPLETED'
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : 'bg-blue-50 text-blue-700'
                                  }`}
                                >
                                  {task.status === 'COMPLETED' ? 'Completada' : 'En progreso / Pendiente'}
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-3 text-xs text-[#607185]">
                                {task.dueDate && <span>Vencimiento: {formatDate(task.dueDate)}</span>}
                                {task.assignedTo && <span>Responsable: {task.assignedTo.name}</span>}
                              </div>
                            </div>

                            {/* Desasociar Tarea */}
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => handleDisassociateTask(task.id)}
                                disabled={isDisassociating}
                                className="shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-red-700 disabled:opacity-50"
                                title="Desasociar del hito (la tarea permanecerá intacta en el proyecto)"
                              >
                                {isDisassociating ? 'Desasociando...' : 'Desasociar'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end border-t border-[#DEE5EC] p-4 bg-gray-50">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] hover:bg-gray-100"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>

      {/* Sub-modales de Edición, Eliminación y Selector de Tareas */}
      {isEditing && milestone && (
        <MilestoneFormModal
          isOpen={isEditing}
          onClose={() => setIsEditing(false)}
          projectId={projectId}
          milestoneToEdit={milestone}
          onSuccess={() => {
            refetch();
            onMilestoneUpdated();
          }}
        />
      )}

      {isDeleting && milestone && (
        <MilestoneDeleteModal
          isOpen={isDeleting}
          onClose={() => setIsDeleting(false)}
          milestone={milestone}
          onSuccess={() => {
            onClose();
            onMilestoneUpdated();
          }}
        />
      )}

      {isSelectingTasks && milestone && (
        <MilestoneTaskSelectorModal
          isOpen={isSelectingTasks}
          onClose={() => setIsSelectingTasks(false)}
          milestone={milestone}
          onTaskAssociated={() => {
            refetch();
            onMilestoneUpdated();
          }}
        />
      )}
    </>
  );
}
