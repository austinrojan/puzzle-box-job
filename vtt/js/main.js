// VTT Main — Bootstrap and initialization

import { EventBus, state, store, initSync } from './state.js';
import { preloadAll } from './image-cache.js';
import { runPreflight, renderPreflightResults } from './preflight.js';
import { loadSavedState, validateRestoredState, initAutoSave, saveImmediate, clearSavedState } from './persistence.js';
import { SCENES, loadCampaign } from './data.js';
import * as theater from './theater.js';
import * as sceneManager from './scene-manager.js';
import { MapRenderer } from './map-renderer.js';
import { TokenManager } from './token-manager.js';
import * as initiativeTracker from './initiative-tracker.js';
import * as playerControls from './player-controls.js';
import * as sceneNavigator from './scene-navigator.js';
import { EffectsEngine } from './effects-engine.js';
import { initViewportScaler, getViewportScale } from './viewport-scaler.js';
import { CameraSyncEngine } from './camera-sync.js';
import { FlyToAnimator } from './camera-animator.js';

const $ = id => document.getElementById(id);
const delay = ms => new Promise(r => setTimeout(r, ms));

async function boot() {
  console.log('[VTT] Booting...');

  const loadingEl = $('loading');
  const fillEl = loadingEl.querySelector('.loading__fill');
  const statusEl = loadingEl.querySelector('.loading__status');

  statusEl.textContent = 'Loading campaign\u2026';
  const manifest = await loadCampaign();
  document.title = manifest.title + ' \u2014 VTT';
  const titleEl = loadingEl.querySelector('.loading__title');
  if (titleEl) titleEl.textContent = manifest.title;

  statusEl.textContent = 'Loading assets\u2026';
  const preloadResults = await preloadAll(({ completed, total }) => {
    const pct = Math.round((completed / total) * 100);
    fillEl.style.width = pct + '%';
    statusEl.textContent = `Loading assets\u2026 ${completed}/${total}`;
  });

  // Pre-flight diagnostic checks
  statusEl.textContent = 'Running pre-flight checks\u2026';
  const preflightResults = runPreflight(preloadResults);
  const preflightOk = renderPreflightResults(preflightResults, loadingEl);

  if (!preflightOk) {
    statusEl.textContent = 'Issues detected. Continuing in 3s\u2026';
    await delay(3000);
  }

  statusEl.textContent = 'Initializing\u2026';
  fillEl.style.width = '100%';

  // Initialize BroadcastChannel
  initSync();

  // Initialize viewport scaler (CSS transform applied before modules measure rects)
  initViewportScaler();

  // Initialize all modules (registers store subscribers)
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

  // State recovery
  const saved = loadSavedState();
  if (saved) {
    console.log('[VTT] Restoring saved state from', new Date(saved._savedAt).toLocaleTimeString());
    const validated = validateRestoredState(saved);

    // Restore fog BEFORE map:load so MapRenderer reads it during loadMap()
    if (validated.fog) {
      Object.assign(state.fog, validated.fog);
    }

    // Patch reactive keys (triggers subscribers for mode, initiative, etc.)
    const { fog, tokens, ...reactiveKeys } = validated;
    store.patch(reactiveKeys);

    // Explicit kicks for modules that aren't reactive to their state keys:
    // Theater only loads scenes via EventBus commands, not store subscriptions
    if (validated.sceneIndex != null && validated.sceneIndex > 0) {
      const scene = SCENES[validated.sceneIndex];
      if (scene) EventBus.emit('scene:goto', scene.id);
    }
    // MapRenderer listens to EventBus 'map:load', not store
    if (validated.mapId) {
      EventBus.emit('map:load', validated.mapId);
    }
    // TokenManager has a separate internal array from state.tokens
    if (tokens && tokens.length > 0) {
      tokenManager.restoreTokens(tokens);
    }
  }

  // Wire auto-save
  initAutoSave(store);
  window.addEventListener('beforeunload', () => saveImmediate(store));

  // Wire viewport scale to camera (set current + listen for future changes)
  mapRenderer.camera.setViewportScale(getViewportScale());
  EventBus.on('viewport:scaled', ({ scale }) => {
    mapRenderer.camera.setViewportScale(scale);
  });

  // Initialize camera sync engine (Phase 4)
  const syncEngine = new CameraSyncEngine({
    camera: mapRenderer.camera,
    role: 'display',
  });
  syncEngine.start();

  // Phase 5: FlyToAnimator for cinematic camera transitions
  const camera = mapRenderer.camera;
  const flyToAnimator = new FlyToAnimator(camera, { w: camera.viewportW, h: camera.viewportH });
  syncEngine.setAnimator(flyToAnimator);

  // Keep animator viewport in sync with camera viewport
  EventBus.on('camera:changed', () => {
    if (camera.viewportW > 0 && camera.viewportH > 0) {
      flyToAnimator.updateViewport(camera.viewportW, camera.viewportH);
    }
  });

  // Interrupt flyTo animation on user input (wheel, mouse, keyboard)
  const mapContainer = $('map-container');
  if (mapContainer) {
    mapContainer.addEventListener('wheel', () => flyToAnimator.interrupt(), { passive: true, capture: true });
    mapContainer.addEventListener('mousedown', () => flyToAnimator.interrupt(), { capture: true });
  }

  // Expose debugging interface
  window.__vtt = { state, store, mapRenderer, tokenManager, effectsEngine, EventBus, clearSavedState, getViewportScale, syncEngine, flyToAnimator };

  // Go live
  state.loaded = true;
  state.presentationMode = true;

  // Fade out loading screen
  await delay(300);
  loadingEl.style.transition = 'opacity 600ms ease';
  loadingEl.style.opacity = '0';
  await delay(600);
  loadingEl.hidden = true;

  console.log('[VTT] Ready.' + (saved ? ' (restored from saved state)' : ''));
}

