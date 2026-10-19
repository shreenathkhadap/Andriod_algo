import AsyncStorage from '@react-native-async-storage/async-storage';

const NOTIFICATIONS_ENABLED_KEY = 'aksha_notifications_enabled';
const ENABLED_SINCE_KEY = 'aksha_notifications_enabled_since';

// In-app "mute" preference, separate from the OS-level permission — the OS
// only lets an app ASK for permission, it can't be programmatically revoked
// from JS once granted, so this is what lets a user turn alerts back off
// again without leaving the app. Defaults to enabled (mirrors the OS
// default of "permission granted = notifications on") until the user
// explicitly flips it off.
export const getNotificationsEnabled = async () => {
  try {
    const raw = await AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
    return raw === null ? true : raw === 'true';
  } catch (err) {
    console.warn('getNotificationsEnabled failed:', err);
    return true;
  }
};

export const setNotificationsEnabled = async (enabled) => {
  try {
    await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch (err) {
    console.warn('setNotificationsEnabled failed:', err);
  }
};

// Stamps "now" as the point notifications were (re-)enabled from. Called
// only on an explicit enable action (ProfileDropdown's syncNotificationPreference),
// not on passive server reconciliation — showAlertNotification uses this to
// suppress the tray popup for any alert whose incidentTime predates it (e.g.
// a backlog push for an alert that happened while muted, delivered late),
// without affecting whether the alert itself gets saved to the in-app list.
export const markNotificationsEnabledNow = async () => {
  try {
    await AsyncStorage.setItem(ENABLED_SINCE_KEY, new Date().toISOString());
  } catch (err) {
    console.warn('markNotificationsEnabledNow failed:', err);
  }
};

// Returns null if notifications have never been explicitly (re-)enabled
// this way — callers should treat null as "no threshold, show everything"
// rather than suppressing everything.
export const getNotificationsEnabledSince = async () => {
  try {
    return await AsyncStorage.getItem(ENABLED_SINCE_KEY);
  } catch (err) {
    console.warn('getNotificationsEnabledSince failed:', err);
    return null;
  }
};
