import { ADVENTURE_DATA } from './adventure-data.js';
import { syncIdCounter } from './utils.js';
import { AppState, loadState, resetState, saveState } from './state.js';
import { searchIndex } from './search.js';
import { toggleCollapse } from './renderers.js';
import { renderTabBar, renderMainContent, toggleForeshadowing, toggleIntel } from './tabs.js';
import { renderCombatPanel, toggleCombatPanel } from './combat.js';
import { initVttSync, fireVttActions } from './vtt-sync.js';
import { initPresentation, openPresentation, setVttActionsFn } from './presentation.js';
import { initSearchUI, toggleSearch } from './search-ui.js';
import { initTooltips } from './tooltips.js';
import { initKeyboard } from './keyboard.js';
import { renderHeatBar, renderNavTree, initNavResize } from './heat-nav.js';
import { getSceneById } from '../../shared/campaign-data.js';

const $ = id => document.getElementById(id);

// Expose globals for inline onclick handlers in rendered HTML
window.openPresentation = openPresentation;
window.fireVttActions = fireVttActions;
window.toggleCollapse = toggleCollapse;
window.toggleForeshadowing = toggleForeshadowing;
window.toggleIntel = toggleIntel;
window.resetState = () => { resetState(); init(); };

function init() {
  loadState();
  // Migrate persisted "Rogue (TBD)" -> "Kallista" in saved initiative
  for (const e of AppState.combat.initiative) {
    if (e.name === 'Rogue (TBD)') e.name = 'Kallista';
  }
  syncIdCounter(AppState.tabs);
  $('app').style.setProperty('--nav-width', `${AppState.navWidth}px`);
  if (AppState.combatPanelOpen) $('app').classList.add('combat-open');

  if (AppState.combat.initiative.length === 0) {
    AppState.combat.initiative = [
      { name: 'Lair Action', init: 20, type: 'lair', conditions: [] },
      { name: 'Kallista', init: null, type: 'pc', conditions: [] },
      { name: 'Martin Storm', init: null, type: 'pc', conditions: [] },
      { name: 'Locke (Rakshasa)', init: 14, type: 'enemy', conditions: [] },
      { name: 'Oda (Bearda)', init: null, type: 'pc', conditions: [] },
      { name: 'Cult Fanatic 1', init: 10, type: 'enemy', conditions: [] },
      { name: 'Cult Fanatic 2', init: 10, type: 'enemy', conditions: [] },
      { name: 'Jean LeMarque', init: null, type: 'pc', conditions: [] },
      { name: 'L\u00F3m\u00EB', init: null, type: 'pc', conditions: [] }
    ];
  }

  searchIndex.buildIndex();
  renderNavTree();
  renderTabBar();
  renderMainContent();
  renderHeatBar();
  if (AppState.combatPanelOpen) renderCombatPanel();
}

// Init sequence
initVttSync();
initPresentation();
initSearchUI();
initTooltips();
initKeyboard();
initNavResize();
setVttActionsFn(fireVttActions);
init();

// Cross-validate VTT scene references
const errors = [];
for (const act of ADVENTURE_DATA.acts) {
  for (const section of act.sections || []) {
    for (const block of section.blocks || []) {
      if (block.vtt?.scene && !getSceneById(block.vtt.scene)) {
        errors.push(`Block ${block.id} references unknown scene: ${block.vtt.scene}`);
      }
    }
  }
}
if (errors.length > 0) {
  console.warn('[DM Guide] Scene reference errors:', errors);
} else {
  console.log('[DM Guide] All VTT scene references valid.');
}
