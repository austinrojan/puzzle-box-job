// VTT State Persistence — survive refreshes and crashes
//
// Uses sessionStorage (not localStorage) so state clears when the browser
// closes entirely, but survives refresh/navigation within the tab.

import { SCENES, MAPS, TOKENS, CAMPAIGN } from './data.js';

function getStorageKey() {
  return CAMPAIGN.storagePrefix + '-vtt-state';
}
const SAVE_DEBOUNCE_MS = 500;
const STALENESS_MS = 4 * 60 * 60 * 1000; // 4 hours
const STATE_VERSION = 1;

let _saveTimer = null;

// Keys worth persisting. Transient UI state (titleCardVisible,
// presentationMode, loaded) is deliberately excluded.
const PERSIST_KEYS = [
  'mode', 'sceneIndex', 'mapId', 'heat',
  'initiative', 'tokens', 'gridVisible', 'fog'
];

function saveState(snapshot) {
  const toSave = {};
  for (const key of PERSIST_KEYS) {
    toSave[key] = snapshot[key];
  }
  toSave._savedAt = Date.now();
  toSave._version = STATE_VERSION;

  try {
    sessionStorage.setItem(getStorageKey(), JSON.stringify(toSave));
  } catch (err) {
    console.warn('[VTT] State save failed:', err);
  }
}

// Wire to store.subscribeAll() for debounced auto-save.
export function initAutoSave(store) {
  store.subscribeAll(() => {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => saveState(store.snapshot()), SAVE_DEBOUNCE_MS);
  });
}

// Immediate save for beforeunload — bypasses debounce.
export function saveImmediate(store) {
  clearTimeout(_saveTimer);
  saveState(store.snapshot());
}

// Load saved state from sessionStorage.
// Returns null if missing, corrupt, stale, or wrong version.
export function loadSavedState() {
  try {
    const raw = sessionStorage.getItem(getStorageKey());
    if (!raw) return null;

    const saved = JSON.parse(raw);

    if (saved._version !== STATE_VERSION) {
      console.warn('[VTT] Saved state version mismatch, discarding');
      clearSavedState();
      return null;
    }

    if (Date.now() - saved._savedAt > STALENESS_MS) {
      console.warn('[VTT] Saved state is stale (>4h), discarding');
      clearSavedState();
      return null;
    }

    return saved;
  } catch (err) {
    console.warn('[VTT] State load failed:', err);
    clearSavedState();
    return null;
  }
}

// Clear saved state. Exposed on window.__vtt for debugging.
export function clearSavedState() {
  sessionStorage.removeItem(getStorageKey());
  console.log('[VTT] Saved state cleared');
}

// Validate and sanitize restored state.
// Clamps out-of-bounds values, drops unknown token/map references.
export function validateRestoredState(saved) {
  const clean = {};

  if (['theater', 'map', 'initiative'].includes(saved.mode)) {
    clean.mode = saved.mode;
  }

  if (typeof saved.sceneIndex === 'number') {
    clean.sceneIndex = Math.max(0, Math.min(saved.sceneIndex, SCENES.length - 1));
  }

  if (saved.mapId) {
    if (MAPS.some(m => m.id === saved.mapId)) {
      clean.mapId = saved.mapId;
    } else {
      console.warn(`[VTT] Restored mapId "${saved.mapId}" not found, ignoring`);
      clean.mapId = null;
    }
  }

  if (typeof saved.heat === 'number') {
    clean.heat = Math.max(0, Math.min(saved.heat, 3));
  }

  if (typeof saved.gridVisible === 'boolean') {
    clean.gridVisible = saved.gridVisible;
  }

  if (saved.initiative && typeof saved.initiative === 'object') {
    const entries = Array.isArray(saved.initiative.entries) ? saved.initiative.entries : [];
    const maxTurn = Math.max(0, entries.length - 1);
    clean.initiative = {
      active: !!saved.initiative.active,
      round: Math.max(1, saved.initiative.round || 1),
      currentTurn: Math.min(Math.max(0, saved.initiative.currentTurn || 0), maxTurn),
      entries
    };
  }

  if (Array.isArray(saved.tokens)) {
    clean.tokens = saved.tokens.filter(t => {
      if (!t || !t.tokenId || !TOKENS[t.tokenId]) {
        console.warn(`[VTT] Restored token references unknown tokenId "${t?.tokenId}", dropping`);
        return false;
      }
      return true;
    });
  }

  if (saved.fog && typeof saved.fog === 'object') {
    clean.fog = {};
    for (const [mapId, cells] of Object.entries(saved.fog)) {
      if (MAPS.some(m => m.id === mapId) && Array.isArray(cells)) {
        clean.fog[mapId] = cells;
      }
    }
  }

  return clean;
}
