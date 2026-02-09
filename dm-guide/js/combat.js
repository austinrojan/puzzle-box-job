import { AppState, saveState } from './state.js';
import { escapeHtml } from './utils.js';
import { vttSync, syncFullInitiative } from './vtt-sync.js';
import {
  createBrazierMsg, createInitiativeNextMsg,
  createCombatStartMsg, createCombatEndMsg
} from '../../shared/protocol.js';

const $ = id => document.getElementById(id);

const IMMUNITY_TABLE = [
  { label: 'Immune to 3rd level and below',        spells: 'Physical attacks only' },
  { label: 'Immune to 2nd level and below',        spells: '3rd-level: Counterspell, Fireball, Dispel Magic, Spirit Guardians' },
  { label: 'Immune to 1st level and below',        spells: '2nd-level+: Hold Person, Suggestion, Heat Metal' },
  { label: 'Immune to cantrips only \u00B7 Ritual fails', spells: "1st-level+: Command, Tasha's Hideous Laughter" },
  { label: 'No spell immunity',                    spells: 'Everything works \u2014 full arsenal' },
];

function hpClass(pct) {
  if (pct > 50) return 'healthy';
  if (pct > 25) return 'wounded';
  return 'critical';
}

function computeCombatState() {
  const c = AppState.combat;
  const braziersOut = c.braziers.filter(b => !b).length;
  const immunity = IMMUNITY_TABLE[Math.min(braziersOut, 4)];
  const lockeHpPct = Math.max(0, c.locke.hp / c.locke.maxHp * 100);

  return {
    c,
    braziersOut,
    immunityLabel: immunity.label,
    unlockedSpells: immunity.spells,
    lockeHpPct,
    lockePhase: c.locke.hp <= 55 ? 2 : 1,
    lockeHpClass: hpClass(lockeHpPct),
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

export function renderCombatPanel() {
  const panel = $('combat-panel');
  const { c, braziersOut, immunityLabel, unlockedSpells, lockeHpPct, lockePhase, lockeHpClass } = computeCombatState();

  panel.textContent = '';

  // All content below is from our own AppState (escapeHtml'd), not user input
  const temp = document.createElement('div');
  temp.innerHTML = // eslint-disable-line no-unsanitized/property -- safe: all values from AppState with escapeHtml
    `<div class="combat-header"><h2>\u2694 Combat Tracker</h2><span class="combat-close" id="combat-close-btn">\u00D7</span></div>` +

    `<div class="combat-section"><div class="combat-section-title">Braziers</div>` +
    `<div class="braziers-row">` +
    c.braziers.map((lit, i) =>
      `<div class="brazier ${lit ? '' : 'extinguished'}" data-brazier="${i}"><div class="brazier-flame"></div><div class="brazier-bowl"></div></div>`
    ).join('') +
    `</div>` +
    `<div class="text-xs text-muted font-mono" style="text-align:center">${escapeHtml(immunityLabel)}</div>` +
    `<div class="immunity-meter">` +
    [0,1,2,3,4].map(i => `<div class="immunity-segment ${i < (5 - braziersOut) ? 'active' : 'inactive'}"></div>`).join('') +
    `</div>` +
    `<div class="text-xs mt-8" style="color:var(--gold)">${escapeHtml(unlockedSpells)}</div></div>` +

    `<div class="combat-section"><div class="combat-section-title">Locke \u00B7 Phase ${lockePhase}</div>` +
    `<div class="hp-bar-wrap"><div class="hp-bar-fill ${lockeHpClass}" style="width:${lockeHpPct}%"></div>` +
    `<div class="hp-bar-label">${c.locke.hp} / ${c.locke.maxHp}</div>` +
    `<div class="hp-phase-marker" style="left:50%"></div></div>` +
    `<div class="flex gap-8 mt-8" style="align-items:center">` +
    `<button class="btn btn-sm" data-hp-adj="-1">\u22121</button>` +
    `<button class="btn btn-sm" data-hp-adj="-5">\u22125</button>` +
    `<button class="btn btn-sm" data-hp-adj="-10">\u221210</button>` +
    `<input type="number" class="input input-sm" id="locke-amt-input" placeholder="Amt" min="0">` +
    `<button class="btn btn-sm btn-danger" id="locke-dmg-btn">Dmg</button>` +
    `<button class="btn btn-sm" id="locke-heal-btn">Heal</button>` +
    `</div>` +
    (lockePhase === 2 ? `<div class="text-xs mt-8" style="color:var(--red-bright)">Phase 2: Melee Frenzy \u2014 Drops spellcasting, two claw attacks per turn</div>` : '') +
    `</div>` +

    `<div class="combat-section"><div class="combat-section-title">Dominate Person \u2014 Jean</div>` +
    `<div class="dominate-toggle ${c.dominateJean.active ? 'active' : ''}">` +
    `<div class="dominate-switch ${c.dominateJean.active ? 'active' : ''}" id="dominate-btn"></div>` +
    `<span class="text-sm">${c.dominateJean.active ? '<span style="color:var(--red-bright);font-weight:600">DOMINATED</span>' : 'Inactive'}</span></div>` +
    (c.dominateJean.active ? `<div class="text-xs mt-8" style="color:var(--red-light)">\u26A0 Aura of Protection has LEFT the party (+3 saves gone)<br><strong>Break it:</strong> Dispel Magic on Jean (d20+7 vs DC 15, needs 8+), or damage Jean for re-save</div>` : '') +
    `</div>` +

    `<div class="combat-section"><div class="combat-section-title">Cult Fanatics</div>` +
    c.cultFanatics.map((cf, i) => {
      const pct = Math.max(0, cf.hp / cf.maxHp * 100);
      const cls = hpClass(pct);
      return `<div class="mb-8"><div class="text-xs text-muted">Fanatic ${i + 1}</div>` +
        `<div class="hp-bar-wrap" style="height:12px"><div class="hp-bar-fill ${cls}" style="width:${pct}%"></div>` +
        `<div class="hp-bar-label" style="font-size:9px">${cf.hp}/${cf.maxHp}</div></div>` +
        `<div class="flex gap-4 mt-4" style="align-items:center">` +
        `<button class="btn btn-sm" data-cf="${i}" data-cf-adj="-1">\u22121</button>` +
        `<button class="btn btn-sm" data-cf="${i}" data-cf-adj="-5">\u22125</button>` +
        `<button class="btn btn-sm" data-cf="${i}" data-cf-adj="-10">\u221210</button>` +
        `<input type="number" class="input input-sm" id="cf-amt-input-${i}" placeholder="Amt" min="0">` +
        `<button class="btn btn-sm btn-danger" data-cf-dmg="${i}">Dmg</button>` +
        `<button class="btn btn-sm" data-cf-heal="${i}">Heal</button></div></div>`;
    }).join('') +
    `</div>` +

    `<div class="combat-section"><div class="combat-section-title">Initiative \u00B7 Round ${c.round}</div>` +
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
    `<button class="btn btn-sm" id="sort-init-btn" style="background:var(--bg-3);color:var(--gold)">Sort \u2193</button>` +
    `<button class="btn btn-sm" id="reset-round-btn">Reset Round</button>` +
    `<button class="btn btn-gold btn-sm" id="next-turn-btn">Next Turn \u2192</button>` +
    `</div></div>`;

  while (temp.firstChild) { panel.appendChild(temp.firstChild); }

  wireEventListeners(panel);
}

export function toggleBrazier(i) {
  AppState.combat.braziers[i] = !AppState.combat.braziers[i];
  renderCombatPanel();
  saveState();
  vttSync(createBrazierMsg({ index: i, lit: AppState.combat.braziers[i], braziers: AppState.combat.braziers.slice() }));
}

export function adjustLockeHp(amt) {
  const c = AppState.combat;
  c.locke.hp = Math.max(0, Math.min(c.locke.maxHp, c.locke.hp + amt));
  renderCombatPanel();
  saveState();
}

export function adjustCultistHp(i, amt) {
  const cf = AppState.combat.cultFanatics[i];
  cf.hp = Math.max(0, Math.min(cf.maxHp, cf.hp + amt));
  renderCombatPanel();
  saveState();
}

export function toggleDominate() {
  AppState.combat.dominateJean.active = !AppState.combat.dominateJean.active;
  AppState.combat.dominateJean.auraWithParty = !AppState.combat.dominateJean.active;
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

export function toggleCombatPanel() {
  AppState.combatPanelOpen = !AppState.combatPanelOpen;
  $('app').classList.toggle('combat-open', AppState.combatPanelOpen);
  if (AppState.combatPanelOpen) {
    renderCombatPanel();
    syncFullInitiative();
    vttSync(createCombatStartMsg());
  } else {
    vttSync(createCombatEndMsg());
  }
  saveState();
}
