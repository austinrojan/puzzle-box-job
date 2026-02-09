// VTT Player Controls — Bottom navigation bar

import { EventBus, state, store } from './state.js';
import { SCENES, MAPS } from './data.js';
import * as sceneNavigator from './scene-navigator.js';

const $ = id => document.getElementById(id);

function el(tag, { cls, text, aria, onClick } = {}) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  if (aria) node.setAttribute('aria-label', aria);
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

let navEl = null;
let leftRegion = null;
let centerRegion = null;
let rightRegion = null;

let prevBtn = null;
let nextBtn = null;
let badgeEl = null;
let titleEl = null;
let expandIcon = null;
let titleGroupEl = null;
let modeButtons = {};
let gridBtn = null;
let fitBtn = null;
let nextTurnBtn = null;
let zoomOutBtn = null;
let zoomInBtn = null;
let zoomLabel = null;

let currentMapIndex = 0;

export function init() {
  navEl = $('player-nav');
  if (!navEl) return;

  buildNav();

  store.subscribe('mode', (mode) => {
    updateModeButtons(mode);
    updateContext();
    rightRegion.classList.toggle('theater-hidden', mode === 'theater');
    nextTurnBtn.hidden = mode !== 'initiative';
    if ((mode === 'map' || mode === 'initiative') && !state.mapId) {
      EventBus.emit('map:load', MAPS[currentMapIndex].id);
    }
  });

  store.subscribe('sceneIndex', () => setTimeout(updateContext, 0));

  store.subscribe('initiative', updateContext);

  store.subscribe('titleCardVisible', (visible) => {
    navEl.classList.toggle('hidden-for-title', visible);
  });

  store.subscribe('gridVisible', (visible) => {
    gridBtn.classList.toggle('toggled', !visible);
  });

  EventBus.on('map:load', onMapLoad);
  EventBus.on('camera:changed', () => {
    const zoom = window.__vtt?.mapRenderer?.camera?.zoom;
    if (zoom != null) {
      zoomLabel.textContent = Math.round(zoom * 100) + '%';
    }
  });
  EventBus.on('navigator:open', () => {
    titleGroupEl.classList.add('pnav-title-group--active');
    expandIcon.classList.add('rotated');
  });
  EventBus.on('navigator:close', () => {
    titleGroupEl.classList.remove('pnav-title-group--active');
    expandIcon.classList.remove('rotated');
  });

  updateModeButtons(state.mode);
  updateContext();
}

function buildNav() {
  buildLeftRegion();
  buildCenterRegion();
  buildRightRegion();

  navEl.appendChild(leftRegion);
  navEl.appendChild(centerRegion);
  navEl.appendChild(rightRegion);
}

function buildLeftRegion() {
  leftRegion = el('div', { cls: 'pnav-left' });

  prevBtn = el('button', { cls: 'pnav-chevron', text: '\u2039', aria: 'Previous', onClick: () => onNavClick(-1) });

  titleGroupEl = el('div', { cls: 'pnav-title-group pnav-title-group--clickable', aria: 'Open scene navigator', onClick: () => sceneNavigator.toggle() });
  titleGroupEl.setAttribute('role', 'button');

  badgeEl = el('span', { cls: 'pnav-badge' });
  titleEl = el('span', { cls: 'pnav-title' });
  expandIcon = el('span', { cls: 'pnav-expand-icon', text: '\u25B4' });

  titleGroupEl.appendChild(badgeEl);
  titleGroupEl.appendChild(titleEl);
  titleGroupEl.appendChild(expandIcon);

  nextBtn = el('button', { cls: 'pnav-chevron', text: '\u203A', aria: 'Next', onClick: () => onNavClick(1) });

  leftRegion.appendChild(prevBtn);
  leftRegion.appendChild(titleGroupEl);
  leftRegion.appendChild(nextBtn);
}

function onNavClick(dir) {
  if (state.mode === 'theater') {
    EventBus.emit(dir === -1 ? 'scene:prev' : 'scene:next');
  } else {
    cycleMap(dir);
  }
}

