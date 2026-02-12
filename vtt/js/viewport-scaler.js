// VTT Viewport Scaler — Mode-aware: CSS-scale for theater, fluid for map

import { EventBus } from './state.js';

const VTT_W = 1920;
const VTT_H = 1080;

let _scale = 1;
let _initialized = false;
let _mode = 'theater';
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
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw <= 0 || vh <= 0) return;

  if (_mode === 'theater') {
    const s = Math.min(vw / VTT_W, vh / VTT_H);
    if (Math.abs(s - _scale) < 0.0001) return;
    _scale = s;
    _container.style.transform = `scale(${s})`;
    _container.style.width = VTT_W + 'px';
    _container.style.height = VTT_H + 'px';
    EventBus.emit('viewport:scaled', { scale: s });
  } else {
    _scale = 1;
    _container.style.transform = '';
    _container.style.width = '100%';
    _container.style.height = '100%';
    EventBus.emit('viewport:scaled', { scale: 1 });
  }
}
