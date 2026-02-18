// Controller boot — wires all modules together

import { loadCampaign, SCENES } from '../../shared/campaign-data.js';
import { createModeSwitchMsg, createSceneMsg } from '../../shared/protocol.js';
import { sceneIndex } from './state.js';
import { send, initSync } from './sync.js';
import {
  updateConnectionStatus, updateUI, updateSceneLabel,
  initModeButtons, initSceneNav, initMapCamera, initTokens,
  initEffects, initOverlay, initTitleCard, initCombat,
  initCondPopupDismiss, initPresets, navigateScene
} from './ui-builders.js';
import { Camera } from '../../vtt/js/map-camera.js';
import { CameraSyncEngine } from '../../vtt/js/camera-sync.js';
import { FlyToAnimator } from '../../vtt/js/camera-animator.js';
import { CameraPresetManager } from '../../vtt/js/camera-presets.js';
import { AuthorityElection } from '../../vtt/js/authority-election.js';
import { EventBus } from '../../vtt/js/state.js';

// 1. Load campaign data
const manifest = await loadCampaign();
document.querySelector('.header__title').textContent = manifest.title.toUpperCase() + ' \u2014 CONTROLLER';
document.title = manifest.title + ' \u2014 Controller';

// 2. Initialize BroadcastChannel sync
initSync((event) => {
  if (event === 'connected' || event === 'disconnected') updateConnectionStatus();
  if (event === 'update') updateUI();
});

// 3. Phase 4: Camera sync — headless Camera + CameraSyncEngine
const camera = new Camera();
camera.setViewportSize(1920, 1080); // nominal viewport for headless camera
// Map dimensions bootstrapped via WELCOME from Display

const syncEngine = new CameraSyncEngine({
  camera: camera,
  role: 'controller',
});
syncEngine.start();

// 4. Phase 5: FlyToAnimator + CameraPresetManager
const flyToAnimator = new FlyToAnimator(camera, { w: 1920, h: 1080 });
syncEngine.setAnimator(flyToAnimator);

const presetManager = new CameraPresetManager(flyToAnimator);
syncEngine.setPresetManager(presetManager);
presetManager.bindHotkeys();

// Phase 5: Authority election — lowest windowId wins
const election = new AuthorityElection(
  syncEngine.windowId, 'controller', syncEngine.transport
);
syncEngine.setElection(election);
election.elect();

// When a preset is recalled, broadcast flyTo to Display (authority-gated)
EventBus.on('presets:recalled', ({ preset }) => {
  if (!election.isAuthority) return;
  syncEngine.sendFlyTo(preset.camera, {
    duration: preset.transition.duration,
    rho: preset.transition.rho,
    presetId: preset.id,
  });
});

window.__controller = { camera, syncEngine, flyToAnimator, presetManager, election };

// 5. Build UI
initModeButtons();
initSceneNav();
initMapCamera();
initTokens();
initEffects();
initOverlay();
initTitleCard();
initCombat();
initCondPopupDismiss();
initPresets();

// 6. Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.key) {
    case 'ArrowRight':
    case ']':
      e.preventDefault();
      navigateScene(1);
      break;
    case 'ArrowLeft':
    case '[':
      e.preventDefault();
      navigateScene(-1);
      break;
    case '1': send(createModeSwitchMsg('theater')); break;
    case '2': send(createModeSwitchMsg('map')); break;
    case '3': send(createModeSwitchMsg('initiative')); break;
  }
});
