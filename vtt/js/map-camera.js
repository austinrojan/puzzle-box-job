// ============================================
// VTT Map Camera — World-space zoom, pan, coordinate transforms
// ============================================
//
// This camera operates in WORLD SPACE. camera.x and camera.y represent
// the world-coordinate position of the viewport's top-left corner.

import { EventBus } from './state.js';
import { normalizeWheel } from './normalize-wheel.js';
import { TrackpadGestureDetector, WheelDeviceClassifier } from './trackpad-gesture.js';

// --- Constants ---
const MIN_ZOOM = 0.1;              // absolute floor (safety valve)
const MAX_ZOOM = 5.0;              // absolute ceiling
const ZOOM_SENSITIVITY = 0.6;     // wheel zoom: 0.5 = gentle, 1.0 = aggressive
const ZOOM_STEP_KEY = 0.4;        // per-press keyboard/button step in log2 space
const DRAG_THRESHOLD = 3;          // px before click becomes drag
// Prevents false positives when comparing floating-point zoom to cover zoom
const COVER_ZOOM_EPSILON = 0.001;
const MAX_COAST_SPEED = 3000;     // px/s — Leaflet inertiaMaxSpeed reference

// Apple iOS-style rubber-band: asymptotic resistance that grows weaker
// the further you overshoot, preventing the viewport from ever reaching
// infinite displacement. c=0.55 matches the native iOS feel.
function rubberBand(distance, dimension, c = 0.55) {
  if (dimension <= 0) return 0;
  return (distance * dimension * c) / (dimension + c * distance);
}

// Prevent elastic offset from crossing zero during snap-back.
// Returns 0 if val has the opposite sign of displacement.
function clampSign(val, displacement) {
  if (displacement > 0 && val < 0) return 0;
  if (displacement < 0 && val > 0) return 0;
  return val;
}

// --- Spring animation ---
const DEFAULT_SPRING_STIFFNESS = 200;
const SETTLE_THRESHOLD_PX = 0.5;
const SETTLE_THRESHOLD_VEL = 0.5;

// Phase S3: Speculative snap-back EWMA stall detection
const EWMA_ALPHA = 0.3;              // smoothing factor: ~108ms detection latency at 60Hz
const EWMA_INIT = 10;                // anti-FIR: 140ms warm-up from cold start
const STALL_THRESHOLD = 0.5;         // screen px/frame — below perceptual threshold
const MIN_ELASTIC_MAGNITUDE = 1.0;   // screen px — don't snap for sub-pixel offsets

const VELOCITY_SAMPLE_COUNT = 4;

class CameraAnimator {
  constructor(camera, { stiffness = DEFAULT_SPRING_STIFFNESS } = {}) {
    this._camera = camera;
    this._stiffness = stiffness;
    this._omega = Math.sqrt(stiffness);
    this._rafId = null;
    this._startTime = null;
    this._springX = null;
    this._springY = null;
    this._tick = this._tick.bind(this);
  }

  snapBack(current, target, velocity = { vx: 0, vy: 0 }) {
    this.cancel(); // Safe for Phase 5 release-velocity re-triggering
    const dx = current.x - target.x;
    const dy = current.y - target.y;
    if (Math.abs(dx) < SETTLE_THRESHOLD_PX && Math.abs(dy) < SETTLE_THRESHOLD_PX) {
      this._camera.x = target.x;
      this._camera.y = target.y;
      this._camera._applyHardBounds();
      EventBus.emit('camera:changed');
      return;
    }
    this._springX = { displacement: dx, velocity: velocity.vx || 0, target: target.x };
    this._springY = { displacement: dy, velocity: velocity.vy || 0, target: target.y };
    this._startTime = null;
    this._rafId = requestAnimationFrame(this._tick);
  }

  // Critically damped spring: x(t) = (A + B*t) * e^(-ω*t)
  _solveSpring(displacement, velocity, t) {
    const omega = this._omega;
    const A = displacement;
    const B = velocity + omega * displacement;
    const exp = Math.exp(-omega * t);
    return {
      position: (A + B * t) * exp,
      velocity: (B - omega * (A + B * t)) * exp
    };
  }

