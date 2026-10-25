import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Project, MilestoneSummaryDto } from '@tema/shared-types';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { canManageMilestonesUI } from '../../lib/permissions';
import { MilestoneStatusBadge } from './MilestoneStatusBadge';
import { MilestoneProgressBar } from './MilestoneProgressBar';
import { MilestoneFormModal } from './MilestoneFormModal';
import { MilestoneDetailModal } from './MilestoneDetailModal';
import { MilestoneDeleteModal } from './MilestoneDeleteModal';

interface MilestonesManagerProps {
  project: Project;
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

export function MilestonesManager({ project }: MilestonesManagerProps) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const canManage = Boolean(user && canManageMilestonesUI(user, project));

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);
  const [milestoneToEdit, setMilestoneToEdit] = useState<MilestoneSummaryDto | null>(null);
  const [milestoneToDelete, setMilestoneToDelete] = useState<MilestoneSummaryDto | null>(null);

  const { data: milestones, isLoading, isError, refetch } = useQuery({
    queryKey: ['milestones', project.id],
    queryFn: () => api.listMilestones(project.id),
  });

  const handleRefresh = () => {
    refetch();
    qc.invalidateQueries({ queryKey: ['milestones-upcoming', project.id] });
  };

  return (
    <div className="space-y-6">
      {/* Encabezado del módulo */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#172B42]">Hitos del proyecto</h2>
          <p className="mt-1 text-sm text-[#607185]">
            Planifica objetivos clave, supervisa el progreso de las entregas y vincula tareas críticas.
          </p>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="self-start sm:self-auto rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1b445a] transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <span>+</span> Nuevo hito
          </button>
        )}
      </div>

      {/* Estados de Carga y Error */}
      {isLoading && (
        <div className="rounded-xl border border-[#DEE5EC] bg-white p-12 text-center text-sm text-[#607185]">
          <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[#245B78] border-t-transparent mb-2" />
          <p>Cargando hitos del proyecto...</p>
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
          <p className="font-medium">No se pudieron cargar los hitos del proyecto.</p>
          <button
            onClick={() => refetch()}
            className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Estado Vacío */}
      {!isLoading && !isError && (!milestones || milestones.length === 0) && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#DEE5EC] bg-white p-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#EAF2F7] text-2xl text-[#245B78] mb-4">
            🏁
          </div>
          <h3 className="text-base font-semibold text-[#172B42]">Aún no hay hitos en este proyecto</h3>
          <p className="mt-1 max-w-sm text-sm text-[#607185]">
            Los hitos representan metas clave o entregas temporales y permiten agrupar tareas para medir su avance global.
          </p>

          {canManage && (
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="mt-5 rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1b445a]"
            >
              Crear primer hito
            </button>
          )}
        </div>
      )}

      {/* Grid de Hitos */}
      {!isLoading && !isError && milestones && milestones.length > 0 && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {milestones.map((m) => {
            return (
              <div
                key={m.id}
                className="flex flex-col justify-between rounded-xl border border-[#DEE5EC] bg-white p-5 shadow-sm transition-all hover:shadow-md"
              >
                {/* Parte superior */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3
                      className="font-semibold text-base text-[#172B42] hover:text-[#245B78] cursor-pointer line-clamp-2"
                      onClick={() => setSelectedMilestoneId(m.id)}
                      title={m.name}
                    >
                      {m.name}
                    </h3>
                    <MilestoneStatusBadge status={m.status} className="shrink-0" />
                  </div>

                  <p className="text-xs text-[#607185]">
                    Fecha objetivo:{' '}
                    <strong className="text-[#172B42]">{formatDate(m.dueDate)}</strong>
                  </p>

                  {m.description && (
                    <p className="text-xs text-[#607185] line-clamp-2 leading-relaxed">
                      {m.description}
                    </p>
                  )}
                </div>

                {/* Progreso y Acciones */}
                <div className="mt-5 pt-4 border-t border-[#DEE5EC] space-y-4">
                  <MilestoneProgressBar
                    progress={m.progress}
                    completedTasks={m.completedTaskCount}
                    totalTasks={m.taskCount}
                  />

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setSelectedMilestoneId(m.id)}
                      className="rounded-lg bg-[#EAF2F7] px-3 py-1.5 text-xs font-semibold text-[#245B78] hover:bg-[#dce9f2] transition-colors"
                    >
                      Ver detalle y tareas &rarr;
                    </button>

                    {canManage && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setMilestoneToEdit(m)}
                          className="rounded-lg p-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-[#172B42]"
                          title="Editar hito"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => setMilestoneToDelete(m)}
                          className="rounded-lg p-1.5 text-xs font-medium text-gray-500 hover:bg-red-50 hover:text-red-600"
                          title="Eliminar hito"
                        >
                          🗑
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Creación / Edición */}
      {isCreateOpen && (
        <MilestoneFormModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          projectId={project.id}
          onSuccess={handleRefresh}
        />
      )}

      {milestoneToEdit && (
        <MilestoneFormModal
          isOpen={Boolean(milestoneToEdit)}
          onClose={() => setMilestoneToEdit(null)}
          projectId={project.id}
          milestoneToEdit={milestoneToEdit}
          onSuccess={handleRefresh}
        />
      )}

      {/* Modal de Eliminación */}
      {milestoneToDelete && (
        <MilestoneDeleteModal
          isOpen={Boolean(milestoneToDelete)}
          onClose={() => setMilestoneToDelete(null)}
          milestone={milestoneToDelete}
          onSuccess={handleRefresh}
        />
      )}

      {/* Modal de Detalle */}
      {selectedMilestoneId && (
        <MilestoneDetailModal
          isOpen={Boolean(selectedMilestoneId)}
          onClose={() => setSelectedMilestoneId(null)}
          milestoneId={selectedMilestoneId}
          projectId={project.id}
          canManage={canManage}
          onMilestoneUpdated={handleRefresh}
        />
      )}
    </div>
  );
}
