import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { router } from 'expo-router';
import { logDbStats } from '../../utils/db';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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

const QUICK_ACTIONS = [
  {
    icon: 'person-search',
    iconBg: '#fef2f2',
    iconColor: '#dc2626',
    borderColor: '#dc2626',
    title: 'Investigate',
    desc: 'View recent camera alerts from the last 4 hours',
    route: '/(admin)/tabs/investigate',
    params: null,
    full: false,
  },
  {
    icon: 'notifications',
    iconBg: '#f0fdf4',
    iconColor: '#16a34a',
    borderColor: '#16a34a',
    title: 'Notifications',
    desc: 'Browse and filter push alerts by group and camera',
    route: '/(admin)/tabs/insights',
    params: { tab: 'notifications' },
    full: false,
  },
  {
    icon: 'assessment',
    iconBg: '#fefce8',
    iconColor: '#ca8a04',
    borderColor: '#ca8a04',
    title: 'Alert report',
    desc: 'Charts and stats filtered by date, time and camera',
    route: '/(admin)/tabs/insights',
    params: { tab: 'alert-report' },
    full: true,
  },
];

export default function HomeScreen() {
  const { user, signOut } = useAuth();

  const [modalUrl, setModalUrl]             = useState(null);
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


 useEffect(() => {
  logDbStats('home screen mount');
}, []);

  const { downloadImage, shareImage, downloadingUrl, sharingUrl } = useImageActions();

  // Shared across every alert screen (Home, Monitor, Investigate,
  // Notifications, Alert Report) — one sync updates this ONE store, and
  // every screen using it re-renders from the same result together,
  // instead of each screen keeping its own separate cache that could drift
  // out of sync with the others by up to a poll interval.
  const { alerts: sharedAlerts, groups, initialSyncing, refreshing, error, refresh, lastUpdated } =
    useSharedAlerts({ mobileId: user?.mobileId, token: user?.token });

  // The hook's own `refreshing` flips true for every background trigger
  // (AppState resume, new-alert event) too, not just a manual pull — binding
  // RefreshControl to that would pop the spinner back up during silent
  // background syncs even though data is already on screen. This tracks
  // ONLY the user's own pull gesture; background refreshes stay invisible.
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const onPullToRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try { await refresh(); } finally { setPullRefreshing(false); }
  }, [refresh]);

  const totalGroups = groups.length;

  // Same last-24h + current-groups-only scoping as Notifications/Alert
  // Report, recomputed live from Date.now() on every render (not baked into
  // what gets cached) — otherwise this screen counts all-time, all-groups
  // data, including stale "aksha_alerts_*" keys left over from groups the
  // account no longer belongs to, which is why it used to show a much
  // higher camera/alert count than every other screen.
  const visibleAlerts = useMemo(() => {
    const validGroupIds = new Set(groups.map((g) => g.id));
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return sharedAlerts.filter((a) => {
      const t = new Date(a.receivedAt ?? a.incidentTime).getTime();
      if (!(t > oneDayAgo)) return false;
      return validGroupIds.size === 0 || validGroupIds.has(a.groupId);
    });
  }, [sharedAlerts, groups]);

  const totalCameras = useMemo(() => {
    const cameraSet = new Set();
    visibleAlerts.forEach((a) => {
      const cam = a.cameraName ?? a.Camera_Name;
      if (cam) cameraSet.add(cam.trim());
    });
    return cameraSet.size;
  }, [visibleAlerts]);

  const totalAlerts = useMemo(() => visibleAlerts.length, [visibleAlerts]);

  const recentActivity = useMemo(() => (
    visibleAlerts
      .filter((a) => a.alertName)
      .sort((a, b) =>
        new Date(b.receivedAt ?? b.incidentTime) -
        new Date(a.receivedAt ?? a.incidentTime)
      )
      .slice(0, 3)
  ), [visibleAlerts]);

  // AppState resume, the 15s poll, and the push-triggered 'aksha_new_alert'
  // event are all now handled once at the shared store's module level
  // (useSharedAlerts.js) rather than per-screen — they'd still be harmless
  // to repeat here (refreshSharedAlerts dedupes concurrent calls), just
  // redundant. Only useFocusEffect stays screen-local: focus is inherently
  // per-screen, so without this, coming back to Home after time on another
  // tab would keep showing whatever the shared store last held until the
  // next global trigger happened to fire. Silent — a plain tab switch
  // shouldn't pop "Syncing…", only a real pull-to-refresh should.
  useFocusEffect(
    useCallback(() => {
      refresh({ silent: true });
    }, [refresh])
  );

  const gridActions = QUICK_ACTIONS.filter((a) => !a.full);
  const fullAction  = QUICK_ACTIONS.find((a) => a.full);

  const handleAction = (action) => {
    if (action.params) {
      router.push({ pathname: action.route, params: action.params });
    } else {
      router.push(action.route);
    }
  };

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
            <Text style={styles.logoSub}>AI Surveillance Dashboard</Text>
          </View>
        </View>
        <View style={styles.navRight}>
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

      {/* Never hidden behind a full-screen spinner, even on first load or a
          long-gap reopen — counts just read 0/empty until the sync
          resolves, and the pinned bottom bar's "Syncing…" state (driven by
          `refreshing`) is what tells the user data is on its way. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={pullRefreshing} onRefresh={onPullToRefresh} colors={['#035faa']} tintColor="#035faa" />
        }
      >
        {/* ── WELCOME ── */}
        <View style={styles.welcomeWrap}>
          <Text style={styles.welcomeGreeting}>Hello,</Text>
          <Text style={styles.welcomeName}>
            {user?.username ?? user?.email ?? 'Admin'}
          </Text>
        </View>

        {/* ── STATS TICKER ── */}
        <View style={styles.statsTicker}>
          <View style={styles.tickerItem}>
            <MaterialIcons name="videocam" size={15} color="#035faa" />
            <Text style={styles.tickerText}>
              <Text style={styles.tickerNum}>{totalCameras}</Text> cameras
            </Text>
          </View>
          <View style={styles.tickerDot} />
          <View style={styles.tickerItem}>
            <MaterialIcons name="warning" size={15} color="#dc2626" />
            <Text style={styles.tickerText}>
              <Text style={styles.tickerNum}>{totalAlerts}</Text> alerts today
            </Text>
          </View>
          <View style={styles.tickerDot} />
          <View style={styles.tickerItem}>
            <MaterialIcons name="group" size={15} color="#16a34a" />
            <Text style={styles.tickerText}>
              <Text style={styles.tickerNum}>{totalGroups}</Text> groups
            </Text>
          </View>
        </View>

        {/* ── QUICK ACTIONS ── */}
        <Text style={styles.sectionTitle}>QUICK ACTIONS</Text>
        <View style={styles.qaContainer}>
          <View style={styles.qaGrid}>
            {gridActions.map((action) => (
              <TouchableOpacity
                key={action.title}
                style={[styles.qaCard, { borderTopColor: action.borderColor }]}
                onPress={() => handleAction(action)}
                activeOpacity={0.75}
              >
                <View style={[styles.qaIcon, { backgroundColor: action.iconBg }]}>
                  <MaterialIcons name={action.icon} size={22} color={action.iconColor} />
                </View>
                <Text style={styles.qaTitle}>{action.title}</Text>
                <Text style={styles.qaDesc}>{action.desc}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {fullAction && (
            <TouchableOpacity
              style={[styles.qaCardFull, { borderTopColor: fullAction.borderColor }]}
              onPress={() => handleAction(fullAction)}
              activeOpacity={0.75}
            >
              <View style={[styles.qaIconFull, { backgroundColor: fullAction.iconBg }]}>
                <MaterialIcons name={fullAction.icon} size={22} color={fullAction.iconColor} />
              </View>
              <View style={styles.qaFullText}>
                <Text style={styles.qaTitle}>{fullAction.title}</Text>
                <Text style={styles.qaDesc}>{fullAction.desc}</Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color="#cbd5e1" />
            </TouchableOpacity>
          )}
        </View>

        {/* ── RECENT ACTIVITY ── */}
        <Text style={styles.sectionTitle}>RECENT ACTIVITY</Text>

        {recentActivity.length === 0 ? (
          <View style={styles.emptyActivity}>
            <MaterialIcons name="notifications-off" size={40} color="#cbd5e1" />
            <Text style={styles.emptyText}>No recent activity</Text>
          </View>
        ) : (
          <View style={styles.timelineList}>
            {recentActivity.map((a, idx) => (
              <View key={a.id ?? `${a.cameraName}-${idx}`} style={styles.timelineItem}>
                <View style={styles.timelineDotCol}>
                  <View style={[
                    styles.timelineDot,
                    { backgroundColor: idx === 0 ? '#dc2626' : '#035faa' },
                  ]} />
                  {idx < recentActivity.length - 1 && (
                    <View style={styles.timelineLine} />
                  )}
                </View>

                <TouchableOpacity
                  style={styles.timelineCard}
                  onPress={() => { if (a.imageUrl) setModalUrl(a.imageUrl); }}
                  activeOpacity={a.imageUrl ? 0.7 : 1}
                >
                  <View style={styles.timelineCardText}>
                    <Text style={styles.timelineTitle}>{a.alertName}</Text>
                    <Text style={styles.timelineSub}>
                      {a.cameraName ?? a.Camera_Name} · {dayjs(a.receivedAt ?? a.incidentTime).fromNow()}
                    </Text>
                  </View>
                  {a.imageUrl ? (
                    <Image source={{ uri: a.imageUrl }} style={styles.timelineThumb} />
                  ) : (
                    <View style={styles.timelineThumbEmpty}>
                      <MaterialIcons name="image" size={20} color="#cbd5e1" />
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Pinned to the bottom of the screen, just above the tab bar (which
          the Tabs navigator renders below this screen, not inside it) —
          rather than scrolling away with the content. */}
      {/* `initialSyncing` stays true for this app session until the very
          first full sync (every group, every page) actually finishes —
          folding it in here keeps "Syncing…" showing for the whole app-open
          load instead of clearing after just the first chunk of data,
          without affecting later silent polls/tab switches (it never flips
          true again after that first completion). */}
      <LastUpdatedLabel timestamp={lastUpdated} refreshing={refreshing || initialSyncing} style={styles.lastUpdated} />

      {/* ── FULLSCREEN IMAGE MODAL ── */}
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

const NAV_HEIGHT = Platform.OS === 'android'
  ? (StatusBar.currentHeight ?? 0) + 62
  : 100;

const styles = StyleSheet.create({
  safe: {
    flex: 1, backgroundColor: '#f1f5f9',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: '#035faa', zIndex: 10,
  },
  navLogo:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoIcon:   { width: 58, height: 58, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoImage:  { width: 50, height: 50 },
  logoBrand:  { fontSize: 16, fontWeight: '600', color: '#fff', letterSpacing: -0.2 },
  logoSub:    { fontSize: 11, color: '#bfdbfe', marginTop: 2 },
  navRight:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar:     { width: 38, height: 38, borderRadius: 19, backgroundColor: '#fbbf24', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '600', color: '#78350f' },

  scroll:  { flex: 1 },
  content: { paddingBottom: 50 },

  welcomeWrap:     { backgroundColor: '#035faa', paddingHorizontal: 20, paddingTop: 6, paddingBottom: 24 },
  welcomeGreeting: { fontSize: 14, color: '#bfdbfe' },
  welcomeName:     { fontSize: 22, fontWeight: '700', color: '#fff', marginTop: 2 },

  statsTicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap',
    backgroundColor: '#eef2f7', borderBottomWidth: 0.5, borderBottomColor: '#dde3ea',
    paddingHorizontal: 5, paddingVertical: 16,
  },
  tickerItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tickerText: { fontSize: 13, color: '#334155' },
  tickerNum:  { fontWeight: '700', color: '#0f172a' },
  tickerDot:  { width: 3, height: 3, borderRadius: 2, backgroundColor: '#94a3b8', marginHorizontal: 12 },
  lastUpdated: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', justifyContent: 'center',
    backgroundColor: '#fff', borderTopWidth: 0.5, borderTopColor: '#e2e8f0',
    paddingVertical: 6,
  },

  sectionTitle: {
    fontSize: 11, fontWeight: '600', color: '#64748b',
    letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 30, paddingBottom: 14,
  },

  qaContainer:  { paddingHorizontal: 16, gap: 10 },
  qaGrid:       { flexDirection: 'row', gap: 10 },
  qaCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 0.5, borderColor: '#e2e8f0', borderTopWidth: 3,
    paddingHorizontal: 16, paddingVertical: 18,
  },
  qaCardFull: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 0.5, borderColor: '#e2e8f0', borderTopWidth: 3,
    paddingHorizontal: 16, paddingVertical: 16, marginBottom: 4,
  },
  qaIcon:     { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  qaIconFull: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  qaFullText: { flex: 1 },
  qaTitle:    { fontSize: 13, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  qaDesc:     { fontSize: 12, color: '#66778f', lineHeight: 17 },

  timelineList:   { paddingHorizontal: 16, paddingBottom: 6 },
  timelineItem:   { flexDirection: 'row', gap: 12 },
  timelineDotCol: { alignItems: 'center', width: 16, paddingTop: 12 },
  timelineDot:    { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: '#f1f5f9', flexShrink: 0 },
  timelineLine:   { width: 2, flex: 1, backgroundColor: '#e2e8f0', marginTop: 4, marginBottom: -4 },
  timelineCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 0.5, borderColor: '#e2e8f0',
    paddingHorizontal: 10, paddingVertical: 10, marginBottom: 10,
  },
  timelineCardText: { flex: 1 },
  timelineTitle:    { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  timelineSub:      { fontSize: 12, color: '#66778f', marginTop: 3 },
  timelineThumb:    { width: 46, height: 46, borderRadius: 10, flexShrink: 0 },
  timelineThumbEmpty: {
    width: 46, height: 46, borderRadius: 10,
    backgroundColor: '#f8fafc', borderWidth: 0.5, borderColor: '#e2e8f0',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  emptyActivity: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText:     { fontSize: 14, color: '#66778f' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  modalImage:   { width: width - 32, height: height - 160, borderRadius: 8 },
  modalClose:   { position: 'absolute', top: 50, right: 20, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
});