import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api';
import { FORBIDDEN_ECONOMIC_MESSAGE, describeEconomicError, describeAllocationError, describeResourceProfileError, economicQueryRetry } from './economicErrors';

const apiError = (status: number, code?: string, data?: Record<string, unknown>, details: string[] = []) => new ApiRequestError(status, 'x', details, code, data);

describe('describeEconomicError', () => {
  it.each([
    ['BUDGET_VERSION_CONFLICT', 409, 'conflict', 'El presupuesto fue modificado por otro usuario mientras estabas editando.'],
    ['BUDGET_NO_CHANGES', 409, 'no-changes', 'No hay cambios para guardar.'],
    ['BUDGET_ITEMS_TOTAL_MISMATCH', 400, 'validation', 'La suma de las partidas debe coincidir con el total del presupuesto.'],
    ['COST_CATEGORY_NOT_FOUND', 400, 'validation', 'El rubro seleccionado ya no está disponible.'],
    ['COST_CATEGORY_INACTIVE', 400, 'validation', 'El rubro seleccionado está inactivo.'],
    ['BUDGET_ITEM_DUPLICATED_CATEGORY', 400, 'validation', 'Un rubro no puede aparecer más de una vez.'],
    ['RESOURCE_PROFILE_VERSION_CONFLICT', 409, 'conflict', 'Este perfil fue modificado por otro usuario mientras estabas editando.'],
    ['RESOURCE_PROFILE_NO_CHANGES', 409, 'no-changes', 'No hay cambios para guardar.'],
    ['RESOURCE_PROFILE_NAME_CONFLICT', 409, 'validation', 'Ya existe un perfil con ese nombre para esta moneda.'],
    ['RESOURCE_PROFILE_NOT_FOUND', 404, 'not-found', 'Este perfil ya no existe.'],
    ['RESOURCE_ALLOCATION_VERSION_CONFLICT', 409, 'conflict', 'La asignación de este recurso fue modificada por otro usuario mientras estabas editando.'],
    ['RESOURCE_ALLOCATION_NO_CHANGES', 409, 'no-changes', 'No hay cambios para guardar.'],
    ['RESOURCE_PROFILE_INACTIVE', 400, 'validation', 'El perfil seleccionado ya no está activo.'],
    ['PROJECT_MEMBER_NOT_FOUND', 404, 'not-found', 'Este miembro ya no está disponible en el proyecto.'],
    ['RESOURCE_PROFILE_CURRENCY_MISMATCH', 400, 'validation', 'El perfil seleccionado utiliza una moneda diferente a la del proyecto.'],
    ['PROJECT_CURRENCY_IN_USE', 409, 'validation', 'La moneda del proyecto ya no puede modificarse porque existen datos económicos.'],
    ['PROJECT_CURRENCY_MISMATCH', 400, 'validation', 'Los importes deben expresarse en la moneda del proyecto.'],
    ['COST_VERSION_CONFLICT', 409, 'conflict', 'Este costo fue modificado por otro usuario mientras estabas editando.'],
    ['COST_NO_CHANGES', 409, 'no-changes', 'No hay cambios para guardar.'],
    ['COST_NOT_FOUND', 404, 'not-found', 'Este costo ya no existe en el proyecto.'],
    ['COST_BEFORE_PROJECT_START_CONFIRMATION_REQUIRED', 409, 'confirmation', 'La fecha del costo es anterior al inicio del proyecto.'],
    ['COST_CATEGORY_NOT_IN_CURRENT_BUDGET', 400, 'validation', 'Este rubro no forma parte del presupuesto vigente.'],
    ['PROJECT_HAS_NO_CURRENT_BUDGET', 409, 'validation', 'No se puede registrar un costo porque el proyecto no tiene un presupuesto vigente con rubros disponibles.'],
    ['TASK_NOT_AVAILABLE_FOR_PROJECT', 400, 'validation', 'La tarea no existe o no pertenece a este proyecto.'],
  ])('%s → %s / mensaje del negocio', (code, status, kind, message) => {
    expect(describeEconomicError(apiError(status, code))).toMatchObject({ kind, message, code });
  });

  it('BUDGET_NO_CHANGES es un aviso suave, no un error', () => {
    expect(describeEconomicError(apiError(409, 'BUDGET_NO_CHANGES')).kind).toBe('no-changes');
  });

  it('alguien creó el presupuesto mientras se editaba: se trata como conflicto (Recargar/Cancelar)', () => {
    expect(describeEconomicError(apiError(409, 'BUDGET_ALREADY_EXISTS')).kind).toBe('conflict');
  });

  it('el desajuste de suma muestra los dos importes del backend (texto, formateados)', () => {
    const described = describeEconomicError(apiError(400, 'BUDGET_ITEMS_TOTAL_MISMATCH', { totalAmount: '1000000.00', itemsTotal: '950000.00' }));
    expect(described.message).toContain('Total: 1.000.000,00');
    expect(described.message).toContain('Suma de partidas: 950.000,00');
  });

  it('403 sin código → el mensaje económico y kind forbidden', () => {
    expect(describeEconomicError(apiError(403))).toMatchObject({ kind: 'forbidden', message: FORBIDDEN_ECONOMIC_MESSAGE });
    expect(FORBIDDEN_ECONOMIC_MESSAGE).toBe('No tenés permisos para acceder a la información económica de este proyecto.');
  });

  it('inconsistencias del presupuesto (500 con código): mensaje claro, sin detalle técnico', () => {
    for (const code of ['BUDGET_NO_CURRENT_VERSION', 'BUDGET_VERSION_STATE_INVALID']) {
      const described = describeEconomicError(apiError(500, code));
      expect(described.kind).toBe('server');
      expect(described.message).toContain('estado inconsistente');
      expect(described.message).not.toContain(code);
    }
  });

  it('400 genérico: junta los mensajes de validación del backend', () => {
    expect(describeEconomicError(apiError(400, undefined, undefined, ['La moneda debe ser un código de 3 letras', 'Fecha inválida']))).toMatchObject({
      kind: 'validation',
      message: 'La moneda debe ser un código de 3 letras Fecha inválida',
    });
  });

  it('otros 404 no se tragan como "sin presupuesto"; 5xx y errores raros dan mensajes genéricos', () => {
    expect(describeEconomicError(apiError(404)).kind).toBe('not-found');
    expect(describeEconomicError(apiError(404)).message).not.toBe('Este proyecto todavía no tiene presupuesto.');
    expect(describeEconomicError(apiError(502)).kind).toBe('server');
    expect(describeEconomicError(new Error('boom'))).toMatchObject({ kind: 'unknown' });
    expect(describeEconomicError('x').message).not.toContain('boom');
  });
});

