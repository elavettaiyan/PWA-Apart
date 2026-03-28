# Resilynk Android App Context

## Overview
This Android app is the native Capacitor shell for the Resilynk client application.

The React + Vite app in `packages/client` is built into static assets and loaded inside a Capacitor WebView. Most product logic lives in the web layer, not in native Android code.

## App Identity
- App name: Resilynk
- Application ID: `com.resilynk.mobile`
- Capacitor app ID: `com.resilynk.mobile`
- Native entry activity: `com.resilynk.mobile.MainActivity`
- Web build output: `dist`
- Android scheme: `https`

## Stack
- Capacitor 7
- Android Gradle Plugin 8.7.2
- React 18 + Vite + TypeScript
- TanStack Query
- Zustand
- Capacitor Preferences

## Important Paths
- Client source: `packages/client/src`
- Capacitor config: `packages/client/capacitor.config.ts`
- Android project: `packages/client/android`
- Android app module: `packages/client/android/app`
- Main activity: `packages/client/android/app/src/main/java/com/resilynk/mobile/MainActivity.java`
- Manifest: `packages/client/android/app/src/main/AndroidManifest.xml`
- App Gradle config: `packages/client/android/app/build.gradle`
- Shared Gradle variables: `packages/client/android/variables.gradle`

## How Android Works In This Repo
The Android app is a thin native shell over the client web app.

Native-specific behavior currently in use:
- `MainActivity` extends Capacitor `BridgeActivity`
- Android uses `HashRouter` instead of `BrowserRouter`
- Persisted app state uses Capacitor Preferences instead of `localStorage`
- Mobile builds use Vite `base: './'`
- The PWA plugin is disabled for mobile builds

## Runtime Behavior
### Routing
Native builds use hash-based routing.

Why it matters:
- Routes resolve as `#/path` inside the WebView
- Navigation and deep-link style behavior should be tested on hash routes for Android

### Storage
On native platforms, Zustand persistence is backed by Capacitor Preferences.

Why it matters:
- Auth/session data survives app restarts through Capacitor storage APIs
- Browser-specific storage assumptions can break mobile behavior

### API Resolution
The app resolves the API base URL in this order:
1. `VITE_MOBILE_API_URL`
2. `VITE_API_URL`
3. `/api`

Why it matters:
- `/api` works in local web development because Vite proxies to the backend
- Packaged Android builds should normally set `VITE_MOBILE_API_URL`

## Environment
Relevant example files:
- `packages/client/.env.mobile.example`
- `packages/client/.env.production.example`

Expected mobile setting:

```env
VITE_MOBILE_API_URL=https://your-backend.vercel.app/api
```

## Android Build Settings
Current values from `variables.gradle` and app Gradle config:
- `minSdkVersion = 23`
- `compileSdkVersion = 35`
- `targetSdkVersion = 35`
- `versionCode = 1`
- `versionName = 1.0`

Notes:
- Release minification is currently disabled
- `google-services.json` is required for Android push notifications because the app now uses Capacitor Push Notifications with Firebase Cloud Messaging
- The manifest currently declares `INTERNET` permission

## Push Notifications
- Android push registration is wired through Capacitor Push Notifications
- The app stores FCM device tokens on the backend via authenticated `/api/auth/push-tokens` calls
- Notification tap handling can deep-link into in-app routes through the notification `data.path` or `data.route` field

## Development Flow
### Install dependencies
```bash
cd packages/client
npm install
```

### Add Android project
```bash
cd packages/client
npm run mobile:add:android
```

### Build mobile web assets
```bash
cd packages/client
npm run mobile:build
```

### Build and sync Android
```bash
cd packages/client
npm run mobile:sync
```

### Open in Android Studio
```bash
cd packages/client
npm run mobile:open:android
```

## Backend Expectations
The Android app must be able to reach the backend directly from the emulator or device.

Important implication:
- The Vite dev proxy is not available in a packaged Android app
- Use a deployed backend URL or a reachable LAN URL via `VITE_MOBILE_API_URL`

## Validation Checklist
- App launches on emulator/device
- Login persists after restart
- Protected routes work with hash routing
- API calls hit the intended backend URL
- File uploads work inside the Android WebView
- Logout clears persisted auth state

## Summary
This Android app is the Capacitor-packaged version of the Resilynk client. The main Android-specific concerns are mobile API configuration, hash routing, Capacitor-backed persistence, and the build/sync flow into the native project.