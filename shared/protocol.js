// BroadcastChannel Protocol — shared constants, factories, validation
// Used by VTT, Controller, and DM Guide

export const PROTOCOL_VERSION = 1;

// Message type constants
export const MSG = Object.freeze({
  HEAT:                    'heat',
  INITIATIVE:              'initiative',
  INITIATIVE_NEXT:         'initiative:next',
  COMBAT_START:            'combat:start',
  COMBAT_END:              'combat:end',
  GRID_TOGGLE:             'grid:toggle',
  PRESENTATION:            'presentation',
  SCENE:                   'scene',
  MAP:                     'map',
  BRAZIER:                 'brazier',
  EFFECT:                  'effect',
  TITLE_CARD:              'title-card',
  OVERLAY_TEXT:             'overlay-text',
  MODE_SWITCH:             'mode:switch',
  TOKEN_ADD:               'token:add',
  TOKEN_REMOVE_ALL:        'token:remove-all',
  TOKEN_LOAD_PRESET:       'token:load-preset',
  FOG_REVEAL_ALL:          'fog:reveal-all',
  FOG_HIDE_ALL:            'fog:hide-all',
  CAMERA_ZOOM:             'camera:zoom',
  CAMERA_PAN:              'camera:pan',
  CAMERA_RESET:            'camera:reset',
  CAMERA_STATE:            'camera:state',
  CAMERA_ZOOM_PAST_COVER:  'camera:zoom-past-cover',
  TOKEN_UPDATE_CONDITION:  'token:update-condition',
  TOKEN_REMOVE_ONE:        'token:remove-one',
  TOKEN_VISIBILITY:        'token:visibility',
  STATE_REQUEST:           'state:request',
  STATE_SYNC:              'state:sync',

  // Phase 4: Camera sync
  CAMERA_SYNC:             'camera:sync',
  CAMERA_JUMP_TO:          'camera:jump-to',

  // Phase 4: Window lifecycle
  ANNOUNCE:                'window:announce',
  WELCOME:                 'window:welcome',
  HEARTBEAT:               'window:heartbeat',
  GOODBYE:                 'window:goodbye',

  // Phase 5: Cinematic camera
  CAMERA_FLY_TO:           'camera:fly-to',
  PRESET_SYNC:             'preset:sync',
  AUTHORITY_CLAIM:         'authority:claim',
});

// O(1) lookup set for validation
const MSG_VALUES = new Set(Object.values(MSG));

// Required fields per message type (beyond `type` and `_v`)
const REQUIRED_FIELDS = {
  [MSG.HEAT]:                   ['level'],
  [MSG.INITIATIVE]:             ['data'],
  [MSG.INITIATIVE_NEXT]:        ['currentTurn', 'round'],
  [MSG.COMBAT_START]:           [],
  [MSG.COMBAT_END]:             [],
  [MSG.GRID_TOGGLE]:            [],
  [MSG.PRESENTATION]:           ['enabled'],
  [MSG.SCENE]:                  ['sceneId'],
  [MSG.MAP]:                    ['mapId'],
  [MSG.BRAZIER]:                [],
  [MSG.EFFECT]:                 ['effectId'],
  [MSG.TITLE_CARD]:             ['act'],
  [MSG.OVERLAY_TEXT]:           ['text'],
  [MSG.MODE_SWITCH]:            ['mode'],
  [MSG.TOKEN_ADD]:              ['tokenId', 'x', 'y', 'label'],
  [MSG.TOKEN_REMOVE_ALL]:       [],
  [MSG.TOKEN_LOAD_PRESET]:      ['presetId'],
  [MSG.FOG_REVEAL_ALL]:         [],
  [MSG.FOG_HIDE_ALL]:           [],
  [MSG.CAMERA_ZOOM]:            ['direction'],
  [MSG.CAMERA_PAN]:             ['dx', 'dy'],
  [MSG.CAMERA_RESET]:           [],
  [MSG.CAMERA_STATE]:           ['x', 'y', 'zoom'],
  [MSG.CAMERA_ZOOM_PAST_COVER]: ['enabled'],
  [MSG.TOKEN_UPDATE_CONDITION]: ['instanceId', 'condition', 'enabled'],
  [MSG.TOKEN_REMOVE_ONE]:       ['instanceId'],
  [MSG.TOKEN_VISIBILITY]:       ['instanceId', 'visible'],
  [MSG.STATE_REQUEST]:          [],
  [MSG.STATE_SYNC]:             ['data'],

  // Phase 4: Camera sync
  [MSG.CAMERA_SYNC]:            ['centerX', 'centerY', 'zoom', 'seq', 'senderId'],
  [MSG.CAMERA_JUMP_TO]:         ['centerX', 'centerY', 'zoom', 'senderId'],

  // Phase 4: Window lifecycle
  [MSG.ANNOUNCE]:               ['windowId', 'role'],
  [MSG.WELCOME]:                ['windowId', 'role', 'targetWindowId', 'camera', 'epoch'],
  [MSG.HEARTBEAT]:              ['windowId', 'role'],
  [MSG.GOODBYE]:                ['windowId'],

  // Phase 5: Cinematic camera
  [MSG.CAMERA_FLY_TO]:          ['target', 'senderId'],
  [MSG.PRESET_SYNC]:            ['presets', 'senderId'],
  [MSG.AUTHORITY_CLAIM]:        ['windowId', 'role'],
};