describe('economicQueryRetry', () => {
  it('no reintenta errores del cliente (403, 404, 409...)', () => {
    for (const status of [400, 403, 404, 409]) expect(economicQueryRetry(0, apiError(status))).toBe(false);
  });
  it('reintenta una vez ante un error de red o de servidor', () => {
    expect(economicQueryRetry(0, apiError(500))).toBe(true);
    expect(economicQueryRetry(1, apiError(500))).toBe(false);
    expect(economicQueryRetry(0, new TypeError('network'))).toBe(true);
  });
});

describe('describeResourceProfileError', () => {
  it('el 403 habla de perfiles de recurso', () => {
    expect(describeResourceProfileError(apiError(403))).toMatchObject({ kind: 'forbidden', message: 'No tenés permisos para acceder a los perfiles de recurso.' });
  });
  it('el resto es igual al económico', () => {
    const e = apiError(409, 'RESOURCE_PROFILE_NAME_CONFLICT');
    expect(describeResourceProfileError(e)).toEqual(describeEconomicError(e));
  });
});

describe('describeAllocationError', () => {
  it('un perfil inexistente es un problema de la selección (se puede elegir otro)', () => {
    expect(describeAllocationError(apiError(400, 'RESOURCE_PROFILE_NOT_FOUND'))).toMatchObject({ kind: 'validation', message: 'El perfil seleccionado ya no existe.' });
  });
  it('el 403 es el económico de proyecto', () => {
    expect(describeAllocationError(apiError(403))).toMatchObject({ kind: 'forbidden', message: FORBIDDEN_ECONOMIC_MESSAGE });
  });
});

describe('moneda única por proyecto - mensajes', () => {
  it('PROJECT_CURRENCY_MISMATCH muestra la moneda del proyecto cuando el backend la informa', () => {
    expect(describeEconomicError(apiError(400, 'PROJECT_CURRENCY_MISMATCH', { projectCurrency: 'USD' })).message).toBe('Los importes deben expresarse en la moneda del proyecto (USD).');
  });
  it('ninguno de estos errores es un conflicto de concurrencia (no ofrecen Recargar)', () => {
    for (const code of ['PROJECT_CURRENCY_MISMATCH', 'RESOURCE_PROFILE_CURRENCY_MISMATCH', 'PROJECT_CURRENCY_IN_USE']) {
      expect(describeEconomicError(apiError(409, code)).kind).toBe('validation');
    }
  });
});
