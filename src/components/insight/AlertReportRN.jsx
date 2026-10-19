// AlertReportRN.jsx

import { MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import axios from "axios";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Circle, Text as SvgText } from "react-native-svg";
import useImageActions from "../../hooks/useImageActions";
import useSharedAlerts from "../../hooks/useSharedAlerts";
import LastUpdatedLabel from "../LastUpdatedLabel";
import Toast from "../Toast";
import ZoomableImageModal from "../ZoomableImageModal";

// Trims cameraName before it's used as a grouping key — untrimmed values
// (stray leading/trailing whitespace from the source payload) would
// otherwise split one physical camera into multiple entries here, even
// though Notifications' own camera list already trims the same field and
// shows the correct, deduped count.
const getCameraName = (a) => (a.cameraName ?? a.Camera_Name ?? "").trim();

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const { width } = Dimensions.get("window");
const PAGE_SIZE = 20;

const CHART_COLORS = [
  "#93c5fd",
  "#86efac",
  "#fde68a",
  "#f9a8d4",
  "#a5b4fc",
  "#6ee7b7",
  "#fca5a5",
  "#c4b5fd",
];

// ── Camera chart (donut) ──────────────────────────────────────────────────────
// Each ring segment "draws in" (sweeps from its start angle) as `anim` runs
// 0 → 1, using the same shared value — and same restart-on-new-data timing —
// as the hourly bars, so both charts animate together. ───────────────────────
const CameraChart = ({ camerasObj, anim }) => {
  const entries = Object.values(camerasObj || {})
    .map((c) => ({ name: c.cameraId, count: c.total_alerts_generated ?? 0 }))
    .sort((a, b) => b.count - a.count);

  const total = entries.reduce((s, e) => s + e.count, 0);

  if (!entries.length) {
    return (
      <View style={cStyles.empty}>
        <MaterialIcons name="bar-chart" size={32} color="#cbd5e1" />
        <Text style={cStyles.emptyText}>No data for selected filters</Text>
      </View>
    );
  }

  // Donut geometry
  const DONUT_SIZE = 180;
  const STROKE = 32;
  const RADIUS = (DONUT_SIZE - STROKE) / 2;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const CENTER = DONUT_SIZE / 2;

  let cumulativePct = 0;
  const segments = entries.map((e, i) => {
    const pct = total > 0 ? e.count / total : 0;
    const cumStart = cumulativePct;
    const cumEnd = cumulativePct + pct;
    const dashLength = pct * CIRCUMFERENCE;
    const gapLength = CIRCUMFERENCE - dashLength;
    const rotation = cumStart * 360 - 90;

    // Label midpoint angle
    const midAngle = (cumStart + pct / 2) * 2 * Math.PI - Math.PI / 2;
    const labelR = RADIUS;
    const lx = CENTER + labelR * Math.cos(midAngle);
    const ly = CENTER + labelR * Math.sin(midAngle);

    cumulativePct = cumEnd;

    return {
      ...e,
      pct,
      cumStart,
      cumEnd,
      dashLength,
      gapLength,
      rotation,
      color: CHART_COLORS[i % CHART_COLORS.length],
      lx,
      ly,
    };
  });

  return (
    <View>
      {/* ── Donut ── */}
      <View style={cStyles.donutWrap}>
        <Svg width={DONUT_SIZE} height={DONUT_SIZE}>
          {/* Background ring */}
          <Circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={STROKE}
          />
          {/* Colored segments — the ring sweeps around from 0, each segment
              filling in during its own slice of the animation timeline, in
              order, so it visibly grows from empty to the full total. */}
          {segments.map((seg) => (
            <AnimatedCircle
              key={seg.name}
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={seg.color}
              strokeWidth={STROKE}
              strokeDasharray={`${seg.dashLength} ${seg.gapLength}`}
              strokeDashoffset={anim.interpolate({
                inputRange: [
                  seg.cumStart,
                  Math.max(seg.cumEnd, seg.cumStart + 0.0001),
                ],
                outputRange: [seg.dashLength, 0],
                extrapolate: "clamp",
              })}
              transform={`rotate(${seg.rotation} ${CENTER} ${CENTER})`}
            />
          ))}
          {/* Count labels on segments — only show if segment is big enough */}
          {segments.map((seg) =>
            seg.pct > 0.08 ? (
              <SvgText
                key={`lbl-${seg.name}`}
                x={seg.lx}
                y={seg.ly}
                textAnchor="middle"
                alignmentBaseline="middle"
                fontSize="12"
                fontWeight="bold"
                fill="#1e293b"
              >
                {seg.count}
              </SvgText>
            ) : null,
          )}
          {/* Center: total */}
          <SvgText
            x={CENTER}
            y={CENTER - 10}
            textAnchor="middle"
            alignmentBaseline="middle"
            fontSize="22"
            fontWeight="bold"
            fill="#0f172a"
          >
            {total}
          </SvgText>
          <SvgText
            x={CENTER}
            y={CENTER + 12}
            textAnchor="middle"
            alignmentBaseline="middle"
            fontSize="11"
            fill="#66778f"
          >
            total
          </SvgText>
        </Svg>
      </View>

      {/* ── Legend ── */}
      <View style={cStyles.legendRow}>
        {entries.map((e, i) => (
          <View key={e.name} style={cStyles.legendItem}>
            <View
              style={[
                cStyles.legendDot,
                { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] },
              ]}
            />
            <Text style={cStyles.legendText} numberOfLines={1}>
              {e.name}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
};

// ── Camera-wise alert count, as a plain table alongside the donut chart ──────
const CameraCountTable = ({ camerasObj }) => {
  const rows = Object.values(camerasObj || {})
    .map((c) => ({ name: c.cameraId, count: c.total_alerts_generated ?? 0 }))
    .sort((a, b) => b.count - a.count);

  if (!rows.length) {
    return (
      <View style={cStyles.empty}>
        <MaterialIcons name="table-chart" size={32} color="#cbd5e1" />
        <Text style={cStyles.emptyText}>No data for selected filters</Text>
      </View>
    );
  }

  const total = rows.reduce((s, r) => s + r.count, 0);

  return (
    <View style={tStyles.table}>
      <View style={[tStyles.row, tStyles.headerRow]}>
        <Text style={[tStyles.cellCamera, tStyles.headerText]}>Camera</Text>
        <Text style={[tStyles.cellCount, tStyles.headerText]}>Alerts</Text>
      </View>
      {rows.map((r, i) => (
        <View key={r.name} style={[tStyles.row, i % 2 === 1 && tStyles.rowAlt]}>
          <Text style={tStyles.cellCamera} numberOfLines={1}>
            {r.name}
          </Text>
          <Text style={tStyles.cellCount}>{r.count}</Text>
        </View>
      ))}
      <View style={[tStyles.row, tStyles.totalRow]}>
        <Text style={[tStyles.cellCamera, tStyles.totalText]}>Total</Text>
        <Text style={[tStyles.cellCount, tStyles.totalText]}>{total}</Text>
      </View>
    </View>
  );
};

const tStyles = StyleSheet.create({
  table: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eef2f7",
  },
  headerRow: { backgroundColor: "#f8fafc" },
  rowAlt: { backgroundColor: "#fafbfc" },
  totalRow: { borderBottomWidth: 0, backgroundColor: "#f1f5f9" },
  cellCamera: { flex: 1, fontSize: 12.5, color: "#334155" },
  cellCount: {
    width: 60,
    textAlign: "right",
    fontSize: 12.5,
    color: "#334155",
    fontWeight: "600",
  },
  headerText: {
    color: "#66778f",
    fontWeight: "700",
    fontSize: 11,
    textTransform: "uppercase",
  },
  totalText: { fontWeight: "700", color: "#0f172a" },
});

const cStyles = StyleSheet.create({
  empty: { alignItems: "center", paddingVertical: 24, gap: 8 },
  emptyText: { fontSize: 12, color: "#66778f" },

  donutWrap: { alignItems: "center", marginBottom: 8 },

  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    marginBottom: 8,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 12, height: 12, borderRadius: 3 },
  legendText: { fontSize: 11, color: "#475569", maxWidth: 100 },
});

// ── Bucket alerts into 24 hourly slots covering the last 24 hours, oldest
// first, so it can be plotted as a chronological bar chart. ──────────────────
const buildHourlyBuckets = (alerts) => {
  const now = Date.now();
  const buckets = Array.from({ length: 24 }, (_, i) => ({
    hour: dayjs(now - (23 - i) * 60 * 60 * 1000).hour(),
    count: 0,
  }));
  alerts.forEach((a) => {
    const t = new Date(a.receivedAt ?? a.incidentTime).getTime();
    const hoursAgo = Math.floor((now - t) / (60 * 60 * 1000));
    if (hoursAgo >= 0 && hoursAgo < 24) buckets[23 - hoursAgo].count += 1;
  });
  return buckets;
};

// ── Vertical bar chart: alerts per hour, over the currently filtered range ───
// Bars animate in (height 0 → target) driven by the `anim` value, which the
// parent restarts every time fresh data lands — so the bars visibly grow up
// from the bottom each time the report loads or a filter changes, not just
// once on mount. Tap a bar to see its exact count in the summary line below.
const HourlyChart = ({ buckets, anim }) => {
  const [activeIndex, setActiveIndex] = useState(null);
  const total = buckets.reduce((s, b) => s + b.count, 0);

  if (!total) {
    return (
      <View style={cStyles.empty}>
        <MaterialIcons name="bar-chart" size={32} color="#cbd5e1" />
        <Text style={cStyles.emptyText}>No data for selected filters</Text>
      </View>
    );
  }

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const peakIdx = buckets.reduce(
    (best, b, i) => (b.count > buckets[best].count ? i : best),
    0,
  );
  const peakHour = dayjs().hour(buckets[peakIdx].hour).minute(0).format("h A");

  return (
    <View>
      <View style={hStyles.bars}>
        {buckets.map((b, i) => {
          const pct = b.count > 0 ? Math.max(b.count / maxCount, 0.06) : 0.02;
          const heightAnim = anim.interpolate({
            inputRange: [0, 1],
            outputRange: ["0%", `${pct * 100}%`],
          });
          const isActive = activeIndex === i;
          return (
            <TouchableOpacity
              key={i}
              style={hStyles.barCol}
              activeOpacity={0.7}
              onPress={() => setActiveIndex(isActive ? null : i)}
            >
              <View style={hStyles.barTrack}>
                <Animated.View
                  style={[
                    hStyles.barFill,
                    { height: heightAnim },
                    isActive && hStyles.barFillActive,
                  ]}
                />
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={hStyles.axis}>
        {[0, 6, 12, 18, 23].map((i) => (
          <Text key={i} style={hStyles.axisText}>
            {i === 23
              ? "Now"
              : dayjs().hour(buckets[i].hour).minute(0).format("hA")}
          </Text>
        ))}
      </View>
      <Text style={hStyles.summary}>
        {activeIndex !== null
          ? `${dayjs().hour(buckets[activeIndex].hour).minute(0).format("h A")}: ${buckets[activeIndex].count} alert${buckets[activeIndex].count !== 1 ? "s" : ""}`
          : `${total} alert${total !== 1 ? "s" : ""} · peak ${buckets[peakIdx].count} at ${peakHour}`}
      </Text>
    </View>
  );
};

const hStyles = StyleSheet.create({
  bars: { flexDirection: "row", alignItems: "flex-end", height: 90 },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  barTrack: {
    width: 6,
    height: 90,
    backgroundColor: "#eef2f7",
    borderRadius: 3,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  barFill: { width: "100%", backgroundColor: "#035faa", borderRadius: 3 },
  barFillActive: { backgroundColor: "#023e73" },
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  axisText: { fontSize: 10, color: "#94a3b8" },
  summary: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 12,
    textAlign: "center",
  },
});

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AlertReportRN({
  groupsApiUrl = null,
  token = null,
  mobileId = null,
}) {
  const [toast, setToast] = useState({ visible: false, text: "" });

  // Hour-of-day slice within the fixed last-24-hours window — same concept
  // as the Notifications tab's From/To filter, null means no restriction.
  const [startHour, setStartHour] = useState(null);
  const [endHour, setEndHour] = useState(null);

  const [allGroups, setAllGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null); // null = All Groups
  const [selectedCameras, setSelectedCameras] = useState([]);
  const [selectedOoi, setSelectedOoi] = useState([]);

  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [modalImageUrl, setModalImageUrl] = useState(null);

  const { downloadImage, shareImage, downloadingUrl, sharingUrl } =
    useImageActions();

  // Restarts every time this screen mounts (i.e. every time the Alert Report
  // tab is opened), driving the charts' entrance animation. Only animates
  // opacity/transform, so this runs on the native UI thread — it now fires
  // at almost the same instant as barAnim below (cache-first data hydrates
  // near-instantly), and barAnim can't use the native driver (it animates a
  // percentage height, which isn't native-driver-eligible). Keeping this one
  // off the JS thread means the two animations don't compete for it, which
  // is what made the combined motion look janky instead of smooth.
  const mountAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    mountAnim.setValue(0);
    Animated.timing(mountAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);

  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [showCamPicker, setShowCamPicker] = useState(false);
  const [showOoiPicker, setShowOoiPicker] = useState(false);

  const [paginatedData, setPaginatedData] = useState([]);
  const [page, setPage] = useState(0);

  // ── Fetch the live group list — same source of truth as the Notifications
  // tab. Local storage can retain "aksha_alerts_<groupId>" keys for groups the
  // account no longer belongs to (nothing ever prunes an orphaned key), so
  // deriving the group list from storage instead of this API is what caused
  // Report to show groups Notifications doesn't. ──────────────────────────
  useEffect(() => {
    const fetchGroups = async () => {
      if (!groupsApiUrl) return;
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        // No timeout would let a stalled request hang forever instead of
        // rejecting, leaving this screen's own loading state stuck true
        // indefinitely.
        const res = await axios.post(
          groupsApiUrl,
          { mobileId },
          { headers, timeout: 15000 },
        );
        const data = res.data?.groups ?? [];
        setAllGroups(data.map((g) => ({ groupId: g.id, groupName: g.name })));
      } catch (err) {
        console.warn("AlertReportRN fetchGroups error:", err);
      }
    };
    fetchGroups();
  }, [groupsApiUrl, mobileId, token]);

  // ── Hour slots for the From/To time-range filter — same wrap-forward
  // scheme as the Notifications tab (starts at the next full hour). ─────────
  const fromSlots = useMemo(() => {
    const nowHour = dayjs().hour();
    return Array.from({ length: 24 }, (_, i) => {
      const h = (nowHour + 1 + i) % 24;
      const lbl = dayjs().hour(h).minute(0).format("hh:mm A");
      return { h, lbl, index: i };
    });
  }, []);

  const toSlots = useMemo(() => {
    const nowHour = dayjs().hour();
    return Array.from({ length: 24 }, (_, i) => {
      const h = (nowHour + 2 + i) % 24;
      const lbl = dayjs().hour(h).minute(0).format("hh:mm A");
      return { h, lbl, index: i };
    });
  }, []);

  // Shared across every alert screen (Home, Monitor, Investigate,
  // Notifications, Alert Report) — one sync updates this ONE store, and
  // every screen using it re-renders from the same result together,
  // instead of each screen keeping its own separate cache that could drift
  // out of sync with the others by up to a poll interval.
  const {
    alerts: rawAlerts,
    loading,
    initialSyncing,
    refreshing,
    error,
    refresh,
    lastUpdated,
  } = useSharedAlerts({ mobileId, token });

  useEffect(() => {
    if (error) setToast({ visible: true, text: "Failed to load report" });
  }, [error]);

  // AppState resume, the 15s poll, and the push-triggered 'aksha_new_alert'
  // event are all now handled once at the shared store's module level
  // (useSharedAlerts.js) rather than per-screen. Only useFocusEffect stays
  // screen-local: focus is inherently per-screen, so without this, coming
  // back to Insights after time on another tab would keep showing whatever
  // the shared store last held until the next global trigger happened to
  // fire. Silent — a plain tab switch shouldn't pop "Syncing…", only a real
  // pull-to-refresh should.
  useFocusEffect(
    useCallback(() => {
      refresh({ silent: true });
    }, [refresh]),
  );

  // ── Camera/Object filter OPTIONS — scoped to whichever group is currently
  // selected, not every group. When "All Groups" is chosen, scope to groups
  // the account currently belongs to (validGroupIds), same as the report
  // filter itself below, so these dropdowns never offer a camera/alert-type
  // that isn't actually reachable from what's currently being viewed. ──────
  const { allCameras, ooiLabels } = useMemo(() => {
    const validGroupIds = new Set(allGroups.map((g) => g.groupId));
    const scoped = selectedGroup
      ? rawAlerts.filter((a) => a.groupId === selectedGroup.groupId)
      : rawAlerts.filter(
          (a) => validGroupIds.size === 0 || validGroupIds.has(a.groupId),
        );

    const cameraSet = new Set();
    for (const a of scoped) {
      const cam = getCameraName(a);
      if (cam) cameraSet.add(cam);
    }
    const allCameras = Array.from(cameraSet).map((n) => ({ Camera_Name: n }));

    // Object/alert-type options narrow to whichever cameras are currently
    // picked, so choosing a camera only offers alert types that actually
    // occurred on it — not every alert type across the whole group.
    const cameraScoped =
      selectedCameras.length > 0 && selectedCameras.length < allCameras.length
        ? scoped.filter((a) => selectedCameras.includes(getCameraName(a)))
        : scoped;

    const ooiSet = new Set();
    for (const a of cameraScoped) {
      if (a.alertName) ooiSet.add(a.alertName);
    }
    return { allCameras, ooiLabels: Array.from(ooiSet) };
  }, [rawAlerts, allGroups, selectedGroup, selectedCameras]);

  // Whether the camera/object filters are still "auto" (silently mirroring
  // every camera/object currently known) or the user has manually narrowed
  // one of them. Background refreshes keep discovering more cameras/objects
  // over time — syncing the "everything selected" snapshot only once (on
  // mount/group-change) goes stale the moment new data merges in (the badge
  // starts reading e.g. "2 selected" against a total that quietly grew to
  // 3), which is exactly the bug this replaces. Auto mode re-mirrors on
  // every change instead; it turns off the moment the user actually taps a
  // specific camera/object, so their manual pick is never silently touched
  // again — a *newly appearing* camera/object just stays unselected, which
  // is the unsurprising interpretation once the user has made an explicit
  // choice.
  const camerasAutoRef = useRef(true);
  const ooiAutoRef = useRef(true);

  useEffect(() => {
    if (!camerasAutoRef.current) return;
    const names = allCameras.map((c) => c.Camera_Name);
    // allCameras is a fresh array/object every memo recompute even when its
    // *content* hasn't changed (and its memo depends on selectedCameras,
    // which this effect writes to) — writing back an unconditionally new
    // reference here would re-trigger the memo, produce another new
    // reference, and loop forever ("Maximum update depth exceeded"). Bailing
    // out via `prev` when the values already match keeps React from
    // re-rendering at all, which is what actually stops the cycle.
    setSelectedCameras((prev) =>
      prev.length === names.length && prev.every((n) => names.includes(n))
        ? prev
        : names,
    );
  }, [allCameras]);

  useEffect(() => {
    if (!ooiAutoRef.current) return;
    setSelectedOoi((prev) =>
      prev.length === ooiLabels.length &&
      prev.every((o) => ooiLabels.includes(o))
        ? prev
        : ooiLabels,
    );
  }, [ooiLabels]);

  // Drop a previously manually-picked alert type that no longer applies once
  // the camera selection narrows the list. Only relevant once the user has
  // left ooi auto mode — while still auto, the effect above already keeps
  // selectedOoi mirroring ooiLabels on every change, camera-driven or not.
  useEffect(() => {
    if (!ooiAutoRef.current) {
      setSelectedOoi((prev) => {
        const pruned = prev.filter((o) => ooiLabels.includes(o));
        return pruned.length === prev.length ? prev : pruned;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCameras]);

  // Switching groups drops any manual narrowing from the previous group
  // (it may not even apply to the new one) and goes back to auto mode,
  // syncing immediately from whatever allCameras/ooiLabels already resolved
  // to for the new group.
  useEffect(() => {
    camerasAutoRef.current = true;
    ooiAutoRef.current = true;
    setSelectedCameras(allCameras.map((c) => c.Camera_Name));
    setSelectedOoi(ooiLabels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup]);

  // The hook's own `refreshing` flips true for every background trigger
  // too, not just a manual pull — binding RefreshControl to that would pop
  // the spinner back up during silent background syncs even though data is
  // already on screen. This tracks ONLY the user's own pull gesture;
  // background refreshes stay invisible.
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const onPullToRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await refresh();
    } finally {
      setPullRefreshing(false);
    }
  }, [refresh]);

  // ── Filter + aggregate — always the last 24 hours, recomputed in-memory
  // whenever a filter changes (no storage I/O, no per-alert re-sort). ───────
  const { camerasMap, filteredAlerts } = useMemo(() => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    // When "All Groups" is selected, only count alerts belonging to a group
    // the account currently belongs to — otherwise stale "aksha_alerts_*"
    // keys left over from a past group membership would silently inflate
    // the total beyond what Notifications (which only ever shows current
    // groups) reports. If the live groups list hasn't loaded yet, don't
    // filter at all rather than wrongly excluding everything.
    const validGroupIds = new Set(allGroups.map((g) => g.groupId));

    const filtered = rawAlerts.filter((a) => {
      const t = dayjs(a.receivedAt ?? a.incidentTime);
      const cam = getCameraName(a);
      const obj = a.alertName ?? "";

      if (t.valueOf() <= oneDayAgo) return false;

      if (startHour !== null && endHour !== null) {
        const h = t.hour() + t.minute() / 60;
        const inRange =
          startHour <= endHour
            ? h >= startHour && h <= endHour
            : h >= startHour || h <= endHour;
        if (!inRange) return false;
      }

      const groupOk = selectedGroup
        ? a.groupId === selectedGroup.groupId
        : validGroupIds.size === 0 || validGroupIds.has(a.groupId);

      return (
        groupOk &&
        (selectedCameras.length === 0 || selectedCameras.includes(cam)) &&
        (selectedOoi.length === 0 || selectedOoi.includes(obj))
      );
    });

    filtered.sort((a, b) =>
      dayjs(b.receivedAt ?? b.incidentTime).diff(
        dayjs(a.receivedAt ?? a.incidentTime),
      ),
    );

    // Aggregate by camera
    const camerasMap = {};
    for (const a of filtered) {
      const camId = getCameraName(a) || "Unknown";
      const objName = a.alertName ?? "Unknown";
      const imgUrl = a.imageUrl ?? null;
      const ts = a.receivedAt ?? a.incidentTime;
      const hour = dayjs(ts).hour();

      if (!camerasMap[camId]) {
        camerasMap[camId] = {
          cameraId: camId,
          total_alerts_generated: 0,
          object_detection_alerts: {},
          _hourCounts: {},
          peak_alert_time_hour: null,
          alerts: {},
        };
      }
      const cam = camerasMap[camId];
      cam.total_alerts_generated += 1;
      cam.object_detection_alerts[objName] =
        (cam.object_detection_alerts[objName] || 0) + 1;
      cam._hourCounts[hour] = (cam._hourCounts[hour] || 0) + 1;
      if (imgUrl) {
        const isoKey = dayjs(ts).toISOString();
        if (!cam.alerts[isoKey]) cam.alerts[isoKey] = [];
        cam.alerts[isoKey].push(imgUrl);
      }
    }
    // Peak hour computed once per camera after all alerts are counted,
    // instead of re-sorting _hourCounts on every single alert.
    Object.values(camerasMap).forEach((cam) => {
      const hourEntries = Object.entries(cam._hourCounts);
      if (hourEntries.length) {
        cam.peak_alert_time_hour = Number(
          hourEntries.sort((a, b) => b[1] - a[1])[0][0],
        );
      }
      delete cam._hourCounts;
    });

    return { camerasMap, filteredAlerts: filtered };
  }, [
    rawAlerts,
    allGroups,
    selectedGroup,
    selectedCameras,
    selectedOoi,
    startHour,
    endHour,
  ]);

  // ── Reset pagination whenever the filtered/aggregated camera set changes ──
  useEffect(() => {
    const camsList = Object.values(camerasMap);
    setPaginatedData(camsList.slice(0, PAGE_SIZE));
    setPage(1);
  }, [camerasMap]);

  // ── Surface an empty-result toast once loading/syncing has settled ────────
  // Waits on `refreshing` too, not just `loading`: reopening after a long
  // gap (e.g. 2 days) restores the OLD cache instantly (loading flips false
  // right away), but filteredAlerts' live 24h window zeroes that stale
  // cache out immediately — without this, that transient emptiness fired a
  // false "No alerts found" toast before the real catch-up sync had a
  // chance to resolve.
  useEffect(() => {
    if (loading || refreshing) return;
    if (filteredAlerts.length === 0) {
      setToast({ visible: true, text: "No alerts found for selected filters" });
    }
  }, [filteredAlerts, loading, refreshing]);

  const clearFilters = () => {
    camerasAutoRef.current = true;
    ooiAutoRef.current = true;
    setSelectedCameras(allCameras.map((c) => c.Camera_Name));
    setSelectedOoi(ooiLabels);
    setStartHour(null);
    setEndHour(null);
  };

  const loadMore = () => {
    const all = Object.values(camerasMap);
    const start = page * PAGE_SIZE;
    if (start >= all.length) return;
    setPaginatedData((prev) => [
      ...prev,
      ...all.slice(start, start + PAGE_SIZE),
    ]);
    setPage((p) => p + 1);
  };

  const openImageModal = (item) => {
    const url = item?.alerts && Object.values(item.alerts)[0]?.[0];
    if (url) {
      setModalImageUrl(url);
      setImageModalOpen(true);
    } else setToast({ visible: true, text: "No image available" });
  };

  // Gated on the auto-mode flags, not just a length mismatch: right after
  // mount/tab-switch, selectedCameras/selectedOoi briefly sit at their
  // initial `[]` while allCameras/ooiLabels may already be populated from
  // cache — a plain length comparison would read that as "filtered" for one
  // frame until the auto-sync effect catches up. While still in auto mode
  // there's by definition no manual narrowing, so it can never count here.
  const activeFilterCount =
    (!camerasAutoRef.current &&
    allCameras.length > 0 &&
    selectedCameras.length !== allCameras.length
      ? 1
      : 0) +
    (!ooiAutoRef.current &&
    ooiLabels.length > 0 &&
    selectedOoi.length !== ooiLabels.length
      ? 1
      : 0) +
    (startHour !== null && endHour !== null ? 1 : 0);
  const isFiltered = activeFilterCount > 0;

  const hourlyBuckets = useMemo(
    () => buildHourlyBuckets(filteredAlerts),
    [filteredAlerts],
  );

  // Plays once, the first time `loading` flips from true to false (i.e. the
  // moment the report has anything to show, whether that's a cache seed or
  // the first real fetch). `loading` never goes back to true afterward for
  // this screen's fixed cache key, so this fires exactly once per mount —
  // NOT on every dependency change. It used to also depend on `hourlyBuckets`
  // to "catch" data that arrived after the mount animation finished, but
  // since a background refresh's merged result is a new array reference
  // every ~30s (and right after the cache-seed's own background sync lands),
  // that made the bars visibly regrow from empty on every silent refresh —
  // depending on `hourlyBuckets` here was actually the bug, not the fix.
  const barAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (loading) return;
    barAnim.setValue(0);
    Animated.timing(barAnim, {
      toValue: 1,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [loading]);

  // ── List header ────────────────────────────────────────────────────────────
  const ListHeader = () => (
    <View>
      {/* Sub-header — matches the Notifications tab's Filter/Group buttons */}
      <View style={styles.subHeader}>
        <MaterialIcons name="assessment" size={16} color="#035faa" />
        <Text style={styles.subHeaderLabel}>
          {filteredAlerts.length} alert{filteredAlerts.length !== 1 ? "s" : ""}{" "}
          · last 24 hrs
        </Text>
        <TouchableOpacity
          style={[styles.filterBtn, isFiltered && styles.filterBtnActive]}
          onPress={() => setShowFilterSheet(true)}
        >
          <MaterialIcons
            name="tune"
            size={15}
            color={isFiltered ? "#fff" : "#035faa"}
          />
          <Text style={[styles.filterBtnText, isFiltered && { color: "#fff" }]}>
            Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.groupBtn}
          onPress={() => setShowGroupPicker(true)}
        >
          <View style={styles.groupBtnInner}>
            <MaterialIcons name="group" size={13} color="#035faa" />
            <Text
              style={styles.groupBtnText}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {selectedGroup ? selectedGroup.groupName : "All Groups"}
            </Text>
            <MaterialIcons name="arrow-drop-down" size={16} color="#035faa" />
          </View>
        </TouchableOpacity>
      </View>

      <Animated.View
        style={[
          styles.body,
          {
            opacity: mountAnim,
            transform: [
              {
                translateY: mountAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [16, 0],
                }),
              },
            ],
          },
        ]}
      >
        {/* Camera chart card */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <MaterialIcons name="videocam" size={15} color="#035faa" />
            <Text style={styles.cardTitle}>Alerts by camera</Text>
          </View>
          <CameraChart camerasObj={camerasMap} anim={barAnim} />
        </View>

        {/* Camera-wise alert count table */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <MaterialIcons name="table-chart" size={15} color="#035faa" />
            <Text style={styles.cardTitle}>Camera-wise alert count</Text>
          </View>
          <CameraCountTable camerasObj={camerasMap} />
        </View>

        {/* Hourly chart card */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <MaterialIcons name="schedule" size={15} color="#035faa" />
            <Text style={styles.cardTitle}>Alerts by hour</Text>
          </View>
          <HourlyChart buckets={hourlyBuckets} anim={barAnim} />
        </View>
      </Animated.View>
    </View>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <Toast
        text={toast.text}
        visible={toast.visible}
        onClose={() => setToast({ visible: false, text: "" })}
      />

      {/* Also spinner-gates on "refreshing AND still empty" — reopening
          after a long gap restores the old cache instantly (loading flips
          false right away), but the live 24h window in the memo above
          zeroes that stale cache out immediately, which showed an empty
          report for however long the real catch-up sync took even though
          one was actively in flight. An ordinary background poll with data
          already on screen never falls into this branch, only the
          genuinely ambiguous "empty until proven otherwise" case does. */}
      {loading || (refreshing && filteredAlerts.length === 0) ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#035faa" />
          <Text style={styles.loadingText}>Loading report…</Text>
        </View>
      ) : (
        <FlatList
          data={paginatedData}
          keyExtractor={(item) => item.cameraId}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListHeaderComponent={ListHeader}
          ListFooterComponent={<View style={{ height: 40 }} />}
          refreshControl={
            <RefreshControl
              refreshing={pullRefreshing}
              onRefresh={onPullToRefresh}
              colors={["#035faa"]}
              tintColor="#035faa"
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="search" size={44} color="#cbd5e1" />
              <Text style={styles.emptyText}>
                {isFiltered
                  ? "No alerts match your filters"
                  : "No alerts in the last 24 hours"}
              </Text>
              {isFiltered && (
                <TouchableOpacity
                  style={styles.clearBtn}
                  onPress={clearFilters}
                >
                  <Text style={styles.clearBtnText}>Clear filters</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          onEndReachedThreshold={0.5}
          onEndReached={loadMore}
          initialNumToRender={8}
          maxToRenderPerBatch={10}
          removeClippedSubviews
        />
      )}

      {/* ── FILTER SHEET — Camera, Object, and Time range ── */}
      <Modal visible={showFilterSheet} transparent animationType="slide">
        <TouchableOpacity
          style={styles.pickerOverlay}
          onPress={() => setShowFilterSheet(false)}
          activeOpacity={1}
        >
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

            {/* Camera */}
            <Text style={styles.filterLabel}>Camera</Text>
            <TouchableOpacity
              style={styles.filterDropdown}
              onPress={() => setShowCamPicker(true)}
            >
              <MaterialIcons name="videocam" size={15} color="#94a3b8" />
              <Text style={styles.filterDropdownText}>
                {allCameras.length === 0
                  ? "No cameras"
                  : selectedCameras.length === allCameras.length
                    ? "All cameras"
                    : `${selectedCameras.length} selected`}
              </Text>
              <MaterialIcons name="arrow-drop-down" size={20} color="#94a3b8" />
            </TouchableOpacity>

            {/* Object */}
            <Text style={[styles.filterLabel, { marginTop: 16 }]}>Object</Text>
            <TouchableOpacity
              style={styles.filterDropdown}
              onPress={() => setShowOoiPicker(true)}
            >
              <MaterialIcons name="category" size={15} color="#94a3b8" />
              <Text style={styles.filterDropdownText}>
                {ooiLabels.length === 0
                  ? "No object types"
                  : selectedOoi.length === ooiLabels.length
                    ? "All objects"
                    : `${selectedOoi.length} selected`}
              </Text>
              <MaterialIcons name="arrow-drop-down" size={20} color="#94a3b8" />
            </TouchableOpacity>

            {/* Time range */}
            <Text style={[styles.filterLabel, { marginTop: 16 }]}>
              Time range (last 24 hrs)
            </Text>
            <Text style={styles.timePickerLabel}>From</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.hourScroll}
            >
              {fromSlots.map(({ h, lbl, index }) => {
                const sel = startHour === h;
                return (
                  <TouchableOpacity
                    key={index}
                    style={[styles.hourChip, sel && styles.hourChipActive]}
                    onPress={() => {
                      setStartHour(h);
                      setEndHour(null);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.hourChipText,
                        sel && styles.hourChipTextActive,
                      ]}
                    >
                      {lbl}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={[styles.timePickerLabel, { marginTop: 12 }]}>To</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.hourScroll}
            >
              {toSlots.map(({ h, lbl, index }) => {
                const sel = endHour === h;
                const fromIndex =
                  startHour !== null
                    ? fromSlots.findIndex((s) => s.h === startHour)
                    : -1;
                const disabled = startHour === null || index < fromIndex;
                return (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.hourChip,
                      sel && styles.hourChipActive,
                      disabled && styles.hourChipDisabled,
                    ]}
                    onPress={() => {
                      if (!disabled) setEndHour(h);
                    }}
                    activeOpacity={disabled ? 1 : 0.7}
                  >
                    <Text
                      style={[
                        styles.hourChipText,
                        sel && styles.hourChipTextActive,
                        disabled && styles.hourChipTextDisabled,
                      ]}
                    >
                      {lbl}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {startHour !== null && endHour !== null && (
              <View style={styles.selectedRangeWrap}>
                <MaterialIcons name="access-time" size={14} color="#035faa" />
                <Text style={styles.selectedRangeText}>
                  {dayjs().hour(startHour).minute(0).format("hh:mm A")} →{" "}
                  {dayjs().hour(endHour).minute(0).format("hh:mm A")}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setStartHour(null);
                    setEndHour(null);
                  }}
                >
                  <MaterialIcons name="close" size={14} color="#94a3b8" />
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity
              style={styles.applyBtn}
              onPress={() => setShowFilterSheet(false)}
            >
              <Text style={styles.applyBtnText}>
                Apply · {filteredAlerts.length} result
                {filteredAlerts.length !== 1 ? "s" : ""}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Group picker — single select, same behavior as the Notifications tab */}
      <Modal visible={showGroupPicker} transparent animationType="slide">
        <TouchableOpacity
          style={styles.pickerOverlay}
          onPress={() => setShowGroupPicker(false)}
          activeOpacity={1}
        >
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Select group</Text>
            <ScrollView>
              <TouchableOpacity
                style={[
                  styles.pickerItem,
                  !selectedGroup && styles.pickerItemActive,
                ]}
                onPress={() => {
                  setSelectedGroup(null);
                  setShowGroupPicker(false);
                }}
              >
                <MaterialIcons
                  name="apps"
                  size={18}
                  color={!selectedGroup ? "#035faa" : "#66778f"}
                />
                <Text
                  style={[
                    styles.pickerItemText,
                    !selectedGroup && styles.pickerItemActiveText,
                  ]}
                >
                  All groups
                </Text>
                {!selectedGroup && (
                  <MaterialIcons name="check" size={18} color="#035faa" />
                )}
              </TouchableOpacity>
              {allGroups.length === 0 ? (
                <Text style={styles.pickerEmpty}>
                  No groups found in storage
                </Text>
              ) : (
                allGroups.map((g) => {
                  const sel = selectedGroup?.groupId === g.groupId;
                  return (
                    <TouchableOpacity
                      key={g.groupId}
                      style={[
                        styles.pickerItem,
                        sel && styles.pickerItemActive,
                      ]}
                      onPress={() => {
                        setSelectedGroup(g);
                        setShowGroupPicker(false);
                      }}
                    >
                      <MaterialIcons
                        name="group"
                        size={18}
                        color={sel ? "#035faa" : "#66778f"}
                      />
                      <Text
                        style={[
                          styles.pickerItemText,
                          sel && styles.pickerItemActiveText,
                        ]}
                      >
                        {g.groupName}
                      </Text>
                      {sel && (
                        <MaterialIcons name="check" size={18} color="#035faa" />
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Camera picker */}
      <Modal visible={showCamPicker} transparent animationType="slide">
        <TouchableOpacity
          style={styles.pickerOverlay}
          onPress={() => setShowCamPicker(false)}
          activeOpacity={1}
        >
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Select cameras</Text>
            <ScrollView>
              {allCameras.length === 0 ? (
                <Text style={styles.pickerEmpty}>
                  No cameras found in storage
                </Text>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.pickerSelectAll}
                    onPress={() => {
                      camerasAutoRef.current = false;
                      setSelectedCameras(
                        selectedCameras.length === allCameras.length
                          ? []
                          : allCameras.map((c) => c.Camera_Name),
                      );
                    }}
                  >
                    <MaterialIcons
                      name={
                        selectedCameras.length === allCameras.length
                          ? "check-box"
                          : "check-box-outline-blank"
                      }
                      size={20}
                      color="#035faa"
                    />
                    <Text style={styles.pickerSelectAllText}>Select all</Text>
                  </TouchableOpacity>
                  {allCameras.map((cam) => {
                    const sel = selectedCameras.includes(cam.Camera_Name);
                    return (
                      <TouchableOpacity
                        key={cam.Camera_Name}
                        style={[
                          styles.pickerItem,
                          sel && styles.pickerItemActive,
                        ]}
                        onPress={() => {
                          camerasAutoRef.current = false;
                          setSelectedCameras((prev) =>
                            sel
                              ? prev.filter((c) => c !== cam.Camera_Name)
                              : [...prev, cam.Camera_Name],
                          );
                        }}
                      >
                        <MaterialIcons
                          name="videocam"
                          size={18}
                          color={sel ? "#035faa" : "#66778f"}
                        />
                        <Text
                          style={[
                            styles.pickerItemText,
                            sel && styles.pickerItemActiveText,
                          ]}
                        >
                          {cam.Camera_Name}
                        </Text>
                        {sel && (
                          <MaterialIcons
                            name="check"
                            size={18}
                            color="#035faa"
                          />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </>
              )}
            </ScrollView>
            <TouchableOpacity
              style={styles.pickerDone}
              onPress={() => setShowCamPicker(false)}
            >
              <Text style={styles.pickerDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Object picker */}
      <Modal visible={showOoiPicker} transparent animationType="slide">
        <TouchableOpacity
          style={styles.pickerOverlay}
          onPress={() => setShowOoiPicker(false)}
          activeOpacity={1}
        >
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Select objects</Text>
            <ScrollView>
              {ooiLabels.length === 0 ? (
                <Text style={styles.pickerEmpty}>
                  No object types found in storage
                </Text>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.pickerSelectAll}
                    onPress={() => {
                      ooiAutoRef.current = false;
                      setSelectedOoi(
                        selectedOoi.length === ooiLabels.length
                          ? []
                          : [...ooiLabels],
                      );
                    }}
                  >
                    <MaterialIcons
                      name={
                        selectedOoi.length === ooiLabels.length
                          ? "check-box"
                          : "check-box-outline-blank"
                      }
                      size={20}
                      color="#035faa"
                    />
                    <Text style={styles.pickerSelectAllText}>Select all</Text>
                  </TouchableOpacity>
                  {ooiLabels.map((label) => {
                    const sel = selectedOoi.includes(label);
                    return (
                      <TouchableOpacity
                        key={label}
                        style={[
                          styles.pickerItem,
                          sel && styles.pickerItemActive,
                        ]}
                        onPress={() => {
                          ooiAutoRef.current = false;
                          setSelectedOoi((prev) =>
                            sel
                              ? prev.filter((o) => o !== label)
                              : [...prev, label],
                          );
                        }}
                      >
                        <MaterialIcons
                          name="category"
                          size={18}
                          color={sel ? "#035faa" : "#66778f"}
                        />
                        <Text
                          style={[
                            styles.pickerItemText,
                            sel && styles.pickerItemActiveText,
                          ]}
                        >
                          {label}
                        </Text>
                        {sel && (
                          <MaterialIcons
                            name="check"
                            size={18}
                            color="#035faa"
                          />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </>
              )}
            </ScrollView>
            <TouchableOpacity
              style={styles.pickerDone}
              onPress={() => setShowOoiPicker(false)}
            >
              <Text style={styles.pickerDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Fullscreen image */}
      <ZoomableImageModal
        visible={imageModalOpen}
        url={modalImageUrl}
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
      <LastUpdatedLabel
        timestamp={lastUpdated}
        refreshing={refreshing || initialSyncing}
        style={styles.lastUpdated}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f1f5f9" },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  lastUpdated: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderTopWidth: 0.5,
    borderTopColor: "#e2e8f0",
    paddingVertical: 6,
  },
  loadingText: { fontSize: 13, color: "#66778f" },

  subHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e2e8f0",
  },
  subHeaderLabel: {
    flex: 1,
    fontSize: 12,
    color: "#94a3b8",
    fontWeight: "500",
  },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#eff6ff",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  filterBtnActive: { backgroundColor: "#035faa" },
  filterBtnText: { fontSize: 12, fontWeight: "600", color: "#035faa" },
  groupBtn: {
    backgroundColor: "#eff6ff",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 140,
    minWidth: 70,
  },
  groupBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
  },
  groupBtnText: {
    color: "#035faa",
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 1,
    flexGrow: 0,
  },

  filterHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  clearAllText: { fontSize: 13, color: "#dc2626", fontWeight: "600" },
  filterLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  timePickerLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
    marginBottom: 6,
  },

  filterDropdown: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: "#e2e8f0",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  filterDropdownText: { flex: 1, fontSize: 14, color: "#0f172a" },

  hourScroll: { gap: 6, paddingVertical: 2 },
  hourChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
  },
  hourChipActive: { backgroundColor: "#035faa", borderColor: "#035faa" },
  hourChipDisabled: {
    backgroundColor: "#f1f5f9",
    borderColor: "#f1f5f9",
    opacity: 0.5,
  },
  hourChipText: { fontSize: 12, color: "#64748b", fontWeight: "500" },
  hourChipTextActive: { color: "#fff", fontWeight: "600" },
  hourChipTextDisabled: { color: "#cbd5e1" },

  selectedRangeWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#eff6ff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 12,
  },
  selectedRangeText: {
    flex: 1,
    fontSize: 13,
    color: "#035faa",
    fontWeight: "500",
  },

  applyBtn: {
    marginTop: 20,
    backgroundColor: "#035faa",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  applyBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  clearBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#035faa",
  },
  clearBtnText: { color: "#035faa", fontWeight: "600", fontSize: 13 },

  body: { padding: 10, gap: 10 },

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: "#e2e8f0",
    padding: 12,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  cardTitle: { fontSize: 13, fontWeight: "700", color: "#0f172a" },

  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 9,
    borderBottomWidth: 0.5,
    borderBottomColor: "#f1f5f9",
  },
  recentDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#035faa",
    flexShrink: 0,
  },
  recentName: { fontSize: 12, fontWeight: "700", color: "#0f172a" },
  recentCam: { fontWeight: "400", color: "#64748b" },
  recentDesc: { fontSize: 11, color: "#66778f", marginTop: 2 },
  recentThumb: { width: 40, height: 40, borderRadius: 7, flexShrink: 0 },
  recentThumbEmpty: {
    width: 40,
    height: 40,
    borderRadius: 7,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  moreText: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: "700",
    color: "#035faa",
    paddingTop: 10,
  },

  sectionHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#0f172a" },

  camRow: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: "#e2e8f0",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    marginHorizontal: 10,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.04,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
      },
      android: { elevation: 1 },
    }),
  },
  camIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#eff6ff",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  camName: { fontSize: 12, fontWeight: "700", color: "#035faa" },
  camCount: { fontSize: 10, color: "#66778f", marginTop: 1 },
  peakWrap: { alignItems: "center", paddingHorizontal: 4 },
  peakLbl: { fontSize: 9, color: "#66778f" },
  peakVal: { fontSize: 12, fontWeight: "700", color: "#0f172a" },
  viewBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#035faa",
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderRadius: 8,
    flexShrink: 0,
  },
  viewBtnText: { fontSize: 11, fontWeight: "700", color: "#fff" },

  empty: { marginTop: 48, alignItems: "center", gap: 8, paddingHorizontal: 32 },
  emptyText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#64748b",
    textAlign: "center",
  },
  emptySubText: { fontSize: 13, color: "#66778f", textAlign: "center" },

  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
    maxHeight: "70%",
  },
  pickerHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#e2e8f0",
    alignSelf: "center",
    marginBottom: 16,
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 8,
  },
  pickerEmpty: {
    fontSize: 13,
    color: "#66778f",
    paddingVertical: 16,
    textAlign: "center",
  },
  pickerSelectAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e2e8f0",
    marginBottom: 4,
  },
  pickerSelectAllText: { fontSize: 14, fontWeight: "600", color: "#035faa" },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 13,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#f1f5f9",
    borderRadius: 8,
  },
  pickerItemActive: { backgroundColor: "#eff6ff" },
  pickerItemText: { flex: 1, fontSize: 14, color: "#334155" },
  pickerItemActiveText: { color: "#035faa", fontWeight: "600" },
  pickerDone: {
    marginTop: 14,
    backgroundColor: "#035faa",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  pickerDoneText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalImage: { width: width - 40, height: width - 40, borderRadius: 8 },
  modalClose: {
    position: "absolute",
    top: 50,
    right: 20,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
});
