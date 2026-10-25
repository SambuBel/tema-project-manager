import { useState } from 'react';
import type { Project } from '@tema/shared-types';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useProjectBudget } from '../../hooks/useProjectBudget';
import { canDefineBudgetUI } from '../../lib/permissions';
import { formatLocalDate } from '../../lib/dates';
import { formatMoney } from '../../lib/money';
import { BudgetFormModal } from './BudgetFormModal';
import { DEFAULT_PROJECT_CURRENCY } from '../../lib/currencies';
import { BudgetHistory } from './BudgetHistory';
import { EconomyStateBoundary } from './EconomyStateBoundary';

interface BudgetSectionProps {
  project: Project;
}

/**
 * Sección "Presupuesto" de Economía: presupuesto vigente con sus partidas, creación (ADMIN/PM), nueva versión (ADMIN/PM) e
 * historial. El líder real ve el presupuesto y el historial pero no los botones de escritura (el backend lo hace cumplir igual).
 * No calcula nada económico: muestra lo que devuelve el backend.
 */
export function BudgetSection({ project }: BudgetSectionProps) {
  const { user } = useCurrentUser();
  const canDefine = !!user && canDefineBudgetUI(user);
  const [formMode, setFormMode] = useState<'create' | 'version' | null>(null);
  // Cada vez que se recarga tras un conflicto, el formulario se vuelve a montar con el vigente más reciente.
  const [formSession, setFormSession] = useState(0);
  const [showHistory, setShowHistory] = useState(false);

  const budgetQuery = useProjectBudget(project.id);
  const budget = budgetQuery.data;
  // Moneda ÚNICA del proyecto: la define el proyecto, no el formulario. (El proyecto la trae siempre para quien ve lo económico.)
  const projectCurrency = project.economicCurrency ?? budget?.currency ?? DEFAULT_PROJECT_CURRENCY;

  const reload = async () => {
    const result = await budgetQuery.refetch();
    if (result.error) throw result.error;
    // Si lo que se estaba creando ya existe (otro usuario lo creó), no hay nada más que crear.
    if (formMode === 'create' && result.data) setFormMode(null);
    else setFormSession((n) => n + 1);
  };

  return (
    <div className="flex flex-col gap-6">
      <EconomyStateBoundary isLoading={budgetQuery.isLoading} error={budgetQuery.error} loadingLabel="Cargando presupuesto…" onRetry={() => void budgetQuery.refetch()}>
        {budget === null && (
          <section className="rounded-xl border border-[#DEE5EC] bg-white p-6 text-center">
            <p className="text-sm text-[#172B42]">Este proyecto todavía no tiene presupuesto.</p>
            {canDefine && (
              <button
                type="button"
                onClick={() => setFormMode('create')}
                className="mt-4 rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a445b]"
              >
                Crear presupuesto
              </button>
            )}
          </section>
        )}

        {budget && (
          <>
            <section aria-labelledby="budget-current-title" className="rounded-xl border border-[#DEE5EC] bg-white p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 id="budget-current-title" className="text-base font-semibold text-[#172B42]">
                    Presupuesto vigente
                  </h3>
                  <p className="mt-1 text-sm text-[#607185]">Versión {budget.version}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-expanded={showHistory}
                    onClick={() => setShowHistory((open) => !open)}
                    className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] hover:bg-gray-50"
                  >
                    {showHistory ? 'Ocultar historial' : 'Ver historial'}
                  </button>
                  {canDefine && (
                    <button
                      type="button"
                      onClick={() => setFormMode('version')}
                      className="rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a445b]"
                    >
                      Nueva versión
                    </button>
                  )}
                </div>
              </div>

              <p className="mt-4 text-2xl font-semibold tabular-nums text-[#172B42]">{formatMoney(budget.totalAmount, budget.currency)}</p>
              <p className="mt-1 text-sm text-[#607185]">Fecha de aprobación: {formatLocalDate(budget.approvalDate)}</p>

              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[20rem] text-left text-sm">
                  <caption className="sr-only">Partidas del presupuesto vigente</caption>
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
                    {budget.items.map((item) => (
                      <tr key={item.costCategoryId} className="border-t border-[#EEF2F6]">
                        <td className="py-2 pr-4 text-[#172B42]">{item.categoryName}</td>
                        <td className="py-2 text-right tabular-nums text-[#172B42]">{formatMoney(item.amount, budget.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {showHistory && <BudgetHistory projectId={project.id} />}
          </>
        )}
      </EconomyStateBoundary>

      {formMode === 'create' && budget === null && (
        <BudgetFormModal key={`create-${formSession}`} mode="create" projectId={project.id} currency={projectCurrency} onClose={() => setFormMode(null)} onReload={reload} />
      )}
      {formMode === 'version' && budget && (
        <BudgetFormModal key={`version-${formSession}-${budget.id}`} mode="version" projectId={project.id} currency={projectCurrency} current={budget} onClose={() => setFormMode(null)} onReload={reload} />
      )}
    </div>
  );
}
