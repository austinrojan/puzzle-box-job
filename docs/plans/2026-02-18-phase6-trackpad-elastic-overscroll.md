# Phase 6: Trackpad Elastic Overscroll & Advanced Input Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend elastic overscroll to trackpad scroll panning, add smooth animated zoom for discrete mouse wheel, build a unified gesture state machine, and refactor mouse drag to a clean dual-position camera model — replacing the Phase 3 `_isDragging` toggle with a universal elastic offset architecture.

**Context:** Phase 5.5 delivered momentum panning and velocity tracking for mouse drag. Phase 6 builds on that foundation with six targeted upgrades: (1) dual-position camera model separating logical state from elastic visual offset, (2) TrackpadGestureDetector reconstructing gesture lifecycle from raw wheel events, (3) elastic overscroll for trackpad scroll, (4) inertial coast refactored to use the dual-position model, (5) smooth animated zoom for discrete mouse wheel, (6) unified GestureStateMachine coordinating all input sources. The research doc and implementation guide are at `planning-docs/VTT-ViewPort-Plan/additional-research-docs/Phase-6_Research_*.md` and `planning-docs/VTT-ViewPort-Plan/6-phase-implementation-planning-docs/Phase_6_*.md`.

**Architecture:** The centerpiece is the dual-position camera model: `camera.x/y` (logical, always hard-clamped, always synced via BroadcastChannel) separated from `camera.elasticOffsetX/Y` (visual-only displacement during active gestures). The renderer uses `camera.visualX/Y` getters. The existing `_isDragging` flag and `_applyElasticBounds()` path are replaced by a universal `_gestureActive` flag and `_feedElasticOverflow()` method that works identically for mouse drag, trackpad scroll, and inertial coast. A `TrackpadGestureDetector` (IDLE→ACTIVE→MOMENTUM→IDLE state machine driven by delta decay + timeout) reconstructs the gesture lifecycle that browsers don't expose. A `SmoothZoomAnimator` converts jarring discrete mouse wheel zoom into smooth log-space interpolated transitions. A `GestureStateMachine` with priority-based preemption prevents input conflicts.

**Tech Stack:** Vanilla JS ES modules, Playwright tests, BroadcastChannel cross-window sync, no build step.

---

## Critical Files

| File | What changes |
|------|-------------|
| `vtt/js/trackpad-gesture.js` | **NEW** — TrackpadGestureDetector class + classifyWheelDevice utility |
| `vtt/js/map-camera.js` | Major refactor: dual-position model, SmoothZoomAnimator, GestureStateMachine, refactored panBy/zoomAt/_applyConstraints, inertial coast, elastic offset methods, remove _isDragging/_applyElasticBounds |
| `vtt/js/map-renderer.js` | No changes — renderer calls `camera.applyTransform(ctx)` which is the single change point |
| `vtt/js/camera-sync.js` | No protocol changes — `localToShared()` reads `camera.x/y` (logical, always valid) |
| `vtt/css/map.css` | Add `.coasting` cursor class |
| `tests/phase6-unit.spec.js` | **NEW** — TrackpadGestureDetector, classifyWheelDevice, SmoothZoomAnimator, elastic model tests |
| `tests/phase6-integration.spec.js` | **NEW** — trackpad elastic overscroll, mouse drag elastic, smooth zoom, gesture preemption |
| `tests/camera-clamping.spec.js` | Update: _isDragging → _gestureActive, _elasticClampAxis → removed, snap-back tests |
| `tests/input-handling.spec.js` | Update: _isDragging assertion → _gestureActive |
| `tests/phase5.5-unit.spec.js` | Update: _isDragging → _gestureActive (1 line) |

## Existing Patterns to Reuse

- **`CameraAnimator.snapBack(current, target, velocity)`** at `map-camera.js:55-70` — reuse for elastic snap-back (new `_elasticAnimator` instance)
- **`rubberBand(distance, dimension, c)`** at `map-camera.js:23-25` — Apple's c=0.55 formula, used by `_feedElasticOverflow()`
- **`normalizeWheel(e)`** at `normalize-wheel.js` — returns `{dx, dy, dz}`, untouched by Phase 6
- **`camera.applyTransform(ctx)`** at `map-camera.js:507-514` — single place to switch from `x/y` to `visualX/Y`
- **`VelocityTracker`** at `map-camera.js:179-216` — Phase 5.5 ring buffer, reused for drag velocity
- **`page.evaluate(async () => { const { X } = await import(...); })` pattern** for Playwright "unit" tests
- **`gotoVTT(page)` + `enterMapMode(page)` + `injectTestAccessors(page)`** from `tests/helpers.js`

## Phase 5.5 Code Replaced by Phase 6

Phase 6's dual-position model and inertial coast supersede several Phase 5.5 constructs:

| Phase 5.5 Code | Replaced By | Notes |
|---|---|---|
| `CameraAnimator.momentum()` (line 124-133) | `Camera._startInertialCoast()` | New inertial coast uses `panBy()` → elastic overflow instead of direct camera mutation |
| `CameraAnimator._tickMomentum()` (line 135-169) | `Camera._startInertialCoast()` tick | New tick uses `panBy()` for elastic boundary interaction |
| `CameraAnimator._stopMomentum()` (line 171-176) | `Camera._cancelInertialCoast()` | — |
| `Camera._handleDragRelease()` (line 700-714) | `Camera._endPan()` with inertia check | Velocity check + inertia start moves to `_endPan()` |
| `Camera._triggerSnapBack()` (line 689-698) | `Camera._snapBackElastic()` | Elastic offset spring, not camera position spring |
| `Camera._triggerSnapBackWithVelocity()` (line 725-742) | `Camera._snapBackElastic(velocity)` | Same pattern, operates on elastic offset |
| `Camera._isPastBounds()` (line 716-723) | No longer needed | panBy overflow detection replaces explicit bounds check |
| `Camera._isDragging` (line 444, set at 986/1005/892/1014) | `Camera._gestureActive` | Universal flag for any elastic-producing gesture |
| `Camera._applyElasticBounds()` (line 633-639) | `Camera._feedElasticOverflow()` | — |
| `Camera._elasticClampAxis()` (line 641-661) | `rubberBand()` inside `_feedElasticOverflow()` | — |

---

## Task 1: Create TrackpadGestureDetector module

**Files:** Create `vtt/js/trackpad-gesture.js`

This is a new standalone file with zero dependencies on the rest of the codebase.

**Step 1:** Create `vtt/js/trackpad-gesture.js` with the full `TrackpadGestureDetector` class and `classifyWheelDevice()` function. The complete implementation is in the Phase 6 guide, Section 3 (lines 409-602 of the planning doc). The file contains:

