import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../lib/api';
import type { MilestoneSummaryDto } from '@tema/shared-types';
import type { Task, TaskStatus } from '../../types/task';

interface MilestoneTaskSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  milestone: MilestoneSummaryDto;
  onTaskAssociated: () => void;
}

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  IN_REVIEW: 'En revisión',
  BLOCKED: 'Bloqueada',
  COMPLETED: 'Completada',
};

const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  PENDING: 'bg-[#EAF2F7] text-[#245B78]',
  IN_PROGRESS: 'bg-blue-50 text-blue-700',
  IN_REVIEW: 'bg-amber-50 text-amber-700',
  BLOCKED: 'bg-rose-50 text-rose-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
};

export function MilestoneTaskSelectorModal({
  isOpen,
  onClose,
  milestone,
  onTaskAssociated,
}: MilestoneTaskSelectorModalProps) {
  const qc = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [associatingTaskId, setAssociatingTaskId] = useState<string | null>(null);

  // Carga todas las tareas del proyecto recorriendo todas las páginas transparentemente
  const { data: allTasks, isLoading: loadingTasks, isError: errorTasks } = useQuery({
    queryKey: ['all-tasks-for-milestone', milestone.projectId],
    queryFn: () => api.listAllTasks({ projectId: milestone.projectId, includeSubtasks: true }),
    enabled: isOpen,
  });

  // Carga todos los hitos del proyecto para identificar nombres de hitos ajenos
  const { data: allMilestones } = useQuery({
    queryKey: ['milestones-lookup', milestone.projectId],
    queryFn: () => api.listMilestones(milestone.projectId),
    enabled: isOpen,
  });

  const milestonesMap = useMemo(() => {
    const map = new Map<string, string>();
    if (allMilestones) {
      allMilestones.forEach((m) => map.set(m.id, m.name));
    }
    return map;
  }, [allMilestones]);

  // Filtrar tareas: excluir archivadas, aplicar búsqueda por título o slug
  const visibleTasks = useMemo(() => {
    if (!allTasks) return [];
    return allTasks
      .filter((t) => !t.archivedAt)
      .filter((t) => {
        if (!searchTerm.trim()) return true;
        const q = searchTerm.toLowerCase();
        return (
          t.title.toLowerCase().includes(q) ||
          (t.slug && t.slug.toLowerCase().includes(q))
        );
      });
  }, [allTasks, searchTerm]);

  const handleAssociate = async (task: Task) => {
    setActionError(null);
    setAssociatingTaskId(task.id);

    try {
      await api.associateMilestoneTask(milestone.id, task.id);
      // Invalida caché de tareas e hitos
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['milestone-detail', milestone.id] }),
        qc.invalidateQueries({ queryKey: ['milestones', milestone.projectId] }),
        qc.invalidateQueries({ queryKey: ['milestones-upcoming', milestone.projectId] }),
        qc.invalidateQueries({ queryKey: ['all-tasks-for-milestone', milestone.projectId] }),
      ]);
      onTaskAssociated();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.status === 409) {
          const otherName = task.milestoneId ? milestonesMap.get(task.milestoneId) : null;
          setActionError(
            `Conflicto (409): La tarea ya pertenece ${
              otherName ? `al hito «${otherName}»` : 'a otro hito activo'
            }. No se puede reasignar automáticamente.`
          );
        } else if (err.status === 403) {
          setActionError('No tienes permisos de administración para asociar tareas a este hito.');
        } else if (err.status === 404) {
          setActionError('La tarea o el hito no existen o han sido eliminados.');
        } else if (err.details && err.details.length > 0) {
          setActionError(err.details.join(' '));
        } else {
          setActionError(`Error (${err.status}): no se pudo asociar la tarea.`);
        }
      } else {
        setActionError('Ocurrió un error inesperado al asociar la tarea.');
      }
    } finally {
      setAssociatingTaskId(null);
    }
  };


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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-selector-title"
    >
      <div className="flex flex-col w-full max-w-2xl max-h-[85vh] rounded-xl border border-[#DEE5EC] bg-white shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#DEE5EC] p-4 sm:p-5">
          <div>
            <h2 id="task-selector-title" className="text-lg font-semibold text-[#172B42]">
              Asociar tareas al hito «{milestone.name}»
            </h2>
            <p className="text-xs text-[#607185] mt-0.5">
              Selecciona tareas activas o subtareas reales del proyecto para vincularlas.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 focus:outline-none p-1"
            aria-label="Cerrar modal"
          >
            ✕
          </button>
        </div>

        {/* Buscador y alertas */}
        <div className="p-4 border-b border-[#DEE5EC] bg-gray-50/50 space-y-3">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar tarea por título o código..."
            className="w-full rounded-lg border border-[#DEE5EC] bg-white px-3 py-2 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none"
            autoFocus
          />

          {actionError && (
            <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 border border-red-200">
              {actionError}
            </div>
          )}
        </div>

        {/* Listado de tareas */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loadingTasks && (
            <div className="py-12 text-center text-sm text-[#607185]">
              Cargando tareas del proyecto...
            </div>
          )}

          {errorTasks && (
            <div className="py-12 text-center text-sm text-red-600">
              No se pudieron cargar las tareas del proyecto.
            </div>
          )}

          {!loadingTasks && !errorTasks && visibleTasks.length === 0 && (
            <div className="py-12 text-center text-sm text-[#607185]">
              {searchTerm ? 'No se encontraron tareas que coincidan con la búsqueda.' : 'No hay tareas activas en este proyecto.'}
            </div>
          )}

          {!loadingTasks &&
            !errorTasks &&
            visibleTasks.map((task) => {
              const isAssignedToThisMilestone = task.milestoneId === milestone.id;
              const isAssignedToOtherMilestone = Boolean(
                task.milestoneId && task.milestoneId !== milestone.id
              );
              const otherMilestoneName = isAssignedToOtherMilestone
                ? milestonesMap.get(task.milestoneId!) || 'Otro hito'
                : null;
              const isBusy = associatingTaskId === task.id;

              return (
                <div
                  key={task.id}
                  className={`flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors ${
                    isAssignedToThisMilestone
                      ? 'border-emerald-200 bg-emerald-50/40'
                      : isAssignedToOtherMilestone
                      ? 'border-[#DEE5EC] bg-gray-50/70'
                      : 'border-[#DEE5EC] bg-white hover:bg-[#F8FAFC]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-[#172B42] truncate max-w-sm" title={task.title}>
                        {task.title}
                      </span>
                      {task.parentTaskId && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                          Subtarea
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          TASK_STATUS_COLORS[task.status] || 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {TASK_STATUS_LABELS[task.status] || task.status}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[#607185]">
                      {task.dueDate && <span>Vence: {task.dueDate.slice(0, 10)}</span>}
                      {task.assignedTo && <span>Responsable: {task.assignedTo.name}</span>}
                    </div>
                  </div>

                  {/* Acciones por tarea */}
                  <div className="shrink-0 flex items-center">
                    {isAssignedToThisMilestone ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                        ✓ Vinculada
                      </span>
                    ) : isAssignedToOtherMilestone ? (
                      <div className="flex flex-col items-end">
                        <span
                          className="rounded-md bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800"
                          title={`Vinculada al hito «${otherMilestoneName}». Cada tarea solo puede pertenecer a un único hito (D2).`}
                        >
                          {`En: ${otherMilestoneName}`}
                        </span>
                        <span className="text-[10px] text-[#607185] mt-0.5">No reasignable</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAssociate(task)}
                        disabled={isBusy}
                        className="rounded-lg bg-[#245B78] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1b445a] disabled:opacity-50 flex items-center gap-1"
                      >
                        {isBusy ? (
                          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        ) : (
                          '+ Asociar'
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center border-t border-[#DEE5EC] p-4 bg-gray-50">
          <span className="text-xs text-[#607185]">
            Total mostradas: {visibleTasks.length} tareas
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] hover:bg-gray-100"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
