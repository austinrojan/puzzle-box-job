import { debounce } from './utils.js';
import { CAMPAIGN } from '../../shared/campaign-data.js';

function getStorageKey() {
  return CAMPAIGN.storagePrefix + '-dm-state';
}

export const DEFAULT_STATE = {
  tabs: [{ id: 'welcome', type: 'welcome', label: 'Welcome', closeable: false }],
  activeTabId: 'welcome',
  navExpanded: true,
  navWidth: 280,
  collapsed: {},
  combat: {
    active: false, round: 1, currentTurn: 0,
    initiative: [],
    braziers: [true, true, true, true, true],
    locke: { hp: 110, maxHp: 110 },
    cultFanatics: [{ hp: 33, maxHp: 33 }, { hp: 33, maxHp: 33 }],
    dominateJean: { active: false, auraWithParty: true }
  },
  heatLevel: 0,
  intelGathered: {},
  foreshadowing: {},
  keyDecisions: {},
  searchOpen: false,
  presentationBlock: null,
  combatPanelOpen: false,
  scrollPositions: {}
};

export const AppState = JSON.parse(JSON.stringify(DEFAULT_STATE));

function replaceState(source) {
  for (const key of Object.keys(AppState)) delete AppState[key];
  Object.assign(AppState, source);
}

export function loadState() {
  try {
    const saved = localStorage.getItem(getStorageKey());
    if (saved) {
      replaceState(Object.assign(JSON.parse(JSON.stringify(DEFAULT_STATE)), JSON.parse(saved)));
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
  replaceState(JSON.parse(JSON.stringify(DEFAULT_STATE)));
  localStorage.removeItem(getStorageKey());
}
