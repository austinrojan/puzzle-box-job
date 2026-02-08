// ============================================
// VTT Theater — Scene display + crossfade + title cards
// ============================================

import { EventBus, state } from './state.js';
import { SCENES, ACTS, getFirstSceneOfAct } from './data.js';

const $ = id => document.getElementById(id);

let bgCurrent = null;
let bgNext = null;
let overlayEl = null;
let titleCard = null;
let titleCardAct = null;
let titleCardSub = null;
let sceneIdLabel = null;

export function init() {
  bgCurrent = $('theater-bg');
  bgNext = $('theater-bg-next');
  overlayEl = $('theater-overlay');
  titleCard = $('title-card');
  titleCardAct = titleCard.querySelector('.title-card__act');
  titleCardSub = titleCard.querySelector('.title-card__subtitle');

  // Create scene ID label (subtle, bottom-right)
  sceneIdLabel = document.createElement('div');
  sceneIdLabel.className = 'theater-scene-id';
  $('theater').appendChild(sceneIdLabel);

  // Listen for scene navigation
  EventBus.on('scene:next', () => cycleScene(1));
  EventBus.on('scene:prev', () => cycleScene(-1));
  EventBus.on('scene:goto', gotoScene);
  EventBus.on('title-card:show', showTitleCard);
  EventBus.on('overlay-text:show', showOverlayText);

  // Show initial scene
  loadScene(state.sceneIndex, false);
}

// Navigate by offset (+1 or -1)
function cycleScene(dir) {
  const next = state.sceneIndex + dir;
  if (next < 0 || next >= SCENES.length) return;

  // Check if we're crossing an act boundary — show title card
  const currentAct = SCENES[state.sceneIndex].act;
  const nextAct = SCENES[next].act;

  if (nextAct !== currentAct && dir > 0) {
    showTitleCard({ act: nextAct }, () => {
      state.sceneIndex = next;
      loadScene(next, true);
      EventBus.emit('scene:loaded', next);
    });
  } else {
    state.sceneIndex = next;
    loadScene(next, true);
  }
}

// Jump to a scene by ID
function gotoScene(sceneId) {
  const idx = SCENES.findIndex(s => s.id === sceneId);
  if (idx === -1) return;
  state.sceneIndex = idx;
  loadScene(idx, true);
}

// Load a scene with optional crossfade
function loadScene(index, crossfade) {
  const scene = SCENES[index];
  if (!scene) return;

  if (crossfade && bgCurrent.src) {
    // Crossfade: load new image into "next" layer, fade it in, then swap
    bgNext.onload = () => {
      bgNext.style.opacity = '1';
      setTimeout(() => {
        bgCurrent.src = bgNext.src;
        bgNext.style.opacity = '0';
        bgNext.onload = null;
      }, 800); // match --transition-scene
    };
    bgNext.onerror = () => {
      showPlaceholder(bgCurrent, scene);
      bgNext.style.opacity = '0';
    };
    bgNext.src = scene.art;
  } else {
    // Direct load (first scene or no crossfade)
    bgCurrent.onload = null;
    bgCurrent.onerror = () => showPlaceholder(bgCurrent, scene);
    bgCurrent.src = scene.art;
  }

  // Update scene ID label
  sceneIdLabel.textContent = `${scene.id} — ${scene.title}`;

  // Show overlay text if scene has one
  if (scene.overlay) {
    showOverlayText({ text: scene.overlay });
  } else {
    hideOverlay();
  }
}

// Placeholder when art isn't generated yet
function showPlaceholder(imgEl, scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');

  // Dark gradient background
  const grad = ctx.createLinearGradient(0, 0, 0, 1080);
  grad.addColorStop(0, '#141820');
  grad.addColorStop(1, '#0D0F14');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1920, 1080);

  // Decorative border
  ctx.strokeStyle = '#8B7435';
  ctx.lineWidth = 2;
  ctx.strokeRect(60, 60, 1800, 960);
  ctx.strokeStyle = '#8B743540';
  ctx.lineWidth = 1;
  ctx.strokeRect(48, 48, 1824, 984);

  // Scene ID
  ctx.fillStyle = '#6B6B78';
  ctx.font = '500 14px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(scene.id, 960, 460);

  // Scene title
  ctx.fillStyle = '#E8C55A';
  ctx.font = '600 48px "Cinzel", serif';
  ctx.fillText(scene.title, 960, 540);

  // Act label
  ctx.fillStyle = '#A0A0A8';
  ctx.font = 'italic 20px "Crimson Text", serif';
  const act = ACTS[scene.act - 1];
  if (act) ctx.fillText(`Act ${act.number}: ${act.title}`, 960, 590);

  // Decorative diamond
  ctx.fillStyle = '#C9A84C';
  ctx.font = '16px serif';
  ctx.fillText('\u25C6', 960, 640);

  imgEl.src = canvas.toDataURL();
}

// Show text overlay at bottom of screen using safe DOM construction
function showOverlayText({ text, speaker }) {
  if (!text) { hideOverlay(); return; }
  overlayEl.textContent = '';

  if (speaker) {
    const speakerEl = document.createElement('div');
    speakerEl.className = 'theater-overlay__speaker';
    speakerEl.textContent = speaker;
    overlayEl.appendChild(speakerEl);
  }

  const textEl = document.createElement('div');
  textEl.className = 'theater-overlay__text';
  textEl.textContent = text;
  overlayEl.appendChild(textEl);

  overlayEl.classList.add('visible');
}

function hideOverlay() {
  overlayEl.classList.remove('visible');
  setTimeout(() => { overlayEl.textContent = ''; }, 600);
}

// Cinematic title card with callback after it fades
export function showTitleCard({ act, subtitle }, callback) {
  const actData = typeof act === 'number' ? ACTS[act - 1] : act;
  if (!actData) return;

  const actNum = actData.number || act;
  titleCardAct.textContent = `Act ${actNum}: ${actData.title}`;
  titleCardSub.textContent = subtitle || actData.subtitle || '';

  EventBus.emit('title-card:visible');
  titleCard.classList.add('visible');
  state.titleCardVisible = true;

  // Hold for 3 seconds, then fade out
  setTimeout(() => {
    titleCard.classList.remove('visible');
    state.titleCardVisible = false;
    EventBus.emit('title-card:hidden');
    if (callback) setTimeout(callback, 600);
  }, 3000);
}

export function getCurrentScene() {
  return SCENES[state.sceneIndex] || null;
}

export function getSceneCount() {
  return SCENES.length;
}
