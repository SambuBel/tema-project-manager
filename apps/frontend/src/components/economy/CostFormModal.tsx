import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Cost, Project } from '@tema/shared-types';
import { api } from '../../lib/api';
import { describeEconomicError, type DescribedError } from '../../lib/economicErrors';
import {
  MAX_COST_DESCRIPTION_LENGTH,
  costFormFromCost,
  emptyCostForm,
  toCreateCostDto,
  toUpdateCostDto,
  validateCostForm,
  type CostFormState,
} from '../../lib/costForm';
import { formatLocalDate } from '../../lib/dates';
import { DEFAULT_PROJECT_CURRENCY } from '../../lib/currencies';
import { useProjectBudget } from '../../hooks/useProjectBudget';
import { projectCostKey, projectCostsKey, useProjectCost } from '../../hooks/useProjectCosts';
import { ConfirmDialog } from '../ConfirmDialog';
import { EconomyDialog } from './EconomyDialog';
import { EconomyStateBoundary } from './EconomyStateBoundary';

interface CostFormModalProps {
  mode: 'create' | 'edit';
  project: Project;
  /** Solo en modo 'edit'. */
  costId?: string;
  onClose: () => void;
}

const inputClass =
  'w-full rounded-lg border border-[#DEE5EC] bg-white px-3 py-2 text-sm text-[#172B42] focus:outline focus:outline-2 focus:outline-sky-500 aria-[invalid=true]:border-red-400 disabled:bg-gray-50';
const labelClass = 'mb-1 block text-sm font-medium text-[#172B42]';

interface Option {
  id: string;
  name: string;
}

/**
 * Registrar o editar un costo (un solo formulario para ambos modos). Este componente arma el contexto —presupuesto vigente
 * (de ahí salen los rubros ofrecidos), tareas del proyecto y, al editar, el DETALLE actual del costo— y monta el formulario
 * recién cuando todo está listo. Al cerrar se descarta todo el estado.
 */
export function CostFormModal({ mode, project, costId, onClose }: CostFormModalProps) {
  const uid = useId();
  const qc = useQueryClient();
  const isEdit = mode === 'edit';
  // Mientras el diálogo de RN-21 está abierto, Escape debe cerrar solo ese diálogo y no también el formulario.
  const blockCloseRef = useRef(false);
  const [formSession, setFormSession] = useState(0);

  const budgetQuery = useProjectBudget(project.id);
  const tasksQuery = useQuery({
    // Misma consulta y misma clave que el tablero: no se crea una segunda fuente de tareas.
    queryKey: ['tasks', project.id],
    queryFn: () => api.listAllTasks({ projectId: project.id }),
  });
  const costQuery = useProjectCost(project.id, isEdit ? (costId ?? null) : null);

  const detailMissing = isEdit && costQuery.isError && costQuery.error && describeEconomicError(costQuery.error).kind === 'not-found';
  useEffect(() => {
    // El costo ya no existe: la lista que se está viendo quedó vieja.
    if (detailMissing) void qc.invalidateQueries({ queryKey: projectCostsKey(project.id) });
  }, [detailMissing, qc, project.id]);

  const reload = async () => {
    const result = await costQuery.refetch();
    if (result.error) throw result.error;
    setFormSession((n) => n + 1);
  };

  const title = isEdit ? 'Editar costo' : 'Registrar costo';
  const titleId = `${uid}-title`;
  const handleClose = () => {
    if (!blockCloseRef.current) onClose();
  };

  const cost = costQuery.data;
  const waitingBudget = budgetQuery.isLoading;
  const budgetError = !isEdit ? budgetQuery.error : null; // al editar, un presupuesto ilegible solo reduce los rubros ofrecidos
  const noBudget = !isEdit && !waitingBudget && !budgetError && budgetQuery.data === null;

  let body: React.ReactNode;
  if (isEdit && (costQuery.isError || costQuery.isLoading)) {
    body = (
      <>
        <EconomyStateBoundary isLoading={costQuery.isLoading} error={costQuery.error} loadingLabel="Cargando costo…" onRetry={() => void costQuery.refetch()}>
          {null}
        </EconomyStateBoundary>
        {costQuery.isError && <CloseRow onClose={onClose} />}
      </>
    );
  } else if (budgetError || waitingBudget) {
    body = (
      <>
        <EconomyStateBoundary isLoading={waitingBudget} error={budgetError} loadingLabel="Cargando presupuesto…" onRetry={() => void budgetQuery.refetch()}>
          {null}
        </EconomyStateBoundary>
        {!!budgetError && <CloseRow onClose={onClose} />}
      </>
    );
  } else if (noBudget) {
    body = (
      <>
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No se puede registrar un costo porque este proyecto no tiene un presupuesto vigente con rubros disponibles. Primero hay que definir el
          presupuesto.
        </p>
        <CloseRow onClose={onClose} />
      </>
    );
  } else {
    const budgetItems: Option[] = (budgetQuery.data?.items ?? []).map((item) => ({ id: item.costCategoryId, name: item.categoryName }));
    body = (
      <CostFormBody
        key={`${formSession}-${cost?.id ?? 'new'}-${cost?.revision ?? 0}`}
        mode={mode}
        project={project}
        currency={project.economicCurrency ?? cost?.currency ?? budgetQuery.data?.currency ?? DEFAULT_PROJECT_CURRENCY}
        cost={cost}
        budgetCategories={budgetItems}
        tasks={(tasksQuery.data ?? []).map((t) => ({ id: t.id, name: t.title }))}
        tasksLoading={tasksQuery.isLoading}
        tasksFailed={tasksQuery.isError}
        onRetryTasks={() => void tasksQuery.refetch()}
        onClose={onClose}
        onReload={reload}
        blockCloseRef={blockCloseRef}
      />
    );
  }

  return (
    <EconomyDialog title={title} titleId={titleId} onClose={handleClose} maxWidthClass="max-w-xl">
      {body}
    </EconomyDialog>
  );
}

