import type { CreateResourceProfileDto, ResourceProfile, UpdateResourceProfileDto } from '@tema/shared-types';
import { normalizeAmountInput } from './money';

/**
 * Lógica PURA del formulario de perfiles de recurso (alta y edición). La tarifa es siempre texto. Es ayuda de UX: el backend
 * vuelve a validar todo (y garantiza la unicidad nombre+moneda sin distinguir mayúsculas) y es la única autoridad.
 */

/** Tope del backend para el nombre. */
export const MAX_PROFILE_NAME_LENGTH = 150;
/** La tarifa por hora admite hasta 10 enteros (distinto de los importes de presupuesto/costos, que admiten 12). */
const MAX_HOURLY_COST_INTEGER_DIGITS = 10;

export interface ResourceProfileFormState {
  name: string;
  /** Tal como lo tipea el usuario. */
  hourlyCost: string;
  currency: string;
  /** Solo se edita al modificar un perfil: al crear siempre nace activo. */
  active: boolean;
}

export function emptyProfileForm(): ResourceProfileFormState {
  return { name: '', hourlyCost: '', currency: '', active: true };
}

export function profileFormFromProfile(profile: ResourceProfile): ResourceProfileFormState {
  return { name: profile.name, hourlyCost: profile.hourlyCost, currency: profile.currency, active: profile.active };
}

export function normalizeProfileCurrency(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Tarifa en su forma canónica de 2 decimales ("50" → "50.00"), o null si no es válida (incluye el tope de 10 enteros). */
export function canonicalHourlyCost(raw: string): string | null {
  const normalized = normalizeAmountInput(raw);
  if (normalized === null) return null;
  return normalized.split('.')[0]!.length <= MAX_HOURLY_COST_INTEGER_DIGITS ? normalized : null;
}

export interface ResourceProfileFormIssues {
  fieldErrors: Partial<Record<'name' | 'hourlyCost' | 'currency', string>>;
  blocking: string[];
}

export function validateProfileForm(state: ResourceProfileFormState): ResourceProfileFormIssues {
  const fieldErrors: ResourceProfileFormIssues['fieldErrors'] = {};
  const name = state.name.trim();
  if (name === '') fieldErrors.name = 'El nombre es obligatorio.';
  else if (name.length > MAX_PROFILE_NAME_LENGTH) fieldErrors.name = `El nombre puede tener como máximo ${MAX_PROFILE_NAME_LENGTH} caracteres.`;

  if (state.hourlyCost.trim() === '') fieldErrors.hourlyCost = 'Ingresá la tarifa por hora.';
  else if (canonicalHourlyCost(state.hourlyCost) === null) {
    fieldErrors.hourlyCost = 'La tarifa debe ser un número sin signo, con hasta 10 enteros y 2 decimales.';
  }

  if (!/^[A-Z]{3}$/.test(normalizeProfileCurrency(state.currency))) fieldErrors.currency = 'Elegí una moneda.';

  return { fieldErrors, blocking: Object.values(fieldErrors) };
}

/** Alta: el nombre solo se recorta (no se cambian mayúsculas); `active` no se envía (nace activo). */
export function toCreateProfileDto(state: ResourceProfileFormState): CreateResourceProfileDto {
  return {
    name: state.name.trim(),
    hourlyCost: canonicalHourlyCost(state.hourlyCost) ?? state.hourlyCost.trim(),
    currency: normalizeProfileCurrency(state.currency),
  };
}

/** Campos que difieren del perfil actual (lo único que se envía en el PATCH). */
export function changedProfileFields(state: ResourceProfileFormState, original: ResourceProfile): Array<keyof ResourceProfileFormState> {
  const next = {
    name: state.name.trim(),
    hourlyCost: canonicalHourlyCost(state.hourlyCost) ?? state.hourlyCost.trim(),
    currency: normalizeProfileCurrency(state.currency),
    active: state.active,
  };
  const before = profileFormFromProfile(original);
  return (Object.keys(next) as Array<keyof ResourceProfileFormState>).filter((field) => next[field] !== before[field]);
}

/**
 * Edición parcial: solo lo que cambió, más `expectedRevision` (el del perfil que se abrió). Sin cambios se envía igual: el
 * backend responde RESOURCE_PROFILE_NO_CHANGES y la UI lo muestra como aviso.
 */
export function toUpdateProfileDto(state: ResourceProfileFormState, original: ResourceProfile): UpdateResourceProfileDto {
  const dto: UpdateResourceProfileDto = { expectedRevision: original.revision };
  for (const field of changedProfileFields(state, original)) {
    switch (field) {
      case 'name':
        dto.name = state.name.trim();
        break;
      case 'hourlyCost':
        dto.hourlyCost = canonicalHourlyCost(state.hourlyCost) ?? state.hourlyCost.trim();
        break;
      case 'currency':
        dto.currency = normalizeProfileCurrency(state.currency);
        break;
      case 'active':
        dto.active = state.active;
        break;
    }
  }
  return dto;
}

/** Activar / desactivar desde la fila: solo `active` más la revisión que se tenía en pantalla. */
export function toActiveToggleDto(profile: ResourceProfile, active: boolean): UpdateResourceProfileDto {
  return { expectedRevision: profile.revision, active };
}
