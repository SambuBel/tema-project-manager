import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ResourceProfile } from '@tema/shared-types';
import { ApiRequestError, api } from '../lib/api';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { resourceProfilesKey, useResourceProfiles } from '../hooks/useResourceProfiles';
import { canManageResourceProfilesUI } from '../lib/permissions';
import { describeResourceProfileError, type DescribedError } from '../lib/economicErrors';
import { toActiveToggleDto } from '../lib/resourceProfileForm';
import { formatLocalDate } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EconomyDialog } from '../components/economy/EconomyDialog';
import { EconomyStateBoundary } from '../components/economy/EconomyStateBoundary';
import { ResourceProfileFormModal } from '../components/economy/ResourceProfileFormModal';

type FormState = { mode: 'create' } | { mode: 'edit'; profile: ResourceProfile; session: number } | null;

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
      <span aria-hidden="true">{active ? '●' : '○'}</span>
      {active ? 'Activo' : 'Inactivo'}
    </span>
  );
}

/** Fecha local del instante de `updatedAt`, sin husos horarios a la vista. */
function formatUpdated(value: string): string {
  return formatLocalDate(new Date(value));
}

/**
 * Catálogo global de perfiles de recurso. ADMIN, PM y líder lo ven; solo ADMIN crea, edita y activa/desactiva (el backend lo hace
 * cumplir igual). Cambiar un perfil toca únicamente el catálogo: nunca se invalida ni se escribe nada de proyectos.
 */
