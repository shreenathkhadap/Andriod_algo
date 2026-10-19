import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

// Cache-first, refresh-in-background data hook.
//
// The flow this implements:
//   1. On mount (or whenever `key` changes) read whatever is cached under
//      `key` in AsyncStorage and render it immediately, even if stale. This
//      is what lets a screen skip the spinner on every visit after the
//      first — `loading` only reflects "nothing to show yet", not "a fetch
//      is in flight".
//   2. Regardless of whether a cache existed, kick off `fetchFn()` in the
//      background via `refresh()`. It never blocks the UI from painting the
//      cached data first — `refreshing` is what callers should key a small
//      pull-to-refresh/banner indicator off, not `loading`.
//   3. When the fetch resolves, the result is merged into whatever's
//      currently in state with `mergeFn` (defaults to "fresh replaces
//      current" — pass a custom mergeFn when a screen needs to fold fresh
//      data into what's already cached instead of replacing it) and
//      persisted to AsyncStorage alongside a lastUpdatedAt timestamp.
//   4. If the fetch fails, whatever was already on screen (cached or
//      previously fetched) is left untouched — only `error` is set, so the
//      caller can surface a small non-blocking toast instead of clearing
//      the screen.
//
// `key` may be null/undefined to mean "not ready yet" (e.g. waiting on a
// selected group id) — the hook just stays idle until a real key is given.
export default function useCachedFetch(key, fetchFn, { mergeFn, getInitialData } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // fetchFn/mergeFn are recreated every render in most callers (inline
  // arrow functions) — stash the latest in a ref instead of putting them in
  // effect dependency arrays, so we don't re-run the whole bootstrap flow
  // (and re-hit AsyncStorage) on every render.
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;
  const mergeFnRef = useRef(mergeFn);
  mergeFnRef.current = mergeFn;
  const getInitialDataRef = useRef(getInitialData);
  getInitialDataRef.current = getInitialData;

  // Guards against setState after unmount, and against a stale in-flight
  // request (e.g. `key` switched to a different group while a request for
  // the old key was still in flight) clobbering newer state.
  const isMountedRef = useRef(true);
  const requestIdRef = useRef(0);

  // Screens wire refresh() to several independent triggers (AppState resume,
  // a "new alert" event, a polling interval, pull-to-refresh) that can fire
  // within moments of each other. Without this, each trigger would start its
  // own overlapping fetch — every one flips `refreshing` back on, so if the
  // network is ever slower than the gap between triggers, a newer call keeps
  // restarting the spinner before the previous one resolves and it never
  // settles, even though data is already loaded and visible. Tracking the
  // in-flight promise means a trigger that fires while one is already
  // running just piggybacks on it instead of starting a redundant one.
  const inFlightRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const readCache = useCallback(async (forKey) => {
    try {
      const raw = await AsyncStorage.getItem(forKey);
      if (!raw) return null;
      return JSON.parse(raw); // { data, lastUpdatedAt }
    } catch (err) {
      console.warn(`useCachedFetch(${forKey}): failed to read cache`, err);
      return null;
    }
  }, []);

  const writeCache = useCallback(async (forKey, nextData, timestamp) => {
    try {
      await AsyncStorage.setItem(
        forKey,
        JSON.stringify({ data: nextData, lastUpdatedAt: timestamp })
      );
    } catch (err) {
      console.warn(`useCachedFetch(${forKey}): failed to write cache`, err);
    }
  }, []);

  // Runs fetchFn() in the background and reconciles the result into state +
  // cache. Safe to call directly for a manual/pull-to-refresh trigger. If a
  // refresh for this key is already running, returns that same in-flight
  // promise instead of starting an overlapping one.
  const refresh = useCallback(() => {
    if (!key) return Promise.resolve();
    if (inFlightRef.current) return inFlightRef.current;

    const requestId = ++requestIdRef.current;
    const requestKey = key;
    setRefreshing(true);
    setError(null);

    const promise = (async () => {
      try {
        const fresh = await fetchFnRef.current();
        // A newer request (new key, or a key-change bootstrap) started
        // after this one, or the component unmounted — drop this result
        // rather than overwrite fresher state with a stale response.
        if (!isMountedRef.current || requestId !== requestIdRef.current) return;

        setData((prev) => {
          const merged = mergeFnRef.current ? mergeFnRef.current(prev, fresh) : fresh;
          const timestamp = Date.now();
          writeCache(requestKey, merged, timestamp);
          setLastUpdated(timestamp);
          return merged;
        });
      } catch (err) {
        if (!isMountedRef.current || requestId !== requestIdRef.current) return;
        console.warn(`useCachedFetch(${key}): fetch failed`, err?.message ?? err);
        setError(err);
      } finally {
        inFlightRef.current = null;
        if (isMountedRef.current && requestId === requestIdRef.current) {
          setRefreshing(false);
          setLoading(false);
        }
      }
    })();

    inFlightRef.current = promise;
    return promise;
  }, [key, writeCache]);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    // Invalidate any in-flight request tied to the previous key, and drop
    // the dedup reference so the new key's first refresh() isn't mistaken
    // for "already running" because of a leftover promise from the old key.
    requestIdRef.current += 1;
    inFlightRef.current = null;

    // Reset to a clean slate for the new key — otherwise the previous key's
    // data could flash on screen for the instant before the new key's cache
    // read resolves.
    setData(null);
    setError(null);
    setLastUpdated(null);
    setLoading(true);

    const bootstrap = async () => {
      // Step 1: read cache and render immediately, even if stale.
      const cached = await readCache(key);
      if (cancelled) return;

      if (cached) {
        setData(cached.data);
        setLastUpdated(cached.lastUpdatedAt);
        setLoading(false); // something to show — no full-screen spinner
      } else if (getInitialDataRef.current) {
        // This key has never been written before (e.g. the very first run
        // after adopting this hook) but the caller may already have the
        // same data sitting under some other, older local key — read that
        // synchronously (no network) so the first load is still instant
        // instead of blocking on `fetchFn`'s network round-trip.
        try {
          const seed = await getInitialDataRef.current();
          if (!cancelled && seed != null) {
            setData(seed);
            setLoading(false);
          }
        } catch (err) {
          console.warn(`useCachedFetch(${key}): getInitialData failed`, err);
        }
      }
      if (cancelled) return;

      // Step 2: kick off the background fetch regardless. If there was
      // truly nothing to seed from, `loading` stays true (spinner shown)
      // until this resolves — that's the only case a full-screen spinner
      // should appear.
      if (!cancelled) await refresh();
    };

    bootstrap();
    return () => { cancelled = true; };
    // `refresh` is intentionally omitted — it's re-created when `key`
    // changes anyway (it closes over `key`), and including it here would
    // just be re-deriving the same dependency this effect already tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, readCache]);

  return { data, loading, refreshing, error, lastUpdated, refresh };
}