  _resolveAxis(spring, t) {
    if (!spring) return { value: spring, settled: true };
    const { position, velocity } = this._solveSpring(spring.displacement, spring.velocity, t);
    const active = Math.abs(position) > SETTLE_THRESHOLD_PX
               || Math.abs(velocity) > SETTLE_THRESHOLD_VEL;
    return {
      value: active ? spring.target + position : spring.target,
      settled: !active
    };
  }

  _tick(timestamp) {
    if (!this._startTime) this._startTime = timestamp;
    const t = Math.min((timestamp - this._startTime) / 1000, 2.0);

    const rx = this._resolveAxis(this._springX, t);
    const ry = this._resolveAxis(this._springY, t);
    if (this._springX) this._camera.x = rx.value;
    if (this._springY) this._camera.y = ry.value;
    const settled = rx.settled && ry.settled;

    // Emit camera:changed directly, bypassing _applyConstraints.
    // Safe because a critically damped spring (ζ=1) approaches the
    // target monotonically from one side, never crossing it. With zero
    // initial velocity (Phase 3), displacement strictly decreases.
    // Phase 5 will add release velocity — review this bypass then.
    EventBus.emit('camera:changed');
    if (settled) this.cancel();
    else this._rafId = requestAnimationFrame(this._tick);
  }

  cancel() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    this._startTime = null;
    this._springX = null;
    this._springY = null;
  }
}

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

// ============================================================
// Smooth Zoom Animator (Phase 6)
// ============================================================
//
// Converts discrete mouse wheel zoom into smooth animated transitions.
// Each wheel notch sets a target zoom level, and an exponential lerp
// in log-space chases it. Rapid scrolling accumulates a larger delta,
// creating natural acceleration. Trackpad pinch bypasses this (direct 1:1).

const SMOOTH_ZOOM_LERP = 0.15;       // Per-frame lerp factor
const SMOOTH_ZOOM_EPSILON = 0.001;    // Convergence threshold (log-space)
const ZOOM_PER_NOTCH = 1.15;          // ~15% zoom per mouse wheel notch

class SmoothZoomAnimator {
  constructor(camera) {
    this._camera = camera;
    this._targetZoom = camera.zoom;
    this._animating = false;
    this._anchor = { wx: 0, wy: 0, sx: 0, sy: 0 };
    this._rafId = null;
    this._step = this._step.bind(this);
  }

  onWheelZoom(dz, screenX, screenY) {
    const direction = dz < 0 ? 1 : -1;
    const factor = Math.pow(ZOOM_PER_NOTCH, Math.abs(dz) * direction);
    const minZoom = this._camera._getMinZoom();
    this._targetZoom = Math.max(minZoom, Math.min(MAX_ZOOM, this._targetZoom * factor));

    this._anchor.sx = screenX;
    this._anchor.sy = screenY;
    const worldPt = this._camera.logicalScreenToWorld(screenX, screenY);
    this._anchor.wx = worldPt.x;
    this._anchor.wy = worldPt.y;

    if (!this._animating) {
      this._animating = true;
      this._rafId = requestAnimationFrame(this._step);
    }
  }

  _step() {
    const cam = this._camera;
    const logCurrent = Math.log(cam.zoom);
    const logTarget = Math.log(this._targetZoom);
    const logNew = logCurrent + (logTarget - logCurrent) * SMOOTH_ZOOM_LERP;
    const newZoom = Math.exp(logNew);

    cam.zoom = newZoom;
    cam.x = this._anchor.wx - this._anchor.sx / newZoom;
    cam.y = this._anchor.wy - this._anchor.sy / newZoom;
    cam._applyConstraints();

    if (Math.abs(logNew - logTarget) > SMOOTH_ZOOM_EPSILON) {
      this._rafId = requestAnimationFrame(this._step);
    } else {
      cam.zoom = this._targetZoom;
      cam.x = this._anchor.wx - this._anchor.sx / this._targetZoom;
      cam.y = this._anchor.wy - this._anchor.sy / this._targetZoom;
      cam._applyConstraints();
      this._animating = false;
      this._rafId = null;
    }
  }

  retarget() {
    this._targetZoom = this._camera.zoom;
    if (this._animating) {
      cancelAnimationFrame(this._rafId);
      this._animating = false;
      this._rafId = null;
    }
  }

