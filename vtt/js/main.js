// VTT Main — Bootstrap and initialization

import { EventBus, state, store, initSync } from './state.js';
import { preloadAll } from './image-cache.js';
import * as theater from './theater.js';
import * as sceneManager from './scene-manager.js';
import { MapRenderer } from './map-renderer.js';
import { TokenManager } from './token-manager.js';
import * as initiativeTracker from './initiative-tracker.js';
import * as playerControls from './player-controls.js';
import * as sceneNavigator from './scene-navigator.js';
import { EffectsEngine } from './effects-engine.js';

const $ = id => document.getElementById(id);

async function boot() {
  console.log('[VTT] Booting...');

  const loadingEl = $('loading');
  const fillEl = loadingEl.querySelector('.loading__fill');
  const statusEl = loadingEl.querySelector('.loading__status');

  statusEl.textContent = 'Loading assets\u2026';
  await preloadAll(({ loaded, total }) => {
    const pct = Math.round((loaded / total) * 100);
    fillEl.style.width = pct + '%';
    statusEl.textContent = `Loading assets\u2026 ${loaded}/${total}`;
  });

  statusEl.textContent = 'Initializing\u2026';
  fillEl.style.width = '100%';

  initSync();

  theater.init();
  sceneManager.init();

  const mapRenderer = new MapRenderer();
  mapRenderer.init();
  const tokenManager = new TokenManager(mapRenderer);
  tokenManager.init();

  initiativeTracker.init();
  playerControls.init();
  sceneNavigator.init();

  const effectsEngine = new EffectsEngine(mapRenderer);
  effectsEngine.init();

  window.__vtt = { state, store, mapRenderer, tokenManager, effectsEngine, EventBus };

  state.loaded = true;
  state.presentationMode = true;

  // Fade out loading screen
  await new Promise(r => setTimeout(r, 300));
  loadingEl.style.transition = 'opacity 600ms ease';
  loadingEl.style.opacity = '0';
  await new Promise(r => setTimeout(r, 600));
  loadingEl.hidden = true;

  console.log('[VTT] Ready.');
}

boot().catch(err => {
  console.error('[VTT] Boot failed:', err);
  const statusEl = document.querySelector('.loading__status');
  if (statusEl) statusEl.textContent = 'Error: ' + err.message;
});
