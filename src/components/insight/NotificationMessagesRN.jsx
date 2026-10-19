import { MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import axios from "axios";
import dayjs from "dayjs";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  DeviceEventEmitter,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import useImageActions from "../../hooks/useImageActions";
import useSharedAlerts from "../../hooks/useSharedAlerts";
import LastUpdatedLabel from "../LastUpdatedLabel";
import Toast from "../Toast";
import ZoomableImageModal from "../ZoomableImageModal";

const { width, height } = Dimensions.get("window");

const formatIncident = (isoOrDate) => {
  try { return dayjs(isoOrDate).format("YYYY-MM-DD HH:mm:ss"); }
  catch { return String(isoOrDate); }
};

export default function NotificationMessagesRN({
  groupsApiUrl = null,
  alertsApiUrl = null,
  token        = null,
  mobileId     = null,
  // Set when a notification tap navigated here (see app/_layout.jsx's
  // navigateToNotifications) — identifies one exact alert by the same
  // (groupId, cameraName, incidentTime) triple SQLite dedupes on, so it can
  // be auto-selected/highlighted/scrolled-to instead of just landing on
  // whatever group was already selected.
  focusAlert   = null,
}) {
  const [groups, setGroups]                         = useState([]);
  const [groupsReady, setGroupsReady]               = useState(false);
  const [selectedGroup, setSelectedGroup]           = useState(null);
  const [groupsLoading, setGroupsLoading]           = useState(false);
  const [showGroupPicker, setShowGroupPicker]       = useState(false);
  const [imageModalOpen, setImageModalOpen]         = useState(false);
  const [imageModalUrl, setImageModalUrl]           = useState(null);
  const [showFilter, setShowFilter]                 = useState(false);
  const [showAlertPicker, setShowAlertPicker]       = useState(false);
  const [showCameraPicker, setShowCameraPicker]     = useState(false);
  const [selectedAlertName, setSelectedAlertName]   = useState(null);
  const [selectedCameraName, setSelectedCameraName] = useState(null);
  const [startHour, setStartHour]                   = useState(null);
  const [endHour, setEndHour]                       = useState(null);
  // Keyed the same way as each rendered item's fallback key (cameraName +
  // receivedAt) so a "New" badge can be shown on the exact alert that just
  // arrived, auto-clearing after 5s — same pattern as Investigate's
  // per-camera newCams badge.
  const [newAlertKeys, setNewAlertKeys]              = useState({});

  const { downloadImage, shareImage, downloadingUrl, sharingUrl } = useImageActions();

  const selectedGroupRef   = useRef(null);
  const appState           = useRef(AppState.currentState);
  const toScrollRef        = useRef(null);
  const flatListRef        = useRef(null);
  const handledFocusKeyRef = useRef(null);
  const highlightTimeoutRef = useRef(null);

  // Same triple SQLite dedupes/identifies an alert by — used both to find
  // the tapped alert in the list and to key the highlight/scroll effects
  // below, so a rapid double-tap (same alert re-tapped) doesn't re-trigger
  // the group-select/filter-clear effect a second time.
  const focusAlertKey = focusAlert?.groupId
    ? `${focusAlert.groupId}_${focusAlert.cameraName}_${focusAlert.incidentTime}`
    : null;

  // Separate from `focusAlertKey` (which stays set for as long as the nav
  // params do) so the highlight itself can clear after 30s while the
  // scroll-to-it and group/filter correction below still only need to run
  // once, the moment the tap navigates here.
  const [highlightedKey, setHighlightedKey] = useState(null);

  useEffect(() => { selectedGroupRef.current = selectedGroup; }, [selectedGroup]);

  const fetchGroups = useCallback(async () => {
    if (!groupsApiUrl) {
      setGroups([]);
      setGroupsReady(true);
      return;
    }
    setGroupsLoading(true);
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      // No timeout would let a stalled request hang forever instead of
      // rejecting, leaving groupsLoading stuck true and this screen's own
      // spinner up indefinitely.
      const res     = await axios.post(groupsApiUrl, { mobileId }, { headers, timeout: 15000 });
      const data    = res.data?.groups ?? [];
      setGroups(data);
      if (data.length > 0) setSelectedGroup(data[0]);
    } catch (err) {
      console.warn("Failed to fetch groups:", err);
      setGroups([]);
    } finally {
      setGroupsLoading(false);
      setGroupsReady(true);
    }
  }, [groupsApiUrl, mobileId, token]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  // Overrides fetchGroups' own "default to the first group" the moment a
  // tapped alert's group becomes available, and clears any stale filter so
  // the alert can't be hidden behind a leftover camera/alert-type/time
  // filter from a previous visit. Guarded by handledFocusKeyRef so this only
  // fires once per distinct tapped alert — without it, this would also
  // re-fire (and re-clear filters the user just set) on every unrelated
  // `groups` re-fetch, since `focusAlertKey` itself doesn't change then.
  useEffect(() => {
    if (!focusAlertKey || groups.length === 0) return;
    if (handledFocusKeyRef.current === focusAlertKey) return;
    handledFocusKeyRef.current = focusAlertKey;

    const match = groups.find((g) => g.id === focusAlert.groupId);
    if (match) setSelectedGroup(match);
    setSelectedAlertName(null);
    setSelectedCameraName(null);
    setStartHour(null);
    setEndHour(null);

    // Highlight for exactly 3s, then fall back to looking like every other
    // alert — kept as a plain ref/timeout (not a useEffect cleanup tied to
    // `groups`) so an unrelated groups re-fetch mid-window can't cancel it
    // early.
    setHighlightedKey(focusAlertKey);
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = setTimeout(() => setHighlightedKey(null), 3000);
  }, [focusAlertKey, groups, focusAlert]);

  useEffect(() => () => {
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
  }, []);

  // Shared across every alert screen (Home, Monitor, Investigate,
  // Notifications, Alert Report) — one sync updates this ONE store, and
  // every screen using it re-renders from the same result together,
  // instead of each screen keeping its own separate cache that could drift
  // out of sync with the others by up to a poll interval. This screen used
  // to sync only the selected group (via syncGroupAlerts) instead of every
  // group — now it syncs the same shared "all groups" data as every other
  // screen and just filters to the selected group client-side, same
  // pattern Investigate/Alert Report already use.
  const { alerts: sharedAlerts, loading, initialSyncing, refreshing, error, refresh, lastUpdated } =
    useSharedAlerts({ mobileId, token });

  const rawAlerts = useMemo(
    () => (selectedGroup ? sharedAlerts.filter((a) => a.groupId === selectedGroup.id) : []),
    [sharedAlerts, selectedGroup]
  );

  // Live last-24h window, recomputed every render from Date.now() — not
  // baked into what gets cached, so an alert that ages past 24h actually
  // drops out instead of being preserved indefinitely by the additive merge.
  const alerts = useMemo(() => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return rawAlerts.filter(
      (a) => new Date(a.receivedAt ?? a.incidentTime).getTime() > oneDayAgo
    );
  }, [rawAlerts]);

  // The hook's own `refreshing` flips true for every background trigger
  // (AppState resume, new-alert event, notification receipt, the 30s
  // interval) too, not just a manual pull — binding RefreshControl to that
  // would pop the spinner back up during silent background syncs even
  // though data is already on screen. This tracks ONLY the user's own pull
  // gesture; background refreshes stay invisible.
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const onPullToRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try { await refresh(); } finally { setPullRefreshing(false); }
  }, [refresh]);

  // Groups still resolving → spinner (we don't know yet whether there's
  // even a group to show). Groups resolved and one is selected → defer to
  // the shared store's own loading (true only until the very first sync
  // ever completes). Groups resolved with none selected (zero groups on
  // the account) → no spinner, let the FlatList's empty state explain it
  // instead.
  // Reopening the app after a long gap (e.g. 2 days) restores the shared
  // store's last-known alerts instantly (loading flips to false right
  // away), but the live 24h window above recomputes against Date.now() on
  // every render and
  // zeroes that stale cache out immediately — showing "No alerts" for
  // however long the real catch-up sync takes, even though a refresh is
  // actively in flight and might still find alerts. Only trust an empty
  // result once nothing is currently syncing; `refreshing` alone isn't used
  // for this (it also flips true on the routine 15s poll) — gating on
  // "AND still empty" means an ordinary background poll with data already
  // on screen never gets hidden behind this spinner, only the genuinely
  // ambiguous "empty until proven otherwise" case does.
  const stillResolving = loading || (refreshing && alerts.length === 0);
  const showFullSpinner = !groupsReady || (!!selectedGroup && stillResolving);

  // AppState resume, the 15s poll, and the push-triggered 'aksha_new_alert'
  // event no longer need to call refresh() here — the shared store
  // (useSharedAlerts.js) already reacts to all three once, globally, and
  // every screen reading it re-renders from the same result. Resume still
  // needs its own effect for the one thing that's genuinely local to this
  // screen: retrying the groups list if it never loaded.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === "active" && !selectedGroupRef.current) {
        fetchGroups();
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, [fetchGroups]);

  // This listener stays only for its OWN purpose now: surfacing a silent
  // "New" badge on whichever alert just arrived, without forcing any
  // navigation or filter change.
  useEffect(() => {
    const deSub = DeviceEventEmitter.addListener("aksha_new_alert", ({ cameraName, receivedAt }) => {
      // insertAlerts() fires this event for any alert newly written to the
      // local cache, including older alerts pulled in by an ordinary sync
      // (e.g. after a 24h prune or a group's first sync) — not just ones
      // that actually just happened. Only badge it "New" if it truly did.
      const isRecent = receivedAt && Date.now() - new Date(receivedAt).getTime() <= 30000;
      if (cameraName && isRecent) {
        const key = `${cameraName}-${receivedAt}`;
        setNewAlertKeys((prev) => ({ ...prev, [key]: true }));
        setTimeout(() => {
          setNewAlertKeys((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        }, 30000);
      }
    });
    // Foreground notification delivery doesn't always route through
    // backgroundTask.js reliably (see its own comments on this) — this is
    // an extra safety net that triggers the shared store's refresh
    // directly off Expo's own "notification received" event.
    const notifSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      console.log("[NotificationMessagesRN] Received notification directly:", JSON.stringify(data));
      if (data?.groupId) {
        setTimeout(() => refresh(), 300);
      }
    });
    return () => { deSub.remove(); notifSub.remove(); };
  }, [refresh]);

  // Tab screens stay mounted when you switch tabs (React Navigation doesn't
  // unmount/remount them), so without this, coming back to Insights after
  // time on another tab would keep showing whatever the shared store last
  // held until the next global trigger happened to fire. Focus is
  // inherently per-screen, so this one stays local. Silent — a plain tab
  // switch shouldn't pop "Syncing…", only a real pull-to-refresh should.
  useFocusEffect(
    useCallback(() => {
      refresh({ silent: true });
    }, [refresh])
  );

  // ── Unique alert names ────────────────────────────────────────────────────
  // Scoped to the selected camera (if any) so picking a camera first narrows
  // the alert-type list down to only what actually occurred on it.
  const alertNames = useMemo(() => {
    const names = new Set();
    const scoped = selectedCameraName
      ? alerts.filter((a) => a.cameraName?.trim() === selectedCameraName)
      : alerts;
    scoped.forEach((a) => { if (a.alertName) names.add(a.alertName.trim().toLowerCase()); });
    return Array.from(names).sort();
  }, [alerts, selectedCameraName]);

  // Drop a previously-picked alert type if it no longer applies once the
  // camera selection narrows the list. Depends on selectedCameraName only,
  // NOT alertNames — alertNames also changes on every background refresh
  // (new alerts reference), which would otherwise clear the selection on a
  // plain data sync with no camera change at all.
  useEffect(() => {
    if (selectedAlertName && !alertNames.includes(selectedAlertName)) {
      setSelectedAlertName(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCameraName]);

  // ── Unique camera names ───────────────────────────────────────────────────
  const cameraNames = useMemo(() => {
    const names = new Set();
    alerts.forEach((a) => { if (a.cameraName) names.add(a.cameraName.trim()); });
    return Array.from(names).sort();
  }, [alerts]);

  // ── Hour slots ────────────────────────────────────────────────────────────
  // At 3PM (nowHour=15):
  // From: 4PM→5PM→6PM→...→12AM→1AM→...→2PM→3PM (24 slots, starts nowHour+1, wraps forward)
  // To:   5PM→6PM→...→12AM→1AM→...→2PM→3PM→4PM (24 slots, starts nowHour+2, wraps forward)
  // Disabled in To: slots at or before selected From position
  const fromSlots = useMemo(() => {
    const nowHour = dayjs().hour();
    return Array.from({ length: 24 }, (_, i) => {
      const h   = (nowHour + 1 + i) % 24;
      const lbl = dayjs().hour(h).minute(0).format("hh:mm A");
      return { h, lbl, index: i };
    });
  }, []);

  const toSlots = useMemo(() => {
    const nowHour = dayjs().hour();
    return Array.from({ length: 24 }, (_, i) => {
      const h   = (nowHour + 2 + i) % 24;
      const lbl = dayjs().hour(h).minute(0).format("hh:mm A");
      return { h, lbl, index: i };
    });
  }, []);

  // ── Filtered alerts ───────────────────────────────────────────────────────
  const filteredAlerts = useMemo(() => {
    let result = [...alerts];
    if (selectedAlertName) {
      result = result.filter(
        (a) => a.alertName?.trim().toLowerCase() === selectedAlertName
      );
    }
    if (selectedCameraName) {
      result = result.filter(
        (a) => a.cameraName?.trim() === selectedCameraName
      );
    }
    if (startHour !== null && endHour !== null) {
      result = result.filter((a) => {
        const t = dayjs(a.incidentTime ?? a.receivedAt);
        const h = t.hour() + t.minute() / 60;
        const s = startHour;
        const e = endHour;
        if (s <= e) return h >= s && h <= e;
        return h >= s || h <= e;
      });
    }
    return result;
  }, [alerts, selectedAlertName, selectedCameraName, startHour, endHour]);

  // Scrolls to the tapped alert the moment it shows up in the (now
  // group/filter-corrected) list. It's frequently already there by the
  // first render — saveAlertToStorage() is awaited in app/_layout.jsx before
  // navigating here, so the shared alerts store already has it — but this
  // effect re-runs off `filteredAlerts` too so it still catches up if the
  // very first render lands before that data arrives.
  //
  // Guarded by hasAutoScrolledForKeyRef so this only actually scrolls ONCE
  // per tapped alert. `filteredAlerts` gets a new array reference on every
  // background sync (15s poll, a new alert landing, etc.) — without this
  // guard, EVERY one of those re-renders re-ran scrollToIndex, yanking the
  // list back to the tapped alert out from under the user the moment they
  // tried to scroll away from it.
  const hasAutoScrolledForKeyRef = useRef(null);
  useEffect(() => {
    if (!focusAlertKey || hasAutoScrolledForKeyRef.current === focusAlertKey) return;
    const index = filteredAlerts.findIndex(
      (a) => `${a.groupId}_${a.cameraName}_${a.incidentTime}` === focusAlertKey
    );
    if (index === -1) return;
    hasAutoScrolledForKeyRef.current = focusAlertKey;
    const t = setTimeout(() => {
      try {
        flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.2 });
      } catch {
        // Item not laid out yet — onScrollToIndexFailed below retries.
      }
    }, 300);
    return () => clearTimeout(t);
  }, [focusAlertKey, filteredAlerts]);

  const activeFilterCount =
    (selectedAlertName ? 1 : 0) +
    (selectedCameraName ? 1 : 0) +
    (startHour !== null && endHour !== null ? 1 : 0);

  const isFiltered = activeFilterCount > 0;

  const clearFilters = () => {
    setSelectedAlertName(null);
    setSelectedCameraName(null);
    setStartHour(null);
    setEndHour(null);
  };

  const openImage = (url) => { setImageModalUrl(url); setImageModalOpen(true); };

  // ── ALERT CARD ────────────────────────────────────────────────────────────
  const renderItem = ({ item }) => {
    const isNew = !!newAlertKeys[`${item.cameraName}-${item.receivedAt}`];
    const isFocused = !!highlightedKey &&
      `${item.groupId}_${item.cameraName}_${item.incidentTime}` === highlightedKey;
    return (
    <View style={[styles.card, isFocused ? styles.cardFocused : (isNew && styles.cardNew)]}>
      <View style={styles.cardHeader}>
        <View style={styles.alertLeft}>
          <View style={[styles.alertDot, isFocused && styles.alertDotFocused]} />
          <Text style={styles.alertName}>
            {item.alertName?.replace(/\b\w/g, (c) => c.toUpperCase())}
          </Text>
          {isFocused ? (
            <View style={styles.focusedBadge}>
              <MaterialIcons name="place" size={11} color="#b45309" />
              <Text style={styles.focusedBadgeText}>Opened from notification</Text>
            </View>
          ) : isNew && (
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>New</Text>
            </View>
          )}
        </View>
        <Text style={styles.incidentTime}>{formatIncident(item.incidentTime)}</Text>
      </View>

      {item.imageUrl ? (
        <View style={styles.imgWrap}>
          <TouchableOpacity onPress={() => openImage(item.imageUrl)} activeOpacity={0.9}>
            <Image source={{ uri: item.imageUrl }} style={styles.alertImage} resizeMode="cover" />
          </TouchableOpacity>
          <View style={styles.imgTag}>
            <MaterialIcons name="warning" size={11} color="#fbbf24" />
            <Text style={styles.imgTagText}>{item.alertName}</Text>
          </View>
          <View style={styles.imgBottom}>
            <View style={styles.imgTime}>
              <Text style={styles.imgTimeText}>{dayjs(item.incidentTime).format("HH:mm:ss")}</Text>
            </View>
            <View style={styles.imgActions}>
              <TouchableOpacity style={styles.imgIconBtn} onPress={() => downloadImage(item.imageUrl)} activeOpacity={downloadingUrl === item.imageUrl ? 1 : 0.7}>
                {downloadingUrl === item.imageUrl ? <ActivityIndicator size="small" color="#fff" /> : <MaterialIcons name="file-download" size={16} color="#fff" />}
              </TouchableOpacity>
              <TouchableOpacity style={styles.imgIconBtn} onPress={() => shareImage(item.imageUrl)} activeOpacity={sharingUrl === item.imageUrl ? 1 : 0.7}>
                {sharingUrl === item.imageUrl ? <ActivityIndicator size="small" color="#fff" /> : <MaterialIcons name="share" size={16} color="#fff" />}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      <View style={styles.metaWrap}>
        <View style={styles.metaRow}>
          <MaterialIcons name="videocam" size={14} color="#94a3b8" />
          <Text style={styles.metaKey}>Camera</Text>
          <Text style={styles.metaVal}>{item.cameraName}</Text>
        </View>
        <View style={styles.metaRow}>
          <MaterialIcons name="description" size={14} color="#94a3b8" />
          <Text style={styles.metaKey}>Description</Text>
          <Text style={styles.metaVal}>{item.alertDescription}</Text>
        </View>
        <View style={[styles.metaRow, { borderBottomWidth: 0, marginBottom: 0 }]}>
          <MaterialIcons name="group" size={14} color="#94a3b8" />
          <Text style={styles.metaKey}>Group</Text>
          <View style={styles.groupChip}>
            <Text style={styles.groupChipText}>{item.groupName}</Text>
          </View>
        </View>
      </View>
    </View>
    );
  };

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>

      {/* SUB-HEADER */}
      <View style={styles.subHeader}>
        <MaterialIcons name="notifications" size={16} color="#0A57EB" />
        <Text style={styles.subHeaderLabel}>
          {filteredAlerts.length} alert{filteredAlerts.length !== 1 ? "s" : ""}
          {isFiltered ? ` (${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""})` : " · last 24 hrs"}
        </Text>
        <TouchableOpacity
          style={[styles.filterBtn, isFiltered && styles.filterBtnActive]}
          onPress={() => setShowFilter(true)}
        >
          <MaterialIcons name="tune" size={15} color={isFiltered ? "#fff" : "#0A57EB"} />
          <Text style={[styles.filterBtnText, isFiltered && { color: "#fff" }]}>
            Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.groupBtn} onPress={() => setShowGroupPicker(true)} disabled={groupsLoading}>
          {groupsLoading ? (
            <ActivityIndicator size="small" color="#0A57EB" />
          ) : (
            <View style={styles.groupBtnInner}>
              <MaterialIcons name="group" size={13} color="#0A57EB" />
              <Text style={styles.groupBtnText} numberOfLines={1} ellipsizeMode="tail">
                {selectedGroup?.name ?? "Select Group"}
              </Text>
              <MaterialIcons name="arrow-drop-down" size={16} color="#0A57EB" />
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Active filter chips */}
      {isFiltered && (
        <View style={styles.chipWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {selectedAlertName && (
              <View style={styles.chip}>
                <MaterialIcons name="warning" size={12} color="#0A57EB" />
                <Text style={styles.chipText}>
                  {selectedAlertName.replace(/\b\w/g, (c) => c.toUpperCase())}
                </Text>
                <TouchableOpacity onPress={() => setSelectedAlertName(null)}>
                  <MaterialIcons name="close" size={14} color="#0A57EB" />
                </TouchableOpacity>
              </View>
            )}
            {selectedCameraName && (
              <View style={styles.chip}>
                <MaterialIcons name="videocam" size={12} color="#0A57EB" />
                <Text style={styles.chipText}>{selectedCameraName}</Text>
                <TouchableOpacity onPress={() => setSelectedCameraName(null)}>
                  <MaterialIcons name="close" size={14} color="#0A57EB" />
                </TouchableOpacity>
              </View>
            )}
            {startHour !== null && endHour !== null && (
              <View style={styles.chip}>
                <MaterialIcons name="access-time" size={12} color="#0A57EB" />
                <Text style={styles.chipText}>
                  {dayjs().hour(startHour).minute(0).format("hh:mm A")} → {dayjs().hour(endHour).minute(0).format("hh:mm A")}
                </Text>
                <TouchableOpacity onPress={() => { setStartHour(null); setEndHour(null); }}>
                  <MaterialIcons name="close" size={14} color="#0A57EB" />
                </TouchableOpacity>
              </View>
            )}
            <TouchableOpacity style={styles.chipClear} onPress={clearFilters}>
              <Text style={styles.chipClearText}>Clear all</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      <Toast
        text="Couldn't refresh — showing last saved data"
        visible={!!error}
        onClose={() => {}}
      />

      {/* Full-screen spinner ONLY while groups are still resolving, or while
          the selected group's alerts have never been cached yet. Once
          something is cached, switching groups/filters never blocks on this
          again — background refreshes surface via pull-to-refresh instead. */}
      {showFullSpinner && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#0A57EB" />
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={filteredAlerts}
        renderItem={renderItem}
        keyExtractor={(item) => item.id ?? `${item.cameraName}-${item.receivedAt}`}
        contentContainerStyle={styles.listContent}
        onScrollToIndexFailed={(info) => {
          // The tapped alert's row hasn't been laid out yet (list still
          // rendering) — retry shortly instead of dropping the scroll.
          setTimeout(() => {
            flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.2 });
          }, 300);
        }}
        refreshControl={
          <RefreshControl refreshing={pullRefreshing} onRefresh={onPullToRefresh} colors={['#0A57EB']} tintColor="#0A57EB" />
        }
        ListEmptyComponent={
          !showFullSpinner ? (
            <View style={styles.empty}>
              <MaterialIcons name={isFiltered ? "search-off" : "notifications-off"} size={48} color="#cbd5e1" />
              <Text style={styles.emptyText}>
                {isFiltered
                  ? "No alerts match your filters"
                  : groups.length === 0
                  ? "No groups assigned to your account"
                  : "No alerts in the last 24 hours"}
              </Text>
              {isFiltered && (
                <TouchableOpacity style={styles.clearBtn} onPress={clearFilters}>
                  <Text style={styles.clearBtnText}>Clear filters</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null
        }
      />

      {/* ── FILTER SHEET ── */}
      <Modal visible={showFilter} transparent animationType="slide">
        <TouchableOpacity style={styles.pickerOverlay} onPress={() => setShowFilter(false)} activeOpacity={1}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <View style={styles.filterHeader}>
              <Text style={styles.pickerTitle}>Filter Alerts</Text>
              {isFiltered && (
                <TouchableOpacity onPress={clearFilters}>
                  <Text style={styles.clearAllText}>Clear all</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Camera name */}
            <Text style={styles.filterLabel}>Camera</Text>
            <TouchableOpacity style={styles.filterDropdown} onPress={() => setShowCameraPicker(true)}>
              <MaterialIcons name="videocam" size={15} color="#94a3b8" />
              <Text style={[styles.filterDropdownText, selectedCameraName && { color: "#0f172a" }]}>
                {selectedCameraName ?? "All cameras"}
              </Text>
              {selectedCameraName ? (
                <TouchableOpacity onPress={(e) => { e.stopPropagation(); setSelectedCameraName(null); }}>
                  <MaterialIcons name="close" size={16} color="#94a3b8" />
                </TouchableOpacity>
              ) : (
                <MaterialIcons name="arrow-drop-down" size={20} color="#94a3b8" />
              )}
            </TouchableOpacity>

            {/* Alert type — options narrow to whichever camera is picked above */}
            <Text style={[styles.filterLabel, { marginTop: 16 }]}>Alert type</Text>
            <TouchableOpacity style={styles.filterDropdown} onPress={() => setShowAlertPicker(true)}>
              <MaterialIcons name="warning" size={15} color="#94a3b8" />
              <Text style={[styles.filterDropdownText, selectedAlertName && { color: "#0f172a" }]}>
                {selectedAlertName
                  ? selectedAlertName.replace(/\b\w/g, (c) => c.toUpperCase())
                  : "All alert types"}
              </Text>
              {selectedAlertName ? (
                <TouchableOpacity onPress={(e) => { e.stopPropagation(); setSelectedAlertName(null); }}>
                  <MaterialIcons name="close" size={16} color="#94a3b8" />
                </TouchableOpacity>
              ) : (
                <MaterialIcons name="arrow-drop-down" size={20} color="#94a3b8" />
              )}
            </TouchableOpacity>

            {/* Time range */}
            <Text style={[styles.filterLabel, { marginTop: 16 }]}>Time range (last 24 hrs)</Text>
            <Text style={styles.timePickerLabel}>From</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hourScroll}>
              {fromSlots.map(({ h, lbl, index }) => {
                const sel = startHour === h;
                return (
                  <TouchableOpacity
                    key={index}
                    style={[styles.hourChip, sel && styles.hourChipActive]}
                    onPress={() => {
                      setStartHour(h);
                      setEndHour(null);
                      // Auto-scroll To list to first enabled slot (index = fromIndex)
                      setTimeout(() => {
                        const chipWidth = 90; // approx width of each hour chip + gap
                        toScrollRef.current?.scrollTo({ x: index * chipWidth, animated: true });
                      }, 100);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.hourChipText, sel && styles.hourChipTextActive]}>
                      {lbl}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={[styles.timePickerLabel, { marginTop: 12 }]}>To</Text>
            <ScrollView ref={toScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hourScroll}>
              {toSlots.map(({ h, lbl, index }) => {
                const sel = endHour === h;
                // From starts at nowHour+1, To starts at nowHour+2 — offset by 1hr.
                // From index 0 = 4PM, To index 0 = 5PM.
                // If From=4PM (fromIndex=0) → enable To from index 0 (5PM) onwards.
                // If From=5PM (fromIndex=1) → enable To from index 1 (6PM) onwards.
                // Rule: disable To index < fromIndex (strictly less than).
                const fromIndex = startHour !== null
                  ? fromSlots.findIndex((s) => s.h === startHour)
                  : -1;
                const disabled = startHour === null || index < fromIndex;
                return (
                  <TouchableOpacity
                    key={index}
                    style={[styles.hourChip, sel && styles.hourChipActive, disabled && styles.hourChipDisabled]}
                    onPress={() => { if (!disabled) setEndHour(h); }}
                    activeOpacity={disabled ? 1 : 0.7}
                  >
                    <Text style={[styles.hourChipText, sel && styles.hourChipTextActive, disabled && styles.hourChipTextDisabled]}>
                      {lbl}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {startHour !== null && endHour !== null && (
              <View style={styles.selectedRangeWrap}>
                <MaterialIcons name="access-time" size={14} color="#0A57EB" />
                <Text style={styles.selectedRangeText}>
                  {dayjs().hour(startHour).minute(0).format("hh:mm A")} → {dayjs().hour(endHour).minute(0).format("hh:mm A")}
                </Text>
                <TouchableOpacity onPress={() => { setStartHour(null); setEndHour(null); }}>
                  <MaterialIcons name="close" size={14} color="#94a3b8" />
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity style={styles.applyBtn} onPress={() => setShowFilter(false)}>
              <Text style={styles.applyBtnText}>
                Apply · {filteredAlerts.length} result{filteredAlerts.length !== 1 ? "s" : ""}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── ALERT NAME PICKER ── */}
      <Modal visible={showAlertPicker} transparent animationType="slide">
        <TouchableOpacity style={styles.pickerOverlay} onPress={() => setShowAlertPicker(false)} activeOpacity={1}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Select Alert Type</Text>
            <TouchableOpacity
              style={[styles.pickerItem, selectedAlertName === null && styles.pickerItemActive]}
              onPress={() => { setSelectedAlertName(null); setShowAlertPicker(false); }}
            >
              <MaterialIcons name="notifications" size={18} color={selectedAlertName === null ? "#0A57EB" : "#94a3b8"} />
              <Text style={[styles.pickerItemText, selectedAlertName === null && styles.pickerItemTextActive]}>All alert types</Text>
              {selectedAlertName === null && <MaterialIcons name="check" size={18} color="#0A57EB" />}
            </TouchableOpacity>
            {alertNames.map((name) => (
              <TouchableOpacity
                key={name}
                style={[styles.pickerItem, selectedAlertName === name && styles.pickerItemActive]}
                onPress={() => { setSelectedAlertName(name); setShowAlertPicker(false); }}
              >
                <MaterialIcons name="warning" size={18} color={selectedAlertName === name ? "#0A57EB" : "#94a3b8"} />
                <Text style={[styles.pickerItemText, selectedAlertName === name && styles.pickerItemTextActive]}>
                  {name.replace(/\b\w/g, (c) => c.toUpperCase())}
                </Text>
                {selectedAlertName === name && <MaterialIcons name="check" size={18} color="#0A57EB" />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── CAMERA NAME PICKER ── */}
      <Modal visible={showCameraPicker} transparent animationType="slide">
        <TouchableOpacity style={styles.pickerOverlay} onPress={() => setShowCameraPicker(false)} activeOpacity={1}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Select Camera</Text>
            <TouchableOpacity
              style={[styles.pickerItem, selectedCameraName === null && styles.pickerItemActive]}
              onPress={() => { setSelectedCameraName(null); setShowCameraPicker(false); }}
            >
              <MaterialIcons name="videocam" size={18} color={selectedCameraName === null ? "#0A57EB" : "#94a3b8"} />
              <Text style={[styles.pickerItemText, selectedCameraName === null && styles.pickerItemTextActive]}>All cameras</Text>
              {selectedCameraName === null && <MaterialIcons name="check" size={18} color="#0A57EB" />}
            </TouchableOpacity>
            {cameraNames.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No cameras in this group</Text>
              </View>
            ) : (
              cameraNames.map((name) => (
                <TouchableOpacity
                  key={name}
                  style={[styles.pickerItem, selectedCameraName === name && styles.pickerItemActive]}
                  onPress={() => { setSelectedCameraName(name); setShowCameraPicker(false); }}
                >
                  <MaterialIcons name="videocam" size={18} color={selectedCameraName === name ? "#0A57EB" : "#94a3b8"} />
                  <Text style={[styles.pickerItemText, selectedCameraName === name && styles.pickerItemTextActive]}>{name}</Text>
                  {selectedCameraName === name && <MaterialIcons name="check" size={18} color="#0A57EB" />}
                </TouchableOpacity>
              ))
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── GROUP PICKER ── */}
      <Modal visible={showGroupPicker} transparent animationType="slide">
        <TouchableOpacity style={styles.pickerOverlay} onPress={() => setShowGroupPicker(false)} activeOpacity={1}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Select Group</Text>
            {groups.length === 0 ? (
              <Text style={styles.emptyText}>No groups available</Text>
            ) : (
              groups.map((g) => (
                <TouchableOpacity
                  key={g.id}
                  style={[styles.pickerItem, selectedGroup?.id === g.id && styles.pickerItemActive]}
                  onPress={() => { setSelectedGroup(g); setSelectedAlertName(null); setSelectedCameraName(null); setShowGroupPicker(false); }}
                >
                  <MaterialIcons name="group" size={18} color={selectedGroup?.id === g.id ? "#0A57EB" : "#94a3b8"} />
                  <Text style={[styles.pickerItemText, selectedGroup?.id === g.id && styles.pickerItemTextActive]}>{g.name}</Text>
                  {selectedGroup?.id === g.id && <MaterialIcons name="check" size={18} color="#0A57EB" />}
                </TouchableOpacity>
              ))
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── FULLSCREEN IMAGE ── */}
      <ZoomableImageModal
        visible={imageModalOpen}
        url={imageModalUrl}
        onClose={() => setImageModalOpen(false)}
        downloadImage={downloadImage}
        shareImage={shareImage}
        downloadingUrl={downloadingUrl}
        sharingUrl={sharingUrl}
      />

      {/* Pinned to the bottom of the screen, just above the tab bar (which
          the Tabs navigator renders below this screen, not inside it) —
          rather than scrolling away with the content. `initialSyncing` stays
          true until the very first full sync (every group, every page)
          actually finishes, so folding it in here keeps "Syncing…" showing
          for the whole app-open load instead of clearing after just the
          first chunk of data. */}
      <LastUpdatedLabel timestamp={lastUpdated} refreshing={refreshing || initialSyncing} style={styles.lastUpdated} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f1f5f9" },

  subHeader: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#fff", paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0",
  },
  subHeaderLabel: { flex: 1, fontSize: 12, color: "#94a3b8", fontWeight: "500" },
  lastUpdated: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", justifyContent: "center",
    backgroundColor: "#fff", borderTopWidth: 0.5, borderTopColor: "#e2e8f0",
    paddingVertical: 6,
  },
  filterBtn:       { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#eff6ff", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  filterBtnActive: { backgroundColor: "#0A57EB" },
  filterBtnText:   { fontSize: 12, fontWeight: "600", color: "#0A57EB" },
  groupBtn:      { backgroundColor: "#eff6ff", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, maxWidth: 130, minWidth: 70 },
  groupBtnInner: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  groupBtnText:  { color: "#0A57EB", fontSize: 12, fontWeight: "600", flexShrink: 1, flexGrow: 0 },

  // ── Active filter chips ──
  chipWrap:     { backgroundColor: "#fff", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0" },
  chipRow:      { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, flexWrap: "nowrap" },
  chip:         { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#eff6ff", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 0.5, borderColor: "#bfdbfe", flexShrink: 0 },
  chipText:     { fontSize: 12, color: "#0A57EB", fontWeight: "500" },
  chipClear:    { paddingHorizontal: 10, paddingVertical: 5 },
  chipClearText: { fontSize: 12, color: "#dc2626", fontWeight: "600" },

  loadingWrap: { paddingVertical: 40, alignItems: "center" },
  listContent: { padding: 12, paddingBottom: 40 },

  card: {
    backgroundColor: "#fff", borderRadius: 14,
    marginBottom: 12, borderWidth: 0.5, borderColor: "#e2e8f0", overflow: "hidden",
    ...Platform.select({
      ios:     { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 2 },
    }),
  },
  cardNew:      { borderColor: "#035faa", borderWidth: 1.5 },
  newBadge:     { backgroundColor: "#fef2f2", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 4 },
  newBadgeText: { fontSize: 11, fontWeight: "600", color: "#b91c1c" },
  // Deliberately distinct from cardNew/newBadge (amber vs blue/red) — this
  // marks the ONE alert a notification tap deep-linked to, which needs to
  // read differently from "just arrived" so it's unmistakable even when
  // other alerts are ALSO showing a "New" badge at the same time.
  cardFocused:      { borderColor: "#f59e0b", borderWidth: 2, backgroundColor: "#fffbeb" },
  alertDotFocused:  { backgroundColor: "#f59e0b" },
  focusedBadge:     { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#fef3c7", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 4 },
  focusedBadgeText: { fontSize: 11, fontWeight: "600", color: "#b45309" },
  cardHeader:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12 },
  alertLeft:    { flexDirection: "row", alignItems: "center", gap: 7 },
  alertDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: "#0A57EB" },
  alertName:    { fontSize: 14, fontWeight: "700", color: "#0A57EB" },
  incidentTime: { fontSize: 11, color: "#94a3b8" },

  imgWrap:    { position: "relative" },
  alertImage: { width: "100%", height: 190 },
  imgTag:     { position: "absolute", top: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  imgTagText: { fontSize: 11, color: "#fff", fontWeight: "500" },
  imgBottom:  { position: "absolute", bottom: 10, left: 10, right: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  imgTime:     { backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  imgTimeText: { fontSize: 11, color: "#fff" },
  imgActions:  { flexDirection: "row", gap: 6 },
  imgIconBtn:  { width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.2)" },

  metaWrap: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, borderTopWidth: 0.5, borderTopColor: "#f1f5f9", gap: 8 },
  metaRow:  { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 8, borderBottomWidth: 0.5, borderBottomColor: "#f8fafc" },
  metaKey:       { fontSize: 13, fontWeight: "600", color: "#0f172a", width: 84 },
  metaVal:       { flex: 1, fontSize: 13, color: "#64748b" },
  groupChip:     { backgroundColor: "#eff6ff", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  groupChipText: { fontSize: 12, fontWeight: "600", color: "#0A57EB" },

  empty:        { marginTop: 60, alignItems: "center", gap: 12 },
  emptyText:    { color: "#94a3b8", fontSize: 14, fontWeight: "500", textAlign: "center" },
  clearBtn:     { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "#0A57EB" },
  clearBtnText: { color: "#0A57EB", fontWeight: "600", fontSize: 13 },

  filterHeader:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  clearAllText:    { fontSize: 13, color: "#dc2626", fontWeight: "600" },
  filterLabel:     { fontSize: 12, fontWeight: "600", color: "#64748b", letterSpacing: 0.3, marginBottom: 8 },
  timePickerLabel: { fontSize: 12, fontWeight: "600", color: "#64748b", marginBottom: 6 },

  filterDropdown:     { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f8fafc", borderRadius: 10, borderWidth: 0.5, borderColor: "#e2e8f0", paddingHorizontal: 12, paddingVertical: 12 },
  filterDropdownText: { flex: 1, fontSize: 14, color: "#94a3b8" },

  hourScroll:           { gap: 6, paddingVertical: 2 },
  hourChip:             { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 0.5, borderColor: "#e2e8f0", backgroundColor: "#f8fafc" },
  hourChipActive:       { backgroundColor: "#0A57EB", borderColor: "#0A57EB" },
  hourChipDisabled:     { backgroundColor: "#f1f5f9", borderColor: "#f1f5f9", opacity: 0.5 },
  hourChipText:         { fontSize: 12, color: "#64748b", fontWeight: "500" },
  hourChipTextActive:   { color: "#fff", fontWeight: "600" },
  hourChipTextDisabled: { color: "#cbd5e1" },

  selectedRangeWrap: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#eff6ff", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginTop: 12 },
  selectedRangeText: { flex: 1, fontSize: 13, color: "#0A57EB", fontWeight: "500" },

  applyBtn:     { marginTop: 20, backgroundColor: "#0A57EB", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  applyBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  pickerSheet:   { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  pickerHandle:  { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e2e8f0", alignSelf: "center", marginBottom: 16 },
  pickerTitle:   { fontSize: 16, fontWeight: "700", color: "#0f172a", marginBottom: 16 },
  pickerItem:         { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14, paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: "#f1f5f9", borderRadius: 8 },
  pickerItemActive:     { backgroundColor: "#eff6ff" },
  pickerItemText:       { flex: 1, fontSize: 15, color: "#334155" },
  pickerItemTextActive: { color: "#0A57EB", fontWeight: "600" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center", alignItems: "center" },
  modalClose:   { position: "absolute", top: 50, right: 20, width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center", zIndex: 10 },
  fullImage:    { width: width - 40, height: height - 200 },
});