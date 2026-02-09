// VTT State — Reactive store + EventBus + BroadcastChannel

import { createStore } from './store.js';

export const EventBus = {
  _listeners: {},
  on(event, fn) { (this._listeners[event] ||= []).push(fn); },
  off(event, fn) {
    const list = this._listeners[event];
    if (list) this._listeners[event] = list.filter(f => f !== fn);
  },
  emit(event, data) {
    const list = this._listeners[event];
    if (list) { for (const fn of list) fn(data); }
  }
};

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
  fog: {},               // Nested (mapId -> array) — intentionally non-reactive
  titleCardVisible: false,
  presentationMode: false,
  loaded: false
});

export { store };
export const state = store.state;

// Bridges: store -> EventBus

store.subscribe('mode', (mode, prev) => {
  EventBus.emit('mode:changed', { mode, prev });
});

store.subscribe('heat', (level) => {
  EventBus.emit('heat:change', level);
});

store.subscribe('initiative', (data) => {
  EventBus.emit('initiative:update', data);
});

store.subscribe('titleCardVisible', (visible) => {
  if (visible) EventBus.emit('title-card:visible');
});

store.subscribe('presentationMode', (enabled) => {
  document.body.classList.toggle('presentation', enabled);
  EventBus.emit('presentation:change', enabled);
});

// BroadcastChannel

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

// Auto-broadcast on any store change (microtask-debounced)
let _broadcastTimer = null;
store.subscribeAll(() => {
  if (!channel || _broadcastTimer) return;
  _broadcastTimer = setTimeout(() => {
    _broadcastTimer = null;
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
    // State changes (bridges handle EventBus emit)
    case 'heat':
      state.heat = msg.level;
      break;

    case 'initiative':
      state.initiative = { ...state.initiative, ...msg.data };
      break;

    case 'initiative:next':
      state.initiative = {
        ...state.initiative,
        currentTurn: msg.currentTurn,
        round: msg.round
      };
      break;

    case 'combat:start':
      state.initiative = {
        ...state.initiative,
        ...(msg.data || {}),
        active: true
      };
      EventBus.emit('combat:start', state.initiative);
      break;

    case 'combat:end':
      state.initiative = { ...state.initiative, active: false };
      EventBus.emit('combat:end');
      break;

    case 'grid:toggle':
      state.gridVisible = !state.gridVisible;
      break;

    case 'presentation':
      state.presentationMode = msg.enabled;
      break;

    // Command events (relayed to EventBus)
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
        for (const [index, lit] of msg.braziers.entries()) {
          EventBus.emit('brazier:toggle', { index, lit });
        }
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
      break;

    default:
      console.log('[VTT] Unknown sync message:', msg.type);
  }
}