```javascript
// vtt/js/trackpad-gesture.js
//
// Reconstructs IDLE → ACTIVE → MOMENTUM → IDLE gesture lifecycle
// from raw WheelEvent streams. Uses delta decay detection + timeout.

const DECAY_STREAK_THRESHOLD = 3;
const MIN_EVENTS_FOR_MOMENTUM = 6;
const DECAY_RATIO = 0.97;
const TIMEOUT_ACTIVE_MS = 150;
const TIMEOUT_MOMENTUM_MS = 100;
const MOMENTUM_CANCEL_SPIKE = 1.5;
const MOMENTUM_CANCEL_GAP_MS = 120;

export class TrackpadGestureDetector {
  constructor(callbacks = {}) {
    this._callbacks = callbacks;
    this.state = 'IDLE';  // 'IDLE' | 'ACTIVE' | 'MOMENTUM'
    this._endTimer = null;
    this._lastAbsDelta = 0;
    this._decayStreak = 0;
    this._eventCount = 0;
    this._lastEventTime = 0;
  }

  handleWheel(e) {
    const now = performance.now();
    const absDelta = Math.abs(e.deltaY) + Math.abs(e.deltaX);
    const timeSinceLast = now - this._lastEventTime;
    clearTimeout(this._endTimer);

    if (this.state === 'IDLE') {
      this.state = 'ACTIVE';
      this._decayStreak = 0;
      this._eventCount = 0;
      this._callbacks.onGestureStart?.(e);
    } else if (this.state === 'MOMENTUM') {
      const isSpikeUp = absDelta > this._lastAbsDelta * MOMENTUM_CANCEL_SPIKE;
      const isLargeGap = timeSinceLast > MOMENTUM_CANCEL_GAP_MS;
      if (isSpikeUp || isLargeGap) {
        this.state = 'ACTIVE';
        this._decayStreak = 0;
        this._eventCount = 0;
        this._callbacks.onGestureStart?.(e);
      }
    }

    if (this.state === 'ACTIVE') {
      this._eventCount++;
      if (absDelta > 0 && this._lastAbsDelta > 0 && absDelta < this._lastAbsDelta * DECAY_RATIO) {
        this._decayStreak++;
      } else {
        this._decayStreak = 0;
      }
      if (this._decayStreak >= DECAY_STREAK_THRESHOLD && this._eventCount > MIN_EVENTS_FOR_MOMENTUM) {
        this.state = 'MOMENTUM';
        this._callbacks.onMomentumStart?.();
      }
    }

    this._callbacks.onGestureMove?.(e, this.state);
    this._lastAbsDelta = absDelta;
    this._lastEventTime = now;

    const timeout = this.state === 'MOMENTUM' ? TIMEOUT_MOMENTUM_MS : TIMEOUT_ACTIVE_MS;
    this._endTimer = setTimeout(() => {
      this.state = 'IDLE';
      this._decayStreak = 0;
      this._eventCount = 0;
      this._lastAbsDelta = 0;
      this._callbacks.onGestureEnd?.();
    }, timeout);
  }

  cancel() {
    clearTimeout(this._endTimer);
    if (this.state !== 'IDLE') {
      this.state = 'IDLE';
      this._decayStreak = 0;
      this._eventCount = 0;
      this._lastAbsDelta = 0;
      this._callbacks.onGestureEnd?.();
    }
  }

  get isGestureActive() {
    return this.state === 'ACTIVE' || this.state === 'MOMENTUM';
  }

  destroy() {
    clearTimeout(this._endTimer);
  }
}

/**
 * Heuristic to classify a wheel event as mouse or trackpad.
 * Mouse wheels produce large integer deltas (≥50, integer, no horizontal).
 * Trackpad produces small/fractional deltas at high frequency.
 */
export function classifyWheelDevice(e) {
  const absY = Math.abs(e.deltaY);
  const absX = Math.abs(e.deltaX);
  const maxDelta = Math.max(absY, absX);
  if (maxDelta >= 50 && maxDelta % 1 === 0 && e.deltaX === 0) {
    return 'mouse';
  }
  return 'trackpad';
}
```

**Verify:** `node --check vtt/js/trackpad-gesture.js` (syntax only — ES module, no Node runtime deps)

**Commit:** `feat(phase6): add TrackpadGestureDetector and classifyWheelDevice utility`

---

## Task 2: Add SmoothZoomAnimator and GestureStateMachine classes

**File:** `vtt/js/map-camera.js`

These are self-contained classes added to the file without changing any existing behavior.

**Step 1:** Add `SmoothZoomAnimator` class after the `VelocityTracker` class (after line 216, before `class BoundsCache`). This class converts discrete mouse wheel zoom into smooth animated transitions via exponential interpolation in log-space:

```javascript
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
    const worldPt = this._camera.screenToWorld(screenX, screenY);
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
```

**Step 2:** Add `GestureStateMachine` class after `SmoothZoomAnimator` (before `class BoundsCache`). Priority-based gesture coordination:

```javascript
// ============================================================
// Gesture State Machine (Phase 6)
// ============================================================
//
// Coordinates concurrent input gestures to prevent conflicts.
// Higher-priority gestures cancel lower-priority ones.
// Same-priority gestures retarget rather than conflict.

const GESTURE_PRIORITY = {
  IDLE: 0,
  SNAP_BACK: 1,
  INERTIA: 2,
  ZOOM_ANIMATE: 3,
  SCROLL_PAN: 4,
  PINCH_ZOOM: 5,
  DRAG_PAN: 6
};

class GestureStateMachine {
  constructor(camera) {
    this._camera = camera;
    this._activeGesture = 'IDLE';
  }

  request(gesture) {
    const newPriority = GESTURE_PRIORITY[gesture];
    const currentPriority = GESTURE_PRIORITY[this._activeGesture];
    if (newPriority >= currentPriority) {
      this._cancelCurrent();
      this._activeGesture = gesture;
      return true;
    }
    return false;
  }

  release(gesture) {
    if (this._activeGesture === gesture) {
      this._activeGesture = 'IDLE';
    }
  }

  _cancelCurrent() {
    switch (this._activeGesture) {
      case 'INERTIA':
        this._camera._cancelInertialCoast();
        break;
      case 'SNAP_BACK':
        if (this._camera._elasticAnimator) this._camera._elasticAnimator.cancel();
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
```

**Verify:** `npx playwright test tests/camera-math.spec.js tests/camera-clamping.spec.js --project=desktop-1920 --reporter=line` (no regressions — classes are added but not wired in yet)

**Commit:** `feat(phase6): add SmoothZoomAnimator and GestureStateMachine classes`

---

## Task 3: Dual-position camera model — properties and elastic offset methods

**File:** `vtt/js/map-camera.js`

Add the dual-position model properties and methods to the Camera class without changing any existing behavior yet.

**Step 1:** Add Phase 6 properties to Camera constructor (after `this._momentumEnabled = true;` at line 448):