function CloseRow({ onClose }: { onClose: () => void }) {
  return (
    <div className="mt-4 flex justify-end">
      <button type="button" onClick={onClose} className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] hover:bg-gray-50">
        Cerrar
      </button>
    </div>
  );
}

interface CostFormBodyProps {
  mode: 'create' | 'edit';
  project: Project;
  /** Moneda ÚNICA del proyecto: se muestra junto al monto, no se elige. */
  currency: string;
  /** Detalle ACTUAL del costo (solo en edición). */
  cost?: Cost;
  /** Rubros de las partidas del presupuesto vigente: lo único que se ofrece para ELEGIR. */
  budgetCategories: Option[];
  tasks: Option[];
  tasksLoading: boolean;
  tasksFailed: boolean;
  onRetryTasks: () => void;
  onClose: () => void;
  onReload: () => Promise<void>;
  blockCloseRef: React.MutableRefObject<boolean>;
}

interface PendingConfirmation {
  costDate: string;
  projectStartDate: string | null;
}

function CostFormBody({ mode, project, currency, cost, budgetCategories, tasks, tasksLoading, tasksFailed, onRetryTasks, onClose, onReload, blockCloseRef }: CostFormBodyProps) {
  const qc = useQueryClient();
  const uid = useId();
  const isEdit = mode === 'edit' && !!cost;

  const [form, setForm] = useState<CostFormState>(() => (isEdit ? costFormFromCost(cost) : emptyCostForm()));
  const [problem, setProblem] = useState<DescribedError | null>(null);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    blockCloseRef.current = pending !== null;
    return () => {
      blockCloseRef.current = false;
    };
  }, [pending, blockCloseRef]);

  const save = useMutation({
    retry: false,
    mutationFn: ({ confirm }: { confirm: boolean }) =>
      isEdit ? api.updateProjectCost(project.id, cost.id, toUpdateCostDto(form, cost, confirm)) : api.createProjectCost(project.id, toCreateCostDto(form, confirm)),
    onSuccess: async () => {
      // Nada de insertar una copia parcial en la caché: se vuelve a pedir lo que devuelve el backend.
      await Promise.all([
        qc.invalidateQueries({ queryKey: projectCostsKey(project.id) }),
        ...(isEdit ? [qc.invalidateQueries({ queryKey: projectCostKey(project.id, cost.id) })] : []),
      ]);
      onClose();
    },
    onError: (error, variables) => {
      const described = describeEconomicError(error);
      // RN-21: el PRIMER envío nunca lleva confirmación; solo si el backend la pide se abre el diálogo. Si ya se envió confirmada
      // y aun así la pide, se muestra como problema (no hay un segundo reenvío).
      if (described.kind === 'confirmation' && !variables.confirm) {
        const data = error instanceof Error && 'data' in error ? (error as { data?: Record<string, unknown> }).data : undefined;
        const costDate = typeof data?.costDate === 'string' ? data.costDate : form.costDate;
        const projectStartDate = typeof data?.projectStartDate === 'string' ? data.projectStartDate : null;
        setPending({ costDate, projectStartDate });
        return;
      }
      setPending(null);
      setProblem(described);
      if (described.kind === 'not-found') void qc.invalidateQueries({ queryKey: projectCostsKey(project.id) });
    },
  });

  const update = (patch: Partial<CostFormState>) => {
    setProblem(null);
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const issues = validateCostForm(form);
  const hasConflict = problem?.kind === 'conflict';
  const isGone = problem?.kind === 'not-found';
  const canSubmit = issues.blocking.length === 0 && !save.isPending && !hasConflict && !isGone;

  // Rubros: SOLO los del presupuesto vigente para elegir. Al editar, el rubro actual del costo se muestra aunque esté inactivo o
  // fuera del presupuesto vigente (no se reemplaza solo); si se lo cambia por otro, solo hay opciones válidas.
  const historicalCategory: Option | null =
    isEdit && !budgetCategories.some((c) => c.id === cost.costCategoryId) ? { id: cost.costCategoryId, name: cost.categoryName } : null;
  const historicalTask: Option | null = isEdit && cost.taskId && !tasks.some((t) => t.id === cost.taskId) ? { id: cost.taskId, name: cost.taskTitle ?? 'Tarea' } : null;

  const submit = (confirm: boolean) => {
    setProblem(null);
    setPending(null);
    save.mutate({ confirm });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    submit(false);
  };

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

  const showError = (field: keyof CostFormState) => !!form[field] && !!issues.fieldErrors[field];
  const errorId = (field: string) => `${uid}-${field}-error`;

  return (
    <>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <fieldset disabled={save.isPending} className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${uid}-date`} className={labelClass}>
                Fecha
              </label>
              <input
                id={`${uid}-date`}
                type="date"
                value={form.costDate}
                onChange={(e) => update({ costDate: e.target.value })}
                aria-invalid={!!issues.fieldErrors.costDate}
                aria-describedby={issues.fieldErrors.costDate ? errorId('date') : undefined}
                className={inputClass}
              />
              {issues.fieldErrors.costDate && (
                <p id={errorId('date')} className="mt-1 text-xs text-red-700">
                  {issues.fieldErrors.costDate}
                </p>
              )}
            </div>
            <div>
              <label htmlFor={`${uid}-amount`} className={labelClass}>
                Monto
              </label>
              <div className="flex">
                <input
                  id={`${uid}-amount`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.amount}
                  onChange={(e) => update({ amount: e.target.value })}
                  aria-invalid={showError('amount')}
                  aria-describedby={showError('amount') ? errorId('amount') : `${uid}-currency-note`}
                  className={`${inputClass} rounded-r-none`}
                />
                <span
                  id={`${uid}-currency`}
                  className="flex items-center rounded-r-lg border border-l-0 border-[#DEE5EC] bg-[#F4F6F8] px-3 text-sm font-medium text-[#172B42]"
                  title="Moneda del proyecto"
                >
                  {currency}
                </span>
              </div>
              <p id={`${uid}-currency-note`} className="mt-1 text-xs text-[#607185]">
                Moneda del proyecto: {currency}
              </p>
            </div>
          </div>
          {showError('amount') && (
            <p id={errorId('amount')} className="-mt-2 text-xs text-red-700">
              {issues.fieldErrors.amount}
            </p>
          )}
          <div>
            <label htmlFor={`${uid}-category`} className={labelClass}>
              Rubro
            </label>
            <select
              id={`${uid}-category`}
              value={form.costCategoryId}
              onChange={(e) => update({ costCategoryId: e.target.value })}
              aria-invalid={false}
              aria-describedby={historicalCategory ? `${uid}-category-hint` : undefined}
              className={inputClass}
            >
              <option value="">Elegí un rubro…</option>
              {historicalCategory && <option value={historicalCategory.id}>{`${historicalCategory.name} — rubro actual del costo (fuera del presupuesto vigente)`}</option>}
              {budgetCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {historicalCategory && (
              <p id={`${uid}-category-hint`} className="mt-1 text-xs text-amber-900">
                ⚠ El rubro «{historicalCategory.name}» ya no forma parte del presupuesto vigente. Podés dejarlo como está para editar otros datos; si lo cambiás,
                solo se ofrecen los rubros del presupuesto vigente.
              </p>
            )}
          </div>

          <div>
            <label htmlFor={`${uid}-description`} className={labelClass}>
              Descripción
            </label>
            <textarea
              id={`${uid}-description`}
              rows={3}
              maxLength={MAX_COST_DESCRIPTION_LENGTH + 50}
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              aria-invalid={showError('description')}
              aria-describedby={showError('description') ? errorId('description') : undefined}
              className={inputClass}
            />
            {showError('description') && (
              <p id={errorId('description')} className="mt-1 text-xs text-red-700">
                {issues.fieldErrors.description}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={`${uid}-task`} className={labelClass}>
              Tarea (opcional)
            </label>
            <select
              id={`${uid}-task`}
              value={form.taskId}
              onChange={(e) => update({ taskId: e.target.value })}
              disabled={tasksLoading}
              aria-describedby={tasksFailed ? `${uid}-task-hint` : undefined}
              className={inputClass}
            >
              <option value="">{tasksLoading ? 'Cargando tareas…' : 'Sin tarea'}</option>
              {historicalTask && <option value={historicalTask.id}>{historicalTask.name}</option>}
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
            </select>
            {tasksFailed && (
              <p id={`${uid}-task-hint`} className="mt-1 text-xs text-red-700">
                No se pudieron cargar las tareas.{' '}
                <button type="button" className="font-medium underline" onClick={onRetryTasks}>
                  Reintentar
                </button>
              </p>
            )}
          </div>
        </fieldset>

        {problem?.kind === 'conflict' && (
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">{problem.message}</p>
            <p className="mt-1">Recargá para ver el costo actualizado y volver a hacer tus cambios. No se guardó nada.</p>
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
        {problem?.kind === 'no-changes' && (
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
            {save.isPending ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Registrar costo'}
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={pending !== null}
        title="Fecha anterior al inicio del proyecto"
        description="La fecha del costo es anterior al inicio del proyecto."
        confirmLabel={isEdit ? 'Guardar igualmente' : 'Registrar igualmente'}
        variant="warning"
        isConfirming={save.isPending}
        onCancel={() => setPending(null)}
        onConfirm={() => submit(true)}
      >
        {pending && (
          <dl className="text-sm text-[#172B42]">
            <div className="flex gap-2">
              <dt className="text-[#607185]">Fecha del costo:</dt>
              <dd>{formatLocalDate(pending.costDate)}</dd>
            </div>
            {pending.projectStartDate && (
              <div className="flex gap-2">
                <dt className="text-[#607185]">Inicio del proyecto:</dt>
                <dd>{formatLocalDate(pending.projectStartDate)}</dd>
              </div>
            )}
          </dl>
        )}
      </ConfirmDialog>
    </>
  );
}
