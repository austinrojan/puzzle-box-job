// ============================================
// VTT Map Camera — World-space zoom, pan, coordinate transforms
// ============================================
//
// This camera operates in WORLD SPACE. camera.x and camera.y represent
// the world-coordinate position of the viewport's top-left corner.

import { EventBus } from './state.js';
import { normalizeWheel } from './normalize-wheel.js';

// --- Constants ---
const MIN_ZOOM = 0.1;              // absolute floor (safety valve)
const MAX_ZOOM = 5.0;              // absolute ceiling
const ZOOM_SENSITIVITY = 0.6;     // wheel zoom: 0.5 = gentle, 1.0 = aggressive
const ZOOM_STEP_KEY = 0.4;        // per-press keyboard/button step in log2 space
const DRAG_THRESHOLD = 3;          // px before click becomes drag
// Prevents false positives when comparing floating-point zoom to cover zoom
const COVER_ZOOM_EPSILON = 0.001;

/**
 * Caches an element's bounding rect to avoid triggering layout reflow
 * on every mouse event. Invalidated by ResizeObserver, window resize,
 * and window scroll. Checked lazily on getRect().
 */
class BoundsCache {
  constructor() {
    this._rect = null;
    this._valid = false;
    this._el = null;
    this._resizeObserver = null;
    this._invalidate = () => { this._valid = false; };
  }

  observe(el) {
    this.disconnect();
    this._el = el;
    this._valid = false;
    this._resizeObserver = new ResizeObserver(this._invalidate);
    this._resizeObserver.observe(el);
    window.addEventListener('resize', this._invalidate);
    window.addEventListener('scroll', this._invalidate);
  }

  disconnect() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    window.removeEventListener('resize', this._invalidate);
    window.removeEventListener('scroll', this._invalidate);
    this._el = null;
    this._valid = false;
  }

  getRect() {
    if (!this._valid || !this._rect) {
      if (!this._el) return { left: 0, top: 0, width: 0, height: 0 };
      this._rect = this._el.getBoundingClientRect();
      this._valid = true;
    }
    return this._rect;
  }
}

// --- Keyboard camera control ---
const CAMERA_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'
]);

const PAN_SPEED = 600;           // base CSS px/sec
const PAN_SPEED_SHIFT = 1800;    // 3× with Shift held

function _isInputFocused(e) {
  const tag = e.target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
}

/**
 * Keyboard camera control via key state map + rAF loop.
 * The loop only runs while at least one arrow key is held.
 * Pan speed is in screen pixels; panBy() converts to world-space.
 */
class KeyboardController {
  constructor(camera) {
    this._camera = camera;
    this._keys = {};
    this._rafId = null;
    this._lastTimestamp = 0;
    this._active = false;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
    this._tick = this._tick.bind(this);
  }

  attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  _onKeyDown(e) {
    if (_isInputFocused(e)) return;

    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this._keys[e.code] = true;
    }

    // Discrete zoom keys (no repeat, no Ctrl/Cmd modifier)
    if (!e.repeat && !e.ctrlKey && !e.metaKey) {
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        this._camera.zoomToCenter(ZOOM_STEP_KEY);
        return;
      }
      if (e.key === '-') {
        e.preventDefault();
        this._camera.zoomToCenter(-ZOOM_STEP_KEY);
        return;
      }
      // Zoom presets (Shift+0 = ')', Shift+1 = '!' on US keyboards)
      if (e.shiftKey && e.key === ')') {
        e.preventDefault();
        this._camera.fitCover();
        return;
      }
      if (e.shiftKey && e.key === '!') {
        e.preventDefault();
        this._camera.fitContain();
        return;
      }
    }

    // Continuous pan keys
    if (CAMERA_KEYS.has(e.code)) {
      e.preventDefault();
      if (!this._keys[e.code]) {
        this._keys[e.code] = true;
        this._startLoop();
      }
    }
  }

  _onKeyUp(e) {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this._keys[e.code] = false;
    }
    if (CAMERA_KEYS.has(e.code)) {
      this._keys[e.code] = false;
      // Stop loop when no arrow keys are held
      let anyHeld = false;
      for (const k of CAMERA_KEYS) { if (this._keys[k]) { anyHeld = true; break; } }
      if (!anyHeld) this._stopLoop();
    }
  }

  _onBlur() { this._clearKeys(); }

  _onVisibilityChange() {
    if (document.hidden) this._clearKeys();
  }

  _clearKeys() {
    this._keys = {};
    this._stopLoop();
  }

  _startLoop() {
    if (this._active) return;
    this._active = true;
    this._lastTimestamp = performance.now();
    this._rafId = requestAnimationFrame(this._tick);
  }

  _stopLoop() {
    this._active = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _tick(timestamp) {
    if (!this._active) return;

    // Cap dt to prevent teleporting after tab was backgrounded
    const dt = Math.min((timestamp - this._lastTimestamp) / 1000, 0.1);
    this._lastTimestamp = timestamp;

    const speed = this._keys['ShiftLeft'] || this._keys['ShiftRight']
      ? PAN_SPEED_SHIFT
      : PAN_SPEED;

    let dx = 0;
    let dy = 0;
    if (this._keys['ArrowLeft'])  dx -= speed * dt;
    if (this._keys['ArrowRight']) dx += speed * dt;
    if (this._keys['ArrowUp'])    dy -= speed * dt;
    if (this._keys['ArrowDown'])  dy += speed * dt;

    if (dx !== 0 || dy !== 0) {
      // Negate: panBy uses drag convention (positive = viewport left),
      // but ArrowRight should move viewport right.
      this._camera.panBy(-dx, -dy);
    }

    this._rafId = requestAnimationFrame(this._tick);
  }
}

