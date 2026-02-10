// VTT Viewport Scaler — CSS transform: scale() for responsive display

import { EventBus } from './state.js';

const VTT_W = 1920;
const VTT_H = 1080;

let _scale = 1;
let _initialized = false;

export function getViewportScale() { return _scale; }

export function initViewportScaler() {
  if (_initialized) return;
  _initialized = true;
  const container = document.getElementById('vtt-scale-container');
  if (!container) return;

  function update() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw <= 0 || vh <= 0) return;
    const s = Math.min(vw / VTT_W, vh / VTT_H);
    if (Math.abs(s - _scale) < 0.0001) return;
    _scale = s;
    container.style.transform = `scale(${s})`;
    EventBus.emit('viewport:scaled', { scale: s });
  }

  window.addEventListener('resize', update);
  update();
}
