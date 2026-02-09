// VTT Theater — Scene display, crossfade, title cards

import { EventBus, state } from './state.js';
import { SCENES, ACTS } from './data.js';

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

  sceneIdLabel = document.createElement('div');
  sceneIdLabel.className = 'theater-scene-id';
  $('theater').appendChild(sceneIdLabel);

  EventBus.on('scene:next', () => cycleScene(1));
  EventBus.on('scene:prev', () => cycleScene(-1));
  EventBus.on('scene:goto', gotoScene);
  EventBus.on('title-card:show', showTitleCard);
  EventBus.on('overlay-text:show', showOverlayText);

  loadScene(state.sceneIndex, false);
}

function cycleScene(dir) {
  const next = state.sceneIndex + dir;
  if (next < 0 || next >= SCENES.length) return;

  const currentAct = SCENES[state.sceneIndex].act;
  const nextAct = SCENES[next].act;

  if (nextAct !== currentAct && dir > 0) {
    showTitleCard({ act: nextAct }, () => {
      state.sceneIndex = next;
      loadScene(next, true);
    });
  } else {
    state.sceneIndex = next;
    loadScene(next, true);
  }
}

function gotoScene(sceneId) {
  const idx = SCENES.findIndex(s => s.id === sceneId);
  if (idx === -1) return;
  state.sceneIndex = idx;
  loadScene(idx, true);
}

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

  sceneIdLabel.textContent = `${scene.id} — ${scene.title}`;

  if (scene.overlay) {
    showOverlayText({ text: scene.overlay });
  } else {
    hideOverlay();
  }
}

function showPlaceholder(imgEl, scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 0, 1080);
  grad.addColorStop(0, '#141820');
  grad.addColorStop(1, '#0D0F14');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1920, 1080);

  ctx.strokeStyle = '#8B7435';
  ctx.lineWidth = 2;
  ctx.strokeRect(60, 60, 1800, 960);
  ctx.strokeStyle = '#8B743540';
  ctx.lineWidth = 1;
  ctx.strokeRect(48, 48, 1824, 984);

  ctx.fillStyle = '#6B6B78';
  ctx.font = '500 14px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(scene.id, 960, 460);

  ctx.fillStyle = '#E8C55A';
  ctx.font = '600 48px "Cinzel", serif';
  ctx.fillText(scene.title, 960, 540);

  ctx.fillStyle = '#A0A0A8';
  ctx.font = 'italic 20px "Crimson Text", serif';
  const act = ACTS[scene.act - 1];
  if (act) ctx.fillText(`Act ${act.number}: ${act.title}`, 960, 590);

  ctx.fillStyle = '#C9A84C';
  ctx.font = '16px serif';
  ctx.fillText('\u25C6', 960, 640);

  imgEl.src = canvas.toDataURL();
}

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

export function showTitleCard({ act, subtitle }, callback) {
  const actData = typeof act === 'number' ? ACTS[act - 1] : act;
  if (!actData) return;

  const actNum = actData.number || act;
  titleCardAct.textContent = `Act ${actNum}: ${actData.title}`;
  titleCardSub.textContent = subtitle || actData.subtitle || '';

  titleCard.classList.add('visible');
  state.titleCardVisible = true;

  setTimeout(() => {
    titleCard.classList.remove('visible');
    state.titleCardVisible = false;
    if (callback) setTimeout(callback, 600);
  }, 3000);
}

export function getCurrentScene() {
  return SCENES[state.sceneIndex] || null;
}

export function getSceneCount() {
  return SCENES.length;
}
