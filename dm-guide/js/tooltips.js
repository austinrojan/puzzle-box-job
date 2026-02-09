import { ADVENTURE_DATA } from './adventure-data.js';
import { escapeHtml, markdownLite } from './utils.js';

const $ = id => document.getElementById(id);

let _tooltipTimer = null;
let _tooltipEl = null;

export function initTooltips() {
  _tooltipEl = $('tooltip');

  const mainContent = $('main-content');

  mainContent.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-entity]');
    if (!target) return;
    clearTimeout(_tooltipTimer);
    _tooltipTimer = setTimeout(() => showTooltip(target, e.clientX, e.clientY), 200);
  });

  mainContent.addEventListener('mouseout', (e) => {
    const target = e.target.closest('[data-entity]');
    if (!target) return;
    clearTimeout(_tooltipTimer);
    _tooltipTimer = setTimeout(hideTooltip, 100);
  });
}

export function detectEntities(container) {
  const npcNames = Object.values(ADVENTURE_DATA.npcs)
    .map(n => n.name)
    .filter(n => n && n.length > 2);
  const spellNames = Object.keys(ADVENTURE_DATA.spells)
    .filter(n => n.length > 2);

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const node of textNodes) {
    if (node.parentElement?.closest('.entity-npc, .entity-dc, .entity-spell, .dc-badge, .stat-block, code, kbd')) continue;
    let html = escapeHtml(node.textContent);
    let changed = false;

    html = html.replace(/\bDC\s*(\d{1,2})\b/g, (m, dc) => {
      changed = true;
      return `<span class="entity-dc" data-entity="dc" data-dc="${dc}">${m}</span>`;
    });

    for (const name of npcNames) {
      const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('\\b' + safe + '\\b', 'g');
      const key = Object.keys(ADVENTURE_DATA.npcs).find(k => ADVENTURE_DATA.npcs[k].name === name);
      html = html.replace(re, (m) => {
        changed = true;
        return `<span class="entity-npc" data-entity="npc" data-npc-key="${key || ''}">${m}</span>`;
      });
    }

    for (const name of spellNames) {
      const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('\\b' + safe + '\\b', 'g');
      html = html.replace(re, (m) => {
        changed = true;
        return `<span class="entity-spell" data-entity="spell" data-spell="${name}">${m}</span>`;
      });
    }

    if (changed) {
      const temp = document.createElement('span');
      // Content is from our own ADVENTURE_DATA, not user input
      temp.innerHTML = html;
      node.parentElement.replaceChild(temp, node);
    }
  }
}

export function showTooltip(target, x, y) {
  if (!_tooltipEl) return;
  const entity = target.dataset.entity;
  let html = '';

  if (entity === 'npc') {
    const npc = ADVENTURE_DATA.npcs[target.dataset.npcKey];
    if (!npc) return;
    html = `<div class="tooltip-title">${escapeHtml(npc.name)}</div>`
      + `<div class="tooltip-subtitle">${escapeHtml(npc.role)}</div>`
      + `<div class="tooltip-body">${markdownLite(npc.tooltipSummary || npc.personality || '')}</div>`;
  } else if (entity === 'dc') {
    const dc = parseInt(target.dataset.dc);
    html = `<div class="tooltip-title">DC ${dc}</div>`;
    const pcs = Object.values(ADVENTURE_DATA.pcs);
    if (pcs.length > 0) {
      html += '<div class="tooltip-body" style="margin-top:4px">';
      for (const pc of pcs) {
        if (!pc.name || pc.name === 'TBD') continue;
        const skills = pc.keySkills || '';
        html += `<div style="display:flex;justify-content:space-between;gap:8px">`
          + `<span style="color:var(--text-primary)">${escapeHtml(pc.name)}</span>`
          + `<span class="font-mono" style="color:var(--gold)">${escapeHtml(skills.substring(0, 40))}</span></div>`;
      }
      html += '</div>';
    }
  } else if (entity === 'spell') {
    const spell = ADVENTURE_DATA.spells[target.dataset.spell];
    if (!spell) return;
    const desc = spell.description;
    const truncated = desc.length > 200 ? markdownLite(desc.substring(0, 200)) + '...' : markdownLite(desc);
    html = `<div class="tooltip-title">${escapeHtml(target.dataset.spell)}</div>`
      + `<div class="tooltip-subtitle">Level ${spell.level} ${escapeHtml(spell.school)}</div>`
      + `<div class="tooltip-body">${truncated}</div>`;
  }

  if (!html) return;
  // Tooltip content built from our own ADVENTURE_DATA (escapeHtml'd), not user input
  _tooltipEl.innerHTML = html;
  _tooltipEl.classList.add('visible');

  const rect = _tooltipEl.getBoundingClientRect();
  const left = Math.min(x + 12, window.innerWidth - rect.width - 16);
  let top = y + 16;
  if (top + rect.height > window.innerHeight - 16) top = y - rect.height - 8;
  _tooltipEl.style.left = `${left}px`;
  _tooltipEl.style.top = `${top}px`;
}

export function hideTooltip() {
  _tooltipEl?.classList.remove('visible');
}
