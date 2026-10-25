import type { MemberResourceAllocation, UpdateMemberResourceAllocationDto } from '@tema/shared-types';
import { normalizeAmountInput } from './money';

/**
 * Lógica PURA del formulario de asignación económica de un miembro (perfil de recurso y/o horas estimadas). Las horas son
 * siempre texto. NO calcula ningún costo: el costo estimado, la tarifa y la moneda de la asignación los devuelve el backend
 * (snapshot) y son lo único que se muestra. Es ayuda de UX: el backend vuelve a validar todo.
 */

/** numeric(8,2): hasta 6 enteros y 2 decimales. */
const MAX_HOURS_INTEGER_DIGITS = 6;

export interface AllocationFormState {
  /** '' = sin perfil. El valor inicial es el perfil de la asignación actual (conservarlo no es "actualizar su tarifa"). */
  resourceProfileId: string;
  /** Tal como lo tipea el usuario; '' = sin horas. */
  estimatedHours: string;
}

export function currentProfileId(member: MemberResourceAllocation): string {
  return member.allocation?.resourceProfile?.id ?? '';
}

export function allocationFormFromMember(member: MemberResourceAllocation): AllocationFormState {
  return { resourceProfileId: currentProfileId(member), estimatedHours: member.allocation?.estimatedHours ?? '' };
}

/** "120" → "120.00"; null si no es válida (incluye el tope de 6 enteros). 0 es válido. */
export function canonicalHours(raw: string): string | null {
  const normalized = normalizeAmountInput(raw);
  if (normalized === null) return null;
  return normalized.split('.')[0]!.length <= MAX_HOURS_INTEGER_DIGITS ? normalized : null;
}

export function validateAllocationForm(state: AllocationFormState): { hoursError: string | null; blocking: string[] } {
  const hoursError = state.estimatedHours.trim() !== '' && canonicalHours(state.estimatedHours) === null
    ? 'Las horas deben ser un número sin signo, con hasta 6 enteros y 2 decimales.'
    : null;
  return { hoursError, blocking: hoursError ? [hoursError] : [] };
}

/** Revisión que se envía: 0 si el miembro todavía no tiene asignación (solo en ese PATCH inicial); si no, la vigente. */
export function expectedRevisionFor(member: MemberResourceAllocation): number {
  return member.allocation?.revision ?? 0;
}

/**
 * PATCH real: solo lo que cambió. Se distingue "omitido" (conserva) de `null` (quita):
 *  - perfil: igual al actual → se omite (aunque el catálogo ya tenga otra tarifa: NO se refresca); distinto → UUID, o null si se
 *    eligió "Sin perfil" teniendo uno;
 *  - horas: igual a las actuales → se omiten; vacías teniendo horas → null; si no, el texto canónico.
 * Sin cambios se envía igual (solo la revisión): el backend responde RESOURCE_ALLOCATION_NO_CHANGES y la UI lo muestra suave.
 */
export function toAllocationDto(state: AllocationFormState, member: MemberResourceAllocation): UpdateMemberResourceAllocationDto {
  const dto: UpdateMemberResourceAllocationDto = { expectedRevision: expectedRevisionFor(member) };

  const originalProfile = currentProfileId(member);
  if (state.resourceProfileId !== originalProfile) dto.resourceProfileId = state.resourceProfileId === '' ? null : state.resourceProfileId;

  const originalHours = member.allocation?.estimatedHours ?? '';
  const nextHours = state.estimatedHours.trim() === '' ? '' : (canonicalHours(state.estimatedHours) ?? state.estimatedHours.trim());
  if (nextHours !== originalHours) dto.estimatedHours = nextHours === '' ? null : nextHours;

  return dto;
}
