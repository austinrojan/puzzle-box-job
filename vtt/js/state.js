// VTT State — Reactive store + EventBus + BroadcastChannel

import { createStore } from './store.js';
import { MSG, validateMessage, createStateSyncMsg } from '../../shared/protocol.js';
import { CAMPAIGN } from './data.js';

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
    channel = new BroadcastChannel(CAMPAIGN.broadcastChannel);
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
  channel.postMessage(createStateSyncMsg({
    mode: state.mode,
    sceneIndex: state.sceneIndex,
    mapId: state.mapId,
    heat: state.heat,
    initiative: state.initiative,
    presentationMode: state.presentationMode,
    tokens: state.tokens,
    gridVisible: state.gridVisible
  }));
}

function handleSyncMessage(msg) {
  const result = validateMessage(msg);
  if (!result.valid) {
    if (msg?.type) console.warn('[VTT] Invalid message:', result.error, msg);
    return;
  }

  switch (msg.type) {
    // State changes (bridges handle EventBus emit)
    case MSG.HEAT:
      state.heat = msg.level;
      break;

    case MSG.INITIATIVE:
      state.initiative = { ...state.initiative, ...msg.data };
      break;

    case MSG.INITIATIVE_NEXT:
      state.initiative = {
        ...state.initiative,
        currentTurn: msg.currentTurn,
        round: msg.round
      };
      break;

    case MSG.COMBAT_START:
      state.initiative = {
        ...state.initiative,
        ...(msg.data || {}),
        active: true
      };
      EventBus.emit('combat:start', state.initiative);
      break;

    case MSG.COMBAT_END:
      state.initiative = { ...state.initiative, active: false };
      EventBus.emit('combat:end');
      break;

    case MSG.GRID_TOGGLE:
      state.gridVisible = !state.gridVisible;
      break;

    case MSG.PRESENTATION:
      state.presentationMode = msg.enabled;
      break;

    // Command events (relayed to EventBus)
    case MSG.SCENE:
      EventBus.emit('scene:goto', msg.sceneId);
      break;

    case MSG.MAP:
      EventBus.emit('map:load', msg.mapId);
      break;

    case MSG.BRAZIER:
      if (typeof msg.index === 'number') {
        EventBus.emit('brazier:toggle', { index: msg.index, lit: msg.lit });
      } else if (Array.isArray(msg.braziers)) {
        for (const [index, lit] of msg.braziers.entries()) {
          EventBus.emit('brazier:toggle', { index, lit });
        }
      }
      break;

    case MSG.EFFECT:
      EventBus.emit('effect:trigger', msg);
      break;

    case MSG.TITLE_CARD:
      EventBus.emit('title-card:show', msg);
      break;

    case MSG.OVERLAY_TEXT:
      EventBus.emit('overlay-text:show', msg);
      break;

    case MSG.MODE_SWITCH:
      EventBus.emit('mode:switch', msg.mode);
      break;

    case MSG.TOKEN_ADD:
      EventBus.emit('token:add', msg);
      break;

    case MSG.TOKEN_REMOVE_ALL:
      EventBus.emit('token:remove-all');
      break;

    case MSG.TOKEN_LOAD_PRESET:
      EventBus.emit('token:load-preset', msg.presetId);
      break;

    case MSG.FOG_REVEAL_ALL:
      EventBus.emit('fog:reveal-all');
      break;

    case MSG.FOG_HIDE_ALL:
      EventBus.emit('fog:hide-all');
      break;

    case MSG.CAMERA_ZOOM:
      EventBus.emit('camera:zoom', msg.direction);
      break;

    case MSG.CAMERA_PAN:
      EventBus.emit('camera:pan', { dx: msg.dx, dy: msg.dy });
      break;

    case MSG.CAMERA_RESET:
      EventBus.emit('camera:reset');
      break;

    case MSG.CAMERA_STATE:
      EventBus.emit('camera:set-state', {
        x: msg.x,
        y: msg.y,
        zoom: msg.zoom
      });
      break;

    case MSG.CAMERA_ZOOM_PAST_COVER:
      EventBus.emit('camera:zoom-past-cover', msg.enabled);
      break;

    case MSG.TOKEN_UPDATE_CONDITION:
      EventBus.emit('token:update-condition', {
        instanceId: msg.instanceId, condition: msg.condition, enabled: msg.enabled
      });
      break;

    case MSG.TOKEN_REMOVE_ONE:
      EventBus.emit('token:remove-one', msg.instanceId);
      break;

    case MSG.TOKEN_VISIBILITY:
      EventBus.emit('token:visibility', { instanceId: msg.instanceId, visible: msg.visible });
      break;

    case MSG.STATE_REQUEST:
      broadcastState();
      break;

    default:
      console.warn('[VTT] Unhandled sync message:', msg.type);
  }
}
