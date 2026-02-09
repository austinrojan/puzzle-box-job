// shared/campaign-data.js — Dynamic campaign loader
//
// All existing imports throughout the codebase continue to work:
//   import { SCENES, MAPS, TOKENS } from '../../shared/campaign-data.js';
//
// These bindings start empty and are populated by loadCampaign().
// loadCampaign() MUST be called before any module reads these values.

// --- Live-binding exports (populated by loadCampaign) ---

export let SCENES = [];
export let ACTS = [];
export let MAPS = [];
export let TOKENS = {};
export let MAP_PRESETS = {};
export let EFFECTS = {};
export let CONDITIONS = [];
export let CONDITION_COLORS = {};

// Campaign metadata
export const CAMPAIGN = {
  id: null,
  title: '',
  assetBase: '',
  broadcastChannel: 'vtt',
  storagePrefix: 'vtt',
  manifest: null
};

// --- Lookup helpers (operate on live arrays) ---

export function getSceneById(id) {
  return SCENES.find(s => s.id === id) ?? null;
}

export function getTokenDef(tokenId) {
  return TOKENS[tokenId] ?? null;
}

function findDuplicateIds(items, label) {
  const seen = new Set();
  const dupes = [];
  for (const item of items) {
    if (seen.has(item.id)) dupes.push(`Duplicate ${label} ID: ${item.id}`);
    seen.add(item.id);
  }
  return dupes;
}

export function validateCampaignData() {
  const errors = [];
  for (const scene of SCENES) {
    if (!ACTS.find(a => a.number === scene.act)) {
      errors.push(`Scene "${scene.id}" references non-existent act ${scene.act}`);
    }
  }
  errors.push(...findDuplicateIds(SCENES, 'scene'));
  errors.push(...findDuplicateIds(MAPS, 'map'));
  const tokenIds = new Set(Object.keys(TOKENS));
  for (const [presetId, preset] of Object.entries(MAP_PRESETS)) {
    if (!MAPS.find(m => m.id === preset.mapId)) {
      errors.push(`Preset "${presetId}" references non-existent map "${preset.mapId}"`);
    }
    for (const t of preset.tokens || []) {
      if (!tokenIds.has(t.tokenId)) {
        errors.push(`Preset "${presetId}" token references unknown tokenId "${t.tokenId}"`);
      }
    }
  }
  return errors;
}

// --- Campaign loader ---

function resolveAssetPaths(data, base) {
  const resolve = (path) => {
    if (!path || path.startsWith('http') || path.startsWith('/')) return path;
    return base + path;
  };
  for (const s of data.SCENES || []) s.art = resolve(s.art);
  for (const m of data.MAPS || []) m.image = resolve(m.image);
  for (const t of Object.values(data.TOKENS || {})) t.image = resolve(t.image);
}

export async function loadCampaign() {
  const campaignId = new URLSearchParams(window.location.search).get('campaign') || 'puzzle-box';
  const base = new URL(`../campaigns/${campaignId}/`, import.meta.url).href;

  function replaceArray(target, source) {
    target.length = 0;
    target.push(...source);
  }

  function replaceObject(target, source) {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, source);
  }

  // 1. Fetch manifest
  const resp = await fetch(base + 'campaign.json');
  if (!resp.ok) throw new Error(`Campaign "${campaignId}" not found at ${base}campaign.json`);
  const manifest = await resp.json();

  // 2. Dynamic import of campaign VTT data
  const mod = await import(base + manifest.files.vttData);

  // 3. Shallow-copy imported data so we can mutate paths
  const data = {
    SCENES: (mod.SCENES || []).map(s => ({ ...s })),
    ACTS: [...(mod.ACTS || [])],
    MAPS: (mod.MAPS || []).map(m => ({ ...m })),
    TOKENS: Object.fromEntries(Object.entries(mod.TOKENS || {}).map(([k, v]) => [k, { ...v }])),
    MAP_PRESETS: { ...(mod.MAP_PRESETS || {}) },
    EFFECTS: { ...(mod.EFFECTS || {}) },
    CONDITIONS: [...(mod.CONDITIONS || [])]
  };

  // 4. Resolve asset paths
  resolveAssetPaths(data, base);

  // 5. Populate live bindings
  replaceArray(SCENES, data.SCENES);
  replaceArray(ACTS, data.ACTS);
  replaceArray(MAPS, data.MAPS);
  replaceArray(CONDITIONS, data.CONDITIONS);
  replaceObject(TOKENS, data.TOKENS);
  replaceObject(MAP_PRESETS, data.MAP_PRESETS);
  replaceObject(EFFECTS, data.EFFECTS);

  // Derive CONDITION_COLORS from CONDITIONS
  replaceObject(CONDITION_COLORS, Object.fromEntries(
    CONDITIONS.map(c => [c.id, c.color])
  ));

  // 6. Set campaign metadata
  CAMPAIGN.id = manifest.id;
  CAMPAIGN.title = manifest.title;
  CAMPAIGN.assetBase = base;
  CAMPAIGN.broadcastChannel = manifest.broadcastChannel || campaignId + '-vtt';
  CAMPAIGN.storagePrefix = manifest.storage?.prefix || campaignId;
  CAMPAIGN.manifest = manifest;

  console.log(`[Campaign] Loaded "${manifest.title}" — ${SCENES.length} scenes, ${MAPS.length} maps, ${Object.keys(TOKENS).length} tokens`);
  return manifest;
}
