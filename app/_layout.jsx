import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { Provider } from 'react-redux';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import useNotificationPermission from '../src/hooks/useNotificationPermission';
import useLastNotificationResponse from '../src/hooks/useLastNotificationResponse';
import {
  BACKGROUND_NOTIFICATION_TASK,
  saveAlertToStorage,
} from '../src/notifications/backgroundTask';
import { store } from '../src/store/index';

// Routes to the screen that actually renders the alert list
// (NotificationMessagesRN, via InsightScreen) for the tapped user's role.
// Viewer's tab route names are swapped vs admin's (`investigate` renders
// InsightScreen for viewer, `insights` does for admin) — this is just
// following each role's existing tab wiring, see app/(admin)/tabs and
// app/(viewer)/tabs.
const getNotificationsRoute = (role) => {
  if (role === 'admin')  return '/(admin)/tabs/insights';
  if (role === 'viewer') return '/(viewer)/tabs/investigate';
  return null;
};

// Carries the tapped alert's identity (the same (groupId, cameraName,
// incidentTime) triple SQLite dedupes on) so the Notifications screen can
// jump straight to that exact alert — auto-selecting its group and
// scrolling/highlighting it — instead of just landing on whatever group was
// already selected there.
const navigateToNotifications = (router, role, data) => {
  const pathname = getNotificationsRoute(role);
  if (!pathname) return;
  router.push({
    pathname,
    params: {
      tab: 'notifications',
      focusGroupId: data?.groupId,
      focusCameraName: data?.cameraName,
      focusIncidentTime: data?.incidentTime,
    },
  });
};