// --- Factory functions ---

function msg(type, payload) {
  return payload ? { type, ...payload, _v: PROTOCOL_VERSION }
                 : { type, _v: PROTOCOL_VERSION };
}

export const createHeatMsg            = (level) => msg(MSG.HEAT, { level });
export const createInitiativeMsg      = (data) => msg(MSG.INITIATIVE, { data });
export const createInitiativeNextMsg  = (currentTurn, round) => msg(MSG.INITIATIVE_NEXT, { currentTurn, round });
export const createCombatStartMsg     = (data) => data ? msg(MSG.COMBAT_START, { data }) : msg(MSG.COMBAT_START);
export const createCombatEndMsg       = () => msg(MSG.COMBAT_END);
export const createGridToggleMsg      = () => msg(MSG.GRID_TOGGLE);
export const createPresentationMsg    = (enabled) => msg(MSG.PRESENTATION, { enabled });
export const createSceneMsg           = (sceneId) => msg(MSG.SCENE, { sceneId });
export const createMapMsg             = (mapId) => msg(MSG.MAP, { mapId });
export const createTitleCardMsg       = (act) => msg(MSG.TITLE_CARD, { act });
export const createOverlayTextMsg     = (text) => msg(MSG.OVERLAY_TEXT, { text });
export const createModeSwitchMsg      = (mode) => msg(MSG.MODE_SWITCH, { mode });
export const createTokenRemoveAllMsg  = () => msg(MSG.TOKEN_REMOVE_ALL);
export const createTokenLoadPresetMsg = (presetId) => msg(MSG.TOKEN_LOAD_PRESET, { presetId });
export const createFogRevealAllMsg    = () => msg(MSG.FOG_REVEAL_ALL);
export const createFogHideAllMsg      = () => msg(MSG.FOG_HIDE_ALL);
export const createCameraZoomMsg      = (direction) => msg(MSG.CAMERA_ZOOM, { direction });
export const createCameraPanMsg       = (dx, dy) => msg(MSG.CAMERA_PAN, { dx, dy });
export const createCameraResetMsg     = () => msg(MSG.CAMERA_RESET);
export const createCameraStateMsg     = (x, y, zoom) => msg(MSG.CAMERA_STATE, { x, y, zoom });
export const createCameraZoomPastCoverMsg = (enabled) => msg(MSG.CAMERA_ZOOM_PAST_COVER, { enabled });
export const createTokenRemoveOneMsg  = (instanceId) => msg(MSG.TOKEN_REMOVE_ONE, { instanceId });
export const createTokenVisibilityMsg = (instanceId, visible) => msg(MSG.TOKEN_VISIBILITY, { instanceId, visible });
export const createStateRequestMsg    = () => msg(MSG.STATE_REQUEST);
export const createStateSyncMsg       = (data) => msg(MSG.STATE_SYNC, { data });
export const createTokenAddMsg        = ({ tokenId, x, y, label }) => msg(MSG.TOKEN_ADD, { tokenId, x, y, label });

