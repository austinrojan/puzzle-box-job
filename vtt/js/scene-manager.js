// VTT Scene Manager — Mode switching (theater / map / initiative)

import { EventBus, state, store } from './state.js';

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

  store.subscribe('mode', applyMode);
  applyMode(state.mode);
}

export function switchMode(mode) {
  if (mode === state.mode) return;
  state.mode = mode;
}

function applyMode(mode) {
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

