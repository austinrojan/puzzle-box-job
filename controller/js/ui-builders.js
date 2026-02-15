// Controller UI builders — DOM construction and update functions

import {
  SCENES, ACTS, MAPS, TOKENS, MAP_PRESETS, EFFECTS, CONDITIONS
} from '../../shared/campaign-data.js';
import {
  createSceneMsg, createMapMsg, createModeSwitchMsg,
  createFogRevealAllMsg, createFogHideAllMsg, createGridToggleMsg,
  createTokenLoadPresetMsg, createTokenRemoveAllMsg, createTokenAddMsg,
  createTokenUpdateConditionMsg, createTokenVisibilityMsg,
  createTokenRemoveOneMsg, createEffectMsg, createOverlayTextMsg,
  createTitleCardMsg, createInitiativeNextMsg
} from '../../shared/protocol.js';
import { vttState, connected, sceneIndex, setSceneIndex } from './state.js';
import { send } from './sync.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

let mapSelectDirty = false;
let mapSelectDirtyTimer = null;

// ============================================
// Shared helpers
// ============================================
function buildSelect(sel, placeholder, items) {
  if (placeholder) {
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = placeholder;
    sel.appendChild(opt0);
  }
  for (const { value, text } of items) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    sel.appendChild(opt);
  }
}

// ============================================
// Connection status
// ============================================
export function updateConnectionStatus() {
  const el = $('#conn-status');
  if (connected) {
    el.textContent = 'Connected';
    el.className = 'header__status header__status--connected';
  } else {
    el.textContent = 'Waiting\u2026';
    el.className = 'header__status header__status--waiting';
  }
}

// ============================================
// Master UI update
// ============================================
export function updateUI() {
  updateModeButtons();
  updateSceneLabel();
  updateMapSelect();
  updateActiveTokens();
  updateEffectTarget();
  updateCombatInfo();
}

// ============================================
// Mode buttons
// ============================================
export function initModeButtons() {
  $$('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      send(createModeSwitchMsg(btn.dataset.mode));
    });
  });
}

function updateModeButtons() {
  $$('[data-mode]').forEach(btn => {
    btn.classList.toggle('btn--active', btn.dataset.mode === vttState.mode);
  });
}

// ============================================
// Scene navigation
// ============================================
export function updateSceneLabel() {
  const scene = SCENES[sceneIndex];
  if (scene) {
    $('#scene-label').textContent = scene.id + ' \u2014 ' + scene.title;
  }
  $$('.scene-list__item').forEach((el, i) => {
    el.classList.toggle('scene-list__item--active', i === sceneIndex);
  });
}

export function initSceneNav() {
  $('#scene-prev').addEventListener('click', () => {
    if (sceneIndex > 0) {
      setSceneIndex(sceneIndex - 1);
      send(createSceneMsg(SCENES[sceneIndex].id));
      updateSceneLabel();
    }
  });

  $('#scene-next').addEventListener('click', () => {
    if (sceneIndex < SCENES.length - 1) {
      setSceneIndex(sceneIndex + 1);
      send(createSceneMsg(SCENES[sceneIndex].id));
      updateSceneLabel();
    }
  });

  $('#scene-list-toggle').addEventListener('click', () => {
    const body = $('#scene-list-body');
    const isOpen = body.classList.toggle('open');
    $('#scene-list-toggle').textContent = (isOpen ? '\u25BC' : '\u25B6') + ' Scene List';
  });

  buildSceneList();
}

function buildSceneList() {
  const body = $('#scene-list-body');
  let currentAct = 0;
  SCENES.forEach((scene, i) => {
    if (scene.act !== currentAct) {
      currentAct = scene.act;
      const actEl = document.createElement('div');
      actEl.className = 'scene-list__act';
      actEl.textContent = 'Act ' + currentAct + ': ' + ACTS[currentAct - 1].title;
      body.appendChild(actEl);
    }
    const item = document.createElement('div');
    item.className = 'scene-list__item';
    item.textContent = scene.id + '  ' + scene.title;
    item.addEventListener('click', () => {
      setSceneIndex(i);
      send(createSceneMsg(scene.id));
      updateSceneLabel();
    });
    body.appendChild(item);
  });
}

