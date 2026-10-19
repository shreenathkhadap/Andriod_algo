import dayjs from 'dayjs';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { DeviceEventEmitter, Platform } from 'react-native';
import { saveIncomingAlert } from '../utils/alertStorage';
import { withKeyLock } from '../utils/keyLock';
import { getNotificationsEnabled, getNotificationsEnabledSince } from '../utils/notificationPrefs';

// This module MUST be imported at the top of app/_layout.jsx (before any
// component mounts), because TaskManager.defineTask and
// Notifications.setNotificationHandler are both hard requirements to run at
// module-load time — ES module imports execute synchronously on first
// import, so importing this file early is equivalent to inlining it there.

export const BACKGROUND_NOTIFICATION_TASK = 'BACKGROUND-NOTIFICATION-TASK';
export const FOREGROUND_SERVICE_TASK = 'AKSHA-FOREGROUND-SERVICE';

// Fixed tray notification identifier — every alert reuses this same id so a
// new one replaces the previous tray entry instead of stacking alongside it.
const ALERT_NOTIFICATION_ID = 'aksha-alert-notification';

// Tracks the last alert actually shown, so a redelivered/retried push for
// the exact same alert (spotty connectivity, FCM re-delivery, the OS
// flushing a backlog on reconnect) doesn't reschedule the same tray
// notification over and over — saveAlertToStorage() already skips
// re-saving a duplicate, but nothing was stopping the popup itself from
// firing again for that same duplicate.
let lastShownAlertKey = null;

// ── SAVE ALERT TO SQLITE ──────────────────────────────────────────────────────
export const saveAlertToStorage = async (data) => {
  try {
    if (!data?.groupId) {
      console.log('saveAlertToStorage: no groupId, skipping');
      return;
    }

    console.log('IMAGE URL RECEIVED:', data.imageUrl);

    // saveIncomingAlert dedupes + inserts inside one SQLite transaction,
    // which serializes against any concurrent syncGroupAlerts write on the
    // same connection — no separate lock needed here (unlike the old
    // AsyncStorage version, where a concurrent server sync could overwrite
    // this exact same storage key and silently drop an alert).
    const savedAlert = await saveIncomingAlert(data);
    if (!savedAlert) return;

    // DeviceEventEmitter only works when app is in foreground (same JS context).
    // Background tasks run in a separate context so this emit only fires when
    // the notification arrives while the app is open. The AppState listener in
    // NotificationMessagesRN handles the background→foreground refresh.
    console.log(`[backgroundTask] Emitting 'aksha_new_alert' -> NotificationMessagesRN (groupId=${savedAlert.groupId})`);
    DeviceEventEmitter.emit('aksha_new_alert', {
      groupId:    savedAlert.groupId,
      cameraName: savedAlert.cameraName,
      imageUrl:   savedAlert.imageUrl,
      alertName:  savedAlert.alertName,
      receivedAt: savedAlert.receivedAt,
    });

    console.log(`[backgroundTask] Alert saved to SQLite:`, savedAlert.id);
  } catch (err) {
    console.warn('Failed to save alert:', err);
  }
};

// ── SHOW TRAY NOTIFICATION ────────────────────────────────────────────────────
// Pushes are data-only, so nothing is auto-displayed by the OS in ANY app
// state. The background task below calls this for background/killed pushes;
// app/_layout.jsx's foreground listener calls it too, since a data-only push
// shows nothing automatically while the app is open either.
//
// Always reuses the SAME tray identifier (ALERT_NOTIFICATION_ID) — exactly
// one Aksha alert notification exists in the tray at any time, and a new
// alert replaces it in place rather than stacking alongside older ones.
//
// Both the BACKGROUND_NOTIFICATION_TASK and app/_layout.jsx's foreground
// listener can fire for the SAME push (observed directly in logcat — the
// background task and the foreground listener both fired within 5ms of each
// other for one alert), each calling this function. Locked globally (one
// fixed key, since lastShownAlertKey is a single shared variable, not
// per-group) so the "is this a redelivered duplicate" check-then-set below
// is atomic — without the lock, both calls' `getNotificationsEnabled()`
// awaits could resolve in either order, letting both pass the duplicate
// check before either sets lastShownAlertKey, producing two scheduling calls
// for a single alert (harmless now that both always target the same
// identifier, but wasteful — one would just immediately overwrite the
// other's popup/sound).
const TRAY_LOCK_KEY = 'aksha-tray-notification';

