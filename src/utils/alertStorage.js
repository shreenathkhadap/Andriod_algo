import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { DeviceEventEmitter } from "react-native";
import { getDb, sqlLog } from "./db";
import { withKeyLock } from "./keyLock";

// expo-sqlite's withTransactionAsync doesn't queue concurrent calls on the
// same connection — a second transaction started while one's already
// running on this shared getDb() connection fails outright ("cannot start
// a transaction within a transaction") instead of waiting its turn. Real
// trigger: a push arrives (saveIncomingAlert) while a periodic sync
// (insertAlerts, or several groups' syncGroupAlerts running concurrently
// via Promise.all in syncAllGroupAlerts) already has a transaction open.
// Every transaction in this file goes through this one lock so only one
// ever runs against the connection at a time.
const SQLITE_TXN_LOCK = "sqlite-txn";

export const ALERTS_KEY_PREFIX = "aksha_alerts_";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const GROUPS_API_URL =
  "https://hbzo58z4zk.execute-api.ap-south-1.amazonaws.com/prod/mobile/get-groups";
const ALERTS_API_URL =
  "https://hbzo58z4zk.execute-api.ap-south-1.amazonaws.com/prod/mobile/alerts";

// Server pages at this size per request. Kept well under the Lambda's own
// hard cap (100) — this is the app asking for the next chunk, not "give me
// everything."
const PAGE_LIMIT = 100;

// Safety cap on the per-group pagination loop, mirroring the Lambda's own
// MAX_PAGES. At 24h retention + PAGE_LIMIT=100, a group would need 2,400+
// alerts still unsynced to ever hit this — this only exists so a stuck
// `hasMore` or a misbehaving client state can't turn one sync into an
// infinite loop.
const MAX_SYNC_PAGES = 20;

// ── Timestamp / mapping helpers ─────────────────────────────────────────────

export const normalizeTimestamp = (raw) => {
  if (!raw) return null;
  let s = String(raw).trim();
  if (/Z$|[+-]\d{2}:\d{2}$/.test(s)) return s;
  if (s.includes(" ") && !s.includes("T")) s = s.replace(" ", "T");
  s = s.replace(/\.(\d+)$/, (_, frac) => `.${frac.slice(0, 3).padEnd(3, "0")}`);
  return `${s}Z`;
};

export const normalizeServerAlert = (a, group) => ({
  id: a.alertId ?? `${a.groupId}_${a.incidentTime}`,
  groupId: a.groupId ?? group.id,
  groupName: a.data?.groupName ?? group.name ?? "",
  cameraName: a.cameraName ?? a.data?.cameraName ?? "",
  alertName: a.data?.alertName ?? "",
  alertDescription: a.data?.alertDescription ?? "",
  incidentTime: a.incidentTime ?? "",
  imageUrl: a.data?.imageUrl ?? "",
  receivedAt: normalizeTimestamp(a.createdAt) ?? new Date().toISOString(),
});

export const mergeAlertLists = (prev, fresh) => {
  const prevList = prev ?? [];
  const freshList = fresh ?? [];
  const freshKeys = new Set(
    freshList.map((a) => `${a.incidentTime}_${a.cameraName}`),
  );
  const onlyInPrev = prevList.filter(
    (a) => !freshKeys.has(`${a.incidentTime}_${a.cameraName}`),
  );
  return [...freshList, ...onlyInPrev];
};

// ── SQLite row <-> alert object mapping ────────────────────────────────────

const rowToAlert = (row) => ({
  id: row.id,
  groupId: row.group_id,
  groupName: row.group_name ?? "",
  cameraName: row.camera_name ?? "",
  alertName: row.alert_name ?? "",
  alertDescription: row.alert_description ?? "",
  incidentTime: row.incident_time ?? "",
  imageUrl: row.image_url ?? "",
  receivedAt: row.received_at,
});

