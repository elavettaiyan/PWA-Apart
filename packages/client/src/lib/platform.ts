import { Capacitor } from '@capacitor/core';

export type ClientMedium = 'web' | 'android' | 'ios';

export function isNativePlatform() {
  return Capacitor.isNativePlatform();
}

export function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function isNativeIos() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

export function getClientMedium(): ClientMedium {
  if (isNativeAndroid()) return 'android';
  if (isNativeIos()) return 'ios';
  return 'web';
}

export function shouldUseHashRouter() {
  return isNativePlatform();
}

export function getApiBaseUrl() {
  return import.meta.env.VITE_MOBILE_API_URL || import.meta.env.VITE_API_URL || '/api';
}

export function getApiPublicBaseUrl() {
  const apiBaseUrl = getApiBaseUrl();
  const normalizedBase = apiBaseUrl.replace(/\/api\/?$/, '');

  if (/^https?:\/\//i.test(normalizedBase)) {
    return normalizedBase;
  }

  if (typeof window !== 'undefined') {
    const resolved = new URL(normalizedBase || '/', window.location.origin);
    return resolved.toString().replace(/\/$/, '');
  }

  return normalizedBase;
}

export function buildAppLocation(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return isNativePlatform() ? `#${normalizedPath}` : normalizedPath;
}