export const showAlertNotification = async (notifData) =>
  withKeyLock(TRAY_LOCK_KEY, async () => {
    try {
      // User muted alerts in-app (ProfileDropdown toggle) — the alert itself
      // still gets saved to storage by the caller, this only skips the tray
      // popup/sound, since OS-level permission can't be revoked from JS.
      const enabled = await getNotificationsEnabled();
      console.log(`[backgroundTask] showAlertNotification: in-app flag enabled=${enabled}`);
      if (!enabled) {
        console.log('[backgroundTask] Notifications muted in-app, skipping popup');
        return;
      }

      // A push for an alert that happened BEFORE notifications were last
      // (re-)enabled — e.g. delivered late/as a backlog while muted — still
      // gets saved to the in-app list by the caller, but shouldn't pop a
      // tray notification for an incident the user already missed on
      // purpose. enabledSince is null until the user has explicitly toggled
      // notifications on at least once, in which case nothing is suppressed.
      const enabledSince = await getNotificationsEnabledSince();
      if (enabledSince && notifData?.incidentTime) {
        const incidentMs = new Date(notifData.incidentTime).getTime();
        if (!isNaN(incidentMs) && incidentMs < new Date(enabledSince).getTime()) {
          console.log(`[backgroundTask] showAlertNotification: skipping pre-enable backlog alert (incidentTime=${notifData.incidentTime} < enabledSince=${enabledSince})`);
          return;
        }
      }

      const alertKey = `${notifData?.groupId}_${notifData?.cameraName}_${notifData?.incidentTime}`;
      if (alertKey === lastShownAlertKey) {
        console.log(`[backgroundTask] showAlertNotification: skipping redelivered duplicate (${alertKey})`);
        return;
      }
      lastShownAlertKey = alertKey;

      // Timestamp the tray text itself, so the single notification always
      // shows which incident it's reporting.
      const timeLabel = notifData.incidentTime && dayjs(notifData.incidentTime).isValid()
        ? dayjs(notifData.incidentTime).format('HH:mm:ss')
        : dayjs().format('HH:mm:ss');

      console.log(`[backgroundTask] scheduling popup for groupId=${notifData?.groupId} cameraName=${notifData?.cameraName} time=${timeLabel}`);
      const notificationId = await Notifications.scheduleNotificationAsync({
        identifier: ALERT_NOTIFICATION_ID,
        content: {
          title: notifData.title ?? `Aksha Alert - ${notifData.cameraName ?? ''}`,
          body:  `${notifData.body ?? notifData.alertName ?? 'Alert detected'} · ${timeLabel}`,
          data:  notifData,
          sound: 'default',
        },
        // Android: deliver on the "alerts" channel (high importance/sound).
        // iOS has no channels, so a plain immediate trigger is used instead.
        trigger: Platform.OS === 'android' ? { channelId: 'alerts' } : null,
      });
      console.log(`[backgroundTask] Notification popup shown, id=${notificationId}`);
    } catch (notifyErr) {
      console.warn('[backgroundTask] Failed to schedule notification:', notifyErr);
    }
  });

// ── TASK DEFINITIONS ──────────────────────────────────────────────────────────
// Both tasks MUST be defined at module level (before any component mounts).
// This is a hard requirement of expo-task-manager.

TaskManager.defineTask(FOREGROUND_SERVICE_TASK, async () => {
  try {
    return TaskManager.TaskManagerTaskExecutionResult.Success;
  } catch (e) {
    return TaskManager.TaskManagerTaskExecutionResult.Failed;
  }
});

// FIX: The server now sends a DATA-ONLY Expo push (title/body moved inside
// "data", no top-level "title"/"body"). This guarantees Android always wakes
// this background task — even when the app is fully killed — instead of the
// OS silently auto-displaying a "notification" payload and skipping the
// background task entirely. Because nothing is auto-displayed anymore, this
// task must explicitly schedule the visible notification itself, AFTER the
// alert data has been safely written to SQLite. That ordering is what
// guarantees the data is always present by the time the user reopens the app,
// regardless of whether the app was foregrounded, backgrounded, or killed
// when the push arrived.
// When the app is backgrounded (process alive), `data.notification` is a full
// Notification object. When the app is fully KILLED, Android delivers a
// "headless" payload instead: `data.notification` is null and the real data
// payload is JSON-encoded under `data.data.dataString` (FCM data messages are
// flat string maps, so expo-server-sdk stringifies the structured "data"
// object to fit). Only reading the first shape means killed-app pushes were
// silently dropped — this reads whichever shape is actually present.
const extractNotifData = (data) => {
  const liveData = data?.notification?.request?.content?.data;
  if (liveData) return liveData;

  const dataString = data?.data?.dataString;
  if (dataString) {
    try {
      return JSON.parse(dataString);
    } catch (err) {
      console.warn('Failed to parse headless notification dataString:', err);
    }
  }

  return data?.data;
};

TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
  console.log('[backgroundTask] Push received, app state: background/killed');
  if (error) {
    console.error('Background notification error:', error);
    return;
  }
  if (data) {
    const notifData = extractNotifData(data);
    console.log('BACKGROUND NOTIFICATION DATA:', JSON.stringify(notifData));
    if (notifData?.groupId) {
      console.log(`[backgroundTask] Forwarding alert to storage for groupId=${notifData.groupId} (NotificationMessagesRN reads from SQLite on next refresh)`);
      await saveAlertToStorage(notifData);
      await showAlertNotification(notifData);
    } else {
      console.log('No groupId in background notification payload:', JSON.stringify(data));
    }
  }
});

// ── NOTIFICATION HANDLER ──────────────────────────────────────────────────────
// Must also be set at module level. Governs whether ANY notification event
// gets visually presented while the app is foregrounded — including one that
// reaches here through a path other than our own showAlertNotification() call
// (e.g. a push that already carries a native "notification" payload) — so it
// has to check the mute flag itself instead of assuming showAlertNotification
// already gated it.
Notifications.setNotificationHandler({
  handleNotification: async () => {
    const enabled = await getNotificationsEnabled();
    console.log(`[backgroundTask] handleNotification: in-app flag enabled=${enabled} -> shouldShowAlert=${enabled}`);
    return {
      shouldShowAlert: enabled,
      shouldPlaySound: enabled,
      shouldSetBadge:  enabled,
    };
  },
});
