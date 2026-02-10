import { ADVENTURE_DATA } from './adventure-data.js';
import { uid, escapeHtml, markdownLite, textToParas } from './utils.js';
import { AppState, saveState } from './state.js';

function collapseState(block) {
  const id = block.id || uid();
  const exp = AppState.collapsed[id] !== false ? '' : 'expanded';
  return { id, exp };
}

function optionalRow(label, value) {
  return value ? `<div class="stat-block-row"><strong>${label}</strong> ${escapeHtml(value)}</div>` : '';
}

export function renderBlock(block) {
  const _fns = {
    'read-aloud': renderReadAloud,
    'dm-note': renderDmNote,
    'dm-tip': renderDmTip,
    'skill-check': renderSkillCheck,
    'encounter': renderEncounter,
    'narrative': renderNarrative,
    'conditional': renderConditional,
    'table': renderTable,
    'vtt-cue': renderVttCue
  };
  return (_fns[block.type] || renderNarrative)(block);
}

export function renderReadAloud(block) {
  const id = block.id || uid();
  const vttBadge = block.vtt ? '<span class="vtt-badge" title="Auto-syncs VTT">\u26A1</span>' : '';
  return `<div class="block-read-aloud" data-block-id="${id}">${vttBadge}<button class="present-btn" onclick="openPresentation('${id}')">\u25B6 Present</button>${textToParas(block.text)}</div>`;
}

export function renderVttCue(block) {
  const icon = block.vtt?.map ? '\uD83D\uDDFA' : '\uD83C\uDFAD';
  const vttJson = JSON.stringify(block.vtt);
  return `<div class="block-vtt-cue" data-vtt='${vttJson.replace(/'/g, "&#39;")}'><span class="block-vtt-cue__icon">${icon}</span><span class="block-vtt-cue__label">${escapeHtml(block.label)}</span></div>`;
}

export function renderDmNote(block) {
  const { id, exp } = collapseState(block);
  return `<div class="block-dm-note" data-block-id="${id}"><div class="block-header ${exp}" onclick="toggleCollapse('${id}', this)"><span class="icon">\uD83D\uDC41</span><span>${escapeHtml(block.title || 'DM Note')}</span><span class="chevron">\u25B6</span></div><div class="block-body ${exp}"><div class="block-body-inner">${textToParas(block.text)}</div></div></div>`;
}

export function renderDmTip(block) {
  const { id, exp } = collapseState(block);
  return `<div class="block-dm-tip" data-block-id="${id}"><div class="block-header ${exp}" onclick="toggleCollapse('${id}', this)"><span>\uD83D\uDCA1 ${escapeHtml(block.title || 'Tip')}</span><span class="chevron">\u25B6</span></div><div class="block-body ${exp}"><div class="block-body-inner">${textToParas(block.text)}</div></div></div>`;
}

export function renderSkillCheck(block) {
  return `<div class="block-skill-check"><div class="dc-badge">DC<br>${block.dc}</div><div class="skill-check-info"><div class="check-name">${escapeHtml(block.check || block.title || 'Check')}</div><div class="check-details">${markdownLite(block.details || block.text || '')}</div></div></div>`;
}

export function renderEncounter(block) {
  return `<div class="block-encounter"><div class="encounter-title">${escapeHtml(block.title || 'Encounter')}</div>${textToParas(block.text)}</div>`;
}

export function renderNarrative(block) {
  return `<div class="block-narrative">${textToParas(block.text)}</div>`;
}

export function renderConditional(block) {
  const { id, exp } = collapseState(block);
  return `<div class="block-conditional" data-block-id="${id}"><div class="block-header ${exp}" onclick="toggleCollapse('${id}', this)"><em>${escapeHtml(block.condition || 'If...')}</em><span class="chevron">\u25B6</span></div><div class="block-body ${exp}"><div class="block-body-inner">${textToParas(block.outcome || block.text)}</div></div></div>`;
}