const insertAlerts = async (alerts, context = "") => {
  if (!alerts.length) {
    sqlLog.info(
      `insertAlerts${context ? ` (${context})` : ""}: 0 alerts to insert, skipping`,
    );
    return;
  }
  await sqlLog.time(
    `insertAlerts${context ? ` (${context})` : ""} — ${alerts.length} candidate row(s)`,
    () =>
      withKeyLock(SQLITE_TXN_LOCK, async () => {
        const db = await getDb();
        const before = await db.getFirstAsync(
          "SELECT COUNT(*) as count FROM camera_events",
        );

        await db.withTransactionAsync(async () => {
          for (const a of alerts) {
            const ms = new Date(a.receivedAt ?? a.incidentTime).getTime();
            // Dedupes on `id` (a repeat sync re-fetching the same server alert)
            // AND on the (group, camera, incidentTime) triple — the real-world
            // identity of an alert. Without the triple check, a push-triggered
            // row from saveIncomingAlert (locally-generated id) and the SAME
            // alert arriving later here via syncGroupAlerts (real server
            // alertId) both pass an id-only check and insert as two rows —
            // this is what was inflating "alerts in the last 24h" counts well
            // beyond the real total.
            await db.runAsync(
              `INSERT INTO camera_events
             (id, group_id, group_name, camera_name, alert_name, alert_description, incident_time, image_url, received_at, received_at_ms)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM camera_events
             WHERE id = ? OR (group_id = ? AND camera_name = ? AND incident_time = ?)
           )`,
              [
                a.id,
                a.groupId,
                a.groupName,
                a.cameraName,
                a.alertName,
                a.alertDescription,
                a.incidentTime,
                a.imageUrl,
                a.receivedAt,
                Number.isFinite(ms) ? ms : Date.now(),
                a.id,
                a.groupId,
                a.cameraName,
                a.incidentTime,
              ],
            );
          }
        });

        const after = await db.getFirstAsync(
          "SELECT COUNT(*) as count FROM camera_events",
        );
        const inserted = (after?.count ?? 0) - (before?.count ?? 0);
        sqlLog.info(
          `insertAlerts${context ? ` (${context})` : ""}: ${inserted} new row(s) written, ${alerts.length - inserted} duplicate(s) skipped, table now has ${after?.count ?? "?"} row(s)`,
        );

        // Previously only saveIncomingAlert (the push-notification path) ever
        // emitted this — a screen's own periodic syncGroupAlerts pulling in new
        // alerts from the server never told any OTHER mounted screen about it,
        // so each screen only caught up whenever its OWN independent 30s
        // poll/focus/resume trigger happened to fire next. That's why different
        // pages could show different counts for up to that long: they were all
        // reading the same SQLite table, just at different, uncoordinated
        // moments. One emit per affected group here means every mounted screen
        // refreshes together, right when the data that changed it actually
        // landed — regardless of which screen's own poll triggered the sync.
        if (inserted > 0) {
          const groupIds = new Set(alerts.map((a) => a.groupId));
          for (const groupId of groupIds) {
            const sample = [...alerts]
              .reverse()
              .find((a) => a.groupId === groupId);
            DeviceEventEmitter.emit("aksha_new_alert", {
              groupId,
              cameraName: sample?.cameraName,
              receivedAt: sample?.receivedAt,
            });
          }
        }
      }),
  );
};

export const readAllCachedAlerts = async () => {
  return sqlLog.time("readAllCachedAlerts", async () => {
    const db = await getDb();
    const rows = await db.getAllAsync(
      "SELECT * FROM camera_events ORDER BY received_at_ms DESC",
    );
    sqlLog.info(`readAllCachedAlerts: returned ${rows.length} row(s)`);
    return rows.map(rowToAlert);
  });
};

const normalizeKpiTimestamp = (value) => {
  const text = String(value ?? "")
    .trim()
    .replace(" ", "T");
  return text
    .replace(/Z$/, "")
    .replace(/[+-]\d{2}:?\d{2}$/, "")
    .replace(/\.\d+$/, "");
};

