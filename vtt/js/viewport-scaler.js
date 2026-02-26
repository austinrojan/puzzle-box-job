// VTT Viewport Scaler — Fluid sizing for all modes

import { EventBus } from './state.js';

let _scale = 1;
let _initialized = false;
let _mode = 'theater';
let _appliedMode = null;
let _container = null;

export function getViewportScale() { return _scale; }

export function initViewportScaler() {
  if (_initialized) return;
  _initialized = true;
  _container = document.getElementById('vtt-scale-container');
  if (!_container) return;

  EventBus.on('mode:changed', ({ mode }) => {
    _mode = mode;
    update();
  });

  window.addEventListener('resize', update);
  update();
}

function update() {
  if (!_container) return;
  if (_appliedMode === _mode) return;
  _scale = 1;
  _appliedMode = _mode;
  _container.style.transform = '';
  _container.style.width = '100%';
  _container.style.height = '100%';
  EventBus.emit('viewport:scaled', { scale: 1 });
}
