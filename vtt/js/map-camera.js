// ============================================
// VTT Map Camera — World-space zoom, pan, coordinate transforms
// ============================================
//
// This camera operates in WORLD SPACE. camera.x and camera.y represent
// the world-coordinate position of the viewport's top-left corner.

import { EventBus } from './state.js';
import { normalizeWheel } from './normalize-wheel.js';
import { TrackpadGestureDetector, WheelDeviceClassifier } from './trackpad-gesture.js';
import { CameraSpringLoop, SPRING_STIFFNESS } from './camera-spring-loop.js';

// --- Constants ---
const MIN_ZOOM = 0.1;              // absolute floor (safety valve)
const MAX_ZOOM = 5.0;              // absolute ceiling
const ZOOM_SENSITIVITY = 0.6;     // wheel zoom: 0.5 = gentle, 1.0 = aggressive
const ZOOM_STEP_KEY = 0.4;        // per-press keyboard/button step in log2 space
const DRAG_THRESHOLD = 3;          // px before click becomes drag
// Prevents false positives when comparing floating-point zoom to cover zoom
const COVER_ZOOM_EPSILON = 0.001;
const MAX_COAST_SPEED = 3000;     // px/s — Leaflet inertiaMaxSpeed reference
const SETTLE_THRESHOLD_PX = 0.5;  // world-space px — elastic snap-back skip threshold
const INERTIA_THRESHOLD = 100;    // px/s — minimum release speed to trigger inertial coast

// Apple iOS-style rubber-band: asymptotic resistance that grows weaker
// the further you overshoot, preventing the viewport from ever reaching
// infinite displacement. c=0.55 matches the native iOS feel.
function rubberBand(distance, dimension, c = 0.55) {
  if (dimension <= 0) return 0;
  return (distance * dimension * c) / (dimension + c * distance);
}

// Maximum elastic offset in screen-space pixels.
// ~10% of a 1440px viewport. Prevents extreme displacement that looks like a bug.
const MAX_ELASTIC_SCREEN_PX = 150;

const VELOCITY_SAMPLE_COUNT = 4;

export class VelocityTracker {
  constructor() {
    this._samples = [];
    this._index = 0;
    this._count = 0;
  }

  reset() {
    this._samples.length = 0;
    this._index = 0;
    this._count = 0;
  }

  addSample(x, y, t) {
    if (this._samples.length < VELOCITY_SAMPLE_COUNT) {
      this._samples.push({ x, y, t });
    } else {
      this._samples[this._index] = { x, y, t };
    }
    this._index = (this._index + 1) % VELOCITY_SAMPLE_COUNT;
    this._count++;
  }

  getVelocity() {
    const n = Math.min(this._count, VELOCITY_SAMPLE_COUNT);
    if (n < 2) return { vx: 0, vy: 0 };
    const oldestIdx = this._count < VELOCITY_SAMPLE_COUNT ? 0 : this._index;
    const newestIdx = (this._index - 1 + VELOCITY_SAMPLE_COUNT) % VELOCITY_SAMPLE_COUNT;
    const oldest = this._samples[oldestIdx];
    const newest = this._samples[newestIdx];
    const dt = (newest.t - oldest.t) / 1000;
    if (dt < 0.008) return { vx: 0, vy: 0 };
    return {
      vx: (newest.x - oldest.x) / dt,
      vy: (newest.y - oldest.y) / dt,
    };
  }
}

// --- Zoom constants ---
const ZOOM_PER_NOTCH = 1.15;          // ~15% zoom per mouse wheel notch

// ============================================================
// Gesture State Machine — Hierarchical Coordination
// ============================================================
//
// Five ordered decision rules with cooldown and tier separation
// to prevent oscillation during gesture transitions.

const GESTURE_PRIORITY = {
  IDLE: 0, SNAP_BACK: 1, INERTIA: 2, ZOOM_ANIMATE: 3,
  SCROLL_PAN: 4, PINCH_ZOOM: 5, DRAG_PAN: 6
};

const USER_GESTURES = new Set(['SCROLL_PAN', 'PINCH_ZOOM', 'DRAG_PAN']);
const ANIMATION_GESTURES = new Set(['SNAP_BACK', 'INERTIA', 'ZOOM_ANIMATE']);
const COOLDOWN_MS = 50;

class GestureStateMachine {
  constructor(camera) {
    this._camera = camera;
    this._activeGesture = 'IDLE';
    this._gestureStartTime = 0;
    this._lastGestureEndTime = 0;
    this._lastEndedGesture = 'IDLE';
  }