const formatKpiDateTime = (milliseconds) => {
  const date = new Date(milliseconds);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const toKpiRow = (row) => ({
  record_id: row.record_id,
  camera_id: row.camera_id,
  timestamp: row.timestamp,
  object_label: row.object_label,
  object_count: row.object_count,
  frame_link: row.frame_link,
});

const mergeRanges = (ranges) => {
  const merged = [];
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
};

export const initializeKpiDatabase = async () => getDb();

export const getCachedCoverage = async (cameraId, from, to) => {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT window_start, window_end
     FROM kpi_cache_windows
     WHERE camera_id = ? AND window_end > ? AND window_start < ?
     ORDER BY window_start`,
    [cameraId, from, to],
  );
  return mergeRanges(
    rows.map((row) => ({
      start: Math.max(Date.parse(row.window_start), Date.parse(from)),
      end: Math.min(Date.parse(row.window_end), Date.parse(to)),
    })),
  );
};

export const findMissingKpiRanges = async (cameraId, from, to) => {
  const coverage = await getCachedCoverage(cameraId, from, to);
  const missing = [];
  let cursor = Date.parse(from);
  const requestedEnd = Date.parse(to);
  for (const range of coverage) {
    if (range.start > cursor) missing.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < requestedEnd) missing.push({ start: cursor, end: requestedEnd });
  return missing.map((range) => ({
    from: formatKpiDateTime(range.start),
    to: formatKpiDateTime(range.end),
  }));
};

export const fetchKpiRangeFromApi = async ({
  camera,
  from,
  to,
  token = null,
  apiUrl = null,
}) => {
  const gatewayUrl = process.env.EXPO_PUBLIC_GATEWAY_URL || "";
  const endpoint =
    apiUrl ||
    process.env.EXPO_PUBLIC_KPI_REPORT_URL ||
    `${gatewayUrl}/api/android/kpi-report`;
  const response = await axios.post(
    endpoint,
    { camera, from, to },
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 60000,
    },
  );
  if (
    response.data?.success !== true ||
    !Array.isArray(response.data?.report)
  ) {
    throw new Error("KPI API returned an invalid report");
  }
  return response.data;
};

export const parseKpiApiResponse = (response) =>
  response.report.flatMap((cameraReport) => {
    const cameraId = String(cameraReport.camera_name ?? "").trim();
    if (!cameraId) return [];
    return (cameraReport.records ?? []).flatMap((record) => {
      const timestamp = normalizeKpiTimestamp(record.timestamp);
      if (!timestamp) return [];
      const counts =
        record.counts && typeof record.counts === "object" ? record.counts : {};
      const entries = Object.entries(counts);
      return (entries.length ? entries : [["unknown", 0]]).map(
        ([objectLabel, count]) => ({
          camera_id: cameraId,
          timestamp,
          object_label: String(objectLabel),
          object_count: Math.max(0, Number(count) || 0),
          frame_link: record.frame_link ?? null,
        }),
      );
    });
  });

export const upsertKpiRecords = async (records) => {
  if (!records.length) return;
  await withKeyLock(SQLITE_TXN_LOCK, async () => {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      for (const record of records) {
        await db.runAsync(
          `INSERT INTO kpi_records
             (camera_id, timestamp, object_label, object_count, frame_link)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(camera_id, timestamp, object_label) DO UPDATE SET
             object_count = excluded.object_count,
             frame_link = excluded.frame_link`,
          [
            record.camera_id,
            record.timestamp,
            record.object_label,
            record.object_count,
            record.frame_link,
          ],
        );
      }
    });
  });
};

export const markKpiWindowCached = async (cameraId, from, to) => {
  await withKeyLock(SQLITE_TXN_LOCK, async () => {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO kpi_cache_windows (camera_id, window_start, window_end)
       VALUES (?, ?, ?)`,
      [cameraId, from, to],
    );
  });
};

export const getKpiRecordsByRange = async (cameras, from, to) => {
  const db = await getDb();
  const placeholders = cameras.map(() => "?").join(", ");
  const rows = await db.getAllAsync(
    `SELECT record_id, camera_id, timestamp, object_label, object_count, frame_link
     FROM kpi_records
     WHERE camera_id IN (${placeholders}) AND timestamp >= ? AND timestamp <= ?
     ORDER BY timestamp DESC, camera_id, object_label`,
    [...cameras, from, to],
  );
  return rows.map(toKpiRow);
};

export const cleanupOldKpiRecords = async (requestedEnd) => {
  const cutoff = formatKpiDateTime(Date.parse(requestedEnd) - ONE_DAY_MS);
  await withKeyLock(SQLITE_TXN_LOCK, async () => {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      const windows = await db.getAllAsync(
        "SELECT camera_id, window_start, window_end FROM kpi_cache_windows WHERE window_end > ? AND window_start < ?",
        [cutoff, requestedEnd],
      );
      await db.runAsync(
        "DELETE FROM kpi_records WHERE timestamp < ? OR timestamp > ?",
        [cutoff, requestedEnd],
      );
      await db.runAsync("DELETE FROM kpi_cache_windows");
      for (const window of windows) {
        const start =
          window.window_start < cutoff ? cutoff : window.window_start;
        const end =
          window.window_end > requestedEnd ? requestedEnd : window.window_end;
        if (start < end) {
          await db.runAsync(
            "INSERT OR REPLACE INTO kpi_cache_windows (camera_id, window_start, window_end) VALUES (?, ?, ?)",
            [window.camera_id, start, end],
          );
        }
      }
    });
  });
};

