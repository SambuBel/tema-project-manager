import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ResourceProfile } from '@tema/shared-types';
import { api } from '../../lib/api';
import { describeResourceProfileError, type DescribedError } from '../../lib/economicErrors';
import {
  MAX_PROFILE_NAME_LENGTH,
  emptyProfileForm,
  profileFormFromProfile,
  toCreateProfileDto,
  toUpdateProfileDto,
  validateProfileForm,
  type ResourceProfileFormState,
} from '../../lib/resourceProfileForm';
import { resourceProfilesKey } from '../../hooks/useResourceProfiles';
import { PROJECT_CURRENCY_OPTIONS, currencyOptionLabel } from '../../lib/currencies';
import { EconomyDialog } from './EconomyDialog';

interface ResourceProfileFormModalProps {
  mode: 'create' | 'edit';
  /** Perfil tal como estaba al abrir (de ahí salen el prellenado y `expectedRevision`). Solo en modo 'edit'. */
  profile?: ResourceProfile;
  onClose: () => void;
  /** Vuelve a pedir la lista; el padre vuelve a montar el formulario con el perfil actualizado. NO reenvía nada. */
  onReload: () => Promise<void>;
}

const inputClass =
  'w-full rounded-lg border border-[#DEE5EC] bg-white px-3 py-2 text-sm text-[#172B42] focus:outline focus:outline-2 focus:outline-sky-500 aria-[invalid=true]:border-red-400 disabled:bg-gray-50';
const labelClass = 'mb-1 block text-sm font-medium text-[#172B42]';

/**
 * Crear o editar un perfil de recurso (un solo formulario). Solo ADMIN llega acá (el backend lo hace cumplir igual). Cambiar la
 * tarifa o la moneda modifica ÚNICAMENTE el catálogo: no se toca ninguna asignación, presupuesto ni costo. Al cerrar se descarta
 * todo el estado.
 */
export function ResourceProfileFormModal({ mode, profile, onClose, onReload }: ResourceProfileFormModalProps) {
  const qc = useQueryClient();
  const uid = useId();
  const isEdit = mode === 'edit' && !!profile;

  const [form, setForm] = useState<ResourceProfileFormState>(() => (isEdit ? profileFormFromProfile(profile) : emptyProfileForm()));
  const [problem, setProblem] = useState<DescribedError | null>(null);
  const [reloading, setReloading] = useState(false);

  const save = useMutation({
    retry: false,
    mutationFn: () => (isEdit ? api.updateResourceProfile(profile.id, toUpdateProfileDto(form, profile)) : api.createResourceProfile(toCreateProfileDto(form))),
    onSuccess: async () => {
      // Se vuelve a pedir lo que devuelve el backend; nada de insertar una copia parcial. Solo el catálogo: no hay nada de
      // proyectos que recalcular.
      await qc.invalidateQueries({ queryKey: resourceProfilesKey });
      onClose();
    },
    onError: (error) => setProblem(describeResourceProfileError(error)),
  });

  const update = (patch: Partial<ResourceProfileFormState>) => {
    setProblem(null);
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const issues = validateProfileForm(form);
  const hasConflict = problem?.kind === 'conflict';
  const isGone = problem?.kind === 'not-found';
  const canSubmit = issues.blocking.length === 0 && !save.isPending && !hasConflict && !isGone;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setProblem(null);
    save.mutate();
  };

  const handleReload = async () => {
    setReloading(true);
    try {
      await onReload();
    } catch (error) {
      setProblem(describeResourceProfileError(error));
    } finally {
      setReloading(false);
    }
  };

  const showError = (field: 'name' | 'hourlyCost' | 'currency') => !!form[field] && !!issues.fieldErrors[field];
  const errorId = (field: string) => `${uid}-${field}-error`;
  const titleId = `${uid}-title`;

  return (
    <EconomyDialog title={isEdit ? 'Editar perfil de recurso' : 'Crear perfil de recurso'} titleId={titleId} onClose={onClose} maxWidthClass="max-w-lg">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <fieldset disabled={save.isPending} className="flex min-w-0 flex-col gap-4">
          <div>
            <label htmlFor={`${uid}-name`} className={labelClass}>
              Nombre
            </label>
            <input
              id={`${uid}-name`}
              type="text"
              autoComplete="off"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              aria-invalid={showError('name')}
              aria-describedby={showError('name') ? errorId('name') : undefined}
              className={inputClass}
            />
            {showError('name') && (
              <p id={errorId('name')} className="mt-1 text-xs text-red-700">
                {issues.fieldErrors.name}
              </p>
            )}
            <p className="mt-1 text-xs text-[#607185]">Hasta {MAX_PROFILE_NAME_LENGTH} caracteres. No puede repetirse dentro de la misma moneda.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
            <div>
              <label htmlFor={`${uid}-cost`} className={labelClass}>
                Tarifa por hora
              </label>
              <input
                id={`${uid}-cost`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.hourlyCost}
                onChange={(e) => update({ hourlyCost: e.target.value })}
                aria-invalid={showError('hourlyCost')}
                aria-describedby={showError('hourlyCost') ? errorId('cost') : undefined}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor={`${uid}-currency`} className={labelClass}>
                Moneda
              </label>
              <select
                id={`${uid}-currency`}
                value={form.currency}
                onChange={(e) => update({ currency: e.target.value })}
                aria-invalid={showError('currency')}
                aria-describedby={showError('currency') ? errorId('currency') : undefined}
                className={inputClass}
              >
                <option value="">Elegí una moneda…</option>
                {PROJECT_CURRENCY_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {currencyOptionLabel(option)}
                  </option>
                ))}
                {form.currency !== '' && !PROJECT_CURRENCY_OPTIONS.some((option) => option.code === form.currency) && <option value={form.currency}>{form.currency}</option>}
              </select>
            </div>
          </div>
          {showError('hourlyCost') && (
            <p id={errorId('cost')} className="-mt-2 text-xs text-red-700">
              {issues.fieldErrors.hourlyCost}
            </p>
          )}
          {showError('currency') && (
            <p id={errorId('currency')} className="-mt-2 text-xs text-red-700">
              {issues.fieldErrors.currency}
            </p>
          )}

          {isEdit && (
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[#172B42]">
                <input type="checkbox" checked={form.active} onChange={(e) => update({ active: e.target.checked })} aria-describedby={`${uid}-active-hint`} />
                Activo
              </label>
              <p id={`${uid}-active-hint`} className="mt-1 text-xs text-[#607185]">
                Un perfil inactivo deja de estar disponible para nuevas asignaciones. Las asignaciones existentes no se modifican.
              </p>
            </div>
          )}
        </fieldset>

        {problem?.kind === 'conflict' && (
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">{problem.message}</p>
            <p className="mt-1">Recargá para ver el perfil actualizado y volver a hacer tus cambios. No se guardó nada.</p>
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
            {save.isPending ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear perfil'}
          </button>
        </div>
      </form>
    </EconomyDialog>
  );
}
