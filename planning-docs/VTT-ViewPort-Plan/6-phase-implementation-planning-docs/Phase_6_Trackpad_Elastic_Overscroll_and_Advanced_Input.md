# Phase 6: Trackpad elastic overscroll and advanced input polish

**This guide extends the VTT's elastic overscroll system to two-finger trackpad scroll panning, adds momentum-based inertial panning for mouse drag release, implements smooth animated zoom for discrete mouse wheel input, and builds a unified gesture state machine that coordinates all input sources without conflicts.** The Phase 3 elastic overscroll works beautifully for mouse drag because the gesture lifecycle is explicit: mousedown starts elastic mode, mouseup ends it and triggers the spring snap-back. Two-finger trackpad scroll has no equivalent lifecycle events. Wheel events fire continuously with no "gesture start" or "gesture end" signal, and macOS momentum scrolling continues producing synthetic wheel events long after the user's fingers have lifted. Phase 6 solves this with a `TrackpadGestureDetector` that uses delta decay analysis and timeout heuristics to reconstruct the gesture lifecycle from raw wheel events, enabling the same rubber-band resistance and spring snap-back that mouse drag already provides.

The architectural centerpiece is the **dual-position camera model**: a separation of logical camera state (always hard-clamped to valid bounds, always broadcast over BroadcastChannel) from elastic visual offset (a local, animated displacement that renders past boundaries during active gestures). This replaces the Phase 3 approach of toggling between elastic and hard clamping modes inside `_applyConstraints()` based on the `_isDragging` flag. The dual-position model is cleaner because the logical camera state is never corrupted by overscroll, BroadcastChannel sync always sends valid positions, and the elastic offset is a purely visual concern managed by its own animation system. The existing `_isDragging` flag and `_applyElasticBounds()` path are refactored into this model, so mouse drag, trackpad scroll, and keyboard pan all benefit from the same elastic behavior through a single code path.

The guide is structured as a walkthrough you can hand directly to Claude Code. Each section explains what the code does and why, provides the complete implementation, calls out interactions with existing modules, and includes testing protocols. Read it front to back before changing anything. The order matters.

---

## Table of contents