  request(gesture) {
    const now = performance.now();
    const newPri = GESTURE_PRIORITY[gesture];
    const curPri = GESTURE_PRIORITY[this._activeGesture];

    // Rule 1: same gesture retarget — always accept
    if (gesture === this._activeGesture) return true;

    // Rule 2: user preempts animation — always instant
    if (USER_GESTURES.has(gesture) && ANIMATION_GESTURES.has(this._activeGesture)) {
      this._cancelCurrent();
      this._activate(gesture, now);
      return true;
    }

    // Rule 3: user replaces user — higher priority wins instantly, lower denied.
    // (All user gesture priorities are unique, so equal-priority is unreachable.)
    if (USER_GESTURES.has(gesture) && USER_GESTURES.has(this._activeGesture)) {
      if (newPri > curPri) {
        this._cancelCurrent();
        this._activate(gesture, now);
        return true;
      }
      return false;
    }

    // Rule 4: from IDLE — check cooldown (tier-aware)
    if (this._activeGesture === 'IDLE') {
      if (now - this._lastGestureEndTime < COOLDOWN_MS
          && gesture !== this._lastEndedGesture
          && this._lastEndedGesture !== 'IDLE') {
        // Cooldown only blocks same-tier different-type transitions
        const lastWasUser = USER_GESTURES.has(this._lastEndedGesture);
        const newIsUser = USER_GESTURES.has(gesture);
        if (lastWasUser === newIsUser) return false;
      }
      this._activate(gesture, now);
      return true;
    }

    // Rule 5: animation replaces animation — priority decides
    if (newPri >= curPri) {
      this._cancelCurrent();
      this._activate(gesture, now);
      return true;
    }

    return false;
  }

  release(gesture) {
    if (this._activeGesture !== gesture) return;
    this._lastEndedGesture = gesture;
    this._lastGestureEndTime = performance.now();
    this._activeGesture = 'IDLE';
  }

  _activate(gesture, now) {
    this._activeGesture = gesture;
    this._gestureStartTime = now;
  }

  _cancelCurrent() {
    switch (this._activeGesture) {
      case 'INERTIA':
        this._camera._cancelInertialCoast();
        break;
      case 'SNAP_BACK':
        this._camera._cancelSnapBack();
        break;
      case 'ZOOM_ANIMATE': {
        const loop = this._camera._springLoop;
        if (loop) {
          loop.logZoom.setTarget(loop.logZoom.position);
          loop.logZoom.velocity = 0;
        }
        this._camera._zoomAnchor = null;
        break;
      }
      case 'SCROLL_PAN':
        this._camera._trackpadDetector.cancel();
        break;
    }
  }