// ============================================
// Navigate scene (for keyboard shortcuts)
// ============================================
export function navigateScene(delta) {
  const next = sceneIndex + delta;
  if (next >= 0 && next < SCENES.length) {
    setSceneIndex(next);
    send(createSceneMsg(SCENES[sceneIndex].id));
    updateSceneLabel();
  }
}

// ============================================
// Map & Camera
// ============================================
export function initMapCamera() {
  buildMapSelect();

  $('#map-select').addEventListener('change', () => {
    mapSelectDirty = true;
    clearTimeout(mapSelectDirtyTimer);
    mapSelectDirtyTimer = setTimeout(() => { mapSelectDirty = false; }, 8000);
  });

  $('#map-load').addEventListener('click', () => {
    const val = $('#map-select').value;
    if (!val) return;
    send(createMapMsg(val));
    mapSelectDirty = false;
    clearTimeout(mapSelectDirtyTimer);

    // Phase 4: Load map image headlessly to discover dimensions for Camera
    const map = MAPS.find(m => m.id === val);
    if (map && window.__controller?.camera) {
      const img = new Image();
      img.onload = () => {
        window.__controller.camera.setMapSize(img.naturalWidth, img.naturalHeight);
      };
      img.src = map.image;
    }
  });

  // Phase 4: Camera controls manipulate local Camera, then explicitly
  // broadcast via sendImmediate(). The rAF-based polling loop in
  // CameraBroadcaster doesn't fire in background tabs, so Controller
  // must push after every discrete change.
  // TODO(phase5): expose syncEngine.sendNow() to avoid _broadcaster private access
  const camPanStep = 80;
  const broadcastAfter = () => {
    window.__controller?.syncEngine?._broadcaster?.sendImmediate();
  };
  $$('[data-cam]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cam = window.__controller?.camera;
      if (!cam) return;
      const dir = btn.dataset.cam;
      switch (dir) {
        case 'up':    cam.panBy(0, camPanStep); break;
        case 'down':  cam.panBy(0, -camPanStep); break;
        case 'left':  cam.panBy(camPanStep, 0); break;
        case 'right': cam.panBy(-camPanStep, 0); break;
        case 'reset': cam.fitCover(); break;
      }
      broadcastAfter();
    });
  });

  $('#zoom-in').addEventListener('click', () => {
    window.__controller?.camera?.zoomToCenter(0.4);
    broadcastAfter();
  });
  $('#zoom-out').addEventListener('click', () => {
    window.__controller?.camera?.zoomToCenter(-0.4);
    broadcastAfter();
  });
  $('#fog-reveal').addEventListener('click', () => send(createFogRevealAllMsg()));
  $('#fog-hide').addEventListener('click', () => send(createFogHideAllMsg()));
  $('#grid-toggle').addEventListener('click', () => send(createGridToggleMsg()));
}

function buildMapSelect() {
  buildSelect(
    $('#map-select'),
    '\u2014 Select Map \u2014',
    MAPS.map(m => ({ value: m.id, text: m.id + ' \u2014 ' + m.title }))
  );
}

function updateMapSelect() {
  if (mapSelectDirty) return;
  const sel = $('#map-select');
  if (document.activeElement === sel) return;
  if (vttState.mapId && sel.value !== vttState.mapId) {
    sel.value = vttState.mapId;
  }
}

// ============================================
// Tokens
// ============================================
export function initTokens() {
  buildPresetSelect();
  buildTokenButtons();

  $('#preset-load').addEventListener('click', () => {
    const val = $('#preset-select').value;
    if (val) send(createTokenLoadPresetMsg(val));
  });

  $('#clear-tokens').addEventListener('click', () => send(createTokenRemoveAllMsg()));
}

function buildPresetSelect() {
  buildSelect(
    $('#preset-select'),
    '\u2014 Preset \u2014',
    Object.entries(MAP_PRESETS).map(([id, p]) => ({ value: id, text: p.label }))
  );
}

