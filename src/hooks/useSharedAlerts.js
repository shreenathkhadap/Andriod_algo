import { useCallback, useSyncExternalStore } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { readAllCachedAlerts, readCachedGroups, syncAllGroupAlerts } from '../utils/alertStorage';

// Single shared alerts store, read by every alert screen (Home, Monitor,
// Investigate, Notifications, Alert Report) instead of each keeping its own
// separate useCachedFetch instance with its own cache key. Previously, one
// sync only ever updated the ONE screen that triggered it — every other
// mounted screen had to wait for its OWN independent poll/focus/resume
// trigger to notice anything changed, which is why different pages could
// show different alert counts and different "last updated" times for up to
// ~30s at a time. With one shared piece of state, a sync from ANY trigger
// updates it once and every screen using this hook re-renders from that
// SAME result together — no per-screen catch-up lag.
//
// Uses useSyncExternalStore (not a manual useState+useEffect subscription)
// specifically because multiple screens read this store simultaneously —
// it's the API React ships for exactly that "many components, one external
// mutable source" case, and avoids the tearing/inconsistent-snapshot bugs a
// hand-rolled subscription can hit under concurrent rendering.
let state = {
  alerts: [],
  groups: [],
  loading: true,
  // Distinct from `loading`: `loading` flips false the moment the FIRST
  // incremental page of the FIRST group lands (reloadFromDb runs per-page,
  // see syncGroupAlerts), which is too early to mean "done" for a
  // multi-group / multi-page catch-up sync. `initialSyncing` instead stays
  // true for this app session until the very first full refreshSharedAlerts()
  // CYCLE (every group, every page) actually resolves, then never flips back
  // — used to keep "Syncing…" showing for the whole app-open load instead of
  // clearing after just the first chunk of data.
  initialSyncing: true,
  refreshing: false,
  error: null,
  lastUpdated: null,
};
const listeners = new Set();

const setState = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => state;

// Credentials don't vary per-screen (same logged-in user everywhere), so
// the module-level triggers below (AppState resume, 15s poll, new-alert
// event) — none of which are tied to any particular mounted screen — reuse
// whatever the most recently rendered hook call last provided.
let lastCreds = { mobileId: undefined, token: undefined };

let inFlight = null;
// Whether ANY caller of the currently-running inFlight sync wants the
// "Syncing…" indicator shown — NOT just whichever caller happened to start
// it. Without this, a visible call (pull-to-refresh, app resume) that
// arrives while a silent 15s poll is already mid-flight would piggyback on
// that same inFlight promise via the early return below and never flip
// `refreshing` at all, since only the ORIGINAL (silent) caller's flag was
// ever consulted — silently swallowing the indicator for the one case it's
// actually meant to show for.
let inFlightVisible = false;
let bootstrapped = false;

// Seeds instantly from whatever's already in SQLite (synced by a previous
// app session) before the first network round-trip resolves, same
// cache-first pattern every screen used individually before. Only runs
// once per app session — subsequent syncs just re-read fresh results in.
const bootstrap = async () => {
  if (bootstrapped) return;
  bootstrapped = true;
  try {
    const seed = await readAllCachedAlerts();
    if (seed.length > 0) setState({ alerts: seed, loading: false });
  } catch {
    // Fall through to the real sync below regardless — bootstrap seeding
    // is purely a "show something instantly" optimization, never a
    // precondition for the actual fetch to proceed.
  }
  try {
    // Same instant-seed idea as alerts above, but for the group list/count
    // (e.g. Home screen's "N groups") — shows the last-known value before
    // even the fast get-groups POST in syncAllGroupAlerts has resolved, then
    // gets silently corrected once that call actually lands.
    const cachedGroups = await readCachedGroups();
    if (cachedGroups.length > 0) setState({ groups: cachedGroups });
  } catch {
    // Same as above — falls through to the real fetch regardless.
  }
};

// Cheap local re-read (no network) — readAllCachedAlerts() always returns
// the FULL current table, so there's nothing to merge, just replace.
// Deliberately NOT gated by `inFlight`: syncGroupAlerts pages through large
// result sets 100 at a time and inserts+emits 'aksha_new_alert' after every
// single page (see alertStorage.js), so this runs many times over the
// course of one refreshSharedAlerts() call — each one pulls in whatever
// just landed. That's what makes a big catch-up sync (e.g. reopening after
// days away, or a group with hundreds of pending alerts) visibly grow the
// on-screen counts/list page by page instead of jumping from old data to
// everything-at-once the moment the whole sync finally finishes.
const reloadFromDb = async () => {
  try {
    const alerts = await readAllCachedAlerts();
    setState({ alerts, loading: false, lastUpdated: Date.now() });
  } catch {
    // A transient read failure here just means this particular incremental
    // tick is skipped — the next page's insert (or the final read below)
    // will catch the store up regardless.
  }
};

