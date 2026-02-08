// ============================================
// VTT State — Reactive store + EventBus + BroadcastChannel
// ============================================

import { createStore } from './store.js';

// --- Legacy EventBus (kept during migration) ---
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
  fog: {},               // NOTE: nested (mapId -> array). Direct mutation of
                          // state.fog[mapId] won't trigger subscribers. This is
                          // intentional — no module needs fog reactivity.
                          // Future: use store.replaceKey('fog', {...}) if needed.
  titleCardVisible: false,
  overlayText: null,
  presentationMode: false,
  loaded: false
});

export { store };
export const state = store.state;

// ==============================
// Bridges: store -> legacy EventBus
// Remove each bridge once all its listeners migrate to store.subscribe().
// ==============================

store.subscribe('mode', (mode, prev) => {
  EventBus.emit('mode:changed', { mode, prev });
});

store.subscribe('sceneIndex', (index) => {
  EventBus.emit('scene:loaded', index);
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

store.subscribe('presentationMode', (enabled) => {
  if (enabled) {
    document.body.classList.add('presentation');
  } else {
    document.body.classList.remove('presentation');
  }
  EventBus.emit('presentation:change', enabled);
});

// ==============================
// BroadcastChannel
// ==============================

let channel = null;

export function initSync() {
  try {
    channel = new BroadcastChannel('puzzlebox-vtt');
    channel.onmessage = (e) => handleSyncMessage(e.data);
    console.log('[VTT] BroadcastChannel connected');
  } catch (err) {
    console.warn('[VTT] BroadcastChannel not available:', err);
  }
}

// Auto-broadcast state on ANY store change (debounced to coalesce)
let _bcTimer = null;
store.subscribeAll(() => {
  if (!channel || _bcTimer) return;
  _bcTimer = setTimeout(() => {
    _bcTimer = null;
    broadcastState();
  }, 0);
});

function broadcastState() {
  if (!channel) return;
  channel.postMessage({
    type: 'state:sync',
    data: {
      mode: state.mode,
      sceneIndex: state.sceneIndex,
      mapId: state.mapId,
      heat: state.heat,
      initiative: state.initiative,
      presentationMode: state.presentationMode,
      tokens: state.tokens,
      gridVisible: state.gridVisible
    }
  });
}

function handleSyncMessage(msg) {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    // --- State changes (bridges handle EventBus emit) ---
    case 'heat':
      state.heat = msg.level;
      break;

    case 'initiative':
      store.replaceKey('initiative', { ...state.initiative, ...msg.data });
      break;

    case 'initiative:next':
      store.replaceKey('initiative', {
        ...state.initiative,
        currentTurn: msg.currentTurn,
        round: msg.round
      });
      break;

    case 'combat:start':
      store.replaceKey('initiative', {
        ...state.initiative,
        ...(msg.data || {}),
        active: true
      });
      EventBus.emit('combat:start', state.initiative);
      break;

    case 'combat:end':
      store.replaceKey('initiative', { ...state.initiative, active: false });
      EventBus.emit('combat:end');
      break;

    case 'grid:toggle':
      state.gridVisible = !state.gridVisible;
      break;

    case 'presentation':
      state.presentationMode = msg.enabled;
      break;

    // --- Command events (stay on EventBus) ---
    case 'scene':
      EventBus.emit('scene:goto', msg.sceneId);
      break;

    case 'map':
      EventBus.emit('map:load', msg.mapId);
      break;

    case 'brazier':
      if (typeof msg.index === 'number') {
        EventBus.emit('brazier:toggle', { index: msg.index, lit: msg.lit });
      } else if (Array.isArray(msg.braziers)) {
        msg.braziers.forEach((lit, index) => {
          EventBus.emit('brazier:toggle', { index, lit });
        });
      }
      break;

    case 'effect':
      EventBus.emit('effect:trigger', msg);
      break;

    case 'title-card':
      EventBus.emit('title-card:show', msg);
      break;

    case 'overlay-text':
      EventBus.emit('overlay-text:show', msg);
      break;

    case 'mode:switch':
      EventBus.emit('mode:switch', msg.mode);
      break;

    case 'token:add':
      EventBus.emit('token:add', msg);
      break;

    case 'token:remove-all':
      EventBus.emit('token:remove-all');
      break;

    case 'token:load-preset':
      EventBus.emit('token:load-preset', msg.presetId);
      break;

    case 'fog:reveal-all':
      EventBus.emit('fog:reveal-all');
      break;

    case 'fog:hide-all':
      EventBus.emit('fog:hide-all');
      break;

    case 'camera:zoom':
      EventBus.emit('camera:zoom', msg.direction);
      break;

    case 'camera:pan':
      EventBus.emit('camera:pan', { dx: msg.dx, dy: msg.dy });
      break;

    case 'camera:reset':
      EventBus.emit('camera:reset');
      break;

    case 'token:update-condition':
      EventBus.emit('token:update-condition', {
        instanceId: msg.instanceId, condition: msg.condition, enabled: msg.enabled
      });
      break;

    case 'token:remove-one':
      EventBus.emit('token:remove-one', msg.instanceId);
      break;

    case 'token:visibility':
      EventBus.emit('token:visibility', { instanceId: msg.instanceId, visible: msg.visible });
      break;

    case 'state:request':
      broadcastState();
      return;

    default:
      console.log('[VTT] Unknown sync message:', msg.type);
  }
  // NOTE: broadcastState handled by store.subscribeAll — no manual call needed
}

