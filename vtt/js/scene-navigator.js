// ============================================
// VTT Scene Navigator — Slide-up panel
// Grouped scene/map browser triggered from bottom nav
// ============================================

import { EventBus, state } from './state.js';
import { SCENES, MAPS, ACTS } from './data.js';

const $ = id => document.getElementById(id);

const ACT_ICONS = ['\uD83C\uDFAD', '\uD83D\uDD0D', '\uD83D\uDEAA', '\uD83C\uDFF0', '\uD83D\uDCE6', '\u2694\uFE0F'];

function createNavItem(cls, badgeCls, badgeText, titleCls, titleText, onClick) {
  const item = document.createElement('div');
  item.className = cls;

  const badge = document.createElement('span');
  badge.className = badgeCls;
  badge.textContent = badgeText;

  const title = document.createElement('span');
  title.className = titleCls;
  title.textContent = titleText;

  item.appendChild(badge);
  item.appendChild(title);
  item.addEventListener('click', onClick);
  return item;
}

let containerEl = null;
let backdropEl = null;
let panelEl = null;
let bodyEl = null;
let modeLabelEl = null;
let isOpen = false;
let currentMapId = null;

export function init() {
  containerEl = $('scene-navigator');
  if (!containerEl) return;

  currentMapId = MAPS[0]?.id || null;

  buildShell();

  EventBus.on('mode:changed', () => { if (isOpen) renderContent(); });
  EventBus.on('scene:next', () => { if (isOpen) requestAnimationFrame(updateActiveState); });
  EventBus.on('scene:prev', () => { if (isOpen) requestAnimationFrame(updateActiveState); });
  EventBus.on('scene:goto', () => { if (isOpen) requestAnimationFrame(updateActiveState); });
  EventBus.on('map:load', (mapId) => {
    currentMapId = mapId;
    if (isOpen) updateActiveState();
  });
  EventBus.on('menu:close', close);
  EventBus.on('title-card:visible', close);
  EventBus.on('navigator:toggle', toggle);
}

function buildShell() {
  backdropEl = document.createElement('div');
  backdropEl.className = 'scene-nav__backdrop';
  backdropEl.addEventListener('click', close);

  panelEl = document.createElement('div');
  panelEl.className = 'scene-nav__panel';
  panelEl.setAttribute('role', 'dialog');
  panelEl.setAttribute('aria-label', 'Scene navigator');

  // Header
  const header = document.createElement('div');
  header.className = 'scene-nav__header';

  modeLabelEl = document.createElement('span');
  modeLabelEl.className = 'scene-nav__mode-label';
  modeLabelEl.textContent = 'Navigate';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'scene-nav__close';
  closeBtn.setAttribute('aria-label', 'Close navigator');
  closeBtn.textContent = '\u00D7';
  closeBtn.addEventListener('click', close);

  header.appendChild(modeLabelEl);
  header.appendChild(closeBtn);

  // Body
  bodyEl = document.createElement('div');
  bodyEl.className = 'scene-nav__body';

  panelEl.appendChild(header);
  panelEl.appendChild(bodyEl);

  containerEl.appendChild(backdropEl);
  containerEl.appendChild(panelEl);
}

export function open() {
  if (isOpen) return;
  isOpen = true;
  renderContent();
  containerEl.classList.add('open');
  EventBus.emit('navigator:open');

  // Scroll active item into view after transition
  setTimeout(scrollToActive, 80);
}

export function close() {
  if (!isOpen) return;
  isOpen = false;
  containerEl.classList.remove('open');
  EventBus.emit('navigator:close');
}

export function toggle() {
  if (isOpen) close(); else open();
}

// ---- Content rendering ----

function renderContent() {
  bodyEl.textContent = '';
  renderScenes();
  renderDivider();
  renderMaps();
}

