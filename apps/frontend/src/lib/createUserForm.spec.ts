import { describe, expect, it, vi } from 'vitest';
import type { UserWithRoles } from '@tema/shared-types';
import { ApiRequestError } from './api';
import {
  DEFAULT_INITIAL_ROLE,
  EMPTY_NEW_USER_FORM,
  INITIAL_ROLE_OPTIONS,
  createUserErrorMessage,
  submitNewUser,
  toCreateUserDto,
  validateNewUser,
} from './createUserForm';

const valid = { name: 'Juan Pérez', email: 'juan@tema.com', password: 'clave-1234', role: 'COLLABORATOR' as const };
const created = { id: 'u9', email: 'juan@tema.com', name: 'Juan Pérez', active: true, roles: ['COLLABORATOR'] } as unknown as UserWithRoles;

describe('roles del selector', () => {
  it('el default es COLLABORATOR y la primera opción', () => {
    expect(DEFAULT_INITIAL_ROLE).toBe('COLLABORATOR');
    expect(EMPTY_NEW_USER_FORM.role).toBe('COLLABORATOR');
    expect(INITIAL_ROLE_OPTIONS[0]).toEqual({ value: 'COLLABORATOR', label: 'Colaborador' });
  });

  it('labels en español para los cuatro roles pedidos, en ese orden', () => {
    expect(INITIAL_ROLE_OPTIONS.slice(0, 4).map((o) => [o.value, o.label])).toEqual([
      ['COLLABORATOR', 'Colaborador'],
      ['PROJECT_LEADER', 'Líder de proyecto'],
      ['PROGRAM_MANAGER', 'Program Manager'],
      ['ADMIN', 'Administrador'],
    ]);
  });

  it('incluye OBSERVER porque es un rol GLOBAL real del sistema (RoleName / tabla roles)', () => {
    expect(INITIAL_ROLE_OPTIONS.map((o) => o.value)).toContain('OBSERVER');
  });
});

describe('validateNewUser', () => {
  it('formulario válido → sin errores', () => {
    expect(validateNewUser(valid)).toEqual({});
  });

  it.each(['', '   '])('nombre vacío o solo espacios (%j) → obligatorio', (name) => {
    expect(validateNewUser({ ...valid, name }).name).toBe('El nombre es obligatorio.');
  });

  it('email vacío → obligatorio; sin formato de email → inválido', () => {
    expect(validateNewUser({ ...valid, email: '' }).email).toBe('El email es obligatorio.');
    for (const email of ['no-es-email', 'a@b', '@x.com', 'a b@c.com']) {
      expect(validateNewUser({ ...valid, email }).email).toBe('Ingresá un email válido.');
    }
  });

  it('no inventa reglas de dominio: acepta cualquier dominio con formato válido', () => {
    for (const email of ['a@gmail.com', 'a@otra-empresa.io', 'a@sub.dominio.com.ar']) {
      expect(validateNewUser({ ...valid, email }).email).toBeUndefined();
    }
  });

  it('contraseña: obligatoria, mínimo 8 y máximo 128 (los límites del backend)', () => {
    expect(validateNewUser({ ...valid, password: '' }).password).toBe('La contraseña es obligatoria.');
    expect(validateNewUser({ ...valid, password: '1234567' }).password).toContain('al menos 8');
    expect(validateNewUser({ ...valid, password: '12345678' }).password).toBeUndefined();
    expect(validateNewUser({ ...valid, password: 'x'.repeat(128) }).password).toBeUndefined();
    expect(validateNewUser({ ...valid, password: 'x'.repeat(129) }).password).toContain('como máximo 128');
  });

  it('la contraseña no se recorta: 8 espacios cuentan (se manda tal cual)', () => {
    expect(validateNewUser({ ...valid, password: '        ' }).password).toBeUndefined();
  });
});

describe('toCreateUserDto: el request a POST /users', () => {
  it('nombre con trim, email con trim + minúsculas, password tal cual y el rol en el array roles', () => {
    expect(toCreateUserDto({ name: '  Juan Pérez ', email: '  Juan@TEMA.com ', password: 'clave-1234', role: 'PROJECT_LEADER' })).toEqual({
      name: 'Juan Pérez',
      email: 'juan@tema.com',
      password: 'clave-1234',
      roles: ['PROJECT_LEADER'],
    });
  });

  it('manda ÚNICAMENTE name, email, password y roles: nunca passwordHash ni otros campos', () => {
    const dto = toCreateUserDto(valid);
    expect(Object.keys(dto).sort()).toEqual(['email', 'name', 'password', 'roles']);
    expect(JSON.stringify(dto)).not.toMatch(/hash/i);
  });
});

describe('createUserErrorMessage', () => {
  it('409 → email duplicado', () => {
    expect(createUserErrorMessage(new ApiRequestError(409, 'Conflict', ['Ya existe un usuario con ese email.']))).toBe('Ya existe un usuario con ese email.');
  });

  it('403 → sin permisos', () => {
    expect(createUserErrorMessage(new ApiRequestError(403, 'Forbidden', ['x']))).toBe('No tenés permisos para crear usuarios.');
  });

  it('400 → los mensajes de validación del backend', () => {
    expect(createUserErrorMessage(new ApiRequestError(400, 'Bad Request', ['La contraseña debe tener al menos 8 caracteres', 'El email no es válido']))).toBe(
      'La contraseña debe tener al menos 8 caracteres El email no es válido',
    );
  });

  it.each([new ApiRequestError(500, 'Server Error', ['TypeError: boom at x.ts:1']), new ApiRequestError(400, 'Bad Request', []), new TypeError('Failed to fetch'), null])(
    'cualquier otro error → mensaje genérico, sin detalles técnicos (%#)',
    (error) => {
      expect(createUserErrorMessage(error)).toBe('No se pudo crear el usuario. Intentá nuevamente.');
    },
  );
});

describe('submitNewUser', () => {
  it('éxito: llama a la API con el DTO correcto y devuelve el usuario creado', async () => {
    const api = vi.fn(async () => created);
    const outcome = await submitNewUser({ ...valid, email: ' Juan@TEMA.com ' }, api);

    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith({ name: 'Juan Pérez', email: 'juan@tema.com', password: 'clave-1234', roles: ['COLLABORATOR'] });
    expect(outcome).toEqual({ ok: true, user: created });
  });

  it('409 → ok=false, duplicateEmail=true y mensaje de email duplicado', async () => {
    const outcome = await submitNewUser(valid, async () => {
      throw new ApiRequestError(409, 'Conflict', ['Ya existe un usuario con ese email.']);
    });
    expect(outcome).toEqual({ ok: false, message: 'Ya existe un usuario con ese email.', duplicateEmail: true });
  });

  it('otros errores → ok=false, duplicateEmail=false; no relanza', async () => {
    const outcome = await submitNewUser(valid, async () => {
      throw new ApiRequestError(500, 'Server Error', []);
    });
    expect(outcome).toMatchObject({ ok: false, duplicateEmail: false });
  });
});
