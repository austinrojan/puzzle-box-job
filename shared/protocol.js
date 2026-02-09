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
