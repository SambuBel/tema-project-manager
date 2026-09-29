import type { RoleName } from '@tema/shared-types';
import { roleLabels } from '../lib/roles';
import { rolePermissionsInfo } from '../lib/rolePermissionsInfo';

const ROLE_ORDER: RoleName[] = ['ADMIN', 'PROGRAM_MANAGER', 'PROJECT_LEADER', 'COLLABORATOR', 'OBSERVER'];

export function RolesMatrixPage() {
  return (
    <div className="flex flex-col gap-8 text-[#172B42]">
      <div>
        <h1 className="text-3xl font-bold">Roles y permisos</h1>
        <p className="mt-1 text-gray-500">
          Qué puede hacer cada rol en TEMA. Los permisos se derivan del rol, no se configuran de forma individual.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {ROLE_ORDER.map((role) => {
          const info = rolePermissionsInfo[role];
          return (
            <div key={role} className="rounded-xl border border-[#DEE5EC] bg-white p-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-[#EAF2F7] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#245B78]">
                  {roleLabels[role]}
                </span>
              </div>
              <p className="mt-3 text-sm text-[#607185]">{info.description}</p>

              <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[#607185]">Puede</h3>
                  {info.can.length === 0 ? (
                    <p className="mt-2 text-sm italic text-[#607185]">Nada dentro de este alcance.</p>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-2">
                      {info.can.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-sm">
                          <span className="mt-0.5 text-green-600" aria-hidden="true">✓</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[#607185]">No puede</h3>
                  {info.cannot.length === 0 ? (
                    <p className="mt-2 text-sm italic text-[#607185]">Sin restricciones dentro de este alcance.</p>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-2">
                      {info.cannot.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-sm">
                          <span className="mt-0.5 text-red-500" aria-hidden="true">✗</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-[#607185]">
        Esta pantalla es solo informativa. La autorización real siempre la valida el backend.
      </p>
    </div>
  );
}
