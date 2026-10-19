import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Alert, DeviceEventEmitter, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { getMobileUsers, updateNotificationPreference } from '../api/apiService';
import useNotificationPermission from '../hooks/useNotificationPermission';
import { getNotificationsEnabled, markNotificationsEnabledNow, setNotificationsEnabled } from '../utils/notificationPrefs';

// Avatar-triggered dropdown showing the signed-in user's role/site/mobile ID,
// a notification on/off toggle, and a sign-out action. Shared by every
// Admin-role screen header (HomeScreen, MonitorScreen, InsightScreen,
// InvestigationScreen).
//
// The switch reflects TWO independent things at once, both required for a
// notification to actually show:
//   - OS-level permission (`permissionStatus`, from useNotificationPermission)
//     — JS can request it but can never revoke it; once denied, only the OS
//     Settings screen can change it.
//   - The in-app "muted" flag (notificationPrefs.js) — a real, instantly
//     reversible switch this app fully controls, which showAlertNotification()
//     and the notification handler both check before popping a tray alert.
export default function ProfileDropdown({ user, visible, onClose, onSignOut, navHeight }) {
  const { status: permissionStatus, requestOrOpenSettings } = useNotificationPermission();
  const [inAppEnabled, setInAppEnabled] = useState(true);
  const prevPermissionStatus = useRef(permissionStatus);

  useEffect(() => {
    getNotificationsEnabled().then((enabled) => {
      console.log(`[ProfileDropdown] loaded in-app mute flag -> inAppEnabled=${enabled}`);
      setInAppEnabled(enabled);
    });
  }, []);

  // Every admin tab has its OWN ProfileDropdown instance with its OWN
  // inAppEnabled state, but they all stay mounted at once (React Navigation
  // doesn't unmount inactive tabs). Toggling it on one tab writes straight
  // to the shared AsyncStorage key, but another tab's already-mounted
  // instance has no way to know that happened — without this listener, its
  // switch would keep showing the stale value it loaded at its own mount
  // time, and only correct itself (visibly animating mid-view) once you
  // opened its dropdown and the slower server reconciliation resolved.
  // Broadcasting the change the instant it happens (see
  // syncNotificationPreference below) means every other tab's switch is
  // already correct in the background, long before you ever open it there
  // — nothing left to animate once it's actually visible.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('aksha_notification_pref_changed', (enabled) => {
      console.log(`[ProfileDropdown] received broadcast pref change -> inAppEnabled=${enabled}`);
      setInAppEnabled(enabled);
    });
    return () => sub.remove();
  }, []);

  // Reconcile with the server's stored preference every time the dropdown is
  // opened (not just once on mount) — this component stays mounted for the
  // whole screen lifetime and just renders null while closed (see the early
  // return below), so `visible` flipping true is the actual "user is about
  // to look at this toggle" moment. That's also what catches a preference
  // changed from the web app: the server is re-checked fresh each time you
  // open this dropdown, rather than trusting a snapshot from whenever this
  // screen first mounted. A fresh install additionally defaults to `true`
  // locally regardless of what the account was actually registered with, and
  // the login response doesn't include notificationsEnabled at all — so the
  // server is the authoritative source of truth here, not the local cache.
  useEffect(() => {
    if (!visible || !user?.email) return;
    (async () => {
      try {
        const users = await getMobileUsers(user.siteId, user.token);
        const match = users?.find((u) => u.email === user.email);
        if (match && typeof match.notificationsEnabled === 'boolean') {
          console.log(`[ProfileDropdown] server notificationsEnabled=${match.notificationsEnabled} for ${user.email}`);
          setInAppEnabled(match.notificationsEnabled);
          await setNotificationsEnabled(match.notificationsEnabled);
          // Broadcast so every other already-mounted tab's dropdown adopts
          // this too, instead of only correcting itself the next time
          // someone happens to open it there.
          DeviceEventEmitter.emit('aksha_notification_pref_changed', match.notificationsEnabled);
        }
      } catch (err) {
        console.warn(
          '[ProfileDropdown] failed to fetch notification preference from server:',
          err?.response?.status, JSON.stringify(err?.response?.data), err?.message ?? err
        );
      }
    })();
  }, [visible, user?.email, user?.siteId, user?.token]);

  // If the user grants permission via the OS Settings screen (detected by
  // useNotificationPermission's AppState refresh on return to the app),
  // also flip the in-app flag on — they clearly just intended to enable
  // notifications, so a second manual tap here would be redundant friction.
  // Deliberately scoped to exactly the 'denied' -> 'granted' transition, NOT
  // the initial null -> 'granted' resolution every mount goes through —
  // otherwise this would silently re-enable a user's deliberately-muted
  // in-app preference every time they reopen the app.
  useEffect(() => {
    console.log(`[ProfileDropdown] permissionStatus changed: ${prevPermissionStatus.current} -> ${permissionStatus}`);
    if (prevPermissionStatus.current === 'denied' && permissionStatus === 'granted') {
      console.log('[ProfileDropdown] permission granted via Settings while denied before -> auto-enabling in-app flag');
      syncNotificationPreference(true);
    }
    prevPermissionStatus.current = permissionStatus;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionStatus]);

  const notificationsOn = permissionStatus === 'granted' && inAppEnabled;

  console.log(`[ProfileDropdown] render: permissionStatus=${permissionStatus} inAppEnabled=${inAppEnabled} -> switch=${notificationsOn}`);

  // Updates the in-app flag locally (AsyncStorage, checked by
  // showAlertNotification()/the notification handler) AND pushes the same
  // boolean to the backend's /mobile/update route, so the account's stored
  // preference (used wherever else it's read — e.g. deciding whether to send
  // a push at all) stays in sync with what this device's toggle shows.
  // Broadcasts the change too, so every other admin tab's own
  // ProfileDropdown instance (all of them stay mounted at once) picks it up
  // immediately instead of only correcting itself next time it's opened.
  const syncNotificationPreference = async (enabled) => {
    setInAppEnabled(enabled);
    await setNotificationsEnabled(enabled);
    // Only on an actual enable — this is what showAlertNotification uses to
    // suppress a tray popup for a late/backlogged alert whose incidentTime
    // predates this moment, so re-enabling doesn't surface old alerts.
    if (enabled) await markNotificationsEnabledNow();
    DeviceEventEmitter.emit('aksha_notification_pref_changed', enabled);
    try {
      console.log(`[ProfileDropdown] syncing notificationsEnabled=${enabled} to /mobile/update for ${user?.email}`);
      await updateNotificationPreference(user?.email, enabled, user?.token);
    } catch (err) {
      console.warn(
        '[ProfileDropdown] failed to sync notification preference to server:',
        err?.response?.status, JSON.stringify(err?.response?.data), err?.message ?? err
      );
    }
  };

  const handleToggleNotifications = async (value) => {
    console.log(`[ProfileDropdown] toggle pressed -> requested value=${value}, current permissionStatus=${permissionStatus}`);

    if (!value) {
      // Turning off never needs the OS — it's purely our own in-app flag.
      console.log('[ProfileDropdown] turning OFF -> setting in-app flag false');
      await syncNotificationPreference(false);
      return;
    }

    if (permissionStatus === 'granted') {
      console.log('[ProfileDropdown] turning ON, permission already granted -> setting in-app flag true');
      await syncNotificationPreference(true);
      return;
    }

    if (permissionStatus === 'undetermined') {
      console.log('[ProfileDropdown] turning ON, permission undetermined -> requesting native prompt');
      const requested = await requestOrOpenSettings(); // prompts the native dialog
      console.log(`[ProfileDropdown] native prompt result -> ${requested}`);
      if (requested === 'granted') {
        await syncNotificationPreference(true);
      }
      return; // if denied, leave the switch off — nothing more to do here
    }

    // permissionStatus === 'denied' — the native prompt won't reappear;
    // only the OS Settings screen can change it from here.
    console.log('[ProfileDropdown] turning ON, permission denied -> showing "open settings" alert');
    Alert.alert(
      'Notifications blocked',
      'Aksha notifications are turned off at the system level. Open Settings to allow them, then come back here.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => requestOrOpenSettings() },
      ]
    );
  };

  if (!visible) return null;

  return (
    <>
      <TouchableOpacity
        style={styles.dropdownOverlay}
        onPress={onClose}
        activeOpacity={1}
      />
      <View style={[styles.dropdown, { top: navHeight }]}>
        <View style={styles.dropdownArrow} />
        <View style={styles.dropdownHeader}>
          <View style={styles.dropdownAvatar}>
            <Text style={styles.dropdownAvatarText}>
              {user?.username?.[0]?.toUpperCase() ??
                user?.email?.[0]?.toUpperCase() ?? 'A'}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.dropdownName} numberOfLines={1}>
              {user?.username ?? 'Admin'}
            </Text>
            <Text style={styles.dropdownEmail} numberOfLines={1}>
              {user?.email ?? ''}
            </Text>
          </View>
        </View>
        <View style={styles.dropdownDivider} />
        <View style={styles.dropdownRow}>
          <MaterialIcons name="notifications" size={14} color="#035faa" />
          <Text style={styles.dropdownRowLabel}>Notifications</Text>
          <Switch
            value={notificationsOn}
            onValueChange={handleToggleNotifications}
            trackColor={{ false: '#e2e8f0', true: '#035faa' }}
            thumbColor="#fff"
          />
        </View>
        <View style={styles.dropdownDivider} />
        <TouchableOpacity
          style={styles.dropdownLogout}
          onPress={() => { onClose(); onSignOut(); }}
        >
          <MaterialIcons name="logout" size={15} color="#dc2626" />
          <Text style={styles.dropdownLogoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  dropdownOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 },
  dropdown: {
    position: 'absolute', right: 14, width: 260,
    backgroundColor: '#fff', borderRadius: 16, padding: 16, zIndex: 30,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 }, elevation: 10,
  },
  dropdownArrow: {
    position: 'absolute', top: -7, right: 16, width: 14, height: 14,
    backgroundColor: '#fff', transform: [{ rotate: '45deg' }],
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, elevation: 2,
  },
  dropdownHeader:     { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  dropdownAvatar:     { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fbbf24', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  dropdownAvatarText: { fontSize: 17, fontWeight: '700', color: '#78350f' },
  dropdownName:       { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  dropdownEmail:      { fontSize: 12, color: '#66778f', marginTop: 2 },
  dropdownDivider:    { height: 0.5, backgroundColor: '#e2e8f0', marginVertical: 12 },
  dropdownRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  dropdownRowLabel:   { fontSize: 13, color: '#64748b', flex: 1 },
  dropdownRowValue:   { fontSize: 13, fontWeight: '600', color: '#0f172a', maxWidth: 130 },
  dropdownLogout:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  dropdownLogoutText: { fontSize: 13, fontWeight: '600', color: '#dc2626' },
});
