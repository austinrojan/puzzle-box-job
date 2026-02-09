// Controller boot — wires all modules together

import { loadCampaign, SCENES } from '../../shared/campaign-data.js';
import { createModeSwitchMsg, createSceneMsg } from '../../shared/protocol.js';
import { sceneIndex } from './state.js';
import { send, initSync } from './sync.js';
import {
  updateConnectionStatus, updateUI, updateSceneLabel,
  initModeButtons, initSceneNav, initMapCamera, initTokens,
  initEffects, initOverlay, initTitleCard, initCombat,
  initCondPopupDismiss, navigateScene
} from './ui-builders.js';

// 1. Load campaign data
const manifest = await loadCampaign();
document.querySelector('.header__title').textContent = manifest.title.toUpperCase() + ' \u2014 CONTROLLER';
document.title = manifest.title + ' \u2014 Controller';

// 2. Initialize BroadcastChannel sync
initSync((event) => {
  if (event === 'connected' || event === 'disconnected') updateConnectionStatus();
  if (event === 'update') updateUI();
});

// 3. Build UI
initModeButtons();
initSceneNav();
initMapCamera();
initTokens();
initEffects();
initOverlay();
initTitleCard();
initCombat();
initCondPopupDismiss();

// 4. Keyboard shortcuts
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
