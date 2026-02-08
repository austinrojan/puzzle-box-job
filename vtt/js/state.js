// ============================================
// VTT State — AppState + EventBus + BroadcastChannel
// ============================================

// Simple pub/sub event bus
export const EventBus = {
  _listeners: {},

  on(event, fn) {
    (this._listeners[event] ||= []).push(fn);
  },

  off(event, fn) {
    const list = this._listeners[event];
    if (list) this._listeners[event] = list.filter(f => f !== fn);
  },

  emit(event, data) {
    const list = this._listeners[event];
    if (list) list.forEach(fn => fn(data));
  }
};

// VTT application state
export const state = {
  mode: 'theater',         // 'theater' | 'map' | 'initiative'
  sceneIndex: 0,           // current index into SCENES array
  mapId: null,             // current map ID (e.g. 'M06')
  heat: 0,                 // 0=green, 1=amber, 2=red
  initiative: {
    active: false,
    round: 1,
    currentTurn: 0,
    entries: []            // [{id, name, init, hp, maxHp, conditions, tokenId, isPC}]
  },
  tokens: [],              // active tokens on current map
  gridVisible: true,       // grid overlay visible (synced to controller)
  fog: {},                 // mapId -> Set of revealed grid coords "x,y"
  titleCardVisible: false,
  overlayText: null,
  presentationMode: false,
  loaded: false
};

// Initialize BroadcastChannel to receive commands from DM guide
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

function handleSyncMessage(msg) {
  if (!msg || !msg.type) return;
  console.log('[VTT] BC received:', msg.type, msg);

  switch (msg.type) {
    case 'heat':
      state.heat = msg.level;
      EventBus.emit('heat:change', msg.level);
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

    case 'initiative':
      Object.assign(state.initiative, msg.data);
      EventBus.emit('initiative:update', state.initiative);
      break;

    case 'initiative:next':
      state.initiative.currentTurn = msg.currentTurn;
      state.initiative.round = msg.round;
      EventBus.emit('initiative:update', state.initiative);
      break;

    case 'scene':
      EventBus.emit('scene:goto', msg.sceneId);
      break;

    case 'map':
      EventBus.emit('map:load', msg.mapId);
      break;

    case 'combat:start':
      state.initiative.active = true;
      if (msg.data) Object.assign(state.initiative, msg.data);
      EventBus.emit('combat:start', state.initiative);
      break;

    case 'combat:end':
      state.initiative.active = false;
      EventBus.emit('combat:end');
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

    case 'grid:toggle':
      state.gridVisible = !state.gridVisible;
      EventBus.emit('grid:toggle');
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
      return;  // don't double-broadcast below

    case 'presentation':
      state.presentationMode = msg.enabled;
      if (msg.enabled) {
        document.body.classList.add('presentation');
      } else {
        document.body.classList.remove('presentation');
      }
      EventBus.emit('presentation:change', msg.enabled);
      break;

    default:
      console.log('[VTT] Unknown sync message:', msg.type);
  }

  // After handling any message, broadcast current state back to controller
  broadcastState();
}

// Broadcast full VTT state for controller sync
function broadcastState() {
  if (!channel) return;
  console.log('[VTT] BC broadcasting state:sync, mode:', state.mode);
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

// Listen for token state changes from token-manager
EventBus.on('tokens:changed', (tokens) => {
  state.tokens = tokens;
  broadcastState();
});