export function renderTable(block) {
  if (!block.headers || !block.rows) return '';
  const ths = block.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const trs = block.rows.map((row) =>
    `<tr>${row.map((c) => `<td>${markdownLite(c)}</td>`).join('')}</tr>`
  ).join('');
  return `<div class="block-table"><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

export function renderActContent(act) {
  let h = `<div class="act-title">${escapeHtml(act.title)}</div>`;
  h += `<div class="act-duration">${escapeHtml(act.duration || '')}</div>`;
  for (const section of act.sections || []) {
    h += `<div class="section-title" id="${section.id}">${escapeHtml(section.title)}</div>`;
    for (const block of section.blocks || []) {
      h += renderBlock(block);
    }
  }
  return h;
}

export function renderStatBlock(sb) {
  const _abs = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  const vals = [sb.str, sb.dex, sb.con, sb.int, sb.wis, sb.cha];
  const mods = vals.map((v) => {
    const m = Math.floor((v - 10) / 2);
    return m >= 0 ? `+${m}` : `${m}`;
  });

  let h = '<div class="stat-block">';
  h += `<div class="stat-block-name">${escapeHtml(sb.name)}</div>`;
  h += `<div class="stat-block-type">${escapeHtml(sb.type)}</div>`;
  h += '<hr class="stat-block-divider">';
  h += `<div class="stat-block-row"><strong>AC</strong> ${sb.ac}</div>`;
  h += `<div class="stat-block-row"><strong>HP</strong> ${sb.hp}</div>`;
  h += `<div class="stat-block-row"><strong>Speed</strong> ${sb.speed}</div>`;
  h += '<hr class="stat-block-divider"><div class="stat-block-abilities">';
  for (let i = 0; i < 6; i++) {
    h += `<div><div class="ability-label">${_abs[i]}</div><div class="ability-value">${vals[i]}</div><div class="ability-mod">${mods[i]}</div></div>`;
  }
  h += '</div><hr class="stat-block-divider">';
  h += optionalRow('Skills', sb.skills);
  h += optionalRow('Vulnerabilities', sb.vulnerabilities);
  h += optionalRow('Immunities', sb.immunities);
  h += optionalRow('Senses', sb.senses);
  h += optionalRow('Languages', sb.languages);
  if (sb.features) {
    h += '<hr class="stat-block-divider">';
    for (const f of sb.features) {
      h += `<div class="stat-block-action"><span class="action-name">${escapeHtml(f.name)}.</span> ${markdownLite(f.text)}</div>`;
    }
  }
  if (sb.actions) {
    h += '<hr class="stat-block-divider"><div class="subsection-title">Actions</div>';
    for (const a of sb.actions) {
      h += `<div class="stat-block-action"><span class="action-name">${escapeHtml(a.name)}.</span> ${markdownLite(a.text)}</div>`;
    }
  }
  if (sb.tactics) {
    h += '<hr class="stat-block-divider"><div class="subsection-title">Tactics</div>';
    h += `<div class="block-narrative">${textToParas(sb.tactics)}</div>`;
  }
  h += '</div>';
  return h;
}

export function renderNpcDetail(npc) {
  let h = `<div class="act-title">${escapeHtml(npc.name)}</div>`;
  h += `<div class="act-duration">${escapeHtml(npc.role)}</div>`;
  h += `<div class="block-narrative"><p><strong>Personality:</strong> ${markdownLite(npc.personality)}</p>`;
  h += `<p><strong>Location:</strong> ${markdownLite(npc.location)}</p></div>`;
  if (npc.details) h += `<div class="block-narrative">${textToParas(npc.details)}</div>`;
  if (npc.statBlockRef && ADVENTURE_DATA.statBlocks?.[npc.statBlockRef]) {
    h += renderStatBlock(ADVENTURE_DATA.statBlocks[npc.statBlockRef]);
  }
  return h;
}

export function renderWelcome() {
  const m = ADVENTURE_DATA.meta;
  return `<div class="welcome-content"><div class="welcome-title">\u2B21 ${escapeHtml(m.title)}</div><div class="welcome-subtitle">${escapeHtml(m.system)} \u00B7 Level ${m.level} \u00B7 ${m.players} Players \u00B7 ${escapeHtml(m.runtime)}</div><div class="welcome-section-title">Setting</div><div class="block-narrative"><p>${escapeHtml(m.setting)}</p></div><div class="welcome-section-title">Quick Navigation</div><div class="block-narrative"><p>Use the left panel to navigate through acts, or press number keys <kbd>1</kbd>-<kbd>6</kbd> to jump directly to any act.</p></div><div class="welcome-section-title">Keyboard Shortcuts</div><div class="shortcut-grid"><kbd>\u2318K</kbd><span>Open search</span><kbd>1-6</kbd><span>Jump to Act</span><kbd>B</kbd><span>Toggle combat panel</span><kbd>P</kbd><span>Present read-aloud text</span><kbd>\u2318[</kbd><span>Previous tab</span><kbd>\u2318]</kbd><span>Next tab</span><kbd>\u2318W</kbd><span>Close tab</span><kbd>Esc</kbd><span>Close overlay</span></div><div class="welcome-section-title">Session Tools</div><div class="block-narrative"><p>The <strong>Heat Tracker</strong> above tracks party detection level. The <strong>Combat Panel</strong> (press <kbd>B</kbd>) manages the final battle.</p></div><div class="mt-16"><button class="btn btn--danger" onclick="if(confirm('Reset all session data?')) resetState()">Reset Session</button></div></div>`;
}

export function renderReferenceContent(refId) {
  if (refId === 'dc-table') {
    const rows = ADVENTURE_DATA.dcReference.map((r) =>
      `<tr><td>${escapeHtml(r.check)}</td><td class="font-mono" style="color:var(--gold-bright)">DC ${r.dc}</td><td>${markdownLite(r.notes || '')}</td></tr>`
    ).join('');
    return `<div class="act-title">DC Quick Reference</div><div class="block-table"><table><thead><tr><th>Check</th><th>DC</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  if (refId === 'party-stats') {
    const pcs = Object.values(ADVENTURE_DATA.pcs);
    const rows = pcs.map((pc) =>
      `<tr><td><strong>${escapeHtml(pc.name)}</strong></td><td>${escapeHtml(pc.player)}</td><td>${escapeHtml(pc.class)}</td><td class="font-mono">${pc.ac}</td><td class="font-mono">${pc.hp}</td><td class="font-mono">${pc.passivePerception}</td></tr>`
    ).join('');
    return `<div class="act-title">Party Stats</div><div class="block-table"><table><thead><tr><th>Character</th><th>Player</th><th>Class</th><th>AC</th><th>HP</th><th>PP</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  if (refId === 'loot') {
    const rows = ADVENTURE_DATA.loot.map((l) =>
      `<tr><td>${markdownLite(l.item)}</td><td>${escapeHtml(l.location)}</td><td class="font-mono">${escapeHtml(l.value)}</td></tr>`
    ).join('');
    return `<div class="act-title">Loot</div><div class="block-table"><table><thead><tr><th>Item</th><th>Location</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  return '<p class="text-muted">Reference not found.</p>';
}

export function renderToolsContent(toolId) {
  if (toolId === 'foreshadowing') {
    const html = ADVENTURE_DATA.foreshadowing.map((f) => {
      const checked = AppState.foreshadowing[f.id];
      return `<div class="checklist-item ${checked ? 'checked' : ''}"><input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleForeshadowing('${f.id}')"><span>${markdownLite(f.text)}</span></div>`;
    }).join('');
    return `<div class="act-title">Foreshadowing Checklist</div><div class="mt-8">${html}</div>`;
  }
  if (toolId === 'intel') {
    const _items = [
      { id: 'scouting', text: 'Scouting the Mansion' },
      { id: 'pip', text: 'Bribing Pip' },
      { id: 'thorne', text: "Veymar's Rivals (Lord Thorne)" },
      { id: 'knuckles', text: 'Black Market (Knuckles)' },
      { id: 'guards', text: 'Drinking with Guards' },
      { id: 'groundskeeper', text: 'Groundskeeper Info' },
      { id: 'wildshape', text: 'Wild Shape scouting (Oda)' }
    ];
    const html = _items.map((item) => {
      const checked = AppState.intelGathered[item.id];
      return `<div class="checklist-item ${checked ? 'checked' : ''}"><input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleIntel('${item.id}')"><span>${markdownLite(item.text)}</span></div>`;
    }).join('');
    return `<div class="act-title">Intel Checklist</div><div class="mt-8">${html}</div>`;
  }
  return '<p class="text-muted">Tool not found.</p>';
}

export function toggleCollapse(blockId, headerEl) {
  const isCol = AppState.collapsed[blockId] !== false;
  AppState.collapsed[blockId] = !isCol;
  headerEl.classList.toggle('expanded', isCol);
  headerEl.nextElementSibling.classList.toggle('expanded', isCol);
  saveState();
}