  get current() { return this._activeGesture; }
}

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
        if (this._camera._springLoop) {
          this._camera._springLoop.syncZoomFromCamera();
        }
        return;
      }
      if (e.key === '-') {
        e.preventDefault();
        this._camera.zoomToCenter(-ZOOM_STEP_KEY);
        if (this._camera._springLoop) {
          this._camera._springLoop.syncZoomFromCamera();
        }
        return;
      }
      // Zoom presets (Shift+0 = ')', Shift+1 = '!' on US keyboards)
      if (e.shiftKey && (e.key === ')' || e.code === 'Digit0')) {
        e.preventDefault();
        this._camera.fitCover();
        return;
      }
      if (e.shiftKey && (e.key === '!' || e.code === 'Digit1')) {
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
      const anyHeld = [...CAMERA_KEYS].some(k => this._keys[k]);
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
    if (this._rafId !== null) { cancelAnimationFrame(this._rafId); this._rafId = null; }
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
    this._dmCanZoomPastCover = false;
    this._lastClampedZoom = NaN;
    this._velocityTracker = new VelocityTracker();
    this._momentumEnabled = true;

    // Dual-position elastic offset (visual displacement beyond hard bounds)
    this.elasticOffsetX = 0;       // world-space
    this.elasticOffsetY = 0;       // world-space
    this._gestureActive = false;   // true when any gesture feeds elastic offset
    this._momentumScrollActive = false;  // true during trackpad momentum (dampened rubber-band)
    this._cumulativeOverflowX = 0; // accumulated overflow for rubber-band calculation
    this._cumulativeOverflowY = 0;
    this._isCoasting = false;       // true during inertial coast (driven by spring loop tick)
    this._coastVx = 0;              // screen-space coast velocity X (px/s)
    this._coastVy = 0;              // screen-space coast velocity Y (px/s)
    this._zoomAnchor = null;        // {wx, wy, sx, sy} for smooth zoom anchor preservation

    this._isSnappingBack = false;        // double-fire defense flag
    this._elasticSnapSignX = 0;          // Sign guard for spring-based snap-back
    this._elasticSnapSignY = 0;
    this._momentumPanSuppressed = false; // suppress panBy during elastic saturation

    // Scroll-wheel behavior preference ('auto' | 'pan' | 'zoom')
    this._scrollWheelBehavior = 'auto';
    try {
      const saved = localStorage.getItem('vtt_scroll_behavior');
      if (saved && ['auto', 'pan', 'zoom'].includes(saved)) {
        this._scrollWheelBehavior = saved;
      }
    } catch { /* storage unavailable (sandboxed iframe, quota exceeded) */ }

    // Cooperative gesture handling for iframe embeds
    this._cooperativeGestures = false;
    this._cooperativeOverlay = null;
    this._cooperativeHideTimer = null;
  }

  // --- Coordinate conversion ---

  /** Visual camera position including elastic overscroll offset. */
  get visualX() { return this.x + this.elasticOffsetX; }
  get visualY() { return this.y + this.elasticOffsetY; }

  /**
   * Convert screen coordinates (CSS pixels relative to canvas top-left)
   * to world coordinates (map pixel position).
   */
  screenToWorld(sx, sy) {
    return {
      x: sx / this.zoom + this.visualX,
      y: sy / this.zoom + this.visualY
    };
  }

  /**
   * Convert screen coordinates to world coordinates using the LOGICAL
   * camera position (ignoring elastic offset). Use for zoom anchors
   * and state persistence where elastic offset must not influence results.
   */
  logicalScreenToWorld(sx, sy) {
    return {
      x: sx / this.zoom + this.x,
      y: sy / this.zoom + this.y
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.visualX) * this.zoom,
      y: (wy - this.visualY) * this.zoom
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
      -this.visualX * this.zoom,
      -this.visualY * this.zoom
    );
  }

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

    this._applyConstraints();
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

  _getMinZoom() {
    if (this._dmCanZoomPastCover) return MIN_ZOOM;
    return Math.max(MIN_ZOOM, this._coverZoom);
  }

  /**
   * Snap to cover zoom and center the map.
   * This is the "home" position: no black bars, map centered.
   */
  fitCover() {
    if (this.mapW <= 0 || this.mapH <= 0) return;
    this.zoom = this._coverZoom;
    this._centerMap();
    this._applyConstraints();
  }

  /**
   * Snap to contain zoom and center the map.
   * Shows the entire map with possible letterboxing.
   */
  fitContain() {
    if (this.mapW <= 0 || this.mapH <= 0) return;
    this.zoom = Math.max(MIN_ZOOM, Math.min(
      this.viewportW / this.mapW,
      this.viewportH / this.mapH
    ));
    this._centerMap();
    // Bypass _applyConstraints — intentionally allows zoom below cover floor
    // but still respects absolute MIN_ZOOM floor
    EventBus.emit('camera:changed');
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

  // --- Boundary clamping ---

  // Dual-regime clamp: if viewport >= map, center; else clamp to [0, map-vis]
  _clampAxis(pos, visSize, mapSize) {
    if (visSize >= mapSize) return -(visSize - mapSize) / 2;
    return Math.max(0, Math.min(mapSize - visSize, pos));
  }

  _applyHardBounds() {
    if (this.mapW <= 0 || this.mapH <= 0) return;
    const visW = this.viewportW / this.zoom;
    const visH = this.viewportH / this.zoom;
    this.x = this._clampAxis(this.x, visW, this.mapW);
    this.y = this._clampAxis(this.y, visH, this.mapH);
  }

  // --- Constraint pipeline ---

  _applyConstraints() {
    // 1. Zoom bounds
    const minZoom = this._getMinZoom();
    if (this.zoom < minZoom) {
      if (this._lastClampedZoom !== this.zoom) {
        console.debug(`[Camera] Zoom ${this.zoom.toFixed(4)} clamped to coverZoom ${minZoom.toFixed(4)} (${this.viewportW}\u00D7${this.viewportH} vp, ${this.mapW}\u00D7${this.mapH} map)`);
        this._lastClampedZoom = this.zoom;
      }
      this.zoom = minZoom;
    } else {
      this.zoom = Math.min(MAX_ZOOM, this.zoom);
    }

    // 2. Pan boundaries: ALWAYS hard clamp.
    // Elastic offset is managed separately by _feedElasticOverflow().
    if (this.mapW > 0 && this.mapH > 0) {
      this._applyHardBounds();
    }

    // 3. Always emit — callers like setPosition() depend on this to notify
    // observers (semantic zoom, BroadcastChannel sync, etc.).
    EventBus.emit('camera:changed');
  }

  // --- Elastic offset methods ---

  /**
   * Update cumulative overflow with input-proportional drain.
   * Replaces the frame-rate-dependent 0.8 decay: reverse-direction
   * input reduces overflow at the rate of input (1:1 gesture feel).
   *
   * @param {number} overflow   This frame's overflow (world-space, signed)
   * @param {number} inputDelta The user's input delta (world-space, signed)
   * @param {number} cumulative Current cumulative overflow
   * @returns {number} Updated cumulative overflow
   */
  _updateCumulativeOverflow(overflow, inputDelta, cumulative) {
    if (overflow !== 0) {
      if (Math.sign(overflow) !== Math.sign(cumulative) && cumulative !== 0) {
        // Direction reversed: hard-reset to the new overflow value
        return overflow;
      }
      return cumulative + overflow;
    }

    // No overflow this frame — the camera is within bounds
    if (Math.abs(cumulative) < 0.01) return 0;

    // Drain proportionally to reverse-direction input
    const inputOpposesOverflow = Math.sign(inputDelta) !== Math.sign(cumulative);
    if (!inputOpposesOverflow) return cumulative;

    const drain = Math.min(Math.abs(inputDelta), Math.abs(cumulative));
    return cumulative - Math.sign(cumulative) * drain;
  }

  /** Apply rubber-band dampening to a single axis of elastic overflow. */
  _rubberBandAxis(overflow, viewportDim, c) {
    if (overflow === 0) return 0;
    const screenOverflow = overflow * this.zoom;
    const dampened = rubberBand(Math.abs(screenOverflow), viewportDim, c);
    const capped = Math.min(dampened, MAX_ELASTIC_SCREEN_PX);
    return Math.sign(overflow) * capped / this.zoom;
  }

  /**
   * Feed overflow (distance past hard bounds) into the elastic offset.
   * The rubber-band formula operates in screen-space pixels for consistent
   * resistance feel, then converts back to world-space for the offset.
   */
  _feedElasticOverflow(overflowX, overflowY) {
    if (!this._gestureActive) return;

    // During snap-back, reject new elastic input (late momentum events).
    if (this._isSnappingBack) return;

    // Dampen rubber-band during trackpad momentum (c=0.3 vs 0.55)
    const c = this._momentumScrollActive ? 0.3 : 0.55;

    this.elasticOffsetX = this._rubberBandAxis(overflowX, this.viewportW, c);
    this.elasticOffsetY = this._rubberBandAxis(overflowY, this.viewportH, c);
  }

  /**
   * Clamp velocity to prevent critically damped spring overshoot.
   *
   * For a critically damped spring x(t) = (A + B·t) · e^(-ω·t) where
   * A = displacement, B = velocity + ω·displacement, the spring crosses
   * its target when B has the opposite sign of A. The zero-overshoot
   * threshold is v_critical = -ω·d (B = 0 → pure exponential decay).
   *
   * @param {number} v     Initial velocity (px/s). Negative = toward target for d > 0.
   * @param {number} d     Initial displacement from target (px).
   * @param {number} omega Spring natural frequency (√stiffness).
   * @returns {number} Clamped velocity guaranteeing no overshoot.
   */
  _clampSpringVelocity(v, d, omega) {
    if (d === 0) return v;
    const vCritical = -omega * d;
    if (d > 0) {
      return Math.max(v, vCritical);
    } else {
      return Math.min(v, vCritical);
    }
  }

  /**
   * Spring snap-back from current elastic offset to zero.
   * Clamps velocity per-axis via _clampSpringVelocity() to prevent overshoot.
   * @param {{ vx: number, vy: number }} velocity  World-space px/s.
   */
  _snapBackElastic(velocity = { vx: 0, vy: 0 }) {
    this._cumulativeOverflowX = 0;
    this._cumulativeOverflowY = 0;

    // Double-fire guard:
    // If snap-back is already running, let it continue undisturbed.
    // Restarting with new velocity causes a visible discontinuity.
    if (this._isSnappingBack) {
      return;
    }

    if (Math.abs(this.elasticOffsetX) < SETTLE_THRESHOLD_PX && Math.abs(this.elasticOffsetY) < SETTLE_THRESHOLD_PX) {
      this.elasticOffsetX = 0;
      this.elasticOffsetY = 0;
      this._isSnappingBack = false;
      EventBus.emit('camera:changed');
      return;
    }

    const loop = this._springLoop;
    loop.elasticX.position = this.elasticOffsetX;
    loop.elasticY.position = this.elasticOffsetY;
    loop.elasticX.setStiffness(SPRING_STIFFNESS.SNAP_BACK);
    loop.elasticY.setStiffness(SPRING_STIFFNESS.SNAP_BACK);

    // Velocity clamp (C3: velocity FIRST, displacement SECOND)
    const omega = loop.elasticX._omega;
    const clampedVx = this._clampSpringVelocity(velocity.vx, this.elasticOffsetX, omega);
    const clampedVy = this._clampSpringVelocity(velocity.vy, this.elasticOffsetY, omega);

    // Store sign for clampSign guard in spring loop tick (C4)
    this._elasticSnapSignX = Math.sign(this.elasticOffsetX);
    this._elasticSnapSignY = Math.sign(this.elasticOffsetY);
    this._isSnappingBack = true;
    loop.elasticX.setTarget(0, { velocity: clampedVx });
    loop.elasticY.setTarget(0, { velocity: clampedVy });

    // Sync pan/zoom springs to current camera state so the loop doesn't
    // overwrite cam.x/y/zoom with stale values from attachTo() time.
    loop.syncPanZoomFromCamera();

    loop.ensureRunning();
  }

  /**
   * Cancel any running snap-back animation.
   * Freezes elastic springs at current position (no visual jump).
   * Called by _startPan, _commitPan, and GSM _cancelCurrent.
   */
  _cancelSnapBack() {
    if (this._isSnappingBack && this._springLoop) {
      this._springLoop.elasticX.setTarget(this._springLoop.elasticX.position);
      this._springLoop.elasticX.velocity = 0;
      this._springLoop.elasticY.setTarget(this._springLoop.elasticY.position);
      this._springLoop.elasticY.velocity = 0;
      this._isSnappingBack = false;
      this._elasticSnapSignX = 0;
      this._elasticSnapSignY = 0;
    }
  }

  /** Reset elastic state for a new gesture (drag or promoted pending-pan). */
  _resetElasticState() {
    this._gestureActive = true;
    this._cumulativeOverflowX = 0;
    this._cumulativeOverflowY = 0;
    this.elasticOffsetX = 0;
    this.elasticOffsetY = 0;
  }

  /**
   * Start inertial coast after mouse drag release.
   * Uses panBy() so overflow naturally feeds elastic offset.
   * @param {{ x: number, y: number }} velocity Screen px/s
   */
  _startInertialCoast(velocity) {
    // Coast velocity cap (overshoot defense).
    const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
    if (speed > MAX_COAST_SPEED) {
      const scale = MAX_COAST_SPEED / speed;
      velocity = { x: velocity.x * scale, y: velocity.y * scale };
    }

    this._gestureActive = true;
    this._isCoasting = true;
    // Store screen-space velocity for friction-based decay in the spring loop tick.
    this._coastVx = velocity.x;
    this._coastVy = velocity.y;
    if (this._el) this._el.classList.add('coasting');

    // Sync all springs to current camera state before starting the loop.
    // Without this, stale spring targets (from initial syncFromCamera or
    // a prior animation) would fight the camera during coast.
    const loop = this._springLoop;
    loop.syncPanZoomFromCamera();
    // Elastic springs: set target = current position so they're settled.
    // During coast, _feedElasticOverflow manages elastic offset directly.
    loop.syncElasticFromCamera();
    loop.ensureRunning();
  }

  _cancelInertialCoast() {
    if (this._isCoasting) {
      this._isCoasting = false;
      this._coastVx = 0;
      this._coastVy = 0;
      this._gestureActive = false;
      if (this._el) this._el.classList.remove('coasting');
    }
  }

  // --- Zoom operations ---

  /**
   * Smooth animated zoom via the spring loop.
   * Replaces SmoothZoomAnimator: accumulates target in log-space,
   * preserves anchor point, springs toward final zoom level.
   *
   * @param {number} dz Zoom delta (same convention as onWheelZoom:
   *   negative = zoom in, positive = zoom out).
   * @param {number} screenX Screen X of the zoom anchor point.
   * @param {number} screenY Screen Y of the zoom anchor point.
   */
  _smoothZoomTo(dz, screenX, screenY) {
    // Convert notch delta to log-space delta
    const direction = dz < 0 ? 1 : -1;
    const logDelta = Math.log(ZOOM_PER_NOTCH) * Math.abs(dz) * direction;

    // Store anchor for per-frame position adjustment in the spring loop tick.
    // Uses logicalScreenToWorld to avoid elastic offset contamination.
    const anchor = this.logicalScreenToWorld(screenX, screenY);
    this._zoomAnchor = { wx: anchor.x, wy: anchor.y, sx: screenX, sy: screenY };

    const loop = this._springLoop;

    // If starting fresh, sync position from camera
    if (loop.logZoom.settled) {
      const currentLogZoom = Math.log(this.zoom);
      loop.logZoom.position = currentLogZoom;
      loop.logZoom.target = currentLogZoom;
      loop.logZoom.velocity = 0;
    }

    // Accumulate target in log space (rapid scrolling stacks)
    const newLogTarget = loop.logZoom.target + logDelta;
    const minLogZoom = Math.log(this._getMinZoom());
    const maxLogZoom = Math.log(MAX_ZOOM);
    loop.logZoom.setTarget(Math.max(minLogZoom, Math.min(maxLogZoom, newLogTarget)));

    // Sync pan springs so stale targets don't fight the anchor adjustment
    loop.panX.position = this.x;
    loop.panX.target = this.x;
    loop.panX.velocity = 0;
    loop.panY.position = this.y;
    loop.panY.target = this.y;
    loop.panY.velocity = 0;
    // Sync elastic springs if not actively managed by snap-back or coast
    if (!this._isSnappingBack && !this._isCoasting) {
      loop.syncElasticFromCamera();
    }

    loop.ensureRunning();
  }

  /**
   * Zoom centered on a screen-space point.
   * @param {number} sx Screen X (CSS px from canvas left)
   * @param {number} sy Screen Y (CSS px from canvas top)
   * @param {number} delta Zoom delta in log2 space. Positive = zoom in.
   */
  zoomAt(sx, sy, delta) {
    const worldBefore = this.logicalScreenToWorld(sx, sy);
    const effectiveMinZoom = this._getMinZoom();
    this.zoom = Math.max(effectiveMinZoom, Math.min(MAX_ZOOM,
      this.zoom * Math.pow(2, delta)));
    const worldAfter = this.logicalScreenToWorld(sx, sy);
    this.x += worldBefore.x - worldAfter.x;
    this.y += worldBefore.y - worldAfter.y;
    this._applyConstraints();

    // Recalculate elastic offset with new zoom-derived bounds
    if (this.elasticOffsetX !== 0 || this.elasticOffsetY !== 0) {
      this._feedElasticOverflow(this._cumulativeOverflowX, this._cumulativeOverflowY);
      EventBus.emit('camera:changed');
    }
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
    const rawX = this.x - dx / this.zoom;
    const rawY = this.y - dy / this.zoom;

    // Store unclamped position, let _applyConstraints() hard-clamp
    this.x = rawX;
    this.y = rawY;
    this._applyConstraints();

    // Compute overflow: difference between desired and clamped position
    const overflowX = rawX - this.x;
    const overflowY = rawY - this.y;

    if (this._gestureActive) {
      // Input delta in world-space (matches overflow sign convention)
      const inputDeltaX = -dx / this.zoom;
      const inputDeltaY = -dy / this.zoom;

      this._cumulativeOverflowX = this._updateCumulativeOverflow(
        overflowX, inputDeltaX, this._cumulativeOverflowX
      );
      this._cumulativeOverflowY = this._updateCumulativeOverflow(
        overflowY, inputDeltaY, this._cumulativeOverflowY
      );

      this._feedElasticOverflow(this._cumulativeOverflowX, this._cumulativeOverflowY);
      EventBus.emit('camera:changed');
    }
  }

  /**
   * Set camera position directly (world coordinates).
   * Used for cross-window sync and saved presets.
   */
  setPosition(x, y, zoom) {
    this.x = x;
    this.y = y;
    if (zoom !== undefined) this.zoom = zoom;
    this._applyConstraints();
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
    this._wheelClassifier = new WheelDeviceClassifier();
    this._trackpadDetector = new TrackpadGestureDetector({
      onGestureStart: () => {
        // Ignore late macOS trackpad momentum events during snap-back,
        // inertial coast, or momentum pan suppression (elastic saturation).
        if (this._isSnappingBack || this._isCoasting || this._momentumPanSuppressed) return;
        this._cancelInertialCoast();
        this._cancelSnapBack();
        if (this._gestures) this._gestures.request('SCROLL_PAN');
        this._gestureActive = true;
        this._momentumScrollActive = false;
        this._cumulativeOverflowX = 0;
        this._cumulativeOverflowY = 0;
      },
      onMomentumStart: () => {
        this._momentumScrollActive = true;
      },
      onGestureEnd: () => {
        this._gestureActive = false;
        this._momentumScrollActive = false;
        this._momentumPanSuppressed = false;
        if (this._gestures) {
          this._gestures.release('SCROLL_PAN');
          this._gestures.request('SNAP_BACK');
        }
        this._snapBackElastic();
      }
    });

    el.addEventListener('wheel', (e) => {
      const { dx, dy, dz } = normalizeWheel(e);

      // Cooperative mode: let unmodified scroll pass through to the page
      if (this._cooperativeGestures && dz === 0 && !e.ctrlKey && !e.metaKey) {
        this._showCooperativeOverlay();
        return;
      }

      e.preventDefault();

      if (dz !== 0) {
        // Ctrl/meta + wheel → zoom path (pinch synthesis on trackpads)
        const device = this._wheelClassifier.classify(e);
        const screen = this.eventToScreen(e);

        if (device === 'mouse') {
          const granted = this._gestures.request('ZOOM_ANIMATE');
          if (granted) this._smoothZoomTo(dz, screen.x, screen.y);
        } else {
          const granted = this._gestures.request('PINCH_ZOOM');
          if (granted) this.zoomAt(screen.x, screen.y, dz * -ZOOM_SENSITIVITY);
        }
      } else if (dx !== 0 || dy !== 0) {
        // Non-ctrl wheel: preference > classifier > default
        let behavior;
        if (this._scrollWheelBehavior === 'auto') {
          const device = this._wheelClassifier.classify(e);
          behavior = device === 'mouse' ? 'zoom' : 'pan';
        } else {
          behavior = this._scrollWheelBehavior;
        }

        if (behavior === 'zoom') {
          const screen = this.eventToScreen(e);
          const granted = this._gestures.request('ZOOM_ANIMATE');
          if (granted) this._smoothZoomTo(dy / 100, screen.x, screen.y);
        } else {
          // Pan with gesture detection — feed detector for state tracking
          this._trackpadDetector.handleWheel(e);

          // After momentum boundary detection, suppress panBy but keep
          // feeding the detector for natural timeout tracking. This
          // prevents phantom gesture restarts that cancel() would cause.
          if (this._momentumPanSuppressed) return;

          this.panBy(-dx, -dy);

          // Early momentum termination: once momentum is detected AND
          // we're at an elastic boundary, suppress further pan events and
          // start snap-back immediately. The user's fingers are already
          // off the trackpad — macOS sends 60+ inertial events over ~1-2s
          // that keep pushing past the boundary with no user control.
          if (this._momentumScrollActive &&
              (this.elasticOffsetX !== 0 || this.elasticOffsetY !== 0)) {
            this._momentumPanSuppressed = true;
            this._gestureActive = false;
            this._snapBackElastic();
          }

          // Fallback: detect likely momentum even when detector hasn't
          // formally transitioned (noisy macOS deltas reset decay streak).
          // Small deltas + many events + elastic boundary = momentum.
          if (!this._momentumScrollActive &&
              this._trackpadDetector._eventCount > 6 &&
              Math.abs(dx) + Math.abs(dy) < 3.0 &&
              (this.elasticOffsetX !== 0 || this.elasticOffsetY !== 0)) {
            this._momentumPanSuppressed = true;
            this._gestureActive = false;
            this._snapBackElastic();
          }
        }
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
        this._initPendingPan(e);
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
        if (dist <= DRAG_THRESHOLD) return;
        this._commitPan();
      }

      if (!this._panning) return;

      const dxScreen = e.clientX - this._panStartX;
      const dyScreen = e.clientY - this._panStartY;

      this._panScreenDist = Math.max(
        this._panScreenDist,
        Math.abs(dxScreen) + Math.abs(dyScreen)
      );

      // Preserve start-relative calculation (no floating-point drift)
      const rawX = this._panStartCamX - dxScreen / (this.zoom * this.viewportScale);
      const rawY = this._panStartCamY - dyScreen / (this.zoom * this.viewportScale);

      this.x = rawX;
      this.y = rawY;
      this._applyConstraints(); // Hard-clamps this.x/this.y

      // Feed overflow into elastic offset
      const overflowX = rawX - this.x;
      const overflowY = rawY - this.y;

      if (this._gestureActive) {
        // For mouse drag, overflow is total from start (not accumulated)
        this._cumulativeOverflowX = overflowX;
        this._cumulativeOverflowY = overflowY;
        this._feedElasticOverflow(overflowX, overflowY);
        if (overflowX !== 0 || overflowY !== 0) {
          EventBus.emit('camera:changed');
        }
      }

      this._velocityTracker.addSample(e.clientX, e.clientY, performance.now());
    });

    window.addEventListener('mouseup', (e) => {
      this._pendingPan = false;
      if (!this._panning || e.button !== this._panButton) return;
      this._panning = false;
      this._panButton = -1;
      this._setPanCursor(false);

      // Compute release velocity for inertial coast
      const velocity = this._velocityTracker.getVelocity();
      this._velocityTracker.reset();
      const speed = Math.sqrt(velocity.vx ** 2 + velocity.vy ** 2);

      if (this._gestures) this._gestures.release('DRAG_PAN');

      if (this._momentumEnabled && speed > INERTIA_THRESHOLD) {
        const atBoundary = this.elasticOffsetX !== 0 || this.elasticOffsetY !== 0;
        if (atBoundary) {
          // Already overscrolled — skip coast, snap back immediately with
          // release velocity for natural bounce. Coast friction decay would
          // freeze the view in overscroll for 0.5-1.5s before snap-back starts.
          this._gestureActive = false;
          if (this._gestures) this._gestures.request('SNAP_BACK');
          this._snapBackElastic({ vx: velocity.vx / this.zoom, vy: velocity.vy / this.zoom });
        } else {
          // Inertial coast — _gestureActive stays true
          if (this._gestures) this._gestures.request('INERTIA');
          this._startInertialCoast({ x: velocity.vx, y: velocity.vy });
        }
      } else {
        this._gestureActive = false;
        if (this._gestures) this._gestures.request('SNAP_BACK');
        this._snapBackElastic();
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

  _showCooperativeOverlay() {
    if (!this._el) return;
    if (!this._cooperativeOverlay) {
      const overlay = document.createElement('div');
      overlay.className = 'cooperative-gesture-overlay';
      const isMac = /mac/i.test(navigator.userAgentData?.platform ?? navigator.platform ?? '');
      const key = isMac ? '\u2318' : 'Ctrl';
      overlay.textContent = `Use ${key} + scroll to zoom the map`;
      overlay.style.cssText = `
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.5);
        color: #fff; font: 600 16px/1 system-ui, sans-serif;
        pointer-events: none; opacity: 0;
        transition: opacity 0.2s ease;
        z-index: 9999;
      `;
      if (!this._el.style.position && getComputedStyle(this._el).position === 'static') {
        this._el.style.position = 'relative';
      }
      this._el.appendChild(overlay);
      this._cooperativeOverlay = overlay;
    }

    const overlay = this._cooperativeOverlay;
    overlay.style.opacity = '1';
    clearTimeout(this._cooperativeHideTimer);
    this._cooperativeHideTimer = setTimeout(() => {
      overlay.style.opacity = '0';
    }, 1500);
  }

  _attachSafetyGuards(el) {
    window.addEventListener('blur', () => this._cancelPan());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this._cancelPan();
      } else if (Math.abs(this.elasticOffsetX) > SETTLE_THRESHOLD_PX ||
                 Math.abs(this.elasticOffsetY) > SETTLE_THRESHOLD_PX) {
        // Tab was backgrounded with stranded elastic offset (rAF doesn't fire
        // in hidden tabs). Trigger snap-back on return.
        this._isSnappingBack = false; // Clear so _snapBackElastic can start
        this._snapBackElastic();
      }
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
    this._gestures = new GestureStateMachine(this);
    this._springLoop = new CameraSpringLoop(this);
    this._springLoop.syncFromCamera();

    this._attachWheelHandler(el);
    this._attachMouseHandlers(el);
    this._attachSpaceKey();

    EventBus.on('camera:pan', ({ dx, dy }) => this.panBy(dx, dy));
    EventBus.on('camera:zoom', (direction) => {
      this.zoomToCenter(direction > 0 ? ZOOM_STEP_KEY : -ZOOM_STEP_KEY);
    });
    EventBus.on('camera:set-state', ({ x, y, zoom }) => this.setPosition(x, y, zoom));
    EventBus.on('camera:zoom-past-cover', (enabled) => {
      this._dmCanZoomPastCover = enabled;
      if (!enabled && this.zoom < this._coverZoom) {
        this.zoom = this._coverZoom;
        this._centerMap();
        this._applyConstraints();
      }
    });
    EventBus.on('camera:momentum-toggle', (enabled) => {
      this._momentumEnabled = enabled;
    });
    EventBus.on('camera:scroll-behavior', (behavior) => {
      if (['auto', 'pan', 'zoom'].includes(behavior)) {
        this._scrollWheelBehavior = behavior;
        try { localStorage.setItem('vtt_scroll_behavior', behavior); } catch { /* storage unavailable */ }
      }
    });

    // Cooperative gesture handling — auto-detect iframe
    try {
      if (window.self !== window.top) {
        this._cooperativeGestures = true;
      }
    } catch { this._cooperativeGestures = true; }
    EventBus.on('camera:cooperative-mode', (enabled) => {
      this._cooperativeGestures = !!enabled;
    });

    this._attachSafetyGuards(el);
  }

  // --- Pan state management ---

  _initPendingPan(e) {
    this._pendingPan = true;
    this._panStartX = e.clientX;
    this._panStartY = e.clientY;
    this._panStartCamX = this.x;
    this._panStartCamY = this.y;
    this._panScreenDist = 0;
  }

  _startPan(e, button) {
    this._cancelInertialCoast();
    this._cancelSnapBack();
    this._momentumPanSuppressed = false;
    if (this._trackpadDetector) this._trackpadDetector.cancel();
    if (this._gestures) this._gestures.request('DRAG_PAN');

    this._panning = true;
    this._pendingPan = false;
    this._panButton = button;
    this._panStartX = e.clientX;
    this._panStartY = e.clientY;
    this._panStartCamX = this.x;
    this._panStartCamY = this.y;
    this._panScreenDist = 0;

    this._resetElasticState();

    this._velocityTracker.reset();
    this._setPanCursor(true);
  }

  /**
   * Promote a pending left-click to an active pan drag.
   * Called when mousemove exceeds DRAG_THRESHOLD after _initPendingPan().
   * Does NOT re-capture clientX/Y — _initPendingPan already stored the
   * mousedown origin, so the drag starts from the original click point,
   * not the threshold-crossing point.
   */
  _commitPan() {
    this._panning = true;
    this._pendingPan = false;
    this._panButton = 0;
    if (this._gestures) this._gestures.request('DRAG_PAN');
    this._resetElasticState();
    this._cancelSnapBack();
    if (this._springLoop) this._springLoop.syncElasticFromCamera();
    this._setPanCursor(true);
  }

  _cancelPan() {
    this._panning = false;
    this._pendingPan = false;
    this._panButton = -1;
    // Full elastic cleanup: no inertial coast from blur/mouseleave
    this._gestureActive = false;
    this._cancelInertialCoast();
    this._setPanCursor(false);
    if (this._gestures) this._gestures.request('SNAP_BACK');
    // Zero velocity — blur/mouseleave should NOT trigger inertial coast
    this._snapBackElastic({ vx: 0, vy: 0 });
  }

  _setPanCursor(active) {
    if (!this._el) return;
    this._el.classList.toggle('panning', active);
    this._el.style.cursor = active ? 'grabbing' : '';
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
    this._applyConstraints();
  }
}
