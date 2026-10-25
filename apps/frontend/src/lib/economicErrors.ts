import { ApiRequestError } from './api';
import { formatAmount } from './money';

/**
 * Traduce los errores del backend económico a mensajes para el usuario. Un único mapa, así todas las pantallas (presupuesto
 * hoy; costos, perfiles y asignaciones en las próximas fases) muestran lo mismo. Nunca expone stack ni códigos técnicos.
 *
 *  - conflict:   alguien más cambió el dato mientras se editaba (RNF-20). La UI ofrece Recargar/Cancelar y NUNCA reintenta sola.
 *  - confirmation: el backend pide confirmar explícitamente (RN-21: costo anterior al inicio del proyecto). No es un error.
 *  - no-changes: el backend detectó que no hay nada que guardar. Es un aviso suave, no un error.
 *  - forbidden:  sin permiso económico (RN-25).
 *  - validation: el dato enviado no cumple una regla de negocio (el usuario puede corregirlo).
 *  - not-found / server / unknown: el resto.
 */
export type EconomicErrorKind = 'conflict' | 'confirmation' | 'no-changes' | 'forbidden' | 'validation' | 'not-found' | 'server' | 'unknown';

export interface DescribedError {
  kind: EconomicErrorKind;
  message: string;
  code?: string;
}

export const FORBIDDEN_RESOURCE_PROFILES_MESSAGE = 'No tenés permisos para acceder a los perfiles de recurso.';
export const FORBIDDEN_ECONOMIC_MESSAGE = 'No tenés permisos para acceder a la información económica de este proyecto.';

