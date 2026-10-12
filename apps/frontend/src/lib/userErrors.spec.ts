import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError } from './api';
import { leadsProjectsMessage } from './userErrors';

const conflict = (projects: unknown) =>
  new ApiRequestError(409, 'Conflict', ['msg del backend'], 'USER_LEADS_PROJECTS', { projects });

describe('leadsProjectsMessage (RN-23)', () => {
  it('1 proyecto: mensaje en singular con el nombre', () => {
    const msg = leadsProjectsMessage(conflict([{ id: 'p1', name: 'Proyecto Alfa' }]), 'quitarle el rol de Líder');
    expect(msg).toBe(
      'Este usuario lidera 1 proyecto (Proyecto Alfa). Reasigná ese proyecto antes de quitarle el rol de Líder.',
    );
  });

  it('varios proyectos: plural con todos los nombres', () => {
    const msg = leadsProjectsMessage(
      conflict([
        { id: 'p1', name: 'Proyecto Alfa' },
        { id: 'p2', name: 'Proyecto Beta' },
      ]),
      'desactivarlo',
    );
    expect(msg).toBe(
      'Este usuario lidera 2 proyectos (Proyecto Alfa, Proyecto Beta). Reasigná esos proyectos antes de desactivarlo.',
    );
  });

  it('sin lista de proyectos en la respuesta: mensaje genérico pero claro', () => {
    expect(leadsProjectsMessage(conflict(undefined), 'desactivarlo')).toBe(
      'Este usuario lidera proyectos. Reasigná esos proyectos antes de desactivarlo.',
    );
  });

  it('ignora entradas malformadas en projects', () => {
    expect(leadsProjectsMessage(conflict([{ id: 'p1' }, null, { id: 'p2', name: 'Beta' }]), 'desactivarlo')).toContain(
      '1 proyecto (Beta)',
    );
  });

  it('otro 409 u otro error cualquiera: null (el caller muestra su mensaje genérico)', () => {
    expect(leadsProjectsMessage(new ApiRequestError(409, 'Conflict', ['x'], 'OTRO'), 'desactivarlo')).toBeNull();
    expect(leadsProjectsMessage(new ApiRequestError(403, 'Forbidden', ['x']), 'desactivarlo')).toBeNull();
    expect(leadsProjectsMessage(new Error('red'), 'desactivarlo')).toBeNull();
    expect(leadsProjectsMessage(null, 'desactivarlo')).toBeNull();
  });
});

describe('ApiRequestError', () => {
  it('sigue siendo compatible: details y status sin code/data', () => {
    const error = new ApiRequestError(400, 'Bad Request', ['a']);
    expect(error.status).toBe(400);
    expect(error.details).toEqual(['a']);
    expect(error.code).toBeUndefined();
    expect(error.message).toBe('400 Bad Request');
  });
});

describe('api client: propaga el cuerpo estructurado del 409', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const respondWith = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, statusText: 'Conflict' })));

  it('removeUserRole: el 409 USER_LEADS_PROJECTS llega con code, details y projects, y arma el mensaje', async () => {
    respondWith(409, {
      statusCode: 409,
      code: 'USER_LEADS_PROJECTS',
      message: 'El usuario lidera 1 proyecto.',
      projects: [{ id: 'p1', name: 'Proyecto Alfa' }],
    });

    const error = await api.removeUserRole('u1', 'PROJECT_LEADER').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe('USER_LEADS_PROJECTS');
    expect((error as ApiRequestError).details).toEqual(['El usuario lidera 1 proyecto.']);
    expect(leadsProjectsMessage(error, 'quitarle el rol de Líder')).toContain('Proyecto Alfa');
  });

  it('updateUserStatus: igual para la desactivación', async () => {
    respondWith(409, { code: 'USER_LEADS_PROJECTS', message: 'x', projects: [{ id: 'p1', name: 'Beta' }] });
    const error = await api.updateUserStatus('u1', false).catch((e: unknown) => e);
    expect(leadsProjectsMessage(error, 'desactivarlo')).toContain('Beta');
  });

  it('errores de validación (message como array) siguen funcionando', async () => {
    respondWith(400, { statusCode: 400, message: ['a', 'b'], error: 'Bad Request' });
    const error = (await api.updateUserStatus('u1', true).catch((e: unknown) => e)) as ApiRequestError;
    expect(error.details).toEqual(['a', 'b']);
    expect(error.code).toBeUndefined();
  });
});