export const createTokenUpdateConditionMsg = (instanceId, condition, enabled) =>
  msg(MSG.TOKEN_UPDATE_CONDITION, { instanceId, condition, enabled });

// Brazier: conditionally includes fields only if not undefined
export function createBrazierMsg({ index, lit, braziers } = {}) {
  const m = msg(MSG.BRAZIER);
  if (index !== undefined) m.index = index;
  if (lit !== undefined) m.lit = lit;
  if (braziers !== undefined) m.braziers = braziers;
  return m;
}

// Effect: spreads target object (col/row) into message
export const createEffectMsg = (effectId, target) => msg(MSG.EFFECT, { effectId, ...target });

// Phase 4: Camera sync factories
export const createCameraSyncMsg = (centerX, centerY, zoom, seq, senderId) =>
  msg(MSG.CAMERA_SYNC, { centerX, centerY, zoom, seq, senderId });

export const createCameraJumpToMsg = (centerX, centerY, zoom, senderId) =>
  msg(MSG.CAMERA_JUMP_TO, { centerX, centerY, zoom, senderId });

export const createAnnounceMsg = (windowId, role) =>
  msg(MSG.ANNOUNCE, { windowId, role });

export const createWelcomeMsg = (windowId, role, targetWindowId, camera, epoch) =>
  msg(MSG.WELCOME, { windowId, role, targetWindowId, camera, epoch });

export const createHeartbeatMsg = (windowId, role) =>
  msg(MSG.HEARTBEAT, { windowId, role });

export const createGoodbyeMsg = (windowId) =>
  msg(MSG.GOODBYE, { windowId });

// Phase 5: Cinematic camera factories
export const createCameraFlyToMsg = (senderId, seq, payload) => ({
  type: MSG.CAMERA_FLY_TO,
  senderId,
  seq,
  ts: performance.timeOrigin + performance.now(),
  ...payload,
  _v: PROTOCOL_VERSION,
});

export const createPresetSyncMsg = (senderId, seq, presets) =>
  msg(MSG.PRESET_SYNC, { presets, senderId, seq });

export const createAuthorityClaimMsg = (windowId, role) =>
  msg(MSG.AUTHORITY_CLAIM, { windowId, role });

// --- Center-point camera model (Phase 4) ---
// Local camera: { x, y, zoom } where (x,y) = top-left world-space corner
// Shared camera: { centerX, centerY, zoom } where (centerX,centerY) = viewport center in world-space
// Derivation: centerX = (viewportW/2) / zoom + camera.x

export function localToShared(camera, viewport) {
  return {
    centerX: camera.x + (viewport.width / 2) / camera.zoom,
    centerY: camera.y + (viewport.height / 2) / camera.zoom,
    zoom: camera.zoom,
  };
}

export function sharedToLocal(shared, viewport) {
  return {
    x: shared.centerX - (viewport.width / 2) / shared.zoom,
    y: shared.centerY - (viewport.height / 2) / shared.zoom,
    zoom: shared.zoom,
  };
}

// --- Validation ---

export function validateMessage(message) {
  if (!message || typeof message !== 'object') {
    return { valid: false, error: 'Message is not an object' };
  }
  if (!message.type) {
    return { valid: false, error: 'Message has no type' };
  }
  if (!MSG_VALUES.has(message.type)) {
    return { valid: false, error: `Unknown message type: "${message.type}"` };
  }

  // Version check (warn but don't reject — forward-compatible)
  if (message._v !== undefined && message._v !== PROTOCOL_VERSION) {
    console.warn(`[Protocol] Version mismatch: expected ${PROTOCOL_VERSION}, got ${message._v}`);
  }

  const required = REQUIRED_FIELDS[message.type];
  if (required) {
    for (const field of required) {
      if (message[field] === undefined) {
        return { valid: false, error: `Missing field "${field}" for ${message.type}` };
      }
    }
  }

  return { valid: true };
}
