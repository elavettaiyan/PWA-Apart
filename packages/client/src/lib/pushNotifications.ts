import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  type PushNotificationSchema,
  type Token,
  type ActionPerformed,
} from '@capacitor/push-notifications';
import { Preferences } from '@capacitor/preferences';
import toast from 'react-hot-toast';
import { navigateTo } from './navigation';
import { getApiBaseUrl } from './platform';
import api from './api';
import { useAuthStore } from '../store/authStore';
import type { User } from '../types';

const PUSH_TOKEN_KEY = 'push.notification.token';
const PUSH_TOKEN_SYNC_KEY = 'push.notification.token.sync';

let listenersReady = false;
let initPromise: Promise<void> | null = null;

function isAndroidPushSupported() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function buildSocietyIds(user: User) {
  const ids = new Set<string>();

  if (user.societyId) {
    ids.add(user.societyId);
  }

  if (user.activeSocietyId) {
    ids.add(user.activeSocietyId);
  }

  for (const society of user.societies || []) {
    ids.add(society.id);
  }

  return [...ids];
}

function buildSyncKey(token: string, user: User) {
  return JSON.stringify({
    token,
    userId: user.id,
    societyIds: buildSocietyIds(user).sort(),
  });
}

function resolveNotificationTarget(notification: PushNotificationSchema | ActionPerformed['notification']) {
  const route = notification.data?.route;
  const path = notification.data?.path;
  const target = typeof route === 'string' && route ? route : typeof path === 'string' && path ? path : null;

  if (!target) {
    return null;
  }

  return target.startsWith('/') ? target : `/${target}`;
}

async function storePushToken(token: string) {
  await Preferences.set({ key: PUSH_TOKEN_KEY, value: token });
}

async function readStoredPushToken() {
  const { value } = await Preferences.get({ key: PUSH_TOKEN_KEY });
  return value;
}

async function readStoredSyncKey() {
  const { value } = await Preferences.get({ key: PUSH_TOKEN_SYNC_KEY });
  return value;
}

async function writeStoredSyncKey(value: string) {
  await Preferences.set({ key: PUSH_TOKEN_SYNC_KEY, value });
}

async function clearStoredSyncKey() {
  await Preferences.remove({ key: PUSH_TOKEN_SYNC_KEY });
}

async function handleRegistration(token: Token) {
  await storePushToken(token.value);

  const { isAuthenticated, accessToken, user } = useAuthStore.getState();
  if (isAuthenticated && accessToken && user) {
    await syncStoredPushTokenWithServer(accessToken, user);
  }
}

async function handleNotificationReceived(notification: PushNotificationSchema) {
  if (!notification.title && !notification.body) {
    return;
  }

  toast(notification.body || notification.title || 'New notification', {
    icon: 'i',
  });
}

async function handleNotificationAction(action: ActionPerformed) {
  const target = resolveNotificationTarget(action.notification);

  if (target) {
    navigateTo(target, false);
  }
}

export async function initializePushNotifications() {
  if (!isAndroidPushSupported()) {
    return;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    if (!listenersReady) {
      await PushNotifications.addListener('registration', (token) => {
        void handleRegistration(token);
      });

      await PushNotifications.addListener('registrationError', (error) => {
        console.error('Push registration failed', error);
      });

      await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        void handleNotificationReceived(notification);
      });

      await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        void handleNotificationAction(action);
      });

      listenersReady = true;
    }

    const permissionStatus = await PushNotifications.checkPermissions();
    const finalStatus = permissionStatus.receive === 'prompt'
      ? await PushNotifications.requestPermissions()
      : permissionStatus;

    if (finalStatus.receive !== 'granted') {
      return;
    }

    await PushNotifications.register();
  })();

  return initPromise;
}

export async function syncStoredPushTokenWithServer(accessToken: string, user: User) {
  if (!isAndroidPushSupported()) {
    return;
  }

  const token = await readStoredPushToken();
  if (!token) {
    return;
  }

  const syncKey = buildSyncKey(token, user);
  const previousSyncKey = await readStoredSyncKey();

  if (previousSyncKey === syncKey) {
    return;
  }

  const societyIds = buildSocietyIds(user);
  if (societyIds.length === 0) {
    return;
  }

  await api.post(
    '/auth/push-tokens',
    {
      token,
      platform: 'android',
      societyIds,
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  await writeStoredSyncKey(syncKey);
}

export async function unregisterStoredPushToken(accessToken: string) {
  if (!isAndroidPushSupported()) {
    return;
  }

  const token = await readStoredPushToken();
  if (!token) {
    return;
  }

  await fetch(`${getApiBaseUrl()}/auth/push-tokens`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ token }),
  }).catch((error) => {
    console.error('Push token cleanup failed', error);
  });

  await clearStoredSyncKey();
}