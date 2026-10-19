// src/screens/Admin/MonitorScreen.jsx
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  Dimensions,
  Image,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import LastUpdatedLabel from '../../components/LastUpdatedLabel';
import ProfileDropdown from '../../components/ProfileDropdown';
import Toast from '../../components/Toast';
import ZoomableImageModal from '../../components/ZoomableImageModal';
import { useAuth } from '../../context/AuthContext';
import useImageActions from '../../hooks/useImageActions';
import useSharedAlerts from '../../hooks/useSharedAlerts';
import AkshaLogo from '../../../assets/images/AkshaLogo.png';

dayjs.extend(relativeTime);

const { width, height } = Dimensions.get('window');

const NAV_HEIGHT = Platform.OS === 'android'
  ? (StatusBar.currentHeight ?? 0) + 58
  : 100;

const getLatestPerCamera = (alerts) => {
  const map = {};
  for (const alert of alerts) {
    const cam = alert.cameraName ?? alert.Camera_Name ?? 'Unknown';
    if (!alert.imageUrl) continue;
    if (
      !map[cam] ||
      new Date(alert.receivedAt ?? alert.incidentTime) >
        new Date(map[cam].receivedAt ?? map[cam].incidentTime)
    ) {
      map[cam] = alert;
    }
  }
  return Object.values(map).sort(
    (a, b) =>
      new Date(b.receivedAt ?? b.incidentTime) -
      new Date(a.receivedAt ?? a.incidentTime)
  );
};

