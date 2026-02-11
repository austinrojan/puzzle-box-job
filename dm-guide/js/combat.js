import { AppState, saveState } from './state.js';
import { COMBAT_CONFIG } from './combat-config.js';
import { escapeHtml } from './utils.js';
import { vttSync, syncFullInitiative } from './vtt-sync.js';
import {
  createBrazierMsg, createInitiativeNextMsg,
  createCombatStartMsg, createCombatEndMsg
} from '../../shared/protocol.js';

const $ = id => document.getElementById(id);

function hpClass(pct) {
  if (pct > 50) return 'healthy';
  if (pct > 25) return 'wounded';
  return 'critical';
}

function computeCombatState() {
  const c = AppState.combat;
  const cfg = COMBAT_CONFIG;
  const braziersOut = c.mechanics.braziers.filter(b => !b).length;
  const immunity = cfg.immunityTable[Math.min(braziersOut, cfg.immunityTable.length - 1)];
  const boss = c.combatants.locke;
  const bossHpPct = boss.maxHp > 0 ? Math.max(0, boss.hp / boss.maxHp * 100) : 0;

  const currentPhase = cfg.phases.find(p =>
    p.above ? bossHpPct > p.hpThreshold * 100 : bossHpPct <= p.hpThreshold * 100
  ) || cfg.phases[0];

  return {
    c,
    braziersOut,
    immunityLabel: immunity.label,
    unlockedSpells: immunity.spells,
    bossHpPct,
    currentPhase,
    bossHpClass: hpClass(bossHpPct),
  };
}

function wireCultistButtons(panel) {
  for (const btn of panel.querySelectorAll('[data-cf]')) {
    btn.addEventListener('click', () => adjustCultistHp(parseInt(btn.dataset.cf), parseInt(btn.dataset.cfAdj)));
  }
  for (const btn of panel.querySelectorAll('[data-cf-dmg]')) {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.cfDmg);
      const v = parseInt($(`cf-amt-input-${idx}`).value);
      if (!isNaN(v) && v > 0) adjustCultistHp(idx, -v);
    });
  }
  for (const btn of panel.querySelectorAll('[data-cf-heal]')) {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.cfHeal);
      const v = parseInt($(`cf-amt-input-${idx}`).value);
      if (!isNaN(v) && v > 0) adjustCultistHp(idx, v);
    });
  }
}

function wireEventListeners(panel) {
  $('combat-close-btn').addEventListener('click', toggleCombatPanel);
  $('dominate-btn').addEventListener('click', toggleDominate);
  $('next-turn-btn').addEventListener('click', nextTurn);

  for (const input of panel.querySelectorAll('[data-init-idx]')) {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.initIdx);
      const val = parseInt(input.value);
      if (!isNaN(val)) {
        AppState.combat.initiative[idx].init = val;
        saveState();
      }
    });
  }

  $('sort-init-btn').addEventListener('click', () => {
    AppState.combat.initiative.sort((a, b) => (b.init || 0) - (a.init || 0));
    AppState.combat.currentTurn = 0;
    renderCombatPanel();
    saveState();
    syncFullInitiative();
  });

  $('reset-round-btn').addEventListener('click', () => {
    AppState.combat.round = 1;
    AppState.combat.currentTurn = 0;
    for (const e of AppState.combat.initiative) {
      if (e.type === 'pc') e.init = null;
    }
    renderCombatPanel();
    saveState();
    syncFullInitiative();
  });

  $('locke-dmg-btn')?.addEventListener('click', () => {
    const v = parseInt($('locke-amt-input').value);
    if (!isNaN(v) && v > 0) adjustLockeHp(-v);
  });
  $('locke-heal-btn')?.addEventListener('click', () => {
    const v = parseInt($('locke-amt-input').value);
    if (!isNaN(v) && v > 0) adjustLockeHp(v);
  });

  for (const btn of panel.querySelectorAll('[data-hp-adj]')) {
    btn.addEventListener('click', () => adjustLockeHp(parseInt(btn.dataset.hpAdj)));
  }
  for (const b of panel.querySelectorAll('[data-brazier]')) {
    b.addEventListener('click', () => toggleBrazier(parseInt(b.dataset.brazier)));
  }

  wireCultistButtons(panel);
}