function renderTokenGroup(label, items) {
  const group = document.createElement('div');
  group.className = 'token-group';

  const groupLabel = document.createElement('div');
  groupLabel.className = 'token-group__label';
  groupLabel.textContent = label;
  group.appendChild(groupLabel);

  const row = document.createElement('div');
  row.className = 'btn-row';

  for (const { id, def } of items) {
    const btn = document.createElement('button');
    let cls = 'token-btn--npc';
    if (def.isPC) cls = 'token-btn--pc';
    else if (def.isObject) cls = 'token-btn--object';
    btn.className = 'token-btn ' + cls;
    btn.textContent = def.name;
    btn.addEventListener('click', () => {
      send(createTokenAddMsg({ tokenId: id, x: 10, y: 8, label: def.name }));
    });
    row.appendChild(btn);
  }

  group.appendChild(row);
  return group;
}

function buildTokenButtons() {
  const container = $('#token-buttons');
  const groups = { 'Player Characters': [], 'NPCs': [], 'Objects': [] };
  for (const [id, def] of Object.entries(TOKENS)) {
    if (def.isPC) groups['Player Characters'].push({ id, def });
    else if (def.isObject) groups['Objects'].push({ id, def });
    else groups['NPCs'].push({ id, def });
  }

  for (const [label, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    container.appendChild(renderTokenGroup(label, items));
  }
}

function renderTokenRow(token) {
  const def = TOKENS[token.tokenId] || {};
  const row = document.createElement('div');
  row.className = 'active-token';

  const dot = document.createElement('span');
  dot.className = 'active-token__dot';
  dot.style.background = def.isPC ? '#27AE60' : def.isObject ? '#7E57C2' : '#E74C3C';
  row.appendChild(dot);

  const name = document.createElement('span');
  name.className = 'active-token__name';
  name.textContent = token.label || def.name || token.tokenId;
  row.appendChild(name);

  if (token.conditions) {
    for (const cond of token.conditions) {
      const condDef = CONDITIONS.find(c => c.id === cond);
      if (!condDef) continue;
      const badge = document.createElement('span');
      badge.className = 'active-token__cond active-token__cond--' + cond;
      badge.textContent = condDef.label;
      badge.title = 'Remove ' + cond;
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        send(createTokenUpdateConditionMsg(token.id, cond, false));
      });
      row.appendChild(badge);
    }
  }

  const addCond = document.createElement('span');
  addCond.className = 'active-token__vis';
  addCond.textContent = '+';
  addCond.title = 'Add condition';
  addCond.addEventListener('click', (e) => {
    e.stopPropagation();
    showCondPopup(token, e.target);
  });
  row.appendChild(addCond);

  const vis = document.createElement('span');
  vis.className = 'active-token__vis';
  vis.textContent = token.visible ? '\uD83D\uDC41' : '\uD83D\uDEAB';
  vis.title = token.visible ? 'Hide token' : 'Show token';
  vis.addEventListener('click', (e) => {
    e.stopPropagation();
    send(createTokenVisibilityMsg(token.id, !token.visible));
  });
  row.appendChild(vis);

  const remove = document.createElement('span');
  remove.className = 'active-token__remove';
  remove.textContent = '\u2715';
  remove.title = 'Remove token';
  remove.addEventListener('click', (e) => {
    e.stopPropagation();
    send(createTokenRemoveOneMsg(token.id));
  });
  row.appendChild(remove);

  return row;
}

function updateActiveTokens() {
  const container = $('#active-tokens-list');
  const tokens = vttState.tokens || [];

  if (tokens.length === 0) {
    container.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No tokens placed';
    container.appendChild(empty);
    return;
  }

  container.textContent = '';
  for (const token of tokens) {
    container.appendChild(renderTokenRow(token));
  }
}