```javascript
    // Phase 6: dual-position elastic offset
    this.elasticOffsetX = 0;       // visual displacement beyond hard bounds (world-space)
    this.elasticOffsetY = 0;       // visual displacement beyond hard bounds (world-space)
    this._gestureActive = false;   // true when any gesture feeds elastic offset
    this._momentumScrollActive = false;  // true during trackpad momentum (dampened rubber-band)
    this._cumulativeOverflowX = 0; // accumulated overflow for rubber-band calculation
    this._cumulativeOverflowY = 0;
    this._inertiaRafId = null;     // rAF ID for inertial coast animation
```

**Step 2:** Add `visualX` and `visualY` getters (after `screenToWorld` at line 462, before `worldToScreen`):

```javascript
  /** Visual camera position including elastic overscroll offset. */
  get visualX() { return this.x + this.elasticOffsetX; }
  get visualY() { return this.y + this.elasticOffsetY; }
```

**Step 3:** Add `_feedElasticOverflow()` method (after `_triggerSnapBackWithVelocity()` at line 742, before `zoomAt()`):

```javascript
  /**
   * Feed overflow (distance past hard bounds) into the elastic offset.
   * The rubber-band formula operates in screen-space pixels for consistent
   * resistance feel, then converts back to world-space for the offset.
   */
  _feedElasticOverflow(overflowX, overflowY) {
    if (!this._gestureActive) return;

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
  }
```

**Step 4:** Add `_snapBackElastic()` method (after `_feedElasticOverflow()`):

```javascript
  /**
   * Trigger spring snap-back from current elastic offset to zero.
   * Uses the momentum-tuned spring (stiffness 400, ω≈20) for snappier feel.
   * @param {{ vx: number, vy: number }} velocity Initial velocity (world-space px/s)
   */
  _snapBackElastic(velocity = { vx: 0, vy: 0 }) {
    this._cumulativeOverflowX = 0;
    this._cumulativeOverflowY = 0;

    if (Math.abs(this.elasticOffsetX) < 0.5 && Math.abs(this.elasticOffsetY) < 0.5) {
      this.elasticOffsetX = 0;
      this.elasticOffsetY = 0;
      EventBus.emit('camera:changed');
      return;
    }

    if (this._elasticAnimator) {
      this._elasticAnimator.snapBack(
        { x: this.elasticOffsetX, y: this.elasticOffsetY },
        { x: 0, y: 0 },
        velocity
      );
    }
  }
```

**Step 5:** Add `_startInertialCoast()` and `_cancelInertialCoast()` methods (after `_snapBackElastic()`):

```javascript
  /**
   * Start inertial coast after mouse drag release.
   * Uses panBy() so overflow naturally feeds elastic offset.
   * @param {{ x: number, y: number }} velocity Screen px/s
   */
  _startInertialCoast(velocity) {
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
        if (this._gestures) this._gestures.release('INERTIA');
        this._snapBackElastic({
          vx: vx / this.zoom,
          vy: vy / this.zoom
        });
        return;
      }

      // panBy expects screen-space deltas; velocity is "natural" direction
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
```

**Step 6:** Create `_elasticAnimator` in `attachTo()`. After `this._animator = new CameraAnimator(this);` (line 941), add:

```javascript
    // Phase 6: second animator for elastic offset snap-back.
    // Its _tick updates elasticOffsetX/Y instead of camera.x/y.
    this._elasticAnimator = new CameraAnimator(this);
    // Override _tick to animate elastic offset, not camera position
    this._elasticAnimator._tick = ((originalTick) => {
      return (timestamp) => {
        if (!this._elasticAnimator._startTime) this._elasticAnimator._startTime = timestamp;
        const elapsed = Math.min((timestamp - this._elasticAnimator._startTime) / 1000, 2.0);
        const rx = this._elasticAnimator._resolveAxis(this._elasticAnimator._springX, elapsed);
        const ry = this._elasticAnimator._resolveAxis(this._elasticAnimator._springY, elapsed);
        this.elasticOffsetX = rx.value;
        this.elasticOffsetY = ry.value;
        EventBus.emit('camera:changed');
        if (rx.settled && ry.settled) {
          this.elasticOffsetX = 0;
          this.elasticOffsetY = 0;
          this._cumulativeOverflowX = 0;
          this._cumulativeOverflowY = 0;
          EventBus.emit('camera:changed');
          this._elasticAnimator.cancel();
          if (this._gestures) this._gestures.release('SNAP_BACK');
        } else {
          this._elasticAnimator._rafId = requestAnimationFrame(this._elasticAnimator._tick);
        }
      };
    })(this._elasticAnimator._tick);
    this._elasticAnimator._tick = this._elasticAnimator._tick.bind(this._elasticAnimator);
```

**IMPORTANT:** The elastic animator's `_tick` override must update `elasticOffsetX/Y` (not `camera.x/y`) and zero them when settled. The `bind` at the end ensures `this` inside `_resolveAxis` refers to the animator.

Wait — there's a subtlety with the `bind`. The closure already captures the camera via `this` (the Camera). But `_resolveAxis` is called on `this._elasticAnimator`, which is the CameraAnimator. The `_tick` function uses `this._elasticAnimator._springX`, not `this._springX`. So binding to the animator would break the `this` reference to the Camera. **Do NOT bind** — the function already closes over the correct `this` (Camera):

```javascript
    this._elasticAnimator._tick = ((cam) => {
      const anim = cam._elasticAnimator;
      return (timestamp) => {
        if (!anim._startTime) anim._startTime = timestamp;
        const elapsed = Math.min((timestamp - anim._startTime) / 1000, 2.0);
        const rx = anim._resolveAxis(anim._springX, elapsed);
        const ry = anim._resolveAxis(anim._springY, elapsed);
        cam.elasticOffsetX = rx.value;
        cam.elasticOffsetY = ry.value;
        EventBus.emit('camera:changed');
        if (rx.settled && ry.settled) {
          cam.elasticOffsetX = 0;
          cam.elasticOffsetY = 0;
          cam._cumulativeOverflowX = 0;
          cam._cumulativeOverflowY = 0;
          EventBus.emit('camera:changed');
          anim.cancel();
          if (cam._gestures) cam._gestures.release('SNAP_BACK');
        } else {
          anim._rafId = requestAnimationFrame(anim._tick);
        }
      };
    })(this);
```

Also add `_smoothZoom` and `_gestures` initialization in `attachTo()`:

```javascript
    this._smoothZoom = new SmoothZoomAnimator(this);
    this._gestures = new GestureStateMachine(this);
```

**Verify:** `npx playwright test tests/camera-clamping.spec.js tests/camera-math.spec.js --project=desktop-1920 --reporter=line` (no regressions — nothing wired yet)

**Commit:** `feat(phase6): add dual-position camera properties, elastic offset methods, and _elasticAnimator`

---

## Task 4: Refactor `_applyConstraints()` — always hard-clamp

**File:** `vtt/js/map-camera.js`

This is the critical behavioral change. `_applyConstraints()` stops branching on `_isDragging` and always hard-clamps.