function renderHpControls(prefix, index) {
  if (prefix === 'locke') {
    return `<div class="flex gap-8 mt-8" style="align-items:center">` +
      `<button class="btn btn--sm" data-hp-adj="-1">\u22121</button>` +
      `<button class="btn btn--sm" data-hp-adj="-5">\u22125</button>` +
      `<button class="btn btn--sm" data-hp-adj="-10">\u221210</button>` +
      `<input type="number" class="input input-sm" id="locke-amt-input" placeholder="Amt" min="0">` +
      `<button class="btn btn--sm btn--danger" id="locke-dmg-btn">Dmg</button>` +
      `<button class="btn btn--sm" id="locke-heal-btn">Heal</button></div>`;
  }
  return `<div class="flex gap-4 mt-4" style="align-items:center">` +
    `<button class="btn btn--sm" data-cf="${index}" data-cf-adj="-1">\u22121</button>` +
    `<button class="btn btn--sm" data-cf="${index}" data-cf-adj="-5">\u22125</button>` +
    `<button class="btn btn--sm" data-cf="${index}" data-cf-adj="-10">\u221210</button>` +
    `<input type="number" class="input input-sm" id="cf-amt-input-${index}" placeholder="Amt" min="0">` +
    `<button class="btn btn--sm btn--danger" data-cf-dmg="${index}">Dmg</button>` +
    `<button class="btn btn--sm" data-cf-heal="${index}">Heal</button></div>`;
}

function renderBrazierSection(c, braziersOut, immunityLabel, unlockedSpells) {
  return `<div class="combat-section"><div class="combat-section-title">Braziers</div>` +
    `<div class="braziers-row">` +
    c.mechanics.braziers.map((lit, i) =>
      `<div class="brazier ${lit ? '' : 'extinguished'}" data-brazier="${i}"><div class="brazier-flame"></div><div class="brazier-bowl"></div></div>`
    ).join('') +
    `</div>` +
    `<div class="text-xs text-muted font-mono" style="text-align:center">${escapeHtml(immunityLabel)}</div>` +
    `<div class="immunity-meter">` +
    c.mechanics.braziers.map((_, i) => `<div class="immunity-segment ${i < (c.mechanics.braziers.length - braziersOut) ? 'active' : 'inactive'}"></div>`).join('') +
    `</div>` +
    `<div class="text-xs mt-8" style="color:var(--gold)">${escapeHtml(unlockedSpells)}</div></div>`;
}

function renderLockeSection(boss, bossHpPct, bossHpClass, currentPhase) {
  return `<div class="combat-section"><div class="combat-section-title">Locke \u00B7 ${escapeHtml(currentPhase.label)}</div>` +
    `<div class="hp-bar-wrap"><div class="hp-bar-fill ${bossHpClass}" style="width:${bossHpPct}%"></div>` +
    `<div class="hp-bar-label">${boss.hp} / ${boss.maxHp}</div>` +
    `<div class="hp-phase-marker" style="left:50%"></div></div>` +
    renderHpControls('locke') +
    (currentPhase.description ? `<div class="text-xs mt-8" style="color:var(--red-bright)">${escapeHtml(currentPhase.label)} \u2014 ${escapeHtml(currentPhase.description)}</div>` : '') +
    `</div>`;
}

function renderDominateSection(c, cfg) {
  return `<div class="combat-section"><div class="combat-section-title">Dominate Person \u2014 ${escapeHtml(cfg.dominate.targetShort)}</div>` +
    `<div class="dominate-toggle ${c.mechanics.dominate.active ? 'active' : ''}">` +
    `<div class="dominate-switch ${c.mechanics.dominate.active ? 'active' : ''}" id="dominate-btn"></div>` +
    `<span class="text-sm">${c.mechanics.dominate.active ? '<span style="color:var(--red-bright);font-weight:600">DOMINATED</span>' : 'Inactive'}</span></div>` +
    (c.mechanics.dominate.active && cfg.dominate.description.active ? `<div class="text-xs mt-8" style="color:var(--red-light)">\u26A0 ${escapeHtml(cfg.dominate.description.active)}</div>` : '') +
    `</div>`;
}

function renderCultFanaticsSection(c) {
  return `<div class="combat-section"><div class="combat-section-title">Cult Fanatics</div>` +
    c.combatants.cultFanatics.map((cf, i) => {
      const pct = Math.max(0, cf.hp / cf.maxHp * 100);
      const cls = hpClass(pct);
      return `<div class="mb-8"><div class="text-xs text-muted">Fanatic ${i + 1}</div>` +
        `<div class="hp-bar-wrap" style="height:12px"><div class="hp-bar-fill ${cls}" style="width:${pct}%"></div>` +
        `<div class="hp-bar-label" style="font-size:9px">${cf.hp}/${cf.maxHp}</div></div>` +
        renderHpControls('cultist', i) + `</div>`;
    }).join('') +
    `</div>`;
}

