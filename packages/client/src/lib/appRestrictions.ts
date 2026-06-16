import { Browser } from '@capacitor/browser';
import type { NavigationMenuId } from '../types';
import { isNativeIos } from './platform';

export interface RestrictionMessage {
  title: string;
  description: string;
  actionLabel: string;
  webUrl: string;
}

export type RestrictedActionKey = 'register-community';
export type RestrictedRoutePath = '/register' | '/flats' | '/assets';
export type RestrictedSectionKey = 'settings-premium-plan';

interface PlatformRestrictionConfig {
  actions: Partial<Record<RestrictedActionKey, RestrictionMessage>>;
  routes: Partial<Record<RestrictedRoutePath, RestrictionMessage>>;
  menus: NavigationMenuId[];
  sections: Partial<Record<RestrictedSectionKey, true>>;
}

const WEB_APP_URL = 'https://app.dwellhub.in';

const REGISTER_COMMUNITY_RESTRICTION: RestrictionMessage = {
  title: 'Register on the web app',
  description: 'Community registration is not available in the iOS app. Please continue on the web app to create and configure your community.',
  actionLabel: 'Open web app',
  webUrl: WEB_APP_URL,
};

const ASSETS_RESTRICTION: RestrictionMessage = {
  title: 'Manage assets on the web app',
  description: 'Asset setup is not available in the iOS app. Please use the web app to add assets and manage service records.',
  actionLabel: 'Open web app',
  webUrl: WEB_APP_URL,
};

const IOS_RESTRICTIONS: PlatformRestrictionConfig = {
  actions: {
    'register-community': REGISTER_COMMUNITY_RESTRICTION,
  },
  routes: {
    '/register': REGISTER_COMMUNITY_RESTRICTION,
    '/assets': ASSETS_RESTRICTION,
  },
  menus: ['assets'],
  sections: {
    'settings-premium-plan': true,
  },
};

function getActiveRestrictionConfig() {
  if (isNativeIos()) {
    return IOS_RESTRICTIONS;
  }

  return null;
}

export function getActionRestriction(actionKey: RestrictedActionKey) {
  return getActiveRestrictionConfig()?.actions[actionKey] ?? null;
}

export function getRouteRestriction(path: RestrictedRoutePath) {
  return getActiveRestrictionConfig()?.routes[path] ?? null;
}

export function isMenuRestricted(menuId: NavigationMenuId) {
  return getActiveRestrictionConfig()?.menus.includes(menuId) ?? false;
}

export function isSectionRestricted(sectionKey: RestrictedSectionKey) {
  return Boolean(getActiveRestrictionConfig()?.sections[sectionKey]);
}

export async function openRestrictionWebUrl(url: string) {
  try {
    await Browser.open({ url });
    return;
  } catch {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }
}
