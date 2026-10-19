import * as SQLite from "expo-sqlite";

// Shared logger for every SQLite operation in alertStorage.js — one prefix
// to filter on in device logs, plus a `.time()` wrapper so slow
// syncs/queries are visible without hand-timing each call site.
const LOG_PREFIX = "[sqlite]";

export const sqlLog = {
  info: (...args) => console.log(LOG_PREFIX, ...args),
  warn: (...args) => console.warn(LOG_PREFIX, ...args),
  error: (...args) => console.warn(LOG_PREFIX, ...args),
  time: async (label, fn) => {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      console.log(`${LOG_PREFIX} ${label} — ${Date.now() - start}ms`);
    }
  },
};

// Single shared connection + one-time schema setup. Every caller awaits the
// same promise, so concurrent callers (multiple screens syncing at once)
// never race to create the table twice.
let dbPromise = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        return await openDb();
      } catch (err) {
        // A failed open/init would otherwise cache this rejected promise
        // forever — every future getDb() call returning the same rejection
        // for the rest of the app session. Clearing it lets the next call
        // retry from scratch instead of permanently poisoning SQLite access.
        dbPromise = null;
        throw err;
      }
    })();
  }
  return dbPromise;
}

// Logs row count + actual on-disk size of the SQLite file (page_count *
// page_size — the standard way to get a database's byte size without
// filesystem access, since expo-sqlite doesn't expose a file-stat API).
export async function logDbStats(context = "") {
  try {
    const db = await getDb();
    const [countRow, pageCountRow, pageSizeRow] = await Promise.all([
      db.getFirstAsync("SELECT COUNT(*) as count FROM camera_events"),
      db.getFirstAsync("PRAGMA page_count"),
      db.getFirstAsync("PRAGMA page_size"),
    ]);
    const bytes =
      (pageCountRow?.page_count ?? 0) * (pageSizeRow?.page_size ?? 0);
    sqlLog.info(
      `logDbStats${context ? ` (${context})` : ""}: ${countRow?.count ?? 0} row(s) in camera_events, db size ~${(bytes / 1024).toFixed(1)} KB`,
    );
  } catch (err) {
    sqlLog.warn(
      `logDbStats${context ? ` (${context})` : ""} failed: ${err.message}`,
    );
  }
}

async function openDb() {
  const db = await SQLite.openDatabaseAsync("aksha.db");

  const existingKpiColumns = await db.getAllAsync(
    "PRAGMA table_info(kpi_records)",
  );
  const hasNewKpiSchema =
    existingKpiColumns.some((column) => column.name === "object_label") &&
    existingKpiColumns.some((column) => column.name === "frame_link");
  if (existingKpiColumns.length && !hasNewKpiSchema) {
    const legacyKpiTable = await db.getFirstAsync(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kpi_records_legacy'`,
    );
    if (!legacyKpiTable) {
      await db.execAsync(
        "ALTER TABLE kpi_records RENAME TO kpi_records_legacy",
      );
    } else {
      await db.execAsync("DROP TABLE kpi_records");
    }
  }

  // WAL mode lets reads (screens querying) and writes (a sync in
  // progress) happen concurrently without blocking each other — the
  // single-biggest reason SQLite doesn't reproduce the AsyncStorage
  // "everything blocks on one big read/write" problem.
  await db.execAsync("PRAGMA journal_mode = WAL;");

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS camera_events (
      id                 TEXT PRIMARY KEY,
      group_id           TEXT NOT NULL,
      group_name         TEXT,
      camera_name        TEXT,
      alert_name         TEXT,
      alert_description  TEXT,
      incident_time      TEXT,
      image_url          TEXT,
      received_at        TEXT NOT NULL,
      received_at_ms     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_received_at_ms ON camera_events(received_at_ms);
    CREATE INDEX IF NOT EXISTS idx_events_group_id        ON camera_events(group_id);
    CREATE INDEX IF NOT EXISTS idx_events_camera_name     ON camera_events(camera_name);
    CREATE TABLE IF NOT EXISTS kpi_records (
      record_id     INTEGER PRIMARY KEY AUTOINCREMENT,
      camera_id     TEXT NOT NULL,
      timestamp     TEXT NOT NULL,
      object_label  TEXT NOT NULL,
      object_count  INTEGER NOT NULL DEFAULT 0,
      frame_link    TEXT,
      created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (camera_id, timestamp, object_label)
    );

    CREATE INDEX IF NOT EXISTS idx_kpi_records_camera_timestamp
      ON kpi_records(camera_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_kpi_records_camera_label_timestamp
      ON kpi_records(camera_id, object_label, timestamp);
    CREATE TABLE IF NOT EXISTS kpi_cache_windows (
      camera_id   TEXT NOT NULL,
      window_start TEXT NOT NULL,
      window_end   TEXT NOT NULL,
      fetched_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (camera_id, window_start, window_end)
    );
    CREATE INDEX IF NOT EXISTS idx_kpi_cache_windows_camera_range
      ON kpi_cache_windows(camera_id, window_start, window_end);
  `);

  return db;
}