function cycleMap(dir) {
  currentMapIndex = (currentMapIndex + dir + MAPS.length) % MAPS.length;
  EventBus.emit('map:load', MAPS[currentMapIndex].id);
}

function buildCenterRegion() {
  centerRegion = el('div', { cls: 'pnav-center' });

  const modes = [
    { key: 'theater', label: 'Theater' },
    { key: 'map', label: 'Map' },
    { key: 'initiative', label: 'Combat' },
  ];

  for (const mode of modes) {
    const btn = el('button', { cls: 'pnav-mode-btn', text: mode.label, onClick: () => EventBus.emit('mode:switch', mode.key) });
    btn.dataset.mode = mode.key;
    modeButtons[mode.key] = btn;
    centerRegion.appendChild(btn);
  }
}

function updateModeButtons(activeMode) {
  for (const [key, btn] of Object.entries(modeButtons)) {
    const wasActive = btn.classList.contains('active');
    btn.classList.toggle('active', key === activeMode);
    if (key === activeMode && !wasActive) {
      btn.classList.add('pulse');
      btn.addEventListener('animationend', () => btn.classList.remove('pulse'), { once: true });
    }
  }
}

function buildRightRegion() {
  rightRegion = el('div', { cls: 'pnav-right' });

  const zoomGroup = el('div', { cls: 'pnav-zoom-group' });

  zoomOutBtn = el('button', { cls: 'pnav-zoom-btn', text: '\u2212', aria: 'Zoom out', onClick: () => EventBus.emit('camera:zoom', -1) });
  zoomLabel = el('button', { cls: 'pnav-zoom-label', text: '100%', aria: 'Fit to map', onClick: () => EventBus.emit('camera:reset') });
  zoomInBtn = el('button', { cls: 'pnav-zoom-btn', text: '+', aria: 'Zoom in', onClick: () => EventBus.emit('camera:zoom', 1) });

  zoomGroup.appendChild(zoomOutBtn);
  zoomGroup.appendChild(zoomLabel);
  zoomGroup.appendChild(zoomInBtn);

  gridBtn = el('button', { cls: 'pnav-icon-btn', aria: 'Toggle grid', onClick: () => { state.gridVisible = !state.gridVisible; } });
  const gridIcon = el('div', { cls: 'pnav-grid-icon' });
  for (let i = 0; i < 4; i++) gridIcon.appendChild(document.createElement('span'));
  gridBtn.appendChild(gridIcon);
  gridBtn.classList.toggle('toggled', !state.gridVisible);

  fitBtn = el('button', { cls: 'pnav-icon-btn', aria: 'Fit to map', onClick: () => EventBus.emit('camera:reset') });
  fitBtn.appendChild(el('div', { cls: 'pnav-fit-icon' }));

  nextTurnBtn = el('button', { cls: 'pnav-next-turn', text: 'NEXT \u2192', onClick: () => EventBus.emit('initiative:next-turn') });

  rightRegion.appendChild(zoomGroup);
  rightRegion.appendChild(gridBtn);
  rightRegion.appendChild(fitBtn);
  rightRegion.appendChild(nextTurnBtn);

  if (state.mode === 'theater') {
    rightRegion.classList.add('theater-hidden');
  }
  nextTurnBtn.hidden = state.mode !== 'initiative';
}

function onMapLoad(mapId) {
  const idx = MAPS.findIndex(m => m.id === mapId);
  if (idx !== -1) currentMapIndex = idx;
  updateContext();
}

function updateContext() {
  if (state.mode === 'theater') {
    const scene = SCENES[state.sceneIndex];
    if (scene) {
      badgeEl.textContent = `Act ${scene.act}`;
      titleEl.textContent = scene.title;
    }
    prevBtn.disabled = state.sceneIndex <= 0;
    nextBtn.disabled = state.sceneIndex >= SCENES.length - 1;
  } else {
    const map = MAPS[currentMapIndex];
    if (map) {
      let badge = map.id;
      if (state.mode === 'initiative' && state.initiative.round) {
        badge += '  R' + state.initiative.round;
      }
      badgeEl.textContent = badge;
      titleEl.textContent = map.title;
    }
    prevBtn.disabled = false;
    nextBtn.disabled = false;
  }
}
