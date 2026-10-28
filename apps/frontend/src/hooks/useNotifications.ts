import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { NotificationPreference } from '../types/notification';

const KEY = ['notifications'] as const;
const POLL_MS = 60_000;

/** Cantidad de no leídas para el badge del sidebar (se refresca cada 60 s). */
export function useUnreadNotificationsCount(enabled = true) {
  const query = useQuery({
    queryKey: [...KEY, 'unread-count'],
    queryFn: api.getUnreadNotificationsCount,
    refetchInterval: POLL_MS,
    enabled,
  });
  return query.data?.count ?? 0;
}

export function useNotificationsList(unreadOnly: boolean, limit: number) {
  return useQuery({
    queryKey: [...KEY, 'list', { unreadOnly, limit }],
    queryFn: () => api.listNotifications({ unreadOnly, limit }),
    refetchInterval: POLL_MS,
  });
}

export function useNotificationActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });

  const markAsRead = useMutation({ mutationFn: api.markNotificationAsRead, onSuccess: refresh });
  const markAllAsRead = useMutation({ mutationFn: api.markAllNotificationsAsRead, onSuccess: refresh });
  return { markAsRead, markAllAsRead };
}

export function useNotificationPreferences() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: [...KEY, 'preferences'], queryFn: api.getNotificationPreferences });
  const update = useMutation({
    mutationFn: (prefs: NotificationPreference[]) => api.updateNotificationPreferences(prefs),
    onSuccess: (data) => qc.setQueryData([...KEY, 'preferences'], data),
  });
  return { query, update };
}