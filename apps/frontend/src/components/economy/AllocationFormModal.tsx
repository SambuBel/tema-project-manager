import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MemberResourceAllocation } from '@tema/shared-types';
import { api } from '../../lib/api';
import { describeAllocationError, type DescribedError } from '../../lib/economicErrors';
import { allocationFormFromMember, currentProfileId, toAllocationDto, validateAllocationForm, type AllocationFormState } from '../../lib/allocationForm';
import { formatMoney } from '../../lib/money';
import { memberAllocationHistoryKey, projectResourceAllocationKey } from '../../hooks/useProjectResourceAllocation';
import { resourceProfilesKey, useResourceProfiles } from '../../hooks/useResourceProfiles';
import { EconomyDialog } from './EconomyDialog';

interface AllocationFormModalProps {
  projectId: string;
  /** Moneda ÚNICA del proyecto: solo se ofrecen perfiles de esta moneda (el backend igual lo valida). */
  currency: string;
  /** Miembro tal como estaba al abrir (de ahí salen el prellenado y `expectedRevision`: 0 si todavía no tiene asignación). */
  member: MemberResourceAllocation;
  onClose: () => void;
  /** Vuelve a pedir la asignación del proyecto; el padre vuelve a montar el formulario con lo nuevo. NO reenvía nada. */
  onReload: () => Promise<void>;
  /** El miembro ya no está en el proyecto: el padre cierra el modal y refresca la lista. */
  onMemberGone: (message: string) => void;
}

const inputClass =
  'w-full rounded-lg border border-[#DEE5EC] bg-white px-3 py-2 text-sm text-[#172B42] focus:outline focus:outline-2 focus:outline-sky-500 aria-[invalid=true]:border-red-400 disabled:bg-gray-50';
const labelClass = 'mb-1 block text-sm font-medium text-[#172B42]';

/**
 * Asignar o cambiar el perfil de recurso y/o las horas estimadas de un miembro (misma pantalla para la primera asignación y para
 * editar). El catálogo de perfiles sirve SOLO para elegir un perfil NUEVO: el perfil actual se muestra con su snapshot (la
 * tarifa con la que se asignó), aunque hoy el catálogo diga otra cosa o el perfil esté inactivo, y conservarlo nunca refresca su
 * tarifa. No hay ninguna cuenta acá: el costo, la tarifa y la moneda definitivos los devuelve el backend tras guardar.
 */
