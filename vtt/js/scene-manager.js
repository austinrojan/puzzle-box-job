// ============================================
// VTT Scene Manager — Mode switching
// Theater <-> Map <-> Initiative transitions
// ============================================

import { EventBus, state } from './state.js';

const $ = id => document.getElementById(id);

let theaterEl = null;
let mapEl = null;
let initPanel = null;

export function init() {
  theaterEl = $('theater');
  mapEl = $('map-container');
  initPanel = $('initiative-panel');

  EventBus.on('mode:switch', switchMode);
  EventBus.on('combat:start', () => switchMode('initiative'));
  EventBus.on('combat:end', () => switchMode('map'));

  // Apply initial mode
  applyMode(state.mode);
}

export function switchMode(mode) {
  if (mode === state.mode) return;
  applyMode(mode);
  state.mode = mode;  // Bridge emits 'mode:changed' with {mode, prev}
}

function applyMode(mode) {
  // Hide all layers
  theaterEl.hidden = true;
  mapEl.hidden = true;
  initPanel.hidden = true;

  switch (mode) {
    case 'theater':
      theaterEl.hidden = false;
      break;
    case 'map':
      mapEl.hidden = false;
      break;
    case 'initiative':
      mapEl.hidden = false;
      initPanel.hidden = false;
      break;
  }
}

export function getCurrentMode() {
  return state.mode;
}