function renderScenes() {
  const currentScene = SCENES[state.sceneIndex];
  const currentAct = currentScene ? currentScene.act : 1;

  for (let actNum = 1; actNum <= ACTS.length; actNum++) {
    const act = ACTS[actNum - 1];
    const actScenes = SCENES.filter(s => s.act === actNum);
    const isCurrent = actNum === currentAct;

    const group = document.createElement('div');
    group.className = 'scene-nav__act-group';

    // Act header
    const header = document.createElement('div');
    header.className = 'scene-nav__act-header';
    if (isCurrent) {
      header.classList.add('current-act');
      header.classList.add('expanded');
    }

    const icon = document.createElement('span');
    icon.className = 'scene-nav__act-icon';
    icon.textContent = ACT_ICONS[actNum - 1] || '';

    const title = document.createElement('span');
    title.className = 'scene-nav__act-title';
    title.textContent = `Act ${actNum}: ${act.title}`;

    const count = document.createElement('span');
    count.className = 'scene-nav__act-count';
    count.textContent = actScenes.length;

    const chevron = document.createElement('span');
    chevron.className = 'scene-nav__act-chevron';
    chevron.textContent = '\u25B8';

    header.appendChild(icon);
    header.appendChild(title);
    header.appendChild(count);
    header.appendChild(chevron);

    // Children container (CSS Grid collapse)
    const children = document.createElement('div');
    children.className = 'scene-nav__act-children';
    if (isCurrent) children.classList.add('expanded');

    const inner = document.createElement('div');
    inner.className = 'scene-nav__act-children-inner';

    for (const scene of actScenes) {
      const idx = SCENES.indexOf(scene);
      const item = createNavItem(
        'scene-nav__scene-item', 'scene-nav__scene-badge', scene.id,
        'scene-nav__scene-title', scene.title, () => onSceneClick(scene.id),
      );
      item.dataset.sceneIndex = idx;
      if (idx === state.sceneIndex) item.classList.add('active');

      inner.appendChild(item);
    }

    children.appendChild(inner);

    // Toggle expand/collapse on header click
    header.addEventListener('click', () => {
      header.classList.toggle('expanded');
      children.classList.toggle('expanded');
    });

    group.appendChild(header);
    group.appendChild(children);
    bodyEl.appendChild(group);
  }
}

function renderDivider() {
  const div = document.createElement('div');
  div.className = 'scene-nav__divider';
  bodyEl.appendChild(div);
}

function renderMaps() {
  const label = document.createElement('div');
  label.className = 'scene-nav__section-label';
  label.textContent = 'Maps';
  bodyEl.appendChild(label);

  for (const map of MAPS) {
    const item = createNavItem(
      'scene-nav__map-item', 'scene-nav__map-badge', map.id,
      'scene-nav__map-title', map.title, () => onMapClick(map.id),
    );
    item.dataset.mapId = map.id;
    if (map.id === currentMapId) item.classList.add('active');

    const dims = document.createElement('span');
    dims.className = 'scene-nav__map-dims';
    dims.textContent = `${map.cols}\u00D7${map.rows}`;
    item.appendChild(dims);

    bodyEl.appendChild(item);
  }
}

// ---- Navigation handlers ----

function onSceneClick(sceneId) {
  if (state.mode !== 'theater') {
    EventBus.emit('mode:switch', 'theater');
  }
  EventBus.emit('scene:goto', sceneId);
  close();
}

function onMapClick(mapId) {
  if (state.mode === 'theater') {
    EventBus.emit('mode:switch', 'map');
  }
  EventBus.emit('map:load', mapId);
  close();
}

// ---- Active state sync ----

function updateActiveState() {
  // Update scene active state
  const sceneItems = bodyEl.querySelectorAll('.scene-nav__scene-item');
  for (const item of sceneItems) {
    const idx = parseInt(item.dataset.sceneIndex, 10);
    item.classList.toggle('active', idx === state.sceneIndex);
  }

  // Update map active state
  const mapItems = bodyEl.querySelectorAll('.scene-nav__map-item');
  for (const item of mapItems) {
    item.classList.toggle('active', item.dataset.mapId === currentMapId);
  }
}

function scrollToActive() {
  const active = bodyEl.querySelector('.scene-nav__scene-item.active, .scene-nav__map-item.active');
  if (active) {
    active.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