// `silent` skips the `refreshing` flag entirely — used by the 15s poll so it
// never pops the "Syncing…" indicator (LastUpdatedLabel) or a screen's own
// empty-state spinner gate (`loading || (refreshing && list.length === 0)`).
// The sync itself still runs and `lastUpdated`/`alerts` still update via
// reloadFromDb() below, so the "Updated Xs ago" text still ticks forward the
// moment the poll lands — only the visible "syncing" state is suppressed.
export const refreshSharedAlerts = (creds = lastCreds, { silent = false } = {}) => {
  lastCreds = creds;
  if (inFlight) {
    // Joining an already-running sync — if THIS caller wants it visible
    // (e.g. a pull-to-refresh landing mid-15s-poll) and nothing visible has
    // claimed it yet, upgrade the already-running sync to show the
    // indicator, even though it started out silent.
    if (!silent && !inFlightVisible) {
      inFlightVisible = true;
      setState({ refreshing: true, error: null });
    }
    return inFlight;
  }
  inFlightVisible = !silent;
  if (!silent) setState({ refreshing: true, error: null });
  inFlight = (async () => {
    try {
      await bootstrap();
      // Sets `groups` as soon as the group list itself comes back, instead
      // of waiting on syncAllGroupAlerts' full return value below — that
      // only resolves once every group's entire alert backlog has also
      // finished paginating in, which is what was leaving the Home screen's
      // group count at 0 for the whole duration of a slow/large alert sync
      // even though the groups themselves were already known.
      const groups = await syncAllGroupAlerts(creds, (fetchedGroups) => setState({ groups: fetchedGroups }));
      await reloadFromDb();
      setState({ groups });
    } catch (err) {
      setState({ error: err });
    } finally {
      // initialSyncing:false is harmless to repeat (state is already false
      // after the first time) — folded into the same patch so this doesn't
      // cost an extra re-render on every subsequent sync.
      const patch = { initialSyncing: false };
      if (inFlightVisible) patch.refreshing = false;
      setState(patch);
      inFlight = null;
      inFlightVisible = false;
    }
  })();
  return inFlight;
};

// Registered once at module load (ES modules are singletons), not per
// mounted screen — five screens each registering their own AppState
// listener/interval would still be harmless (refreshSharedAlerts already
// dedupes concurrent calls via `inFlight`), just redundant. One set of
// triggers here is what actually drives the shared store; each screen only
// adds its own useFocusEffect(refresh) on top, since focus is inherently
// per-screen.
let prevAppState = AppState.currentState;
AppState.addEventListener('change', (nextState) => {
  if (prevAppState.match(/inactive|background/) && nextState === 'active') {
    refreshSharedAlerts();
  }
  prevAppState = nextState;
});

setInterval(() => {
  if (AppState.currentState === 'active') refreshSharedAlerts(undefined, { silent: true });
}, 15000);

// insertAlerts (alertStorage.js) emits this for BOTH the push-notification
// path AND every page of the periodic-sync path whenever it writes
// genuinely new rows. Calling the cheap local reloadFromDb() here (not the
// network-syncing refreshSharedAlerts()) means: a push while nothing else
// is syncing triggers an instant local refresh, AND — since this fires
// per-page — a large in-progress sync updates the shared store
// incrementally as each page lands, not just once at the very end.
DeviceEventEmitter.addListener('aksha_new_alert', () => reloadFromDb());

export default function useSharedAlerts({ mobileId, token } = {}) {
  lastCreds = { mobileId, token };
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  // opts passes straight through to refreshSharedAlerts — callers doing a
  // background revisit (e.g. useFocusEffect on tab switch) pass
  // `{ silent: true }` so it doesn't pop "Syncing…"; a plain refresh() (pull
  // to refresh) keeps the indicator, same as before.
  const refresh = useCallback(
    (opts) => refreshSharedAlerts({ mobileId, token }, opts),
    [mobileId, token]
  );

  return { ...snapshot, refresh };
}
