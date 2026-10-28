import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useNotificationActions,
  useNotificationPreferences,
  useNotificationsList,
} from '../hooks/useNotifications';
import { NOTIFICATION_TYPE_INFO, type AppNotification, type NotificationType } from '../types/notification';

const PAGE_SIZE = 20;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Destino al hacer click: la tarea (si hay) o el proyecto. */
function targetOf(n: AppNotification): string | null {
  if (n.projectId && n.taskId) {
    return '/projects/' + n.projectId + '?view=tasks&taskId=' + n.taskId;
  }

  if (n.projectId) {
    return '/projects/' + n.projectId;
  }

  return null;
}

/** RF-NO-04: el usuario elige qué tipos de notificación recibe. */
function PreferencesPanel() {
  const { query, update } = useNotificationPreferences();
  const prefs = query.data ?? [];

  const toggle = (type: NotificationType, enabled: boolean) =>
    update.mutate(prefs.map((p) => (p.type === type ? { ...p, enabled } : p)));

  return (
    <section aria-labelledby="notif-prefs-title" className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 id="notif-prefs-title" className="text-lg font-semibold">
        Qué notificaciones querés recibir
      </h2>
      {query.isLoading && <p className="mt-2 text-sm text-slate-500">Cargando…</p>}
      {query.isError && <p className="mt-2 text-sm text-red-600">No se pudieron cargar las preferencias.</p>}
      <ul className="mt-3 divide-y divide-slate-100">
        {prefs.map((p) => {
          const info = NOTIFICATION_TYPE_INFO[p.type];
          return (
            <li key={p.type} className="flex items-center justify-between gap-4 py-3">
              <label htmlFor={'pref-' + p.type} className="flex-1 cursor-pointer">
                <span className="block text-sm font-medium">{info?.label ?? p.type}</span>
                <span className="block text-xs text-slate-500">{info?.description}</span>
              </label>
              <input
                id={'pref-' + p.type}
                type="checkbox"
                className="h-4 w-4"
                checked={p.enabled}
                disabled={update.isPending}
                onChange={(e) => toggle(p.type, e.target.checked)}
              />
            </li>
          );
        })}
      </ul>
      {update.isError && <p className="mt-2 text-sm text-red-600">No se pudieron guardar los cambios.</p>}
    </section>
  );
}

/** RF-NO-03: centro de notificaciones con no leídas destacadas. */
export function NotificationsPage() {
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const { data, isLoading, isError } = useNotificationsList(unreadOnly, limit);
  const { markAsRead, markAllAsRead } = useNotificationActions();

  const items = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  const open = (n: AppNotification) => {
    if (!n.readAt) markAsRead.mutate(n.id);
    const target = targetOf(n);
    if (target) navigate(target);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Notificaciones</h1>
          <p className="text-sm text-slate-500">
            {unreadCount > 0 ? unreadCount + ' sin leer' : 'No tenés notificaciones sin leer'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => markAllAsRead.mutate()}
          disabled={unreadCount === 0 || markAllAsRead.isPending}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          Marcar todas como leídas
        </button>
      </header>

      <div role="tablist" aria-label="Filtro" className="flex gap-2">
        {[
          { label: 'Todas', value: false },
          { label: 'No leídas', value: true },
        ].map((tab) => (
          <button
            key={tab.label}
            role="tab"
            type="button"
            aria-selected={unreadOnly === tab.value}
            onClick={() => {
              setUnreadOnly(tab.value);
              setLimit(PAGE_SIZE);
            }}
            className={
              'rounded-full px-3 py-1 text-sm ' +
              (unreadOnly === tab.value ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {isError && <p className="text-sm text-red-600">No se pudieron cargar las notificaciones.</p>}
      {!isLoading && !isError && items.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          {unreadOnly ? 'No hay notificaciones sin leer.' : 'Todavía no tenés notificaciones.'}
        </p>
      )}

      <ul className="space-y-2">
        {items.map((n) => {
          const unread = !n.readAt;
          return (
            <li
              key={n.id}
              className={
                'flex items-start gap-3 rounded-xl border p-3 ' +
                (unread ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-white')
              }
            >
              <span
                aria-hidden="true"
                className={'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ' + (unread ? 'bg-sky-500' : 'bg-transparent')}
              />
              <button type="button" onClick={() => open(n)} className="flex-1 text-left">
                <span className={'block text-sm ' + (unread ? 'font-semibold' : 'font-medium')}>{n.title}</span>
                <span className="block text-sm text-slate-600">{n.message}</span>
                <span className="mt-1 block text-xs text-slate-400">{formatDate(n.createdAt)}</span>
              </button>
              {unread && (
                <button
                  type="button"
                  onClick={() => markAsRead.mutate(n.id)}
                  className="shrink-0 text-xs font-medium text-sky-700 hover:underline"
                >
                  Marcar como leída
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {data && items.length < data.total && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + PAGE_SIZE)}
          className="mx-auto block rounded-lg border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-50"
        >
          Ver más
        </button>
      )}

      <PreferencesPanel />
    </div>
  );
}