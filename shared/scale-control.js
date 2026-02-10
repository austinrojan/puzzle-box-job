/**
 * UI Scale Controller
 *
 * Manages per-window UI scaling via CSS custom property --ui-scale.
 * Persists scale preference per-app using localStorage keyed by pathname.
 *
 * Usage:
 *   import { initScaleControl } from './scale-control.js';
 *   initScaleControl();
 */

const STORAGE_PREFIX = 'vtt-ui-scale';
const DEFAULT_SCALE = 1;
const MIN_SCALE = 0.75;
const MAX_SCALE = 1.5;
const STEP = 0.05;

/**
 * Get the localStorage key for the current app window.
 * Uses pathname to differentiate: '/controller', '/dm-guide', etc.
 */
function getStorageKey() {
  // Normalize: strip trailing slashes and index.html
  const path = window.location.pathname
    .replace(/\/index\.html$/, '')
    .replace(/\/$/, '') || '/root';
  return `${STORAGE_PREFIX}:${path}`;
}

/**
 * Load persisted scale value, falling back to default.
 */
function loadScale() {
  try {
    const stored = localStorage.getItem(getStorageKey());
    if (stored !== null) {
      const val = parseFloat(stored);
      if (!isNaN(val) && val >= MIN_SCALE && val <= MAX_SCALE) {
        return val;
      }
    }
  } catch (e) {
    console.warn('[ScaleControl] Could not read localStorage:', e);
  }
  return DEFAULT_SCALE;
}

/**
 * Persist the current scale value.
 */
function saveScale(value) {
  try {
    localStorage.setItem(getStorageKey(), String(value));
  } catch (e) {
    console.warn('[ScaleControl] Could not write localStorage:', e);
  }
}

/**
 * Apply the scale to the document.
 */
function applyScale(value) {
  document.documentElement.style.setProperty('--ui-scale', String(value));
}

/**
 * Format scale as percentage for display.
 */
function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

/**
 * Initialize the scale control UI and behavior.
 * Call this after DOM is ready.
 */
export function initScaleControl() {
  const toggle = document.getElementById('scale-toggle');
  const popover = document.getElementById('scale-popover');
  const slider = document.getElementById('scale-slider');
  const readout = document.getElementById('scale-readout');
  const valueDisplay = document.getElementById('scale-value');
  const resetBtn = document.getElementById('scale-reset');

  // Bail gracefully if UI elements aren't present (e.g., VTT display)
  if (!toggle || !popover || !slider) return;

  // Load and apply persisted scale
  let currentScale = loadScale();
  applyScale(currentScale);
  slider.value = String(currentScale);
  if (readout) readout.textContent = formatPercent(currentScale);
  if (valueDisplay) valueDisplay.textContent = formatPercent(currentScale);

  // Toggle popover
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = popover.hidden;
    popover.hidden = !isHidden;
  });

  // Close popover on outside click
  document.addEventListener('click', (e) => {
    if (!popover.hidden && !popover.contains(e.target) && e.target !== toggle) {
      popover.hidden = true;
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popover.hidden) {
      popover.hidden = true;
      toggle.focus();
    }
  });

  // Slider input (live preview)
  slider.addEventListener('input', () => {
    currentScale = parseFloat(slider.value);
    applyScale(currentScale);
    if (readout) readout.textContent = formatPercent(currentScale);
    if (valueDisplay) valueDisplay.textContent = formatPercent(currentScale);
  });

  // Slider change (persist on release)
  slider.addEventListener('change', () => {
    saveScale(currentScale);
  });

  // Reset button
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      currentScale = DEFAULT_SCALE;
      slider.value = String(DEFAULT_SCALE);
      applyScale(DEFAULT_SCALE);
      saveScale(DEFAULT_SCALE);
      if (readout) readout.textContent = formatPercent(DEFAULT_SCALE);
      if (valueDisplay) valueDisplay.textContent = formatPercent(DEFAULT_SCALE);
    });
  }

  // Listen for storage events from other tabs of the same app
  window.addEventListener('storage', (e) => {
    if (e.key === getStorageKey() && e.newValue !== null) {
      const newScale = parseFloat(e.newValue);
      if (!isNaN(newScale) && newScale >= MIN_SCALE && newScale <= MAX_SCALE) {
        currentScale = newScale;
        applyScale(newScale);
        slider.value = String(newScale);
        if (readout) readout.textContent = formatPercent(newScale);
        if (valueDisplay) valueDisplay.textContent = formatPercent(newScale);
      }
    }
  });
}
