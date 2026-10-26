import type { MilestoneSummaryDto } from '@tema/shared-types';
import { formatLocalDate } from '../../lib/dates';
import { MilestoneStatusBadge } from '../milestones/MilestoneStatusBadge';
import { MilestoneProgressBar } from '../milestones/MilestoneProgressBar';

interface GanttMilestonesPanelProps {
  milestones: MilestoneSummaryDto[];
  selectedMilestoneId: string | null;
  onSelectMilestone: (milestoneId: string | null) => void;
}

/**
 * Panel y leyenda interactiva de Hitos dentro de la vista de Gantt (KAN-280).
 * - Diferencia visualmente hitos alcanzados (`COMPLETED`), pendientes (`PENDING`) y vencidos (`OVERDUE`).
 * - Permite seleccionar cualquier hito (desde este panel o haciendo clic en su marcador en el Gantt)
 *   para inspeccionar su fecha objetivo, estado, descripción y progreso de tareas asociadas.
 */
export function GanttMilestonesPanel({
  milestones,
  selectedMilestoneId,
  onSelectMilestone,
}: GanttMilestonesPanelProps) {
  if (!milestones || milestones.length === 0) {
    return null;
  }

  const selectedMilestone = milestones.find((m) => m.id === selectedMilestoneId) ?? null;

  return (
    <div className="space-y-3" data-testid="gantt-milestones-section">
      {/* Barra de hitos y leyenda */}
      <div className="rounded-xl border border-[#DEE5EC] bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[#172B42]">
              {`Hitos en el cronograma (${milestones.length})`}
            </h3>
            <span className="text-xs text-[#607185]">
              · Seleccioná un hito para ver su detalle
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-[#607185]">
            <span className="inline-flex items-center gap-1">
              <span className="text-emerald-600 font-bold" aria-hidden="true">◆</span>
              Alcanzado
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="text-[#245B78] font-bold" aria-hidden="true">◆</span>
              Pendiente
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="text-rose-600 font-bold" aria-hidden="true">◆</span>
              Vencido
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {milestones.map((m) => {
            const isSelected = m.id === selectedMilestoneId;
            const isCompleted = m.status === 'COMPLETED';
            const isOverdue = m.status === 'OVERDUE';

            const chipColors = isCompleted
              ? isSelected
                ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/30'
                : 'border-emerald-200 bg-emerald-50/60 text-emerald-800 hover:bg-emerald-50'
              : isOverdue
                ? isSelected
                  ? 'border-rose-600 bg-rose-50 text-rose-900 ring-2 ring-rose-500/30'
                  : 'border-rose-200 bg-rose-50/60 text-rose-800 hover:bg-rose-50'
                : isSelected
                  ? 'border-[#245B78] bg-[#EAF2F7] text-[#172B42] ring-2 ring-[#245B78]/30'
                  : 'border-[#DEE5EC] bg-[#FAFCFD] text-[#172B42] hover:bg-[#EAF2F7]/50';

            const diamondColor = isCompleted
              ? 'text-emerald-600'
              : isOverdue
                ? 'text-rose-600'
                : 'text-[#245B78]';

            return (
              <button
                key={m.id}
                type="button"
                data-testid={`gantt-milestone-chip-${m.id}`}
                data-milestone-status={m.status}
                aria-pressed={isSelected}
                onClick={() => onSelectMilestone(isSelected ? null : m.id)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${chipColors}`}
              >
                <span className={`font-bold ${diamondColor}`} aria-hidden="true">
                  ◆
                </span>
                <span className="truncate max-w-[200px]">{m.name}</span>
                <span className="text-[11px] opacity-80">({formatLocalDate(m.dueDate)})</span>
                <span className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold">
                  {m.progress}%
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detalle del hito seleccionado en el Gantt */}
      {selectedMilestone && (
        <div
          role="region"
          aria-label={`Detalle del hito ${selectedMilestone.name}`}
          data-testid="gantt-selected-milestone-detail"
          className="rounded-xl border border-[#245B78]/30 bg-white p-4 shadow-sm space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    selectedMilestone.status === 'COMPLETED'
                      ? 'text-emerald-600 font-bold'
                      : selectedMilestone.status === 'OVERDUE'
                        ? 'text-rose-600 font-bold'
                        : 'text-[#245B78] font-bold'
                  }
                  aria-hidden="true"
                >
                  ◆
                </span>
                <h4 className="text-sm font-bold text-[#172B42]">{selectedMilestone.name}</h4>
                <MilestoneStatusBadge status={selectedMilestone.status} />
              </div>
              <p className="text-xs text-[#607185]">
                Fecha objetivo: <strong className="text-[#172B42]">{formatLocalDate(selectedMilestone.dueDate)}</strong>
                {selectedMilestone.completedAt && (
                  <span> · Alcanzado el {formatLocalDate(selectedMilestone.completedAt.split('T')[0])}</span>
                )}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onSelectMilestone(null)}
              aria-label="Cerrar detalle del hito"
              className="rounded-md px-2 py-1 text-xs text-[#607185] hover:bg-gray-100 hover:text-[#172B42]"
            >
              ✕
            </button>
          </div>

          {selectedMilestone.description && (
            <p className="text-xs text-[#172B42] bg-[#F8FAFC] rounded-lg p-2.5 border border-[#DEE5EC]">
              {selectedMilestone.description}
            </p>
          )}

          <MilestoneProgressBar
            progress={selectedMilestone.progress}
            completedTasks={selectedMilestone.completedTaskCount}
            totalTasks={selectedMilestone.taskCount}
          />
        </div>
      )}
    </div>
  );
}
