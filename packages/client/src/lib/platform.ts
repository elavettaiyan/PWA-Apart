import { Capacitor } from '@capacitor/core';

export function isNativePlatform() {
  return Capacitor.isNativePlatform();
}

export function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function shouldUseHashRouter() {
  return isNativePlatform();
}

export function getApiBaseUrl() {
  return import.meta.env.VITE_MOBILE_API_URL || import.meta.env.VITE_API_URL || '/api';
}

export function buildAppLocation(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return isNativePlatform() ? `#${normalizedPath}` : normalizedPath;
}