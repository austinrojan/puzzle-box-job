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
  TOKEN_UPDATE_CONDITION:  'token:update-condition',
  TOKEN_REMOVE_ONE:        'token:remove-one',
  TOKEN_VISIBILITY:        'token:visibility',
  STATE_REQUEST:           'state:request',
  STATE_SYNC:              'state:sync',
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
  [MSG.TOKEN_UPDATE_CONDITION]: ['instanceId', 'condition', 'enabled'],
  [MSG.TOKEN_REMOVE_ONE]:       ['instanceId'],
  [MSG.TOKEN_VISIBILITY]:       ['instanceId', 'visible'],
  [MSG.STATE_REQUEST]:          [],
  [MSG.STATE_SYNC]:             ['data'],
};

// --- Factory functions ---

export function createHeatMsg(level) {
  return { type: MSG.HEAT, level, _v: PROTOCOL_VERSION };
}

export function createInitiativeMsg(data) {
  return { type: MSG.INITIATIVE, data, _v: PROTOCOL_VERSION };
}

export function createInitiativeNextMsg(currentTurn, round) {
  return { type: MSG.INITIATIVE_NEXT, currentTurn, round, _v: PROTOCOL_VERSION };
}

export function createCombatStartMsg(data) {
  return { type: MSG.COMBAT_START, data, _v: PROTOCOL_VERSION };
}

export function createCombatEndMsg() {
  return { type: MSG.COMBAT_END, _v: PROTOCOL_VERSION };
}

export function createGridToggleMsg() {
  return { type: MSG.GRID_TOGGLE, _v: PROTOCOL_VERSION };
}

export function createPresentationMsg(enabled) {
  return { type: MSG.PRESENTATION, enabled, _v: PROTOCOL_VERSION };
}

export function createSceneMsg(sceneId) {
  return { type: MSG.SCENE, sceneId, _v: PROTOCOL_VERSION };
}

export function createMapMsg(mapId) {
  return { type: MSG.MAP, mapId, _v: PROTOCOL_VERSION };
}

export function createBrazierMsg({ index, lit, braziers } = {}) {
  const msg = { type: MSG.BRAZIER, _v: PROTOCOL_VERSION };
  if (index !== undefined) msg.index = index;
  if (lit !== undefined) msg.lit = lit;
  if (braziers !== undefined) msg.braziers = braziers;
  return msg;
}

export function createEffectMsg(effectId, target) {
  return { type: MSG.EFFECT, effectId, ...target, _v: PROTOCOL_VERSION };
}

export function createTitleCardMsg(act) {
  return { type: MSG.TITLE_CARD, act, _v: PROTOCOL_VERSION };
}

export function createOverlayTextMsg(text) {
  return { type: MSG.OVERLAY_TEXT, text, _v: PROTOCOL_VERSION };
}

export function createModeSwitchMsg(mode) {
  return { type: MSG.MODE_SWITCH, mode, _v: PROTOCOL_VERSION };
}

export function createTokenAddMsg({ tokenId, x, y, label }) {
  return { type: MSG.TOKEN_ADD, tokenId, x, y, label, _v: PROTOCOL_VERSION };
}

export function createTokenRemoveAllMsg() {
  return { type: MSG.TOKEN_REMOVE_ALL, _v: PROTOCOL_VERSION };
}

export function createTokenLoadPresetMsg(presetId) {
  return { type: MSG.TOKEN_LOAD_PRESET, presetId, _v: PROTOCOL_VERSION };
}

export function createFogRevealAllMsg() {
  return { type: MSG.FOG_REVEAL_ALL, _v: PROTOCOL_VERSION };
}

export function createFogHideAllMsg() {
  return { type: MSG.FOG_HIDE_ALL, _v: PROTOCOL_VERSION };
}

export function createCameraZoomMsg(direction) {
  return { type: MSG.CAMERA_ZOOM, direction, _v: PROTOCOL_VERSION };
}

export function createCameraPanMsg(dx, dy) {
  return { type: MSG.CAMERA_PAN, dx, dy, _v: PROTOCOL_VERSION };
}

export function createCameraResetMsg() {
  return { type: MSG.CAMERA_RESET, _v: PROTOCOL_VERSION };
}

export function createTokenUpdateConditionMsg(instanceId, condition, enabled) {
  return { type: MSG.TOKEN_UPDATE_CONDITION, instanceId, condition, enabled, _v: PROTOCOL_VERSION };
}

export function createTokenRemoveOneMsg(instanceId) {
  return { type: MSG.TOKEN_REMOVE_ONE, instanceId, _v: PROTOCOL_VERSION };
}

export function createTokenVisibilityMsg(instanceId, visible) {
  return { type: MSG.TOKEN_VISIBILITY, instanceId, visible, _v: PROTOCOL_VERSION };
}

export function createStateRequestMsg() {
  return { type: MSG.STATE_REQUEST, _v: PROTOCOL_VERSION };
}

export function createStateSyncMsg(data) {
  return { type: MSG.STATE_SYNC, data, _v: PROTOCOL_VERSION };
}

// --- Validation ---

export function validateMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    return { valid: false, error: 'Message is not an object' };
  }
  if (!msg.type) {
    return { valid: false, error: 'Message has no type' };
  }
  if (!MSG_VALUES.has(msg.type)) {
    return { valid: false, error: `Unknown message type: "${msg.type}"` };
  }

  // Version check (warn but don't reject — forward-compatible)
  if (msg._v !== undefined && msg._v !== PROTOCOL_VERSION) {
    console.warn(`[Protocol] Version mismatch: expected ${PROTOCOL_VERSION}, got ${msg._v}`);
  }

  const required = REQUIRED_FIELDS[msg.type];
  if (required) {
    for (const field of required) {
      if (msg[field] === undefined) {
        return { valid: false, error: `Missing field "${field}" for ${msg.type}` };
      }
    }
  }

  return { valid: true };
}