export function ResourceProfilesPage() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const uid = useId();
  const canManage = !!user && canManageResourceProfilesUI(user);

  const [includeInactive, setIncludeInactive] = useState(false);
  const [form, setForm] = useState<FormState>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<ResourceProfile | null>(null);
  const [conflictFor, setConflictFor] = useState<ResourceProfile | null>(null);
  const [notice, setNotice] = useState<DescribedError | null>(null);

  const profilesQuery = useResourceProfiles(includeInactive);
  const profiles = profilesQuery.data;

  const toggle = useMutation({
    retry: false,
    mutationFn: ({ profile, active }: { profile: ResourceProfile; active: boolean }) => api.updateResourceProfile(profile.id, toActiveToggleDto(profile, active)),
    onSuccess: async () => {
      setConfirmDeactivate(null);
      await qc.invalidateQueries({ queryKey: resourceProfilesKey });
    },
    onError: (error, { profile }) => {
      const described = describeResourceProfileError(error);
      setConfirmDeactivate(null);
      if (described.kind === 'conflict') {
        setConflictFor(profile);
        return;
      }
      setNotice(described);
      if (described.kind === 'not-found') void qc.invalidateQueries({ queryKey: resourceProfilesKey });
    },
  });

  const reloadProfile = async (profile: ResourceProfile) => {
    const result = await profilesQuery.refetch();
    if (result.error) throw result.error;
    const fresh = result.data?.find((p) => p.id === profile.id);
    if (!fresh) throw new ApiRequestError(404, 'Not Found', [], 'RESOURCE_PROFILE_NOT_FOUND');
    setForm((prev) => (prev && prev.mode === 'edit' ? { mode: 'edit', profile: fresh, session: prev.session + 1 } : prev));
  };

  const startToggle = (profile: ResourceProfile) => {
    setNotice(null);
    if (profile.active) setConfirmDeactivate(profile);
    else toggle.mutate({ profile, active: true });
  };

  const hasProfiles = !!profiles && profiles.length > 0;
  const busy = toggle.isPending;

  const actions = (profile: ResourceProfile, size: 'sm' | 'md') => {
    const base = size === 'sm' ? 'px-3 py-1 text-sm' : 'px-3 py-1.5 text-sm';
    return (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          aria-label={`Editar perfil: ${profile.name} (${profile.currency})`}
          onClick={() => {
            setNotice(null);
            setForm({ mode: 'edit', profile, session: 0 });
          }}
          className={`rounded-md border border-[#DEE5EC] bg-white font-medium text-[#245B78] hover:bg-[#EAF2F7] disabled:opacity-50 ${base}`}
        >
          Editar
        </button>
        <button
          type="button"
          disabled={busy}
          aria-label={`${profile.active ? 'Desactivar' : 'Reactivar'} perfil: ${profile.name} (${profile.currency})`}
          onClick={() => startToggle(profile)}
          className={`rounded-md border border-[#DEE5EC] bg-white font-medium text-[#172B42] hover:bg-gray-50 disabled:opacity-50 ${base}`}
        >
          {profile.active ? 'Desactivar' : 'Reactivar'}
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-[#172B42]">Perfiles de recurso</h1>
        <p className="mt-1 text-sm text-[#607185]">Catálogo de perfiles utilizados para estimar el costo de los recursos asignados a proyectos.</p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor={`${uid}-inactive`} className="flex items-center gap-2 text-sm text-[#172B42]">
          <input id={`${uid}-inactive`} type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          Mostrar inactivos
        </label>
        {canManage && hasProfiles && (
          <button type="button" onClick={() => setForm({ mode: 'create' })} className="rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a445b]">
            Crear perfil
          </button>
        )}
      </div>

      {notice && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p>{notice.message}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso" className="shrink-0 text-red-800 hover:underline">
            ✕
          </button>
        </div>
      )}

      <EconomyStateBoundary
        isLoading={profilesQuery.isLoading}
        error={profilesQuery.error}
        loadingLabel="Cargando perfiles…"
        describe={describeResourceProfileError}
        onRetry={() => void profilesQuery.refetch()}
      >
        {profiles && !hasProfiles && (
          <section className="rounded-xl border border-[#DEE5EC] bg-white p-6 text-center">
            <p className="text-sm text-[#172B42]">{includeInactive ? 'No hay perfiles de recurso.' : 'No hay perfiles de recurso activos.'}</p>
            {canManage && (
              <button type="button" onClick={() => setForm({ mode: 'create' })} className="mt-4 rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a445b]">
                Crear perfil
              </button>
            )}
          </section>
        )}

        {profiles && hasProfiles && (
          <section aria-label="Listado de perfiles de recurso" className="overflow-hidden rounded-xl border border-[#DEE5EC] bg-white">
            {/* Tabla: desktop */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <caption className="sr-only">Perfiles de recurso</caption>
                <thead>
                  <tr className="border-b border-[#DEE5EC] bg-[#F4F6F8] text-xs uppercase text-[#607185]">
                    <th scope="col" className="px-4 py-2 font-medium">Nombre</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Tarifa por hora</th>
                    <th scope="col" className="px-4 py-2 font-medium">Moneda</th>
                    <th scope="col" className="px-4 py-2 font-medium">Estado</th>
                    <th scope="col" className="px-4 py-2 font-medium">Revisión</th>
                    <th scope="col" className="px-4 py-2 font-medium">Actualizado</th>
                    {canManage && (
                      <th scope="col" className="px-4 py-2 font-medium">Acciones</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((profile) => (
                    <tr key={profile.id} className="border-b border-[#EEF2F6] align-top">
                      <td className="px-4 py-3 font-medium text-[#172B42]">{profile.name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatMoney(profile.hourlyCost, profile.currency)} / h</td>
                      <td className="px-4 py-3">{profile.currency}</td>
                      <td className="px-4 py-3">
                        <StatusBadge active={profile.active} />
                      </td>
                      <td className="px-4 py-3 text-[#607185]">{profile.revision}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#607185]">{formatUpdated(profile.updatedAt)}</td>
                      {canManage && <td className="px-4 py-3">{actions(profile, 'sm')}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cards: mobile */}
            <ul className="flex flex-col divide-y divide-[#DEE5EC] sm:hidden">
              {profiles.map((profile) => (
                <li key={profile.id} className="flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 break-words font-medium text-[#172B42]">{profile.name}</p>
                    <StatusBadge active={profile.active} />
                  </div>
                  <p className="text-sm tabular-nums text-[#172B42]">
                    {formatMoney(profile.hourlyCost, profile.currency)} / h
                  </p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[#607185]">
                    <dt>Moneda</dt>
                    <dd>{profile.currency}</dd>
                    <dt>Revisión</dt>
                    <dd>{profile.revision}</dd>
                    <dt>Actualizado</dt>
                    <dd>{formatUpdated(profile.updatedAt)}</dd>
                  </dl>
                  {canManage && actions(profile, 'md')}
                </li>
              ))}
            </ul>
          </section>
        )}
      </EconomyStateBoundary>

      {form && canManage && (
        <ResourceProfileFormModal
          key={form.mode === 'edit' ? `${form.profile.id}-${form.session}` : 'create'}
          mode={form.mode}
          profile={form.mode === 'edit' ? form.profile : undefined}
          onClose={() => setForm(null)}
          onReload={() => (form.mode === 'edit' ? reloadProfile(form.profile) : Promise.resolve())}
        />
      )}

      <ConfirmDialog
        open={confirmDeactivate !== null}
        title="¿Querés desactivar este perfil?"
        description="Las asignaciones históricas existentes no se modificarán. El perfil dejará de estar disponible para nuevas asignaciones."
        confirmLabel="Desactivar"
        variant="warning"
        isConfirming={toggle.isPending}
        onCancel={() => setConfirmDeactivate(null)}
        onConfirm={() => confirmDeactivate && toggle.mutate({ profile: confirmDeactivate, active: false })}
      >
        {confirmDeactivate && (
          <p className="text-sm font-medium text-[#172B42]">
            {confirmDeactivate.name} · {formatMoney(confirmDeactivate.hourlyCost, confirmDeactivate.currency)} / h
          </p>
        )}
      </ConfirmDialog>

      {conflictFor && (
        <EconomyDialog title="Perfil modificado" titleId={`${uid}-conflict-title`} onClose={() => setConflictFor(null)} maxWidthClass="max-w-md">
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">Este perfil fue modificado por otro usuario mientras estabas editando.</p>
            <p className="mt-1">Recargá la lista para ver el estado actual y volvé a intentarlo. No se guardó nada.</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void profilesQuery.refetch();
                  setConflictFor(null);
                }}
                className="rounded-md bg-[#245B78] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1a445b]"
              >
                Recargar
              </button>
              <button type="button" onClick={() => setConflictFor(null)} className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100">
                Cancelar
              </button>
            </div>
          </div>
        </EconomyDialog>
      )}
    </div>
  );
}