export const syncKpiRange = async ({
  camera,
  from,
  to,
  token = null,
  apiUrl = null,
}) => {
  const missing = await findMissingKpiRanges(camera, from, to);
  for (const range of missing) {
    const response = await fetchKpiRangeFromApi({
      camera,
      ...range,
      token,
      apiUrl,
    });
    await upsertKpiRecords(parseKpiApiResponse(response));
    await markKpiWindowCached(camera, range.from, range.to);
  }
  return missing;
};

export const getKpiReport = async ({
  cameras,
  from,
  to,
  token = null,
  apiUrl = null,
}) => {
  if (!Array.isArray(cameras) || cameras.length === 0)
    throw new Error("Select at least one camera");
  if (Date.parse(to) <= Date.parse(from))
    throw new Error("KPI range must have a valid end time");
  if (Date.parse(to) - Date.parse(from) > ONE_DAY_MS)
    throw new Error("KPI reports support a maximum 24-hour range");

  try {
    for (const camera of cameras)
      await syncKpiRange({ camera, from, to, token, apiUrl });
  } catch (error) {
    const complete = await Promise.all(
      cameras.map(
        async (camera) =>
          (await findMissingKpiRanges(camera, from, to)).length === 0,
      ),
    );
    if (!complete.every(Boolean)) throw error;
  }

  await cleanupOldKpiRecords(to);
  return getKpiRecordsByRange(cameras, from, to);
};

export const listKpiCameras = async () => {
  const db = await getDb();
  const rows = await db.getAllAsync(
    "SELECT DISTINCT camera_id FROM kpi_records ORDER BY camera_id",
  );
  return rows.map((row) => row.camera_id);
};

const pruneOldAlerts = async () => {
  await sqlLog.time("pruneOldAlerts", async () => {
    const db = await getDb();
    const cutoff = Date.now() - ONE_DAY_MS;
    const result = await db.runAsync(
      "DELETE FROM camera_events WHERE received_at_ms < ?",
      [cutoff],
    );
    sqlLog.info(
      `pruneOldAlerts: removed ${result.changes} row(s) older than 24h`,
    );
  });
};

// Collapses rows that are already duplicated under the old id-only dedupe
// (a push-inserted row and its later server-synced counterpart, both for
// the same real alert) — insertAlerts' triple check only stops *new*
// duplicates, it can't undo ones already written before that check existed.
// Runs on every sync alongside pruneOldAlerts so it self-heals regardless
// of when a device last opened the app, keeping the row with the lowest
// rowid (earliest inserted) per (group, camera, incidentTime).
const dedupeExistingAlerts = async () => {
  await sqlLog.time("dedupeExistingAlerts", () =>
    withKeyLock(SQLITE_TXN_LOCK, async () => {
      const db = await getDb();
      const result = await db.runAsync(`
      DELETE FROM camera_events
      WHERE rowid NOT IN (
        SELECT MIN(rowid) FROM camera_events
        GROUP BY group_id, camera_name, incident_time
      )
    `);
      if (result.changes) {
        sqlLog.info(
          `dedupeExistingAlerts: removed ${result.changes} duplicate row(s)`,
        );
      }
    }),
  );
};

const pruneOrphanedGroupAlerts = async (validGroupIds) => {
  if (validGroupIds.size === 0) {
    sqlLog.warn("pruneOrphanedGroupAlerts: validGroupIds is empty, skipping");
    return;
  }
  try {
    await sqlLog.time("pruneOrphanedGroupAlerts", async () => {
      const db = await getDb();
      const ids = Array.from(validGroupIds);
      const placeholders = ids.map(() => "?").join(",");
      const result = await db.runAsync(
        `DELETE FROM camera_events WHERE group_id NOT IN (${placeholders})`,
        ids,
      );
      sqlLog.info(`pruneOrphanedGroupAlerts: removed ${result.changes} row(s)`);
    });
  } catch (err) {
    sqlLog.error("pruneOrphanedGroupAlerts failed:", err.message);
  }
};