const BY_CODE: Record<string, { kind: EconomicErrorKind; message: string }> = {
  BUDGET_VERSION_CONFLICT: { kind: 'conflict', message: 'El presupuesto fue modificado por otro usuario mientras estabas editando.' },
  BUDGET_ALREADY_EXISTS: { kind: 'conflict', message: 'Este proyecto ya tiene un presupuesto: otro usuario lo creó mientras estabas editando.' },
  BUDGET_NO_CHANGES: { kind: 'no-changes', message: 'No hay cambios para guardar.' },
  BUDGET_NOT_FOUND: { kind: 'not-found', message: 'Este proyecto todavía no tiene presupuesto.' },
  BUDGET_ITEMS_TOTAL_MISMATCH: { kind: 'validation', message: 'La suma de las partidas debe coincidir con el total del presupuesto.' },
  BUDGET_ITEM_DUPLICATED_CATEGORY: { kind: 'validation', message: 'Un rubro no puede aparecer más de una vez.' },
  COST_CATEGORY_NOT_FOUND: { kind: 'validation', message: 'El rubro seleccionado ya no está disponible.' },
  COST_CATEGORY_INACTIVE: { kind: 'validation', message: 'El rubro seleccionado está inactivo.' },
  COST_VERSION_CONFLICT: { kind: 'conflict', message: 'Este costo fue modificado por otro usuario mientras estabas editando.' },
  COST_NO_CHANGES: { kind: 'no-changes', message: 'No hay cambios para guardar.' },
  COST_NOT_FOUND: { kind: 'not-found', message: 'Este costo ya no existe en el proyecto.' },
  COST_BEFORE_PROJECT_START_CONFIRMATION_REQUIRED: { kind: 'confirmation', message: 'La fecha del costo es anterior al inicio del proyecto.' },
  COST_CATEGORY_NOT_IN_CURRENT_BUDGET: { kind: 'validation', message: 'Este rubro no forma parte del presupuesto vigente.' },
  PROJECT_HAS_NO_CURRENT_BUDGET: {
    kind: 'validation',
    message: 'No se puede registrar un costo porque el proyecto no tiene un presupuesto vigente con rubros disponibles.',
  },
  TASK_NOT_AVAILABLE_FOR_PROJECT: { kind: 'validation', message: 'La tarea no existe o no pertenece a este proyecto.' },
  RESOURCE_PROFILE_VERSION_CONFLICT: { kind: 'conflict', message: 'Este perfil fue modificado por otro usuario mientras estabas editando.' },
  RESOURCE_PROFILE_NO_CHANGES: { kind: 'no-changes', message: 'No hay cambios para guardar.' },
  RESOURCE_PROFILE_NAME_CONFLICT: { kind: 'validation', message: 'Ya existe un perfil con ese nombre para esta moneda.' },
  RESOURCE_PROFILE_NOT_FOUND: { kind: 'not-found', message: 'Este perfil ya no existe.' },
  RESOURCE_ALLOCATION_VERSION_CONFLICT: { kind: 'conflict', message: 'La asignación de este recurso fue modificada por otro usuario mientras estabas editando.' },
  RESOURCE_ALLOCATION_NO_CHANGES: { kind: 'no-changes', message: 'No hay cambios para guardar.' },
  RESOURCE_PROFILE_INACTIVE: { kind: 'validation', message: 'El perfil seleccionado ya no está activo.' },
  PROJECT_MEMBER_NOT_FOUND: { kind: 'not-found', message: 'Este miembro ya no está disponible en el proyecto.' },
  PROJECT_CURRENCY_MISMATCH: { kind: 'validation', message: 'Los importes deben expresarse en la moneda del proyecto.' },
  RESOURCE_PROFILE_CURRENCY_MISMATCH: { kind: 'validation', message: 'El perfil seleccionado utiliza una moneda diferente a la del proyecto.' },
  PROJECT_CURRENCY_IN_USE: { kind: 'validation', message: 'La moneda del proyecto ya no puede modificarse porque existen datos económicos.' },
  BUDGET_NO_CURRENT_VERSION: { kind: 'server', message: 'El presupuesto de este proyecto está en un estado inconsistente. Avisá a un administrador.' },
  BUDGET_VERSION_STATE_INVALID: { kind: 'server', message: 'El presupuesto de este proyecto está en un estado inconsistente. Avisá a un administrador.' },
};

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function describeEconomicError(error: unknown): DescribedError {
  if (!(error instanceof ApiRequestError)) {
    return { kind: 'unknown', message: 'Ocurrió un error inesperado. Probá de nuevo.' };
  }

  const known = error.code ? BY_CODE[error.code] : undefined;
  if (known) {
    let message = known.message;
    // El backend informa los dos importes cuando la suma no coincide: se muestran tal cual (texto, sin convertir).
    if (error.code === 'BUDGET_ITEMS_TOTAL_MISMATCH') {
      const total = asText(error.data?.totalAmount);
      const itemsTotal = asText(error.data?.itemsTotal);
      if (total && itemsTotal) message += ` Total: ${formatAmount(total)} · Suma de partidas: ${formatAmount(itemsTotal)}.`;
    }
    // Moneda única por proyecto: cuando el backend informa la del proyecto, se la muestra (es un dato, no una conversión).
    if (error.code === 'PROJECT_CURRENCY_MISMATCH') {
      const projectCurrency = asText(error.data?.projectCurrency);
      if (projectCurrency) message = `Los importes deben expresarse en la moneda del proyecto (${projectCurrency}).`;
    }
    return { ...known, message, code: error.code };
  }

  if (error.status === 403) return { kind: 'forbidden', message: FORBIDDEN_ECONOMIC_MESSAGE, code: error.code };
  if (error.status === 400 && error.details.length > 0) return { kind: 'validation', message: error.details.join(' '), code: error.code };
  if (error.status === 404) return { kind: 'not-found', message: 'No se encontró lo que buscabas.', code: error.code };
  if (error.status >= 500) return { kind: 'server', message: 'Hubo un problema en el servidor. Probá de nuevo en unos minutos.', code: error.code };
  return { kind: 'unknown', message: `No se pudo completar la operación (${error.status}).`, code: error.code };
}

/** Las consultas económicas no se reintentan ante un error del cliente (403, 404, 409...): no se repite lo que va a volver a fallar. */
export function economicQueryRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

/** Igual que describeEconomicError, pero el 403 habla de perfiles de recurso (el catálogo es global, no de un proyecto). */
export function describeResourceProfileError(error: unknown): DescribedError {
  const described = describeEconomicError(error);
  return described.kind === 'forbidden' ? { ...described, message: FORBIDDEN_RESOURCE_PROFILES_MESSAGE } : described;
}

/**
 * Errores de la asignación de recursos de un miembro. Igual que el económico, salvo que un perfil inexistente es un problema de
 * la SELECCIÓN (se puede elegir otro), no de que "el perfil ya no existe" como página.
 */
export function describeAllocationError(error: unknown): DescribedError {
  const described = describeEconomicError(error);
  if (described.code === 'RESOURCE_PROFILE_NOT_FOUND') return { ...described, kind: 'validation', message: 'El perfil seleccionado ya no existe.' };
  return described;
}
