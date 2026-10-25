import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Budget, CostCategory } from '@tema/shared-types';
import { api } from '../../lib/api';
import {
  budgetFormFromCurrent,
  duplicatedCategoryIds,
  emptyBudgetForm,
  emptyItem,
  inactiveCategoryKeys,
  summarizeSum,
  toCreateDto,
  toVersionDto,
  validateBudgetForm,
  type BudgetFormState,
} from '../../lib/budgetForm';
import { describeEconomicError, economicQueryRetry, type DescribedError } from '../../lib/economicErrors';
import { formatMoney, normalizeAmountInput } from '../../lib/money';
import { projectBudgetHistoryKey, projectBudgetKey } from '../../hooks/useProjectBudget';
import { EconomyDialog } from './EconomyDialog';

interface BudgetFormModalProps {
  mode: 'create' | 'version';
  /** UUID del proyecto (los endpoints de presupuesto no aceptan slug). */
  projectId: string;
  /** Moneda ÚNICA del proyecto (`Project.economicCurrency`): se muestra, no se elige. */
  currency: string;
  /** Presupuesto vigente más reciente: solo en modo 'version' (de ahí salen el prellenado y `expectedVersion`). */
  current?: Budget;
  onClose: () => void;
  /** Vuelve a pedir el presupuesto vigente; después de resolverse, el padre vuelve a montar el formulario con lo nuevo. */
  onReload: () => Promise<void>;
}

const inputClass =
  'w-full rounded-lg border border-[#DEE5EC] bg-white px-3 py-2 text-sm text-[#172B42] focus:outline focus:outline-2 focus:outline-sky-500 aria-[invalid=true]:border-red-400';
const labelClass = 'mb-1 block text-sm font-medium text-[#172B42]';

/**
 * Crear el presupuesto inicial o una nueva versión (ADMIN y PROGRAM_MANAGER). El estado se arma al montar —vacío, o a partir
 * del vigente más reciente— y se descarta al cerrar. Todo importe viaja como texto. La suma de partidas contra el total es
 * solo ayuda visual: el backend vuelve a validar todo y es la autoridad.
 */
