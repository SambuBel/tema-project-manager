import { useId } from 'react';
import type { MemberResourceAllocation } from '@tema/shared-types';
import { useMemberAllocationHistory } from '../../hooks/useProjectResourceAllocation';
import { formatLocalDate } from '../../lib/dates';
import { formatHours, formatMoney } from '../../lib/money';
import { EconomyDialog } from './EconomyDialog';
import { EconomyStateBoundary } from './EconomyStateBoundary';

interface AllocationHistoryModalProps {
  projectId: string;
  member: MemberResourceAllocation;
  onClose: () => void;
}

/**
 * Historial de revisiones de la asignación de un miembro, de la más nueva a la más vieja. Cada revisión se pinta con SU snapshot
 * (perfil, tarifa, moneda, horas y costo tal como eran): jamás se consulta el catálogo de perfiles para completar o corregir nada.
 */
export function AllocationHistoryModal({ projectId, member, onClose }: AllocationHistoryModalProps) {
  const uid = useId();
  const query = useMemberAllocationHistory(projectId, member.projectMemberId);
  const entries = query.data;

  return (
    <EconomyDialog title={`Historial de asignación — ${member.user.name}`} titleId={`${uid}-title`} onClose={onClose} maxWidthClass="max-w-2xl">
      <EconomyStateBoundary isLoading={query.isLoading} error={query.error} loadingLabel="Cargando historial…" onRetry={() => void query.refetch()}>
        {entries && entries.length === 0 && <p className="text-sm text-[#607185]">Este miembro todavía no tiene asignaciones.</p>}
        {entries && entries.length > 0 && (
          <ol className="flex flex-col gap-3">
            {entries.map((entry) => (
              <li key={entry.revision} className={`rounded-lg border p-4 ${entry.isCurrent ? 'border-[#245B78] bg-[#F4F9FC]' : 'border-[#DEE5EC] bg-white'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-[#172B42]">Revisión {entry.revision}</p>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${entry.isCurrent ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {entry.isCurrent ? '● Vigente' : '○ Histórica'}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-[#172B42]">{entry.profileNameSnapshot ?? 'Sin perfil'}</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-[#172B42]">
                  <dt className="text-[#607185]">Tarifa</dt>
                  <dd className="tabular-nums">{entry.hourlyCostSnapshot ? `${formatMoney(entry.hourlyCostSnapshot, entry.currencySnapshot)} / h` : '—'}</dd>
                  <dt className="text-[#607185]">Horas</dt>
                  <dd className="tabular-nums">{entry.estimatedHours ? formatHours(entry.estimatedHours) : 'Sin horas'}</dd>
                  <dt className="text-[#607185]">Costo estimado</dt>
                  <dd className="tabular-nums">{entry.estimatedCostSnapshot ? formatMoney(entry.estimatedCostSnapshot, entry.currencySnapshot) : 'Sin costo estimado'}</dd>
                  <dt className="text-[#607185]">Presupuesto</dt>
                  <dd>{entry.budgetVersion !== null ? `Presupuesto V${entry.budgetVersion}` : 'Sin presupuesto vigente al momento de la asignación'}</dd>
                  <dt className="text-[#607185]">Cambió</dt>
                  <dd>
                    {entry.changedBy.name} · {formatLocalDate(new Date(entry.createdAt))}
                  </dd>
                  {entry.supersededAt && (
                    <>
                      <dt className="text-[#607185]">Reemplazada</dt>
                      <dd>{formatLocalDate(new Date(entry.supersededAt))}</dd>
                    </>
                  )}
                </dl>
                <p className="mt-2 text-xs text-[#607185]">Origen: {entry.origin}</p>
              </li>
            ))}
          </ol>
        )}
      </EconomyStateBoundary>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] hover:bg-gray-50">
          Cerrar
        </button>
      </div>
    </EconomyDialog>
  );
}
