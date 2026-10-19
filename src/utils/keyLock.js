// Generic in-memory keyed mutex. Not tied to any storage backend — used to
// serialize concurrent async work that shares a key (e.g. two notification
// handlers racing on the same in-memory dedupe check).
const queues = new Map();

export const withKeyLock = (key, fn) => {
  const prior = queues.get(key) ?? Promise.resolve();
  const result = prior.then(fn, fn);
  queues.set(key, result.then(() => {}, () => {}));
  return result;
};
