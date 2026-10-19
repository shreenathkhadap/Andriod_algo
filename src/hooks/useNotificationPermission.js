import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// Tracks the OS-level notification permission (not an in-app "muted" flag —
// see src/utils/notificationPrefs.js for that). `status` is one of
// Notifications.PermissionStatus: 'granted' | 'denied' | 'undetermined', or
// null until the first check resolves.
//
// requestOrOpenSettings() only calls requestPermissionsAsync() while status
// is 'undetermined' — once the user has answered the native prompt once
// (either way), iOS and Android both refuse to show it again, so any further
// tap routes to the OS settings screen instead, which is the only place the
// user can change their answer from that point on.
export default function useNotificationPermission() {
  const [status, setStatus] = useState(null);
  const appState = useRef(AppState.currentState);

  const refresh = useCallback(async () => {
    if (Platform.OS === 'web') {
      setStatus('denied');
      return 'denied';
    }
    const { status: current } = await Notifications.getPermissionsAsync();
    console.log(`[notifPermission] refresh() -> ${current}`);
    setStatus(current);
    return current;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-check on return from background — catches the user having changed it
  // in the OS Settings screen (including via requestOrOpenSettings below)
  // while the app wasn't in the foreground to observe it directly.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        console.log('[notifPermission] app resumed from background, re-checking permission');
        refresh();
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, [refresh]);

  // Re-checks the REAL permission at call time instead of trusting the
  // `status` state variable — that state only resolves after an async
  // getPermissionsAsync() on mount, so a fast tap right after mount (e.g. on
  // the sign-in screen, the very first screen on a cold start) could still
  // see status === null/'undetermined' even though the true underlying
  // permission is already 'denied', wrongly calling requestPermissionsAsync()
  // (a silent no-op when already denied) instead of opening Settings.
  const requestOrOpenSettings = useCallback(async () => {
    if (Platform.OS === 'web') {
      console.warn('[notifPermission] Notifications are not available on web');
      return 'denied';
    }
    const { status: current } = await Notifications.getPermissionsAsync();
    setStatus(current);
    console.log(`[notifPermission] requestOrOpenSettings: fresh status = ${current}`);

    if (current === 'granted') {
      console.log('[notifPermission] already granted -> nothing to do');
      return current;
    }

    if (current === 'undetermined') {
      console.log('[notifPermission] status is undetermined -> calling requestPermissionsAsync()');
      const { status: requested } = await Notifications.requestPermissionsAsync();
      console.log(`[notifPermission] requestPermissionsAsync() -> ${requested}`);
      setStatus(requested);
      return requested;
    }

    // current === 'denied'
    console.log(`[notifPermission] status is already '${current}' -> opening OS settings instead of re-prompting (platform=${Platform.OS})`);
    try {
      if (Platform.OS === 'ios') {
        await Linking.openURL('app-settings:');
      } else {
        await Linking.openSettings();
      }
      console.log('[notifPermission] Settings screen opened successfully');
    } catch (err) {
      console.warn('[notifPermission] failed to open Settings:', err?.message ?? err);
    }
    // Actual result only lands once the user backs out of Settings — the
    // AppState listener above re-checks then. Nothing to update yet.
    return current;
  }, []);

  return { status, requestOrOpenSettings, refresh };
}
