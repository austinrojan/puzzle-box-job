import { AppState } from './state.js';
import { ADVENTURE_DATA } from './adventure-data.js';
import { openTab, switchTab, closeTab } from './tabs.js';
import { toggleCombatPanel, isOverlayMode } from './combat.js';
import { toggleSidebar } from './heat-nav.js';
import { openPresentation, presentNext, presentPrev, closePresentation } from './presentation.js';
import { toggleSearch } from './search-ui.js';

export function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); toggleSearch(); return; }
    if (e.key === 'Escape') {
      if (AppState.searchOpen) { toggleSearch(); return; }
      if (AppState.presentationBlock) { closePresentation(); return; }
      if (AppState.combatPanelOpen && isOverlayMode()) { toggleCombatPanel(); return; }
      return;
    }
    if (AppState.presentationBlock) {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); presentNext(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); presentPrev(); return; }
      return;
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key >= '1' && e.key <= '6' && !e.metaKey && !e.ctrlKey) {
      const act = ADVENTURE_DATA.acts.find((a) => a.id === `act-${e.key}`);
      if (act) openTab('act', act.id, `Act ${act.number}: ${act.title}`);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); toggleSidebar(); return; }
    if (e.key === 'b' || e.key === 'B') { toggleCombatPanel(); return; }
    if (e.key === 'p' || e.key === 'P') {
      const blocks = document.querySelectorAll('.block-read-aloud');
      if (blocks.length > 0) openPresentation(blocks[0].dataset.blockId);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '[') {
      e.preventDefault();
      const idx = AppState.tabs.findIndex((t) => t.id === AppState.activeTabId);
      if (idx > 0) switchTab(AppState.tabs[idx - 1].id);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === ']') {
      e.preventDefault();
      const idx = AppState.tabs.findIndex((t) => t.id === AppState.activeTabId);
      if (idx < AppState.tabs.length - 1) switchTab(AppState.tabs[idx + 1].id);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
      e.preventDefault();
      closeTab(AppState.activeTabId);
      return;
    }
  });
}
