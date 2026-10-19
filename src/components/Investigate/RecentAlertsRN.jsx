// RecentAlertsRN.jsx
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
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import useImageActions from '../../hooks/useImageActions';
import useSharedAlerts from '../../hooks/useSharedAlerts';
import LastUpdatedLabel from '../LastUpdatedLabel';
import Toast from '../Toast';
import ZoomableImageModal from '../ZoomableImageModal';

dayjs.extend(relativeTime);

const { width, height } = Dimensions.get('window');

const groupByCamera = (alerts) => {
  const map = {};
  for (const alert of alerts) {
    const cam = alert.cameraName ?? alert.Camera_Name ?? 'Unknown';
    if (!alert.imageUrl) continue;
    if (!map[cam]) map[cam] = [];
    map[cam].push(alert);
  }
  return Object.entries(map)
    .map(([cameraName, items]) => ({
      cameraName,
      latest: items[0],
      items,
      total:  items.length,
    }))
    .sort((a, b) =>
      new Date(b.latest.receivedAt ?? b.latest.incidentTime) -
      new Date(a.latest.receivedAt ?? a.latest.incidentTime)
    );
};

export default function RecentAlertRN() {
  const { user } = useAuth();

  const [expanded, setExpanded] = useState({});
  const [modalUrl, setModalUrl] = useState(null);
  const [newCams, setNewCams]   = useState({});

  const { downloadImage, shareImage, downloadingUrl, sharingUrl } = useImageActions();

  const initialLoadDone = useRef(false);

  // Shared across every alert screen (Home, Monitor, Investigate,
  // Notifications, Alert Report) — one sync updates this ONE store, and
  // every screen using it re-renders from the same result together,
  // instead of each screen keeping its own separate cache that could drift
  // out of sync with the others by up to a poll interval.
  const { alerts: sharedAlerts, groups, loading, initialSyncing, refreshing, error, refresh, lastUpdated } =
    useSharedAlerts({ mobileId: user?.mobileId, token: user?.token });

  // The hook's own `refreshing` flips true for every background trigger
  // (AppState resume, new-alert event, the 15s interval) too, not just a
  // manual pull — binding RefreshControl to that would pop the spinner back
  // up during silent background syncs even though data is already on
  // screen. This tracks ONLY the user's own pull gesture; background
  // refreshes stay invisible.
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const onPullToRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try { await refresh(); } finally { setPullRefreshing(false); }
  }, [refresh]);

  // Same current-groups-only scoping as Home/Alert Report, recomputed live
  // from whatever /get-groups last returned. Needed because the shared
  // store's alerts are additive across syncs — a group deleted
  // server-side stops appearing here the moment the live list excludes
  // it, rather than its old alerts lingering forever.
  const validGroupIds = useMemo(
    () => new Set(groups.map((g) => g.id)),
    [groups]
  );

  const cameras = useMemo(() => {
    const fourHrsAgo = Date.now() - 4 * 60 * 60 * 1000;
    const fresh = sharedAlerts.filter((a) => {
      const t = new Date(a.receivedAt ?? a.incidentTime).getTime();
      if (!(isNaN(t) || t > fourHrsAgo)) return false;
      return validGroupIds.size === 0 || validGroupIds.has(a.groupId);
    });
    const sorted = fresh.sort(
      (a, b) =>
        new Date(b.receivedAt ?? b.incidentTime) -
        new Date(a.receivedAt ?? a.incidentTime)
    );
    return groupByCamera(sorted);
  }, [sharedAlerts, validGroupIds]);

  // Auto-expand the first (most recent) camera the very first time data
  // becomes available — not on every subsequent background refresh.
  useEffect(() => {
    if (!initialLoadDone.current && cameras.length > 0) {
      setExpanded({ [cameras[0].cameraName]: true });
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
  // unmount/remount them), so without this, coming back to Investigate
  // after time on another tab would keep showing whatever the shared store
  // last held until the next global trigger happened to fire. Focus is
  // inherently per-screen, so this one stays local. Silent — a plain tab
  // switch shouldn't pop "Syncing…", only a real pull-to-refresh should.
  useFocusEffect(
    useCallback(() => {
      refresh({ silent: true });
    }, [refresh])
  );

  const toggleExpand = (cam) =>
    setExpanded((prev) => ({ ...prev, [cam]: !prev[cam] }));

  // Full-screen spinner when there's truly no cached data yet (first time
  // this screen has ever loaded) OR when reopening after a long gap (e.g.
  // 2 days): the old per-group cache restores instantly and `loading` flips
  // false right away, but `cameras` above recomputes its 4h window against
  // Date.now() on every render and zeroes that stale cache out immediately —
  // without the `refreshing` check this showed "No alerts" for however long
  // the real catch-up sync took, even though one was actively in flight and
  // might still find alerts. Gating on "AND still empty" means an ordinary
  // background poll with data already on screen never gets hidden behind
  // this spinner, only the genuinely ambiguous "empty until proven
  // otherwise" case does.
  if (loading || (refreshing && cameras.length === 0)) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#035faa" />
      </View>
    );
  }

  return (
    <>
      <Toast
        text="Couldn't refresh — showing last saved data"
        visible={!!error}
        onClose={() => {}}
      />

      {cameras.length === 0 ? (
        <View style={styles.empty}>
          <MaterialIcons name="notifications-off" size={52} color="#cbd5e1" />
          <Text style={styles.emptyTitle}>No alerts in the last 4 hours</Text>
        </View>
      ) : (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={pullRefreshing} onRefresh={onPullToRefresh} colors={['#035faa']} tintColor="#035faa" />
        }
      >
        {cameras.map(({ cameraName, latest, items, total }) => {
          const isOpen = !!expanded[cameraName];
          const isNew  = !!newCams[cameraName];
          return (
            <View
              key={`${cameraName}-${latest.receivedAt ?? latest.incidentTime}`}
              style={[styles.card, isNew && styles.cardNew]}
            >
              <TouchableOpacity
                style={styles.cardHeader}
                onPress={() => toggleExpand(cameraName)}
                activeOpacity={0.7}
              >
                <View style={styles.camIconWrap}>
                  <MaterialIcons name="videocam" size={20} color="#035faa" />
                </View>
                <View style={styles.camMeta}>
                  <Text style={styles.camName}>{cameraName}</Text>
                  <Text style={styles.camTime}>
                    {total} alert{total !== 1 ? 's' : ''} · {dayjs(latest.receivedAt ?? latest.incidentTime).fromNow()}
                  </Text>
                </View>
                {isNew && (
                  <View style={styles.newBadge}>
                    <Text style={styles.newBadgeText}>New</Text>
                  </View>
                )}
                <MaterialIcons
                  name={isOpen ? 'expand-less' : 'expand-more'}
                  size={24}
                  color="#66778f"
                />
              </TouchableOpacity>

              {isOpen && (
                <View style={styles.imageList}>
                  {items.map((item, idx) => (
                    <TouchableOpacity
                      key={`${item.imageUrl}-${idx}`}
                      onPress={() => setModalUrl(item.imageUrl)}
                      activeOpacity={0.9}
                      style={styles.imageWrap}
                    >
                      <Image
                        source={{ uri: item.imageUrl }}
                        style={styles.alertImage}
                        resizeMode="cover"
                      />
                      <View style={styles.imgOverlay}>
                        <MaterialIcons name="warning" size={13} color="#fff" />
                        <Text style={styles.imgOverlayText}>{item.alertName}</Text>
                        <Text style={styles.imgOverlayTime}>
                          {dayjs(item.incidentTime).format('HH:mm:ss')}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
      )}

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
    </>
  );
}

const styles = StyleSheet.create({
  scroll:  { flex: 1 },
  content: { padding: 16, paddingTop: 20, paddingBottom: 50 },

  centered: { flex: 1, paddingVertical: 80, alignItems: 'center' },
  lastUpdated: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', justifyContent: 'center',
    backgroundColor: '#fff', borderTopWidth: 0.5, borderTopColor: '#e2e8f0',
    paddingVertical: 6,
  },
  empty:    { flex: 1, paddingVertical: 80, alignItems: 'center', gap: 14 },
  emptyTitle: { fontSize: 15, color: '#66778f', fontWeight: '500' },

  card:    { backgroundColor: '#fff', borderRadius: 14, borderWidth: 0.5, borderColor: '#e2e8f0', marginBottom: 14, overflow: 'hidden' },
  cardNew: { borderColor: '#035faa', borderWidth: 1.5 },

  cardHeader:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16, gap: 12 },
  camIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  camMeta:     { flex: 1, minWidth: 0 },
  camName:     { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  camTime:     { fontSize: 12, color: '#66778f', marginTop: 2 },

  newBadge:     { backgroundColor: '#fef2f2', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginRight: 4 },
  newBadgeText: { fontSize: 11, fontWeight: '600', color: '#b91c1c' },

  imageList:  { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  imageWrap:  { borderRadius: 12, overflow: 'hidden' },
  alertImage: { width: '100%', height: 210 },

  imgOverlay: {
    position: 'absolute', bottom: 12, left: 12,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(29,78,216,0.82)',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
  },
  imgOverlayText: { color: '#fff', fontSize: 12, fontWeight: '500' },
  imgOverlayTime: { color: '#bfdbfe', fontSize: 11, marginLeft: 4 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  modalImage:   { width: width - 32, height: height - 160 },
  modalClose:   { position: 'absolute', top: 50, right: 20, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
});