export default function MonitorScreen() {
  const { user, signOut } = useAuth();
  const [expanded, setExpanded]       = useState({});
  const [modalUrl, setModalUrl]       = useState(null);
  const [newCams, setNewCams]         = useState({});
  const [profileVisible, setProfileVisible] = useState(false);

  // Tab screens stay mounted when you switch tabs (React Navigation doesn't
  // unmount them), so profileVisible would otherwise still be true the next
  // time you come back to this tab. Closing it on blur (this effect's
  // cleanup, which fires when the screen loses focus) matches how a
  // dropdown is expected to behave — never left open across a navigation.
  useFocusEffect(
    useCallback(() => {
      return () => setProfileVisible(false);
    }, [])
  );

  const { downloadImage, shareImage, downloadingUrl, sharingUrl } = useImageActions();

  const initialLoadDone = useRef(false);

  // Shared across every alert screen (Home, Monitor, Investigate,
  // Notifications, Alert Report) — one sync updates this ONE store, and
  // every screen using it re-renders from the same result together,
  // instead of each screen keeping its own separate cache that could drift
  // out of sync with the others by up to a poll interval.
  const { alerts: sharedAlerts, loading, initialSyncing, refreshing, error, refresh, lastUpdated } =
    useSharedAlerts({ mobileId: user?.mobileId, token: user?.token });

  // The hook's own `refreshing` flips true for every background trigger
  // (AppState resume, new-alert event, the 15s interval) too, not just a
  // manual pull — binding RefreshControl to that would pop the spinner back
  // up during silent background syncs even though data is already on
  // screen. This tracks ONLY user-initiated refreshes (pull gesture or the
  // header refresh button); background refreshes stay invisible.
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const onPullToRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try { await refresh(); } finally { setPullRefreshing(false); }
  }, [refresh]);

  const rawAlerts = sharedAlerts;

  const cameras = useMemo(() => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const fresh = rawAlerts.filter((a) => {
      const t = new Date(a.receivedAt ?? a.incidentTime).getTime();
      return isNaN(t) || t > oneDayAgo;
    });
    return getLatestPerCamera(fresh);
  }, [rawAlerts]);

  // Auto-expand the first (most recent) camera the very first time data
  // becomes available — not on every subsequent background refresh.
  useEffect(() => {
    if (!initialLoadDone.current && cameras.length > 0) {
      const firstCam = cameras[0].cameraName ?? cameras[0].Camera_Name;
      setExpanded({ [firstCam]: true });
      initialLoadDone.current = true;
    }
  }, [cameras]);

  // AppState resume, the 15s poll, and the push-triggered 'aksha_new_alert'
  // event no longer need to call refresh() here — the shared store
  // (useSharedAlerts.js) already reacts to all three once, globally, and
  // every screen reading it re-renders from the same result. This listener
  // stays only for its OWN purpose: surfacing a silent "New" badge on
  // whichever camera's card just got an alert, without forcing any
  // expand/collapse or navigation.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('aksha_new_alert', (payload) => {
      const camName = payload?.cameraName ?? payload?.Camera_Name ?? null;
      // insertAlerts() fires this event for any alert newly written to the
      // local cache, including older alerts pulled in by an ordinary sync —
      // not just ones that actually just happened. Only badge it "New" if
      // it truly did.
      const isRecent = payload?.receivedAt && Date.now() - new Date(payload.receivedAt).getTime() <= 30000;
      if (camName && isRecent) {
        setNewCams((prev) => ({ ...prev, [camName]: true }));
        setTimeout(() => {
          setNewCams((prev) => {
            const next = { ...prev };
            delete next[camName];
            return next;
          });
        }, 30000);
      }
    });
    return () => sub.remove();
  }, []);

  // Tab screens stay mounted when you switch tabs (React Navigation doesn't
  // unmount/remount them), so without this, coming back to Monitor after
  // time on another tab would keep showing whatever the shared store last
  // held until the next global trigger happened to fire. Focus is
  // inherently per-screen, so this one stays local. Silent — a plain tab
  // switch shouldn't pop "Syncing…", only a real pull-to-refresh should.
  useFocusEffect(
    useCallback(() => {
      refresh({ silent: true });
    }, [refresh])
  );

  const toggleExpand = (cam) =>
    setExpanded((prev) => ({ ...prev, [cam]: !prev[cam] }));

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#035faa" />

      {/* ── HEADER ── */}
      <View style={styles.nav}>
        <View style={styles.navLogo}>
          <View style={styles.logoIcon}>
            <Image source={AkshaLogo} style={styles.logoImage} resizeMode="contain" />
          </View>
          <View>
            <Text style={styles.logoBrand}>Aksha</Text>
            <Text style={styles.logoSub}>Spotlight</Text>
          </View>
        </View>
        <View style={styles.navRight}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={onPullToRefresh}
          >
            <MaterialIcons name="refresh" size={18} color="#fff" />
          </TouchableOpacity>

          <View style={styles.iconBtn}>
            <MaterialIcons name="notifications-none" size={18} color="#fff" />
            {cameras.length > 0 && <View style={styles.notifDot} />}
          </View>

          <TouchableOpacity
            style={styles.avatar}
            onPress={() => setProfileVisible((v) => !v)}
            activeOpacity={0.8}
          >
            <Text style={styles.avatarText}>
              {user?.username?.[0]?.toUpperCase() ??
                user?.email?.[0]?.toUpperCase() ?? 'A'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── PROFILE DROPDOWN ── */}
      <ProfileDropdown
        user={user}
        visible={profileVisible}
        onClose={() => setProfileVisible(false)}
        onSignOut={signOut}
        navHeight={NAV_HEIGHT}
      />

      <Toast
        text="Couldn't refresh — showing last saved data"
        visible={!!error}
        onClose={() => {}}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={pullRefreshing} onRefresh={onPullToRefresh} colors={['#035faa']} tintColor="#035faa" />
        }
      >
        {/* Also spinner-gates on "refreshing AND still empty" — reopening
            after a long gap restores the old cache instantly (loading flips
            false right away), but `cameras`' live 24h window zeroes that
            stale cache out immediately, which showed "No alerts" for
            however long the real catch-up sync took even though one was
            actively in flight. An ordinary background poll with data
            already on screen never falls into this branch. */}
        {(loading || (refreshing && cameras.length === 0)) ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#035faa" />
          </View>
        ) : cameras.length === 0 ? (
          <View style={styles.empty}>
            <MaterialIcons name="videocam-off" size={48} color="#cbd5e1" />
            <Text style={styles.emptyTitle}>No alerts in the last 24 hours</Text>
            {/* <TouchableOpacity style={styles.retryBtn} onPress={() => fetchLatest()}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity> */}
          </View>
        ) : (
          cameras.map((cam) => {
            const camName = cam.cameraName ?? cam.Camera_Name ?? 'Unknown';
            const isOpen  = !!expanded[camName];
            const isNew   = !!newCams[camName];
            return (
              <View
                key={`${camName}-${cam.receivedAt ?? cam.incidentTime}`}
                style={[styles.card, isNew && styles.cardNew]}
              >
                <TouchableOpacity
                  style={styles.cardHeader}
                  onPress={() => toggleExpand(camName)}
                  activeOpacity={0.7}
                >
                  <View style={styles.camIconWrap}>
                    <MaterialIcons name="videocam" size={18} color="#035faa" />
                  </View>
                  <View style={styles.camMeta}>
                    <Text style={styles.camName}>{camName}</Text>
                    <Text style={styles.camTime}>
                      {cam.alertName} ·{' '}
                      {dayjs(cam.receivedAt ?? cam.incidentTime).fromNow()}
                    </Text>
                  </View>
                  {isNew && (
                    <View style={styles.newBadge}>
                      <Text style={styles.newBadgeText}>New</Text>
                    </View>
                  )}
                  <MaterialIcons
                    name={isOpen ? 'expand-less' : 'expand-more'}
                    size={22}
                    color="#66778f"
                  />
                </TouchableOpacity>

                {isOpen && (
                  <TouchableOpacity
                    onPress={() => setModalUrl(cam.imageUrl)}
                    activeOpacity={0.9}
                  >
                    <Image
                      key={cam.imageUrl}
                      source={{ uri: cam.imageUrl }}
                      style={styles.camImage}
                      resizeMode="cover"
                    />
                    <View style={styles.imgOverlay}>
                      <MaterialIcons name="warning" size={12} color="#fff" />
                      <Text style={styles.imgOverlayText}>{cam.alertName}</Text>
                      <Text style={styles.imgOverlayTime}>
                        {dayjs(cam.incidentTime).format('HH:mm:ss')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Pinned to the bottom of the screen, just above the tab bar (which
          the Tabs navigator renders below this screen, not inside it) —
          rather than scrolling away with the content. `initialSyncing` stays
          true until the very first full sync (every group, every page)
          actually finishes, so folding it in here keeps "Syncing…" showing
          for the whole app-open load instead of clearing after just the
          first chunk of data. */}
      <LastUpdatedLabel timestamp={lastUpdated} refreshing={refreshing || initialSyncing} style={styles.lastUpdated} />

      <ZoomableImageModal
        visible={!!modalUrl}
        url={modalUrl}
        onClose={() => setModalUrl(null)}
        downloadImage={downloadImage}
        shareImage={shareImage}
        downloadingUrl={downloadingUrl}
        sharingUrl={sharingUrl}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1, backgroundColor: '#f1f5f9',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },

  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#035faa',
    zIndex: 10,
  },
  navLogo:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoIcon:   { width: 48, height: 48, borderRadius: 13, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoImage:  { width: 40, height: 40 },
  logoBrand:  { fontSize: 15, fontWeight: '600', color: '#fff', letterSpacing: -0.2 },
  logoSub:    { fontSize: 11, color: '#bfdbfe', marginTop: 1 },
  navRight:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn:    { width: 34, height: 34, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  notifDot:   { position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444', borderWidth: 1.5, borderColor: '#035faa' },
  avatar:     { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fbbf24', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '600', color: '#78350f' },

  scroll:  { flex: 1 },
  content: { padding: 12, paddingBottom: 40 },
  lastUpdated: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', justifyContent: 'center',
    backgroundColor: '#fff', borderTopWidth: 0.5, borderTopColor: '#e2e8f0',
    paddingVertical: 6,
  },

  centered:   { paddingVertical: 80, alignItems: 'center' },
  empty:      { paddingVertical: 80, alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: 15, color: '#66778f', fontWeight: '500' },
  retryBtn:   { paddingHorizontal: 24, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#035faa' },
  retryText:  { color: '#035faa', fontWeight: '600' },

  card:    { backgroundColor: '#fff', borderRadius: 14, borderWidth: 0.5, borderColor: '#e2e8f0', marginBottom: 12, overflow: 'hidden' },
  cardNew: { borderColor: '#035faa', borderWidth: 1.5 },

  cardHeader:  { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  camIconWrap: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  camMeta:     { flex: 1, minWidth: 0 },
  camName:     { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  camTime:     { fontSize: 11, color: '#66778f', marginTop: 1 },

  newBadge:     { backgroundColor: '#fef2f2', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, marginRight: 4 },
  newBadgeText: { fontSize: 11, fontWeight: '600', color: '#b91c1c' },

  camImage: { width: '100%', height: 220 },

  imgOverlay: {
    position: 'absolute', bottom: 10, left: 10,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(29,78,216,0.82)',
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6,
  },
  imgOverlayText: { color: '#fff', fontSize: 12, fontWeight: '500' },
  imgOverlayTime: { color: '#bfdbfe', fontSize: 11, marginLeft: 4 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  modalImage:   { width: width - 32, height: height - 160 },
  modalClose:   { position: 'absolute', top: 50, right: 20, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
});