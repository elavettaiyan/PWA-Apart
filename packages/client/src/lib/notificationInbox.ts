import api from './api';
import type { UserNotification } from '../types';

export const notificationInboxKeys = {
  all: ['notifications'] as const,
  list: (limit: number, societyId?: string) => ['notifications', 'list', limit, societyId || 'none'] as const,
};

export async function fetchNotifications(limit = 20) {
  const response = await api.get('/notifications', {
    params: { limit },
  });

  return response.data as UserNotification[];
}