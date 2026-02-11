# Puzzle-Box VTT: Refactoring Guide

**Scope**: Make the one-shot campaign bulletproof while laying clean foundations for the future platform.

**Philosophy**: Every change below serves two masters. First, it reduces the odds that something breaks mid-session when you're sitting in front of your friends on Discord. Second, it teaches you a pattern that transfers directly to the React/TypeScript/PixiJS/Zustand platform you'll build later. If a change only serves one master, I'll say so explicitly.

---

## Table of Contents

1. [Extract Shared Data into a Single Source of Truth](#1-extract-shared-data-into-a-single-source-of-truth)
2. [Replace Mutable State with a Reactive Store](#2-replace-mutable-state-with-a-reactive-store)
3. [Add Error Boundaries and State Recovery](#3-add-error-boundaries-and-state-recovery)
4. [Add a Pre-Flight Diagnostic Check](#4-add-a-pre-flight-diagnostic-check)
5. [Break the DM Guide Monolith into Modules](#5-break-the-dm-guide-monolith-into-modules)
6. [Improve the BroadcastChannel Protocol](#6-improve-the-broadcastchannel-protocol)
7. [Long-Term Roadmap Tie-Ins](#7-long-term-roadmap-tie-ins)
8. [Testing Protocols](#8-testing-protocols)

---

## 1. Extract Shared Data into a Single Source of Truth

### The Problem Right Now

Your campaign data is defined in three separate places:

- `vtt/js/data.js` contains the canonical SCENES, MAPS, TOKENS, MAP_PRESETS, EFFECTS, and ACTS arrays.
- `controller/index.html` re-declares a subset of SCENES (for the scene list and navigation), TOKENS and MAP_PRESETS (for the token buttons and preset loader), and EFFECTS and CONDITIONS (for the effects panel).
- `index.html` (the DM Guide) contains ADVENTURE_DATA with its own scene references, plus it sends VTT sync messages with scene IDs that must match the VTT's SCENES array.

If you add a scene, rename a token, or tweak an effect definition the night before your session, you have to remember to update all three files. You *will* forget one. That's not a character flaw; it's a systems design problem.

### Why This Matters Philosophically

The "single source of truth" principle shows up at every scale of software. In your future platform, campaign data will live in a Supabase database and get served to all clients through an API. The VTT client, the GM dashboard, and the player view will all consume the same data from the same source. What you're doing here is the local-file version of that exact pattern: one canonical file, multiple consumers.

The deeper lesson is that duplication is a maintenance hazard that grows quadratically. Two copies means one place to forget. Three copies means three places to forget. And the bugs it produces are the worst kind: silent inconsistencies where the Controller thinks a scene is called "Locke's Proposition" but the VTT has it as "Locke's Offer," and nothing crashes, but the scene navigation silently does nothing.

### The Target File Structure

```
project-root/
├── shared/
│   ├── campaign-data.js      ← THE source of truth
│   └── protocol.js           ← message types (covered in Section 6)
├── vtt/
│   ├── js/
│   │   ├── data.js            ← delete, import from shared/
│   │   ├── state.js
│   │   ├── ... (other modules)
│   │   └── main.js
│   ├── css/
│   ├── assets/
│   └── index.html
├── controller/
│   └── index.html             ← imports from shared/
├── index.html                  ← DM Guide, imports from shared/
└── dm-guide/                   ← (future, when you split the monolith)
```

### Full Code: `shared/campaign-data.js`

```js
// ============================================
// Shared Campaign Data — Single Source of Truth
// Imported by VTT, Controller, and DM Guide
// ============================================

// --- ACTS ---
export const ACTS = [
  { number: 1, title: 'The Job Offer',      subtitle: 'A proposition in the Dock District' },
  { number: 2, title: 'Gathering Intel',     subtitle: 'Contacts, rumors, and the estate' },
  { number: 3, title: 'Infiltration',        subtitle: 'Into the Veymar estate' },
  { number: 4, title: 'The Mansion',         subtitle: 'Secrets behind gilded walls' },
  { number: 5, title: 'The Puzzle Box',      subtitle: 'The prize within reach' },
  { number: 6, title: 'The Ritual',          subtitle: 'Betrayal and blood' },
];

// --- SCENES (26 total) ---
export const SCENES = [
  // Act 1
  { id: 'S01', act: 1, title: 'The Rusty Anchor',
    art: 'assets/scenes/s01-rusty-anchor.jpg',
    overlay: 'A salt-crusted tavern on the docks. Lantern light cuts through harbor fog.' },
  { id: 'S02', act: 1, title: "Locke's Proposition",
    art: 'assets/scenes/s02-locke-booth.png',
    overlay: null },

  // Act 2
  { id: 'S03', act: 2, title: 'Dock District',
    art: 'assets/scenes/s03-dock-district.png', overlay: null },
  { id: 'S04', act: 2, title: 'Veymar Estate (Distant)',
    art: 'assets/scenes/s04-veymar-distant.png', overlay: null },
  { id: 'S05', act: 2, title: 'The Bakery — Pip',
    art: 'assets/scenes/s05-bakery-pip.png', overlay: null },
  { id: 'S06', act: 2, title: 'The Undermarket',
    art: 'assets/scenes/s06-undermarket.png', overlay: null },
  { id: 'S07', act: 2, title: 'The Broken Oar',
    art: 'assets/scenes/s07-broken-oar.png', overlay: null },

  // ... (continue with all 26 scenes, copied from your current data.js)
  // The key is that this file is the ONLY place these definitions exist.
];

// --- MAPS (6 total) ---
export const MAPS = [
  { id: 'M01', title: 'Dock District',
    image: 'assets/maps/m01-dock-district.png', gridSize: 5, cols: 40, rows: 30 },
  { id: 'M02', title: 'Estate Grounds',
    image: 'assets/maps/m02-estate-grounds.png', gridSize: 5, cols: 40, rows: 30 },
  { id: 'M03', title: 'Mansion — Ground',
    image: 'assets/maps/m03-mansion-ground.png', gridSize: 5, cols: 30, rows: 24 },
  { id: 'M04', title: 'Mansion — Second',
    image: 'assets/maps/m04-mansion-second.png', gridSize: 5, cols: 30, rows: 24 },
  { id: 'M05', title: 'Mansion — Third',
    image: 'assets/maps/m05-mansion-third.png', gridSize: 5, cols: 20, rows: 16 },
  { id: 'M06', title: 'Warehouse',
    image: 'assets/maps/m06-warehouse.png', gridSize: 5, cols: 24, rows: 16 },
];

// --- TOKENS ---
export const TOKENS = {
  // PCs
  'martin-storm':    { name: 'Martin Storm',        image: 'assets/tokens/martin-storm.png',
                       border: 'var(--token-pc)', size: 1, isPC: true },
  'lome':            { name: 'Lome',                 image: 'assets/tokens/lome.png',
                       border: 'var(--token-pc)', size: 1, isPC: true },
  'oda':             { name: 'Oda "Bearda"',         image: 'assets/tokens/oda.png',
                       border: 'var(--token-pc)', size: 1, isPC: true },
  'jean':            { name: 'Jean',                 image: 'assets/tokens/jean.png',
                       border: 'var(--token-pc)', size: 1, isPC: true },
  'kallista':        { name: 'Kallista',             image: 'assets/tokens/kallista.png',
                       border: 'var(--token-pc)', size: 1, isPC: true },

  // NPCs & Enemies (continue with your full token definitions)
  'locke-human':     { name: 'Locke (Human)',        image: 'assets/tokens/locke-human.png',
                       border: 'var(--token-npc-neutral)', size: 1 },
  'locke-rakshasa':  { name: 'Locke (Rakshasa)',     image: 'assets/tokens/locke-rakshasa.png',
                       border: 'var(--token-enemy)', size: 2 },
  // ... all remaining tokens
};

// --- MAP PRESETS ---
export const MAP_PRESETS = {
  'M06-combat': {
    mapId: 'M06',
    label: 'Warehouse — Final Battle',
    tokens: [
      { tokenId: 'locke-rakshasa', x: 12, y: 8 },
      { tokenId: 'cult-fanatic',   x: 8,  y: 6,  label: 'Fanatic 1' },
      { tokenId: 'cult-fanatic',   x: 16, y: 6,  label: 'Fanatic 2' },
      { tokenId: 'brazier-lit',    x: 6,  y: 4 },
      { tokenId: 'brazier-lit',    x: 18, y: 4 },
      { tokenId: 'brazier-lit',    x: 6,  y: 12 },
      { tokenId: 'brazier-lit',    x: 18, y: 12 },
      { tokenId: 'brazier-lit',    x: 12, y: 2 },
      { tokenId: 'martin-storm',   x: 10, y: 14 },
      { tokenId: 'lome',           x: 12, y: 14 },
      { tokenId: 'oda',            x: 14, y: 14 },
      { tokenId: 'jean',           x: 8,  y: 14 },
      { tokenId: 'kallista',       x: 16, y: 14 },
    ]
  },
  'M02-infiltration': {
    mapId: 'M02',
    label: 'Estate Grounds — Infiltration',
    tokens: [
      { tokenId: 'guard', x: 20, y: 15, label: 'Gate Guard 1' },
      { tokenId: 'guard', x: 21, y: 15, label: 'Gate Guard 2' },
      { tokenId: 'guard', x: 10, y: 20, label: 'Patrol' },
      { tokenId: 'mastiff', x: 30, y: 10, label: 'Mastiff 1' },
      { tokenId: 'mastiff', x: 32, y: 12, label: 'Mastiff 2' },
    ]
  }
};

// --- EFFECTS ---
export const EFFECTS = {
  'divine-smite':      { name: 'Divine Smite',       type: 'burst',
                         color: '#FFD700', radius: 1, duration: 600, shake: true },
  'fireball':          { name: 'Fireball',           type: 'aoe-sphere',
                         color: '#FF4500', radius: 4, duration: 800, flash: '#FF4500' },
  // ... all remaining effects from your current data.js
};

// --- CONDITIONS (used by Controller and Initiative Tracker) ---
export const CONDITIONS = [
  { id: 'dominated',      label: 'DOM', color: '#7E57C2' },
  { id: 'concentrating',  label: 'CON', color: '#2E86AB' },
  { id: 'stunned',        label: 'STN', color: '#E8A84C' },
  { id: 'prone',          label: 'PRN', color: '#6B6B78' },
  { id: 'poisoned',       label: 'PSN', color: '#27AE60' },
  { id: 'frightened',     label: 'FRT', color: '#E74C3C' },
  { id: 'invisible',      label: 'INV', color: '#48B5E0' },
];

// --- LOOKUP HELPERS ---
// These prevent every consumer from re-implementing the same find-by-id logic.

export function getSceneById(id) {
  return SCENES.find(s => s.id === id) ?? null;
}

export function getSceneIndex(id) {
  return SCENES.findIndex(s => s.id === id);
}

export function getMapById(id) {
  return MAPS.find(m => m.id === id) ?? null;
}

export function getActByNumber(num) {
  return ACTS.find(a => a.number === num) ?? null;
}

export function getTokenDef(tokenId) {
  return TOKENS[tokenId] ?? null;
}

// --- DATA INTEGRITY CHECK ---
// Used by the preflight system (Section 4) to validate the data at boot.

export function validateCampaignData() {
  const errors = [];

  // Every scene must reference a valid act
  for (const scene of SCENES) {
    if (!ACTS.find(a => a.number === scene.act)) {
      errors.push(`Scene ${scene.id} references non-existent act ${scene.act}`);
    }
  }

  // Every preset must reference valid tokens and maps
  for (const [presetId, preset] of Object.entries(MAP_PRESETS)) {
    if (!MAPS.find(m => m.id === preset.mapId)) {
      errors.push(`Preset ${presetId} references non-existent map ${preset.mapId}`);
    }
    for (const t of preset.tokens) {
      if (!TOKENS[t.tokenId]) {
        errors.push(`Preset ${presetId} references non-existent token ${t.tokenId}`);
      }
    }
  }

  // Scene IDs must be unique
  const sceneIds = new Set();
  for (const scene of SCENES) {
    if (sceneIds.has(scene.id)) {
      errors.push(`Duplicate scene ID: ${scene.id}`);
    }
    sceneIds.add(scene.id);
  }

  return errors;
}
```

### How Each App Imports

**VTT** (`vtt/js/main.js` and other modules):

Your VTT modules currently import from `./data.js`. After the migration, `vtt/js/data.js` becomes a one-line re-export:

```js
// vtt/js/data.js — now a thin re-export from the shared source
export {
  SCENES, MAPS, TOKENS, MAP_PRESETS, EFFECTS, ACTS, CONDITIONS,
  getSceneById, getSceneIndex, getMapById, getActByNumber, getTokenDef,
  validateCampaignData
} from '../../shared/campaign-data.js';
```

This means none of your existing VTT modules need to change their import paths. They still do `import { SCENES } from './data.js'` and it works. Zero disruption.

**Controller** (`controller/index.html`):

Your Controller currently defines scene, token, effect, and condition data inline in a `<script>` tag. Replace those inline definitions with a module import. You'll need to change the script tag to `type="module"`:

```html
<!-- In controller/index.html, replace the inline data definitions -->
<script type="module">
import {
  SCENES, MAPS, TOKENS, MAP_PRESETS, EFFECTS, CONDITIONS
} from '../shared/campaign-data.js';

// ... rest of controller code, now using the shared data
</script>
```

**DM Guide** (`index.html`):

The DM Guide's ADVENTURE_DATA is a different beast. It contains the full narrative text, read-aloud blocks, DM notes, and skill checks, none of which belong in the shared campaign data. But it *references* scenes by ID (the `vtt: { scene: 'S08', mode: 'theater' }` fields on blocks). Those references should be validated against the shared SCENES array.

```html
<!-- In index.html, add a module script that imports and validates -->
<script type="module">
import { SCENES, getSceneById } from './shared/campaign-data.js';

// Validate all VTT scene references in ADVENTURE_DATA
function validateAdventureSceneRefs() {
  const errors = [];
  ADVENTURE_DATA.acts.forEach(act => {
    (act.sections || []).forEach(section => {
      (section.blocks || []).forEach(block => {
        if (block.vtt?.scene && !getSceneById(block.vtt.scene)) {
          errors.push(
            `Block ${block.id} references unknown scene: ${block.vtt.scene}`
          );
        }
      });
    });
  });
  if (errors.length > 0) {
    console.warn('[DM Guide] Scene reference errors:', errors);
  }
  return errors;
}

// Run on load
validateAdventureSceneRefs();
</script>
```

### Migration Steps

1. Create `shared/campaign-data.js` by copying your current `vtt/js/data.js` content.
2. Add the lookup helpers and `validateCampaignData()` function.
3. Replace `vtt/js/data.js` with the re-export shim.
4. Test: Open the VTT. Everything should work identically.
5. Update `controller/index.html`: remove the inline data definitions, add the import.
6. Test: Open the Controller. Verify the scene list, token buttons, and effect buttons all populate correctly.
7. Add the DM Guide validation script.
8. Test: Open the DM Guide. Check the console for any scene reference warnings.

### How This Maps to the Future Platform

In the full platform, `shared/campaign-data.js` becomes your Supabase schema. SCENES becomes a `scenes` table. TOKENS becomes a `tokens` table. The lookup helpers become database queries. The validation function becomes a database constraint or a migration check. The pattern of "one canonical source, multiple consumers" is identical; only the storage medium changes.

### Testing Protocol

```
[ ] All 26 scenes render in the VTT (Theater mode, click through all)
[ ] All 6 maps load in the VTT (Map mode, cycle through all)
[ ] All token buttons appear in the Controller
[ ] All effect buttons appear in the Controller
[ ] Scene navigation from Controller advances VTT to correct scene
[ ] Preset loading from Controller places correct tokens
[ ] DM Guide console shows zero scene reference warnings
[ ] Edit a scene title in shared/campaign-data.js, verify it updates
    in VTT, Controller, and DM Guide without any other file changes
```

---

## 2. Replace Mutable State with a Reactive Store

### The Problem Right Now

Your VTT's state management has a split personality. There's a plain `state` object in `state.js` that modules read from and write to directly:

```js
// Scattered across multiple modules:
state.mode = 'theater';          // direct mutation in scene-manager.js
state.sceneIndex = idx;          // direct mutation in theater.js
state.initiative.active = true;  // direct mutation in state.js (sync handler)
state.gridVisible = !state.gridVisible;  // direct mutation in state.js
```

And there's an EventBus that sits alongside it, requiring manual event emission after every state change:

```js
state.mode = mode;
EventBus.emit('mode:changed', { mode, prev });  // You have to remember this
```

These two systems are not connected. If you change `state.mode` but forget to emit `mode:changed`, the player-controls nav bar won't update. If you emit an event but forget to update the state object, the next module that reads `state.mode` gets stale data. You already hit this exact bug: the map didn't load on mode switch because `map:load` was never emitted even though the state had changed. Your QA caught it, but in a live session you might not be so lucky.

### Why This Matters Philosophically

The core insight is that state and notification should be a single operation, not two. When something changes, everything that cares about that change should know about it automatically, without the code that *made* the change having to know who cares.

This is exactly what Zustand does in the React world. You call `set({ mode: 'theater' })`, and every component subscribed to `mode` re-renders. The setter *is* the notifier. There's no separate step.

What we're building here is a minimal version of that same idea, using a JavaScript `Proxy`. The Proxy intercepts property assignments on the state object and automatically calls subscriber functions. The code that changes state doesn't need to know about the EventBus at all.

### Full Implementation: `vtt/js/store.js`

```js
// ============================================
// VTT Reactive Store — Proxy-based state with subscriptions
//
// Philosophy: state change IS notification.
// Mutating a property automatically calls subscribers.
// No more forgetting to emit after setting.
//
// Future: this pattern maps directly to Zustand's subscribe().
// ============================================

/**
 * Creates a reactive store from an initial state object.
 *
 * Usage:
 *   const store = createStore({ mode: 'theater', sceneIndex: 0 });
 *   store.subscribe('mode', (newVal, oldVal) => { ... });
 *   store.state.mode = 'map';  // subscriber fires automatically
 *
 * For nested objects (like initiative), use replaceKey() to trigger
 * subscribers on the parent key:
 *   store.replaceKey('initiative', { ...store.state.initiative, round: 2 });
 */
export function createStore(initial) {
  const subscribers = new Map();   // key -> Set<fn(newVal, oldVal)>
  const wildcards = new Set();     // fn(key, newVal, oldVal) — listen to ALL changes

  // Deep clone initial state to avoid reference sharing
  const data = JSON.parse(JSON.stringify(initial));

  const proxy = new Proxy(data, {
    set(target, key, value) {
      const old = target[key];

      // Skip if value hasn't actually changed (primitive comparison)
      // For objects/arrays, we always notify since reference equality
      // doesn't tell us if contents changed.
      if (old === value && typeof value !== 'object') return true;

      target[key] = value;

      // Notify key-specific subscribers
      const fns = subscribers.get(key);
      if (fns) {
        for (const fn of fns) {
          try { fn(value, old); }
          catch (err) { console.error(`[Store] Subscriber error on "${key}":`, err); }
        }
      }

      // Notify wildcard subscribers
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
    /** The reactive state object. Read and write properties directly. */
    state: proxy,

    /**
     * Subscribe to changes on a specific key.
     * Returns an unsubscribe function.
     *
     * Example:
     *   const unsub = store.subscribe('mode', (val) => console.log(val));
     *   unsub(); // stop listening
     */
    subscribe(key, fn) {
      if (!subscribers.has(key)) subscribers.set(key, new Set());
      subscribers.get(key).add(fn);
      return () => subscribers.get(key).delete(fn);
    },

    /**
     * Subscribe to ALL state changes. Useful for persistence and sync.
     * Callback receives (key, newVal, oldVal).
     */
    subscribeAll(fn) {
      wildcards.add(fn);
      return () => wildcards.delete(fn);
    },

    /**
     * Replace a key's value and force notification.
     * Use this for nested objects like initiative where you want
     * subscribers to fire even if the object reference didn't change.
     *
     * Example:
     *   store.replaceKey('initiative', { ...store.state.initiative, round: 2 });
     */
    replaceKey(key, value) {
      proxy[key] = value;
    },

    /**
     * Get a snapshot of the full state (non-reactive, safe to serialize).
     */
    snapshot() {
      return JSON.parse(JSON.stringify(data));
    },

    /**
     * Bulk-set multiple keys. Each fires its own subscribers.
     */
    patch(updates) {
      for (const [key, value] of Object.entries(updates)) {
        proxy[key] = value;
      }
    },

    /**
     * Restore state from a snapshot (e.g., loaded from localStorage).
     * Fires subscribers for every key that differs.
     */
    restore(snapshot) {
      for (const [key, value] of Object.entries(snapshot)) {
        if (key in data) {
          proxy[key] = value;
        }
      }
    }
  };
}
```

### Initializing the Store (updated `vtt/js/state.js`)

```js
// ============================================
// VTT State — Reactive store + BroadcastChannel
// ============================================

import { createStore } from './store.js';

// --- Legacy EventBus (kept during migration, modules can use either) ---
export const EventBus = {
  _listeners: {},
  on(event, fn) { (this._listeners[event] ||= []).push(fn); },
  off(event, fn) {
    const list = this._listeners[event];
    if (list) this._listeners[event] = list.filter(f => f !== fn);
  },
  emit(event, data) {
    const list = this._listeners[event];
    if (list) list.forEach(fn => fn(data));
  }
};

// --- Create the reactive store ---
const store = createStore({
  mode: 'theater',
  sceneIndex: 0,
  mapId: null,
  heat: 0,
  initiative: {
    active: false,
    round: 1,
    currentTurn: 0,
    entries: []
  },
  tokens: [],
  gridVisible: true,
  fog: {},
  titleCardVisible: false,
  overlayText: null,
  presentationMode: false,
  loaded: false
});

// Export both the store and a direct reference to the state proxy.
// The state proxy lets existing code keep doing `state.mode = 'map'`
// while getting automatic reactivity.
export { store };
export const state = store.state;

// --- Bridge: forward store changes to legacy EventBus ---
// This lets you migrate module by module. Modules that still use
// EventBus.on('mode:changed', ...) will keep working.
//
// Remove these bridges once all modules subscribe directly to the store.

store.subscribe('mode', (mode, prev) => {
  EventBus.emit('mode:changed', { mode, prev });
});

store.subscribe('sceneIndex', () => {
  EventBus.emit('scene:loaded', store.state.sceneIndex);
});

store.subscribe('heat', (level) => {
  EventBus.emit('heat:change', level);
});

store.subscribe('initiative', (data) => {
  EventBus.emit('initiative:update', data);
});

store.subscribe('gridVisible', () => {
  EventBus.emit('grid:toggle');
});

store.subscribe('titleCardVisible', (visible) => {
  EventBus.emit(visible ? 'title-card:visible' : 'title-card:hidden');
});

// --- BroadcastChannel (no changes to message handling) ---
// ... (keep your existing initSync and handleSyncMessage functions,
//      but have them set store.state properties instead of the old
//      state object, which is now the same proxy anyway)
```

### Migrating a Module: `scene-manager.js` (before and after)

**Before** (current code):

```js
export function switchMode(mode) {
  if (mode === state.mode) return;
  const prev = state.mode;
  state.mode = mode;          // mutation
  applyMode(mode);
  EventBus.emit('mode:changed', { mode, prev });  // manual notification
}
```

**After** (with reactive store):

```js
export function switchMode(mode) {
  if (mode === state.mode) return;
  applyMode(mode);
  state.mode = mode;  // That's it. The store bridge emits 'mode:changed'.
}
```

The `EventBus.emit` call is gone. Setting `state.mode` triggers the bridge subscriber, which emits the event for any modules still listening the old way. Over time, you migrate those modules to use `store.subscribe('mode', ...)` directly and remove the bridges.

### Migrating a Module: `theater.js`

**Before** (subscribes to events, reads state directly):

```js
EventBus.on('scene:next', nextScene);
EventBus.on('scene:prev', prevScene);
EventBus.on('scene:goto', gotoScene);

function nextScene() {
  const next = state.sceneIndex + 1;
  if (next >= SCENES.length) return;
  state.sceneIndex = next;       // mutation
  loadScene(next, true);
}
```

**After** (option A: subscribe to the store directly):

```js
import { store, state } from './state.js';

// Still listen to EventBus for action-style events (next/prev/goto)
// since these are imperative commands, not state changes.
EventBus.on('scene:next', nextScene);
EventBus.on('scene:prev', prevScene);
EventBus.on('scene:goto', gotoScene);

// But react to sceneIndex changes via the store
store.subscribe('sceneIndex', (index) => {
  loadScene(index, true);
});

function nextScene() {
  const next = state.sceneIndex + 1;
  if (next >= SCENES.length) return;
  state.sceneIndex = next;  // triggers store subscriber, which calls loadScene
}
```

The key distinction: **action events** (scene:next, scene:prev, token:add) remain on the EventBus because they represent *commands*, not state changes. **State-derived updates** (the scene index changed, so re-render the scene) move to store subscriptions. This maps directly to the React/Zustand world where actions are dispatched and state changes trigger re-renders.

### Migrating a Module: `player-controls.js`

This module is a good example of one that currently does a lot of manual state reading. Here's the pattern:

**Before:**

```js
EventBus.on('mode:changed', onModeChanged);
EventBus.on('scene:loaded', onSceneChange);
EventBus.on('map:load', onMapLoad);

function onModeChanged({ mode }) {
  updateModeButtons(mode);
  updateContext();
  rightRegion.classList.toggle('theater-hidden', mode === 'theater');
  nextTurnBtn.hidden = mode !== 'initiative';
}
```

**After:**

```js
import { store, state } from './state.js';

store.subscribe('mode', (mode) => {
  updateModeButtons(mode);
  updateContext();
  rightRegion.classList.toggle('theater-hidden', mode === 'theater');
  nextTurnBtn.hidden = mode !== 'initiative';

  if ((mode === 'map' || mode === 'initiative') && !state.mapId) {
    EventBus.emit('map:load', MAPS[currentMapIndex].id);
  }
});

store.subscribe('sceneIndex', () => {
  setTimeout(updateContext, 0);
});

store.subscribe('mapId', () => {
  updateContext();
});
```

Cleaner, and you can see the data dependencies at a glance.

### What About Nested State?

The initiative object is nested: `state.initiative.round`, `state.initiative.entries`, etc. The Proxy only intercepts top-level property assignments. Setting `state.initiative.round = 2` won't fire the `initiative` subscriber because you're mutating a property of the nested object, not replacing the top-level `initiative` key.

The solution is the same pattern Zustand and Redux use: treat nested objects as immutable and replace the whole thing:

```js
// Instead of:
state.initiative.round = 2;  // WON'T trigger subscribers

// Do:
store.replaceKey('initiative', {
  ...state.initiative,
  round: 2
});  // WILL trigger subscribers
```

This is slightly more verbose, but it makes change detection reliable. It also teaches you the immutable update pattern that React and Zustand require.

### Testing Protocol

```
[ ] Change state.mode in the console: window.__vtt.store.state.mode = 'map'
    Verify: VTT switches to map view, player-controls update, no EventBus.emit needed
[ ] Change state.sceneIndex in the console: window.__vtt.store.state.sceneIndex = 5
    Verify: Theater loads scene S06, player-controls badge updates
[ ] Change heat: window.__vtt.store.state.heat = 2
    Verify: Heat indicator updates (if visible)
[ ] Use replaceKey for initiative:
    window.__vtt.store.replaceKey('initiative',
      {...window.__vtt.store.state.initiative, round: 3})
    Verify: Initiative panel shows Round 3
[ ] Verify EventBus bridge: modules still using EventBus.on('mode:changed')
    should still fire when store.state.mode changes
[ ] Verify no double-firing: check console logs to ensure events fire once,
    not twice (once from bridge, once from manual emit)
```

---

## 3. Add Error Boundaries and State Recovery

### The Problem Right Now

If the VTT window accidentally closes, gets refreshed, or crashes, the session resets to Scene 1, Theater mode, no tokens. In a local-only setup, this isn't catastrophic (you just navigate back), but it breaks the flow of the game. Your players are watching the shared screen, and suddenly it's a loading bar and then the tavern again instead of the mansion ballroom.

The Controller has a heartbeat that detects VTT disconnection, which is good. But the VTT itself has no state persistence and no ability to resume.

### Why This Matters Philosophically

Resilience is the difference between "it works in testing" and "it works on game night." Software demos always go perfectly. Live sessions always find the one scenario you didn't test. A persistent state layer is your insurance policy.

In the future platform, this exact problem becomes multiplayer reconnection: a player's browser tab crashes, they rejoin, and the VTT needs to restore their view to the current scene with all tokens in position. The pattern is identical. You save state continuously, and you restore it on connect.

### Full Implementation: State Persistence

Add this to `vtt/js/state.js` (or as a new `vtt/js/persistence.js` module):

```js
// ============================================
// VTT State Persistence — survive refreshes and crashes
// ============================================

const STORAGE_KEY = 'puzzlebox-vtt-state';
const SAVE_DEBOUNCE_MS = 500;

let saveTimer = null;

/**
 * Keys worth persisting. We deliberately exclude transient UI state
 * like titleCardVisible and overlayText, which should reset on reload.
 */
const PERSIST_KEYS = [
  'mode', 'sceneIndex', 'mapId', 'heat',
  'initiative', 'tokens', 'gridVisible', 'fog'
];

/**
 * Save current state to sessionStorage.
 * Uses sessionStorage (not localStorage) so it clears when the browser
 * closes entirely, but survives refresh/navigation within the tab.
 */
function saveState(storeSnapshot) {
  const toSave = {};
  for (const key of PERSIST_KEYS) {
    toSave[key] = storeSnapshot[key];
  }
  toSave._savedAt = Date.now();
  toSave._version = 1;  // bump this if the state shape changes

  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (err) {
    console.warn('[VTT] State save failed:', err);
  }
}

/**
 * Debounced save. Called on every state change via the store's
 * subscribeAll() hook.
 */
export function debouncedSave(store) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState(store.snapshot()), SAVE_DEBOUNCE_MS);
}

/**
 * Attempt to restore state from sessionStorage.
 * Returns the saved state object, or null if nothing saved / too old.
 */
export function loadSavedState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const saved = JSON.parse(raw);

    // Reject saves older than 4 hours (stale from a previous session)
    if (Date.now() - saved._savedAt > 4 * 60 * 60 * 1000) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }

    // Reject saves with a different version
    if (saved._version !== 1) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return saved;
  } catch (err) {
    console.warn('[VTT] State load failed:', err);
    return null;
  }
}

/**
 * Clear saved state (e.g., when starting a fresh session).
 */
export function clearSavedState() {
  sessionStorage.removeItem(STORAGE_KEY);
}
```

### Wire It Into Boot (`vtt/js/main.js`)

```js
import { store, state, initSync, EventBus } from './state.js';
import { loadSavedState, debouncedSave, clearSavedState } from './persistence.js';

async function boot() {
  console.log('[VTT] Booting...');

  // ... (loading screen, asset preload — keep as-is) ...

  // Initialize BroadcastChannel sync
  initSync();

  // Initialize all modules
  theater.init();
  sceneManager.init();
  // ... etc ...

  // --- STATE RECOVERY ---
  const saved = loadSavedState();
  if (saved) {
    console.log('[VTT] Restoring saved state from', new Date(saved._savedAt));
    store.restore(saved);

    // Re-apply the restored state to modules that need explicit kicks
    if (saved.mode !== 'theater') {
      EventBus.emit('mode:switch', saved.mode);
    }
    if (saved.sceneIndex > 0) {
      EventBus.emit('scene:goto', SCENES[saved.sceneIndex]?.id);
    }
    if (saved.mapId) {
      EventBus.emit('map:load', saved.mapId);
    }
  }

  // --- AUTO-SAVE on every state change ---
  store.subscribeAll(() => debouncedSave(store));

  // --- Also save on page unload (belt and suspenders) ---
  window.addEventListener('beforeunload', () => {
    try {
      const snapshot = store.snapshot();
      const toSave = {};
      for (const key of ['mode','sceneIndex','mapId','heat','initiative',
                          'tokens','gridVisible','fog']) {
        toSave[key] = snapshot[key];
      }
      toSave._savedAt = Date.now();
      toSave._version = 1;
      sessionStorage.setItem('puzzlebox-vtt-state', JSON.stringify(toSave));
    } catch (e) { /* best effort */ }
  });

  // Expose for debugging
  window.__vtt = { store, state, EventBus, clearSavedState };

  // ... (rest of boot: presentation mode, fade loading screen) ...
}
```

### Visible Error Overlay

If something goes wrong during boot, the current error handler sets text on a loading element that might already be hidden. Replace it with a proper error overlay:

```js
boot().catch(err => {
  console.error('[VTT] Boot failed:', err);

  // Show a visible error overlay regardless of loading screen state
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: #0D0F14; color: #E8C55A;
    font-family: 'Cinzel', serif; text-align: center; padding: 2rem;
  `;

  const title = document.createElement('h1');
  title.textContent = 'Something Went Wrong';
  title.style.marginBottom = '1rem';

  const msg = document.createElement('p');
  msg.textContent = err.message;
  msg.style.cssText = 'color: #E74C3C; font-family: "IBM Plex Mono", monospace; font-size: 14px;';

  const btn = document.createElement('button');
  btn.textContent = 'Retry';
  btn.style.cssText = `
    margin-top: 2rem; padding: 0.75rem 2rem; cursor: pointer;
    background: #C9A84C; color: #0D0F14; border: none;
    font-family: 'Cinzel', serif; font-size: 16px; border-radius: 4px;
  `;
  btn.onclick = () => location.reload();

  overlay.appendChild(title);
  overlay.appendChild(msg);
  overlay.appendChild(btn);
  document.body.appendChild(overlay);
});
```

### Testing Protocol

```
[ ] Refresh test: Navigate to S10, switch to Map mode, load M03.
    Refresh the page (F5). Verify: VTT restores to S10, Map mode, M03.
[ ] Close/reopen test: Close the VTT tab, reopen it. Verify state restores.
[ ] Stale state test: Manually set _savedAt to 5 hours ago in sessionStorage.
    Reload. Verify: VTT starts fresh (ignores stale save).
[ ] Error overlay test: Temporarily break an import path in main.js.
    Reload. Verify: red error message visible with Retry button.
    Click Retry. Verify: page reloads.
[ ] Controller reconnection: Close VTT, reopen it. Verify: Controller
    reconnects within 4 seconds (status goes green).
[ ] clearSavedState test: Run window.__vtt.clearSavedState() in console.
    Reload. Verify: VTT starts at S01, Theater mode (fresh start).
```

---

## 4. Add a Pre-Flight Diagnostic Check

### The Problem Right Now

Your `image-cache.js` preloads all images and logs failures to the console, but it resolves successfully even if half the assets are missing. The loading screen says "Loading assets... 50/50" and then vanishes. If five images 404'd, you won't know until your players see a gray placeholder where the ballroom should be.

### Why This Matters Philosophically

Pre-flight checks are the software equivalent of a pilot's checklist. They exist because the cost of discovering a problem during the flight is orders of magnitude higher than discovering it on the ground. Your "flight" is a 3-hour D&D session with friends who carved out their evening for this. Finding out that `s13-ballroom.png` was accidentally named `s13-ballroom.jpg` during Act 4 is a much worse experience than finding out during the loading screen.

In the future platform, this becomes a health-check endpoint that monitoring tools hit to verify the system is operational. Same concept, bigger scale.

### Full Implementation

```js
// ============================================
// VTT Pre-Flight Check — Verify everything before game night
// ============================================

import { SCENES, MAPS, TOKENS, MAP_PRESETS, validateCampaignData } from './data.js';

/**
 * Run all pre-flight checks. Returns an object with results for each category.
 * Called during boot, displayed on the loading screen.
 */
export async function runPreflight() {
  const results = {
    data:       { ok: true, errors: [] },
    scenes:     { ok: true, errors: [], loaded: 0, total: SCENES.length },
    maps:       { ok: true, errors: [], loaded: 0, total: MAPS.length },
    tokens:     { ok: true, errors: [], loaded: 0, total: Object.keys(TOKENS).length },
    broadcast:  { ok: true, errors: [] },
  };

  // 1. Data integrity
  const dataErrors = validateCampaignData();
  if (dataErrors.length > 0) {
    results.data.ok = false;
    results.data.errors = dataErrors;
  }

  // 2. Scene images
  for (const scene of SCENES) {
    const ok = await testImage(scene.art);
    if (ok) {
      results.scenes.loaded++;
    } else {
      results.scenes.ok = false;
      results.scenes.errors.push(`Missing: ${scene.id} (${scene.art})`);
    }
  }

  // 3. Map images
  for (const map of MAPS) {
    const ok = await testImage(map.image);
    if (ok) {
      results.maps.loaded++;
    } else {
      results.maps.ok = false;
      results.maps.errors.push(`Missing: ${map.id} (${map.image})`);
    }
  }

  // 4. Token images
  for (const [id, token] of Object.entries(TOKENS)) {
    const ok = await testImage(token.image);
    if (ok) {
      results.tokens.loaded++;
    } else {
      results.tokens.ok = false;
      results.tokens.errors.push(`Missing: ${id} (${token.image})`);
    }
  }

  // 5. BroadcastChannel
  try {
    const ch = new BroadcastChannel('puzzlebox-vtt-preflight');
    ch.close();
  } catch (err) {
    results.broadcast.ok = false;
    results.broadcast.errors.push('BroadcastChannel not available: ' + err.message);
  }

  return results;
}

function testImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

/**
 * Render preflight results into the loading screen.
 * Shows a checklist with green checks or red X marks.
 */
export function renderPreflightResults(results, containerEl) {
  const checks = [
    { key: 'data',      label: 'Campaign data integrity' },
    { key: 'scenes',    label: `Scene images (${results.scenes.loaded}/${results.scenes.total})` },
    { key: 'maps',      label: `Map images (${results.maps.loaded}/${results.maps.total})` },
    { key: 'tokens',    label: `Token images (${results.tokens.loaded}/${results.tokens.total})` },
    { key: 'broadcast', label: 'BroadcastChannel' },
  ];

  const list = document.createElement('div');
  list.style.cssText = 'text-align:left; max-width:400px; margin:1rem auto;';

  let allOk = true;

  for (const check of checks) {
    const result = results[check.key];
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex; align-items: center; gap: 8px;
      font-family: 'IBM Plex Mono', monospace; font-size: 13px;
      margin-bottom: 4px; color: ${result.ok ? '#27AE60' : '#E74C3C'};
    `;

    const icon = document.createElement('span');
    icon.textContent = result.ok ? '✓' : '✗';
    icon.style.fontWeight = 'bold';

    const label = document.createElement('span');
    label.textContent = check.label;

    row.appendChild(icon);
    row.appendChild(label);
    list.appendChild(row);

    // Show individual errors for failed checks
    if (!result.ok) {
      allOk = false;
      for (const err of result.errors.slice(0, 5)) {
        const errRow = document.createElement('div');
        errRow.style.cssText = `
          font-size: 11px; color: #E74C3C; padding-left: 24px; opacity: 0.8;
        `;
        errRow.textContent = err;
        list.appendChild(errRow);
      }
      if (result.errors.length > 5) {
        const more = document.createElement('div');
        more.style.cssText = 'font-size:11px; color:#E74C3C; padding-left:24px; opacity:0.6;';
        more.textContent = `...and ${result.errors.length - 5} more`;
        list.appendChild(more);
      }
    }
  }

  containerEl.appendChild(list);

  if (!allOk) {
    const warning = document.createElement('div');
    warning.style.cssText = `
      color: #E8A84C; font-family: 'Crimson Text', serif;
      font-style: italic; margin-top: 0.5rem; font-size: 15px;
    `;
    warning.textContent = 'Some checks failed. The VTT will still load, but you may see placeholders.';
    containerEl.appendChild(warning);
  }

  return allOk;
}
```

### Wire It Into Boot

```js
// In main.js boot(), after image preload and before module init:

statusEl.textContent = 'Running pre-flight checks...';
const preflight = await runPreflight();
const allOk = renderPreflightResults(preflight, loadingEl);

if (!allOk) {
  // Pause for 3 seconds so the DM can read the failures
  statusEl.textContent = 'Issues detected. Continuing in 3s...';
  await new Promise(r => setTimeout(r, 3000));
}
```

### Testing Protocol

```
[ ] All-green test: With all assets present, verify 5/5 green checks on load.
[ ] Missing scene test: Rename one scene image file. Reload. Verify:
    Scene images check shows red with the specific filename listed.
[ ] Missing token test: Rename one token image. Reload. Verify detection.
[ ] Data integrity test: Add a preset referencing a non-existent token ID
    in shared/campaign-data.js. Reload. Verify data integrity check catches it.
[ ] Continuation test: Even with failures, VTT loads after the 3-second pause.
    Verify the missing asset shows a placeholder, not a crash.
```

---

## 5. Break the DM Guide Monolith into Modules

### The Problem Right Now

Your `index.html` for the DM Guide is a single file with thousands of lines of inline JavaScript. It contains the full ADVENTURE_DATA object, the AppState management, a trigram search index, a presentation mode system, a combat panel, BroadcastChannel sync, and all the UI rendering logic. When something goes wrong during a session, you have to search through one massive `<script>` block to find it.

The VTT, by contrast, is well-organized into focused modules. The DM Guide should match.

### Why This Matters Philosophically

Modularity isn't about aesthetics. It's about *findability*. During a live session, if the presentation mode breaks, you need to open `presentation.js` and scan 100 lines, not open `index.html` and scroll through 3,000 lines looking for the `renderPresentationPage` function. The cognitive load difference is significant when you're also trying to DM a heist encounter.

For the future platform, these modules map directly to React components: the search index becomes a `useSearch` hook, the presentation mode becomes a `<PresentationOverlay>` component, the combat panel becomes `<CombatTracker>`, and so on.

### Target File Structure

```
dm-guide/
├── data/
│   └── adventure.js        ← ADVENTURE_DATA (the narrative content)
├── state.js                 ← AppState, load/save, defaults
├── search.js                ← SearchIndex (trigram search)
├── presentation.js          ← Presentation overlay logic
├── combat.js                ← Combat panel
├── vtt-sync.js              ← BroadcastChannel sync to VTT
├── tabs.js                  ← Tab management
├── nav.js                   ← Navigation tree
├── render.js                ← Block rendering (read-aloud, dm-note, etc.)
└── main.js                  ← Init, wiring, keyboard shortcuts
```

### How To Convert Without a Build Step

The DM Guide currently uses a non-module `<script>` tag, which means all functions and variables are global. Converting to ES modules requires changing the script tag and then adding `export/import` statements. Here's the approach:

**Step 1**: Change the script tag:

```html
<!-- Before -->
<script>
  // 3000 lines of code...
</script>

<!-- After -->
<script type="module" src="dm-guide/main.js"></script>
```

**Step 2**: Extract the ADVENTURE_DATA object into `dm-guide/data/adventure.js`:

```js
// dm-guide/data/adventure.js
export const ADVENTURE_DATA = {
  meta: {
    title: 'The Puzzle-Box Job',
    system: 'D&D 5e',
    // ... rest of meta
  },
  acts: [
    // ... all act data, exactly as it currently exists in index.html
  ]
};
```

**Step 3**: Extract state management into `dm-guide/state.js`:

```js
// dm-guide/state.js

export const DEFAULT_STATE = {
  activeTabId: 'tab-act-1',
  tabs: [],
  collapsed: {},
  navWidth: 260,
  heat: 0,
  combatState: {
    round: 0,
    turn: 0,
    braziers: [true, true, true, true, true],
    locke: { hp: 110, maxHp: 110 },
    cultFanatics: [{ hp: 33, maxHp: 33 }, { hp: 33, maxHp: 33 }],
    dominateJean: { active: false, auraWithParty: true }
  },
  heatLevel: 0,
  intelGathered: {},
  foreshadowing: {},
  keyDecisions: {},
  searchOpen: false,
  presentationBlock: null,
  combatPanelOpen: false,
  scrollPositions: {}
};

export let AppState = JSON.parse(JSON.stringify(DEFAULT_STATE));

export function loadState() {
  try {
    const saved = localStorage.getItem('puzzlebox-dm-state');
    if (saved) {
      const parsed = JSON.parse(saved);
      AppState = Object.assign(
        JSON.parse(JSON.stringify(DEFAULT_STATE)),
        parsed
      );
    }
  } catch (e) {
    console.warn('State load failed:', e);
  }
}

let _saveTimer = null;
export function saveState() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      const s = Object.assign({}, AppState);
      delete s.searchOpen;
      delete s.presentationBlock;
      localStorage.setItem('puzzlebox-dm-state', JSON.stringify(s));
    } catch (e) {
      console.warn('State save failed:', e);
    }
  }, 300);
}

export function resetState() {
  AppState = JSON.parse(JSON.stringify(DEFAULT_STATE));
  localStorage.removeItem('puzzlebox-dm-state');
}
```

**Step 4**: Extract the search index into `dm-guide/search.js`:

```js
// dm-guide/search.js
import { ADVENTURE_DATA } from './data/adventure.js';

// Reference data from shared/ for NPC/spell search
import { TOKENS, EFFECTS } from '../shared/campaign-data.js';

export const searchIndex = {
  entries: [],

  buildIndex() {
    this.entries = [];
    // ... (move the entire buildIndex logic here)
  },

  search(query) {
    // ... (move the search logic here)
  },

  // ... (trigram helpers, etc.)
};
```

**Step 5**: Extract presentation mode into `dm-guide/presentation.js`:

```js
// dm-guide/presentation.js
import { ADVENTURE_DATA } from './data/adventure.js';
import { AppState, saveState } from './state.js';
import { vttSync } from './vtt-sync.js';

let _pages = [];
let _idx = 0;
let _lastVttBlockId = null;

export function openPresentation(blockId) {
  const pages = collectPresentationPages(blockId);
  if (pages.length === 0) return;
  _pages = pages;
  _idx = Math.max(0, pages.findIndex(p => p.blockId === blockId));
  renderPresentationPage();
  document.getElementById('presentation-overlay').classList.add('open');
  AppState.presentationBlock = blockId;
}

export function closePresentationMode() { /* ... */ }
export function nextPresentationPage() { /* ... */ }
export function prevPresentationPage() { /* ... */ }

function collectPresentationPages(blockId) { /* ... */ }
function renderPresentationPage() { /* ... */ }
```

**Step 6**: Extract VTT sync into `dm-guide/vtt-sync.js`:

```js
// dm-guide/vtt-sync.js

let channel = null;

export function initVttSync() {
  try {
    channel = new BroadcastChannel('puzzlebox-vtt');
  } catch (e) {
    console.warn('[DM Guide] BroadcastChannel not available');
  }
}

export function vttSync(msg) {
  if (channel) channel.postMessage(msg);
}

// Convenience functions for common commands
export function vttGoToScene(sceneId, mode = 'theater') {
  vttSync({ type: 'scene', sceneId });
  if (mode) vttSync({ type: 'mode:switch', mode });
}

export function vttSetHeat(level) {
  vttSync({ type: 'heat', level });
}
```

**Step 7**: Wire everything together in `dm-guide/main.js`:

```js
// dm-guide/main.js
import { ADVENTURE_DATA } from './data/adventure.js';
import { AppState, loadState, saveState, resetState } from './state.js';
import { searchIndex } from './search.js';
import { openPresentation, closePresentationMode } from './presentation.js';
import { initVttSync, vttSync } from './vtt-sync.js';

// Make globally available for inline HTML onclick handlers (if any remain)
window.AppState = AppState;
window.saveState = saveState;

function init() {
  loadState();
  initVttSync();
  searchIndex.buildIndex();
  // ... (build nav, render initial tab, etc.)
}

init();
```

### Important Gotcha: Inline Event Handlers

If your DM Guide HTML uses `onclick="someFunction()"` attributes, those functions must be globally accessible. ES modules don't automatically put exports on `window`. You have two options:

1. Explicitly assign to `window` in `main.js`: `window.toggleCollapse = toggleCollapse;`
2. Replace inline handlers with `addEventListener` calls during init (cleaner, but more work).

For the one-shot, option 1 is fine. For the platform, you'll use React event handlers and this problem disappears.

### Testing Protocol

```
[ ] DM Guide loads without errors (check console)
[ ] Navigate between acts (tab system works)
[ ] Search works (Cmd+K, type a query, results appear)
[ ] Presentation mode works (click a read-aloud block, overlay opens)
[ ] VTT sync works (click "present" on a block, VTT jumps to that scene)
[ ] State persists (change heat, refresh page, verify heat is preserved)
[ ] Combat panel works (open combat tracker, adjust HP, verify updates)
[ ] No global variable leaks (open console, verify no new window.* junk)
```

---

## 6. Improve the BroadcastChannel Protocol

### The Problem Right Now

Your BroadcastChannel messages are ad-hoc objects. Each sender constructs them differently, and there's no validation on the receiving end:

```js
// Controller sends:
send({ type: 'scene', sceneId: SCENES[sceneIndex].id });
send({ type: 'mode:switch', mode: btn.dataset.mode });
send({ type: 'token:add', tokenId: 'guard', col: 5, row: 10 });

// VTT receives and pattern-matches:
switch (msg.type) {
  case 'scene': EventBus.emit('scene:goto', msg.sceneId); break;
  case 'mode:switch': EventBus.emit('mode:switch', msg.mode); break;
  // ...
}
```

If the Controller sends `{ type: 'scene', sceneID: 'S08' }` (note the capital D), the VTT silently does nothing. No error, no warning. The DM clicks the button, nothing happens, and now they're debugging during the session.

### Why This Matters Philosophically

This is a protocol design problem. Every networked system has a protocol: a shared agreement about the shape and meaning of messages. When the protocol is implicit (each side just knows what the other expects), bugs are silent. When the protocol is explicit (defined in one place, validated on receipt), bugs are loud.

In the future platform, BroadcastChannel becomes WebSocket. The message types, field names, and validation logic you build here transfer directly. The only thing that changes is the transport.

### Full Implementation: `shared/protocol.js`

```js
// ============================================
// Shared Protocol — Message types for VTT communication
//
// This file defines the contract between all three apps.
// Both senders and receivers import from here.
//
// Future: these become WebSocket message schemas, possibly
// with Zod validation in the TypeScript version.
// ============================================

// Protocol version. Bump this when the message format changes.
// Receivers should reject messages with a different version.
export const PROTOCOL_VERSION = 1;

// --- Message Type Constants ---
// Using constants prevents typo bugs.
// If you mistype MSG.SCENE as MSG.SCNE, you get undefined instead of 'scene',
// and the receiver's switch statement hits the default/unknown case loudly.

export const MSG = {
  // Scene/navigation
  SCENE:            'scene',
  MODE_SWITCH:      'mode:switch',
  TITLE_CARD:       'title-card',
  OVERLAY_TEXT:     'overlay-text',

  // Map
  MAP_LOAD:         'map:load',
  CAMERA_ZOOM:      'camera:zoom',
  CAMERA_PAN:       'camera:pan',
  CAMERA_RESET:     'camera:reset',
  GRID_TOGGLE:      'grid:toggle',
  FOG_REVEAL_ALL:   'fog:reveal-all',
  FOG_HIDE_ALL:     'fog:hide-all',

  // Tokens
  TOKEN_ADD:        'token:add',
  TOKEN_REMOVE_ALL: 'token:remove-all',
  TOKEN_REMOVE_ONE: 'token:remove-one',
  TOKEN_LOAD_PRESET:'token:load-preset',
  TOKEN_VISIBILITY: 'token:visibility',
  TOKEN_UPDATE_COND:'token:update-condition',

  // Combat
  INITIATIVE:       'initiative',
  INITIATIVE_NEXT:  'initiative:next',
  COMBAT_START:     'combat:start',
  COMBAT_END:       'combat:end',

  // Effects
  EFFECT:           'effect',

  // State
  HEAT:             'heat',
  BRAZIER:          'brazier',
  PRESENTATION:     'presentation',
  STATE_REQUEST:    'state:request',
  STATE_SYNC:       'state:sync',
};

// --- Message Factories ---
// Each factory returns a well-formed message.
// Senders use these instead of constructing raw objects.

export function msgScene(sceneId) {
  return { v: PROTOCOL_VERSION, type: MSG.SCENE, sceneId };
}

export function msgModeSwitch(mode) {
  return { v: PROTOCOL_VERSION, type: MSG.MODE_SWITCH, mode };
}

export function msgMapLoad(mapId) {
  return { v: PROTOCOL_VERSION, type: MSG.MAP_LOAD, mapId };
}

export function msgTokenAdd(tokenId, col, row, label = null) {
  return { v: PROTOCOL_VERSION, type: MSG.TOKEN_ADD, tokenId, col, row, label };
}

export function msgTokenRemoveAll() {
  return { v: PROTOCOL_VERSION, type: MSG.TOKEN_REMOVE_ALL };
}

export function msgTokenLoadPreset(presetId) {
  return { v: PROTOCOL_VERSION, type: MSG.TOKEN_LOAD_PRESET, presetId };
}

export function msgEffect(effectId, col = null, row = null) {
  return { v: PROTOCOL_VERSION, type: MSG.EFFECT, effectId, col, row };
}

export function msgHeat(level) {
  return { v: PROTOCOL_VERSION, type: MSG.HEAT, level };
}

export function msgBrazier(index, lit) {
  return { v: PROTOCOL_VERSION, type: MSG.BRAZIER, index, lit };
}

export function msgBrazierAll(braziers) {
  return { v: PROTOCOL_VERSION, type: MSG.BRAZIER, braziers };
}

export function msgInitiative(data) {
  return { v: PROTOCOL_VERSION, type: MSG.INITIATIVE, data };
}

export function msgInitiativeNext(currentTurn, round) {
  return { v: PROTOCOL_VERSION, type: MSG.INITIATIVE_NEXT, currentTurn, round };
}

export function msgCombatStart(data = null) {
  return { v: PROTOCOL_VERSION, type: MSG.COMBAT_START, data };
}

export function msgCombatEnd() {
  return { v: PROTOCOL_VERSION, type: MSG.COMBAT_END };
}

export function msgCameraZoom(direction) {
  return { v: PROTOCOL_VERSION, type: MSG.CAMERA_ZOOM, direction };
}

export function msgCameraPan(dx, dy) {
  return { v: PROTOCOL_VERSION, type: MSG.CAMERA_PAN, dx, dy };
}

export function msgCameraReset() {
  return { v: PROTOCOL_VERSION, type: MSG.CAMERA_RESET };
}

export function msgStateRequest() {
  return { v: PROTOCOL_VERSION, type: MSG.STATE_REQUEST };
}

export function msgStateSync(data) {
  return { v: PROTOCOL_VERSION, type: MSG.STATE_SYNC, data };
}

export function msgGridToggle() {
  return { v: PROTOCOL_VERSION, type: MSG.GRID_TOGGLE };
}

export function msgFogRevealAll() {
  return { v: PROTOCOL_VERSION, type: MSG.FOG_REVEAL_ALL };
}

export function msgFogHideAll() {
  return { v: PROTOCOL_VERSION, type: MSG.FOG_HIDE_ALL };
}

export function msgTitleCard(act, subtitle = null) {
  return { v: PROTOCOL_VERSION, type: MSG.TITLE_CARD, act, subtitle };
}

export function msgPresentation(enabled) {
  return { v: PROTOCOL_VERSION, type: MSG.PRESENTATION, enabled };
}

// --- Message Validation ---
// Call this on the receiving end before processing.

export function validateMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    return { valid: false, reason: 'Message is not an object' };
  }
  if (!msg.type) {
    return { valid: false, reason: 'Message has no type field' };
  }
  if (msg.v !== undefined && msg.v !== PROTOCOL_VERSION) {
    return {
      valid: false,
      reason: `Protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${msg.v}`
    };
  }
  // Check that the type is one we recognize
  if (!Object.values(MSG).includes(msg.type)) {
    return { valid: false, reason: `Unknown message type: ${msg.type}` };
  }
  return { valid: true };
}
```

### Using the Protocol in the Controller

```js
// In controller/index.html:
import {
  MSG, msgScene, msgModeSwitch, msgMapLoad, msgEffect,
  msgTokenAdd, msgTokenLoadPreset, msgTokenRemoveAll,
  msgHeat, msgBrazier, msgInitiativeNext,
  msgCameraZoom, msgCameraPan, msgCameraReset,
  msgGridToggle, msgFogRevealAll, msgFogHideAll,
  msgStateRequest, validateMessage
} from '../shared/protocol.js';

// Before (ad-hoc):
send({ type: 'scene', sceneId: SCENES[sceneIndex].id });

// After (typed):
send(msgScene(SCENES[sceneIndex].id));

// Before (easy to typo):
send({ type: 'mode:switch', mode: 'theater' });

// After (autocomplete-friendly):
send(msgModeSwitch('theater'));
```

### Using the Protocol in the VTT Receiver

```js
// In vtt/js/state.js, update handleSyncMessage:
import { MSG, validateMessage, msgStateSync } from '../../shared/protocol.js';

function handleSyncMessage(msg) {
  const check = validateMessage(msg);
  if (!check.valid) {
    console.warn('[VTT] Invalid message:', check.reason, msg);
    return;
  }

  switch (msg.type) {
    case MSG.HEAT:
      state.heat = msg.level;
      break;

    case MSG.SCENE:
      EventBus.emit('scene:goto', msg.sceneId);
      break;

    case MSG.MAP_LOAD:
      EventBus.emit('map:load', msg.mapId);
      break;

    case MSG.MODE_SWITCH:
      EventBus.emit('mode:switch', msg.mode);
      break;

    // ... (replace all string literals with MSG.* constants)

    default:
      console.log('[VTT] Unhandled message type:', msg.type);
  }

  broadcastState();
}
```

### Testing Protocol

```
[ ] Send a valid message from Controller: verify VTT processes it.
[ ] Send a message with a typo'd type from the console:
    channel.postMessage({ type: 'sceen', sceneId: 'S01' })
    Verify: VTT logs "Unknown message type: sceen" instead of silently failing.
[ ] Send a message with wrong protocol version:
    channel.postMessage({ v: 99, type: 'scene', sceneId: 'S01' })
    Verify: VTT logs version mismatch warning.
[ ] Send a non-object message:
    channel.postMessage('hello')
    Verify: VTT logs "Message is not an object" instead of crashing.
[ ] Verify all Controller buttons still work after migration to factories.
```

---

## 7. Long-Term Roadmap Tie-Ins

This section maps every pattern in your current codebase to its future-platform equivalent. Keep this as a reference when you start the real build.

### Reactive Store to Zustand

Your `createStore()` with `subscribe(key, fn)` maps almost 1:1 to Zustand:

```js
// Current (vanilla Proxy store):
const store = createStore({ mode: 'theater', sceneIndex: 0 });
store.subscribe('mode', (mode) => updateUI(mode));
store.state.mode = 'map';

// Future (Zustand):
const useStore = create((set) => ({
  mode: 'theater',
  sceneIndex: 0,
  setMode: (mode) => set({ mode }),
  setScene: (index) => set({ sceneIndex: index }),
}));

// In a React component:
function ModeButtons() {
  const mode = useStore(state => state.mode);
  const setMode = useStore(state => state.setMode);
  return <button onClick={() => setMode('map')}>{mode}</button>;
}
```

The `subscribe(key, fn)` pattern becomes Zustand's selector pattern. The `replaceKey` for nested objects becomes the standard `set({ initiative: { ...state.initiative, round: 2 } })` pattern. The `subscribeAll` for persistence becomes Zustand's `subscribe` middleware. Every instinct you build now transfers.

### BroadcastChannel to WebSocket

Your message protocol maps directly:

```js
// Current (BroadcastChannel):
channel.postMessage(msgScene('S08'));

// Future (WebSocket via Liveblocks or custom):
room.broadcastEvent({ type: MSG.SCENE, sceneId: 'S08' });

// Or with Yjs awareness:
awareness.setLocalStateField('lastAction', msgScene('S08'));
```

The MSG constants, the factory functions, and the validation function all transfer unchanged. You'll add authentication and room scoping on top, but the message shapes stay the same.

### Canvas Layers to PixiJS Containers

Your multi-canvas stack maps to PixiJS's container hierarchy:

```
Current (HTML Canvas layers):          Future (PixiJS):
#map-bg     (z-index: 0)        →     app.stage.addChild(bgContainer)
#map-fog    (z-index: 1)        →     app.stage.addChild(fogContainer)
#map-grid   (z-index: 2)        →     app.stage.addChild(gridContainer)
#map-tokens (z-index: 3)        →     app.stage.addChild(tokenContainer)
#map-effects(z-index: 4)        →     app.stage.addChild(effectsContainer)
```

Your `Camera.applyTransform(ctx)` becomes setting the transform on the stage container. Your `MapRenderer.drawGrid()` becomes creating `PIXI.Graphics` line objects. Your `TokenManager.draw()` becomes creating `PIXI.Sprite` objects. The *concepts* (layered rendering, camera transforms, hit testing) are identical; the *API calls* change.

### Campaign Data to Supabase Schema

```sql
-- shared/campaign-data.js becomes database tables:

CREATE TABLE scenes (
  id TEXT PRIMARY KEY,         -- 'S01', 'S02', etc.
  act INTEGER REFERENCES acts(number),
  title TEXT NOT NULL,
  art_url TEXT,
  overlay_text TEXT,
  sort_order INTEGER
);

CREATE TABLE maps (
  id TEXT PRIMARY KEY,         -- 'M01', 'M02', etc.
  title TEXT NOT NULL,
  image_url TEXT,
  grid_size INTEGER DEFAULT 5,
  cols INTEGER,
  rows INTEGER
);

CREATE TABLE tokens (
  id TEXT PRIMARY KEY,         -- 'martin-storm', 'guard', etc.
  name TEXT NOT NULL,
  image_url TEXT,
  border_color TEXT,
  size INTEGER DEFAULT 1,
  is_pc BOOLEAN DEFAULT FALSE,
  is_object BOOLEAN DEFAULT FALSE
);

-- MAP_PRESETS become a junction table:
CREATE TABLE map_presets (
  id TEXT PRIMARY KEY,
  map_id TEXT REFERENCES maps(id),
  label TEXT,
  tokens JSONB  -- [{tokenId, x, y, label}]
);
```

The `getSceneById()` helper becomes `supabase.from('scenes').select().eq('id', id)`. The `validateCampaignData()` function becomes database constraints and foreign keys. The conceptual model is the same.

### Module Structure to React Components

```
Current (ES modules):                   Future (React):
dm-guide/presentation.js        →      components/PresentationOverlay.tsx
dm-guide/combat.js               →      components/CombatTracker.tsx
dm-guide/search.js                →      hooks/useSearch.ts
dm-guide/state.js                 →      store/dmGuideStore.ts (Zustand)
dm-guide/vtt-sync.js              →      hooks/useVttSync.ts
vtt/js/theater.js                 →      components/TheaterView.tsx
vtt/js/map-renderer.js            →      components/MapView.tsx (PixiJS)
vtt/js/token-manager.js           →      components/TokenLayer.tsx
vtt/js/initiative-tracker.js      →      components/InitiativePanel.tsx
```

Each module you create now becomes one component or hook later. The cleaner the module boundaries are today, the easier the migration.

---

## 8. Testing Protocols

### Game Night Rehearsal Checklist

Run this the evening before your session. Every item should take under 30 seconds.

```
SETUP
[ ] Start the local HTTP server
[ ] Open VTT in a browser window (this will be screen-shared)
[ ] Open DM Guide in a separate window
[ ] Open Controller (from the DM Guide's "VTT Controller" button)
[ ] Verify Controller shows "Connected" (green status)

ASSET CHECK
[ ] VTT loading screen: all pre-flight checks green
[ ] Click through scenes S01 through S05: all show art (no gray placeholders)
[ ] Switch to Map mode: M01 loads, grid visible
[ ] Cycle to M06: loads correctly

SYNC CHECK
[ ] In Controller: click Scene > (next). Verify VTT advances.
[ ] In Controller: click Scene < (prev). Verify VTT goes back.
[ ] In Controller: click Map mode button. Verify VTT switches to Map.
[ ] In Controller: click Theater mode button. Verify VTT switches back.
[ ] In DM Guide: click "Present" on Act 1 read-aloud. Verify VTT shows S01.

COMBAT READINESS
[ ] In Controller: select M06-combat preset, click Load Preset.
    Verify: 5 PCs + Locke + 2 Fanatics + 5 Braziers appear on M06.
[ ] In Controller: click Combat mode. Verify initiative panel appears.
[ ] In Controller: click "Next Turn". Verify turn advances.
[ ] In Controller: trigger Divine Smite effect. Verify golden burst on VTT.

RECOVERY CHECK
[ ] Refresh the VTT window (F5). Verify: state restores (not reset to S01).
[ ] Verify Controller reconnects within 4 seconds.

DISCORD PREP
[ ] Start a Discord screen share of the VTT window.
[ ] Verify your friends can see the VTT (ask someone to confirm).
[ ] Verify DM Guide and Controller are NOT visible in the share.
```

### Chaos Testing Protocol

Run this once during development to find edge cases. Not needed before every session.

```
WINDOW CRASHES
[ ] Close the VTT tab. Reopen it. Verify state restores.
[ ] Close the Controller tab. Reopen it. Verify it reconnects.
[ ] Close the DM Guide. Reopen it. Verify AppState loads from localStorage.
[ ] Close ALL three windows. Reopen them in order: VTT, Controller, DM Guide.
    Verify everything reconnects.
[ ] Reopen in reverse order: DM Guide, Controller, VTT.
    Verify Controller picks up VTT state once VTT opens.

RAPID OPERATIONS
[ ] Click Scene Next 20 times as fast as possible. Verify no crash,
    VTT ends up at the right scene, no console errors.
[ ] Toggle between Theater/Map/Combat modes 10 times rapidly.
    Verify no rendering glitches or stuck states.
[ ] Load preset M06-combat, then immediately load M02-infiltration.
    Verify tokens from M06 don't bleed into M02.

MISSING ASSETS
[ ] Rename one scene image to .bak. Load VTT. Verify:
    - Pre-flight catches it
    - VTT still loads
    - That scene shows a placeholder, not a crash
    - All other scenes still work
[ ] Rename it back. Reload. Verify it's fine.

BROADCAST STRESS
[ ] Open the VTT console. Send 100 messages in a loop:
    for (let i = 0; i < 100; i++) {
      new BroadcastChannel('puzzlebox-vtt').postMessage(
        { v: 1, type: 'scene', sceneId: 'S' + String(i % 26 + 1).padStart(2, '0') }
      );
    }
    Verify: VTT doesn't crash, ends on or near S26.

STATE CORRUPTION
[ ] In the console, manually corrupt sessionStorage:
    sessionStorage.setItem('puzzlebox-vtt-state', '{bad json')
    Reload. Verify: VTT starts fresh (doesn't crash on parse error).
[ ] Set a state version mismatch:
    sessionStorage.setItem('puzzlebox-vtt-state', '{"_version":99}')
    Reload. Verify: VTT starts fresh (rejects wrong version).
```

### Live Session Console Commands

Keep these in a text file next to your DM notes. If something goes weird during the session, these are your escape hatches:

```js
// === EMERGENCY COMMANDS (run in VTT browser console) ===

// Jump to a specific scene
window.__vtt.EventBus.emit('scene:goto', 'S13');

// Force mode switch
window.__vtt.EventBus.emit('mode:switch', 'theater');
window.__vtt.EventBus.emit('mode:switch', 'map');
window.__vtt.EventBus.emit('mode:switch', 'initiative');

// Load a specific map
window.__vtt.EventBus.emit('map:load', 'M06');

// Load the final battle preset
window.__vtt.tokenManager.loadPreset('M06-combat');

// Clear all tokens
window.__vtt.tokenManager.removeAllTokens?.() ||
  window.__vtt.EventBus.emit('token:remove-all');

// Reset camera
window.__vtt.mapRenderer.camera.fitToSize(
  window.__vtt.mapRenderer._mapWorldW,
  window.__vtt.mapRenderer._mapWorldH
);

// Check current state
console.table({
  mode: window.__vtt.state.mode,
  scene: window.__vtt.state.sceneIndex,
  map: window.__vtt.state.mapId,
  heat: window.__vtt.state.heat,
  tokens: window.__vtt.state.tokens?.length ?? 0
});

// Force state save (if persistence is set up)
window.__vtt.store?.snapshot &&
  sessionStorage.setItem('puzzlebox-vtt-state',
    JSON.stringify({ ...window.__vtt.store.snapshot(), _savedAt: Date.now(), _version: 1 }));

// Nuclear option: full reload
location.reload();
```

---

## Prioritized Implementation Order

If you have limited time before game night, here's the order that maximizes reliability per hour invested:

| Priority | Task | Time | Impact |
|----------|------|------|--------|
| 1 | Extract shared data (Section 1) | 2 hours | Eliminates data sync bugs |
| 2 | State persistence + resume (Section 3) | 1.5 hours | Survives accidental refresh |
| 3 | Pre-flight check (Section 4) | 1.5 hours | Catches problems before session |
| 4 | Error overlay (Section 3) | 30 min | Visible crash recovery |
| 5 | Protocol constants (Section 6, just MSG + factories) | 1 hour | Prevents silent message failures |
| 6 | Reactive store (Section 2) | 3 hours | Eliminates state/event desync bugs |
| 7 | DM Guide split (Section 5) | 3 hours | Organizational, no behavior change |
| 8 | Full protocol validation (Section 6) | 1 hour | Polish |

Items 1 through 4 are the "game night insurance" tier. Do those first.

Items 5 through 8 are the "future platform foundations" tier. Do those when you have time after the session.

---

*Last updated: February 2026. Written for the Puzzle-Box Job VTT, version as of QA Round 2 completion.*
