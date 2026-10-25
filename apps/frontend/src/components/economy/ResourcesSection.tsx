import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MemberResourceAllocation, Project } from '@tema/shared-types';
import { ApiRequestError } from '../../lib/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { projectResourceAllocationKey, useProjectResourceAllocation } from '../../hooks/useProjectResourceAllocation';
import { canManageResourceAllocationUI } from '../../lib/permissions';
import { formatHours, formatMoney } from '../../lib/money';
import { DEFAULT_PROJECT_CURRENCY } from '../../lib/currencies';
import { AllocationFormModal } from './AllocationFormModal';
import { AllocationHistoryModal } from './AllocationHistoryModal';
import { EconomyStateBoundary } from './EconomyStateBoundary';

interface ResourcesSectionProps {
  project: Project;
}

type FormState = { member: MemberResourceAllocation; session: number } | null;

const NO_BUDGET_TEXT = 'Sin presupuesto vigente al momento de la asignación';

/**
 * Sección "Recursos" de Economía: miembros activos con su asignación económica VIGENTE, tal como la devuelve el backend (snapshot
 * de perfil, tarifa, moneda y costo). Nunca se completa ni se corrige con el catálogo de perfiles, y no se suma nada acá: los
 * totales por moneda también vienen del backend. Esta información vive solo dentro de Economía (RN-25): no se agrega nada a Equipo.
 */