// ── Cached group list (for instant group count on app open) ───────────────
// Persisted across app restarts, unlike alertStorage's in-memory `lastGroups`
// — lets the group count show the last-known value the instant the app
// opens (via useSharedAlerts.js's bootstrap), before even the fast
// GROUPS_API_URL POST below has had a chance to resolve, then gets silently
// corrected once that call actually lands.
const GROUPS_CACHE_KEY = "aksha_cached_groups";

export const readCachedGroups = async () => {
  try {
    const raw = await AsyncStorage.getItem(GROUPS_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const setCachedGroups = async (groups) => {
  try {
    await AsyncStorage.setItem(GROUPS_CACHE_KEY, JSON.stringify(groups));
  } catch (err) {
    sqlLog.warn(`failed to persist cached groups: ${err.message}`);
  }
};

// ── Per-group sync cursor (tiny values — NOT the alert payloads) ──────────
// Kept in AsyncStorage deliberately: this is exactly the kind of small,
// rarely-changing value AsyncStorage is actually good for.
const LAST_SYNCED_PREFIX = "aksha_last_synced_";

const getLastSyncedAt = async (groupId) => {
  try {
    return await AsyncStorage.getItem(`${LAST_SYNCED_PREFIX}${groupId}`);
  } catch {
    return null;
  }
};

const setLastSyncedAt = async (groupId, iso) => {
  try {
    await AsyncStorage.setItem(`${LAST_SYNCED_PREFIX}${groupId}`, iso);
  } catch (err) {
    sqlLog.warn(
      `failed to persist lastSyncedAt for group ${groupId}: ${err.message}`,
    );
  }
};

// Clamps the sync cursor to a hard 24h floor. Two cases this matters for:
//   - No stored cursor at all (fresh install / first login) — without the
//     clamp this would sync the group's ENTIRE history instead of just the
//     last 24h, e.g. if TTL hasn't cleaned up old rows yet.
//   - A stored cursor older than 24h (device offline a long time) — clamps
//     the backfill to the last 24h rather than pulling everything since a
//     stale cursor, matching the table's own 24h retention window.
// The Lambda enforces this same floor independently, so this is belt-and-
// suspenders — but doing it here too means the app never even asks for
// anything older, rather than asking and having the server discard it.
// Normalizes `stored` before comparing — it was persisted from the
// server's raw createdAt (see syncGroupAlerts below), which sometimes omits
// a timezone or uses a space instead of "T" (the exact reason
// normalizeTimestamp exists). An un-normalized cursor can lexicographically
// compare as "older" than `cutoff` even when it's actually newer, silently
// resetting every sync back to the 24h floor and — for a group whose 24h
// volume exceeds MAX_SYNC_PAGES * PAGE_LIMIT — permanently stalling it on
// the oldest slice of the window, never reaching new alerts.
const getEffectiveSince = async (groupId) => {
  const stored = normalizeTimestamp(await getLastSyncedAt(groupId));
  const cutoff = new Date(Date.now() - ONE_DAY_MS).toISOString();
  if (!stored) return cutoff;
  return stored > cutoff ? stored : cutoff;
};

// Fetches one group's alerts, walking BACKWARD in time from "now" (the
// Lambda's `before` mode) rather than forward from the last cursor. Each
// page is inserted into SQLite immediately, newest page first — so the
// freshest alerts are visible right away instead of waiting behind however
// much older backlog happens to exist between the last cursor and now.
//
// The persisted sync cursor (getEffectiveSince/setLastSyncedAt) is only
// ADVANCED once this walk actually reaches it (or the server reports
// hasMore=false) — i.e. once every alert between the old cursor and the
// `now` this sync started at has been fetched. If MAX_SYNC_PAGES is hit
// first, the cursor is left untouched: the next sync just walks backward
// from a new "now" again, re-fetching (harmlessly deduped by insertAlerts)
// down to the same still-unreached floor, rather than risking a gap.
export const syncGroupAlerts = async (group, token) => {
  if (!group?.id) return;
  const url = `${ALERTS_API_URL}/${group.id}`;

  const since = await getEffectiveSince(group.id);
  const syncStartedAt = new Date().toISOString();
  let before = syncStartedAt;
  let page = 0;
  let totalInserted = 0;
  let reachedSince = false;

  try {
    while (page < MAX_SYNC_PAGES) {
      page += 1;
      const params = { limit: PAGE_LIMIT, before };

      sqlLog.info(
        `syncGroupAlerts: GET ${url} page=${page} before=${before} since=${since}`,
      );
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      // Without a timeout, a stalled request (weak signal, captive portal,
      // etc.) hangs forever instead of rejecting — which never lets this
      // catch below run, so syncInFlight/syncAllGroupAlerts' `finally` never
      // fires either, permanently wedging every screen's refresh() (and
      // `lastUpdated`) behind this one stuck request until the app is fully
      // killed and relaunched.
      const res = await axios.get(url, { headers, params, timeout: 15000 });

      const serverAlerts = res.data?.alerts ?? [];
      const hasMore = !!res.data?.hasMore;
      sqlLog.info(
        `syncGroupAlerts: group=${group.id} page=${page} alerts=${serverAlerts.length} hasMore=${hasMore}`,
      );

      if (serverAlerts.length === 0) {
        reachedSince = true;
        break;
      }

      const normalized = serverAlerts.map((a) =>
        normalizeServerAlert(a, group),
      );
      await insertAlerts(normalized, `group ${group.id} page ${page}`);
      totalInserted += normalized.length;

      // Backward mode returns pages sorted descending by createdAt (see
      // getAlerts Lambda) — the last item here is the OLDEST in this page,
      // i.e. how far back we've walked so far. Normalized before use as the
      // next page's `before` param — see getEffectiveSince for why an
      // un-normalized cursor is self-defeating.
      const oldestRaw = serverAlerts[serverAlerts.length - 1];
      const oldestNormalized = oldestRaw?.createdAt
        ? normalizeTimestamp(oldestRaw.createdAt)
        : null;

      if (!hasMore || (oldestNormalized && oldestNormalized <= since)) {
        reachedSince = true;
        break;
      }

      if (oldestNormalized) before = oldestNormalized;

      if (page === MAX_SYNC_PAGES) {
        sqlLog.warn(
          `syncGroupAlerts: group ${group.id} hit MAX_SYNC_PAGES=${MAX_SYNC_PAGES} before reaching since=${since} — will restart the backward walk from a fresh "now" on the next sync`,
        );
      }
    }

    if (reachedSince) {
      await setLastSyncedAt(group.id, syncStartedAt);
    }
    sqlLog.info(
      `syncGroupAlerts: group ${group.id} done — ${page} page(s) fetched, ${totalInserted} alert(s) inserted total, cursorAdvanced=${reachedSince}`,
    );
  } catch (err) {
    sqlLog.error(
      `syncGroupAlerts FAILED for group ${group?.id}: page=${page} status=${err?.response?.status} message=${err.message}`,
    );
  }
};

// Saves one push-notification-triggered alert (backgroundTask.js) straight
// into SQLite — the background task has no auth token, so it can't go
// through syncGroupAlerts' authenticated fetch. Dedupes on
// (group, camera, incidentTime) rather than `id`, since the id here is
// locally generated (a real server alertId isn't known yet) and would
// never collide with itself on a redelivered/retried push the way
// insertAlerts' id-based INSERT OR IGNORE does for server-synced rows.
// Returns the saved alert, or null if it was a duplicate.
export const saveIncomingAlert = async (data) => {
  if (!data?.groupId) return null;

  const newAlert = {
    id: `${data.groupId}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    groupId: data.groupId ?? "",
    groupName: data.groupName ?? "",
    cameraName: data.cameraName ?? "",
    alertName: data.alertName ?? "",
    alertDescription: data.alertDescription ?? "",
    incidentTime: data.incidentTime ?? new Date().toISOString(),
    imageUrl: data.imageUrl ?? "",
    receivedAt: new Date().toISOString(),
  };

  return sqlLog.time("saveIncomingAlert", () =>
    withKeyLock(SQLITE_TXN_LOCK, async () => {
      const db = await getDb();
      let saved = false;

      await db.withTransactionAsync(async () => {
        const dup = await db.getFirstAsync(
          "SELECT 1 FROM camera_events WHERE group_id = ? AND camera_name = ? AND incident_time = ? LIMIT 1",
          [newAlert.groupId, newAlert.cameraName, newAlert.incidentTime],
        );
        if (dup) {
          sqlLog.info(
            `saveIncomingAlert: duplicate skipped (${newAlert.incidentTime})`,
          );
          return;
        }

        const ms = new Date(newAlert.receivedAt).getTime();
        await db.runAsync(
          `INSERT OR IGNORE INTO camera_events
           (id, group_id, group_name, camera_name, alert_name, alert_description, incident_time, image_url, received_at, received_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newAlert.id,
            newAlert.groupId,
            newAlert.groupName,
            newAlert.cameraName,
            newAlert.alertName,
            newAlert.alertDescription,
            newAlert.incidentTime,
            newAlert.imageUrl,
            newAlert.receivedAt,
            Number.isFinite(ms) ? ms : Date.now(),
          ],
        );
        saved = true;
      });

      return saved ? newAlert : null;
    }),
  );
};

