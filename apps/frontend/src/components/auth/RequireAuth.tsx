import { Navigate, Outlet } from 'react-router-dom';
import { useCurrentUser } from '../../hooks/useCurrentUser';

/**
 * Envuelve las rutas privadas. Mientras se resuelve GET /auth/me no redirige
 * todavía (evita un parpadeo a /login en cada F5 con sesión válida); si termina
 * sin usuario, manda a /login. No guarda la ruta de origen para volver después:
 * el login es un redirect completo a Google y de vuelta (no queda estado de
 * React vivo en el medio), así que "volver a donde estaba" necesitaría que el
 * backend lo codifique en el `state` de OAuth — no implementado todavía.
 */
export function RequireAuth() {
  const { user, isLoading } = useCurrentUser();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Cargando…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