export function ResourcesSection({ project }: ResourcesSectionProps) {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const canManage = !!user && canManageResourceAllocationUI(user, project);

  const [form, setForm] = useState<FormState>(null);
  const [historyFor, setHistoryFor] = useState<MemberResourceAllocation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const query = useProjectResourceAllocation(project.id);
  const summary = query.data;
  // Moneda ÚNICA del proyecto: define qué perfiles se pueden asignar. (La trae siempre quien puede ver lo económico.)
  const projectCurrency = project.economicCurrency ?? summary?.totalsByCurrency[0]?.currency ?? DEFAULT_PROJECT_CURRENCY;

  const reloadMember = async (member: MemberResourceAllocation) => {
    const result = await query.refetch();
    if (result.error) throw result.error;
    const fresh = result.data?.members.find((m) => m.projectMemberId === member.projectMemberId);
    if (!fresh) throw new ApiRequestError(404, 'Not Found', [], 'PROJECT_MEMBER_NOT_FOUND');
    setForm((prev) => (prev ? { member: fresh, session: prev.session + 1 } : prev));
  };

  const memberGone = (message: string) => {
    setForm(null);
    setNotice(message);
    void qc.invalidateQueries({ queryKey: projectResourceAllocationKey(project.id) });
  };

  const actions = (member: MemberResourceAllocation, compact: boolean) => {
    const base = `rounded-md border border-[#DEE5EC] bg-white font-medium hover:bg-[#EAF2F7] ${compact ? 'px-3 py-1 text-sm' : 'px-3 py-1.5 text-sm'}`;
    return (
      <div className="flex flex-wrap gap-2">
        {canManage && (
          <button
            type="button"
            aria-label={`${member.allocation ? 'Editar' : 'Asignar'} recursos de ${member.user.name}`}
            onClick={() => {
              setNotice(null);
              setForm({ member, session: 0 });
            }}
            className={`${base} text-[#245B78]`}
          >
            {member.allocation ? 'Editar' : 'Asignar'}
          </button>
        )}
        {member.allocation && (
          <button type="button" aria-label={`Historial de asignación de ${member.user.name}`} onClick={() => setHistoryFor(member)} className={`${base} text-[#172B42]`}>
            Historial
          </button>
        )}
      </div>
    );
  };

  const budgetText = (member: MemberResourceAllocation) =>
    member.allocation ? (member.allocation.budgetVersion !== null ? `Presupuesto V${member.allocation.budgetVersion}` : NO_BUDGET_TEXT) : '—';

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso" className="shrink-0 hover:underline">
            ✕
          </button>
        </div>
      )}

      <EconomyStateBoundary isLoading={query.isLoading} error={query.error} loadingLabel="Cargando recursos…" onRetry={() => void query.refetch()}>
        {summary && (
          <>
            <section aria-labelledby="resources-totals-title" className="rounded-xl border border-[#DEE5EC] bg-white p-4 sm:p-6">
              <h3 id="resources-totals-title" className="text-base font-semibold text-[#172B42]">
                Costo estimado actual de recursos
              </h3>
              {/* Moneda única por proyecto: el backend devuelve como máximo UNA línea (se conserva la forma `totalsByCurrency`). */}
              {summary.totalsByCurrency.length === 0 ? (
                <p className="mt-2 text-sm text-[#607185]">Sin costo estimado.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1">
                  {summary.totalsByCurrency.map((line) => (
                    <li key={line.currency} className="text-lg font-semibold tabular-nums text-[#172B42]">
                      {formatMoney(line.amount, line.currency)}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {summary.members.length === 0 ? (
              <section className="rounded-xl border border-[#DEE5EC] bg-white p-6 text-center">
                <p className="text-sm text-[#172B42]">Este proyecto no tiene miembros activos.</p>
              </section>
            ) : (
              <section aria-label="Asignación de recursos por miembro" className="overflow-hidden rounded-xl border border-[#DEE5EC] bg-white">
                {/* Tabla: desktop */}
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[56rem] text-left text-sm">
                    <caption className="sr-only">Asignación de recursos por miembro</caption>
                    <thead>
                      <tr className="border-b border-[#DEE5EC] bg-[#F4F6F8] text-xs uppercase text-[#607185]">
                        {['Miembro', 'Perfil', 'Horas estimadas', 'Tarifa utilizada', 'Costo estimado', 'Presupuesto', 'Revisión', 'Acciones'].map((label) => (
                          <th key={label} scope="col" className="px-4 py-2 font-medium">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {summary.members.map((member) => {
                        const a = member.allocation;
                        return (
                          <tr key={member.projectMemberId} className="border-b border-[#EEF2F6] align-top">
                            <td className="px-4 py-3 font-medium text-[#172B42]">{member.user.name}</td>
                            {a ? (
                              <>
                                <td className="px-4 py-3">{a.resourceProfile?.name ?? 'Sin perfil'}</td>
                                <td className="whitespace-nowrap px-4 py-3 tabular-nums">{a.estimatedHours ? formatHours(a.estimatedHours) : 'Sin horas'}</td>
                                <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                                  {a.resourceProfile ? `${formatMoney(a.resourceProfile.hourlyCost, a.resourceProfile.currency)} / h` : '—'}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                                  {a.estimatedResourceCost ? formatMoney(a.estimatedResourceCost.amount, a.estimatedResourceCost.currency) : 'Sin costo estimado'}
                                </td>
                                <td className="px-4 py-3 text-[#607185]">{budgetText(member)}</td>
                                <td className="px-4 py-3 text-[#607185]">{a.revision}</td>
                              </>
                            ) : (
                              <td colSpan={6} className="px-4 py-3 text-[#607185]">
                                Sin asignación económica
                              </td>
                            )}
                            <td className="px-4 py-3">{actions(member, true)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Cards: mobile */}
                <ul className="flex flex-col divide-y divide-[#DEE5EC] sm:hidden">
                  {summary.members.map((member) => {
                    const a = member.allocation;
                    return (
                      <li key={member.projectMemberId} className="flex flex-col gap-2 p-4">
                        <p className="font-medium text-[#172B42]">{member.user.name}</p>
                        {a ? (
                          <>
                            <p className="text-sm text-[#172B42]">{a.resourceProfile?.name ?? 'Sin perfil'}</p>
                            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-[#172B42]">
                              <dt className="text-[#607185]">Horas</dt>
                              <dd className="tabular-nums">{a.estimatedHours ? formatHours(a.estimatedHours) : 'Sin horas'}</dd>
                              <dt className="text-[#607185]">Tarifa</dt>
                              <dd className="tabular-nums">{a.resourceProfile ? `${formatMoney(a.resourceProfile.hourlyCost, a.resourceProfile.currency)} / h` : '—'}</dd>
                              <dt className="text-[#607185]">Costo estimado</dt>
                              <dd className="tabular-nums">{a.estimatedResourceCost ? formatMoney(a.estimatedResourceCost.amount, a.estimatedResourceCost.currency) : 'Sin costo estimado'}</dd>
                              <dt className="text-[#607185]">Presupuesto</dt>
                              <dd>{budgetText(member)}</dd>
                              <dt className="text-[#607185]">Revisión</dt>
                              <dd>{a.revision}</dd>
                            </dl>
                          </>
                        ) : (
                          <p className="text-sm text-[#607185]">Sin asignación económica</p>
                        )}
                        {actions(member, false)}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </>
        )}
      </EconomyStateBoundary>

      {form && canManage && (
        <AllocationFormModal
          key={`${form.member.projectMemberId}-${form.session}`}
          projectId={project.id}
          currency={projectCurrency}
          member={form.member}
          onClose={() => setForm(null)}
          onReload={() => reloadMember(form.member)}
          onMemberGone={memberGone}
        />
      )}
      {historyFor && <AllocationHistoryModal projectId={project.id} member={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}
