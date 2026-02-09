import { debounce } from './utils.js';

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

export function loadState() {
  try {
    const saved = localStorage.getItem('puzzlebox-dm-state');
    if (saved) {
      const parsed = JSON.parse(saved);
      const merged = Object.assign(JSON.parse(JSON.stringify(DEFAULT_STATE)), parsed);
      for (const key of Object.keys(AppState)) delete AppState[key];
      Object.assign(AppState, merged);
    }
  } catch (e) { console.warn('State load failed:', e); }
}

export const saveState = debounce(() => {
  try {
    const s = Object.assign({}, AppState);
    delete s.searchOpen;
    delete s.presentationBlock;
    localStorage.setItem('puzzlebox-dm-state', JSON.stringify(s));
  } catch (e) { console.warn('State save failed:', e); }
}, 300);

export function resetState() {
  for (const key of Object.keys(AppState)) delete AppState[key];
  Object.assign(AppState, JSON.parse(JSON.stringify(DEFAULT_STATE)));
  localStorage.removeItem('puzzlebox-dm-state');
}
