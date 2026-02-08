// ============================================
// VTT Data — Re-export shim
// All campaign data lives in shared/campaign-data.js.
// This file preserves existing import paths for VTT modules.
// ============================================

export {
  SCENES, ACTS, MAPS, TOKENS, MAP_PRESETS, EFFECTS,
  CONDITIONS, CONDITION_COLORS,
  getSceneById, getSceneIndex, getMapById, getActByNumber, getTokenDef,
  getActForScene, getFirstSceneOfAct,
  validateCampaignData
} from '../../shared/campaign-data.js';

// VTT-specific: keyboard shortcuts for effects (not shared)
export const EFFECT_HOTKEYS = {
  '1': 'divine-smite',
  '2': 'fireball',
  '3': 'counterspell',
  '4': 'healing-word',
  '5': 'spirit-guardians',
  '6': 'brazier-extinguish',
  '7': 'ritual-activate',
  '8': 'rakshasa-reveal',
  '9': 'path-grave-smite',
  '0': 'dominate-person',
};
