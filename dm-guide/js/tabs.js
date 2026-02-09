import { AppState, saveState } from './state.js';
import { uid } from './utils.js';
import { ADVENTURE_DATA } from './adventure-data.js';
import { detectEntities, hideTooltip } from './tooltips.js';
import {
  renderWelcome, renderActContent, renderNpcDetail,
  renderStatBlock, renderReferenceContent, renderToolsContent
} from './renderers.js';

const $ = id => document.getElementById(id);

let _dragTabId = null;

function handleTabDrop(targetId) {
  if (!_dragTabId || _dragTabId === targetId) return;
  const tabs = AppState.tabs;
  const fromIdx = tabs.findIndex(t => t.id === _dragTabId);
  const toIdx = tabs.findIndex(t => t.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  const moved = tabs.splice(fromIdx, 1)[0];
  tabs.splice(toIdx, 0, moved);
  renderTabBar();
  saveState();
}

export function renderTabBar() {
  const bar = $('tab-bar');
  bar.textContent = '';
  for (const tab of AppState.tabs) {
    const el = document.createElement('div');
    el.className = `tab${tab.id === AppState.activeTabId ? ' active' : ''}`;
    el.dataset.tabId = tab.id;
    el.draggable = tab.closeable !== false;

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = tab.label;
    el.appendChild(label);

    if (tab.closeable !== false) {
      const closeBtn = document.createElement('span');
      closeBtn.className = 'tab-close';
      closeBtn.textContent = '\u00D7';
      closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
      el.appendChild(closeBtn);
    }

    el.addEventListener('click', () => switchTab(tab.id));
    el.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } });
    el.addEventListener('dragstart', (e) => { _dragTabId = tab.id; e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    el.addEventListener('drop', (e) => { e.preventDefault(); handleTabDrop(tab.id); });
    el.addEventListener('dragend', () => { _dragTabId = null; });

    bar.appendChild(el);
  }
}

export function openTab(type, id, label, scrollToId) {
  const existing = AppState.tabs.find(t => t.type === type && t.contentId === id);
  if (existing) { switchTab(existing.id, scrollToId); return; }
  const tabId = uid();
  AppState.tabs.push({ id: tabId, type, contentId: id, label, closeable: true });
  AppState.activeTabId = tabId;
  renderTabBar();
  renderMainContent(scrollToId);
  saveState();
}

export function switchTab(tabId, scrollToId) {
  if (AppState.activeTabId === tabId && !scrollToId) return;
  const mainEl = $('main-content');
  AppState.scrollPositions[AppState.activeTabId] = mainEl.scrollTop;
  AppState.activeTabId = tabId;
  renderTabBar();
  renderMainContent(scrollToId);
  saveState();
}

export function closeTab(tabId) {
  const tab = AppState.tabs.find(t => t.id === tabId);
  if (!tab || tab.closeable === false) return;
  const idx = AppState.tabs.indexOf(tab);
  AppState.tabs.splice(idx, 1);
  if (AppState.activeTabId === tabId) {
    const newIdx = Math.min(idx, AppState.tabs.length - 1);
    AppState.activeTabId = AppState.tabs[newIdx]?.id ?? 'welcome';
  }
  renderTabBar();
  renderMainContent();
  saveState();
}

const _tabRenderers = {
  welcome: () => renderWelcome(),
  act: (id) => {
    const act = ADVENTURE_DATA.acts.find(a => a.id === id);
    return act ? renderActContent(act) : '<p class="text-muted">Act not found.</p>';
  },
  npc: (id) => {
    const npc = ADVENTURE_DATA.npcs[id];
    return npc ? renderNpcDetail(npc) : '<p class="text-muted">NPC not found.</p>';
  },
  statblock: (id) => {
    const sb = ADVENTURE_DATA.statBlocks[id];
    return sb ? renderStatBlock(sb) : '<p class="text-muted">Stat block not found.</p>';
  },
  reference: (id) => renderReferenceContent(id),
  tools: (id) => renderToolsContent(id)
};

export function renderMainContent(scrollToId) {
  hideTooltip();
  const mainEl = $('main-content');
  const tab = AppState.tabs.find(t => t.id === AppState.activeTabId);

  const renderer = _tabRenderers[tab?.type] || _tabRenderers.welcome;
  const html = renderer(tab?.contentId);

  // Content built from trusted render functions using ADVENTURE_DATA
  const container = document.createElement('div');
  container.innerHTML = html;  // eslint-disable-line -- trusted render output, not user input
  mainEl.replaceChildren(...container.childNodes);

  if (scrollToId) {
    requestAnimationFrame(() => {
      const target = document.getElementById(scrollToId) || mainEl.querySelector(`[data-block-id="${scrollToId}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  } else {
    const saved = AppState.scrollPositions[AppState.activeTabId];
    if (saved) mainEl.scrollTop = saved;
  }

  requestAnimationFrame(() => detectEntities(mainEl));
}

export function toggleForeshadowing(id) {
  AppState.foreshadowing[id] = !AppState.foreshadowing[id];
  renderMainContent();
  saveState();
}

export function toggleIntel(id) {
  AppState.intelGathered[id] = !AppState.intelGathered[id];
  renderMainContent();
  saveState();
}
