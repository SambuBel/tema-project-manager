import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { handleLoginSuccess, loginErrorMessage } from '../../lib/loginForm';

const inputClass =
  'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600';

/** Login con email + contraseña (POST /auth/login). La contraseña solo vive en el estado del componente. */
export function EmailPasswordForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const login = useMutation({
    mutationFn: () => api.login({ email, password }),
    onSuccess: (user) => handleLoginSuccess(user, queryClient, navigate),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password || login.isPending) return;
    login.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="login-email" className="text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="nombre@empresa.com"
          className={inputClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="login-password" className="text-sm font-medium text-slate-700">
          Contraseña
        </label>
        <div className="relative">
          <input
            id="login-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            className={`${inputClass} pr-24`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-3 text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            {showPassword ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
      </div>

      {login.isError && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {loginErrorMessage(login.error)}
        </p>
      )}

      <button
        type="submit"
        disabled={login.isPending || !email.trim() || !password}
        className="w-full rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {login.isPending ? 'Ingresando…' : 'Iniciar sesión'}
      </button>
    </form>
  );
}