  cancel() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._animating = false;
    this._targetZoom = this._camera.zoom;
  }
}

// ============================================================
// Gesture State Machine (Phase S4: Hierarchical Coordination)
// ============================================================
//
// Five ordered decision rules with dwell time, cooldown, and
// tier separation to prevent oscillation during gesture transitions.

const GESTURE_PRIORITY = {
  IDLE: 0, SNAP_BACK: 1, INERTIA: 2, ZOOM_ANIMATE: 3,
  SCROLL_PAN: 4, PINCH_ZOOM: 5, DRAG_PAN: 6
};

const USER_GESTURES = new Set(['SCROLL_PAN', 'PINCH_ZOOM', 'DRAG_PAN']);
const ANIMATION_GESTURES = new Set(['SNAP_BACK', 'INERTIA', 'ZOOM_ANIMATE']);
const DWELL_TIME_MS = 80;
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

    // Rule 3: user replaces user — higher priority instant, else dwell + priority
    if (USER_GESTURES.has(gesture) && USER_GESTURES.has(this._activeGesture)) {
      if (newPri > curPri) {
        this._cancelCurrent();
        this._activate(gesture, now);
        return true;
      }
      if (now - this._gestureStartTime < DWELL_TIME_MS) return false;
      if (newPri >= curPri) {
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
        if (this._camera._cancelSpeculativeSnapBack) {
          this._camera._cancelSpeculativeSnapBack();
        }
        if (this._camera._elasticAnimator) {
          this._camera._elasticAnimator.cancel();
        }
        break;
      case 'ZOOM_ANIMATE':
        if (this._camera._smoothZoom) this._camera._smoothZoom.cancel();
        break;
      case 'SCROLL_PAN':
        if (this._camera._trackpadDetector) this._camera._trackpadDetector.cancel();
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
        if (this._camera._smoothZoom) this._camera._smoothZoom.retarget();
        return;
      }
      if (e.key === '-') {
        e.preventDefault();
        this._camera.zoomToCenter(-ZOOM_STEP_KEY);
        if (this._camera._smoothZoom) this._camera._smoothZoom.retarget();
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
    this._animator = null;  // CameraAnimator — created in attachTo()
    this._dmCanZoomPastCover = false;
    this._lastClampedZoom = NaN;
    this._velocityTracker = new VelocityTracker();
    this._momentumEnabled = true;

    // Phase 6: dual-position elastic offset
    this.elasticOffsetX = 0;       // visual displacement beyond hard bounds (world-space)
    this.elasticOffsetY = 0;       // visual displacement beyond hard bounds (world-space)
    this._gestureActive = false;   // true when any gesture feeds elastic offset
    this._momentumScrollActive = false;  // true during trackpad momentum (dampened rubber-band)
    this._cumulativeOverflowX = 0; // accumulated overflow for rubber-band calculation
    this._cumulativeOverflowY = 0;
    this._inertiaRafId = null;     // rAF ID for inertial coast animation

    // Phase S3: Speculative snap-back
    this._elasticEWMA = 0;               // EWMA of elastic offset growth rate
    this._lastElasticScreenMag = 0;      // previous frame's elastic magnitude (screen px)
    this._speculativeSnapId = null;      // rAF ID for monitoring loop (null = not running)
    this._isSnappingBack = false;        // double-fire defense flag
  }

  // --- Coordinate conversion ---

  /** Visual camera position including elastic overscroll offset. */
  get visualX() { return this.x + this.elasticOffsetX; }
  get visualY() { return this.y + this.elasticOffsetY; }

  /** Screen-space magnitude of elastic offset (px). */
  get _elasticScreenMag() {
    return Math.sqrt(
      (this.elasticOffsetX * this.zoom) ** 2 +
      (this.elasticOffsetY * this.zoom) ** 2
    );
  }

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
        console.debug(
          `[Camera] Zoom ${this.zoom.toFixed(4)} clamped to coverZoom ` +
          `${minZoom.toFixed(4)} (viewport ${this.viewportW}\u00D7${this.viewportH}, ` +
          `map ${this.mapW}\u00D7${this.mapH})`
        );
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

  // --- Phase 6: Elastic offset methods ---

  /**
   * Feed overflow (distance past hard bounds) into the elastic offset.
   * The rubber-band formula operates in screen-space pixels for consistent
   * resistance feel, then converts back to world-space for the offset.
   */
  _feedElasticOverflow(overflowX, overflowY) {
    if (!this._gestureActive) return;

    // Phase S3: Cancel any running speculative snap-back — user is still providing input.
    if (this._isSnappingBack) {
      this._cancelSpeculativeSnapBack();
    }

    // Dampen rubber-band during trackpad momentum (c=0.3 vs 0.55)
    const c = this._momentumScrollActive ? 0.3 : 0.55;

    if (overflowX !== 0) {
      const screenOverflow = overflowX * this.zoom;
      const dampened = rubberBand(Math.abs(screenOverflow), this.viewportW, c);
      this.elasticOffsetX = Math.sign(overflowX) * dampened / this.zoom;
    } else {
      this.elasticOffsetX = 0;
    }

    if (overflowY !== 0) {
      const screenOverflow = overflowY * this.zoom;
      const dampened = rubberBand(Math.abs(screenOverflow), this.viewportH, c);
      this.elasticOffsetY = Math.sign(overflowY) * dampened / this.zoom;
    } else {
      this.elasticOffsetY = 0;
    }

    // Phase S3: Start monitoring loop if not already running.
    if (this._speculativeSnapId == null &&
        (this.elasticOffsetX !== 0 || this.elasticOffsetY !== 0)) {
      this._lastElasticScreenMag = this._elasticScreenMag;
      this._elasticEWMA = EWMA_INIT;
      this._speculativeSnapId = requestAnimationFrame(
        () => this._checkSpeculativeSnapBack()
      );
    }
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
    // If snap-back is already running and new call has zero velocity,
    // let the running animation continue undisturbed.
    const hasVelocity = velocity.vx !== 0 || velocity.vy !== 0;
    if (this._isSnappingBack && !hasVelocity) {
      return;
    }

    if (Math.abs(this.elasticOffsetX) < SETTLE_THRESHOLD_PX && Math.abs(this.elasticOffsetY) < SETTLE_THRESHOLD_PX) {
      this.elasticOffsetX = 0;
      this.elasticOffsetY = 0;
      this._isSnappingBack = false;
      EventBus.emit('camera:changed');
      return;
    }

    if (this._elasticAnimator) {
      const omega = this._elasticAnimator._omega;

      // Velocity clamping (primary overshoot defense).
      const clampedVx = this._clampSpringVelocity(
        velocity.vx, this.elasticOffsetX, omega
      );
      const clampedVy = this._clampSpringVelocity(
        velocity.vy, this.elasticOffsetY, omega
      );

      this._isSnappingBack = true;

      this._elasticAnimator.snapBack(
        { x: this.elasticOffsetX, y: this.elasticOffsetY },
        { x: 0, y: 0 },
        { vx: clampedVx, vy: clampedVy }
      );
    }
  }

  /**
   * Phase S3: EWMA stall detection and speculative snap-back launcher.
   * Runs once per rAF when elastic offset is nonzero. Computes the EWMA
   * of elastic offset change rate in screen-space pixels per frame.
   * When EWMA drops below STALL_THRESHOLD, starts zero-velocity snap-back.
   */
  _checkSpeculativeSnapBack() {
    const currentScreenMag = this._elasticScreenMag;
    const delta = Math.abs(currentScreenMag - this._lastElasticScreenMag);
    this._lastElasticScreenMag = currentScreenMag;

    this._elasticEWMA = EWMA_ALPHA * delta + (1 - EWMA_ALPHA) * this._elasticEWMA;

    if (currentScreenMag > MIN_ELASTIC_MAGNITUDE &&
        this._elasticEWMA < STALL_THRESHOLD &&
        !this._isSnappingBack) {
      // Skip _gestures.request('SNAP_BACK') — priority 1 cannot preempt
      // SCROLL_PAN (priority 4). Formal onGestureEnd handles transition.
      this._snapBackElastic();
    }

    // Continue monitoring while screen-space magnitude exceeds threshold.
    // Uses MIN_ELASTIC_MAGNITUDE (screen-space) not SETTLE_THRESHOLD_PX
    // (world-space) to avoid premature loop termination at low zoom.
    if (currentScreenMag > MIN_ELASTIC_MAGNITUDE) {
      this._speculativeSnapId = requestAnimationFrame(
        () => this._checkSpeculativeSnapBack()
      );
    } else {
      this._speculativeSnapId = null;
    }
  }

  /**
   * Cancel speculative snap-back monitoring and any running snap-back
   * animation. Elastic offset retains its current value (no jump).
   */
  _cancelSpeculativeSnapBack() {
    if (this._speculativeSnapId != null) {
      cancelAnimationFrame(this._speculativeSnapId);
      this._speculativeSnapId = null;
    }

    if (this._isSnappingBack && this._elasticAnimator) {
      this._elasticAnimator.cancel();
      this._isSnappingBack = false;
    }
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
    let vx = velocity.x;
    let vy = velocity.y;
    let lastTime = performance.now();

    const FRICTION = 0.96;
    const STOP_THRESHOLD = 10;
    const MAX_DT = 64;

    if (this._el) this._el.classList.add('coasting');

    const tick = (timestamp) => {
      const rawDt = timestamp - lastTime;
      const dt = Math.min(rawDt, MAX_DT) / 1000;
      lastTime = timestamp;

      const frictionFactor = Math.pow(FRICTION, rawDt / 16.67);
      vx *= frictionFactor;
      vy *= frictionFactor;

      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed < STOP_THRESHOLD) {
        this._gestureActive = false;
        this._inertiaRafId = null;
        if (this._el) this._el.classList.remove('coasting');
        if (this._gestures) {
          this._gestures.release('INERTIA');
          this._gestures.request('SNAP_BACK');
        }
        this._snapBackElastic({
          vx: vx / this.zoom,
          vy: vy / this.zoom
        });
        return;
      }

      // panBy expects screen-space deltas; velocity is screen px/s
      this.panBy(-vx * dt, -vy * dt);
      this._inertiaRafId = requestAnimationFrame(tick);
    };

    this._inertiaRafId = requestAnimationFrame(tick);
  }

  _cancelInertialCoast() {
    if (this._inertiaRafId) {
      cancelAnimationFrame(this._inertiaRafId);
      this._inertiaRafId = null;
      this._gestureActive = false;
      if (this._el) this._el.classList.remove('coasting');
    }
  }

  // --- Zoom operations ---

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
      if (overflowX !== 0) {
        if (Math.sign(overflowX) === Math.sign(this._cumulativeOverflowX) || this._cumulativeOverflowX === 0) {
          this._cumulativeOverflowX += overflowX;
        } else {
          this._cumulativeOverflowX = overflowX;
        }
      } else {
        this._cumulativeOverflowX *= 0.8;
        if (Math.abs(this._cumulativeOverflowX) < 0.1) this._cumulativeOverflowX = 0;
      }

      if (overflowY !== 0) {
        if (Math.sign(overflowY) === Math.sign(this._cumulativeOverflowY) || this._cumulativeOverflowY === 0) {
          this._cumulativeOverflowY += overflowY;
        } else {
          this._cumulativeOverflowY = overflowY;
        }
      } else {
        this._cumulativeOverflowY *= 0.8;
        if (Math.abs(this._cumulativeOverflowY) < 0.1) this._cumulativeOverflowY = 0;
      }

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
        this._cancelInertialCoast();
        this._cancelSpeculativeSnapBack();
        if (this._elasticAnimator) this._elasticAnimator.cancel();
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
        if (this._gestures) {
          this._gestures.release('SCROLL_PAN');
          this._gestures.request('SNAP_BACK');
        }
        this._snapBackElastic();
      }
    });

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { dx, dy, dz } = normalizeWheel(e);

      if (dz !== 0) {
        // Ctrl/meta + wheel → zoom path (pinch synthesis on trackpads)
        const device = this._wheelClassifier.classify(e);
        const screen = this.eventToScreen(e);

        if (device === 'mouse') {
          // Smooth animated zoom for ctrl+mouse-wheel
          if (this._gestures) this._gestures.request('ZOOM_ANIMATE');
          this._smoothZoom.onWheelZoom(dz, screen.x, screen.y);
        } else {
          // Trackpad pinch: direct 1:1 zoom (existing behavior)
          if (this._gestures) this._gestures.request('PINCH_ZOOM');
          this.zoomAt(screen.x, screen.y, dz * -ZOOM_SENSITIVITY);
        }
      } else if (dx !== 0 || dy !== 0) {
        // Non-ctrl wheel: classify device to decide zoom vs pan
        const device = this._wheelClassifier.classify(e);

        if (device === 'mouse') {
          // Mouse scroll wheel → smooth animated zoom (scroll up = zoom in)
          const screen = this.eventToScreen(e);
          if (this._gestures) this._gestures.request('ZOOM_ANIMATE');
          this._smoothZoom.onWheelZoom(dy / 100, screen.x, screen.y);
        } else {
          // Trackpad two-finger scroll → pan with gesture detection
          this._trackpadDetector.handleWheel(e);
          this.panBy(-dx, -dy);
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

      // Phase 6: compute release velocity for inertial coast
      const velocity = this._velocityTracker.getVelocity();
      this._velocityTracker.reset();
      const speed = Math.sqrt(velocity.vx ** 2 + velocity.vy ** 2);
      const INERTIA_THRESHOLD = 100; // px/s

      if (this._gestures) this._gestures.release('DRAG_PAN');

      if (this._momentumEnabled && speed > INERTIA_THRESHOLD) {
        // Inertial coast — _gestureActive stays true
        if (this._gestures) this._gestures.request('INERTIA');
        this._startInertialCoast({ x: velocity.vx, y: velocity.vy });
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
    this._animator = new CameraAnimator(this, { stiffness: 200 });

    // Phase 6: elastic offset animator (stiffness=400 for snappier feel).
    // Its _tick updates elasticOffsetX/Y instead of camera.x/y.
    this._elasticAnimator = new CameraAnimator(this, { stiffness: 400 });
    this._elasticAnimator._tick = ((cam) => {
      const anim = cam._elasticAnimator;
      return (timestamp) => {
        if (!anim._startTime) anim._startTime = timestamp;
        const elapsed = Math.min((timestamp - anim._startTime) / 1000, 2.0);
        const rx = anim._resolveAxis(anim._springX, elapsed);
        const ry = anim._resolveAxis(anim._springY, elapsed);

        // Position safety net (secondary overshoot defense).
        // Elastic offset must not change sign during snap-back.
        // Catches floating-point edge cases where velocity clamp produces
        // a B coefficient that is very slightly negative due to rounding.
        let valX = rx.value;
        let valY = ry.value;
        if (anim._springX) valX = clampSign(valX, anim._springX.displacement);
        if (anim._springY) valY = clampSign(valY, anim._springY.displacement);
        cam.elasticOffsetX = valX;
        cam.elasticOffsetY = valY;
        EventBus.emit('camera:changed');
        if (rx.settled && ry.settled) {
          cam.elasticOffsetX = 0;
          cam.elasticOffsetY = 0;
          cam._cumulativeOverflowX = 0;
          cam._cumulativeOverflowY = 0;
          cam._isSnappingBack = false;
          EventBus.emit('camera:changed');
          anim.cancel();
          if (cam._gestures) cam._gestures.release('SNAP_BACK');
        } else {
          anim._rafId = requestAnimationFrame(anim._tick);
        }
      };
    })(this);

    this._smoothZoom = new SmoothZoomAnimator(this);
    this._gestures = new GestureStateMachine(this);

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
    this._cancelSpeculativeSnapBack();
    if (this._elasticAnimator) this._elasticAnimator.cancel();
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

    // Phase 6: dual-position elastic model
    this._gestureActive = true;
    this._cumulativeOverflowX = 0;
    this._cumulativeOverflowY = 0;
    this.elasticOffsetX = 0;
    this.elasticOffsetY = 0;

    if (this._animator) this._animator.cancel();
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
    this._gestureActive = true;
    this._cumulativeOverflowX = 0;
    this._cumulativeOverflowY = 0;
    this.elasticOffsetX = 0;
    this.elasticOffsetY = 0;
    if (this._animator) this._animator.cancel();
    if (this._elasticAnimator) this._elasticAnimator.cancel();
    this._cancelSpeculativeSnapBack();
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
