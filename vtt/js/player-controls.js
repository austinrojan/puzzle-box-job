// ============================================
// VTT Player Controls — Bottom navigation bar
// Visual UI for scene/map navigation, mode switching,
// and contextual controls (grid, camera, next turn)
// ============================================

import { EventBus, state, store } from './state.js';
import { SCENES, MAPS, ACTS } from './data.js';
import * as sceneNavigator from './scene-navigator.js';

const $ = id => document.getElementById(id);

let navEl = null;
let leftRegion = null;
let centerRegion = null;
let rightRegion = null;

// Left region elements
let prevBtn = null;
let nextBtn = null;
let badgeEl = null;
let titleEl = null;
let expandIcon = null;
let titleGroupEl = null;

// Center region elements
let modeButtons = {};

// Right region elements
let gridBtn = null;
let fitBtn = null;
let nextTurnBtn = null;
let zoomOutBtn = null;
let zoomInBtn = null;
let zoomLabel = null;

// Local state
let currentMapIndex = 0;

export function init() {
  navEl = $('player-nav');
  if (!navEl) return;

  buildNav();

  // --- Store subscriptions (react to state changes) ---
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

  store.subscribe('initiative', () => updateContext());

  store.subscribe('titleCardVisible', (visible) => {
    navEl.classList.toggle('hidden-for-title', visible);
  });

  store.subscribe('gridVisible', (visible) => {
    gridBtn.classList.toggle('toggled', !visible);
  });

  // --- Command events (stay on EventBus) ---
  EventBus.on('scene:next', onSceneChange);
  EventBus.on('scene:prev', onSceneChange);
  EventBus.on('scene:goto', onSceneChange);
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

  // Set initial state
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

// ---- Left region: scene/map title + nav arrows ----

function buildLeftRegion() {
  leftRegion = document.createElement('div');
  leftRegion.className = 'pnav-left';

  prevBtn = document.createElement('button');
  prevBtn.className = 'pnav-chevron';
  prevBtn.textContent = '\u2039';
  prevBtn.setAttribute('aria-label', 'Previous');
  prevBtn.addEventListener('click', onPrevClick);

  titleGroupEl = document.createElement('div');
  titleGroupEl.className = 'pnav-title-group pnav-title-group--clickable';
  titleGroupEl.setAttribute('role', 'button');
  titleGroupEl.setAttribute('aria-label', 'Open scene navigator');
  titleGroupEl.addEventListener('click', () => sceneNavigator.toggle());

  badgeEl = document.createElement('span');
  badgeEl.className = 'pnav-badge';

  titleEl = document.createElement('span');
  titleEl.className = 'pnav-title';

  expandIcon = document.createElement('span');
  expandIcon.className = 'pnav-expand-icon';
  expandIcon.textContent = '\u25B4';

  titleGroupEl.appendChild(badgeEl);
  titleGroupEl.appendChild(titleEl);
  titleGroupEl.appendChild(expandIcon);

  nextBtn = document.createElement('button');
  nextBtn.className = 'pnav-chevron';
  nextBtn.textContent = '\u203A';
  nextBtn.setAttribute('aria-label', 'Next');
  nextBtn.addEventListener('click', onNextClick);

  leftRegion.appendChild(prevBtn);
  leftRegion.appendChild(titleGroupEl);
  leftRegion.appendChild(nextBtn);
}

function onPrevClick() {
  if (state.mode === 'theater') {
    EventBus.emit('scene:prev');
  } else {
    cycleMap(-1);
  }
}

function onNextClick() {
  if (state.mode === 'theater') {
    EventBus.emit('scene:next');
  } else {
    cycleMap(1);
  }
}

function cycleMap(dir) {
  currentMapIndex = (currentMapIndex + dir + MAPS.length) % MAPS.length;
  EventBus.emit('map:load', MAPS[currentMapIndex].id);
}

// ---- Center region: mode switcher ----

function buildCenterRegion() {
  centerRegion = document.createElement('div');
  centerRegion.className = 'pnav-center';

  const modes = [
    { key: 'theater', label: 'Theater' },
    { key: 'map', label: 'Map' },
    { key: 'initiative', label: 'Combat' },
  ];

  for (const mode of modes) {
    const btn = document.createElement('button');
    btn.className = 'pnav-mode-btn';
    btn.textContent = mode.label;
    btn.dataset.mode = mode.key;
    btn.addEventListener('click', () => EventBus.emit('mode:switch', mode.key));
    modeButtons[mode.key] = btn;
    centerRegion.appendChild(btn);
  }
}

function updateModeButtons(activeMode) {
  for (const [key, btn] of Object.entries(modeButtons)) {
    const wasActive = btn.classList.contains('active');
    btn.classList.toggle('active', key === activeMode);
    // Pulse animation on activation
    if (key === activeMode && !wasActive) {
      btn.classList.add('pulse');
      btn.addEventListener('animationend', () => btn.classList.remove('pulse'), { once: true });
    }
  }
}

// ---- Right region: contextual controls ----

function buildRightRegion() {
  rightRegion = document.createElement('div');
  rightRegion.className = 'pnav-right';

  // Zoom control group: [−] [75%] [+]
  const zoomGroup = document.createElement('div');
  zoomGroup.className = 'pnav-zoom-group';

  zoomOutBtn = document.createElement('button');
  zoomOutBtn.className = 'pnav-zoom-btn';
  zoomOutBtn.textContent = '\u2212';
  zoomOutBtn.setAttribute('aria-label', 'Zoom out');
  zoomOutBtn.addEventListener('click', () => EventBus.emit('camera:zoom', -1));

  zoomLabel = document.createElement('button');
  zoomLabel.className = 'pnav-zoom-label';
  zoomLabel.textContent = '100%';
  zoomLabel.setAttribute('aria-label', 'Fit to map');
  zoomLabel.addEventListener('click', () => EventBus.emit('camera:reset'));

  zoomInBtn = document.createElement('button');
  zoomInBtn.className = 'pnav-zoom-btn';
  zoomInBtn.textContent = '+';
  zoomInBtn.setAttribute('aria-label', 'Zoom in');
  zoomInBtn.addEventListener('click', () => EventBus.emit('camera:zoom', 1));

  zoomGroup.appendChild(zoomOutBtn);
  zoomGroup.appendChild(zoomLabel);
  zoomGroup.appendChild(zoomInBtn);

  // Grid toggle
  gridBtn = document.createElement('button');
  gridBtn.className = 'pnav-icon-btn';
  gridBtn.setAttribute('aria-label', 'Toggle grid');
  const gridIcon = document.createElement('div');
  gridIcon.className = 'pnav-grid-icon';
  for (let i = 0; i < 4; i++) gridIcon.appendChild(document.createElement('span'));
  gridBtn.appendChild(gridIcon);
  gridBtn.addEventListener('click', () => { state.gridVisible = !state.gridVisible; });
  gridBtn.classList.toggle('toggled', !state.gridVisible);

  // Fit to map
  fitBtn = document.createElement('button');
  fitBtn.className = 'pnav-icon-btn';
  fitBtn.setAttribute('aria-label', 'Fit to map');
  const fitIcon = document.createElement('div');
  fitIcon.className = 'pnav-fit-icon';
  fitBtn.appendChild(fitIcon);
  fitBtn.addEventListener('click', () => EventBus.emit('camera:reset'));

  // Next turn (initiative only)
  nextTurnBtn = document.createElement('button');
  nextTurnBtn.className = 'pnav-next-turn';
  nextTurnBtn.textContent = 'NEXT \u2192';
  nextTurnBtn.addEventListener('click', () => EventBus.emit('initiative:next-turn'));

  rightRegion.appendChild(zoomGroup);
  rightRegion.appendChild(gridBtn);
  rightRegion.appendChild(fitBtn);
  rightRegion.appendChild(nextTurnBtn);

  // Initial: hide in theater mode
  if (state.mode === 'theater') {
    rightRegion.classList.add('theater-hidden');
  }
  nextTurnBtn.hidden = state.mode !== 'initiative';
}

// ---- State sync handlers ----

function onSceneChange() {
  // Defer one tick so state.sceneIndex is current
  // Use setTimeout instead of rAF — rAF is paused for unfocused tabs
  setTimeout(updateContext, 0);
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
    // Maps wrap around, never disable chevrons
    prevBtn.disabled = false;
    nextBtn.disabled = false;
  }
}