function _createErrorOverlay(err) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: var(--bg-0, #0D0F14);
    color: var(--gold, #C9A84C);
    font-family: 'Cinzel', serif;
    text-align: center; padding: 2rem;
  `;

  const title = document.createElement('h1');
  title.textContent = 'Something Went Wrong';
  title.style.cssText = 'margin-bottom: 1rem; font-size: 28px; letter-spacing: 3px;';

  const msg = document.createElement('p');
  msg.textContent = err.message || String(err);
  msg.style.cssText = `
    color: var(--red-bright, #E74C3C);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 13px; max-width: 600px;
    word-break: break-word; margin-bottom: 0.5rem;
  `;

  const stack = document.createElement('details');
  stack.style.cssText = 'margin-bottom: 1.5rem; max-width: 600px; text-align: left;';
  const summary = document.createElement('summary');
  summary.textContent = 'Stack trace';
  summary.style.cssText = `
    cursor: pointer; font-family: 'IBM Plex Mono', monospace;
    font-size: 11px; color: var(--text-muted, #6B6B78);
  `;
  const stackPre = document.createElement('pre');
  stackPre.textContent = err.stack || 'No stack trace available';
  stackPre.style.cssText = `
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px; color: var(--text-muted, #6B6B78);
    white-space: pre-wrap; margin-top: 0.5rem;
    max-height: 200px; overflow-y: auto;
  `;
  stack.appendChild(summary);
  stack.appendChild(stackPre);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display: flex; gap: 1rem;';

  const retryBtn = document.createElement('button');
  retryBtn.textContent = 'Retry';
  retryBtn.style.cssText = `
    padding: 0.75rem 2rem; cursor: pointer;
    background: var(--gold, #C9A84C); color: var(--bg-0, #0D0F14);
    border: none; font-family: 'Cinzel', serif;
    font-size: 16px; border-radius: 4px;
    font-weight: 600; letter-spacing: 1px;
  `;
  retryBtn.onclick = () => location.reload();

  const freshBtn = document.createElement('button');
  freshBtn.textContent = 'Fresh Start';
  freshBtn.style.cssText = `
    padding: 0.75rem 2rem; cursor: pointer;
    background: transparent; color: var(--text-secondary, #A0A0A8);
    border: 1px solid var(--bg-4, #2A3148);
    font-family: 'Cinzel', serif;
    font-size: 14px; border-radius: 4px;
  `;
  freshBtn.onclick = () => {
    clearSavedState();
    location.reload();
  };

  btnRow.appendChild(retryBtn);
  btnRow.appendChild(freshBtn);
  overlay.appendChild(title);
  overlay.appendChild(msg);
  overlay.appendChild(stack);
  overlay.appendChild(btnRow);
  return overlay;
}

boot().catch(err => {
  console.error('[VTT] Boot failed:', err);
  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.hidden = true;
  document.body.appendChild(_createErrorOverlay(err));
});