export function AllocationFormModal({ projectId, currency, member, onClose, onReload, onMemberGone }: AllocationFormModalProps) {
  const qc = useQueryClient();
  const uid = useId();
  const allocation = member.allocation;
  const currentProfile = allocation?.resourceProfile ?? null;

  const [form, setForm] = useState<AllocationFormState>(() => allocationFormFromMember(member));
  const [problem, setProblem] = useState<DescribedError | null>(null);
  const [reloading, setReloading] = useState(false);

  const profilesQuery = useResourceProfiles(false);
  const catalog = profilesQuery.data ?? [];
  const currentIsActive = !!currentProfile && catalog.some((p) => p.id === currentProfile.id);
  // Mientras el catálogo no cargó no se puede afirmar que el perfil actual esté inactivo.
  const currentIsInactive = !!currentProfile && profilesQuery.isSuccess && !currentIsActive;

  const save = useMutation({
    retry: false,
    mutationFn: () => api.updateMemberResourceAllocation(projectId, member.projectMemberId, toAllocationDto(form, member)),
    onSuccess: async () => {
      // Se vuelve a pedir lo que devuelve el backend (snapshot, costo, presupuesto, revisión). No se toca el catálogo de perfiles.
      await Promise.all([
        qc.invalidateQueries({ queryKey: projectResourceAllocationKey(projectId) }),
        qc.invalidateQueries({ queryKey: memberAllocationHistoryKey(projectId, member.projectMemberId) }),
      ]);
      onClose();
    },
    onError: (error) => {
      const described = describeAllocationError(error);
      if (described.code === 'PROJECT_MEMBER_NOT_FOUND') {
        onMemberGone(described.message);
        return;
      }
      setProblem(described);
      // El perfil elegido cambió de estado en el catálogo: se actualiza el selector, sin reintentar el PATCH ni tocar la asignación.
      if (described.code === 'RESOURCE_PROFILE_INACTIVE' || described.code === 'RESOURCE_PROFILE_NOT_FOUND') {
        void qc.invalidateQueries({ queryKey: resourceProfilesKey });
      }
    },
  });

  const update = (patch: Partial<AllocationFormState>) => {
    setProblem(null);
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const issues = validateAllocationForm(form);
  const hasConflict = problem?.kind === 'conflict';
  const canSubmit = issues.blocking.length === 0 && !save.isPending && !hasConflict;

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
      const described = describeAllocationError(error);
      if (described.code === 'PROJECT_MEMBER_NOT_FOUND') onMemberGone(described.message);
      else setProblem(described);
    } finally {
      setReloading(false);
    }
  };

  const originalId = currentProfileId(member);
  // Solo perfiles de la moneda del proyecto: un perfil de otra moneda no puede asignarse (RESOURCE_PROFILE_CURRENCY_MISMATCH).
  const otherProfiles = catalog.filter((p) => p.id !== originalId && p.currency === currency);
  // Un perfil elegido que ya no está disponible (se desactivó mientras el formulario estaba abierto) se marca, no se esconde.
  const selectedGone = form.resourceProfileId !== '' && form.resourceProfileId !== originalId && profilesQuery.isSuccess && !catalog.some((p) => p.id === form.resourceProfileId && p.currency === currency);

  const hoursErrorId = `${uid}-hours-error`;
  const showHoursError = !!form.estimatedHours && !!issues.hoursError;
  const titleId = `${uid}-title`;

  return (
    <EconomyDialog title={allocation ? 'Editar asignación' : 'Asignar recursos'} titleId={titleId} onClose={onClose} maxWidthClass="max-w-lg">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-[#607185]">
          Miembro: <span className="font-medium text-[#172B42]">{member.user.name}</span>
        </p>

        <fieldset disabled={save.isPending} className="flex min-w-0 flex-col gap-4">
          <div>
            <label htmlFor={`${uid}-profile`} className={labelClass}>
              Perfil de recurso
            </label>
            <select
              id={`${uid}-profile`}
              value={form.resourceProfileId}
              onChange={(e) => update({ resourceProfileId: e.target.value })}
              aria-describedby={`${uid}-profile-hint`}
              className={inputClass}
            >
              <option value="">Sin perfil</option>
              {currentProfile && (
                <option value={currentProfile.id} disabled={currentIsInactive}>
                  {currentIsInactive
                    ? `${currentProfile.name} — perfil actual inactivo (${formatMoney(currentProfile.hourlyCost, currentProfile.currency)} / h)`
                    : `${currentProfile.name} — ${formatMoney(currentProfile.hourlyCost, currentProfile.currency)} / h (asignado)`}
                </option>
              )}
              {otherProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {`${profile.name} — ${formatMoney(profile.hourlyCost, profile.currency)} / h`}
                </option>
              ))}
            </select>
            <p id={`${uid}-profile-hint`} className="mt-1 text-xs text-[#607185]">
              {currentProfile
                ? `El perfil asignado conserva la tarifa con la que se asignó. Al elegir otro perfil se usa su tarifa actual del catálogo.`
                : 'Al asignar un perfil se usa su tarifa actual del catálogo.'}{' '}
              Solo se ofrecen perfiles en {currency}, la moneda del proyecto.
            </p>
            {profilesQuery.isLoading && <p className="mt-1 text-xs text-[#607185]">Cargando perfiles…</p>}
            {profilesQuery.isError && (
              <p className="mt-1 text-xs text-red-700">
                No se pudieron cargar los perfiles del catálogo.{' '}
                <button type="button" className="font-medium underline" onClick={() => void profilesQuery.refetch()}>
                  Reintentar
                </button>
              </p>
            )}
            {selectedGone && <p className="mt-1 text-xs font-medium text-amber-900">⚠ El perfil elegido ya no está disponible. Elegí otro.</p>}
          </div>

          <div>
            <label htmlFor={`${uid}-hours`} className={labelClass}>
              Horas estimadas
            </label>
            <input
              id={`${uid}-hours`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={form.estimatedHours}
              onChange={(e) => update({ estimatedHours: e.target.value })}
              aria-invalid={showHoursError}
              aria-describedby={showHoursError ? hoursErrorId : `${uid}-hours-hint`}
              className={inputClass}
            />
            {showHoursError ? (
              <p id={hoursErrorId} className="mt-1 text-xs text-red-700">
                {issues.hoursError}
              </p>
            ) : (
              <p id={`${uid}-hours-hint`} className="mt-1 text-xs text-[#607185]">
                Dejalo vacío para no tener horas. El costo estimado lo calcula el sistema al guardar.
              </p>
            )}
          </div>
        </fieldset>

        {problem?.kind === 'conflict' && (
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">{problem.message}</p>
            <p className="mt-1">Recargá para ver la asignación actualizada y volver a hacer tus cambios. No se guardó nada.</p>
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

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] hover:bg-gray-50">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a445b] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </EconomyDialog>
  );
}
