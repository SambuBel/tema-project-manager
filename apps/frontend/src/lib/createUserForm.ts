import type { CreateUserDto, RoleName, UserWithRoles } from '@tema/shared-types';
import { ApiRequestError } from './api';

/**
 * Roles globales que se pueden asignar al crear un usuario, en el orden del selector. OBSERVER también es un
 * rol GLOBAL en este sistema (existe en RoleName/roles y el drawer de permisos lo lista), además del rol local
 * de proyecto; por eso va. COLLABORATOR es el default, igual que en el backend.
 */
export const INITIAL_ROLE_OPTIONS: ReadonlyArray<{ value: RoleName; label: string }> = [
  { value: 'COLLABORATOR', label: 'Colaborador' },
  { value: 'PROJECT_LEADER', label: 'Líder de proyecto' },
  { value: 'PROGRAM_MANAGER', label: 'Program Manager' },
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'OBSERVER', label: 'Observador' },
];

export const DEFAULT_INITIAL_ROLE: RoleName = 'COLLABORATOR';

/** Mismos límites que CreateUserDto del backend (8 a 128). El backend sigue siendo la fuente de verdad. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export interface NewUserForm {
  name: string;
  email: string;
  password: string;
  role: RoleName;
}

export const EMPTY_NEW_USER_FORM: NewUserForm = { name: '', email: '', password: '', role: DEFAULT_INITIAL_ROLE };

export type NewUserErrors = Partial<Record<'name' | 'email' | 'password', string>>;

/** Validación básica de formato; NO se inventan reglas de dominio (eso lo decide el backend). */
const BASIC_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateNewUser(form: NewUserForm): NewUserErrors {
  const errors: NewUserErrors = {};
  if (!form.name.trim()) errors.name = 'El nombre es obligatorio.';

  const email = form.email.trim();
  if (!email) errors.email = 'El email es obligatorio.';
  else if (!BASIC_EMAIL.test(email)) errors.email = 'Ingresá un email válido.';

  if (!form.password) errors.password = 'La contraseña es obligatoria.';
  else if (form.password.length < PASSWORD_MIN_LENGTH) errors.password = `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  else if (form.password.length > PASSWORD_MAX_LENGTH) errors.password = `La contraseña puede tener como máximo ${PASSWORD_MAX_LENGTH} caracteres.`;
  return errors;
}

/** Lo ÚNICO que se envía: nombre (trim), email (trim + minúsculas), password y el rol inicial. Nada de passwordHash. */
export function toCreateUserDto(form: NewUserForm): CreateUserDto {
  return {
    name: form.name.trim(),
    email: form.email.trim().toLowerCase(),
    password: form.password,
    roles: [form.role],
  };
}

/** Mensaje para el usuario ante un fallo de POST /users. Nunca expone detalles técnicos. */
export function createUserErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 409) return 'Ya existe un usuario con ese email.';
    if (error.status === 403) return 'No tenés permisos para crear usuarios.';
    if (error.status === 400 && error.details.length > 0) return error.details.join(' ');
  }
  return 'No se pudo crear el usuario. Intentá nuevamente.';
}

export type CreateUserOutcome = { ok: true; user: UserWithRoles } | { ok: false; message: string; duplicateEmail: boolean };

/**
 * Envía el alta. Sin red ni React: recibe la función de API, así se prueba de punta a punta sin DOM. En error
 * devuelve el mensaje (el formulario se queda abierto con lo escrito); no relanza.
 */
export async function submitNewUser(
  form: NewUserForm,
  createUser: (dto: CreateUserDto) => Promise<UserWithRoles>,
): Promise<CreateUserOutcome> {
  try {
    return { ok: true, user: await createUser(toCreateUserDto(form)) };
  } catch (error) {
    return {
      ok: false,
      message: createUserErrorMessage(error),
      duplicateEmail: error instanceof ApiRequestError && error.status === 409,
    };
  }
}
