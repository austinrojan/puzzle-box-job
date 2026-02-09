import { ADVENTURE_DATA, setAdventureData } from './adventure-data.js';
import { COMBAT_CONFIG, setCombatConfig } from './combat-config.js';
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
import { loadCampaign, CAMPAIGN, getSceneById } from '../../shared/campaign-data.js';

const $ = id => document.getElementById(id);

// Expose globals for inline onclick handlers in rendered HTML
window.openPresentation = openPresentation;
window.fireVttActions = fireVttActions;
window.toggleCollapse = toggleCollapse;
window.toggleForeshadowing = toggleForeshadowing;
window.toggleIntel = toggleIntel;

function init() {
  loadState();
  // Apply name migrations from campaign config (e.g. "Rogue (TBD)" → "Kallista")
  for (const mig of COMBAT_CONFIG.migrations) {
    for (const e of AppState.combat.initiative) {
      if (e.name === mig.from) e.name = mig.to;
    }
  }
  syncIdCounter(AppState.tabs);
  $('app').style.setProperty('--nav-width', `${AppState.navWidth}px`);
  if (AppState.combatPanelOpen) $('app').classList.add('combat-open');

  if (AppState.combat.initiative.length === 0) {
    AppState.combat.initiative = JSON.parse(JSON.stringify(COMBAT_CONFIG.defaultInitiative));
  }

  searchIndex.buildIndex();
  renderNavTree();
  renderTabBar();
  renderMainContent();
  renderHeatBar();
  if (AppState.combatPanelOpen) renderCombatPanel();
}

window.resetState = () => { resetState(); init(); };

async function boot() {
  // 1. Load campaign shared data (VTT data, metadata)
  const manifest = await loadCampaign();
  document.title = manifest.title + ' \u2014 DM Guide';

  // 2. Load DM-specific campaign data
  const adventureMod = await import(CAMPAIGN.assetBase + manifest.files.adventureData);
  setAdventureData(adventureMod.ADVENTURE_DATA);

  const combatMod = await import(CAMPAIGN.assetBase + manifest.files.combat);
  setCombatConfig(combatMod.COMBAT_CONFIG);

  // 3. Init subsystems that need the DOM
  initVttSync();
  initPresentation();
  initSearchUI();
  initTooltips();
  initKeyboard();
  initNavResize();
  setVttActionsFn(fireVttActions);

  // 3. Delegated click handler for VTT cue buttons (replaces inline onclick)
  $('main-content').addEventListener('click', (e) => {
    const cue = e.target.closest('.block-vtt-cue');
    if (cue && cue.dataset.vtt) {
      fireVttActions(JSON.parse(cue.dataset.vtt));
    }
  });

  // 4. Run existing init (loads state, builds UI)
  init();

  // 5. Cross-validate VTT scene references
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
}

boot().catch(err => console.error('[DM Guide] Boot failed:', err));
