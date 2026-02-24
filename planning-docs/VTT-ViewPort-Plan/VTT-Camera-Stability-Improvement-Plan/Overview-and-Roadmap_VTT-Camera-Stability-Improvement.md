# Phase 6 Stabilization: a research-grounded roadmap for fixing VTT camera input

**This document is the complete implementation guide for stabilizing the Phase 6 trackpad elastic overscroll and advanced input system.** It synthesizes findings from production canvas applications (Figma, Mapbox GL JS, tldraw), animation frameworks (React Spring, iOS UIKit, Android DynamicAnimation), signal processing, control theory, and Apple's "Designing Fluid Interfaces" (WWDC 2018) into a five-phase roadmap that fixes all five reported bugs and positions the VTT's camera system to exceed the quality of existing virtual tabletops and professional mapping tools.

Each phase explains what changes, why it changes, what to watch out for, provides complete code examples grounded in the current codebase, and calls out the testing strategy. Read the full document before starting. The phases are ordered by dependency and impact. Phases 1 and 2 fix the most visible bugs. Phase 3 fixes the freeze. Phase 4 restructures the coordination layer. Phase 5 pushes beyond parity into territory no VTT currently occupies.

---

## Table of contents

1. [The two root causes behind all five bugs](#the-two-root-causes)
2. [Guiding principles from the research](#guiding-principles)
3. [Phase S1: Stateful device classification](#phase-s1)
4. [Phase S2: Velocity-clamped spring snap-back](#phase-s2)
5. [Phase S3: Speculative snap-back and momentum detection](#phase-s3)
6. [Phase S4: Hierarchical gesture coordination with hysteresis](#phase-s4)
7. [Phase S5: Unified spring physics and beyond-parity features](#phase-s5)
8. [Testing strategy across all phases](#testing-strategy)
9. [Long-term product development tie-ins](#long-term-tie-ins)

---

## The two root causes behind all five bugs {#the-two-root-causes}

Every bug traces back to one of two architectural decisions made during the original Phase 6 implementation.

**Root cause 1: Per-event device classification.** The `classifyWheelDevice()` function in `vtt/js/trackpad-gesture.js` makes a single-event decision: if `maxDelta >= 50 && integer && no deltaX`, it returns `'mouse'`. Fast two-finger trackpad scrolls on macOS routinely produce integer deltas of 50 to 150 pixels. The function misclassifies these as mouse wheel events, routing them to `SmoothZoomAnimator.onWheelZoom()` instead of `panBy()`. This causes bugs #3 (zoom after pinch), #4 (fast scroll triggers zoom), and contributes to #5 (general erratic behavior).

Every production canvas application that has solved this problem uses stateful, multi-event classification rather than per-event heuristics. Mapbox GL JS accumulates deltas over a 40ms window. The `lethargy` library tracks rolling averages across events. tldraw uses behavioral detection (presence of deltaX). The W3C proposal for `WheelEvent.isInertialScrolling` (issues #56 and #58) has been open since 2015 with zero browser implementation. No standard API helps here; heuristics are the only option, and the best heuristics combine multiple weak signals over a sliding window.

**Root cause 2: Timeout-gated gesture end detection.** The `TrackpadGestureDetector` requires 3 consecutive decaying deltas (after 6+ events) to transition from ACTIVE to MOMENTUM, then waits for a 100ms timeout silence to fire `onGestureEnd` and trigger `_snapBackElastic()`. During this entire detection window, the elastic offset is held visible but not animating. For fast gestures that produce few momentum events, this window stretches to 1 to 2 seconds of frozen overscroll (bug #1). When the snap-back finally fires, momentum velocity from the fast swipe is passed unclamped to the critically damped spring, which overshoots past zero and flings the viewport to the opposite side of the map (bug #2).

Apple's UIScrollView solves this differently. macOS provides `NSEventPhase` and `NSEventMomentumPhase` with explicit began/changed/ended states, but no browser exposes these to JavaScript. The solution is not to wait for formal momentum detection before responding visually. Start a gentle snap-back speculatively on the first frame where the overscroll velocity drops, and cancel it if more active input arrives. A wrong animation that gets cancelled after 16ms is imperceptible; a 1.5 second freeze is glaring.

---

## Guiding principles from the research {#guiding-principles}

These principles, drawn from the research synthesis, inform every decision in this roadmap.

### "Default to pan when uncertain"

A pan that should have been a zoom is easily corrected by the user: they just pinch. A zoom that should have been a pan is disorienting: it changes the viewport scale, loses the user's spatial context, and requires a manual zoom-back-out. When the device classifier is uncertain, always treat the input as pan. This principle comes from Mapbox GL JS's approach and from Google Maps' cooperative gesture handling, where the default non-modifier behavior is always pan.

### "Hysteresis prevents oscillation"

The Schmitt trigger from electronics, the 2-bit branch predictor from computer architecture, and Apple's own gesture documentation all converge on the same insight: require stronger evidence to switch modes than to stay in the current mode. Once the system commits to "this is a scroll gesture," it should take substantially more evidence to reclassify as zoom than it took to classify as scroll in the first place. Without hysteresis, rapid input near the classification boundary causes chattering between modes, which is exactly what bug #5 looks like.

### "Current value, current velocity"

Every major animation framework (React Spring, Framer Motion, iOS UIViewPropertyAnimator, Android SpringAnimation, Facebook Pop) handles animation interruption the same way: read the current position and velocity from whatever animation is running, and use those as the initial conditions for the new animation. No explicit cancellation logic, no blending period, no state cleanup. The transition is C1-continuous (position and velocity are both continuous at the switching instant) by construction. This principle eliminates discontinuities at every animation boundary.

### "Speculative execution beats waiting"

From CPU pipeline design to Google's RAIL model (which requires visible feedback within 100ms of user action), the research consistently shows that acting on a best guess and correcting later produces better perceived responsiveness than waiting for certainty. The speculative snap-back strategy applies this: on every frame where the camera is overscrolled and input velocity is low, start animating back. If the guess is wrong (the user is still scrolling), cancel the animation on the next input event. The cost of a wrong guess is one cancelled frame. The cost of waiting is a multi-second freeze.

### "Spring physics unifies everything"

Apple's WWDC 2018 "Designing Fluid Interfaces" talk makes the case that springs are the universal primitive for all interactive animations. A spring with zero stiffness models inertial coast (friction-only deceleration). A spring with stiffness models snap-back. A spring with high stiffness models direct manipulation. By expressing all camera animations as spring configurations rather than separate animation systems, the code becomes simpler, animation interruption becomes trivial (just change the spring's target and parameters), and velocity continuity is automatic. Phase S5 explores this unification.

---

## Phase S1: Stateful device classification {#phase-s1}

**Fixes:** Bugs #3, #4, most of #5
**Impact:** Highest. Eliminates the primary source of input misrouting.
**Risk:** Low. This is a replacement of a single function and the routing logic that depends on it.
**Estimated LOC:** ~120

### The philosophy

The fundamental problem with per-event classification is that it treats each wheel event as an independent observation, discarding all context from previous events. But device identity is a *session-level* property that changes rarely (when the user switches from trackpad to mouse or vice versa), while individual events are noisy and ambiguous. The correct approach is to maintain a belief about which device is active and update that belief incrementally as events arrive, requiring strong evidence to change.

This is essentially Bayesian reasoning. You have a prior (the current device belief), new evidence (the latest wheel event's properties), and a posterior (the updated belief). The prior should be strong, meaning that a single ambiguous event cannot flip the classification. Multiple consistent signals are required to change the belief.

### What signals distinguish mouse from trackpad

Six signals, ranked by discriminative power:

1. **Inter-event timing** (strongest). Trackpad events arrive at display refresh rate, typically 8ms to 16ms apart. Mouse wheel events arrive at human rotation speed, typically 50ms to 200ms apart. A gap over 80ms between wheel events is strong mouse evidence. A burst of events under 20ms apart is strong trackpad evidence.

2. **Delta consistency.** Mouse wheels produce identical absolute deltas for each notch. On macOS, a single notch produces exactly `deltaY: 4.000244140625` (Mapbox GL JS calls this `wheelZoomDelta` and uses it as a signature). Trackpad deltas vary from event to event because they reflect finger velocity.

3. **Fractional deltas.** Mouse wheels almost always produce integer deltas (or the specific `4.000244140625` value). Trackpad events frequently produce fractional deltas, especially at low velocities.

4. **Simultaneous deltaX and deltaY.** If both axes have nonzero deltas in a single event, it is almost certainly a trackpad. Mouse wheels produce movement on one axis at a time (vertical scroll or horizontal tilt, never both).

5. **`deltaMode`.** In Firefox, mouse wheels report `WheelEvent.DOM_DELTA_LINE` (value 1) while trackpads report `DOM_DELTA_PIXEL` (value 0). In Chrome and Safari, both report `DOM_DELTA_PIXEL`, making this Firefox-only.

6. **Very small deltas.** A `|deltaY| < 4` is almost never from a mouse wheel. Mouse wheels have a minimum step size determined by the notch mechanism.

### The new `WheelDeviceClassifier` class

This replaces the `classifyWheelDevice()` function. Create it in `vtt/js/trackpad-gesture.js`:

```javascript
// ============================================================
// Stateful Wheel Device Classifier
// ============================================================
//
// Maintains a belief about whether the active input device is a
// mouse wheel or a trackpad, updated incrementally as wheel events
// arrive. Requires multiple consistent signals to change classification.
//
// Design principles:
//   - Default to 'trackpad' (safe: pan is less disorienting than zoom)
//   - Sticky once classified (hysteresis prevents oscillation)
//   - Reset to 'unknown' after silence (user may have switched devices)

const CLASSIFIER_SILENCE_MS = 400;    // Reset after this much silence
const CLASSIFIER_WINDOW_SIZE = 6;     // Events to consider
const CLASSIFIER_MOUSE_THRESHOLD = 4; // Signals needed to switch to mouse
const CLASSIFIER_TRACKPAD_THRESHOLD = 2; // Signals needed to switch to trackpad

export class WheelDeviceClassifier {
  constructor() {
    this._device = 'unknown';   // 'unknown' | 'mouse' | 'trackpad'
    this._lastEventTime = 0;
    this._events = [];          // sliding window of recent event summaries
  }

  /**
   * Process a wheel event and return the current device classification.
   * @param {WheelEvent} e
   * @returns {'mouse' | 'trackpad'}
   */
  classify(e) {
    const now = performance.now();
    const gap = now - this._lastEventTime;

    // After silence, reset to unknown (user may have switched devices)
    if (gap > CLASSIFIER_SILENCE_MS) {
      this._device = 'unknown';
      this._events = [];
    }

    // Record event summary
    this._events.push({
      absX: Math.abs(e.deltaX),
      absY: Math.abs(e.deltaY),
      isFractional: (e.deltaY % 1 !== 0) || (e.deltaX % 1 !== 0),
      hasBothAxes: e.deltaX !== 0 && e.deltaY !== 0,
      deltaMode: e.deltaMode,
      gap,
      time: now
    });

    // Keep only the most recent events
    if (this._events.length > CLASSIFIER_WINDOW_SIZE) {
      this._events.shift();
    }

    this._lastEventTime = now;

    // Score the window
    const scores = this._scoreWindow();

    // Apply hysteresis: harder to switch away from current belief
    if (this._device === 'unknown') {
      // No prior belief: lower threshold for initial classification
      if (scores.mouseSignals >= 2) {
        this._device = 'mouse';
      } else {
        // Default to trackpad (safe default)
        this._device = 'trackpad';
      }
    } else if (this._device === 'trackpad' && scores.mouseSignals >= CLASSIFIER_MOUSE_THRESHOLD) {
      this._device = 'mouse';
    } else if (this._device === 'mouse' && scores.trackpadSignals >= CLASSIFIER_TRACKPAD_THRESHOLD) {
      this._device = 'trackpad';
    }

    return this._device;
  }

  _scoreWindow() {
    let mouseSignals = 0;
    let trackpadSignals = 0;

    for (const evt of this._events) {
      const maxDelta = Math.max(evt.absX, evt.absY);

      // Signal 1: inter-event timing
      if (evt.gap > 0 && evt.gap < 25) trackpadSignals++;
      if (evt.gap > 80) mouseSignals++;

      // Signal 2: fractional deltas (strong trackpad indicator)
      if (evt.isFractional) trackpadSignals++;

      // Signal 3: simultaneous axes (strong trackpad indicator)
      if (evt.hasBothAxes) trackpadSignals++;

      // Signal 4: deltaMode LINE (Firefox only, strong mouse indicator)
      if (evt.deltaMode === 1) mouseSignals++;

      // Signal 5: very small deltas (trackpad at low velocity)
      if (maxDelta > 0 && maxDelta < 4) trackpadSignals++;

      // Signal 6: large integer delta with no horizontal component
      // This is the old classifyWheelDevice check, but now it is
      // just one weak signal among many, not the sole decider.
      if (maxDelta >= 50 && maxDelta % 1 === 0 && evt.absX === 0) {
        mouseSignals++;
      }
    }

    return { mouseSignals, trackpadSignals };
  }

  /** Get current classification without processing an event. */
  get device() {
    return this._device === 'unknown' ? 'trackpad' : this._device;
  }

  /** Force reset (useful when gesture state machine changes modes). */
  reset() {
    this._device = 'unknown';
    this._events = [];
    this._lastEventTime = 0;
  }
}
```

### Restructured wheel handler routing

The wheel handler in `_attachWheelHandler()` currently routes based on `dz !== 0` first, then falls through to `classifyWheelDevice()` for non-ctrl events. The restructured version uses two clean paths: ctrl-held events always zoom, non-ctrl events always pan for trackpad.

Replace the wheel event listener inside `_attachWheelHandler()` in `vtt/js/map-camera.js`:

```javascript
_attachWheelHandler(el) {
  // Create the stateful classifier (replaces per-event classifyWheelDevice)
  this._wheelClassifier = new WheelDeviceClassifier();

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

    // Path 1: Ctrl/Meta held (or dz !== 0 from normalizeWheel).
    // This is an explicit zoom intent. ctrlKey is how browsers
    // synthesize trackpad pinch-to-zoom events.
    if (dz !== 0) {
      const device = this._wheelClassifier.classify(e);
      const screen = this.eventToScreen(e);

      if (device === 'mouse') {
        // Mouse: smooth animated zoom (log-space lerp)
        if (this._gestures) this._gestures.request('ZOOM_ANIMATE');
        this._smoothZoom.onWheelZoom(dz, screen.x, screen.y);
      } else {
        // Trackpad pinch: direct 1:1 zoom (user's fingers provide smoothing)
        if (this._gestures) this._gestures.request('PINCH_ZOOM');
        this.zoomAt(screen.x, screen.y, dz * -ZOOM_SENSITIVITY);
      }
      return;
    }

    // Path 2: No ctrl/meta. This is either trackpad scroll or
    // mouse wheel without a modifier.
    if (dx !== 0 || dy !== 0) {
      const device = this._wheelClassifier.classify(e);

      if (device === 'mouse') {
        // Mouse scroll wheel without Ctrl: zoom at cursor
        const screen = this.eventToScreen(e);
        if (this._gestures) this._gestures.request('ZOOM_ANIMATE');
        this._smoothZoom.onWheelZoom(dy / 100, screen.x, screen.y);
      } else {
        // Trackpad two-finger scroll: always pan
        this._trackpadDetector.handleWheel(e);
        this.panBy(-dx, -dy);
      }
    }
  }, { passive: false });
}
```

### What to watch out for

**The Apple Magic Mouse.** It has a touch surface and produces trackpad-like events from a physical mouse. The classifier will classify it as trackpad, which means scroll gestures will pan instead of zoom. This is actually correct behavior for this device. Magic Mouse users who want scroll-to-zoom can hold Ctrl. If you later add a user preference toggle for "scroll wheel zooms" (like Figma), that preference overrides the classifier entirely.

**Logitech MX Master free-spin mode.** When the scroll wheel is unlocked, it produces continuous events at high frequency with decaying deltas, mimicking trackpad momentum. The classifier will likely classify this as trackpad. Again, this is the safe default. The user can hold Ctrl to zoom.

**Firefox `deltaMode: 1`.** Firefox reports mouse wheel events with `deltaMode: DOM_DELTA_LINE` (value 1) and trackpad events with `deltaMode: DOM_DELTA_PIXEL` (value 0). This is the single strongest per-event discriminator and effectively solves classification in Firefox by itself. The classifier uses it as one signal among many, which means Firefox users get faster, more confident classification.

**The old `classifyWheelDevice` export.** The unit tests in `tests/phase6-unit.spec.js` directly test `classifyWheelDevice()`. Those tests need to be replaced with tests for `WheelDeviceClassifier`. Keep the old function exported but mark it deprecated for backward compatibility during the transition.

### Import changes

In `vtt/js/map-camera.js`, update the import:

```javascript
// OLD:
import { TrackpadGestureDetector, classifyWheelDevice } from './trackpad-gesture.js';

// NEW:
import { TrackpadGestureDetector, WheelDeviceClassifier } from './trackpad-gesture.js';
```

### Tests for Phase S1

Unit tests (add to `tests/phase6-unit.spec.js` or a new `tests/device-classifier.spec.js`):

1. **Rapid small-delta events classify as trackpad.** Feed 5 events with `deltaY: 3.5` at 10ms intervals. Assert `device === 'trackpad'`.

2. **Large integer delta with long gaps classifies as mouse.** Feed 3 events with `deltaY: 120, deltaX: 0` at 150ms intervals. Assert `device === 'mouse'`.

3. **Fast large-delta trackpad events stay trackpad.** Feed 8 events with `deltaY: 80, deltaX: 0` at 12ms intervals (mimicking fast two-finger scroll). Assert `device === 'trackpad'` (the inter-event timing overrides the large delta).

4. **Hysteresis: single ambiguous event doesn't flip classification.** Classify as trackpad with 5 small-delta events. Then feed 1 large integer delta event. Assert `device` is still `'trackpad'`.

5. **Silence resets classification.** Classify as mouse. Wait 500ms (use `performance.now` mock). Feed trackpad-signature events. Assert classification updates.

6. **Fractional deltas are strong trackpad indicators.** Feed events with `deltaY: 75.5`. Assert trackpad despite large magnitude.

7. **Simultaneous deltaX and deltaY are strong trackpad indicators.** Feed events with `deltaY: 100, deltaX: 30`. Assert trackpad.

Integration tests (Playwright):

8. **Fast two-finger trackpad scroll does not zoom.** Dispatch 10 rapid wheel events with `deltaY: -80, deltaX: 0, ctrlKey: false` at 10ms cadence. Assert camera zoom is unchanged and camera position has moved (panned).

9. **Ctrl+wheel from trackpad does zoom.** Dispatch wheel events with `ctrlKey: true, deltaY: -5`. Assert zoom changes.

---

## Phase S2: Velocity-clamped spring snap-back {#phase-s2}

**Fixes:** Bug #2 (overshoot to wrong side of map)
**Impact:** High. Eliminates the most disorienting visual bug.
**Risk:** Low. The fix is mathematically precise.
**Estimated LOC:** ~30

### The philosophy

A critically damped spring (damping ratio zeta = 1) is defined by the equation:

```
x(t) = (A + B*t) * e^(-omega*t)
```

where `A = displacement` (the initial distance from target) and `B = velocity + omega * displacement` (initial velocity plus a correction term). The spring overshoots past zero (the target position) when B is large enough that the `B*t` term dominates the decaying `A` term, pushing `x(t)` past zero before the exponential decay kills it.

The exact condition for overshoot is: **`v0 < -omega * x0`** (for positive initial displacement). With `omega = 20` (stiffness 400) and 50px of elastic offset, any inward velocity exceeding **1000 px/s** causes overshoot. Fast trackpad swipes easily produce momentum velocities of 2000 to 5000 px/s, so overshoot is nearly guaranteed on fast releases.

The fix is to clamp the initial velocity at spring start so that overshoot is mathematically impossible. The clamped velocity still preserves the feeling of momentum (the spring starts with real velocity, not zero), but it cannot carry the camera past the target.

### The implementation

Modify `_snapBackElastic()` in `vtt/js/map-camera.js`:

```javascript
/**
 * Trigger spring snap-back from current elastic offset to zero.
 * Uses the elastic animator (stiffness=400, omega~20) for snappier feel.
 *
 * Velocity is clamped to prevent spring overshoot. For a critically
 * damped spring, overshoot occurs when v0 < -omega * x0 (for positive
 * displacement). We clamp to exactly the zero-overshoot threshold,
 * which preserves maximum momentum feel without crossing the target.
 *
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
    const omega = this._elasticAnimator._omega;

    // Clamp velocity to prevent spring overshoot.
    // For displacement x0 > 0 (offset to the right of target):
    //   Spring overshoots when vx < -omega * x0
    //   Clamp vx to max(vx, -omega * x0) to prevent crossing zero.
    // For displacement x0 < 0 (offset to the left):
    //   Spring overshoots when vx > -omega * x0
    //   Clamp vx to min(vx, -omega * x0).
    const clampedVx = this._clampSpringVelocity(
      velocity.vx, this.elasticOffsetX, omega
    );
    const clampedVy = this._clampSpringVelocity(
      velocity.vy, this.elasticOffsetY, omega
    );

    this._elasticAnimator.snapBack(
      { x: this.elasticOffsetX, y: this.elasticOffsetY },
      { x: 0, y: 0 },
      { vx: clampedVx, vy: clampedVy }
    );
  }
}

/**
 * Clamp velocity to prevent critically damped spring overshoot.
 *
 * For displacement d and natural frequency omega:
 *   - If d > 0: clamp v to be no less than -omega * d
 *   - If d < 0: clamp v to be no greater than omega * |d|
 *   - If d == 0: no clamping needed
 *
 * This guarantees the spring approaches the target monotonically.
 *
 * @param {number} v - Initial velocity
 * @param {number} d - Initial displacement from target
 * @param {number} omega - Spring natural frequency
 * @returns {number} Clamped velocity
 */
_clampSpringVelocity(v, d, omega) {
  if (d === 0) return v;

  // The critical velocity: the maximum inward velocity that
  // produces zero overshoot. Beyond this, the spring crosses zero.
  const vCritical = -omega * d;

  if (d > 0) {
    // Displacement is positive (offset to the right).
    // Velocity must not be more negative than vCritical.
    return Math.max(v, vCritical);
  } else {
    // Displacement is negative (offset to the left).
    // vCritical is positive here. Velocity must not exceed it.
    return Math.min(v, vCritical);
  }
}
```

### Safety net: position clamping in the elastic animator

As a defense-in-depth measure, add a position clamp in the elastic animator's tick loop. This catches any edge case where floating-point precision or an unusual initial condition causes the spring to cross zero despite the velocity clamp:

Modify the `_tick()` method of `CameraAnimator` to accept an optional bounds check. The elastic animator instance (stiffness=400) animates `elasticOffsetX/Y` toward zero, so the clamp is: the offset should not change sign during animation.

```javascript
// In CameraAnimator._tick(), after computing the resolved values:
// (Add this only for the elastic animator instance, not the primary)

_tick(timestamp) {
  if (!this._startTime) this._startTime = timestamp;
  const t = Math.min((timestamp - this._startTime) / 1000, 2.0);

  const rx = this._resolveAxis(this._springX, t);
  const ry = this._resolveAxis(this._springY, t);

  if (this._springX) {
    let val = rx.value;
    // Position clamp: elastic offset must not cross zero (overshoot past target)
    if (this._springX.displacement > 0 && val < this._springX.target) {
      val = this._springX.target;
    } else if (this._springX.displacement < 0 && val > this._springX.target) {
      val = this._springX.target;
    }
    this._camera.elasticOffsetX = val;
  }
  if (this._springY) {
    let val = ry.value;
    if (this._springY.displacement > 0 && val < this._springY.target) {
      val = this._springY.target;
    } else if (this._springY.displacement < 0 && val > this._springY.target) {
      val = this._springY.target;
    }
    this._camera.elasticOffsetY = val;
  }

  const settled = rx.settled && ry.settled;
  EventBus.emit('camera:changed');

  if (settled) {
    this._camera.elasticOffsetX = 0;
    this._camera.elasticOffsetY = 0;
    EventBus.emit('camera:changed');
    this._stop();
  } else {
    this._rafId = requestAnimationFrame(this._tick);
  }
}
```

**Important architectural note:** The elastic animator currently writes to `this._camera.x` and `this._camera.y` because it was cloned from the primary `CameraAnimator`. For elastic snap-back, it should write to `this._camera.elasticOffsetX` and `this._camera.elasticOffsetY` instead. If this has not already been refactored, this is the time to do it. The elastic animator's `snapBack()` should set displacement relative to elastic offset, and its `_tick()` should update elastic offset, not camera position.

### Capping maximum coast velocity

Add a velocity cap in `_startInertialCoast()` to prevent extreme velocities from reaching the spring:

```javascript
_startInertialCoast(velocity) {
  // Cap initial velocity to prevent extreme spring behavior downstream
  const MAX_COAST_SPEED = 3000; // screen px/s
  const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
  if (speed > MAX_COAST_SPEED) {
    const scale = MAX_COAST_SPEED / speed;
    velocity = { x: velocity.x * scale, y: velocity.y * scale };
  }

  this._gestureActive = true;
  let vx = velocity.x;
  let vy = velocity.y;
  // ... rest of existing implementation
```

### What to watch out for

**The elastic animator must animate elastic offset, not camera position.** The primary `CameraAnimator` (stiffness 200) animates `camera.x/y` for the original Phase 3 snap-back from mouse drag. The elastic animator (stiffness 400) should animate `camera.elasticOffsetX/Y` toward zero. If both animators write to `camera.x/y`, they will fight. Verify this separation is clean before proceeding.

**The velocity clamp changes the feel of fast releases.** Without the clamp, a fast release produced a dramatic (and broken) overshoot. With the clamp, a fast release produces a firm but controlled snap-back. The spring still has real velocity (up to the critical threshold), so it still feels responsive. But testers who are used to the broken overshoot behavior will notice the change. This is correct; the old behavior was a bug, not a feature.

### Tests for Phase S2

1. **Spring with zero velocity never overshoots.** Sample the spring at 1ms intervals from t=0 to t=1000ms. Assert `position` never crosses zero (for positive initial displacement).

2. **Spring with clamped velocity never overshoots.** Set displacement = 50, velocity = -3000 (exceeds -omega * 50 = -1000). Clamp. Sample the spring. Assert `position >= 0` at all time steps.

3. **Unclamped velocity would overshoot.** Without the clamp, the same conditions produce `position < 0` at some time step. This test documents the bug that the clamp fixes.

4. **Coast velocity is capped at 3000 px/s.** Start inertial coast with velocity `{x: 5000, y: 0}`. Assert the actual initial velocity used is 3000.

5. **Integration test: fast swipe at map edge does not bounce to wrong side.** Pan to map edge. Dispatch rapid wheel events simulating a fast swipe past the boundary. Wait for animations to settle. Assert camera position is at or near the boundary, not on the opposite side.

---

## Phase S3: Speculative snap-back and momentum detection {#phase-s3}

**Fixes:** Bug #1 (freeze before snap-back)
**Impact:** High. Eliminates the most common complaint.
**Risk:** Medium. Timing-sensitive code requires careful testing.
**Estimated LOC:** ~80

### The philosophy

The current system waits for the `TrackpadGestureDetector` to formally detect momentum onset (3 consecutive decaying deltas after 6+ events) and then gesture end (100ms silence after momentum). Only then does snap-back begin. This creates a visible freeze because the elastic offset is held at its maximum displacement while the detector runs its course.

The insight from the research is that **you do not need to detect momentum to start snap-back**. You only need to detect that the rate of overscroll growth has dropped. If the elastic offset stopped growing, the user is either lifting their fingers (and momentum is beginning) or has already stopped. Either way, the correct visual response is to start moving back toward zero.

The speculative snap-back approach works on every animation frame:

1. Track an exponentially weighted moving average (EWMA) of the elastic offset's rate of change.
2. When the EWMA drops below a threshold and elastic offset is nonzero, start a gentle snap-back.
3. If new active input arrives (the user is still scrolling), cancel the snap-back and follow the input.
4. If no new input arrives, the snap-back accelerates into the full spring animation.

The formal `TrackpadGestureDetector` still runs in parallel for state management (it drives `_gestureActive` and the gesture state machine). But it no longer gates the visual response.

### Improved momentum detection in TrackpadGestureDetector

Before adding speculative snap-back, tighten the momentum detector itself:

```javascript
// In vtt/js/trackpad-gesture.js, update constants:

const DECAY_STREAK_THRESHOLD = 2;       // Was 3. Two consecutive decays is enough.
const MIN_EVENTS_FOR_MOMENTUM = 4;      // Was 6. Faster detection.
const TIMEOUT_ACTIVE_MS = 80;           // Was 150. Tighter timeout.
const TIMEOUT_MOMENTUM_MS = 60;         // Was 100. Tighter momentum timeout.
```

These tighter constants reduce detection latency from ~200ms to ~80ms. The tradeoff is slightly more false-positive momentum detection (detecting momentum during a pause in active scrolling), but speculative snap-back makes false positives cheap: the snap-back simply gets cancelled when active scrolling resumes.

### The speculative snap-back system

Add these properties to the Camera constructor:

```javascript
// Phase S3: speculative snap-back
this._elasticEWMA = 0;          // EWMA of elastic offset magnitude change rate
this._lastElasticMagnitude = 0; // Previous frame's total elastic magnitude
this._speculativeSnapId = null; // rAF ID for speculative snap-back
```

Add a method that runs on every frame when elastic offset is nonzero:

```javascript
/**
 * Check whether elastic offset growth has stalled and start
 * speculative snap-back if so. Called from the render loop or
 * a dedicated animation frame when elastic offset is nonzero.
 *
 * The EWMA smooths noisy per-frame changes. When it drops below
 * the threshold, we start a gentle snap-back. If new input arrives,
 * _feedElasticOverflow() cancels the speculative snap-back and
 * continues following the gesture.
 */
_checkSpeculativeSnapBack() {
  const magnitude = Math.sqrt(
    this.elasticOffsetX ** 2 + this.elasticOffsetY ** 2
  );
  const delta = magnitude - this._lastElasticMagnitude;
  this._lastElasticMagnitude = magnitude;

  // EWMA with alpha = 0.3 (responds quickly to changes)
  this._elasticEWMA = 0.3 * Math.abs(delta) + 0.7 * this._elasticEWMA;

  // If elastic offset exists but is barely changing, start snap-back
  const STALL_THRESHOLD = 0.5; // world-space px per frame
  if (magnitude > 1.0 && this._elasticEWMA < STALL_THRESHOLD) {
    // Only start if we are not already snapping back
    if (!this._elasticAnimator?._rafId) {
      this._snapBackElastic();
    }
  }

  // Keep checking while elastic offset exists
  if (magnitude > 0.5) {
    this._speculativeSnapId = requestAnimationFrame(
      () => this._checkSpeculativeSnapBack()
    );
  } else {
    this._speculativeSnapId = null;
  }
}

/**
 * Cancel any speculative snap-back (called when new input arrives).
 */
_cancelSpeculativeSnapBack() {
  if (this._speculativeSnapId) {
    cancelAnimationFrame(this._speculativeSnapId);
    this._speculativeSnapId = null;
  }
  if (this._elasticAnimator?._rafId) {
    this._elasticAnimator.cancel();
  }
}
```

### Wiring speculative snap-back into the gesture lifecycle

Modify `_feedElasticOverflow()` to start monitoring and cancel any running speculative snap-back:

```javascript
_feedElasticOverflow(overflowX, overflowY) {
  if (!this._gestureActive) return;

  // Cancel any speculative snap-back; user is still providing input
  this._cancelSpeculativeSnapBack();

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

  // Start speculative snap-back monitoring if not already running
  if (!this._speculativeSnapId && (this.elasticOffsetX !== 0 || this.elasticOffsetY !== 0)) {
    this._lastElasticMagnitude = Math.sqrt(
      this.elasticOffsetX ** 2 + this.elasticOffsetY ** 2
    );
    this._elasticEWMA = 10; // Start high to prevent immediate snap-back
    this._speculativeSnapId = requestAnimationFrame(
      () => this._checkSpeculativeSnapBack()
    );
  }
}
```

### What to watch out for

**The EWMA alpha value (0.3) is a tuning parameter.** Too high (close to 1.0) and the EWMA reacts instantly to noise, triggering premature snap-back during active scrolling. Too low (close to 0.0) and the EWMA lags behind actual changes, delaying snap-back. 0.3 is a starting point. Test with real trackpad gestures and tune.

**The stall threshold (0.5 world px/frame) depends on zoom level.** At high zoom, world-space units are small; at low zoom, they are large. The threshold should perhaps be in screen pixels instead:

```javascript
const STALL_THRESHOLD_SCREEN = 0.5; // screen px per frame
const STALL_THRESHOLD = STALL_THRESHOLD_SCREEN / this.zoom;
```

**Race condition between speculative snap-back and formal gesture end.** When the `TrackpadGestureDetector` fires `onGestureEnd`, it also calls `_snapBackElastic()`. If speculative snap-back already started, you get a double snap-back. Guard against this by checking whether the elastic animator is already running in `_snapBackElastic()`:

```javascript
_snapBackElastic(velocity = { vx: 0, vy: 0 }) {
  // Don't restart if already animating (speculative snap-back may have started)
  if (this._elasticAnimator?._rafId && velocity.vx === 0 && velocity.vy === 0) {
    return; // Let the running animation continue
  }
  // ... rest of existing implementation
```

### Tests for Phase S3

1. **Speculative snap-back starts within 3 frames of stall.** Set elastic offset to 50px. Call `_checkSpeculativeSnapBack()` with zero delta for 3 consecutive frames. Assert elastic animator is running.

2. **New input cancels speculative snap-back.** Start speculative snap-back. Call `_feedElasticOverflow()` with nonzero overflow. Assert elastic animator is cancelled and elastic offset follows the new input.

3. **Integration test: overscroll resolves within 200ms of finger lift.** Pan past boundary. Stop dispatching events. Measure time until elastic offset reaches zero. Assert < 300ms (was 1-2 seconds).

4. **EWMA does not trigger during active scrolling.** Feed continuous overflow at constant rate. Assert speculative snap-back does not start (EWMA stays above threshold).

---

## Phase S4: Hierarchical gesture coordination with hysteresis {#phase-s4}

**Fixes:** Remaining aspects of bug #5 (erratic behavior during gesture transitions)
**Impact:** Medium. Addresses edge cases and transitions.
**Risk:** Medium. The state machine interacts with everything.
**Estimated LOC:** ~100

### The philosophy

The current `GestureStateMachine` uses flat priority-based preemption: any higher-priority gesture cancels any lower-priority one. This works for clear-cut cases (mouse drag preempts scroll, which preempts snap-back) but fails during rapid transitions between gestures of similar priority (scroll vs zoom) because there is no cost to switching. The system oscillates between modes on consecutive events.

Control theory calls this "chattering" and solves it with **minimum dwell time** (the system must stay in a mode for a minimum period before switching) and **bumpless transfer** (when switching modes, interpolate outputs over a short blend period to prevent discontinuities). Flutter's gesture arena uses an analogous approach: a gesture must accumulate enough evidence (exceed a slop threshold) before it can win the arena, and once won, the arena is locked until the gesture ends.

The restructured state machine adds three mechanisms:

1. **Hysteresis between scroll and zoom.** After the system commits to scroll-pan, it requires a **minimum dwell time of 80ms** before accepting a reclassification as zoom. During this dwell time, events continue as scroll-pan regardless of what the classifier says. Vice versa for zoom.

2. **Gesture cooldown.** After any gesture ends, a 50ms blackout period prevents a new gesture of a different type from starting immediately. This prevents the rapid gesture-type switching that causes erratic behavior.

3. **Hierarchical states.** User gestures (PAN, ZOOM) always immediately preempt animations (INERTIA, SNAP_BACK, ZOOM_ANIMATE). No dwell time or cooldown applies to this preemption, ensuring the system always feels responsive to direct input.

### The restructured GestureStateMachine

```javascript
// ============================================================
// Gesture State Machine (Phase S4 restructure)
// ============================================================

const GESTURE_PRIORITY = {
  IDLE: 0,
  SNAP_BACK: 1,
  INERTIA: 2,
  ZOOM_ANIMATE: 3,
  SCROLL_PAN: 4,
  PINCH_ZOOM: 5,
  DRAG_PAN: 6
};

// Gestures in the "user input" tier (cannot be preempted by animations)
const USER_GESTURES = new Set(['SCROLL_PAN', 'PINCH_ZOOM', 'DRAG_PAN']);
// Gestures in the "animation" tier (preempted by any user gesture)
const ANIMATION_GESTURES = new Set(['SNAP_BACK', 'INERTIA', 'ZOOM_ANIMATE']);

const DWELL_TIME_MS = 80;     // Minimum time before allowing mode switch
const COOLDOWN_MS = 50;       // Blackout after gesture end

class GestureStateMachine {
  constructor(camera) {
    this._camera = camera;
    this._activeGesture = 'IDLE';
    this._gestureStartTime = 0;
    this._lastGestureEndTime = 0;
    this._lastEndedGesture = 'IDLE';
  }

  /**
   * Request a gesture mode. Returns true if granted.
   *
   * Rules:
   * 1. User gestures always preempt animations (no dwell/cooldown).
   * 2. Same gesture type is always accepted (retargeting).
   * 3. Different user gesture types require dwell time to have elapsed.
   * 4. After any gesture ends, a cooldown prevents different-type starts.
   * 5. Higher priority within the same tier always wins after dwell.
   */
  request(gesture) {
    const now = performance.now();
    const newPriority = GESTURE_PRIORITY[gesture];
    const currentPriority = GESTURE_PRIORITY[this._activeGesture];

    // Same gesture: always accept (retarget)
    if (gesture === this._activeGesture) return true;

    // User gesture preempting animation: always accept immediately
    if (USER_GESTURES.has(gesture) && ANIMATION_GESTURES.has(this._activeGesture)) {
      this._cancelCurrent();
      this._activate(gesture, now);
      return true;
    }

    // User gesture replacing different user gesture: check dwell time
    if (USER_GESTURES.has(gesture) && USER_GESTURES.has(this._activeGesture)) {
      const dwellElapsed = now - this._gestureStartTime;
      if (dwellElapsed < DWELL_TIME_MS && newPriority <= currentPriority) {
        return false; // Too soon to switch, and not higher priority
      }
      // Higher priority or dwell time elapsed: allow switch
      if (newPriority >= currentPriority) {
        this._cancelCurrent();
        this._activate(gesture, now);
        return true;
      }
      return false;
    }

    // Starting from IDLE: check cooldown
    if (this._activeGesture === 'IDLE') {
      const cooldownElapsed = now - this._lastGestureEndTime;
      // Cooldown only blocks switching to a different type than last ended
      if (cooldownElapsed < COOLDOWN_MS && gesture !== this._lastEndedGesture) {
        // During cooldown, allow the same gesture type to restart
        // but block different types
        return false;
      }
      this._activate(gesture, now);
      return true;
    }

    // Animation replacing animation: priority decides
    if (newPriority >= currentPriority) {
      this._cancelCurrent();
      this._activate(gesture, now);
      return true;
    }

    return false;
  }

  release(gesture) {
    if (this._activeGesture === gesture) {
      this._lastEndedGesture = gesture;
      this._lastGestureEndTime = performance.now();
      this._activeGesture = 'IDLE';
    }
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
        this._camera._cancelSpeculativeSnapBack();
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

### Fixing coordinate contamination in SmoothZoomAnimator

The `SmoothZoomAnimator` uses `screenToWorld()` to capture the zoom anchor point. `screenToWorld()` uses `this.visualX/Y`, which includes the elastic offset. During elastic overscroll, this means the zoom anchor is computed relative to the visually displaced camera, not the logical camera. The result is that zoom operations during elastic overscroll drift the anchor point.

Add logical coordinate conversion methods:

```javascript
/**
 * Convert screen coordinates to world coordinates using LOGICAL
 * camera position (ignoring elastic offset). Use this for operations
 * that should target the actual map position, not the visually
 * displaced position.
 */
logicalScreenToWorld(sx, sy) {
  return {
    x: sx / this.zoom + this.x,
    y: sy / this.zoom + this.y
  };
}
```

Update `SmoothZoomAnimator.onWheelZoom()`:

```javascript
onWheelZoom(dz, screenX, screenY) {
  const direction = dz < 0 ? 1 : -1;
  const factor = Math.pow(ZOOM_PER_NOTCH, Math.abs(dz) * direction);
  const minZoom = this._camera._getMinZoom();
  this._targetZoom = Math.max(minZoom, Math.min(MAX_ZOOM, this._targetZoom * factor));

  this._anchor.sx = screenX;
  this._anchor.sy = screenY;
  // Use logical position to avoid elastic offset contamination
  const worldPt = this._camera.logicalScreenToWorld(screenX, screenY);
  this._anchor.wx = worldPt.x;
  this._anchor.wy = worldPt.y;

  if (!this._animating) {
    this._animating = true;
    this._rafId = requestAnimationFrame(this._step);
  }
}
```

### What to watch out for

**The dwell time (80ms) must be less than the perception threshold (100ms).** If it is higher, users perceive the dwell as input lag. 80ms is one or two frames below the threshold, enough to filter oscillation without being perceptible.

**The cooldown (50ms) should not affect same-gesture restarts.** If the user finishes a scroll gesture and immediately starts a new scroll gesture, the cooldown should not block it. The cooldown only blocks switching to a *different* gesture type. The implementation above handles this: `gesture !== this._lastEndedGesture` is the check.

**`_cancelCurrent` now cancels speculative snap-back.** Make sure `_cancelSpeculativeSnapBack()` exists (added in Phase S3) before deploying Phase S4.

### Tests for Phase S4

1. **Dwell time prevents rapid mode switching.** Start SCROLL_PAN. Immediately request ZOOM_ANIMATE (lower priority). Assert request is denied.

2. **Dwell time expires and allows mode switch.** Start SCROLL_PAN. Wait 100ms. Request ZOOM_ANIMATE. Assert request is denied (lower priority). Request PINCH_ZOOM (higher priority). Assert granted.

3. **User gesture always preempts animation.** Start ZOOM_ANIMATE. Request SCROLL_PAN. Assert immediately granted (no dwell needed).

4. **Cooldown blocks different gesture type after end.** End SCROLL_PAN. Immediately request ZOOM_ANIMATE. Assert denied. Wait 60ms. Request ZOOM_ANIMATE. Assert granted.

5. **Same gesture type restarts through cooldown.** End SCROLL_PAN. Immediately request SCROLL_PAN. Assert granted (cooldown does not block same type).

6. **Integration test: rapid scroll-then-pinch does not oscillate.** Dispatch alternating scroll and pinch events rapidly. Assert the gesture state machine settles to one mode and does not alternate.

---

## Phase S5: Unified spring physics and beyond-parity features {#phase-s5}

**Status:** IMPLEMENTED (2026-02-23)

**Fixes:** Future-proofing and quality-of-life improvements
**Impact:** Medium to high for polish; sets the foundation for Phase 7+
**Risk:** Medium. Larger refactor with broad surface area.
**Estimated LOC:** ~200

### The philosophy

This phase is about unification and refinement. The camera currently has three separate animation systems: `CameraAnimator` (spring snap-back for camera position), the elastic animator (spring snap-back for elastic offset), and `SmoothZoomAnimator` (log-space lerp for zoom). Each has its own rAF loop, its own concept of "running" and "settled," and its own interruption semantics. When these systems interact (which they do constantly), the coordination logic in the `GestureStateMachine` must know about all of them.

Apple's "Designing Fluid Interfaces" insight is that a single spring integrator per animated property, with dynamically adjustable parameters, replaces all of this complexity. Instead of three animation systems coordinated by a state machine, you have one spring per axis that continuously resolves toward its current target. Changing the target is instantaneous. Changing the spring parameters (stiffness, damping) is instantaneous. Velocity continuity is automatic because the spring always starts from wherever it currently is.

This phase also adds two features that no current VTT provides: a user preference for scroll-wheel behavior (matching Figma's approach) and cooperative gesture handling for embedded contexts (matching Google Maps).

### Simplified cumulative overflow

Replace the complex overflow accumulation with a clean model. The current code has a 0.8 decay factor that creates discontinuous jumps:

```javascript
// NEW panBy() overflow logic (replaces the existing overflow tracking)
panBy(dx, dy) {
  const rawX = this.x - dx / this.zoom;
  const rawY = this.y - dy / this.zoom;

  this.x = rawX;
  this.y = rawY;
  this._applyConstraints();

  const overflowX = rawX - this.x;
  const overflowY = rawY - this.y;

  if (this._gestureActive) {
    // Simple accumulation: add overflow, reset on direction change
    if (overflowX !== 0) {
      if (Math.sign(overflowX) !== Math.sign(this._cumulativeOverflowX)
          && this._cumulativeOverflowX !== 0) {
        // Direction reversed: hard reset
        this._cumulativeOverflowX = overflowX;
      } else {
        this._cumulativeOverflowX += overflowX;
      }
    } else if (Math.abs(this._cumulativeOverflowX) > 0) {
      // No overflow this frame but we have accumulated overflow:
      // this means the user scrolled back from the boundary.
      // Reduce proportionally to input magnitude.
      const inputMagnitude = Math.abs(dx / this.zoom);
      const reduction = Math.min(inputMagnitude, Math.abs(this._cumulativeOverflowX));
      this._cumulativeOverflowX -= Math.sign(this._cumulativeOverflowX) * reduction;
    }

    // Same logic for Y
    if (overflowY !== 0) {
      if (Math.sign(overflowY) !== Math.sign(this._cumulativeOverflowY)
          && this._cumulativeOverflowY !== 0) {
        this._cumulativeOverflowY = overflowY;
      } else {
        this._cumulativeOverflowY += overflowY;
      }
    } else if (Math.abs(this._cumulativeOverflowY) > 0) {
      const inputMagnitude = Math.abs(dy / this.zoom);
      const reduction = Math.min(inputMagnitude, Math.abs(this._cumulativeOverflowY));
      this._cumulativeOverflowY -= Math.sign(this._cumulativeOverflowY) * reduction;
    }

    this._feedElasticOverflow(this._cumulativeOverflowX, this._cumulativeOverflowY);
    EventBus.emit('camera:changed');
  }
}
```

The key change: instead of a fixed 0.8 decay per frame (which creates jerky jumps because it runs at frame rate regardless of input rate), the overflow drains proportionally to the user's input when they scroll back from the boundary. This creates a smooth, input-correlated reduction that feels natural.

### User preference for scroll-wheel behavior

Figma's most elegant design decision is offering a user preference toggle: "Scroll wheel zooms." Trackpad users leave it off (scroll = pan). Mouse users turn it on (scroll = zoom). This sidesteps the entire device classification problem for users who know which device they use.

Add a configuration option to the Camera:

```javascript
// In Camera constructor:
this._scrollWheelBehavior = 'auto'; // 'auto' | 'pan' | 'zoom'
```

In the wheel handler:

```javascript
// In the non-ctrl path of the wheel handler:
if (dx !== 0 || dy !== 0) {
  let behavior;
  if (this._scrollWheelBehavior === 'auto') {
    // Use the stateful classifier
    const device = this._wheelClassifier.classify(e);
    behavior = device === 'mouse' ? 'zoom' : 'pan';
  } else {
    behavior = this._scrollWheelBehavior;
  }

  if (behavior === 'zoom') {
    const screen = this.eventToScreen(e);
    if (this._gestures) this._gestures.request('ZOOM_ANIMATE');
    this._smoothZoom.onWheelZoom(dy / 100, screen.x, screen.y);
  } else {
    this._trackpadDetector.handleWheel(e);
    this.panBy(-dx, -dy);
  }
}
```

This preference can be exposed in the DM Guide settings panel. The 'auto' default uses the classifier; 'pan' and 'zoom' override it entirely.

### Elastic ceiling

Add a hard ceiling to elastic offset to prevent extreme displacements:

```javascript
// In _feedElasticOverflow(), after computing dampened values:
const MAX_ELASTIC_SCREEN_PX = 150; // Never show more than 150px of overscroll
const maxElastic = MAX_ELASTIC_SCREEN_PX / this.zoom;

this.elasticOffsetX = Math.max(-maxElastic, Math.min(maxElastic, this.elasticOffsetX));
this.elasticOffsetY = Math.max(-maxElastic, Math.min(maxElastic, this.elasticOffsetY));
```

### What to watch out for

**The overflow reduction logic must handle the case where the user scrolls back from one boundary and immediately hits the opposite boundary.** This happens on small maps at high zoom. The cumulative overflow resets on direction change, which handles this correctly.

**The user preference toggle needs a way to be set.** In the DM Guide, this could be a dropdown in the settings panel. For now, it can be set programmatically via `camera._scrollWheelBehavior = 'pan'`.

### Long-term: toward a unified spring integrator

The full unification (one spring per axis replacing all animation systems) is a larger refactor that should wait until after the stabilization phases are validated. Here is the conceptual design for future reference:

```javascript
// Conceptual: Unified Spring per axis
// Each axis has one spring that continuously resolves toward its target.
// Changing target, stiffness, or initial velocity is instant.
// No explicit animation start/stop lifecycle.

class AxisSpring {
  constructor() {
    this.value = 0;
    this.velocity = 0;
    this.target = 0;
    this.stiffness = 200;
    this.damping = 1.0; // 1.0 = critical
  }

  setTarget(target, preserveVelocity = true) {
    // Instantly change the target.
    // The spring resolves toward the new target from the current
    // value and velocity. No discontinuity.
    this.target = target;
  }

  step(dt) {
    const omega = Math.sqrt(this.stiffness);
    const displacement = this.value - this.target;
    // Closed-form critically damped spring for this timestep
    const A = displacement;
    const B = this.velocity + omega * displacement;
    const exp = Math.exp(-omega * dt);
    this.value = this.target + (A + B * dt) * exp;
    this.velocity = (B - omega * (A + B * dt)) * exp;
  }

  get settled() {
    return Math.abs(this.value - this.target) < 0.5
        && Math.abs(this.velocity) < 0.5;
  }
}
```

With this model, inertial coast becomes "set target to current position with high initial velocity and low stiffness (friction only)." Snap-back becomes "set target to zero with high stiffness." Smooth zoom becomes "set target to desired zoom with medium stiffness." All three are the same operation with different parameters.

---

## Testing strategy across all phases {#testing-strategy}

### Unit tests (fast, deterministic, no browser)

All unit tests run inside `page.evaluate()` in Playwright, importing the modules directly. They test mathematical correctness without timing dependencies.

- `WheelDeviceClassifier`: signal scoring, hysteresis, silence reset
- `_clampSpringVelocity`: overshoot prevention for various displacement/velocity combinations
- `_solveSpring` with clamped velocity: verify position never crosses target at any time step
- `GestureStateMachine`: dwell time, cooldown, priority preemption, same-gesture retarget
- Cumulative overflow: accumulation, direction reset, proportional reduction

### Integration tests (Playwright, real browser timing)

Integration tests use `page.dispatchEvent()` to simulate wheel events and `page.mouse` for drag operations. They verify behavior across the full pipeline.

- **Fast trackpad scroll does not zoom.** The most critical regression test. Dispatch rapid wheel events with large integer deltas. Assert zoom unchanged, position moved.
- **Fast swipe at boundary does not overshoot.** Pan to edge, swipe past, wait for settle. Assert camera near boundary.
- **Overscroll resolves within 300ms.** Pan past edge, stop input, measure settle time.
- **Scroll-then-pinch transition is clean.** Dispatch scroll events, then pinch events. Assert no oscillation in gesture state.
- **Drag preempts all animations.** Start any animation, then mouse-drag. Assert immediate drag response.

### Manual testing checklist

Because trackpad gesture handling is deeply tied to physical hardware behavior that cannot be perfectly simulated:

1. Slow two-finger scroll on trackpad: camera pans smoothly
2. Fast two-finger scroll on trackpad: camera pans (does NOT zoom)
3. Pinch to zoom on trackpad: camera zooms at cursor
4. Pinch then immediately scroll: transitions cleanly to pan
5. Scroll past map edge: rubber-band visible, snaps back within ~200ms of finger lift
6. Fast swipe past edge: snaps back to boundary, does NOT overshoot to other side
7. Mouse wheel scroll: camera zooms smoothly
8. Ctrl+mouse wheel: camera zooms smoothly
9. Right-click drag past boundary: rubber-band, spring snap-back on release
10. Right-click drag with flick release: inertial coast, then spring snap-back
11. Rapid alternation of scroll and pinch: no erratic behavior
12. Long sustained scroll at boundary: elastic offset reaches ceiling, stays stable
13. Open Controller and Display: elastic effects are local-only, sync is clean

---

## Long-term product development tie-ins {#long-term-tie-ins}

### Phase 7: Touch support via PointerEvent

The `WheelDeviceClassifier` and `GestureStateMachine` from Phases S1 and S4 are the foundation for touch support. Touch gestures (two-finger pinch, two-finger pan) register through PointerEvent, not WheelEvent, so they bypass the wheel classifier entirely. They enter the gesture state machine at PINCH_ZOOM and DRAG_PAN priority levels, which already have the correct preemption semantics.

The key addition is a two-pointer tracker that computes pinch scale and pan translation from PointerEvent streams. The gesture state machine handles the rest.

### Phase 8: Camera presets with spring transitions

The `SmoothZoomAnimator` is already a target-chasing spring in log-space. Camera presets (saved positions that the DM recalls during a session) can use the same principle: set the camera's target position and zoom, and let a spring animate there. The unified spring integrator from Phase S5's long-term vision makes this trivial: `camera.springX.setTarget(preset.x)` with a lower stiffness for a cinematic feel.

### Accessibility

The user preference for scroll-wheel behavior (Phase S5) is also an accessibility feature. Users with motor impairments who cannot perform pinch gestures benefit from being able to zoom with scroll. Users who accidentally trigger zoom while trying to scroll benefit from being able to lock scroll to pan-only mode.

### Embedded VTT

If the VTT is ever embedded in another page (e.g., inside a blog post or a session notes document), cooperative gesture handling (Google Maps' `gestureHandling: 'cooperative'` pattern) becomes essential. The gesture state machine already has the infrastructure for this: add a `COOPERATIVE` mode where non-Ctrl scroll events are passed through to the parent page, and only Ctrl+scroll and direct drag are captured by the VTT. Display a brief overlay: "Use Ctrl + scroll to zoom the map."

### Performance monitoring

The speculative snap-back system (Phase S3) and the gesture state machine (Phase S4) both use `performance.now()` for timing decisions. In production, these timing calls are negligible. But if the VTT ever adds performance monitoring or telemetry, the gesture timing data (how often the classifier changes its mind, how long dwell times last, how often speculative snap-back is cancelled) provides valuable insight into input handling quality.