function renderInitiativeSection(c) {
  return `<div class="combat-section"><div class="combat-section-title">Initiative \u00B7 Round ${c.round}</div>` +
    `<ul class="init-list">` +
    c.initiative.map((entry, i) => {
      const color = entry.type === 'enemy' ? 'var(--red-light)' : entry.type === 'lair' ? 'var(--purple-light)' : 'var(--text-primary)';
      const initVal = entry.init ?? '';
      return `<li class="init-item ${i === c.currentTurn ? 'active-turn' : ''}">` +
        `<input type="number" class="init-input" data-init-idx="${i}" value="${initVal}" placeholder="\u2014" min="0" max="30">` +
        `<span class="init-name" style="color:${color}">${escapeHtml(entry.name)}</span>` +
        (entry.conditions ? entry.conditions.map(cn => `<span class="condition-badge ${cn}">${cn}</span>`).join('') : '') +
        `</li>`;
    }).join('') +
    `</ul>` +
    `<div class="flex gap-8 mt-8">` +
    `<button class="btn btn--sm" id="sort-init-btn" style="background:var(--bg-3);color:var(--gold)">Sort \u2193</button>` +
    `<button class="btn btn--sm" id="reset-round-btn">Reset Round</button>` +
    `<button class="btn btn--gold btn--sm" id="next-turn-btn">Next Turn \u2192</button>` +
    `</div></div>`;
}

export function renderCombatPanel() {
  const panel = $('combat-panel');
  const { c, braziersOut, immunityLabel, unlockedSpells, bossHpPct, currentPhase, bossHpClass } = computeCombatState();
  const boss = c.combatants.locke;
  const cfg = COMBAT_CONFIG;

  panel.textContent = '';

  // All content below is from AppState / COMBAT_CONFIG (escapeHtml'd), not user input
  const temp = document.createElement('div');
  temp.innerHTML = // eslint-disable-line no-unsanitized/property -- safe: all values from AppState with escapeHtml
    `<div class="combat-header"><h2>\u2694 Combat Tracker</h2><span class="combat-close" id="combat-close-btn">\u00D7</span></div>` +
    renderBrazierSection(c, braziersOut, immunityLabel, unlockedSpells) +
    renderLockeSection(boss, bossHpPct, bossHpClass, currentPhase) +
    renderDominateSection(c, cfg) +
    renderCultFanaticsSection(c) +
    renderInitiativeSection(c);

  while (temp.firstChild) { panel.appendChild(temp.firstChild); }

  wireEventListeners(panel);
}

export function toggleBrazier(i) {
  AppState.combat.mechanics.braziers[i] = !AppState.combat.mechanics.braziers[i];
  renderCombatPanel();
  saveState();
  vttSync(createBrazierMsg({ index: i, lit: AppState.combat.mechanics.braziers[i], braziers: AppState.combat.mechanics.braziers.slice() }));
}

export function adjustLockeHp(amt) {
  const boss = AppState.combat.combatants.locke;
  boss.hp = Math.max(0, Math.min(boss.maxHp, boss.hp + amt));
  renderCombatPanel();
  saveState();
}

export function adjustCultistHp(i, amt) {
  const cf = AppState.combat.combatants.cultFanatics[i];
  cf.hp = Math.max(0, Math.min(cf.maxHp, cf.hp + amt));
  renderCombatPanel();
  saveState();
}

export function toggleDominate() {
  AppState.combat.mechanics.dominate.active = !AppState.combat.mechanics.dominate.active;
  AppState.combat.mechanics.dominate.auraWithParty = !AppState.combat.mechanics.dominate.active;
  renderCombatPanel();
  saveState();
}

export function nextTurn() {
  const c = AppState.combat;
  if (!c.initiative.length) return;
  c.currentTurn++;
  if (c.currentTurn >= c.initiative.length) { c.currentTurn = 0; c.round++; }
  renderCombatPanel();
  saveState();
  vttSync(createInitiativeNextMsg(c.currentTurn, c.round));
}

const DRAWER_MQ = '(max-width: 1199px)';
let previousFocus = null;

export function isOverlayMode() {
  return window.matchMedia(DRAWER_MQ).matches;
}

function applyDrawerOverlay() {
  previousFocus = document.activeElement;
  const panel = $('combat-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  $('main-content')?.setAttribute('inert', '');
  $('nav-panel')?.setAttribute('inert', '');
  // Focus first focusable element in the panel
  const first = panel.querySelector('button, [tabindex], input, select');
  if (first) first.focus();
}

function removeDrawerOverlay() {
  const panel = $('combat-panel');
  panel.removeAttribute('role');
  panel.removeAttribute('aria-modal');
  $('main-content')?.removeAttribute('inert');
  $('nav-panel')?.removeAttribute('inert');
  if (previousFocus && previousFocus.isConnected) {
    previousFocus.focus();
  }
  previousFocus = null;
}

export function toggleCombatPanel() {
  AppState.combatPanelOpen = !AppState.combatPanelOpen;
  $('app').classList.toggle('combat-open', AppState.combatPanelOpen);
  if (AppState.combatPanelOpen) {
    renderCombatPanel();
    if (isOverlayMode()) applyDrawerOverlay();
    syncFullInitiative();
    vttSync(createCombatStartMsg());
  } else {
    if (isOverlayMode()) removeDrawerOverlay();
    vttSync(createCombatEndMsg());
  }
  saveState();
}