// ── ROOT LAYOUT CONTENT ───────────────────────────────────────────────────────
function RootLayoutContent() {
  const { isLoading, user } = useAuth();
  const router = useRouter();
  const notificationListener    = useRef(null);
  const notificationTapListener = useRef(null);
  // Shared between STEP 3 and STEP 5 below — both are independent ways of
  // finding out about the SAME tap (useLastNotificationResponse reflects the
  // most recent response regardless of app state, not just cold starts), so
  // without a shared guard, tapping a notification while the app is merely
  // backgrounded (process alive, not killed) fired BOTH: STEP 5's listener
  // navigated immediately, then STEP 3's effect navigated to the exact same
  // place again ~500ms later, since STEP 3 only ever checked ITS OWN ref —
  // it had no way to know STEP 5 already handled this exact response.
  const handledNotificationResponseId = useRef(null);
  const { status: notifPermissionStatus, requestOrOpenSettings } = useNotificationPermission();

  // ── STEP 1: Register background notification task ─────────────────────────
  // Must be done inside useEffect (after component mounts), NOT at module level.
  // Calling registerTaskAsync at module level races against native init and
  // silently fails on Android — the task never actually receives notifications.
  useEffect(() => {
    console.log('[_layout] Registering background notification task...');
    Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK)
      .then(() => console.log('[_layout] Background notification task registered'))
      .catch((err) => console.warn('[_layout] Background task registration failed:', err));

    return () => {
      // Unregister on unmount (e.g. during hot reload in dev)
      Notifications.unregisterTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => {});
    };
  }, []);

  // ── STEP 1B: Ensure the "alerts" notification channel exists (Android) ────
  // The server sends channelId: "alerts" on every push. If this channel isn't
  // created client-side, Android silently falls back to the default channel
  // and drops the custom sound/priority settings.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    Notifications.setNotificationChannelAsync('alerts', {
      name: 'Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    })
      .then(() => console.log('[_layout] "alerts" notification channel ready'))
      .catch((err) => console.warn('[_layout] Failed to set notification channel:', err));
  }, []);

  // ── STEP 2: Ensure push permission is granted ──────────────────────────────
  // NOTE: We do NOT register the push token with the backend here anymore.
  // The login Lambda (loginMobileUser) already requires `expoToken` as part
  // of the login request body and stores it directly on the user's
  // mobile-users record via UpdateItemCommand — there is no separate
  // `/register-push-token` endpoint, and there never needs to be one.
  //
  // This effect now only makes sure notification permission is granted after
  // login, so the app can request/refresh the token before hitting the login
  // API (see the signin screen, which should call
  // Notifications.getExpoPushTokenAsync() and include the result as
  // `expoToken` in the login POST body).
  //
  // If you need to re-sync the token later (e.g. it rotates while the user
  // stays logged in), do it through a re-login / refresh flow that reuses
  // the same login endpoint's expoToken field — do NOT reintroduce a fetch
  // to `/register-push-token`, since that route does not exist.
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const ensurePushPermission = async () => {
      try {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }

        if (finalStatus !== 'granted') {
          console.warn('[_layout] Push notification permission not granted');
          return;
        }

        // Fetched here only for logging/debugging visibility. The token that
        // actually matters is the one captured on the signin screen and sent
        // as `expoToken` in the login request body.
        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: Constants.expoConfig?.extra?.eas?.projectId,
        });
        console.log('[_layout] Expo push token (informational only):', tokenData.data);
      } catch (err) {
        console.warn('[_layout] Push permission/token check failed:', err.message);
      }
    };

    ensurePushPermission();
  }, [user]);

  // ── STEP 3: Catch tap that launched app from killed state ─────────────────
  // addNotificationResponseReceivedListener only fires when app is already in
  // memory. If the app was fully killed and user taps the notification to open
  // it, that listener was never registered. useLastNotificationResponse reads
  // the last tapped notification on every mount — even after a full kill+relaunch.
  const lastResponse = useLastNotificationResponse();
  useEffect(() => {
    if (!lastResponse || isLoading) return;

    // useLastNotificationResponse keeps returning the SAME response object
    // on every render until a new tap happens — without this identifier
    // guard, this effect would re-fire (and re-navigate) every time
    // `isLoading`/`user` change after a tap already handled, e.g. once auth
    // finishes loading from SecureStore. Shared with STEP 5's tap listener
    // below (see handledNotificationResponseId's own comment) so the SAME
    // tap can't navigate twice — once from whichever of the two fires first.
    const id = lastResponse.notification.request.identifier;
    if (handledNotificationResponseId.current === id) return;
    handledNotificationResponseId.current = id;

    const data = lastResponse.notification.request.content.data;
    console.log('[_layout] Cold-start tap response received:', JSON.stringify(data));
    if (!data?.groupId) {
      console.log('[_layout] No groupId in cold-start tap response');
      return;
    }
    (async () => {
      // Awaited so the shared alerts store (useSharedAlerts.js) already has
      // this exact alert written in by the time Notifications mounts and
      // reads it — that's what makes it show up instantly there instead of
      // waiting on the next network sync to pull it back down.
      await saveAlertToStorage(data);
      if (user) {
        // AuthContext's own redirect effect also fires right after auth
        // finishes loading and sends a cold-started user to their role's
        // Home tab via router.replace() — that effect lives in the PARENT
        // (AuthProvider) and commits AFTER this child effect, so pushing
        // to Notifications in the same tick would get immediately
        // overwritten by that replace(). The short delay lets the initial
        // replace settle first so this push actually sticks.
        setTimeout(() => navigateToNotifications(router, user.role, data), 500);
      }
    })();
  }, [lastResponse, isLoading, user, router]);

  // ── STEP 4: Prompt to enable notifications after login ─────────────────────
  // FIX: this effect previously called an undefined `maybePrompt()` (copy/paste
  // leftover from Step 4B below) and its own `startService` body referenced an
  // out-of-scope `promptKey` — both threw a ReferenceError the moment this ran
  // on Android after login. Each effect now owns its own storage key and calls
  // the function it actually defines.
  //
  // NOTE: if this is meant to also start a persistent foreground service
  // ("Aksha is active" in the notification shade) rather than just prompt for
  // permission, that call still needs to be added here — nothing below starts
  // one despite the original comment claiming it did. Requires a real APK/AAB
  // build; does not work in Expo Go.
  useEffect(() => {
    if (!user || Platform.OS !== 'android') return;
    const promptKey = 'aksha_notif_prompt_shown';

    const startService = async () => {
      try {
        const alreadyShown = await AsyncStorage.getItem(promptKey);
        if (alreadyShown) return;

        await AsyncStorage.setItem(promptKey, 'true');

        Alert.alert(
          'Enable Notifications',
          'Turn on notifications to get real-time alerts from Aksha as soon as they happen.',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Enable', onPress: () => requestOrOpenSettings() },
          ],
        );
      } catch (err) {
        // Does NOT crash the app. Common in Expo Go (expected) or if
        // FOREGROUND_SERVICE permission is missing from AndroidManifest.
        console.warn('Foreground service failed to start:', err.message);
      }
    };

    startService();
  }, [user, notifPermissionStatus, requestOrOpenSettings]);

  // ── STEP 4B: Prompt to exempt from battery optimization (Android) ─────────
  // No app-level code can override OEM battery management (Xiaomi/Oppo/Vivo/
  // etc. kill background tasks and foreground services regardless of the
  // FOREGROUND_SERVICE permission). The only real fix is the user granting
  // "unrestricted" background battery usage in system settings. Prompt once
  // per install, right after login, and deep-link into the app's settings
  // page as the closest starting point Android exposes without a native
  // module (from there the user taps Battery -> Unrestricted).
  useEffect(() => {
    if (!user || Platform.OS !== 'android') return;

    const promptKey = 'aksha_battery_prompt_shown';

    const maybePrompt = async () => {
      try {
        const alreadyShown = await AsyncStorage.getItem(promptKey);
        if (alreadyShown) return;

        Alert.alert(
          'Keep alerts reliable',
          'Some phone brands (Xiaomi, Oppo, Vivo, etc.) stop apps running in the background to save battery, which can block Aksha alerts when the app isn\'t open. To keep receiving alerts reliably, open Settings and allow Aksha to run unrestricted in the background.',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );

        await AsyncStorage.setItem(promptKey, 'true');
      } catch (err) {
        console.warn('Battery optimization prompt failed:', err.message);
      }
    };

    maybePrompt();
  }, [user]);

  // ── STEP 5: Foreground & tap notification listeners ───────────────────────
  useEffect(() => {
    console.log('[_layout] Foreground & tap listeners attached');

    // Foreground: notification arrives while app is open
    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        const data = notification.request.content.data;
        console.log('[_layout] FOREGROUND notification received:', JSON.stringify(data));
        if (data?.groupId) {
          // Only saves to local storage here. The tray popup itself is left
          // entirely to BACKGROUND_NOTIFICATION_TASK (backgroundTask.js) —
          // on this device that task fires for every push regardless of app
          // state (confirmed in logcat: it fired even while foregrounded,
          // 5ms before this same listener), so this listener calling
          // showAlertNotification too was producing two tray entries for
          // one alert.
          saveAlertToStorage(data);
        } else {
          console.log('[_layout] No groupId in foreground notification data:', JSON.stringify(data));
        }
      });

    // Tap: user taps notification while app is in background (not killed).
    // The app is already routed into the correct auth group here (it never
    // left it), so — unlike the cold-start case above — there's no
    // competing redirect effect to race against, and this can navigate
    // immediately.
    notificationTapListener.current =
      Notifications.addNotificationResponseReceivedListener(async (response) => {
        const data = response.notification.request.content.data;
        console.log('[_layout] Notification TAPPED (user opened via popup):', JSON.stringify(data));

        // useLastNotificationResponse (STEP 3 above) reflects the most
        // recent tap regardless of app state — not just cold starts — so
        // it ALSO fires for this exact same tap whenever the app process is
        // alive (i.e. backgrounded, not killed). Claiming this response's id
        // here means STEP 3's effect sees it already handled and skips its
        // own (delayed) navigation, instead of both firing for one tap.
        const id = response.notification.request.identifier;
        if (handledNotificationResponseId.current === id) return;
        handledNotificationResponseId.current = id;

        if (data?.groupId) {
          // Awaited (unlike the foreground listener above) so the shared
          // alerts store already has this alert by the time Notifications
          // mounts/re-focuses — that's what lets it show up instantly there
          // instead of waiting on the next sync to pull it back down.
          await saveAlertToStorage(data);
          if (user) navigateToNotifications(router, user.role, data);
        } else {
          console.log('[_layout] No groupId in tapped notification:', JSON.stringify(data));
        }
      });

    return () => {
      notificationListener.current?.remove();
      notificationTapListener.current?.remove();
    };
  }, [user, router]);

  if (isLoading) return null;

  return (
    <Stack>
      <Stack.Screen name="index"    options={{ headerShown: false, title: 'Choose Role' }} />
      <Stack.Screen name="signin"   options={{ title: 'Sign In' }} />
      <Stack.Screen name="signup"   options={{ title: 'Sign Up' }} />
      <Stack.Screen name="(admin)"  options={{ headerShown: false }} />
      <Stack.Screen name="(viewer)" options={{ headerShown: false }} />
    </Stack>
  );
}

// ── ROOT LAYOUT ───────────────────────────────────────────────────────────────
export default function RootLayout() {
  return (
    <Provider store={store}>
      <AuthProvider>
        <RootLayoutContent />
      </AuthProvider>
    </Provider>
  );
}