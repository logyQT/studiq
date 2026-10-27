'use client';

import type { NotificationList } from '@studiq/server/models/notification.model';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiMutation } from '@/hooks/use-api';
import { apiGet, apiPost } from '@/lib/api';

export const notificationKeys = {
  all: ['notifications'] as const,
};

/** How often the bell looks for new notifications while the tab is visible. */
const POLL_MS = 60_000;

/** The latest notifications and the unread count of the signed-in user. */
export function useNotifications(limit = 15) {
  return useQuery({
    queryKey: [...notificationKeys.all, limit],
    queryFn: () => apiGet<NotificationList>(`/api/v1/notifications?limit=${limit}`),
    // Stale at once: the poll and every popover open refetch it.
    staleTime: 0,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });
}

/** Marks one notification read and refreshes the list. */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useApiMutation<unknown, string>({
    mutationFn: (id) => apiPost(`/api/v1/notifications/${id}/read`, {}),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useApiMutation<unknown, void>({
    mutationFn: () => apiPost('/api/v1/notifications/read-all', {}),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
