import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  type PushNotificationSchema,
  type Token,
} from '@capacitor/push-notifications';
import { Preferences } from '@capacitor/preferences';
import toast from 'react-hot-toast';
import { notificationInboxKeys } from './notificationInbox';
import { getApiBaseUrl, isNativeIos } from './platform';
import { queryClient } from './queryClient';
import api from './api';
import { useAuthStore } from '../store/authStore';
import type { User } from '../types';

const PUSH_TOKEN_KEY = 'push.notification.token';
const PUSH_TOKEN_SYNC_KEY = 'push.notification.token.sync';

let listenersReady = false;
let initPromise: Promise<void> | null = null;

function isNativePushSupported() {
  return Capacitor.isNativePlatform();
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
  console.log('[Push] Token received from OS:', token.value.slice(0, 20) + '…');
  await storePushToken(token.value);

  const { isAuthenticated, accessToken, user } = useAuthStore.getState();
  if (isAuthenticated && accessToken && user) {
    await syncStoredPushTokenWithServer(accessToken, user);
  } else {
    console.warn('[Push] Token stored but user not authenticated yet — will sync on login');
  }
}

async function handleNotificationReceived(notification: PushNotificationSchema) {
  if (!notification.title && !notification.body) {
    return;
  }

  await queryClient.invalidateQueries({ queryKey: notificationInboxKeys.all });

  toast(notification.body || notification.title || 'New notification', {
    icon: 'i',
  });
}

export async function initializePushNotifications() {
  if (!isNativePushSupported()) {
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
        console.error('[Push] Registration error from OS:', JSON.stringify(error));
      });

      await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('[Push] Foreground notification received:', notification.title, '|', notification.body);
        void handleNotificationReceived(notification);
      });

      listenersReady = true;
    }

    const permissionStatus = await PushNotifications.checkPermissions();
    console.log('[Push] Permission status:', permissionStatus.receive);
    const finalStatus = permissionStatus.receive === 'prompt'
      ? await PushNotifications.requestPermissions()
      : permissionStatus;

    console.log('[Push] Final permission:', finalStatus.receive);
    if (finalStatus.receive !== 'granted') {
      console.warn('[Push] Permission not granted — push disabled');
      return;
    }

    console.log('[Push] Calling PushNotifications.register()');
    await PushNotifications.register();
  })();

  return initPromise;
}

export async function syncStoredPushTokenWithServer(accessToken: string, user: User) {
  if (!isNativePushSupported()) {
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

  const platform = isNativeIos() ? 'ios' : 'android';
  console.log('[Push] Syncing token to server — platform:', platform, 'token prefix:', token.slice(0, 20) + '…', 'societies:', societyIds);

  try {
    const result = await api.post(
      '/auth/push-tokens',
      { token, platform, societyIds },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    console.log('[Push] Token sync success:', result.data);
  } catch (err: any) {
    console.error('[Push] Token sync failed:', err?.response?.status, err?.response?.data || err?.message);
    return;
  }

  await writeStoredSyncKey(syncKey);
}

export async function unregisterStoredPushToken(accessToken: string) {
  if (!isNativePushSupported()) {
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