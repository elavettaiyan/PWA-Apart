import { useEffect, useMemo, useRef } from 'react';
import { useAuthStore } from '../../store/authStore';
import {
  initializePushNotifications,
  openPendingPushNotificationTarget,
  syncStoredPushTokenWithServer,
  unregisterStoredPushToken,
} from '../../lib/pushNotifications';

export default function PushNotificationsBootstrap() {
  const { isAuthenticated, accessToken, user } = useAuthStore();
  const previousAuthStateRef = useRef<{ isAuthenticated: boolean; accessToken: string | null }>({
    isAuthenticated,
    accessToken,
  });

  const societyKey = useMemo(() => {
    const ids = new Set<string>();

    if (user?.societyId) {
      ids.add(user.societyId);
    }

    if (user?.activeSocietyId) {
      ids.add(user.activeSocietyId);
    }

    for (const society of user?.societies || []) {
      ids.add(society.id);
    }

    return [...ids].sort().join('|');
  }, [user?.activeSocietyId, user?.societyId, user?.societies]);

  useEffect(() => {
    void initializePushNotifications();
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !accessToken || !user) {
      return;
    }

    void openPendingPushNotificationTarget();
    void syncStoredPushTokenWithServer(accessToken, user);
  }, [accessToken, isAuthenticated, societyKey, user]);

  useEffect(() => {
    const previous = previousAuthStateRef.current;

    if (previous.isAuthenticated && !isAuthenticated && previous.accessToken) {
      void unregisterStoredPushToken(previous.accessToken);
    }

    previousAuthStateRef.current = {
      isAuthenticated,
      accessToken,
    };
  }, [accessToken, isAuthenticated]);

  return null;
}