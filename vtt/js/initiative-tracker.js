// ============================================
// VTT Initiative Tracker — DOM-based turn order display
// Left-side overlay during combat
// ============================================

import { EventBus, state } from './state.js';
import { TOKENS } from './data.js';

const $ = id => document.getElementById(id);

let panel = null;

export function init() {
  panel = $('initiative-panel');

  EventBus.on('initiative:update', render);
  EventBus.on('initiative:next-turn', nextTurn);
  EventBus.on('combat:start', (data) => {
    if (data) Object.assign(state.initiative, data);
    state.initiative.active = true;
    render();
  });
  EventBus.on('combat:end', () => {
    state.initiative.active = false;
    panel.hidden = true;
  });
}

function nextTurn() {
  const init = state.initiative;
  if (!init.active || init.entries.length === 0) return;

  init.currentTurn = (init.currentTurn + 1) % init.entries.length;
  if (init.currentTurn === 0) init.round++;

  EventBus.emit('initiative:update', init);
}

function render() {
  const init = state.initiative;
  panel.textContent = '';

  if (!init.active || init.entries.length === 0) return;

  // Round counter
  const roundEl = document.createElement('div');
  roundEl.className = 'init-round';
  const roundLabel = document.createTextNode('Round ');
  const roundNum = document.createElement('span');
  roundNum.className = 'init-round__number';
  roundNum.textContent = init.round;
  roundEl.appendChild(roundLabel);
  roundEl.appendChild(roundNum);
  panel.appendChild(roundEl);

  // Combatant entries
  init.entries.forEach((entry, i) => {
    const el = document.createElement('div');
    el.className = 'init-entry';
    if (i === init.currentTurn) el.classList.add('init-entry--active');
    if (entry.hp !== undefined && entry.hp <= 0) el.classList.add('init-entry--dead');

    // Initiative roll number
    const rollEl = document.createElement('div');
    rollEl.className = 'init-roll';
    rollEl.textContent = entry.init ?? '';

    // Portrait
    const portrait = document.createElement('div');
    portrait.className = 'init-portrait';
    portrait.style.backgroundColor = 'var(--bg-3)';

    // Try to load token image
    const tokenDef = TOKENS[entry.tokenId];
    if (tokenDef) {
      const img = new Image();
      img.onload = () => {
        portrait.style.backgroundImage = `url(${tokenDef.image})`;
        portrait.style.backgroundSize = 'cover';
      };
      img.onerror = () => {
        // Show initials
        const initials = entry.name.split(' ').map(w => w[0]).join('').substring(0, 2);
        portrait.textContent = initials;
        portrait.style.display = 'flex';
        portrait.style.alignItems = 'center';
        portrait.style.justifyContent = 'center';
        portrait.style.fontSize = '14px';
        portrait.style.fontWeight = '700';
        portrait.style.fontFamily = 'var(--font-heading)';
        portrait.style.color = 'var(--gold)';
      };
      img.src = tokenDef.image;

      // Set border color from token definition
      const borderColor = resolveCSSVar(tokenDef.border);
      portrait.style.borderColor = borderColor;
    }

    // Info block
    const info = document.createElement('div');
    info.className = 'init-info';

    const name = document.createElement('div');
    name.className = 'init-name';
    name.textContent = entry.displayName || entry.name;
    info.appendChild(name);

    // HP bar (only for enemies, not PCs)
    if (entry.hp !== undefined && entry.maxHp) {
      const hpBar = document.createElement('div');
      hpBar.className = 'init-hp';
      hpBar.style.position = 'relative';

      const fill = document.createElement('div');
      const pct = Math.max(0, Math.min(100, (entry.hp / entry.maxHp) * 100));
      let colorClass = 'token-hp__fill--healthy';
      if (pct <= 25) colorClass = 'token-hp__fill--critical';
      else if (pct <= 50) colorClass = 'token-hp__fill--wounded';
      fill.className = 'init-hp__fill ' + colorClass;
      fill.style.width = pct + '%';
      hpBar.appendChild(fill);

      // Special: Locke half-HP marker
      if (entry.tokenId === 'locke-rakshasa') {
        const marker = document.createElement('div');
        marker.className = 'init-hp-marker';
        hpBar.appendChild(marker);
      }

      info.appendChild(hpBar);
    }

    // Condition badges
    if (entry.conditions && entry.conditions.length > 0) {
      const badges = document.createElement('div');
      badges.className = 'init-conditions';

      for (const cond of entry.conditions) {
        const badge = document.createElement('span');
        badge.className = 'init-badge init-badge--' + cond;
        badge.textContent = cond;
        badges.appendChild(badge);
      }

      info.appendChild(badges);
    }

    el.appendChild(rollEl);
    el.appendChild(portrait);
    el.appendChild(info);
    panel.appendChild(el);
  });
}

function resolveCSSVar(value) {
  if (!value || !value.startsWith('var(')) return value || '#C9A84C';
  const varName = value.replace('var(', '').replace(')', '');
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || '#C9A84C';
}
