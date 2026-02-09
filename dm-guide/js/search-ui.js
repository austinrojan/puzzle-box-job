import { searchIndex } from './search.js';
import { AppState } from './state.js';
import { debounce } from './utils.js';
import { openTab } from './tabs.js';
import { ADVENTURE_DATA } from './adventure-data.js';

const $ = id => document.getElementById(id);

function showPlaceholder(container, text) {
  const msg = document.createElement('div');
  msg.className = 'search-empty';
  msg.textContent = text;
  container.appendChild(msg);
}

let _searchSelectedIdx = -1;

function highlightSearchItem(items) {
  for (const [i, el] of [...items].entries()) {
    el.classList.toggle('selected', i === _searchSelectedIdx);
  }
  items[_searchSelectedIdx]?.scrollIntoView({ block: 'nearest' });
}

function selectSearchResult(r) {
  toggleSearch();
  if (r.type === 'act') {
    const act = ADVENTURE_DATA.acts.find(a => a.id === r.id);
    if (act) openTab('act', act.id, `Act ${act.number}: ${act.title}`, r.scrollTo);
  } else if (r.type === 'npc') {
    const npc = ADVENTURE_DATA.npcs[r.id];
    if (npc) openTab('npc', r.id, npc.name);
  } else if (r.type === 'statblock') {
    const sb = ADVENTURE_DATA.statBlocks[r.id];
    if (sb) openTab('statblock', r.id, sb.name);
  } else if (r.type === 'reference') {
    openTab('reference', r.id, r.label);
  } else if (r.type === 'spell') {
    openTab('reference', 'dc-table', 'DC Table');
  }
}

export function initSearchUI() {
  $('search-overlay').addEventListener('click', (e) => {
    if (e.target === $('search-overlay')) toggleSearch();
  });

  $('search-input').addEventListener('input', debounce((e) => {
    const query = e.target.value.trim();
    const resultsEl = $('search-results');
    resultsEl.textContent = '';
    _searchSelectedIdx = -1;
    if (!query || query.length < 2) {
      showPlaceholder(resultsEl, 'Type to search...');
      return;
    }
    const results = searchIndex.search(query);
    if (results.length === 0) {
      showPlaceholder(resultsEl, `No results for "${query}"`);
      return;
    }
    const groups = {};
    for (const r of results) {
      if (!groups[r.category]) groups[r.category] = [];
      groups[r.category].push(r);
    }
    let idx = 0;
    for (const cat of Object.keys(groups)) {
      const catHeader = document.createElement('div');
      catHeader.className = 'search-category';
      catHeader.textContent = cat;
      resultsEl.appendChild(catHeader);
      for (const r of groups[cat]) {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.dataset.idx = idx;
        const titleSpan = document.createElement('span');
        titleSpan.className = 'search-result-title';
        titleSpan.textContent = r.title;
        item.appendChild(titleSpan);
        if (r.label && r.label !== r.title) {
          const labelSpan = document.createElement('span');
          labelSpan.className = 'search-result-label';
          labelSpan.textContent = r.label;
          item.appendChild(labelSpan);
        }
        if (r.preview) {
          const prev = document.createElement('div');
          prev.className = 'search-result-preview';
          prev.textContent = r.preview.length > 120 ? `${r.preview.substring(0, 120)}...` : r.preview;
          item.appendChild(prev);
        }
        item.addEventListener('click', () => { selectSearchResult(r); });
        resultsEl.appendChild(item);
        idx++;
      }
    }
  }, 120));

  $('search-input').addEventListener('keydown', (e) => {
    const items = document.querySelectorAll('.search-result-item');
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _searchSelectedIdx = Math.min(_searchSelectedIdx + 1, items.length - 1);
      highlightSearchItem(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _searchSelectedIdx = Math.max(_searchSelectedIdx - 1, 0);
      highlightSearchItem(items);
    } else if (e.key === 'Enter' && _searchSelectedIdx >= 0) {
      e.preventDefault();
      items[_searchSelectedIdx].click();
    }
  });
}

export function toggleSearch() {
  AppState.searchOpen = !AppState.searchOpen;
  $('search-overlay').classList.toggle('open', AppState.searchOpen);
  if (AppState.searchOpen) {
    $('search-input').value = '';
    $('search-input').focus();
    const r = $('search-results');
    r.textContent = '';
    showPlaceholder(r, 'Type to search...');
  }
}
