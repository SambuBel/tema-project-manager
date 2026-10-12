import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RoleName, UserWithRoles } from '@tema/shared-types';
import { api } from '../../lib/api';
import {
  EMPTY_NEW_USER_FORM,
  INITIAL_ROLE_OPTIONS,
  PASSWORD_MIN_LENGTH,
  submitNewUser,
  validateNewUser,
  type NewUserErrors,
  type NewUserForm,
} from '../../lib/createUserForm';

interface CreateUserDrawerProps {
  onClose: () => void;
  /** El alta salió bien (el listado ya fue invalidado): el padre cierra el drawer y avisa. */
  onCreated: (user: UserWithRoles) => void;
}

const inputClass =
  'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-[#172B42] placeholder:text-[#607185] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500';
const borderFor = (hasError: boolean) => (hasError ? 'border-red-400' : 'border-[#DEE5EC]');
const labelClass = 'text-sm font-medium text-[#172B42]';

/**
 * Alta de un usuario por un ADMIN (POST /users). Mismo patrón visual que UserRolesDrawer (panel a la derecha,
 * overlay, role="dialog"). Solo da de alta: NO inicia sesión, no toca al usuario actual ni vincula Google.
 * La contraseña vive únicamente en el estado del componente: no se persiste ni se loguea.
 */
export function CreateUserDrawer({ onClose, onCreated }: CreateUserDrawerProps) {
  const qc = useQueryClient();
  const ids = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<NewUserForm>(EMPTY_NEW_USER_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicateEmail, setDuplicateEmail] = useState(false);

  const create = useMutation({
    mutationFn: () => submitNewUser(form, api.createUser),
    onSuccess: (outcome) => {
      if (outcome.ok) {
        // El usuario nuevo aparece en la tabla sin recargar: se invalida todo lo que cuelga de ['users'].
        void qc.invalidateQueries({ queryKey: ['users'] });
        onCreated(outcome.user);
        return;
      }
      // Error del backend: el drawer queda abierto y conserva todo lo escrito.
      setServerError(outcome.message);
      setDuplicateEmail(outcome.duplicateEmail);
    },
  });
  const isPending = create.isPending;

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPending, onClose]);

  const errors: NewUserErrors = submitted ? validateNewUser(form) : {};
  const emailError = errors.email ?? (duplicateEmail ? 'Ya existe un usuario con ese email.' : undefined);

  const update = <K extends keyof NewUserForm>(key: K, value: NewUserForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setServerError(null);
    if (key === 'email') setDuplicateEmail(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isPending) return; // sin doble submit
    setSubmitted(true);
    setServerError(null);
    if (Object.keys(validateNewUser(form)).length > 0) return;
    create.mutate();
  };

  const field = (name: string) => `${ids}-${name}`;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-slate-900/50" aria-hidden="true" onClick={() => !isPending && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={field('title')}
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white p-6 shadow-lg"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 id={field('title')} className="text-base font-semibold text-[#172B42]">
              Nuevo usuario
            </h2>
            <p className="mt-1 text-sm text-[#607185]">Creá un usuario para que pueda acceder a TEMA.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="Cerrar"
            className="rounded-md p-1 text-[#607185] hover:bg-gray-100 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-1 flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={field('name')} className={labelClass}>
              Nombre
            </label>
            <input
              ref={nameRef}
              id={field('name')}
              type="text"
              autoComplete="off"
              placeholder="Ej. Juan Pérez"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? field('name-error') : undefined}
              className={`${inputClass} ${borderFor(!!errors.name)}`}
            />
            {errors.name && (
              <p id={field('name-error')} role="alert" className="text-xs text-red-600">
                {errors.name}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={field('email')} className={labelClass}>
              Email
            </label>
            <input
              id={field('email')}
              type="email"
              autoComplete="off"
              placeholder="nombre@empresa.com"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              aria-invalid={!!emailError}
              aria-describedby={emailError ? field('email-error') : undefined}
              className={`${inputClass} ${borderFor(!!emailError)}`}
            />
            {emailError && (
              <p id={field('email-error')} role="alert" className="text-xs text-red-600">
                {emailError}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={field('password')} className={labelClass}>
              Contraseña inicial
            </label>
            <div className="relative">
              <input
                id={field('password')}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                aria-invalid={!!errors.password}
                aria-describedby={`${field('password-help')}${errors.password ? ` ${field('password-error')}` : ''}`}
                className={`${inputClass} pr-20 ${borderFor(!!errors.password)}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-3 text-xs font-medium text-[#607185] hover:text-[#172B42]"
              >
                {showPassword ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
            <p id={field('password-help')} className="text-xs text-[#607185]">
              Mínimo {PASSWORD_MIN_LENGTH} caracteres.
            </p>
            {errors.password && (
              <p id={field('password-error')} role="alert" className="text-xs text-red-600">
                {errors.password}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={field('role')} className={labelClass}>
              Rol inicial
            </label>
            <select
              id={field('role')}
              value={form.role}
              onChange={(e) => update('role', e.target.value as RoleName)}
              className={`${inputClass} ${borderFor(false)}`}
            >
              {INITIAL_ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {serverError && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {serverError}
            </p>
          )}

          <div className="mt-auto flex items-center justify-end gap-3 border-t border-[#DEE5EC] pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-lg border border-[#DEE5EC] px-4 py-2 text-sm font-medium text-[#172B42] hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a445b] disabled:opacity-50"
            >
              {isPending ? 'Creando…' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