export class Camera {
  constructor() {
    // World-space camera position: top-left corner of the viewport in world coords
    this.x = 0;
    this.y = 0;
    this.zoom = 1.0;

    // Viewport dimensions in CSS pixels (set by viewport scaler or ResizeObserver)
    this.viewportW = 1920;
    this.viewportH = 1080;

    // Map dimensions in world pixels (set when a map loads)
    this.mapW = 0;
    this.mapH = 0;

    // Dynamic zoom floor: recalculated on resize and map load
    this._coverZoom = 0.1;

    // Viewport scale factor (CSS transform scale on the container, if any)
    // In the new architecture this is 1.0 for map mode, but kept for
    // backward compatibility during the transition and for theater mode.
    this.viewportScale = 1;

    // Panning state
    this._panning = false;
    this._pendingPan = false;
    this._panStartX = 0;
    this._panStartY = 0;
    this._panStartCamX = 0;
    this._panStartCamY = 0;
    this._panButton = -1;
    this._panScreenDist = 0;
    this.spaceHeld = false;
    this._el = null;
    this._boundsCache = new BoundsCache();
    this._keyboard = new KeyboardController(this);
  }

  // --- Coordinate conversion ---

  /**
   * Convert screen coordinates (CSS pixels relative to canvas top-left)
   * to world coordinates (map pixel position).
   */
  screenToWorld(sx, sy) {
    return {
      x: sx / this.zoom + this.x,
      y: sy / this.zoom + this.y
    };
  }