let syncInFlight = null;
let lastGroups = [];

// `onGroupsFetched`, if given, fires the instant the group list itself comes
// back — a single fast POST — rather than callers having to wait for the
// full return value below, which only resolves once EVERY group's alerts
// have also finished paginating in. Without this, a caller that only cares
// about the group list/count (e.g. the Home screen's group count) was stuck
// showing nothing until the slowest group's entire alert backlog synced,
// even though the groups themselves were known almost instantly.
export const syncAllGroupAlerts = async (
  { mobileId, token } = {},
  onGroupsFetched,
) => {
  if (syncInFlight) {
    sqlLog.info("syncAllGroupAlerts: already in flight, piggybacking");
    return syncInFlight;
  }
  syncInFlight = sqlLog.time("syncAllGroupAlerts (full sync)", async () => {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      // Same reasoning as syncGroupAlerts' GET — no timeout means a stalled
      // request hangs forever instead of rejecting, wedging syncInFlight
      // (and every screen's refresh()) until the app is force-killed.
      const res = await axios.post(
        GROUPS_API_URL,
        { mobileId },
        { headers, timeout: 15000 },
      );
      const groups = res.data?.groups ?? [];
      sqlLog.info(`syncAllGroupAlerts: syncing ${groups.length} group(s)`);
      onGroupsFetched?.(groups);
      // Fire-and-forget — persisted for NEXT app open's instant seed, not
      // needed for anything in this sync cycle, so it shouldn't hold up the
      // per-group alert pagination below.
      setCachedGroups(groups);

      await Promise.all(groups.map((g) => syncGroupAlerts(g, token)));
      await pruneOrphanedGroupAlerts(new Set(groups.map((g) => g.id)));
      await pruneOldAlerts();
      await dedupeExistingAlerts();

      lastGroups = groups;
      return groups;
    } catch (err) {
      sqlLog.error("syncAllGroupAlerts failed:", err.message);
      return lastGroups;
    } finally {
      syncInFlight = null;
    }
  });
  return syncInFlight;
};

// ── One-time migration from the old AsyncStorage-based cache ──────────────
const MIGRATION_DONE_KEY = "aksha_sqlite_migration_done";

export const migrateAsyncStorageAlertsToSQLite = async () => {
  try {
    const already = await AsyncStorage.getItem(MIGRATION_DONE_KEY);
    if (already) {
      sqlLog.info("migration: already done, skipping");
      return;
    }

    await sqlLog.time("migrateAsyncStorageAlertsToSQLite", async () => {
      const allKeys = await AsyncStorage.getAllKeys();
      const alertKeys = allKeys.filter((k) => k.startsWith(ALERTS_KEY_PREFIX));
      sqlLog.info(`migration: found ${alertKeys.length} legacy key(s)`);

      if (alertKeys.length > 0) {
        const entries = await AsyncStorage.multiGet(alertKeys);
        const all = [];
        for (const [, raw] of entries) if (raw) all.push(...JSON.parse(raw));
        await insertAlerts(all, "migration");
        await AsyncStorage.multiRemove(alertKeys);
      }
      await AsyncStorage.setItem(MIGRATION_DONE_KEY, "true");
    });
  } catch (err) {
    sqlLog.error("migration failed:", err.message);
  }
};
