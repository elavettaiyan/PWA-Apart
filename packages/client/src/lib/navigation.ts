import type { NavigateFunction } from 'react-router-dom';
import { buildAppLocation } from './platform';
import { useAuthStore } from '../store/authStore';

let navigator: NavigateFunction | null = null;

export function setNavigator(nextNavigator: NavigateFunction) {
  navigator = nextNavigator;
}

export function clearNavigator() {
  navigator = null;
}

export function navigateTo(path: string, replace = true) {
  if (navigator) {
    navigator(path, { replace });
    return;
  }

  if (typeof window !== 'undefined') {
    const location = buildAppLocation(path);
    if (replace) {
      window.location.replace(location);
    } else {
      window.location.assign(location);
    }
  }
}

export function redirectToLogin() {
  navigateTo('/login');
}