  /**
   * Convert world coordinates to screen coordinates.
   */
  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom,
      y: (wy - this.y) * this.zoom
    };
  }

  /**
   * Convert a raw DOM event (MouseEvent, PointerEvent) to canvas-space
   * screen coordinates, accounting for the container's position and
   * any CSS transform scale.
   */
  eventToScreen(e) {
    const rect = this._boundsCache.getRect();
    return {
      x: (e.clientX - rect.left) / this.viewportScale,
      y: (e.clientY - rect.top) / this.viewportScale
    };
  }

  /**
   * Convert a raw DOM event directly to world coordinates.
   * Convenience method combining eventToScreen + screenToWorld.
   */
  eventToWorld(e) {
    const screen = this.eventToScreen(e);
    return this.screenToWorld(screen.x, screen.y);
  }

  // --- Canvas context transforms ---

  /**
   * Apply the camera transform to a 2D canvas context.
   *
   * setTransform(a, b, c, d, e, f) maps to the matrix:
   *   | a c e |     | zoom  0    -x*zoom |
   *   | b d f |  =  | 0     zoom -y*zoom |
   *   | 0 0 1 |     | 0     0    1       |
   *
   * This translates world-space drawing commands to screen-space output.
   * After calling this, ctx.drawImage(img, 0, 0, mapW, mapH) draws the
   * map at the correct position and scale.
   */
  applyTransform(ctx) {
    ctx.setTransform(
      this.zoom, 0,
      0, this.zoom,
      -this.x * this.zoom,
      -this.y * this.zoom
    );
  }

  /**
   * Reset context to identity transform.
   */
  resetTransform(ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // --- Viewport and map configuration ---

  /**
   * Update viewport dimensions. Called by ResizeObserver when the
   * browser window (or the map container) resizes.
   */
  setViewportSize(w, h) {
    if (w <= 0 || h <= 0) return;

    const oldCoverZoom = this._coverZoom;

    this.viewportW = w;
    this.viewportH = h;
    this._updateCoverZoom();

    // If the camera was sitting at (or below) the old cover zoom,
    // snap to the new floor and re-center.
    if (oldCoverZoom > 0 && this.zoom <= oldCoverZoom + COVER_ZOOM_EPSILON) {
      this.zoom = this._coverZoom;
      this._centerMap();
    }

    this._notifyChanged();
  }

  /**
   * Set the viewport scale factor (CSS transform on container).
   * In map mode with the new architecture, this should be 1.0.
   */
  setViewportScale(s) {
    this.viewportScale = s;
  }

  /**
   * Register map dimensions. Called when a new map loads.
   * Automatically fits the map to cover the viewport.
   */
  setMapSize(w, h) {
    this.mapW = w;
    this.mapH = h;
    this._updateCoverZoom();
    this.fitCover();
  }

  /**
   * Recalculate the cover zoom floor based on current viewport and map.
   */
  _updateCoverZoom() {
    if (this.mapW <= 0 || this.mapH <= 0) return;
    this._coverZoom = Math.max(
      this.viewportW / this.mapW,
      this.viewportH / this.mapH
    );
  }

  /**
   * Snap to cover zoom and center the map.
   * This is the "home" position: no black bars, map centered.
   */
  fitCover() {
    if (this.mapW <= 0 || this.mapH <= 0) return;
    this.zoom = this._coverZoom;
    this._centerMap();
    this._notifyChanged();
  }

  /**
   * Snap to contain zoom and center the map.
   * Shows the entire map with possible letterboxing.
   */
  fitContain() {
    if (this.mapW <= 0 || this.mapH <= 0) return;
    this.zoom = Math.min(
      this.viewportW / this.mapW,
      this.viewportH / this.mapH
    );
    this._centerMap();
    this._notifyChanged();
  }

  /**
   * Center the map in the viewport at the current zoom level.
   */
  _centerMap() {
    const visibleW = this.viewportW / this.zoom;
    const visibleH = this.viewportH / this.zoom;
    this.x = (this.mapW - visibleW) / 2;
    this.y = (this.mapH - visibleH) / 2;
  }

  // --- Zoom operations ---

  /**
   * Zoom centered on a screen-space point.
   * @param {number} sx Screen X (CSS px from canvas left)
   * @param {number} sy Screen Y (CSS px from canvas top)
   * @param {number} delta Zoom delta in log2 space. Positive = zoom in.
   */
  zoomAt(sx, sy, delta) {
    const worldBefore = this.screenToWorld(sx, sy);
    const newZoom = this.zoom * Math.pow(2, delta);
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    const worldAfter = this.screenToWorld(sx, sy);
    this.x += worldBefore.x - worldAfter.x;
    this.y += worldBefore.y - worldAfter.y;
    this._notifyChanged();
  }

  /**
   * Zoom centered on viewport midpoint.
   * @param {number} delta Zoom delta in log2 space. Positive = zoom in.
   */
  zoomToCenter(delta) {
    this.zoomAt(this.viewportW / 2, this.viewportH / 2, delta);
  }

  // --- Pan operations ---

  /**
   * Pan by screen-space delta (pixels).
   *
   * Converts screen-space pixel movement to world-space displacement.
   * A rightward mouse drag (positive dx) should move the camera LEFT
   * in world space, revealing content to the right. Hence the sign
   * inversion and division by zoom.
   */
  panBy(dx, dy) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this._notifyChanged();
  }

  /**
   * Set camera position directly (world coordinates).
   * Used for cross-window sync and saved presets.
   */
  setPosition(x, y, zoom) {
    this.x = x;
    this.y = y;
    if (zoom !== undefined) this.zoom = zoom;
    this._notifyChanged();
  }

  // --- Input handling ---

  /**
   * Prevent browser-level zoom on all input vectors.
   */
  _preventBrowserZoom() {
    document.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    }, { passive: false });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) &&
          ['+', '-', '=', '0'].includes(e.key)) {
        e.preventDefault();
      }
    });

    if (typeof GestureEvent !== 'undefined') {
      document.addEventListener('gesturestart', (e) => e.preventDefault(),
        { passive: false });
      document.addEventListener('gesturechange', (e) => e.preventDefault(),
        { passive: false });
    }
  }

  _attachWheelHandler(el) {
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { dx, dy, dz } = normalizeWheel(e);
      if (dz !== 0) {
        const screen = this.eventToScreen(e);
        this.zoomAt(screen.x, screen.y, dz * -ZOOM_SENSITIVITY);
      } else if (dx !== 0 || dy !== 0) {
        this.panBy(-dx, -dy);
      }
    }, { passive: false });
  }

  _attachMouseHandlers(el) {
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this._startPan(e, 1);
        return;
      }
      if (e.button === 2) {
        this._startPan(e, 2);
        return;
      }
      if (e.button === 0 && this.spaceHeld) {
        e.preventDefault();
        e.stopPropagation();
        this._startPan(e, 0);
        return;
      }
      if (e.button === 0) {
        this._pendingPan = true;
        this._panStartX = e.clientX;
        this._panStartY = e.clientY;
        this._panStartCamX = this.x;
        this._panStartCamY = this.y;
        this._panScreenDist = 0;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this._pendingPan) {
        if (window.__vtt?.tokenManager?._dragging) {
          this._pendingPan = false;
          return;
        }
        const dist = Math.abs(e.clientX - this._panStartX)
                   + Math.abs(e.clientY - this._panStartY);
        if (dist > DRAG_THRESHOLD) {
          this._commitPan();
        } else {
          return;
        }
      }

      if (!this._panning) return;

      const dxScreen = e.clientX - this._panStartX;
      const dyScreen = e.clientY - this._panStartY;

      this._panScreenDist = Math.max(
        this._panScreenDist,
        Math.abs(dxScreen) + Math.abs(dyScreen)
      );

      this.x = this._panStartCamX - dxScreen / (this.zoom * this.viewportScale);
      this.y = this._panStartCamY - dyScreen / (this.zoom * this.viewportScale);

      this._notifyChanged();
    });

    window.addEventListener('mouseup', (e) => {
      this._pendingPan = false;
      if (!this._panning || e.button !== this._panButton) return;
      this._panning = false;
      this._panButton = -1;
      if (this._el) {
        this._el.classList.remove('panning');
        this._el.style.cursor = this.spaceHeld ? 'grab' : '';
      }
    });

    el.addEventListener('contextmenu', (e) => {
      if (this._panScreenDist > DRAG_THRESHOLD) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  _attachSpaceKey() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat && !this.spaceHeld) {
        if (_isInputFocused(e)) return;
        this.spaceHeld = true;
        if (this._el) this._el.style.cursor = 'grab';
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceHeld = false;
        if (this._el && !this._panning) this._el.style.cursor = '';
      }
    });
  }

  _attachSafetyGuards(el) {
    window.addEventListener('blur', () => this._cancelPan());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._cancelPan();
    });
    el.addEventListener('mouseleave', () => {
      if (this._panning) this._cancelPan();
    });
  }

  attachTo(el) {
    if (this._el) return;
    this._el = el;
    this._boundsCache.observe(el);
    this._preventBrowserZoom();
    this._keyboard.attach();
    this._attachWheelHandler(el);
    this._attachMouseHandlers(el);
    this._attachSpaceKey();

    EventBus.on('camera:pan', ({ dx, dy }) => this.panBy(dx, dy));
    EventBus.on('camera:zoom', (direction) => {
      this.zoomToCenter(direction > 0 ? ZOOM_STEP_KEY : -ZOOM_STEP_KEY);
    });
    EventBus.on('camera:set-state', ({ x, y, zoom }) => this.setPosition(x, y, zoom));

    this._attachSafetyGuards(el);
  }

  // --- Pan state management ---

  _startPan(e, button) {
    this._panning = true;
    this._pendingPan = false;
    this._panButton = button;
    this._panStartX = e.clientX;
    this._panStartY = e.clientY;
    this._panStartCamX = this.x;
    this._panStartCamY = this.y;
    this._panScreenDist = 0;
    this._setPanCursor(true);
  }

  _commitPan() {
    this._panning = true;
    this._pendingPan = false;
    this._panButton = 0;
    this._setPanCursor(true);
  }

  _cancelPan() {
    this._panning = false;
    this._pendingPan = false;
    this._panButton = -1;
    this._setPanCursor(false);
  }

  _setPanCursor(active) {
    if (!this._el) return;
    this._el.classList.toggle('panning', active);
    this._el.style.cursor = active ? 'grabbing' : '';
  }

  // --- Change notification ---

  _notifyChanged() {
    EventBus.emit('camera:changed');
  }

  // --- Serialization ---

  /**
   * Serialize camera state for cross-window sync.
   */
  serialize() {
    return {
      x: this.x,
      y: this.y,
      zoom: this.zoom,
      mapW: this.mapW,
      mapH: this.mapH
    };
  }

  /**
   * Restore camera state from a serialized snapshot.
   */
  deserialize(data) {
    if (data.x !== undefined) this.x = data.x;
    if (data.y !== undefined) this.y = data.y;
    if (data.zoom !== undefined) this.zoom = data.zoom;
    if (data.mapW !== undefined && data.mapH !== undefined) {
      this.mapW = data.mapW;
      this.mapH = data.mapH;
      this._updateCoverZoom();
    }
    this._notifyChanged();
  }
}