1. [What Phase 5 established and what Phase 6 changes](#1-what-phase-5-established-and-what-phase-6-changes)
2. [The dual-position camera model: logical state vs. elastic offset](#2-the-dual-position-camera-model)
3. [TrackpadGestureDetector: reconstructing gesture lifecycle from wheel events](#3-trackpadgesturedetector)
4. [Elastic overscroll for trackpad scroll panning](#4-elastic-overscroll-for-trackpad-scroll)
5. [Momentum handling: OS-driven vs. app-driven deceleration](#5-momentum-handling)
6. [Inertial panning for mouse drag release](#6-inertial-panning-for-mouse-drag-release)
7. [Smooth animated zoom for discrete mouse wheel input](#7-smooth-animated-zoom)
8. [Refactoring mouse drag to use the dual-position model](#8-refactoring-mouse-drag)
9. [The unified gesture state machine](#9-the-unified-gesture-state-machine)
10. [BroadcastChannel sync implications](#10-broadcastchannel-sync-implications)
11. [CSS changes](#11-css-changes)
12. [Testing protocols](#12-testing-protocols)
13. [Migration checklist](#13-migration-checklist)
14. [What Phase 7 expects from this foundation](#14-phase-7-expectations)
15. [What is explicitly deferred and why](#15-deferred-features)

---

## 1. What Phase 5 established and what Phase 6 changes

### The Phase 5 foundation

Phase 5 delivered cinematic camera control on top of the Phase 4 sync infrastructure. The methods and modules that Phase 6 depends on:

```javascript
// Camera state (vtt/js/map-camera.js)
camera.x / camera.y / camera.zoom      // world-space top-left corner + zoom
camera.viewportW / camera.viewportH     // current viewport dimensions
camera.mapW / camera.mapH               // current map dimensions in world pixels
camera._coverZoom                       // dynamic zoom floor
camera._isDragging                      // true during active mouse drag (elastic mode)
camera._animator                        // CameraAnimator instance (spring snap-back)

// Constraint pipeline (vtt/js/map-camera.js)
camera._applyConstraints()              // single commit point: zoom/pan bounds, emits camera:changed
camera._applyHardBounds()               // hard-clamp pan to valid bounds
camera._applyElasticBounds()            // rubber-band pan during drag
camera._elasticClampAxis(pos, visSize, mapSize, vpDim)  // per-axis rubber-band
camera._triggerSnapBack()               // compute clamped target, fire spring animation
camera._getMinZoom()                    // effective zoom floor (cover or absolute)

// Input methods (vtt/js/map-camera.js)
camera.panBy(dx, dy)                    // screen-space delta -> world-space pan
camera.zoomAt(sx, sy, delta)            // four-step zoom-at-cursor with exponential delta
camera.zoomToCenter(delta)              // zoom at viewport midpoint
camera.setPosition(x, y, zoom)          // direct state set, routes through _applyConstraints()
camera.eventToScreen(e)                 // DOM event -> canvas-space screen coordinates (BoundsCache)

// Input normalization (vtt/js/normalize-wheel.js)
normalizeWheel(e)                       // -> { dx, dy, dz } with cross-browser normalization

// Animation (vtt/js/map-camera.js)
CameraAnimator.snapBack(current, target, velocity)  // critically damped spring
CameraAnimator.cancel()                 // interrupt in-progress animation
rubberBand(distance, dimension, c)      // Apple's c=0.55 resistance formula

// Sync (vtt/js/camera-sync.js)
CameraSyncEngine                        // orchestrator: role-based initialization
CameraBroadcaster                       // rAF-aligned 30fps state streaming
CameraBroadcaster.sendImmediate()       // bypass rAF for user-initiated actions
localToShared(camera, viewport)         // -> { centerX, centerY, zoom }
sharedToLocal(shared, viewport)         // -> { x, y, zoom }

// EventBus events
'camera:changed'                        // emitted by _applyConstraints() on state change
```

Phase 5's key architectural properties relevant to Phase 6:

1. `_applyConstraints()` branches on `_isDragging`: when true, it calls `_applyElasticBounds()` (rubber-band); when false, it calls `_applyHardBounds()` (hard clamp). This binary toggle is the root cause of the trackpad scroll problem. Trackpad scroll goes through `panBy()` with `_isDragging = false`, so it always hits the hard clamp.

2. The `CameraAnimator` uses a closed-form critically damped spring solver with `SPRING_STIFFNESS = 200` and `SPRING_OMEGA ≈ 14.14`, settling in roughly 0.3s. Phase 6 adds a second spring configuration for snap-back after momentum overscroll (stiffness 400, ω ≈ 20, settling in ~0.25s) to match Apple's snappier momentum-bounce feel.

3. The wheel handler in `attachTo()` calls `normalizeWheel(e)` and routes `dz !== 0` to `zoomAt()` and `dx/dy !== 0` to `panBy()`. Each `panBy()` call triggers `_applyConstraints()`, which emits `camera:changed`, which triggers an rAF-coalesced redraw. Phase 6 changes how `panBy()` interacts with constraints when the camera is at a boundary.

4. `_triggerSnapBack()` computes the hard-clamped target position, captures the current (elastic) position, and calls `_animator.snapBack()` with zero initial velocity. Phase 6 passes actual release velocity for both mouse drag and trackpad momentum.

### What Phase 6 changes

Phase 6 makes six targeted upgrades to this foundation:

1. **Introduces the dual-position camera model.** The camera gains `elasticOffsetX` and `elasticOffsetY` properties that represent visual displacement beyond hard bounds. The renderer uses `camera.x + camera.elasticOffsetX` for drawing. `_applyConstraints()` always hard-clamps `camera.x/y`, and overflow feeds into the elastic offset via `rubberBand()` when a gesture is active. BroadcastChannel sync sends only the logical `x/y`, never the elastic offset.

2. **Creates `TrackpadGestureDetector`** as a new class in `vtt/js/trackpad-gesture.js`. It reconstructs the IDLE → ACTIVE → MOMENTUM → IDLE lifecycle from raw wheel events using delta decay detection and timeout heuristics. The detector's state drives whether `panBy()` feeds overflow into the elastic offset (ACTIVE and early MOMENTUM) or triggers snap-back (gesture end).

3. **Adds elastic overscroll for trackpad scroll panning.** When `TrackpadGestureDetector` reports an active gesture and `panBy()` would push the camera past a boundary, the overflow is rubber-banded into the elastic offset instead of being silently dropped by the hard clamp. When the gesture ends (fingers lift + momentum settles), the spring snap-back fires from the elastic offset back to zero.

4. **Adds inertial panning for mouse drag release.** A `VelocityTracker` computes release velocity from the last ~100ms of mousemove samples. On mouseup, if velocity exceeds a threshold, a deceleration animation continues the pan with exponential friction. If the deceleration carries the camera past a boundary, the spring takes over with velocity continuity at the junction.

5. **Adds smooth animated zoom for discrete mouse wheel input.** Instead of jumping to the new zoom level on each wheel notch, a `SmoothZoomAnimator` sets a target zoom and chases it with exponential interpolation in log-space. Rapid scrolling accumulates a larger target delta, creating natural acceleration. Trackpad pinch-to-zoom bypasses this and applies deltas directly (1:1 mapping) because the trackpad already provides smooth continuous input.

6. **Builds a unified `GestureStateMachine`** that coordinates all input sources and prevents conflicts. The state machine has clear priority rules: pointer events (mouse drag) always preempt wheel events, zoom animation is retargetable by new wheel input, and snap-back animation is interruptible by any user gesture.

Phase 6 does **not** add touch-screen support, rotation gestures, or Force Touch integration. See Section 15 for rationale.

---

## 2. The dual-position camera model: logical state vs. elastic offset

### Why the `_isDragging` toggle approach needs to change

Phase 3's design is elegant for the single case it handles: mouse drag. The `_isDragging` flag toggles `_applyConstraints()` between two modes, and the mousedown/mouseup lifecycle provides clean entry and exit points. But extending this to trackpad scroll, keyboard pan, inertial momentum, and smooth zoom creates a combinatorial explosion of flag states. Each new input source would need its own flag (`_isScrolling`, `_isMomentum`, `_isInertialCoasting`), and `_applyConstraints()` would need to check all of them to decide which clamping mode to use.

The dual-position model eliminates this complexity. The logical camera state (`camera.x`, `camera.y`) is always hard-clamped. Period. No modes, no flags, no branching in the constraint pipeline. When any gesture pushes the camera past a boundary, the overflow goes into `elasticOffsetX`/`elasticOffsetY` instead of being silently eaten by the hard clamp. The elastic offset is a separate visual-only property that the renderer adds when compositing the transform, and the animation system manages its lifecycle (rubber-band during gesture, spring to zero on release).

### The new camera properties

Add these to the Camera constructor in `vtt/js/map-camera.js`, after the existing Phase 3 constraint state properties:

```javascript
// Phase 6: dual-position elastic offset
this.elasticOffsetX = 0;    // visual displacement beyond hard bounds (screen pixels)
this.elasticOffsetY = 0;    // visual displacement beyond hard bounds (screen pixels)
this._gestureActive = false; // true when any gesture is feeding elastic offset
```

### The new `visualX` and `visualY` getters

These replace direct `camera.x` / `camera.y` reads in the renderer:

```javascript
/**
 * The visual camera position, including elastic overscroll offset.
 *
 * The renderer uses these for drawing. BroadcastChannel sync uses
 * the raw camera.x / camera.y (logical position, always within bounds).
 *
 * The elastic offset is in world-space units, matching camera.x/y.
 * Conversion from screen-space to world-space happens at the point
 * where overflow is computed (in _feedElasticOverflow), not here.
 */
get visualX() { return this.x + this.elasticOffsetX; }
get visualY() { return this.y + this.elasticOffsetY; }
```

### How `_applyConstraints()` changes

The critical refactor. `_applyConstraints()` no longer branches on `_isDragging`. It always hard-clamps:

```javascript
// OLD (Phase 3):
_applyConstraints() {
  const prevX = this.x;
  const prevY = this.y;
  const prevZoom = this.zoom;

  // 1. Zoom bounds
  const effectiveMinZoom = this._getMinZoom();
  this.zoom = Math.max(effectiveMinZoom, Math.min(MAX_ZOOM, this.zoom));

  // 2. Pan boundaries
  if (this.mapW <= 0 || this.mapH <= 0) {
    // skip
  } else if (this._isDragging) {
    this._applyElasticBounds();
  } else {
    this._applyHardBounds();
  }

  // 3. Emit if changed
  if (this.x !== prevX || this.y !== prevY || this.zoom !== prevZoom) {
    EventBus.emit('camera:changed');
  }
}

// NEW (Phase 6):
_applyConstraints() {
  const prevX = this.x;
  const prevY = this.y;
  const prevZoom = this.zoom;

  // 1. Zoom bounds (unchanged)
  const effectiveMinZoom = this._getMinZoom();
  this.zoom = Math.max(effectiveMinZoom, Math.min(MAX_ZOOM, this.zoom));

  // 2. Pan boundaries: ALWAYS hard clamp.
  // Elastic offset is managed separately by _feedElasticOverflow().
  if (this.mapW > 0 && this.mapH > 0) {
    this._applyHardBounds();
  }

  // 3. Emit if changed (check elastic offset too for visual updates)
  if (this.x !== prevX || this.y !== prevY || this.zoom !== prevZoom
      || this.elasticOffsetX !== 0 || this.elasticOffsetY !== 0) {
    EventBus.emit('camera:changed');
  }
}
```

### The new `_feedElasticOverflow()` method

This is the entry point for elastic offset from any input source. It replaces `_applyElasticBounds()`:

```javascript
/**
 * Feed overflow (distance past hard bounds) into the elastic offset.
 *
 * Called by input handlers when the camera is at a boundary and the
 * user is still pushing. The overflow is rubber-banded so that each
 * additional pixel of push produces diminishing visual displacement.
 *
 * The rubber-band formula operates in screen-space pixels (consistent
 * resistance feel regardless of zoom level), then converts back to
 * world-space for the elastic offset.
 *
 * @param {number} overflowX - World-space overflow on X axis (positive = past right, negative = past left)
 * @param {number} overflowY - World-space overflow on Y axis (positive = past bottom, negative = past top)
 */
_feedElasticOverflow(overflowX, overflowY) {
  if (!this._gestureActive) return;

  if (overflowX !== 0) {
    // Convert to screen pixels, rubber-band, convert back
    const screenOverflow = overflowX * this.zoom;
    const dampened = rubberBand(Math.abs(screenOverflow), this.viewportW);
    this.elasticOffsetX = Math.sign(overflowX) * dampened / this.zoom;
  }

  if (overflowY !== 0) {
    const screenOverflow = overflowY * this.zoom;
    const dampened = rubberBand(Math.abs(screenOverflow), this.viewportH);
    this.elasticOffsetY = Math.sign(overflowY) * dampened / this.zoom;
  }
}
```

### The refactored `panBy()` with overflow detection

```javascript
// OLD (Phase 3/5):
panBy(dx, dy) {
  this.x -= dx / this.zoom;
  this.y -= dy / this.zoom;
  this._applyConstraints();
}

// NEW (Phase 6):
panBy(dx, dy) {
  const rawX = this.x - dx / this.zoom;
  const rawY = this.y - dy / this.zoom;

  // Store unclamped position, then let _applyConstraints() hard-clamp
  this.x = rawX;
  this.y = rawY;
  this._applyConstraints();

  // Compute overflow: the difference between where we wanted to be
  // and where hard clamping put us.
  const overflowX = rawX - this.x;
  const overflowY = rawY - this.y;

  if ((overflowX !== 0 || overflowY !== 0) && this._gestureActive) {
    this._feedElasticOverflow(overflowX, overflowY);
    // Re-emit since elastic offset changed after _applyConstraints
    EventBus.emit('camera:changed');
  }
}
```

Wait: there is a subtlety here. The overflow from a single `panBy()` call is the overflow from *that single delta*, but the elastic offset should represent the *accumulated* overflow from the entire gesture. Consider: the user scrolls 10px past the boundary, then scrolls another 5px. The elastic offset should reflect 15px of total overflow, not 5px.

The fix is to track the cumulative overflow separately and feed the *total* through `rubberBand()`:

```javascript
// Phase 6: cumulative overflow tracking
this._cumulativeOverflowX = 0;  // Add to Camera constructor
this._cumulativeOverflowY = 0;

panBy(dx, dy) {
  const rawX = this.x - dx / this.zoom;
  const rawY = this.y - dy / this.zoom;

  this.x = rawX;
  this.y = rawY;
  this._applyConstraints();

  const overflowX = rawX - this.x;
  const overflowY = rawY - this.y;

  if (this._gestureActive) {
    // Accumulate overflow. Reset when direction reverses or
    // when the camera is no longer at the boundary.
    if (overflowX !== 0) {
      // If direction matches, accumulate. If reversed, reset.
      if (Math.sign(overflowX) === Math.sign(this._cumulativeOverflowX) || this._cumulativeOverflowX === 0) {
        this._cumulativeOverflowX += overflowX;
      } else {
        this._cumulativeOverflowX = overflowX;
      }
    } else {
      // No overflow on this axis: camera moved within bounds.
      // Decay the cumulative overflow toward zero.
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

### Updating the renderer

In `MapRenderer` (or wherever the canvas transform is applied), replace direct `camera.x` / `camera.y` reads with the visual getters:

```javascript
// OLD:
ctx.setTransform(camera.zoom, 0, 0, camera.zoom, -camera.x * camera.zoom, -camera.y * camera.zoom);

// NEW:
ctx.setTransform(camera.zoom, 0, 0, camera.zoom, -camera.visualX * camera.zoom, -camera.visualY * camera.zoom);
```

This is the only rendering change. Every canvas layer that uses the camera transform needs this substitution.

### Resetting elastic state

When a gesture ends, the elastic offset needs to spring back to zero:

```javascript
/**
 * Trigger the spring snap-back from the current elastic offset to zero.
 *
 * Called when a gesture ends (mouse drag release, trackpad gesture end,
 * inertial pan hitting boundary). Captures the current elastic offset
 * as the spring's initial displacement and optionally accepts initial
 * velocity for seamless momentum-to-spring transitions.
 *
 * @param {{ vx: number, vy: number }} velocity - Initial velocity in world-space px/s
 */
_snapBackElastic(velocity = { vx: 0, vy: 0 }) {
  if (Math.abs(this.elasticOffsetX) < 0.5 && Math.abs(this.elasticOffsetY) < 0.5) {
    this.elasticOffsetX = 0;
    this.elasticOffsetY = 0;
    this._cumulativeOverflowX = 0;
    this._cumulativeOverflowY = 0;
    EventBus.emit('camera:changed');
    return;
  }

  // The spring animates elasticOffsetX/Y from current value to 0.
  // Use the momentum-tuned spring (stiffness 400) for snappier snap-back.
  this._elasticAnimator.snapBack(
    { x: this.elasticOffsetX, y: this.elasticOffsetY },
    { x: 0, y: 0 },
    velocity
  );
}
```

The `_elasticAnimator` is a second `CameraAnimator` instance dedicated to elastic offset animation, distinct from the existing `_animator` which handles logical camera position animation (flyTo, presets). This prevents elastic snap-back from conflicting with programmatic camera moves. Its `_tick()` method updates `this.elasticOffsetX`/`Y` and emits `camera:changed`, and on settle it zeroes out the cumulative overflow.

---

## 3. TrackpadGestureDetector: reconstructing gesture lifecycle from wheel events

### The problem in full

Browsers fire `wheel` events for four distinct input scenarios, and the VTT needs to distinguish them:

1. **Active two-finger trackpad scroll.** The user's fingers are on the trackpad. Events arrive at variable intervals (10-80ms gaps) with non-decaying delta magnitudes. This is the "gesture active" state.

2. **macOS momentum/inertial scroll.** The user's fingers have lifted. macOS synthesizes wheel events with monotonically decreasing delta magnitudes at a steady ~16ms cadence. This is the "momentum" state.

3. **Discrete mouse wheel notches.** A physical scroll wheel produces isolated events with large, consistent `deltaY` values (typically ±100 or ±120 in Chrome). These arrive in bursts separated by human-speed intervals (200ms+).

4. **Trackpad pinch-to-zoom.** Wheel events with `ctrlKey: true` and small `deltaY` values (0.2 to 5). Already handled by the existing zoom path.

No browser API distinguishes these cases. The W3C has two open proposals (uievents#56, uievents#58) for an `isInertialScrolling` flag, both open since 2015 with no implementations. Chrome's `scrollend` event (baseline since 2023) fires after momentum completes but only for actual scrollable elements with overflow, not for `preventDefault()`'d wheel events on a canvas.

### The delta decay heuristic

The key insight: macOS momentum events have a distinctive signature. After the user lifts their fingers, the OS generates synthetic wheel events with deltas that decrease monotonically at a near-constant rate. Active scrolling produces deltas that fluctuate based on finger movement speed. By tracking consecutive events where `|deltaY|` decreases, we can detect the active-to-momentum transition.

The threshold is three or more consecutive events where the absolute delta is less than 97% of the previous event's absolute delta, after a minimum of six total events in the gesture. The 97% factor (rather than strict less-than) absorbs noise from Firefox's delta quantization, where consecutive momentum events can have identical deltas for a few frames before decay becomes visible.

### The timeout heuristic

A timeout fires when no wheel event arrives within a configurable window. During ACTIVE scrolling, 150ms handles the worst case: a user scrolling very slowly with deliberate pauses between movements. During MOMENTUM, 100ms is sufficient because momentum events arrive at a steady ~16ms cadence, and a 100ms gap reliably indicates that macOS has stopped generating them.

### The `TrackpadGestureDetector` class

Create a new file `vtt/js/trackpad-gesture.js`:

```javascript
// ============================================
// Trackpad Gesture Detector
// ============================================
//
// Reconstructs the IDLE → ACTIVE → MOMENTUM → IDLE gesture lifecycle
// from raw WheelEvent streams. No standard browser API exposes this
// information (W3C uievents#58 has been open since 2015 with zero
// implementations), so we use two complementary heuristics:
//
//   1. Delta decay detection: momentum events have monotonically
//      decreasing delta magnitudes. Three consecutive decays after
//      six+ total events signals the ACTIVE → MOMENTUM transition.
//
//   2. Timeout debounce: no wheel event within N ms triggers the
//      end-of-gesture transition. N varies by state: 150ms for
//      ACTIVE (slow deliberate scrolling can have 50-80ms gaps),
//      100ms for MOMENTUM (steady ~16ms cadence means a 100ms gap
//      is definitive).
//
// The detector also distinguishes discrete mouse wheel input from
// trackpad scroll. Mouse wheels produce large integer deltas (100+)
// at irregular intervals. Trackpad scroll produces small fractional
// deltas at high frequency. This distinction drives whether smooth
// zoom animation or direct 1:1 mapping is used for zoom input.
//
// References:
//   - wheel-gestures library (npm: wheel-gestures, 174K weekly downloads)
//   - lethargy library (npm: lethargy, delta decay analysis)
//   - Mapbox GL JS scroll_zoom.js (mouse vs. trackpad detection)

/**
 * @typedef {'IDLE' | 'ACTIVE' | 'MOMENTUM'} GestureState
 */

/**
 * @typedef {Object} GestureCallbacks
 * @property {function(WheelEvent): void} [onGestureStart] - First event of a new gesture
 * @property {function(WheelEvent, GestureState): void} [onGestureMove] - Every event during a gesture
 * @property {function(): void} [onMomentumStart] - Transition from active to momentum
 * @property {function(): void} [onGestureEnd] - Gesture fully complete (no more events)
 */

// How many consecutive decaying deltas signal momentum onset
const DECAY_STREAK_THRESHOLD = 3;

// Minimum events before momentum detection is eligible.
// Prevents false positives from a single slow scroll gesture
// whose first few events happen to decrease.
const MIN_EVENTS_FOR_MOMENTUM = 6;

// Ratio threshold: current delta must be < previous * DECAY_RATIO
// to count as a decay. 0.97 absorbs Firefox's delta quantization
// noise where consecutive momentum events sometimes report identical
// deltas for 1-2 frames before the decay pattern becomes visible.
const DECAY_RATIO = 0.97;

// Timeout (ms) to declare gesture end. ACTIVE state uses a longer
// timeout because slow deliberate scrolling can have 50-80ms gaps.
// MOMENTUM state uses a shorter timeout because macOS momentum
// events arrive at a steady ~16ms cadence.
const TIMEOUT_ACTIVE_MS = 150;
const TIMEOUT_MOMENTUM_MS = 100;

// Delta spike factor: if a new event's delta exceeds the previous
// by this factor during MOMENTUM, it signals a new active gesture
// interrupting the momentum (user put fingers back on trackpad).
const MOMENTUM_CANCEL_SPIKE = 1.5;

// Gap (ms) that signals a new gesture during MOMENTUM state.
// If >120ms elapses between events during momentum, the next event
// is treated as a fresh gesture start rather than continued momentum.
const MOMENTUM_CANCEL_GAP_MS = 120;

export class TrackpadGestureDetector {
  /**
   * @param {GestureCallbacks} callbacks
   */
  constructor(callbacks = {}) {
    this._callbacks = callbacks;

    /** @type {GestureState} */
    this.state = 'IDLE';

    this._endTimer = null;
    this._lastAbsDelta = 0;
    this._decayStreak = 0;
    this._eventCount = 0;
    this._lastEventTime = 0;
  }

  /**
   * Feed a wheel event into the detector.
   *
   * Call this from the wheel event handler BEFORE processing the
   * event's pan/zoom deltas. The detector updates its state and
   * fires the appropriate callback synchronously.
   *
   * @param {WheelEvent} e
   */
  handleWheel(e) {
    const now = performance.now();
    const absDelta = Math.abs(e.deltaY) + Math.abs(e.deltaX);
    const timeSinceLast = now - this._lastEventTime;

    clearTimeout(this._endTimer);

    // --- State transitions ---

    if (this.state === 'IDLE') {
      // Any wheel event in IDLE starts a new gesture.
      this.state = 'ACTIVE';
      this._decayStreak = 0;
      this._eventCount = 0;
      this._callbacks.onGestureStart?.(e);

    } else if (this.state === 'MOMENTUM') {
      // During momentum, detect whether this event is continued
      // momentum or a new active gesture interrupting it.
      const isSpikeUp = absDelta > this._lastAbsDelta * MOMENTUM_CANCEL_SPIKE;
      const isLargeGap = timeSinceLast > MOMENTUM_CANCEL_GAP_MS;

      if (isSpikeUp || isLargeGap) {
        // New active gesture. Reset tracking.
        this.state = 'ACTIVE';
        this._decayStreak = 0;
        this._eventCount = 0;
        this._callbacks.onGestureStart?.(e);
      }
    }

    // --- Decay tracking (only meaningful in ACTIVE state) ---

    if (this.state === 'ACTIVE') {
      this._eventCount++;

      if (absDelta > 0 && this._lastAbsDelta > 0 && absDelta < this._lastAbsDelta * DECAY_RATIO) {
        this._decayStreak++;
      } else {
        this._decayStreak = 0;
      }

      // Sustained decay after enough samples means momentum
      if (this._decayStreak >= DECAY_STREAK_THRESHOLD && this._eventCount > MIN_EVENTS_FOR_MOMENTUM) {
        this.state = 'MOMENTUM';
        this._callbacks.onMomentumStart?.();
      }
    }

    // --- Always fire the move callback ---
    this._callbacks.onGestureMove?.(e, this.state);

    // --- Update tracking state ---
    this._lastAbsDelta = absDelta;
    this._lastEventTime = now;

    // --- Schedule the end-of-gesture timeout ---
    const timeout = this.state === 'MOMENTUM' ? TIMEOUT_MOMENTUM_MS : TIMEOUT_ACTIVE_MS;
    this._endTimer = setTimeout(() => {
      this.state = 'IDLE';
      this._decayStreak = 0;
      this._eventCount = 0;
      this._lastAbsDelta = 0;
      this._callbacks.onGestureEnd?.();
    }, timeout);
  }

  /**
   * Immediately end the current gesture.
   * Used when a higher-priority gesture (mouse drag) preempts scroll.
   */
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

  /**
   * Whether the detector is in a state where elastic overscroll
   * should be active (fingers on trackpad or early momentum).
   */
  get isGestureActive() {
    return this.state === 'ACTIVE' || this.state === 'MOMENTUM';
  }

  destroy() {
    clearTimeout(this._endTimer);
  }
}
```

### Mouse-vs-trackpad detection

The existing `normalizeWheel()` does not distinguish mouse from trackpad. Phase 6 adds a utility function in the same file:

```javascript
/**
 * Heuristic to classify a wheel event as mouse or trackpad.
 *
 * Mouse scroll wheels produce large, integer deltaY values (typically
 * 100 or 120 in Chrome, corresponding to the 120-unit wheel tick).
 * Trackpad scroll produces small, often fractional values at high
 * frequency. This matches the heuristic used by Mapbox GL JS.
 *
 * This classification is imperfect. A high-resolution mouse (like
 * a Logitech MX Master in "free spin" mode) can produce small
 * fractional deltas that look like trackpad input. But for the
 * purpose of choosing between smooth zoom animation (mouse) and
 * direct 1:1 mapping (trackpad), the false positive (treating a
 * free-spin mouse like a trackpad) produces acceptable results.
 *
 * @param {WheelEvent} e
 * @returns {'mouse' | 'trackpad'}
 */
export function classifyWheelDevice(e) {
  const absY = Math.abs(e.deltaY);
  const absX = Math.abs(e.deltaX);
  const maxDelta = Math.max(absY, absX);

  // Discrete mouse wheel: large integer deltas, typically >=50
  // Trackpad: small or fractional deltas
  if (maxDelta >= 50 && maxDelta % 1 === 0 && e.deltaX === 0) {
    return 'mouse';
  }
  return 'trackpad';
}
```

---

## 4. Elastic overscroll for trackpad scroll panning

### Wiring the gesture detector into the wheel handler

The wheel handler in `attachTo()` needs to route through the gesture detector before processing deltas. The detector's state determines whether `panBy()` should feed overflow into the elastic offset.

Replace the current wheel event listener in `attachTo()` inside `vtt/js/map-camera.js`:

```javascript
// In attachTo(el), replace the wheel listener.
// OLD (Phase 2/3):
this._attachWheelHandler = () => {
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
};

// NEW (Phase 6):
this._attachWheelHandler = () => {
  // The gesture detector reconstructs trackpad lifecycle.
  // It fires callbacks that set _gestureActive on the camera,
  // which controls whether panBy() feeds overflow into elastic offset.
  this._trackpadDetector = new TrackpadGestureDetector({
    onGestureStart: () => {
      this._gestureActive = true;
      this._cumulativeOverflowX = 0;
      this._cumulativeOverflowY = 0;
      // Cancel any in-progress elastic snap-back. The user has
      // started a new scroll gesture, possibly interrupting a
      // previous snap-back animation.
      this._elasticAnimator.cancel();
    },
    onMomentumStart: () => {
      // Momentum continues feeding elastic offset, but with
      // dampened coefficient. See Section 5.
      this._momentumActive = true;
    },
    onGestureEnd: () => {
      this._gestureActive = false;
      this._momentumActive = false;
      this._snapBackElastic();
    }
  });

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { dx, dy, dz } = normalizeWheel(e);

    if (dz !== 0) {
      // Zoom: detect device type for smooth vs. direct zoom
      const device = classifyWheelDevice(e);
      const screen = this.eventToScreen(e);

      if (device === 'mouse') {
        // Smooth animated zoom (Section 7)
        this._smoothZoom.onWheelZoom(dz, screen.x, screen.y);
      } else {
        // Trackpad pinch: direct 1:1 zoom (existing behavior)
        this.zoomAt(screen.x, screen.y, dz * -ZOOM_SENSITIVITY);
      }
    } else if (dx !== 0 || dy !== 0) {
      // Pan: run through gesture detector first
      this._trackpadDetector.handleWheel(e);
      this.panBy(-dx, -dy);
    }
  }, { passive: false });
};
```

### The elastic offset during active scroll

When `_gestureActive` is true, the refactored `panBy()` from Section 2 detects overflow (the difference between the raw position and the hard-clamped position) and feeds it into `_feedElasticOverflow()`. This produces the rubber-band effect: the map visually stretches past the boundary with increasing resistance, exactly matching the feel of mouse drag overscroll.

### Edge case: scroll direction reversal at boundary

Consider: the user scrolls right until they hit the right boundary, building up elastic offset. Then they reverse direction and scroll left. The first leftward scroll event should begin pulling the elastic offset back toward zero before the camera starts moving left in the valid range. This happens naturally with the cumulative overflow tracking: leftward overflow has the opposite sign, so `_cumulativeOverflowX` decreases, the rubber-band output decreases, and the elastic offset shrinks. When `_cumulativeOverflowX` crosses zero, the camera is back within bounds and normal panning resumes.

### Edge case: zoom while elastically overscrolled

If the user pinch-zooms while the elastic offset is nonzero, the zoom change alters the valid bounds (different zoom means different `visW`/`visH`). The elastic offset must be recalculated against the new bounds. Handle this in `zoomAt()`:

```javascript
// At the end of the existing zoomAt() method, after _applyConstraints():
if (this.elasticOffsetX !== 0 || this.elasticOffsetY !== 0) {
  // Recalculate elastic offset with new zoom-derived bounds.
  // The cumulative overflow is still valid (it's in world-space
  // relative to the boundary), but the rubber-band output changes
  // because viewportW/H are different in world-space terms at the
  // new zoom level.
  this._feedElasticOverflow(this._cumulativeOverflowX, this._cumulativeOverflowY);
  EventBus.emit('camera:changed');
}
```

---

## 5. Momentum handling: OS-driven vs. app-driven deceleration

### The design decision: rely on macOS momentum events

For trackpad scroll panning, macOS generates synthetic wheel events after the user lifts their fingers. These events have decaying deltas that are tuned to the user's system preferences (the "Use inertia when scrolling" checkbox in System Preferences, natural vs. traditional scroll direction, and per-trackpad sensitivity settings). Reimplementing this deceleration in JavaScript would discard those preferences and feel wrong to every macOS user who has customized their trackpad behavior.

The recommendation is to **process macOS momentum events the same as active scroll events for panning**, but with one modification: **dampen the rubber-band coefficient during momentum** to prevent high-velocity flings from producing excessive elastic overscroll.

### Dampened rubber-band during momentum

During ACTIVE scroll, the rubber-band uses Apple's canonical `c = 0.55` coefficient. During MOMENTUM, reduce it to `c = 0.3`. This means each pixel of momentum overdrag produces roughly half as much visual displacement as active overdrag, preventing a fast fling from pulling the map far past the boundary.

Modify `_feedElasticOverflow()` to accept a coefficient parameter:

```javascript
_feedElasticOverflow(overflowX, overflowY) {
  if (!this._gestureActive) return;

  // Dampen rubber-band during momentum to prevent excessive
  // overscroll from high-velocity flings.
  const c = this._momentumActive ? 0.3 : 0.55;

  if (overflowX !== 0) {
    const screenOverflow = overflowX * this.zoom;
    const dampened = rubberBand(Math.abs(screenOverflow), this.viewportW, c);
    this.elasticOffsetX = Math.sign(overflowX) * dampened / this.zoom;
  }

  if (overflowY !== 0) {
    const screenOverflow = overflowY * this.zoom;
    const dampened = rubberBand(Math.abs(screenOverflow), this.viewportH, c);
    this.elasticOffsetY = Math.sign(overflowY) * dampened / this.zoom;
  }
}
```

### How Apple's UIScrollView handles this

Apple's UIScrollView allows momentum to push content past boundaries, then uses a critically damped spring for the snap-back. The key detail (confirmed by reverse-engineering in Ilya Lobanov's analysis): the spring's initial velocity matches the momentum velocity at the exact moment of boundary contact, creating a seamless visual transition. There is no visual discontinuity between the last momentum frame and the first spring frame.

In the VTT implementation, this velocity continuity is approximated rather than exact. The `onGestureEnd` callback fires when the timeout expires (100ms after the last momentum event), at which point the momentum velocity has already decayed to near-zero. The spring starts with zero initial velocity, which is acceptable because the elastic offset at that point is small (dampened by `c = 0.3`). For a perfect velocity match, you would need to capture the velocity from the last few momentum events and pass it to `_snapBackElastic()`, which the Phase 3 `CameraAnimator.snapBack()` already accepts:

```javascript
// In the gesture detector's onGestureEnd callback:
onGestureEnd: () => {
  this._gestureActive = false;
  this._momentumActive = false;
  // Pass release velocity for smoother spring onset.
  // If the last few events were momentum, velocity is near-zero
  // and this is effectively a zero-velocity snap-back anyway.
  const velocity = this._scrollVelocityTracker.getVelocity();
  this._snapBackElastic({
    vx: velocity.x / this.zoom,  // Convert screen px/s to world px/s
    vy: velocity.y / this.zoom
  });
}
```

The `_scrollVelocityTracker` is introduced in Section 6.

### Why not cut off momentum events at the boundary?

An alternative approach: when the camera reaches a boundary during momentum, stop processing further momentum events and immediately trigger the snap-back. This would prevent any elastic overscroll during momentum.

This feels wrong on macOS. The user expects momentum to carry content past boundaries, creating a brief bounce. Every native macOS scroll view does this. Cutting it off produces a jarring hard stop at the boundary during what should be a flowing deceleration, and the user cannot tell whether the hard stop was because momentum ran out or because a boundary was hit. The rubber-banded overscroll communicates "you've reached the edge" through physics rather than an abrupt stop, which is the same design principle that motivated elastic overscroll for mouse drag in Phase 3.

---

## 6. Inertial panning for mouse drag release

### The velocity tracker

On mouse drag release, if the user was moving quickly, the camera should continue coasting with deceleration rather than stopping dead. This requires tracking the mouse velocity during the last ~100ms of the drag.

Position samples (not frame-to-frame deltas) produce the most stable velocity estimate. Frame-to-frame deltas are noisy because they depend on mouse event frequency, which varies with browser, OS, and system load. A rolling window of position/time pairs, evaluated as a simple slope over the window, absorbs this noise.

Add a `VelocityTracker` class to `vtt/js/map-camera.js` (or a new file if you prefer, but the class is small enough to colocate):

```javascript
// ============================================
// Velocity Tracker
// ============================================
//
// Tracks mouse position samples over a rolling window and computes
// instantaneous velocity on demand. Uses position samples (not deltas)
// because mouse event frequency is irregular, making delta-based
// velocity noisy.
//
// The window is 100ms: short enough to reflect the user's intention
// at release time, long enough to average out per-event jitter.

const VELOCITY_WINDOW_MS = 100;

class VelocityTracker {
  constructor() {
    /** @type {Array<{ x: number, y: number, t: number }>} */
    this._samples = [];
  }

  /**
   * Record a position sample.
   *
   * @param {number} x - Screen-space X position
   * @param {number} y - Screen-space Y position
   */
  addSample(x, y) {
    const now = performance.now();
    this._samples.push({ x, y, t: now });
    // Trim old samples
    while (this._samples.length > 1 && now - this._samples[0].t > VELOCITY_WINDOW_MS) {
      this._samples.shift();
    }
  }

  /**
   * Compute velocity from the sample window.
   *
   * @returns {{ x: number, y: number }} Velocity in screen pixels per second
   */
  getVelocity() {
    if (this._samples.length < 2) return { x: 0, y: 0 };
    const first = this._samples[0];
    const last = this._samples[this._samples.length - 1];
    const dt = (last.t - first.t) / 1000; // seconds
    if (dt < 0.005) return { x: 0, y: 0 }; // < 5ms window, unreliable
    return {
      x: (last.x - first.x) / dt,
      y: (last.y - first.y) / dt
    };
  }

  reset() {
    this._samples.length = 0;
  }
}
```

### Feeding samples during mouse drag

In the existing mousemove handler inside `attachTo()`, add velocity tracking:

```javascript
// In the mousemove handler, after computing the pan delta:
// (this code path only executes when this._panning is true)

// Phase 6: track mouse position for release velocity
this._dragVelocityTracker.addSample(e.clientX, e.clientY);
```

Initialize the tracker in the Camera constructor:

```javascript
this._dragVelocityTracker = new VelocityTracker();
```

### The inertial coast animation

On mouseup, after the existing `_isDragging = false` and snap-back logic, check velocity and optionally start an inertial coast:

```javascript
// In _endPan() or the mouseup handler, after setting _isDragging = false:

const velocity = this._dragVelocityTracker.getVelocity();
this._dragVelocityTracker.reset();

const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
const INERTIA_THRESHOLD = 100; // px/s: minimum speed to trigger coast

if (speed > INERTIA_THRESHOLD) {
  this._startInertialCoast(velocity);
} else {
  // No inertia: just snap back elastic offset if any
  this._gestureActive = false;
  this._snapBackElastic();
}
```

The inertial coast animation uses exponential friction. Each frame multiplies velocity by a friction factor:

```javascript
/**
 * Start an inertial coast animation after mouse drag release.
 *
 * Uses exponential friction: v(n+1) = v(n) * FRICTION per frame.
 * At 60fps with FRICTION=0.96, velocity halves every ~17 frames
 * (~280ms), producing a coast duration of roughly 400-600ms for
 * typical release speeds.
 *
 * If the coast carries the camera past a boundary, the elastic
 * offset absorbs the overflow. When velocity drops below the
 * threshold, the coast stops and the spring snap-back fires.
 *
 * @param {{ x: number, y: number }} velocity - Release velocity in screen px/s
 */
_startInertialCoast(velocity) {
  // Keep _gestureActive true during coast so panBy() feeds elastic offset
  this._gestureActive = true;
  let vx = velocity.x;
  let vy = velocity.y;
  let lastTime = performance.now();

  const FRICTION = 0.96;           // Per-frame multiplier at 60fps
  const STOP_THRESHOLD = 10;       // px/s: stop the coast
  const MAX_DT = 64;               // ms: cap dt to prevent huge jumps after tab switch

  const tick = (timestamp) => {
    const rawDt = timestamp - lastTime;
    const dt = Math.min(rawDt, MAX_DT) / 1000; // seconds, capped
    lastTime = timestamp;

    // Apply friction (frame-rate independent via exponentiation)
    const frictionFactor = Math.pow(FRICTION, rawDt / 16.67);
    vx *= frictionFactor;
    vy *= frictionFactor;

    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed < STOP_THRESHOLD) {
      // Coast complete. Trigger snap-back with remaining velocity.
      this._gestureActive = false;
      this._inertiaRafId = null;
      this._snapBackElastic({
        vx: vx / this.zoom,
        vy: vy / this.zoom
      });
      return;
    }

    // Apply velocity as a pan delta (screen-space)
    // panBy() expects "drag direction" (positive dx = viewport moves left),
    // but velocity is in "natural" direction. Negate to match panBy convention.
    this.panBy(-vx * dt, -vy * dt);

    this._inertiaRafId = requestAnimationFrame(tick);
  };

  this._inertiaRafId = requestAnimationFrame(tick);
}

/**
 * Cancel in-progress inertial coast.
 * Called when a new gesture starts, preempting the coast.
 */
_cancelInertialCoast() {
  if (this._inertiaRafId) {
    cancelAnimationFrame(this._inertiaRafId);
    this._inertiaRafId = null;
    this._gestureActive = false;
  }
}
```

### Boundary collision during coast

When the inertial coast carries the camera to a boundary, `panBy()` hard-clamps the logical position and feeds the overflow into the elastic offset (because `_gestureActive` is true). The rubber-band resistance decelerates the visual displacement faster than the velocity decays, so the elastic offset grows slowly even during fast coasts. When the coast stops, `_snapBackElastic()` fires with the remaining velocity, creating the seamless momentum-to-spring transition described in Section 5.

### Integration with `_startPan()` and `_cancelPan()`

Any new gesture must cancel an in-progress inertial coast. Update `_startPan()`:

```javascript
// In _startPan(), add at the top:
this._cancelInertialCoast();
this._elasticAnimator.cancel();
this._cumulativeOverflowX = 0;
this._cumulativeOverflowY = 0;
this.elasticOffsetX = 0;
this.elasticOffsetY = 0;
```

And the trackpad gesture detector's `onGestureStart` should also cancel the coast:

```javascript
onGestureStart: () => {
  this._cancelInertialCoast();
  this._gestureActive = true;
  this._cumulativeOverflowX = 0;
  this._cumulativeOverflowY = 0;
  this._elasticAnimator.cancel();
}
```

---

## 7. Smooth animated zoom for discrete mouse wheel input

### Why discrete zoom feels jarring

A physical mouse scroll wheel produces isolated events with large `deltaY` values (100-120 per notch in Chrome). The current handler converts each notch into an instantaneous exponential zoom step. This works, but each notch produces a visible jump because the zoom change happens in a single frame. Trackpad pinch-to-zoom does not have this problem because it produces dozens of small events per second, creating naturally smooth motion.

### The solution: target-based zoom animation

Instead of applying each wheel notch immediately, accumulate a target zoom level and chase it with exponential interpolation in log-space. Each new wheel event adjusts the target further, and the animation smoothly approaches it. Rapid scrolling naturally accelerates because the target gets further from the current value.

Create a `SmoothZoomAnimator` class. This can live in `vtt/js/map-camera.js` alongside the other camera internals, or in a new file:

```javascript
// ============================================
// Smooth Zoom Animator
// ============================================
//
// Converts jarring discrete mouse wheel zoom into smooth animated
// transitions. Each wheel notch sets a target zoom level, and an
// exponential lerp in log-space chases it. Rapid scrolling accumulates
// target, creating natural acceleration.
//
// The lerp in log-space ensures that zooming in and out feel
// symmetrical. In linear space, lerping between zoom 1.0 and 2.0
// covers twice the perceptual range as lerping between 2.0 and 4.0,
// even though both are the same multiplicative change. In log-space,
// log(1.0)→log(2.0) and log(2.0)→log(4.0) are equal distances.
//
// The cursor anchor is recalculated once per new wheel event, not
// per frame. This means the world point under the cursor at the
// time of scrolling stays under the cursor throughout the animation,
// matching the behavior of Figma and Google Maps.

const SMOOTH_ZOOM_LERP = 0.15;      // Per-frame lerp factor: 0.1=silky, 0.3=snappy
const SMOOTH_ZOOM_EPSILON = 0.001;   // Convergence threshold
const ZOOM_PER_NOTCH = 1.15;         // ~15% zoom per mouse wheel notch

class SmoothZoomAnimator {
  constructor(camera) {
    this._camera = camera;
    this._targetZoom = camera.zoom;
    this._animating = false;
    this._anchor = { wx: 0, wy: 0, sx: 0, sy: 0 };
    this._rafId = null;
    this._step = this._step.bind(this);
  }

  /**
   * Handle a discrete mouse wheel zoom event.
   *
   * Sets a new target zoom and starts (or continues) the animation.
   * The cursor anchor is captured once per event: the world-space
   * point under the cursor stays under the cursor during animation.
   *
   * @param {number} dz - Normalized zoom delta from normalizeWheel() (negative = zoom in)
   * @param {number} screenX - Cursor screen X
   * @param {number} screenY - Cursor screen Y
   */
  onWheelZoom(dz, screenX, screenY) {
    // Compute new target. Each notch multiplies by ZOOM_PER_NOTCH.
    // dz is ~1.0 per mouse notch (negative = zoom in from normalizeWheel).
    // We negate dz here because scroll-up (negative deltaY) should zoom in.
    const direction = dz < 0 ? 1 : -1;
    const factor = Math.pow(ZOOM_PER_NOTCH, Math.abs(dz) * direction);
    const minZoom = this._camera._getMinZoom();
    this._targetZoom = Math.max(minZoom, Math.min(MAX_ZOOM, this._targetZoom * factor));

    // Capture anchor: world point under cursor at time of scroll.
    // This is computed once per wheel event, not per animation frame.
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

    // Apply zoom with cursor anchor preservation.
    // The anchor formula: camera.x = (anchorSx / zoom) - anchorWx
    // But we need to express this in the existing Camera coordinate system
    // where camera.x is the world-space X of the viewport's top-left corner.
    //
    // worldToScreen: sx = (wx - camera.x) * zoom
    // Solving for camera.x: camera.x = wx - sx / zoom
    //
    // To keep the same world point (wx, wy) at the same screen position
    // (sx, sy) when zoom changes:
    //   new_camera.x = wx - sx / newZoom
    cam.zoom = newZoom;
    cam.x = this._anchor.wx - this._anchor.sx / newZoom;
    cam.y = this._anchor.wy - this._anchor.sy / newZoom;
    cam._applyConstraints();

    if (Math.abs(logNew - logTarget) > SMOOTH_ZOOM_EPSILON) {
      this._rafId = requestAnimationFrame(this._step);
    } else {
      // Converged. Snap to exact target.
      cam.zoom = this._targetZoom;
      cam.x = this._anchor.wx - this._anchor.sx / this._targetZoom;
      cam.y = this._anchor.wy - this._anchor.sy / this._targetZoom;
      cam._applyConstraints();
      this._animating = false;
      this._rafId = null;
    }
  }

  /**
   * Retarget to the current camera zoom.
   * Called when an external zoom change (pinch, keyboard) should
   * reset the smooth animator's target.
   */
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

### Trackpad pinch-to-zoom bypasses smooth animation

Trackpad pinch already produces dozens of small events per second. Running these through the smooth animator would add latency (the lerp factor means the actual zoom always lags the target). Trackpad pinch must be direct and immediate, exactly as it is today. The `classifyWheelDevice()` function from Section 3 determines which path to take.

### Keyboard zoom should also bypass smooth animation

The existing `KeyboardController` calls `camera.zoomToCenter()` directly. This should continue to work without smooth animation because the keyboard system already runs its own rAF loop with per-frame deltas, producing smooth motion. Add a `retarget()` call to the keyboard zoom handler to keep the smooth animator's target in sync:

```javascript
// In KeyboardController._tick(), after the existing zoom handling:
if (this._keys['+'] || this._keys['='] || this._keys['-']) {
  // ... existing zoom logic ...
  this._camera._smoothZoom?.retarget();
}
```

---

## 8. Refactoring mouse drag to use the dual-position model

### What changes

Phase 3's mouse drag overscroll works by setting `_isDragging = true`, which causes `_applyConstraints()` to call `_applyElasticBounds()` instead of `_applyHardBounds()`. In Phase 6, `_applyConstraints()` always hard-clamps, so mouse drag must use the same overflow-to-elastic-offset mechanism as trackpad scroll.

The key change: `_startPan()` sets `_gestureActive = true` (the same flag that trackpad scroll uses), and `_endPan()` sets `_gestureActive = false` and triggers `_snapBackElastic()`. The existing `_isDragging` flag can be removed or repurposed as a pure gesture-type indicator (to distinguish "is this pan from a mouse drag" from "is this pan from trackpad scroll" for velocity tracking purposes).

### Updated `_startPan()`

```javascript
_startPan(e, button) {
  this._cancelInertialCoast();
  this._elasticAnimator.cancel();
  this._trackpadDetector?.cancel(); // Preempt any active scroll gesture

  this._panning = true;
  this._pendingPan = false;
  this._panButton = button;
  this._panStartX = e.clientX;
  this._panStartY = e.clientY;
  this._panStartCamX = this.x;
  this._panStartCamY = this.y;
  this._panScreenDist = 0;

  // Phase 6: use dual-position elastic model
  this._gestureActive = true;
  this._cumulativeOverflowX = 0;
  this._cumulativeOverflowY = 0;
  this.elasticOffsetX = 0;
  this.elasticOffsetY = 0;

  // Phase 6: start velocity tracking for inertial release
  this._dragVelocityTracker.reset();

  this._setPanCursor(true);
}
```

### Updated mousemove handler

The mousemove handler that computes the pan delta during a drag now uses `panBy()` like everything else, rather than setting `this.x` and `this.y` directly. This is important because `panBy()` is where the overflow detection and elastic feeding live:

```javascript
// In the mousemove listener, when this._panning is true:

// OLD (Phase 3/5 - direct position set):
this.x = this._panStartCamX - dxScreen / (this.zoom * this.viewportScale);
this.y = this._panStartCamY - dyScreen / (this.zoom * this.viewportScale);
this._applyConstraints();

// NEW (Phase 6 - use panBy for overflow detection):
const targetX = this._panStartCamX - dxScreen / (this.zoom * this.viewportScale);
const targetY = this._panStartCamY - dyScreen / (this.zoom * this.viewportScale);
const dx = this.x - targetX;
const dy = this.y - targetY;

// panBy expects screen-space deltas; convert from world-space diff
this.panBy(dx * this.zoom, dy * this.zoom);

// Track velocity for inertial release
this._dragVelocityTracker.addSample(e.clientX, e.clientY);
```

Wait: there is a subtlety. The current mouse drag computes position relative to the drag start point (`_panStartCamX/Y`), not incrementally. This prevents floating-point drift over long drags. Converting to incremental `panBy()` calls would lose this property.

The fix is to compute the desired world-space position from the drag start, then call `panBy()` with the difference from the current position. But `panBy()` would then hard-clamp and compute overflow from a single-frame delta rather than from the total drag distance. To preserve the start-relative calculation while using the dual-position model, the mousemove handler should set `this.x`/`this.y` directly (as it does today), then compute overflow manually:

```javascript
// NEW (Phase 6 - preserves start-relative calculation):
const rawX = this._panStartCamX - dxScreen / (this.zoom * this.viewportScale);
const rawY = this._panStartCamY - dyScreen / (this.zoom * this.viewportScale);

this.x = rawX;
this.y = rawY;
this._applyConstraints(); // Hard-clamps this.x/this.y

// Compute overflow for elastic offset
const overflowX = rawX - this.x;
const overflowY = rawY - this.y;

if (this._gestureActive) {
  // For mouse drag, cumulative overflow is the total overflow from
  // the start point, not accumulated frame-by-frame.
  this._cumulativeOverflowX = overflowX;
  this._cumulativeOverflowY = overflowY;
  this._feedElasticOverflow(overflowX, overflowY);
}

// Track velocity
this._dragVelocityTracker.addSample(e.clientX, e.clientY);
```

This preserves the start-relative calculation (no floating-point drift) while feeding overflow into the elastic offset.

### Updated `_endPan()`

```javascript
_endPan() {
  if (!this._panning) return;
  this._panning = false;
  this._setPanCursor(false);

  // Phase 6: compute release velocity and potentially start inertial coast
  const velocity = this._dragVelocityTracker.getVelocity();
  this._dragVelocityTracker.reset();

  const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
  const INERTIA_THRESHOLD = 100; // px/s

  if (speed > INERTIA_THRESHOLD) {
    // Inertial coast. _gestureActive stays true during coast;
    // _startInertialCoast() handles snap-back when coast ends.
    this._startInertialCoast(velocity);
  } else {
    // No inertia: snap back immediately
    this._gestureActive = false;
    this._snapBackElastic();
  }
}
```

### Removing `_isDragging` and `_applyElasticBounds()`

With the dual-position model, these Phase 3 constructs are no longer needed:

1. **`_isDragging`**: Replaced by `_gestureActive`, which is set by both mouse drag and trackpad scroll. If you need to distinguish the gesture source for some future purpose, use a `_gestureSource` enum (`'drag'` | `'scroll'` | `'inertia'`) rather than a boolean.

2. **`_applyElasticBounds()`**: Dead code. The elastic offset is now computed in `_feedElasticOverflow()` based on overflow from the hard clamp, not by replacing the hard clamp.

3. **`_elasticClampAxis()`**: Dead code. The per-axis rubber-banding is handled inside `_feedElasticOverflow()` using the same `rubberBand()` function.

4. **`_triggerSnapBack()`**: Replaced by `_snapBackElastic()`, which operates on elastic offset rather than camera position.

Remove these methods and the `_isDragging` property. Update any test that references `_isDragging` to use `_gestureActive` instead.

---

## 9. The unified gesture state machine

### Why a state machine matters

Without coordination, input sources can conflict. Consider: the user starts a two-finger scroll, reaches a boundary (elastic offset building), then lifts one finger and pinches to zoom. The zoom gesture should not inherit the scroll gesture's elastic offset. Or: the user is scrolling, lifts fingers (momentum starts), then immediately clicks to drag. The mouse drag should preempt the momentum animation.

### The `GestureStateMachine` class

This class does not handle input directly. It receives notifications from the input handlers and coordinates the transitions:

```javascript
// ============================================
// Gesture State Machine
// ============================================
//
// Coordinates concurrent input gestures to prevent conflicts.
// Priority order (highest first):
//   1. Pointer drag (mouse right-click, left-click threshold, space+click)
//   2. Pinch zoom (trackpad ctrlKey wheel events)
//   3. Scroll pan (trackpad two-finger wheel events)
//   4. Discrete zoom animation (mouse wheel notches)
//   5. Inertial coast (mouse drag release momentum)
//   6. Elastic snap-back (spring animation to zero offset)
//
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

  /**
   * Request to start a gesture. Returns true if the gesture was
   * accepted, false if a higher-priority gesture is active.
   */
  request(gesture) {
    const newPriority = GESTURE_PRIORITY[gesture];
    const currentPriority = GESTURE_PRIORITY[this._activeGesture];

    if (newPriority >= currentPriority) {
      // Higher or equal priority: cancel current and accept new
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
        this._camera._elasticAnimator.cancel();
        break;
      case 'ZOOM_ANIMATE':
        this._camera._smoothZoom.cancel();
        break;
      case 'SCROLL_PAN':
        this._camera._trackpadDetector.cancel();
        break;
      // DRAG_PAN: not cancelable by lower-priority gestures
      // PINCH_ZOOM: handled by zoom path
    }
  }

  get current() { return this._activeGesture; }
}
```

### Wiring the state machine into input handlers

The gesture state machine is consulted at the start of each gesture and released at the end:

```javascript
// Mouse drag start:
_startPan(e, button) {
  this._gestures.request('DRAG_PAN'); // Always succeeds (highest priority)
  // ... rest of _startPan
}

// Mouse drag end:
_endPan() {
  this._gestures.release('DRAG_PAN');
  // If inertial coast starts, it calls this._gestures.request('INERTIA')
  // ... rest of _endPan
}

// Trackpad scroll (in wheel handler):
if (dx !== 0 || dy !== 0) {
  if (this._gestures.request('SCROLL_PAN')) {
    this._trackpadDetector.handleWheel(e);
    this.panBy(-dx, -dy);
  }
  // If request returns false, a higher-priority gesture is active.
  // The pan delta is silently dropped.
}

// Smooth zoom (in wheel handler):
if (device === 'mouse') {
  if (this._gestures.request('ZOOM_ANIMATE')) {
    this._smoothZoom.onWheelZoom(dz, screen.x, screen.y);
  }
}
```

---

## 10. BroadcastChannel sync implications

### What changes for sync

The dual-position model keeps sync simple. `camera.serialize()` continues to send logical `x/y/zoom`, which are always hard-clamped to valid bounds. The elastic offset is local-only and never broadcast. Display windows receiving sync state apply it through `deserialize()`, which routes through `_applyConstraints()`, producing valid positions without any elastic artifacts.

No protocol changes are needed. No new message types. The `localToShared()` and `sharedToLocal()` conversions from Phase 4 continue to work because they operate on the logical camera position.

### The inertial coast and smooth zoom on the Controller

The Controller operates in a background tab (the DM looks at the DM Guide). Phase 4 Lesson #1 established that `requestAnimationFrame` does not fire in background Chrome tabs. The inertial coast and smooth zoom both use rAF loops.

For the **Controller**, this is not a problem for two reasons:

1. The Controller does not have a visible map canvas. Camera button clicks call `sendImmediate()`, which bypasses rAF. The smooth zoom and inertial coast features are DM Guide and VTT Display features where the tab is in the foreground.

2. If a future use case requires inertial coast on the Controller, the `sendImmediate()` pattern from Phase 4 applies: call it explicitly after each programmatic camera mutation.

For the **DM Guide**, which has its own independent camera (not synced via BroadcastChannel), the inertial coast and smooth zoom work normally because the DM Guide tab is typically in the foreground.

### `sendImmediate()` during inertial coast

If the VTT Display window is driving the camera (Phase 5's bidirectional sync or a future "Display-as-controller" mode), the inertial coast's rAF loop should call `sendImmediate()` on each frame to keep other windows in sync. For the current architecture where only the Controller sends, this is not relevant.

---

## 11. CSS changes

### Cursor feedback during inertial coast

Add a cursor style for the coast animation so the DM sees visual feedback that momentum is active:

```css
/* In vtt/css/map.css */

/* Phase 6: momentum coast cursor */
#map-container.coasting {
  cursor: grab;
}
```

Apply the class during `_startInertialCoast()` and remove it when the coast ends:

```javascript
// In _startInertialCoast():
this._el?.classList.add('coasting');

// In the coast's termination (speed < threshold):
this._el?.classList.remove('coasting');

// In _cancelInertialCoast():
this._el?.classList.remove('coasting');
```

No other CSS changes are required. The elastic overscroll, smooth zoom, and gesture state machine are purely JavaScript features that do not require new styles.

---

## 12. Testing protocols

### Unit tests for `TrackpadGestureDetector`

```javascript
// tests/trackpad-gesture.test.js
import { TrackpadGestureDetector } from '../vtt/js/trackpad-gesture.js';

function fakeWheel(deltaY, deltaX = 0) {
  return { deltaY, deltaX, ctrlKey: false, metaKey: false, shiftKey: false };
}

test('first wheel event transitions from IDLE to ACTIVE', () => {
  let started = false;
  const detector = new TrackpadGestureDetector({
    onGestureStart: () => { started = true; }
  });
  detector.handleWheel(fakeWheel(10));
  expect(detector.state).toBe('ACTIVE');
  expect(started).toBe(true);
});

test('sustained delta decay transitions to MOMENTUM', () => {
  let momentumStarted = false;
  const detector = new TrackpadGestureDetector({
    onMomentumStart: () => { momentumStarted = true; }
  });

  // Simulate active scroll (6 events, no decay)
  for (let i = 0; i < 6; i++) {
    detector.handleWheel(fakeWheel(20));
  }
  expect(detector.state).toBe('ACTIVE');
  expect(momentumStarted).toBe(false);

  // Simulate momentum (decaying deltas)
  detector.handleWheel(fakeWheel(18));
  detector.handleWheel(fakeWheel(15));
  detector.handleWheel(fakeWheel(12));
  expect(detector.state).toBe('MOMENTUM');
  expect(momentumStarted).toBe(true);
});

test('delta spike during MOMENTUM restarts as ACTIVE', () => {
  let startCount = 0;
  const detector = new TrackpadGestureDetector({
    onGestureStart: () => { startCount++; }
  });

  // Enter ACTIVE
  for (let i = 0; i < 6; i++) detector.handleWheel(fakeWheel(20));
  // Enter MOMENTUM
  detector.handleWheel(fakeWheel(18));
  detector.handleWheel(fakeWheel(15));
  detector.handleWheel(fakeWheel(12));
  expect(detector.state).toBe('MOMENTUM');

  // Spike: new gesture
  detector.handleWheel(fakeWheel(25));
  expect(detector.state).toBe('ACTIVE');
  expect(startCount).toBe(2); // initial + restart
});

test('cancel() immediately resets to IDLE', () => {
  let ended = false;
  const detector = new TrackpadGestureDetector({
    onGestureEnd: () => { ended = true; }
  });
  detector.handleWheel(fakeWheel(10));
  expect(detector.state).toBe('ACTIVE');
  detector.cancel();
  expect(detector.state).toBe('IDLE');
  expect(ended).toBe(true);
});

test('non-decaying constant deltas do not trigger MOMENTUM', () => {
  let momentumStarted = false;
  const detector = new TrackpadGestureDetector({
    onMomentumStart: () => { momentumStarted = true; }
  });

  // 20 events with constant delta (slow steady scroll)
  for (let i = 0; i < 20; i++) {
    detector.handleWheel(fakeWheel(5));
  }
  expect(detector.state).toBe('ACTIVE');
  expect(momentumStarted).toBe(false);
});
```

### Unit tests for `classifyWheelDevice`

```javascript
// tests/trackpad-gesture.test.js (continued)
import { classifyWheelDevice } from '../vtt/js/trackpad-gesture.js';

test('large integer deltaY classified as mouse', () => {
  expect(classifyWheelDevice({ deltaY: 100, deltaX: 0 })).toBe('mouse');
  expect(classifyWheelDevice({ deltaY: -120, deltaX: 0 })).toBe('mouse');
});

test('small fractional deltaY classified as trackpad', () => {
  expect(classifyWheelDevice({ deltaY: 3.5, deltaX: 0 })).toBe('trackpad');
  expect(classifyWheelDevice({ deltaY: 0.5, deltaX: 2.1 })).toBe('trackpad');
});

test('horizontal delta forces trackpad classification', () => {
  expect(classifyWheelDevice({ deltaY: 100, deltaX: 50 })).toBe('trackpad');
});
```

### Unit tests for `VelocityTracker`

```javascript
// tests/velocity-tracker.test.js

test('returns zero velocity with fewer than 2 samples', () => {
  const tracker = new VelocityTracker();
  expect(tracker.getVelocity()).toEqual({ x: 0, y: 0 });
  tracker.addSample(100, 200);
  expect(tracker.getVelocity()).toEqual({ x: 0, y: 0 });
});

test('computes correct velocity from position samples', () => {
  const tracker = new VelocityTracker();
  // Mock performance.now by manually setting sample times
  // (in real code, addSample uses performance.now; test via injection)
  tracker._samples = [
    { x: 100, y: 200, t: 0 },
    { x: 200, y: 300, t: 50 }  // 50ms later
  ];
  const v = tracker.getVelocity();
  expect(v.x).toBeCloseTo(2000); // 100px / 0.05s
  expect(v.y).toBeCloseTo(2000);
});

test('reset clears all samples', () => {
  const tracker = new VelocityTracker();
  tracker.addSample(100, 200);
  tracker.addSample(200, 300);
  tracker.reset();
  expect(tracker.getVelocity()).toEqual({ x: 0, y: 0 });
});
```

### Unit tests for `SmoothZoomAnimator`

```javascript
// tests/smooth-zoom.test.js

test('onWheelZoom updates target without exceeding bounds', () => {
  const cam = { zoom: 1.0, x: 0, y: 0, _getMinZoom: () => 0.5,
    screenToWorld: (sx, sy) => ({ x: sx, y: sy }),
    _applyConstraints: () => {} };
  const animator = new SmoothZoomAnimator(cam);

  // Zoom in
  animator.onWheelZoom(-1.0, 500, 500);
  expect(animator._targetZoom).toBeGreaterThan(1.0);

  // Zoom out
  animator._targetZoom = 1.0;
  animator.onWheelZoom(1.0, 500, 500);
  expect(animator._targetZoom).toBeLessThan(1.0);
  expect(animator._targetZoom).toBeGreaterThanOrEqual(0.5);
});

test('retarget syncs to current camera zoom', () => {
  const cam = { zoom: 2.0, x: 0, y: 0, _getMinZoom: () => 0.5,
    screenToWorld: (sx, sy) => ({ x: sx, y: sy }),
    _applyConstraints: () => {} };
  const animator = new SmoothZoomAnimator(cam);
  animator._targetZoom = 3.0;
  animator.retarget();
  expect(animator._targetZoom).toBe(2.0);
});
```

### Playwright integration tests

```javascript
// tests/trackpad-elastic.spec.js
import { test, expect } from '@playwright/test';

const VTT_URL = 'http://localhost:8765/vtt/index.html';

async function gotoVTT(page) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(VTT_URL);
  await page.waitForSelector('#loading[hidden]', { timeout: 10000 });
  await page.evaluate(() => {
    window.__vtt?.store?.state && (window.__vtt.store.state.mode = 'map');
  });
  await page.waitForTimeout(500);
}

test('trackpad scroll at boundary produces elastic offset', async ({ page }) => {
  await gotoVTT(page);

  // Zoom in so we have room to scroll
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => {
      window.__vtt.mapRenderer.camera.zoomToCenter(0.4);
    });
  }

  // Pan to the left boundary
  for (let i = 0; i < 100; i++) {
    await page.evaluate(() => {
      window.__vtt.mapRenderer.camera.panBy(50, 0);
    });
  }

  // Simulate a trackpad scroll gesture past the boundary.
  // Dispatch wheel events with small, trackpad-like deltas.
  await page.evaluate(() => {
    const el = document.getElementById('map-container');
    for (let i = 0; i < 10; i++) {
      const event = new WheelEvent('wheel', {
        deltaY: 0, deltaX: 15, deltaMode: 0,
        ctrlKey: false, bubbles: true, cancelable: true
      });
      el.dispatchEvent(event);
    }
  });
  await page.waitForTimeout(50);

  const offset = await page.evaluate(() => {
    const cam = window.__vtt.mapRenderer.camera;
    return { elasticX: cam.elasticOffsetX, x: cam.x };
  });

  // Camera.x should be at the hard boundary
  expect(offset.x).toBeCloseTo(0, 0);
  // But elastic offset should be nonzero (visual overscroll)
  expect(Math.abs(offset.elasticX)).toBeGreaterThan(0);
});

test('elastic offset springs back to zero after gesture end', async ({ page }) => {
  await gotoVTT(page);

  // Zoom in and pan to boundary (same setup as above)
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => {
      window.__vtt.mapRenderer.camera.zoomToCenter(0.4);
    });
  }
  for (let i = 0; i < 100; i++) {
    await page.evaluate(() => {
      window.__vtt.mapRenderer.camera.panBy(50, 0);
    });
  }

  // Dispatch trackpad-like wheel events past boundary
  await page.evaluate(() => {
    const el = document.getElementById('map-container');
    for (let i = 0; i < 10; i++) {
      el.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 0, deltaX: 15, deltaMode: 0,
        ctrlKey: false, bubbles: true, cancelable: true
      }));
    }
  });

  // Wait for gesture end timeout + spring animation
  await page.waitForTimeout(400);

  const offset = await page.evaluate(() => {
    return window.__vtt.mapRenderer.camera.elasticOffsetX;
  });

  // Elastic offset should have settled back to ~0
  expect(Math.abs(offset)).toBeLessThan(1.0);
});

test('mouse drag elastic overscroll still works with dual-position model', async ({ page }) => {
  await gotoVTT(page);

  // Zoom in
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      window.__vtt.mapRenderer.camera.zoomToCenter(0.4);
    });
  }

  const canvas = page.locator('#map-container');
  const box = await canvas.boundingBox();

  // Right-click drag past left boundary
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width + 200, box.y + box.height / 2, { steps: 10 });

  const duringDrag = await page.evaluate(() => {
    const cam = window.__vtt.mapRenderer.camera;
    return { elasticX: cam.elasticOffsetX, gestureActive: cam._gestureActive };
  });

  expect(duringDrag.gestureActive).toBe(true);
  expect(Math.abs(duringDrag.elasticX)).toBeGreaterThan(0);

  // Release
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(600);

  const afterRelease = await page.evaluate(() => {
    return Math.abs(window.__vtt.mapRenderer.camera.elasticOffsetX);
  });

  expect(afterRelease).toBeLessThan(1.0);
});

test('smooth zoom animation preserves cursor anchor', async ({ page }) => {
  await gotoVTT(page);

  // Get world point under cursor before zoom
  const cursorX = 960;
  const cursorY = 540;
  const worldBefore = await page.evaluate(({ cx, cy }) => {
    const cam = window.__vtt.mapRenderer.camera;
    return cam.screenToWorld(cx, cy);
  }, { cx: cursorX, cy: cursorY });

  // Dispatch a mouse-wheel-like zoom event (large integer delta)
  await page.evaluate(({ cx, cy }) => {
    const el = document.getElementById('map-container');
    el.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -100, deltaX: 0, deltaMode: 0,
      ctrlKey: true, clientX: cx, clientY: cy,
      bubbles: true, cancelable: true
    }));
  }, { cx: cursorX, cy: cursorY });

  // Wait for smooth animation to settle
  await page.waitForTimeout(500);

  const worldAfter = await page.evaluate(({ cx, cy }) => {
    const cam = window.__vtt.mapRenderer.camera;
    return cam.screenToWorld(cx, cy);
  }, { cx: cursorX, cy: cursorY });

  // Same world point should still be under cursor (within tolerance)
  expect(worldAfter.x).toBeCloseTo(worldBefore.x, 0);
  expect(worldAfter.y).toBeCloseTo(worldBefore.y, 0);
});
```

### Manual testing checklist

Run through this by hand after the code changes are in place:

1. **Trackpad scroll elastic overscroll (primary feature)**: Zoom in 2-3 notches. Two-finger scroll on the trackpad to pan the map. When you reach an edge, the map should pull past the edge with increasing resistance. Lift your fingers. The map should spring back to the edge smoothly within ~0.25 seconds.

2. **Trackpad momentum overscroll**: Zoom in. Do a fast two-finger flick toward a map edge. The momentum should carry the map past the edge with rubber-band resistance (dampened compared to active scrolling). After momentum settles, the spring snap-back should fire.

3. **Elastic overscroll in all four directions (trackpad)**: Repeat test 1 for left, right, top, and bottom edges. Each should produce the same elastic feel.

4. **Mouse drag elastic still works**: Right-click drag the map past an edge. The elastic feel should be identical to Phase 3 behavior. Release the drag. Spring snap-back should fire.

5. **Mouse drag inertial coast**: Zoom in. Right-click drag the map quickly and release. The map should continue coasting in the drag direction with decelerating motion. The coast should stop within ~0.5 seconds.

6. **Inertial coast hitting a boundary**: Do a fast drag toward an edge. When the inertial coast reaches the edge, the map should elastically overscroll past it (rubber-banded). When the coast velocity drops to zero, the spring should snap back.

7. **Smooth mouse wheel zoom**: Use a physical mouse scroll wheel. Zoom should be smooth and animated, not jumpy. Each notch should produce a gradual zoom transition. The feature under the cursor should stay under the cursor throughout.

8. **Trackpad pinch zoom is still direct**: Pinch-to-zoom on the trackpad. Zoom should be immediate and 1:1 with finger spread, not smoothly animated. There should be no perceptible lag.

9. **Gesture preemption (drag cancels scroll)**: Start a two-finger scroll toward a boundary. While scrolling, right-click to start a drag. The scroll gesture should cancel immediately, and the drag should take over without visual glitches.

10. **Gesture preemption (scroll cancels inertia)**: Do a fast drag release to trigger inertial coast. While the coast is running, start a two-finger scroll. The coast should cancel immediately, and the scroll should take over.

11. **Gesture preemption (drag cancels snap-back)**: Scroll past a boundary and lift fingers. While the spring snap-back is animating, right-click drag. The spring should stop immediately, and the drag should start from the current visual position.

12. **Keyboard pan at boundary**: Use arrow keys to pan to an edge. At the boundary, panning should stop cleanly. There should be no elastic overscroll on keyboard input (keyboard pan is not a gesture, just hard clamping).

13. **Window resize during elastic overscroll**: While the map is elastically overscrolled (mid-gesture), resize the browser window. The elastic offset should adjust to the new viewport dimensions without visual glitches.

14. **BroadcastChannel sync during elastic overscroll**: Open the Controller and VTT Display. Zoom in on the Controller. Use the Controller's pan buttons to reach an edge. The Display should show the camera at the hard-clamped boundary, with no elastic offset visible. Elastic overscroll is a local-only visual effect.

15. **Console error check**: Open DevTools on the VTT Display. Perform all tests above. No errors or warnings related to Phase 6 features.

---

## 13. Migration checklist

This is the ordered list of changes for Claude Code. Each item references the section above that provides the implementation.

1. **Add `VelocityTracker` class** to `vtt/js/map-camera.js`, after the existing `CameraAnimator` class (Section 6). This is a self-contained utility with no dependencies.

2. **Create `vtt/js/trackpad-gesture.js`** with `TrackpadGestureDetector` class and `classifyWheelDevice()` function (Section 3). This is a new file with no external dependencies.

3. **Add `SmoothZoomAnimator` class** to `vtt/js/map-camera.js`, after `VelocityTracker` (Section 7). It references `MAX_ZOOM` and the Camera's `_getMinZoom()`.

4. **Add `GestureStateMachine` class** to `vtt/js/map-camera.js` (Section 9). It references the Camera instance for canceling animations.

5. **Add Phase 6 properties to Camera constructor** in `vtt/js/map-camera.js` (Section 2): `this.elasticOffsetX`, `this.elasticOffsetY`, `this._gestureActive`, `this._momentumActive`, `this._cumulativeOverflowX`, `this._cumulativeOverflowY`, `this._dragVelocityTracker`, `this._inertiaRafId`.

6. **Add `visualX` and `visualY` getters** to Camera class (Section 2).

7. **Add `_feedElasticOverflow()` method** to Camera class (Section 2).

8. **Add `_snapBackElastic()` method** to Camera class (Section 2).

9. **Add `_startInertialCoast()` and `_cancelInertialCoast()` methods** to Camera class (Section 6).

10. **Refactor `_applyConstraints()`** to remove the `_isDragging` branch. Always hard-clamp. Update the emit condition to include elastic offset (Section 2).

11. **Refactor `panBy()`** to detect overflow and feed it into `_feedElasticOverflow()` when `_gestureActive` is true (Section 2).

12. **Refactor `zoomAt()`** to recalculate elastic offset when elastic offset is nonzero (Section 4).

13. **Refactor `_startPan()`** to use `_gestureActive` instead of `_isDragging`, cancel inertial coast, reset cumulative overflow, and start velocity tracking (Section 8).

14. **Refactor the mousemove pan handler** to compute overflow for elastic offset and track velocity (Section 8).

15. **Refactor `_endPan()`** to compute release velocity, optionally start inertial coast, and trigger elastic snap-back (Section 8).

16. **Replace the wheel event listener** in `attachTo()` with the new handler that integrates `TrackpadGestureDetector`, `classifyWheelDevice()`, and `SmoothZoomAnimator` (Section 4).

17. **Create `this._elasticAnimator`** as a second `CameraAnimator` instance in `attachTo()`, after the existing `this._animator` (Section 2). Configure with stiffness 400 for snappier momentum snap-back.

18. **Create `this._smoothZoom`** as a `SmoothZoomAnimator` instance in `attachTo()` (Section 7).

19. **Create `this._gestures`** as a `GestureStateMachine` instance in `attachTo()` (Section 9).

20. **Create `this._trackpadDetector`** as a `TrackpadGestureDetector` instance in the wheel handler setup (Section 4).

21. **Update `MapRenderer`** to use `camera.visualX`/`camera.visualY` instead of `camera.x`/`camera.y` in the canvas transform (Section 2).

22. **Remove `_isDragging` property**, `_applyElasticBounds()` method, and `_elasticClampAxis()` method (Section 8). Update any tests that reference these.

23. **Add `coasting` cursor CSS** to `vtt/css/map.css` (Section 11).

24. **Update `KeyboardController._tick()`** to call `this._camera._smoothZoom?.retarget()` after zoom operations (Section 7).

25. **Run the test suite** (Section 12): unit tests for TrackpadGestureDetector, classifyWheelDevice, VelocityTracker, and SmoothZoomAnimator; Playwright integration tests for trackpad elastic overscroll, mouse drag elastic overscroll, and smooth zoom cursor anchor; manual testing checklist (15 items).

---

## 14. What Phase 7 expects from this foundation

Phase 6 establishes the advanced input handling layer. Future phases build on it:

- **The dual-position camera model** cleanly separates logical state from visual effects. Any future visual effect that temporarily displaces the camera (screen shake, camera bob, hit feedback) can use the same elastic offset pattern without corrupting the logical position or BroadcastChannel sync.

- **The `TrackpadGestureDetector`** provides gesture lifecycle for any future trackpad-driven feature. If Phase 7 adds trackpad-based rotation or multi-finger gestures, the detector's architecture (delta analysis + timeout heuristic + state machine) extends to those cases.

- **The `VelocityTracker`** is reusable for any input where release velocity matters: token drag-and-drop with momentum, fling-to-dismiss UI panels, or any physics-based interaction.

- **The `SmoothZoomAnimator`** is retargetable. Phase 7's camera preset recall could use the same target-chasing approach for smooth zoom transitions between preset zoom levels, rather than the van Wijk & Nuij flyTo path (which may be overkill for small zoom changes).

- **The `GestureStateMachine`** is the coordination layer that any new input source must register with. Phase 7 touch support (PointerEvent-based pinch and pan) would add new gesture types at appropriate priority levels.

---

## 15. What is explicitly deferred and why

**Touch screen support via PointerEvent (deferred to Phase 7+).** The VTT is a DM presentation tool primarily used on a laptop or desktop with trackpad and/or mouse. Touch support (tablet, touch-screen laptop) is valuable but requires a full PointerEvent-based gesture recognizer for two-finger pinch-to-zoom and pan, `touch-action: none` enforcement, and pointer capture management. This is a separate concern from trackpad/mouse input refinement and benefits from the gesture state machine foundation that Phase 6 provides.

**Trackpad rotation gesture (deferred indefinitely).** Rotation data is only available via Safari's proprietary `GestureEvent.rotation` property. Chrome and Firefox expose no rotation data from trackpad gestures, and the W3C has no active proposal to standardize it. Implementing a Safari-only feature adds complexity (rotation transforms in the renderer, angle-aware clamping, snap-to-north reset) without cross-browser support. For a VTT map that is always oriented north-up, rotation adds more confusion than value.

**Force Touch / pressure sensitivity (deferred indefinitely).** macOS Force Touch is accessible via the non-standard `webkitmouseforcechanged` event, supported only in Safari. The pressure data (0.0 to 3.0, with a "force click" haptic at ~1.0) could theoretically drive zoom speed or pan acceleration, but it is a Safari-only feature with no standardization path. Building features on it would create platform-exclusive behavior that cannot be tested in Chrome.

**Three-finger gestures (not possible).** macOS captures three-finger swipes for Mission Control and app switching at the OS level before they reach the browser. No JavaScript API can intercept these gestures. They are not available for application use.

**Custom scroll deceleration curves (deferred to tuning pass).** The inertial coast uses a single `FRICTION = 0.96` value. A more sophisticated approach would adapt friction based on release speed (faster releases get less friction for longer coasts) or provide a DM preference slider. This is a tuning refinement, not an architectural decision, and should be done after real-world playtesting with the base implementation.

**`overscroll-behavior: none` CSS property (not applicable).** This CSS property prevents the browser's native overscroll effect (bounce on macOS, edge glow on Android) from triggering when a scrollable element reaches its bounds. Since the VTT canvas is not a scrollable element (it uses `preventDefault()` on wheel events and manages its own viewport), this property has no effect. It is not needed and should not be added, as it could suppress native overscroll on other scrollable elements in the UI if applied too broadly.
