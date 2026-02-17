// vtt/js/camera-presets.js
// DM camera presets with hotkey recall, localStorage persistence,
// and BroadcastChannel sync (import/export for PRESET_SYNC messages).

import { localToShared } from '../../shared/protocol.js';
import { EventBus } from './state.js';

const STORAGE_KEY = 'vtt-camera-presets';
const MAX_HOTKEY = 9;

export class CameraPresetManager {
  /** @type {Map<string, CameraPreset>} */
  _presets = new Map();

  /** @type {FlyToAnimator} */
  _animator;

  /** @type {string|null} */
  _currentMapId = null;

  constructor(animator) {
    this._animator = animator;
    this._loadFromStorage();

    this._hotkeyHandler = (e) => {
      if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      const num = parseInt(e.key);
      if (isNaN(num) || num < 1 || num > MAX_HOTKEY) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      this.recallByHotkey(num);
    };
  }

  /**
   * Save the current camera position as a preset.
   *
   * @param {string} name
   * @param {Camera} camera
   * @param {{ width: number, height: number }} viewport
   * @param {object} [opts]
   * @returns {CameraPreset}
   */
  save(name, camera, viewport, opts = {}) {
    const shared = localToShared(camera, viewport);
    const preset = {
      id: crypto.randomUUID(),
      name,
      camera: shared,
      transition: {
        duration: opts.duration ?? null,
        rho: opts.rho ?? 1.42,
      },
      hotkey: opts.hotkey ?? null,
      icon: opts.icon ?? null,
      sortOrder: this._presetsForCurrentMap().length,
      mapId: this._currentMapId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this._presets.set(preset.id, preset);
    this._saveToStorage();
    this._emitChanged();
    return preset;
  }

  /**
   * Recall a preset: animate the camera to the saved position.
   * @param {string} presetId
   * @returns {boolean}
   */
  recall(presetId) {
    const preset = this._presets.get(presetId);
    if (!preset) return false;

    this._animator.flyTo(preset.camera, {
      duration: preset.transition.duration,
      rho: preset.transition.rho,
    });

    EventBus.emit('presets:recalled', { preset });
    return true;
  }

  /**
   * Recall a preset by its hotkey number (1-9).
   * @param {number} num
   * @returns {boolean}
   */
  recallByHotkey(num) {
    const preset = this._presetsForCurrentMap().find(p => p.hotkey === String(num));
    if (!preset) return false;
    return this.recall(preset.id);
  }

  /**
   * Update a preset's properties.
   * @param {string} presetId
   * @param {Partial<CameraPreset>} changes
   */
  update(presetId, changes) {
    const preset = this._presets.get(presetId);
    if (!preset) return;

    // If reassigning a hotkey, clear it from any other preset on this map
    if (changes.hotkey) {
      for (const p of this._presetsForCurrentMap()) {
        if (p.hotkey === changes.hotkey && p.id !== presetId) {
          p.hotkey = null;
        }
      }
    }

    Object.assign(preset, changes, { updatedAt: Date.now() });
    this._saveToStorage();
    this._emitChanged();
  }

  /**
   * Update a preset's camera position to the current view.
   * @param {string} presetId
   * @param {Camera} camera
   * @param {{ width: number, height: number }} viewport
   */
  updatePosition(presetId, camera, viewport) {
    const preset = this._presets.get(presetId);
    if (!preset) return;

    preset.camera = localToShared(camera, viewport);
    preset.updatedAt = Date.now();
    this._saveToStorage();
    this._emitChanged();
  }

  /**
   * Delete a preset.
   * @param {string} presetId
   */
  delete(presetId) {
    this._presets.delete(presetId);
    this._saveToStorage();
    this._emitChanged();
  }

  /**
   * Get all presets for the current map, sorted by sortOrder.
   * @returns {CameraPreset[]}
   */
  listForCurrentMap() {
    return this._presetsForCurrentMap().sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * Set the current map ID. Presets are per-map.
   * @param {string} mapId
   */
  setCurrentMap(mapId) {
    this._currentMapId = mapId;
    this._emitChanged();
  }

  /**
   * Export all presets as a serializable array.
   * Used for PRESET_SYNC messages and WELCOME payloads.
   * @returns {CameraPreset[]}
   */
  exportAll() {
    return [...this._presets.values()];
  }

  /**
   * Import presets from an external source (PRESET_SYNC or WELCOME).
   * Replaces the entire preset collection.
   * @param {CameraPreset[]} presets
   */
  importAll(presets) {
    if (!Array.isArray(presets) || presets.length === 0) return;
    this._presets.clear();
    for (const p of presets) {
      if (p && p.id) this._presets.set(p.id, p);
    }
    this._saveToStorage();
    this._emitChanged();
  }

  /** Bind Shift+1..9 keyboard shortcuts for preset recall. */
  bindHotkeys() {
    document.addEventListener('keydown', this._hotkeyHandler);
  }

  /** Remove keyboard shortcut listener. */
  unbindHotkeys() {
    document.removeEventListener('keydown', this._hotkeyHandler);
  }

  // --- Private helpers ---

  _emitChanged() {
    EventBus.emit('presets:changed', { presets: this.listForCurrentMap() });
  }

  _presetsForCurrentMap() {
    if (!this._currentMapId) return [...this._presets.values()];
    return [...this._presets.values()].filter(p => p.mapId === this._currentMapId);
  }

  _saveToStorage() {
    try {
      const data = JSON.stringify([...this._presets.values()]);
      localStorage.setItem(STORAGE_KEY, data);
    } catch (e) {
      console.warn('[CameraPresetManager] Failed to save to localStorage:', e);
    }
  }

  _loadFromStorage() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return;
      const presets = JSON.parse(data);
      for (const p of presets) {
        this._presets.set(p.id, p);
      }
    } catch (e) {
      console.warn('[CameraPresetManager] Failed to load from localStorage:', e);
    }
  }

  destroy() {
    this.unbindHotkeys();
  }
}
