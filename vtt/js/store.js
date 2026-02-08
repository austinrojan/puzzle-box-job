// ============================================
// VTT Reactive Store — Proxy-based state with subscriptions
//
// Philosophy: state change IS notification.
// Mutating a property automatically calls subscribers.
//
// Future: this pattern maps directly to Zustand's subscribe().
// ============================================

export function createStore(initial) {
  const subscribers = new Map();   // key -> Set<fn(newVal, oldVal)>
  const wildcards = new Set();     // fn(key, newVal, oldVal)

  const data = JSON.parse(JSON.stringify(initial));

  const proxy = new Proxy(data, {
    set(target, key, value) {
      const old = target[key];
      // Skip if primitive hasn't changed.
      // typeof null === 'object', so check explicitly.
      if (old === value && (typeof value !== 'object' || value === null)) return true;

      target[key] = value;

      const fns = subscribers.get(key);
      if (fns) {
        for (const fn of fns) {
          try { fn(value, old); }
          catch (err) { console.error(`[Store] Subscriber error on "${key}":`, err); }
        }
      }

      for (const fn of wildcards) {
        try { fn(key, value, old); }
        catch (err) { console.error('[Store] Wildcard subscriber error:', err); }
      }

      return true;
    },

    get(target, key) {
      return target[key];
    }
  });

  return {
    state: proxy,

    subscribe(key, fn) {
      if (!subscribers.has(key)) subscribers.set(key, new Set());
      subscribers.get(key).add(fn);
      return () => subscribers.get(key).delete(fn);
    },

    subscribeAll(fn) {
      wildcards.add(fn);
      return () => wildcards.delete(fn);
    },

    replaceKey(key, value) {
      proxy[key] = value;
    },

    snapshot() {
      return JSON.parse(JSON.stringify(data));
    },

    patch(updates) {
      for (const [key, value] of Object.entries(updates)) {
        proxy[key] = value;
      }
    },

    restore(snapshot) {
      for (const [key, value] of Object.entries(snapshot)) {
        if (key in data) {
          proxy[key] = value;
        }
      }
    }
  };
}
