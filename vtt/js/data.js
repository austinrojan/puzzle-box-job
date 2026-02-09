// VTT Data — Re-export shim
// All campaign data lives in shared/campaign-data.js.
// This file preserves existing import paths for VTT modules.

export {
  SCENES, ACTS, MAPS, TOKENS, MAP_PRESETS, EFFECTS,
  CONDITIONS, CONDITION_COLORS,
  CAMPAIGN, loadCampaign, getSceneById, getTokenDef, validateCampaignData
} from '../../shared/campaign-data.js';
