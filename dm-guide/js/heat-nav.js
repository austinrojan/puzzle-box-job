import { ADVENTURE_DATA } from './adventure-data.js';
import { AppState, saveState } from './state.js';
import { escapeHtml } from './utils.js';
import { openTab } from './tabs.js';
import { vttSync } from './vtt-sync.js';

const $ = id => document.getElementById(id);

const _icons = ['\uD83C\uDFAD', '\uD83D\uDD0D', '\uD83D\uDEAA', '\uD83C\uDFF0', '\uD83D\uDCE6', '\u2694\uFE0F'];

export function setHeatLevel(level) {
  AppState.heatLevel = level;
  renderHeatBar();
  saveState();
  vttSync({ type: 'heat', level });
}

export function renderHeatBar() {
  const segs = document.querySelectorAll('.heat-segment');
  const statusEl = $('heat-status');
  const labels = ['Unnoticed', 'Suspicious', 'Alarmed'];
  for (const [i, seg] of segs.entries()) {
    seg.classList.toggle('active', i <= AppState.heatLevel);
    seg.onclick = () => setHeatLevel(i);
  }
  statusEl.textContent = labels[AppState.heatLevel];
  statusEl.className = `heat-status${AppState.heatLevel === 2 ? ' alarmed' : ''}`;
}

export function renderNavTree() {
  const nav = $('nav-tree');
  nav.textContent = '';

  const title = document.createElement('div');
  title.className = 'nav-title';
  title.textContent = '\uD83D\uDCCB The Puzzle-Box Job';
  nav.appendChild(title);

  for (const act of ADVENTURE_DATA.acts) {
    const sec = document.createElement('div');
    sec.className = 'nav-section';

    const header = document.createElement('div');
    header.className = 'nav-section-header expanded';
    // Content from ADVENTURE_DATA (trusted), act titles are escapeHtml'd
    header.innerHTML = `<span class="nav-icon">${_icons[act.number - 1] || '\uD83D\uDCC4'}</span><span>Act ${act.number}: ${escapeHtml(act.title)}</span><span class="nav-chevron">\u25B6</span>`;
    header.addEventListener('click', () => toggleNavSection(header));
    sec.appendChild(header);

    const children = document.createElement('div');
    children.className = 'nav-children expanded';
    const inner = document.createElement('div');
    inner.className = 'nav-children-inner';

    for (const section of act.sections || []) {
      const child = document.createElement('div');
      child.className = 'nav-child';
      child.textContent = section.title;
      child.addEventListener('click', () => {
        openTab('act', act.id, `Act ${act.number}: ${act.title}`, section.id);
      });
      inner.appendChild(child);
    }

    children.appendChild(inner);
    sec.appendChild(children);
    nav.appendChild(sec);
  }

  const divider = document.createElement('div');
  divider.className = 'nav-divider';
  nav.appendChild(divider);

  addNavSection(nav, '\uD83D\uDCCA', 'Quick Reference', [
    { label: 'DC Table', action: () => openTab('reference', 'dc-table', 'DC Table') },
    { label: 'Party Stats', action: () => openTab('reference', 'party-stats', 'Party Stats') },
    { label: 'Loot', action: () => openTab('reference', 'loot', 'Loot') }
  ], true);

  addNavSection(nav, '\uD83D\uDC64', 'NPCs', Object.entries(ADVENTURE_DATA.npcs).map(
    ([key, npc]) => ({ label: npc.name, action: () => openTab('npc', key, npc.name) })
  ), false);

  addNavSection(nav, '\uD83D\uDCDC', 'Stat Blocks', Object.entries(ADVENTURE_DATA.statBlocks).map(
    ([key, block]) => ({ label: block.name, action: () => openTab('statblock', key, block.name) })
  ), false);

  const divider2 = document.createElement('div');
  divider2.className = 'nav-divider';
  nav.appendChild(divider2);

  addNavSection(nav, '\u2699\uFE0F', 'Session Tools', [
    { label: 'Foreshadowing Checklist', action: () => openTab('tools', 'foreshadowing', 'Foreshadowing') },
    { label: 'Intel Checklist', action: () => openTab('tools', 'intel', 'Intel Checklist') },
    { label: 'Reset Session', action: () => { if (confirm('Reset all session data?')) window.resetState(); } }
  ], true);
}

function addNavSection(parent, icon, title, items, expanded) {
  const sec = document.createElement('div');
  sec.className = 'nav-section';

  const header = document.createElement('div');
  header.className = `nav-section-header${expanded ? ' expanded' : ''}`;
  // Content from our own hardcoded data, all titles escapeHtml'd
  header.innerHTML = `<span class="nav-icon">${icon}</span><span>${escapeHtml(title)}</span><span class="nav-chevron">\u25B6</span>`;
  header.addEventListener('click', () => toggleNavSection(header));
  sec.appendChild(header);

  const children = document.createElement('div');
  children.className = `nav-children${expanded ? ' expanded' : ''}`;
  const inner = document.createElement('div');
  inner.className = 'nav-children-inner';

  for (const item of items) {
    const child = document.createElement('div');
    child.className = 'nav-child';
    child.textContent = item.label;
    child.addEventListener('click', item.action);
    inner.appendChild(child);
  }

  children.appendChild(inner);
  sec.appendChild(children);
  parent.appendChild(sec);
}

function toggleNavSection(headerEl) {
  headerEl.classList.toggle('expanded');
  headerEl.nextElementSibling?.classList.toggle('expanded');
}

export function initNavResize() {
  const handle = $('nav-resize');
  let _dragging = false;
  handle.addEventListener('mousedown', () => {
    _dragging = true;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!_dragging) return;
    const w = Math.max(200, Math.min(400, e.clientX));
    $('app')?.style.setProperty('--nav-width', `${w}px`);
    AppState.navWidth = w;
  });
  document.addEventListener('mouseup', () => {
    if (!_dragging) return;
    _dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    saveState();
  });
}
