import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BudgetHistoryEntry } from '@tema/shared-types';
import { ApiRequestError, api } from '../../lib/api';
import { economicQueryRetry } from '../../lib/economicErrors';
import { formatLocalDate } from '../../lib/dates';
import { formatMoney } from '../../lib/money';
import { projectBudgetHistoryKey } from '../../hooks/useProjectBudget';
import { EconomyStateBoundary } from './EconomyStateBoundary';

interface BudgetHistoryProps {
  projectId: string;
}

/**
 * Historial completo del presupuesto (GET budget/history): todas las versiones, la más nueva primero, cada una con SUS propias
 * partidas. Los nombres de rubro son los del snapshot que devuelve el backend: nunca se reemplazan con el catálogo actual
 * (un rubro hoy inactivo sigue mostrando su nombre histórico).
 */
export function BudgetHistory({ projectId }: BudgetHistoryProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const history = useQuery<BudgetHistoryEntry[]>({
    queryKey: projectBudgetHistoryKey(projectId),
    queryFn: async () => {
      try {
        return await api.getProjectBudgetHistory(projectId);
      } catch (error) {
        // Sin presupuesto no hay historial: es vacío, no un error (y el aviso ya lo da la sección).
        if (error instanceof ApiRequestError && error.status === 404 && error.code === 'BUDGET_NOT_FOUND') return [];
        throw error;
      }
    },
    retry: economicQueryRetry,
    staleTime: 0,
  });

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section aria-labelledby="budget-history-title" className="rounded-xl border border-[#DEE5EC] bg-white p-4 sm:p-6">
      <h3 id="budget-history-title" className="text-base font-semibold text-[#172B42]">
        Historial de versiones
      </h3>

      <div className="mt-4">
        <EconomyStateBoundary isLoading={history.isLoading} error={history.error} loadingLabel="Cargando historial…" onRetry={() => void history.refetch()}>
          {!history.data || history.data.length === 0 ? (
            <p className="text-sm text-[#607185]">No hay versiones anteriores.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {history.data.map((entry) => {
                const isOpen = expanded.has(entry.id);
                const panelId = `budget-version-${entry.id}`;
                return (
                  <li key={entry.id} className="rounded-lg border border-[#DEE5EC]">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => toggle(entry.id)}
                      className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-[#F4F6F8] sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[#172B42]">Versión {entry.version}</span>
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${entry.isCurrent ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}
                        >
                          {entry.isCurrent ? '● Vigente' : '○ Histórica'}
                        </span>
                      </span>
                      <span className="text-sm font-medium text-[#172B42]">{formatMoney(entry.totalAmount, entry.currency)}</span>
                      <span className="text-xs text-[#607185]">
                        Aprobado el {formatLocalDate(entry.approvalDate)} · Creada por {entry.createdByUser.name} el {formatLocalDate(new Date(entry.createdAt))}
                      </span>
                    </button>

                    {isOpen && (
                      <div id={panelId} className="overflow-x-auto border-t border-[#DEE5EC] px-4 py-3">
                        <table className="w-full min-w-[20rem] text-left text-sm">
                          <caption className="sr-only">Partidas de la versión {entry.version}</caption>
                          <thead>
                            <tr className="text-xs uppercase text-[#607185]">
                              <th scope="col" className="py-1 pr-4 font-medium">
                                Rubro
                              </th>
                              <th scope="col" className="py-1 text-right font-medium">
                                Importe
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {entry.items.map((item) => (
                              <tr key={item.costCategoryId} className="border-t border-[#EEF2F6]">
                                <td className="py-2 pr-4 text-[#172B42]">{item.categoryName}</td>
                                <td className="py-2 text-right tabular-nums text-[#172B42]">{formatMoney(item.amount, entry.currency)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </EconomyStateBoundary>
      </div>
    </section>
  );
}