**Step 1:** Replace `_applyConstraints()` (lines 665-687). The current code branches on `_isDragging` to choose elastic vs hard bounds. The new code always hard-clamps:

```javascript
  _applyConstraints() {
    const prevX = this.x;
    const prevY = this.y;
    const prevZoom = this.zoom;

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

    // 3. Emit if changed (include elastic offset for visual updates)
    if (this.x !== prevX || this.y !== prevY || this.zoom !== prevZoom
        || this.elasticOffsetX !== 0 || this.elasticOffsetY !== 0) {
      EventBus.emit('camera:changed');
    }
  }
```

**IMPORTANT:** After this change, all existing mouse drag elastic overscroll stops working (elastic is now handled by the dual-position path wired in Task 7). Tests that depend on `_isDragging` enabling elastic bounds will fail until updated. This is expected — Tasks 5-7 complete the wiring.

**Verify:** `npx playwright test tests/camera-math.spec.js --project=desktop-1920 --reporter=line` (math tests pass; clamping tests may fail — that's expected)

**Commit:** `refactor(phase6): _applyConstraints always hard-clamps — removes _isDragging branch`

---

## Task 5: Refactor `panBy()` with overflow detection

**File:** `vtt/js/map-camera.js`

Replace `panBy()` to detect overflow and feed it into elastic offset when `_gestureActive` is true.

**Step 1:** Replace `panBy()` at lines 781-785:

```javascript
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
```

**Step 2:** Add elastic offset recalculation at the end of `zoomAt()` (after `this._applyConstraints();` at line 760):

```javascript
    // Recalculate elastic offset with new zoom-derived bounds
    if (this.elasticOffsetX !== 0 || this.elasticOffsetY !== 0) {
      this._feedElasticOverflow(this._cumulativeOverflowX, this._cumulativeOverflowY);
      EventBus.emit('camera:changed');
    }
```

**Verify:** `npx playwright test tests/camera-math.spec.js --project=desktop-1920 --reporter=line`

**Commit:** `refactor(phase6): panBy detects overflow, feeds elastic offset when gesture active`

---

## Task 6: Update renderer to use `visualX`/`visualY`

**File:** `vtt/js/map-camera.js`

The renderer calls `camera.applyTransform(ctx)` — this is the single point of change.

**Step 1:** Update `applyTransform()` at lines 507-514:

```javascript
  applyTransform(ctx) {
    ctx.setTransform(
      this.zoom, 0,
      0, this.zoom,
      -this.visualX * this.zoom,
      -this.visualY * this.zoom
    );
  }
```

**Step 2:** Update `screenToWorld()` at lines 457-462 to use visual position (so that pointer events map correctly during elastic overscroll):

```javascript
  screenToWorld(sx, sy) {
    return {
      x: sx / this.zoom + this.visualX,
      y: sy / this.zoom + this.visualY
    };
  }
```

**Step 3:** Update `worldToScreen()` at lines 464-469:

```javascript
  worldToScreen(wx, wy) {
    return {
      x: (wx - this.visualX) * this.zoom,
      y: (wy - this.visualY) * this.zoom
    };
  }
```

**Note:** `localToShared()` in `shared/protocol.js` calls `camera.x` and `camera.zoom` directly (not through screenToWorld), so BroadcastChannel sync continues to use the logical position. This is correct — elastic offset is local-only.

**Verify:** `npx playwright test tests/camera-math.spec.js --project=desktop-1920 --reporter=line`

**Commit:** `refactor(phase6): renderer uses visualX/Y — elastic offset visible in canvas transform`

---

## Task 7: Refactor mouse drag to dual-position model + inertial coast

**File:** `vtt/js/map-camera.js`

Replace the Phase 3/5.5 mouse drag elastic approach with the dual-position model. The mousemove handler uses direct position set (preserving start-relative calculation) but now feeds overflow into elastic offset.

**Step 1:** Update `_startPan()` (lines 977-990) — replace `_isDragging = true` with `_gestureActive = true`, cancel inertial coast and elastic animator:

```javascript
  _startPan(e, button) {
    this._cancelInertialCoast();
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
```

**Step 2:** Update `_commitPan()` (lines 1001-1008) — replace `_isDragging = true` with `_gestureActive = true`:

```javascript
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
    this._setPanCursor(true);
  }
```

**Step 3:** Update the mousemove handler inside `_attachMouseHandlers()` (lines 870-884). Replace the direct `this.x = ...` / `this.y = ...` + `_applyConstraints()` with overflow-aware code:

```javascript
      // Lines 870-884: replace the panning branch with:
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
```

**Step 4:** Update the mouseup handler (lines 887-898). Replace `_isDragging = false` + `_handleDragRelease()` with the new velocity-based inertia/snap-back:

```javascript
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
```

**Note:** `VelocityTracker.getVelocity()` returns `{vx, vy}` (from Phase 5.5), not `{x, y}`. The `_startInertialCoast` expects `{x, y}` as screen px/s. Adapt accordingly — either rename in the call or update `_startInertialCoast` to accept `{vx, vy}`.

**Step 5:** Update `_cancelPan()` (lines 1010-1017) — replace `_isDragging = false` + `_triggerSnapBack()`:

```javascript
  _cancelPan() {
    this._panning = false;
    this._pendingPan = false;
    this._panButton = -1;
    this._gestureActive = false;
    this._cancelInertialCoast();
    this._setPanCursor(false);
    if (this._gestures) this._gestures.request('SNAP_BACK');
    this._snapBackElastic();
  }
```

**Verify:** `npx playwright test tests/input-handling.spec.js --project=desktop-1920 --reporter=line` (mouse drag tests should work with the new elastic model)

**Commit:** `refactor(phase6): mouse drag uses dual-position model with inertial coast on release`

---

## Task 8: Wire TrackpadGestureDetector into wheel handler

**File:** `vtt/js/map-camera.js`

**Step 1:** Add import for `TrackpadGestureDetector` and `classifyWheelDevice` at the top (after line 9):

```javascript
import { TrackpadGestureDetector, classifyWheelDevice } from './trackpad-gesture.js';
```

**Step 2:** Replace `_attachWheelHandler()` (lines 823-834) with the new version that integrates the gesture detector and smooth zoom:

```javascript
  _attachWheelHandler(el) {
    this._trackpadDetector = new TrackpadGestureDetector({
      onGestureStart: () => {
        this._cancelInertialCoast();
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
        // Zoom path
        const device = classifyWheelDevice(e);
        const screen = this.eventToScreen(e);

        if (device === 'mouse') {
          // Smooth animated zoom for discrete mouse wheel
          if (this._gestures) this._gestures.request('ZOOM_ANIMATE');
          this._smoothZoom.onWheelZoom(dz, screen.x, screen.y);
        } else {
          // Trackpad pinch: direct 1:1 zoom (existing behavior)
          if (this._gestures) this._gestures.request('PINCH_ZOOM');
          this.zoomAt(screen.x, screen.y, dz * -ZOOM_SENSITIVITY);
        }
      } else if (dx !== 0 || dy !== 0) {
        // Pan path: run through gesture detector first
        this._trackpadDetector.handleWheel(e);
        this.panBy(-dx, -dy);
      }
    }, { passive: false });
  }
```

**Step 3:** Update keyboard zoom to retarget smooth zoom. In `KeyboardController._tick()` (around line 380-395), after any zoom operation, add:

```javascript
      // After zoom in _tick():
      if (this._camera._smoothZoom) this._camera._smoothZoom.retarget();
```

Find the exact location by searching for `zoomToCenter` inside `KeyboardController._tick()`.

**Step 4:** Add Safari gesture prevention in `_preventBrowserZoom()`. Find this method (it should be near the attachTo area) and add:

```javascript
    // Safari gesture events
    el.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
    el.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
```

**Verify:** `npx playwright test tests/input-handling.spec.js --project=desktop-1920 --reporter=line`

**Commit:** `feat(phase6): wire TrackpadGestureDetector + SmoothZoomAnimator into wheel handler`

---

## Task 9: Remove dead code + CSS changes

**File:** `vtt/js/map-camera.js`, `vtt/css/map.css`

**Step 1:** Remove `_isDragging` property from Camera constructor (line 444). Search for all remaining references and remove or replace with `_gestureActive`.

**Step 2:** Remove `_applyElasticBounds()` method (lines 633-639).

**Step 3:** Remove `_elasticClampAxis()` method (lines 641-661).

**Step 4:** Remove `_triggerSnapBack()` method (lines 689-698) — replaced by `_snapBackElastic()`.

**Step 5:** Remove `_handleDragRelease()` method (lines 700-714) — inlined into mouseup handler.

**Step 6:** Remove `_isPastBounds()` method (lines 716-723) — overflow detection in panBy replaces this.

**Step 7:** Remove `_triggerSnapBackWithVelocity()` method (lines 725-742) — replaced by `_snapBackElastic(velocity)`.

**Step 8:** Remove `CameraAnimator.momentum()` (lines 124-133), `_tickMomentum()` (lines 135-169), `_stopMomentum()` (lines 171-176), and the momentum state from the constructor (lines 47-52). Also remove momentum cleanup from `cancel()` (lines 118-120). Phase 6's `_startInertialCoast()` replaces all of this.

**Step 9:** Add CSS cursor for coasting in `vtt/css/map.css` (after the `.panning` rule at line 14):

```css
#map-container.coasting { cursor: grab; }
```

**Step 10:** Verify no remaining references to removed methods:

```bash
grep -n "_isDragging\|_applyElasticBounds\|_elasticClampAxis\|_triggerSnapBack\b\|_handleDragRelease\|_isPastBounds\|_triggerSnapBackWithVelocity\|_tickMomentum\|_stopMomentum" vtt/js/map-camera.js
# Expected: 0 lines
```

**Verify:** `npx playwright test tests/camera-math.spec.js --project=desktop-1920 --reporter=line`

**Commit:** `refactor(phase6): remove dead Phase 3/5.5 code — _isDragging, elastic clamp, old momentum`

---

## Task 10: Update existing tests

**Files:** `tests/camera-clamping.spec.js`, `tests/input-handling.spec.js`, `tests/phase5.5-unit.spec.js`

**Step 1:** In `tests/camera-clamping.spec.js`:

- **`_isDragging=true enables elastic mode`** → Replace with a test that sets `_gestureActive = true`, feeds overflow through the cumulative tracking, and asserts `elasticOffsetX` is nonzero. The test should verify the dual-position model produces rubber-banded visual displacement while `camera.x` stays at the hard-clamped boundary.

- **`elastic: within bounds returns position unchanged`** → Remove (calls dead `_elasticClampAxis`). Replace with a test that verifies `panBy()` with `_gestureActive=true` produces zero elastic offset when the camera is within bounds.

- **`elastic: past boundary pulls toward boundary`** → Remove (calls dead `_elasticClampAxis`). Replace with a test that verifies `_feedElasticOverflow()` produces rubber-banded offset.

- **`elastic: diminishing returns on deeper overshoot`** → Remove (calls dead `_elasticClampAxis`). Replace with a test that verifies `rubberBand()` directly (the function still exists).

- **`_triggerSnapBack settles within bounds after ~600ms`** → Replace with a test that verifies `_snapBackElastic()` settles `elasticOffsetX/Y` to zero.

- **`right-click drag past boundary snaps back`** → Update to check `elasticOffsetX/Y → 0` instead of `camera.x >= -1.0`. The camera.x should already be at the hard boundary; it's the elastic offset that springs back.

- **`panBy clamps at left/right edge`** → This test should still pass — panBy still hard-clamps `camera.x` when `_gestureActive` is false.

**Step 2:** In `tests/input-handling.spec.js`:

- **`left-click drag past threshold activates elastic bounds`** → Replace `__cam()._isDragging === true` assertion with `__cam()._gestureActive === true`, and `__cam()._isDragging === false` with `__cam()._gestureActive === false`.

**Step 3:** In `tests/phase5.5-unit.spec.js`:

- **`zoom 0.8 preserved when coverZoom is 0.667`** (line 193) → Remove `cam._isDragging = false;` (no longer needed — `_applyConstraints()` always hard-clamps). The test logic remains the same.

**Verify:** `npx playwright test tests/camera-clamping.spec.js tests/input-handling.spec.js tests/phase5.5-unit.spec.js --project=desktop-1920 --reporter=line`

**Commit:** `test(phase6): update existing tests for dual-position model — _isDragging → _gestureActive`

---

## Task 11: Unit tests — TrackpadGestureDetector, classifyWheelDevice, SmoothZoomAnimator

**File:** Create `tests/phase6-unit.spec.js`

```javascript
import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode, injectTestAccessors } from './helpers.js';

// ============================================================
// TrackpadGestureDetector
// ============================================================
test.describe('TrackpadGestureDetector', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'load' });
  });

  test('first wheel event transitions from IDLE to ACTIVE', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { TrackpadGestureDetector } = await import('/vtt/js/trackpad-gesture.js');
      let started = false;
      const detector = new TrackpadGestureDetector({
        onGestureStart: () => { started = true; }
      });
      detector.handleWheel({ deltaY: 10, deltaX: 0 });
      return { state: detector.state, started };
    });
    expect(result.state).toBe('ACTIVE');
    expect(result.started).toBe(true);
  });

  test('sustained delta decay transitions to MOMENTUM', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { TrackpadGestureDetector } = await import('/vtt/js/trackpad-gesture.js');
      let momentumStarted = false;
      const detector = new TrackpadGestureDetector({
        onMomentumStart: () => { momentumStarted = true; }
      });
      // 6 active events (no decay)
      for (let i = 0; i < 6; i++) detector.handleWheel({ deltaY: 20, deltaX: 0 });
      const activeState = detector.state;
      // 3 decaying events → momentum
      detector.handleWheel({ deltaY: 18, deltaX: 0 });
      detector.handleWheel({ deltaY: 15, deltaX: 0 });
      detector.handleWheel({ deltaY: 12, deltaX: 0 });
      return { activeState, finalState: detector.state, momentumStarted };
    });
    expect(result.activeState).toBe('ACTIVE');
    expect(result.finalState).toBe('MOMENTUM');
    expect(result.momentumStarted).toBe(true);
  });

  test('delta spike during MOMENTUM restarts as ACTIVE', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { TrackpadGestureDetector } = await import('/vtt/js/trackpad-gesture.js');
      let startCount = 0;
      const detector = new TrackpadGestureDetector({
        onGestureStart: () => { startCount++; }
      });
      for (let i = 0; i < 6; i++) detector.handleWheel({ deltaY: 20, deltaX: 0 });
      detector.handleWheel({ deltaY: 18, deltaX: 0 });
      detector.handleWheel({ deltaY: 15, deltaX: 0 });
      detector.handleWheel({ deltaY: 12, deltaX: 0 });
      // Spike: new gesture
      detector.handleWheel({ deltaY: 25, deltaX: 0 });
      return { state: detector.state, startCount };
    });
    expect(result.state).toBe('ACTIVE');
    expect(result.startCount).toBe(2);
  });

  test('cancel() immediately resets to IDLE', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { TrackpadGestureDetector } = await import('/vtt/js/trackpad-gesture.js');
      let ended = false;
      const detector = new TrackpadGestureDetector({
        onGestureEnd: () => { ended = true; }
      });
      detector.handleWheel({ deltaY: 10, deltaX: 0 });
      detector.cancel();
      return { state: detector.state, ended };
    });
    expect(result.state).toBe('IDLE');
    expect(result.ended).toBe(true);
  });

  test('constant deltas do not trigger MOMENTUM (slow steady scroll)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { TrackpadGestureDetector } = await import('/vtt/js/trackpad-gesture.js');
      let momentumStarted = false;
      const detector = new TrackpadGestureDetector({
        onMomentumStart: () => { momentumStarted = true; }
      });
      for (let i = 0; i < 20; i++) detector.handleWheel({ deltaY: 5, deltaX: 0 });
      return { state: detector.state, momentumStarted };
    });
    expect(result.state).toBe('ACTIVE');
    expect(result.momentumStarted).toBe(false);
  });

  test('isGestureActive reflects ACTIVE and MOMENTUM states', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { TrackpadGestureDetector } = await import('/vtt/js/trackpad-gesture.js');
      const detector = new TrackpadGestureDetector({});
      const idle = detector.isGestureActive;
      detector.handleWheel({ deltaY: 10, deltaX: 0 });
      const active = detector.isGestureActive;
      return { idle, active };
    });
    expect(result.idle).toBe(false);
    expect(result.active).toBe(true);
  });
});

// ============================================================
// classifyWheelDevice
// ============================================================
test.describe('classifyWheelDevice', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'load' });
  });

  test('large integer deltaY classified as mouse', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { classifyWheelDevice } = await import('/vtt/js/trackpad-gesture.js');
      return {
        a: classifyWheelDevice({ deltaY: 100, deltaX: 0 }),
        b: classifyWheelDevice({ deltaY: -120, deltaX: 0 }),
      };
    });
    expect(result.a).toBe('mouse');
    expect(result.b).toBe('mouse');
  });

  test('small fractional deltaY classified as trackpad', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { classifyWheelDevice } = await import('/vtt/js/trackpad-gesture.js');
      return {
        a: classifyWheelDevice({ deltaY: 3.5, deltaX: 0 }),
        b: classifyWheelDevice({ deltaY: 0.5, deltaX: 2.1 }),
      };
    });
    expect(result.a).toBe('trackpad');
    expect(result.b).toBe('trackpad');
  });

  test('horizontal delta forces trackpad classification', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { classifyWheelDevice } = await import('/vtt/js/trackpad-gesture.js');
      return classifyWheelDevice({ deltaY: 100, deltaX: 50 });
    });
    expect(result).toBe('trackpad');
  });
});

// ============================================================
// Dual-position elastic model
// ============================================================
test.describe('Dual-position elastic model', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('visualX/Y include elastic offset', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.elasticOffsetX = 10;
      cam.elasticOffsetY = 20;
      return {
        visualX: cam.visualX,
        visualY: cam.visualY,
        x: cam.x,
        y: cam.y,
      };
    });
    expect(result.visualX).toBe(result.x + 10);
    expect(result.visualY).toBe(result.y + 20);
  });

  test('_feedElasticOverflow produces rubber-banded offset', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam._gestureActive = true;
      cam._feedElasticOverflow(100, 0);
      return { offsetX: cam.elasticOffsetX, offsetY: cam.elasticOffsetY };
    });
    expect(Math.abs(result.offsetX)).toBeGreaterThan(0);
    expect(Math.abs(result.offsetX)).toBeLessThan(100); // Rubber-banded
    expect(result.offsetY).toBe(0);
  });

  test('_feedElasticOverflow dampens during momentum (c=0.3 vs 0.55)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam._gestureActive = true;
      cam._momentumScrollActive = false;
      cam._feedElasticOverflow(200, 0);
      const activeOffset = cam.elasticOffsetX;
      cam._momentumScrollActive = true;
      cam._feedElasticOverflow(200, 0);
      const momentumOffset = cam.elasticOffsetX;
      return { activeOffset, momentumOffset };
    });
    // Momentum offset should be smaller (more dampened)
    expect(Math.abs(result.momentumOffset)).toBeLessThan(Math.abs(result.activeOffset));
  });

  test('_feedElasticOverflow does nothing when _gestureActive is false', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam._gestureActive = false;
      cam._feedElasticOverflow(100, 100);
      return { offsetX: cam.elasticOffsetX, offsetY: cam.elasticOffsetY };
    });
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
  });

  test('panBy at boundary produces elastic offset when gesture active', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      // Zoom in so boundaries exist
      cam.zoom = 2.0;
      cam._applyConstraints();
      // Pan to left boundary
      for (let i = 0; i < 200; i++) cam.panBy(50, 0);
      const atBoundary = cam.x;
      // Now activate gesture and push past
      cam._gestureActive = true;
      cam._cumulativeOverflowX = 0;
      cam.panBy(200, 0);
      return {
        x: cam.x,
        atBoundary,
        elasticX: cam.elasticOffsetX,
      };
    });
    // camera.x should still be at the hard boundary
    expect(result.x).toBeCloseTo(result.atBoundary, 0);
    // elastic offset should be nonzero
    expect(Math.abs(result.elasticX)).toBeGreaterThan(0);
  });

  test('_applyConstraints always hard-clamps (no _isDragging branch)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam.x = -500; // Way past left boundary
      cam._applyConstraints();
      return { x: cam.x };
    });
    expect(result.x).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// SmoothZoomAnimator
// ============================================================
test.describe('SmoothZoomAnimator', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('onWheelZoom updates target within bounds', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      const animator = cam._smoothZoom;
      const before = animator._targetZoom;
      animator.onWheelZoom(-1.0, 500, 500); // Zoom in
      const after = animator._targetZoom;
      return { before, after };
    });
    expect(result.after).toBeGreaterThan(result.before);
  });

  test('retarget syncs to current camera zoom', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam._smoothZoom._targetZoom = 3.0;
      cam._smoothZoom.retarget();
      return cam._smoothZoom._targetZoom;
    });
    const currentZoom = await page.evaluate(() => __cam().zoom);
    expect(result).toBeCloseTo(currentZoom, 2);
  });

  test('cancel stops animation and resets target', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam._smoothZoom.onWheelZoom(-1.0, 500, 500);
      const animating = cam._smoothZoom._animating;
      cam._smoothZoom.cancel();
      return { waAnimating: animating, isAnimating: cam._smoothZoom._animating };
    });
    expect(result.waAnimating).toBe(true);
    expect(result.isAnimating).toBe(false);
  });
});

// ============================================================
// rubberBand function (still exists, just verify)
// ============================================================
test.describe('rubberBand function', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('diminishing returns on deeper overshoot', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      // Use _feedElasticOverflow to test rubber-band effect
      cam._gestureActive = true;
      cam._feedElasticOverflow(50, 0);
      const small = cam.elasticOffsetX;
      cam._feedElasticOverflow(500, 0);
      const large = cam.elasticOffsetX;
      // Ratio: 500/50 = 10x input, but output ratio should be much less
      return { small, large, ratio: Math.abs(large / small) };
    });
    expect(result.ratio).toBeLessThan(10);
    expect(result.ratio).toBeGreaterThan(1);
  });
});
```

**Verify:** `npx playwright test tests/phase6-unit.spec.js --project=desktop-1920 --reporter=line`

**Commit:** `test(phase6): add unit tests — TrackpadGestureDetector, classifyWheelDevice, SmoothZoomAnimator, elastic model`

---

## Task 12: Integration tests — elastic trackpad scroll, mouse drag, smooth zoom

**File:** Create `tests/phase6-integration.spec.js`

```javascript
import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode, injectTestAccessors } from './helpers.js';

// ============================================================
// Trackpad elastic overscroll
// ============================================================
test.describe('Trackpad elastic overscroll', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('trackpad scroll at boundary produces elastic offset', async ({ page }) => {
    // Zoom in to create room to pan
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
    });

    // Pan to the left boundary
    await page.evaluate(() => {
      const cam = __cam();
      for (let i = 0; i < 200; i++) cam.panBy(50, 0);
    });

    // Dispatch trackpad-like wheel events past the boundary
    await page.evaluate(() => {
      const el = document.getElementById('map-container');
      for (let i = 0; i < 10; i++) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 0, deltaX: 15, deltaMode: 0,
          ctrlKey: false, bubbles: true, cancelable: true
        }));
      }
    });
    await page.waitForTimeout(50);

    const result = await page.evaluate(() => {
      const cam = __cam();
      return { elasticX: cam.elasticOffsetX, x: cam.x };
    });

    // camera.x at hard boundary, elastic offset nonzero
    expect(Math.abs(result.elasticX)).toBeGreaterThan(0);
  });

  test('elastic offset springs back to zero after gesture end', async ({ page }) => {
    // Setup: zoom in + pan to boundary + dispatch scroll events
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      for (let i = 0; i < 200; i++) cam.panBy(50, 0);
    });

    await page.evaluate(() => {
      const el = document.getElementById('map-container');
      for (let i = 0; i < 10; i++) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 0, deltaX: 15, deltaMode: 0,
          ctrlKey: false, bubbles: true, cancelable: true
        }));
      }
    });

    // Wait for gesture end timeout (150ms) + spring animation (~250ms)
    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && Math.abs(cam.elasticOffsetX) < 1.0;
    }, { timeout: 2000 });

    const offset = await page.evaluate(() => __cam().elasticOffsetX);
    expect(Math.abs(offset)).toBeLessThan(1.0);
  });
});

// ============================================================
// Mouse drag elastic with dual-position model
// ============================================================
test.describe('Mouse drag elastic (dual-position)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('right-click drag past boundary produces elastic offset', async ({ page }) => {
    // Zoom in
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
    });

    const canvas = page.locator('#map-container');
    const box = await canvas.boundingBox();

    // Right-click drag past left boundary
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + box.width + 200, box.y + box.height / 2, { steps: 10 });

    const duringDrag = await page.evaluate(() => {
      const cam = __cam();
      return { elasticX: cam.elasticOffsetX, gestureActive: cam._gestureActive };
    });

    expect(duringDrag.gestureActive).toBe(true);
    expect(Math.abs(duringDrag.elasticX)).toBeGreaterThan(0);

    // Release
    await page.mouse.up({ button: 'right' });

    // Wait for snap-back
    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && Math.abs(cam.elasticOffsetX) < 1.0;
    }, { timeout: 2000 });

    const afterRelease = await page.evaluate(() => Math.abs(__cam().elasticOffsetX));
    expect(afterRelease).toBeLessThan(1.0);
  });

  test('left-click drag past threshold activates _gestureActive', async ({ page }) => {
    await page.evaluate(() => { __cam().zoom = 2.0; __cam()._applyConstraints(); });
    const canvas = page.locator('#map-container');
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'left' });
    // Move past threshold (3px)
    await page.mouse.move(cx + 50, cy, { steps: 5 });

    const active = await page.evaluate(() => __cam()._gestureActive);
    expect(active).toBe(true);

    await page.mouse.up({ button: 'left' });
    // After release: gestureActive may be true briefly (inertial coast) or false
    // Wait for everything to settle
    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && !cam._gestureActive && Math.abs(cam.elasticOffsetX) < 1.0;
    }, { timeout: 2000 });
  });
});

// ============================================================
// Smooth zoom cursor anchor
// ============================================================
test.describe('Smooth zoom animation', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('discrete mouse wheel zoom triggers smooth animation', async ({ page }) => {
    // Dispatch a mouse-wheel-like event (large integer delta, no ctrlKey)
    await page.evaluate(() => {
      const el = document.getElementById('map-container');
      // Note: normalizeWheel interprets ctrlKey+wheel as zoom via dz
      // For mouse wheel zoom without ctrlKey, deltaY goes through dx/dy path
      // which means pure scroll. For zoom, we need ctrlKey=false but
      // classifyWheelDevice returns 'mouse' for large integer deltas.
      // Actually, normalizeWheel routes ctrlKey/metaKey to dz, and non-ctrl to dx/dy.
      // So mouse wheel WITHOUT ctrl → pan, not zoom.
      // Mouse wheel WITH ctrl → dz → zoom.
      // Hmm. Let me re-read the code...
      // normalizeWheel: if ctrlKey → dz = clamped(dy/100); dx=0, dy=0
      // So for mouse wheel to zoom, it must have ctrlKey=true (pinch synthesis)
      // or the raw deltaY must be interpreted as zoom by the handler.
      // Actually, looking at the new wheel handler: dz !== 0 → zoom path.
      // dz is nonzero only when ctrlKey is true (from normalizeWheel).
      // So discrete mouse wheel (scroll up/down, no ctrl) → panBy.
      // This means SmoothZoomAnimator is triggered by mouse scroll WITH ctrlKey.
      // That's the pinch-to-zoom path for mouse users who ctrl+scroll.
      // Wait, the implementation guide Section 7 says:
      // "Each wheel notch produces a visible jump because the zoom change happens
      // in a single frame." This implies mouse wheel without ctrl IS zoom.
      // But normalizeWheel routes non-ctrl wheel to dx/dy (pan).
      // This is a discrepancy. The SmoothZoomAnimator may not be triggerable
      // with the current normalizeWheel routing.
      // For now, test via the camera's _smoothZoom directly.
      const cam = __cam();
      cam._smoothZoom.onWheelZoom(-1.0, 960, 540);
    });

    const animating = await page.evaluate(() => __cam()._smoothZoom._animating);
    expect(animating).toBe(true);

    // Wait for animation to settle
    await page.waitForFunction(() => {
      return !window.__vtt?.mapRenderer?.camera?._smoothZoom?._animating;
    }, { timeout: 2000 });
  });
});

// ============================================================
// Gesture preemption
// ============================================================
test.describe('Gesture preemption', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('mouse drag preempts scroll gesture', async ({ page }) => {
    // Start a scroll gesture
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      // Simulate scroll gesture start
      const el = document.getElementById('map-container');
      el.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 10, deltaX: 0, deltaMode: 0,
        ctrlKey: false, bubbles: true, cancelable: true
      }));
    });

    const gestureBeforeDrag = await page.evaluate(() => __cam()._gestures?.current);

    // Now start a mouse drag (higher priority)
    const canvas = page.locator('#map-container');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });

    const gestureAfterDrag = await page.evaluate(() => __cam()._gestures?.current);
    expect(gestureAfterDrag).toBe('DRAG_PAN');

    await page.mouse.up({ button: 'right' });
  });
});
```

**Verify:** `npx playwright test tests/phase6-integration.spec.js --project=desktop-1920 --reporter=line`

**Commit:** `test(phase6): add integration tests — trackpad elastic, mouse drag elastic, smooth zoom, gesture preemption`

---

## Task 13: Full suite verification

**Step 1:** Kill any stale server: `lsof -ti:8765 | xargs kill -9 2>/dev/null; sleep 1`

**Step 2:** Run full suite: `npx playwright test --reporter=line`
Expected: 1100+ passed, 0 failed.

**Step 3:** Run Phase 6 tests isolated: `npx playwright test tests/phase6-unit.spec.js tests/phase6-integration.spec.js --reporter=line`

**Step 4:** Run pre-existing test suites that touch camera/elastic (regression check):
```bash
npx playwright test tests/camera-clamping.spec.js tests/camera-math.spec.js tests/input-handling.spec.js tests/phase5.5-unit.spec.js tests/phase5.5-integration.spec.js --project=desktop-1920 --reporter=line
```

**Step 5:** Grep for any remaining dead references:
```bash
grep -rn "_isDragging\|_applyElasticBounds\|_elasticClampAxis\|_triggerSnapBack\b\|_handleDragRelease\|_isPastBounds\|_triggerSnapBackWithVelocity" vtt/ tests/
# Expected: 0 lines
```

**Step 6:** Grep for any remaining private broadcaster access in controller:
```bash
grep -rn "broadcaster\?\.send" controller/
# Expected: 0 lines
```

---

## Verification — Manual Smoke Test

After all code changes:
1. Start server (`python3 -m http.server 8765`), open VTT Display
2. **Trackpad scroll elastic**: Zoom in 2-3 notches. Two-finger scroll to an edge. Map should pull past with resistance. Lift fingers → spring snap-back within ~250ms.
3. **Trackpad momentum overscroll**: Fast two-finger flick toward edge. Momentum carries past with dampened rubber-band. Snap-back after momentum settles.
4. **Mouse drag elastic**: Right-click drag past an edge. Same rubber-band feel as before. Release → snap-back.
5. **Inertial coast**: Zoom in. Fast right-click drag release. Map glides with friction. Coast hitting boundary → elastic overscroll → snap-back.
6. **Smooth mouse wheel zoom**: Use physical mouse scroll wheel. Zoom should be smooth/animated, not jumpy. Cursor anchor preserved.
7. **Trackpad pinch still direct**: Pinch-to-zoom is immediate, no lag.
8. **Gesture preemption**: Start scroll → right-click drag → scroll cancels immediately.
9. **Keyboard pan stops at edge**: Arrow keys pan to edge, stop cleanly, no elastic.
10. **BroadcastChannel**: Open Controller + Display. Controller pan buttons → Display responds. No elastic offset visible on Display.
11. **No console errors** on any window.

---

## Design Decisions & Tradeoffs

### Why dual-position over mode flags
The Phase 3 `_isDragging` flag approach requires N flags for N input types. Each new input source (trackpad scroll, inertial coast, smooth zoom) would need its own flag, and `_applyConstraints()` would need to check all of them. The dual-position model eliminates this: the constraint pipeline always hard-clamps, and any gesture can feed overflow into the elastic offset through a single `_gestureActive` gate.

### Why rely on OS momentum for trackpad
macOS momentum events are tuned to user preferences (scroll direction, inertia toggle, trackpad sensitivity). Reimplementing deceleration in JavaScript would ignore those settings and feel wrong to every macOS user who has customized their trackpad.

### Why log-space interpolation for smooth zoom
Linear lerp between zoom 1.0→2.0 feels twice as fast as 2.0→4.0, even though both are 2× changes. Log-space lerp ensures zooming in and out feel symmetrical, matching Figma/Google Maps behavior.

### SmoothZoomAnimator routing concern
**Note:** The current `normalizeWheel()` routes non-ctrl wheel events to `dx/dy` (pan path), not `dz` (zoom path). This means discrete mouse wheel scroll-up/down produces **pan**, not zoom. The SmoothZoomAnimator is triggered only when `dz !== 0` (ctrl+wheel = pinch synthesis). If the design intent is that mouse wheel should zoom (not pan), `normalizeWheel()` may need changes — but that's a separate consideration. As implemented, SmoothZoomAnimator activates for ctrl+mouse-wheel zoom and the `classifyWheelDevice` distinction between mouse/trackpad applies within the zoom path to choose smooth vs direct.
