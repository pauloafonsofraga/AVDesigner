// Shared by the classic shell and Engine commands. Snapshot structure must be
// independent, but immutable strings (including inline artwork) can be shared.
(() => {
  if (globalThis.WireNexusHistoryClone) return;

  const MAX_HISTORY_ENTRIES = 30;

  function cloneHistoryValue(value, seen = new WeakMap()) {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);

    if (Array.isArray(value)) {
      const copy = new Array(value.length);
      seen.set(value, copy);
      for (let index = 0; index < value.length; index += 1) {
        if (index in value) copy[index] = cloneHistoryValue(value[index], seen);
      }
      return copy;
    }

    if (value instanceof Map) {
      const copy = new Map();
      seen.set(value, copy);
      value.forEach((entry, key) => copy.set(cloneHistoryValue(key, seen), cloneHistoryValue(entry, seen)));
      return copy;
    }
    if (value instanceof Set) {
      const copy = new Set();
      seen.set(value, copy);
      value.forEach(entry => copy.add(cloneHistoryValue(entry, seen)));
      return copy;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return structuredClone(value);
    const copy = Object.create(prototype);
    seen.set(value, copy);
    for (const key of Object.keys(value)) {
      Object.defineProperty(copy, key, {
        value: cloneHistoryValue(value[key], seen),
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
    return copy;
  }

  globalThis.WireNexusHistoryClone = Object.freeze({ cloneHistoryValue, MAX_HISTORY_ENTRIES });
})();
