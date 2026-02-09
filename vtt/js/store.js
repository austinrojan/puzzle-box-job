// Proxy-based reactive store with per-key subscriptions.
//
// IMPORTANT: Only top-level property assignments trigger subscribers.
// Nested mutation like `state.initiative.round++` is INVISIBLE.
// Always reassign the full object: `state.initiative = { ...state.initiative, round: n }`

export function createStore(initial) {
  const subscribers = new Map();
  const wildcards = new Set();
  const data = JSON.parse(JSON.stringify(initial));

  function notify(key, value, old) {
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
  }

  const proxy = new Proxy(data, {
    set(target, key, value) {
      const old = target[key];
      if (old === value && typeof value !== 'object') return true;
      target[key] = value;
      notify(key, value, old);
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
      return () => subscribers.get(key)?.delete(fn);
    },

    subscribeAll(fn) {
      wildcards.add(fn);
      return () => wildcards.delete(fn);
    },

    snapshot() {
      return JSON.parse(JSON.stringify(data));
    },

    patch(updates) {
      for (const [key, value] of Object.entries(updates)) {
        proxy[key] = value;
      }
    }
  };
}