export function BudgetFormModal({ mode, projectId, currency, current, onClose, onReload }: BudgetFormModalProps) {
  const qc = useQueryClient();
  const uid = useId();
  const isVersion = mode === 'version' && !!current;

  const [form, setForm] = useState<BudgetFormState>(() => (isVersion ? budgetFormFromCurrent(current) : emptyBudgetForm(currency)));
  const [problem, setProblem] = useState<DescribedError | null>(null);
  const [reloading, setReloading] = useState(false);

  const categoriesQuery = useQuery<CostCategory[]>({
    queryKey: ['cost-categories'],
    queryFn: api.listCostCategories,
    retry: economicQueryRetry,
    staleTime: 60_000,
  });
  const categories = categoriesQuery.data ?? [];
  // Hasta que el catálogo cargue no se puede decir que un rubro esté inactivo (si no, toda partida prellenada se marcaría mal).
  const activeCatalog = categoriesQuery.isSuccess ? categories : null;

  const save = useMutation({
    retry: false,
    mutationFn: () => (isVersion ? api.createProjectBudgetVersion(projectId, toVersionDto(form, current.version)) : api.createProjectBudget(projectId, toCreateDto(form))),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: projectBudgetKey(projectId) }),
        qc.invalidateQueries({ queryKey: projectBudgetHistoryKey(projectId) }),
      ]);
      onClose();
    },
    onError: (error) => setProblem(describeEconomicError(error)),
  });

  const update = (patch: Partial<BudgetFormState>) => {
    setProblem(null);
    setForm((prev) => ({ ...prev, ...patch }));
  };
  const updateItem = (key: string, patch: Partial<BudgetFormState['items'][number]>) => {
    setProblem(null);
    setForm((prev) => ({ ...prev, items: prev.items.map((item) => (item.key === key ? { ...item, ...patch } : item)) }));
  };

  const issues = validateBudgetForm(form, activeCatalog);
  const sum = summarizeSum(form);
  const inactiveKeys = inactiveCategoryKeys(form, activeCatalog);
  const normalizedTotal = normalizeAmountInput(form.totalAmount);
  const hasConflict = problem?.kind === 'conflict';
  const categoriesReady = categoriesQuery.isSuccess;
  const canSubmit = categoriesReady && issues.blocking.length === 0 && !save.isPending && !hasConflict;

  const handleReload = async () => {
    setReloading(true);
    try {
      await onReload();
    } catch (error) {
      setProblem(describeEconomicError(error));
    } finally {
      setReloading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setProblem(null);
    save.mutate();
  };

  const takenElsewhere = (key: string) => new Set(form.items.filter((i) => i.key !== key && i.costCategoryId !== '').map((i) => i.costCategoryId));
  const duplicated = duplicatedCategoryIds(form);

  const titleId = `${uid}-title`;
  const title = isVersion ? `Nueva versión del presupuesto (parte de la versión ${current.version})` : 'Crear presupuesto';

  return (
    <EconomyDialog title={title} titleId={titleId} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-total`} className={labelClass}>
              Total del presupuesto
            </label>
            <div className="flex">
              <span className="flex items-center rounded-l-lg border border-r-0 border-[#DEE5EC] bg-[#F4F6F8] px-3 text-sm font-medium text-[#172B42]" aria-hidden="true">
                {currency}
              </span>
              <input
                id={`${uid}-total`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.totalAmount}
                onChange={(e) => update({ totalAmount: e.target.value })}
                aria-invalid={!!form.totalAmount && !!issues.fieldErrors.totalAmount}
                aria-describedby={form.totalAmount && issues.fieldErrors.totalAmount ? `${uid}-total-error` : undefined}
                className={`${inputClass} rounded-l-none`}
              />
            </div>
            {form.totalAmount && issues.fieldErrors.totalAmount && (
              <p id={`${uid}-total-error`} className="mt-1 text-xs text-red-700">
                {issues.fieldErrors.totalAmount}
              </p>
            )}
          </div>
          <div>
            <label htmlFor={`${uid}-date`} className={labelClass}>
              Fecha de aprobación
            </label>
            <input id={`${uid}-date`} type="date" value={form.approvalDate} onChange={(e) => update({ approvalDate: e.target.value })} className={inputClass} />
          </div>
        </div>

        <p className="text-sm text-[#607185]">
          Moneda del proyecto: <span className="font-medium text-[#172B42]">{currency}</span>. Todas las partidas y las nuevas versiones usan esta moneda.
        </p>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold text-[#172B42]">Partidas</legend>

          {categoriesQuery.isError && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {describeEconomicError(categoriesQuery.error).message}{' '}
              <button type="button" className="font-medium underline" onClick={() => void categoriesQuery.refetch()}>
                Reintentar
              </button>
            </p>
          )}
          {categoriesQuery.isLoading && (
            <p role="status" className="text-sm text-[#607185]">
              Cargando rubros…
            </p>
          )}

          <ul className="flex flex-col gap-3">
            {form.items.map((item, index) => {
              const taken = takenElsewhere(item.key);
              const isInactive = inactiveKeys.has(item.key);
              const error = issues.itemErrors[item.key];
              const showError = !!error && (isInactive || item.costCategoryId !== '' || item.amount !== '');
              const selectId = `${uid}-cat-${item.key}`;
              const amountId = `${uid}-amount-${item.key}`;
              const errorId = `${uid}-item-error-${item.key}`;
              return (
                <li key={item.key} className={`rounded-lg border p-3 ${isInactive ? 'border-amber-300 bg-amber-50' : 'border-[#DEE5EC]'}`}>
                  <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
                    <div>
                      <label htmlFor={selectId} className={labelClass}>
                        Rubro <span className="sr-only">de la partida {index + 1}</span>
                      </label>
                      <select
                        id={selectId}
                        value={item.costCategoryId}
                        onChange={(e) => updateItem(item.key, { costCategoryId: e.target.value, categoryName: undefined })}
                        aria-invalid={showError}
                        aria-describedby={showError ? errorId : undefined}
                        className={inputClass}
                      >
                        <option value="">Elegí un rubro…</option>
                        {isInactive && (
                          <option value={item.costCategoryId}>{`${item.categoryName ?? 'Rubro'} — rubro inactivo (no disponible para nuevas versiones)`}</option>
                        )}
                        {categories.map((category) => (
                          <option key={category.id} value={category.id} disabled={taken.has(category.id)}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={amountId} className={labelClass}>
                        Importe <span className="sr-only">de la partida {index + 1}</span>
                      </label>
                      <input
                        id={amountId}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={item.amount}
                        onChange={(e) => updateItem(item.key, { amount: e.target.value })}
                        aria-invalid={showError && !isInactive && item.costCategoryId !== '' && !duplicated.has(item.costCategoryId)}
                        className={inputClass}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setProblem(null);
                        setForm((prev) => ({ ...prev, items: prev.items.filter((i) => i.key !== item.key) }));
                      }}
                      aria-label={`Eliminar la partida ${index + 1}`}
                      className="rounded-lg border border-[#DEE5EC] bg-white px-3 py-2 text-sm text-[#607185] hover:bg-gray-50"
                    >
                      Eliminar
                    </button>
                  </div>
                  {showError && (
                    <p id={errorId} className={`mt-2 text-xs ${isInactive ? 'font-medium text-amber-900' : 'text-red-700'}`}>
                      {isInactive ? '⚠ ' : ''}
                      {error}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <div>
            <button
              type="button"
              onClick={() => {
                setProblem(null);
                setForm((prev) => ({ ...prev, items: [...prev.items, emptyItem()] }));
              }}
              className="rounded-lg border border-[#DEE5EC] bg-white px-3 py-2 text-sm font-medium text-[#245B78] hover:bg-[#EAF2F7]"
            >
              + Agregar partida
            </button>
          </div>
        </fieldset>

        <div className="rounded-lg bg-[#F4F6F8] p-4 text-sm" aria-live="polite">
          <p className="flex flex-wrap justify-between gap-2">
            <span className="text-[#607185]">Total presupuesto:</span>
            <span className="font-medium tabular-nums text-[#172B42]">{normalizedTotal ? formatMoney(normalizedTotal, currency) : '—'}</span>
          </p>
          <p className="mt-1 flex flex-wrap justify-between gap-2">
            <span className="text-[#607185]">Suma de partidas:</span>
            <span className="font-medium tabular-nums text-[#172B42]">
              {formatMoney(sum.itemsTotal, currency)}
              {sum.status.kind === 'match' && <span className="ml-2 text-emerald-800">✓ coincide</span>}
            </span>
          </p>
          {sum.status.kind === 'missing' && (
            <p className="mt-1 text-amber-900">
              ⚠ Faltan: <span className="tabular-nums">{formatMoney(sum.status.difference, currency)}</span>
            </p>
          )}
          {sum.status.kind === 'excess' && (
            <p className="mt-1 text-amber-900">
              ⚠ Se pasan por: <span className="tabular-nums">{formatMoney(sum.status.difference, currency)}</span>
            </p>
          )}
        </div>

        {problem && problem.kind === 'conflict' && (
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">{problem.message}</p>
            <p className="mt-1">Recargá para ver el presupuesto actualizado y volver a hacer tus cambios. No se guardó nada.</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => void handleReload()} disabled={reloading} className="rounded-md bg-[#245B78] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1a445b] disabled:opacity-50">
                {reloading ? 'Recargando…' : 'Recargar'}
              </button>
              <button type="button" onClick={onClose} className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100">
                Cancelar
              </button>
            </div>
          </div>
        )}
        {problem && problem.kind === 'no-changes' && (
          <p role="status" className="rounded-lg border border-[#DEE5EC] bg-[#F4F6F8] px-4 py-3 text-sm text-[#172B42]">
            {problem.message}
          </p>
        )}
        {problem && problem.kind !== 'conflict' && problem.kind !== 'no-changes' && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {problem.message}
          </p>
        )}

        {issues.blocking.length > 0 && (
          <div id={`${uid}-blocking`} className="text-xs text-[#607185]">
            <p className="font-medium">Para guardar:</p>
            <ul className="list-disc pl-5">
              {issues.blocking.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] hover:bg-gray-50">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            aria-describedby={issues.blocking.length > 0 ? `${uid}-blocking` : undefined}
            className="rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a445b] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {save.isPending ? 'Guardando…' : isVersion ? 'Guardar nueva versión' : 'Crear presupuesto'}
          </button>
        </div>
      </form>
    </EconomyDialog>
  );
}
