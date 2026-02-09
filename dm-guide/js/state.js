import { debounce, deepClone } from './utils.js';
import { CAMPAIGN } from '../../shared/campaign-data.js';
import { COMBAT_CONFIG } from './combat-config.js';

function getStorageKey() {
  return CAMPAIGN.storagePrefix + '-dm-state';
}

// Base default state (campaign-agnostic structure).
// combat.combatants and combat.mechanics are populated from COMBAT_CONFIG at boot.
export const DEFAULT_STATE = {
  tabs: [{ id: 'welcome', type: 'welcome', label: 'Welcome', closeable: false }],
  activeTabId: 'welcome',
  navExpanded: true,
  navWidth: 280,
  collapsed: {},
  combat: null,
  heatLevel: 0,
  intelGathered: {},
  foreshadowing: {},
  keyDecisions: {},
  searchOpen: false,
  presentationBlock: null,
  combatPanelOpen: false,
  scrollPositions: {}
};

export function buildCombatDefaults() {
  return deepClone(COMBAT_CONFIG.defaultState);
}

export const AppState = deepClone(DEFAULT_STATE);

function replaceState(source) {
  for (const key of Object.keys(AppState)) delete AppState[key];
  Object.assign(AppState, source);
}

export function loadState() {
  try {
    const defaults = deepClone(DEFAULT_STATE);
    defaults.combat = buildCombatDefaults();
    const saved = localStorage.getItem(getStorageKey());
    if (saved) {
      replaceState(Object.assign(defaults, JSON.parse(saved)));
    } else {
      replaceState(defaults);
    }
  } catch (e) { console.warn('State load failed:', e); }
}

export const saveState = debounce(() => {
  try {
    const { searchOpen, presentationBlock, ...persistable } = AppState;
    localStorage.setItem(getStorageKey(), JSON.stringify(persistable));
  } catch (e) { console.warn('State save failed:', e); }
}, 300);

export function resetState() {
  const defaults = deepClone(DEFAULT_STATE);
  defaults.combat = buildCombatDefaults();
  replaceState(defaults);
  localStorage.removeItem(getStorageKey());
}