function showCondPopup(token, anchor) {
  const popup = $('#cond-popup');
  popup.textContent = '';
  popup.style.display = 'flex';

  const rect = anchor.getBoundingClientRect();

  for (const cond of CONDITIONS) {
    const has = (token.conditions || []).includes(cond.id);
    const item = document.createElement('div');
    item.className = 'cond-popup__item' + (has ? ' cond-popup__item--active' : '');
    item.textContent = (has ? '\u2713 ' : '') + cond.id;
    item.addEventListener('click', () => {
      send(createTokenUpdateConditionMsg(token.id, cond.id, !has));
      popup.style.display = 'none';
    });
    popup.appendChild(item);
  }

  const popupRect = popup.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + 4;
  if (left + popupRect.width > window.innerWidth) {
    left = rect.right - popupRect.width;
  }
  if (top + popupRect.height > window.innerHeight) {
    top = rect.top - popupRect.height - 4;
  }
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
}

export function initCondPopupDismiss() {
  document.addEventListener('click', (e) => {
    const popup = $('#cond-popup');
    if (popup.style.display !== 'none' && !popup.contains(e.target)) {
      popup.style.display = 'none';
    }
  });
}

// ============================================
// Effects
// ============================================
export function initEffects() {
  const grid = $('#effects-grid');
  for (const [id, eff] of Object.entries(EFFECTS)) {
    const btn = document.createElement('button');
    btn.className = 'btn btn--sm';
    btn.textContent = eff.name;
    btn.addEventListener('click', () => {
      const target = getEffectTarget();
      send(createEffectMsg(id, target));
    });
    grid.appendChild(btn);
  }
}

function getEffectTarget() {
  const sel = $('#effect-target');
  const val = sel.value;
  if (!val) return {};
  const token = (vttState.tokens || []).find(t => t.id === val);
  if (token) return { col: token.col, row: token.row };
  return {};
}

function updateEffectTarget() {
  const sel = $('#effect-target');
  if (document.activeElement === sel) return;
  const prev = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  for (const t of (vttState.tokens || [])) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.label || t.tokenId;
    sel.appendChild(opt);
  }
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

// ============================================
// Overlay
// ============================================
export function initOverlay() {
  function sendOverlay() {
    const input = $('#overlay-input');
    const val = input.value.trim();
    if (val) {
      send(createOverlayTextMsg(val));
      input.value = '';
    }
  }

  $('#overlay-send').addEventListener('click', sendOverlay);
  $('#overlay-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendOverlay();
  });

  $('#overlay-clear').addEventListener('click', () => {
    send(createOverlayTextMsg(''));
    $('#overlay-input').value = '';
  });
}

// ============================================
// Title Card
// ============================================
export function initTitleCard() {
  buildSelect(
    $('#title-act-select'),
    null,
    ACTS.map(act => ({ value: act.number, text: 'Act ' + act.number + ': ' + act.title }))
  );

  $('#title-send').addEventListener('click', () => {
    const actNum = parseInt($('#title-act-select').value, 10);
    const act = ACTS[actNum - 1];
    if (act) send(createTitleCardMsg(actNum));
  });
}

// ============================================
// Combat
// ============================================
function updateCombatInfo() {
  const container = $('#combat-info');
  const init = vttState.initiative;
  container.textContent = '';

  if (!init || !init.active || !init.entries || init.entries.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'empty-state';
    empty.textContent = 'No active combat';
    container.appendChild(empty);
    return;
  }

  const current = init.entries[init.currentTurn];
  const turnName = current ? (current.displayName || current.name) : '?';

  container.appendChild(document.createTextNode('Round '));

  const roundNum = document.createElement('strong');
  roundNum.textContent = init.round;
  container.appendChild(roundNum);

  container.appendChild(document.createTextNode(', Turn: '));

  const turnEl = document.createElement('span');
  turnEl.className = 'combat-info__turn';
  turnEl.textContent = turnName;
  container.appendChild(turnEl);
}

export function initCombat() {
  $('#next-turn').addEventListener('click', () => {
    const init = vttState.initiative;
    if (!init || !init.active) return;
    const entries = init.entries || init.order || [];
    if (entries.length === 0) return;
    let nextTurn = (init.currentTurn || 0) + 1;
    let nextRound = init.round || 1;
    if (nextTurn >= entries.length) {
      nextTurn = 0;
      nextRound++;
    }
    send(createInitiativeNextMsg(nextTurn, nextRound));
  });

  updateCombatInfo();
}
