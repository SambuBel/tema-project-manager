import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api';
import { assistantErrorMessage } from './assistantErrors';

const apiError = (status: number) => new ApiRequestError(status, 'Error');

describe('assistantErrorMessage', () => {
  it('sin respuesta del servidor: avisa que no hay conexión', () => {
    expect(assistantErrorMessage(new TypeError('Failed to fetch'))).toMatch(/conexión/);
  });

  it('403: explica que falta permiso', () => {
    expect(assistantErrorMessage(apiError(403))).toMatch(/permiso/);
  });

  it('400 y 404: pide revisar lo que se pidió', () => {
    expect(assistantErrorMessage(apiError(400))).toMatch(/no pude encontrar/i);
    expect(assistantErrorMessage(apiError(404))).toMatch(/no pude encontrar/i);
  });

  it('429: pide esperar', () => {
    expect(assistantErrorMessage(apiError(429))).toMatch(/esperá/i);
  });

  it('502/503/504: dice que el asistente no está disponible y que la app sigue', () => {
    for (const status of [502, 503, 504]) {
      const msg = assistantErrorMessage(apiError(status));
      expect(msg).toMatch(/no está disponible/);
      expect(msg).toMatch(/sigue funcionando/);
    }
  });

  it('otro error: mensaje genérico', () => {
    expect(assistantErrorMessage(apiError(500))).toMatch(/algo salió mal/i);
  });
});
