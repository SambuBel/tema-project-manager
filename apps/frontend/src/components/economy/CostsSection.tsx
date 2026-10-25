import { useEffect, useState } from 'react';
import type { Project } from '@tema/shared-types';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { COSTS_PAGE_SIZE, useProjectCosts } from '../../hooks/useProjectCosts';
import { canManageCostsUI } from '../../lib/permissions';
import { formatLocalDate } from '../../lib/dates';
import { formatAmount } from '../../lib/money';
import { Pagination } from '../Pagination';
import { CostFormModal } from './CostFormModal';
import { EconomyStateBoundary } from './EconomyStateBoundary';

interface CostsSectionProps {
  project: Project;
}

type FormState = { mode: 'create' } | { mode: 'edit'; costId: string } | null;

/**
 * Sección "Costos" de Economía: costos reales del proyecto, paginados por el backend, con alta y edición para quien puede
 * administrarlos. No hay eliminación (no existe endpoint aprobado) ni cálculos de disponible/ejecución (pendientes de TEMA).
 */
export function CostsSection({ project }: CostsSectionProps) {
  const { user } = useCurrentUser();
  const canManage = !!user && canManageCostsUI(user, project);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormState>(null);

  const costsQuery = useProjectCosts(project.id, page);
  const result = costsQuery.data;

  // Si la página pedida quedó fuera de rango (por ejemplo, se acortó la lista), se vuelve a la última que existe.
  useEffect(() => {
    if (result && result.data.length === 0 && page > 1) setPage(Math.max(1, result.totalPages));
  }, [result, page]);

  const hasCosts = !!result && result.total > 0;

  return (
    <div className="flex flex-col gap-4">
      <EconomyStateBoundary isLoading={costsQuery.isLoading} error={costsQuery.error} loadingLabel="Cargando costos…" onRetry={() => void costsQuery.refetch()}>
        {result && !hasCosts && (
          <section className="rounded-xl border border-[#DEE5EC] bg-white p-6 text-center">
            <p className="text-sm text-[#172B42]">No hay costos registrados.</p>
            {canManage && (
              <button type="button" onClick={() => setForm({ mode: 'create' })} className="mt-4 rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a445b]">
                Registrar costo
              </button>
            )}
          </section>
        )}

        {result && hasCosts && (
          <section aria-labelledby="costs-title" className="rounded-xl border border-[#DEE5EC] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-6">
              <div>
                <h3 id="costs-title" className="text-base font-semibold text-[#172B42]">
                  Costos
                </h3>
                <p className="mt-1 text-sm text-[#607185]">{result.total === 1 ? '1 costo registrado' : `${result.total} costos registrados`}</p>
              </div>
              {canManage && (
                <button type="button" onClick={() => setForm({ mode: 'create' })} className="rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a445b]">
                  Registrar costo
                </button>
              )}
            </div>

            {/* Tabla: desktop */}
            <div className={`hidden overflow-x-auto sm:block ${costsQuery.isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={costsQuery.isPlaceholderData}>
              <table className="w-full min-w-[48rem] text-left text-sm">
                <caption className="sr-only">Costos del proyecto</caption>
                <thead>
                  <tr className="border-y border-[#DEE5EC] bg-[#F4F6F8] text-xs uppercase text-[#607185]">
                    {['Fecha', 'Rubro', 'Descripción', 'Tarea'].map((label) => (
                      <th key={label} scope="col" className="px-4 py-2 font-medium">
                        {label}
                      </th>
                    ))}
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Monto
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Moneda
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Creado por
                    </th>
                    {canManage && (
                      <th scope="col" className="px-4 py-2 font-medium">
                        Acciones
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((cost) => (
                    <tr key={cost.id} className="border-b border-[#EEF2F6] align-top">
                      <td className="whitespace-nowrap px-4 py-3">{formatLocalDate(cost.costDate)}</td>
                      <td className="px-4 py-3">{cost.categoryName}</td>
                      <td className="max-w-[18rem] break-words px-4 py-3">{cost.description}</td>
                      <td className="px-4 py-3 text-[#607185]">{cost.taskTitle ?? 'Sin tarea'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatAmount(cost.amount)}</td>
                      <td className="px-4 py-3">{cost.currency}</td>
                      <td className="px-4 py-3">{cost.createdByUser.name}</td>
                      {canManage && (
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            aria-label={`Editar costo: ${cost.description}`}
                            onClick={() => setForm({ mode: 'edit', costId: cost.id })}
                            className="rounded-md border border-[#DEE5EC] bg-white px-3 py-1 text-sm font-medium text-[#245B78] hover:bg-[#EAF2F7]"
                          >
                            Editar
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cards: mobile */}
            <ul className={`flex flex-col divide-y divide-[#DEE5EC] border-t border-[#DEE5EC] sm:hidden ${costsQuery.isPlaceholderData ? 'opacity-60' : ''}`}>
              {result.data.map((cost) => (
                <li key={cost.id} className="flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-[#172B42]">{cost.categoryName}</p>
                    <p className="shrink-0 text-right font-semibold tabular-nums text-[#172B42]">
                      {formatAmount(cost.amount)} <span className="text-xs font-medium text-[#607185]">{cost.currency}</span>
                    </p>
                  </div>
                  <p className="break-words text-sm text-[#172B42]">{cost.description}</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[#607185]">
                    <dt>Fecha</dt>
                    <dd>{formatLocalDate(cost.costDate)}</dd>
                    <dt>Tarea</dt>
                    <dd>{cost.taskTitle ?? 'Sin tarea'}</dd>
                    <dt>Creado por</dt>
                    <dd>{cost.createdByUser.name}</dd>
                  </dl>
                  {canManage && (
                    <div>
                      <button
                        type="button"
                        aria-label={`Editar costo: ${cost.description}`}
                        onClick={() => setForm({ mode: 'edit', costId: cost.id })}
                        className="rounded-md border border-[#DEE5EC] bg-white px-3 py-1.5 text-sm font-medium text-[#245B78] hover:bg-[#EAF2F7]"
                      >
                        Editar
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <div className="border-t border-[#DEE5EC] p-4">
              <Pagination page={result.page} totalPages={result.totalPages} onPageChange={setPage} />
              <p className="sr-only" aria-live="polite">{`Página ${result.page} de ${Math.max(1, result.totalPages)}`}</p>
            </div>
          </section>
        )}
      </EconomyStateBoundary>

      {form && canManage && (
        <CostFormModal
          key={form.mode === 'edit' ? `edit-${form.costId}` : 'create'}
          mode={form.mode}
          project={project}
          costId={form.mode === 'edit' ? form.costId : undefined}
          onClose={() => setForm(null)}
        />
      )}
    </div>
  );
}

export { COSTS_PAGE_SIZE };
