# Phase S5: Unified Spring Physics and Beyond-Parity Features
**Status:** IMPLEMENTED (2026-02-23)

## A comprehensive implementation plan for replacing multiple animation systems with a single spring integrator per axis, adding input-proportional overflow drain, user preference scroll-wheel toggle, elastic ceiling, and cooperative gesture handling

**Fixes:** Cumulative overflow discontinuities (the 0.8 decay jerk), elastic offset escaping to extreme values, scroll-wheel behavior locked to classifier output with no user override, no embedded-context support
**Impact:** Medium to high. Eliminates the last class of visual polish issues, adds the scroll preference that Figma users expect, and future-proofs the architecture for Phase 7+ features.
**Risk:** Medium. The spring unification touches every animation path and requires coordinated migration. The cooperative gesture system adds a new behavioral mode. Both are architecturally scoped to avoid cascading changes.
**Estimated LOC:** ~450 (AxisSpring + CameraSpringLoop + overflow rework + scroll preference + elastic ceiling + cooperative overlay + tests)
**Depends on:** Phase S1 (stateful device classification), Phase S2 (velocity-clamped spring snap-back), Phase S3 (speculative snap-back), and Phase S4 (hierarchical gesture coordination). S1 provides the classifier that the scroll preference overrides. S2 provides overshoot protection that the unified spring inherits. S3 provides speculative snap-back that the unified spring subsumes. S4 provides the gesture state machine that the unified spring simplifies.

---

## Table of contents

1. [Why this phase comes fifth](#why-fifth)
2. [The philosophical problem: three animation systems where one should exist](#philosophy)
3. [How production frameworks achieve one-spring-per-axis](#production-approaches)
4. [The mathematics of critically damped springs, revisited for unification](#spring-math)
5. [Complete annotated implementation: AxisSpring](#axis-spring)
6. [Complete annotated implementation: CameraSpringLoop](#spring-loop)
7. [Complete annotated implementation: simplified cumulative overflow with input-proportional drain](#overflow-impl)
8. [Complete annotated implementation: elastic ceiling](#elastic-ceiling)
9. [Complete annotated implementation: scroll-wheel behavior preference](#scroll-pref)
10. [Complete annotated implementation: cooperative gesture handling](#cooperative)
11. [Migrating existing animation callers to the unified spring](#migration-callers)
12. [Edge cases and what to watch out for](#watch-out)
13. [Testing protocols](#testing)
14. [Long-term tie-ins to future phases](#long-term)
15. [Migration checklist for Claude Code](#migration)

---

## 1. Why this phase comes fifth {#why-fifth}

Phases S1 through S4 fixed the visible bugs: misclassified input, spring overshoot, the elastic freeze, and gesture transition chattering. Phase S5 fixes the invisible architecture underneath. The camera currently runs three separate animation systems: `CameraAnimator` (critically damped spring for camera position snap-back), the elastic animator (a second critically damped spring for elastic offset snap-back), and `SmoothZoomAnimator` (log-space lerp for smooth zoom). Each owns its own `requestAnimationFrame` loop, its own concept of "running" and "settled," and its own cancellation semantics. The `GestureStateMachine` from Phase S4 knows about all three, and its `_cancelCurrent()` method is a switch statement with a case per animation system.

This works, but it creates three problems that compound over time.

First, interruption between animation systems produces discontinuities. When the user zooms during an elastic snap-back, `_cancelCurrent()` hard-cancels the elastic animator, zeroing out the spring's velocity. The elastic offset snaps to wherever it was, rather than smoothly resolving. The correct behavior is to let the elastic spring continue resolving while the zoom changes, because the two animations operate on independent axes. But independent rAF loops cannot coordinate their lifecycles without the kind of central orchestration that defeats the purpose of separating them.

Second, the cumulative overflow system uses a 0.8 per-frame decay factor that creates visible discontinuities. The decay runs once per animation frame regardless of how fast the user is scrolling, which means the visual drain rate varies with frame rate and input rate. On a 144Hz display, overflow drains faster than on 60Hz because the decay compounds more times per second. And when the user reverses scroll direction at the boundary, the transition from "accumulating" to "draining" is abrupt because the decay model has no concept of input-proportional reduction.

Third, there is no escape hatch for the scroll-wheel classification. The stateful classifier from Phase S1 is excellent for most hardware, but some users have exotic setups (gaming mice with free-spinning wheels, drawing tablets with scroll rings) that defy heuristic classification. Figma solved this years ago with a simple toggle: "Scroll wheel zooms." This phase adds that toggle along with an 'auto' mode that uses the classifier.

The ordering matters for two specific reasons. Phase S5's unified spring subsumes the elastic animator and `CameraAnimator` that Phases S2 and S3 patched. The velocity clamping from S2 becomes a constraint on the spring's initial velocity when transitioning to snap-back mode. The speculative snap-back from S3 becomes a target change on the elastic spring axis rather than a separate animation launch. If S5 were implemented before S2 and S3, those fixes would need to be reimplemented within the new architecture rather than simply inherited.

Phase S5 also simplifies Phase S4's `_cancelCurrent()`. Instead of knowing about each animation system's cancel API, the gesture state machine sets the spring target to the current position with zero velocity. The spring is already there, so it stops. No explicit cancellation, no cleanup, no state flags. This simplification only works if Phase S4's gesture coordination is already correct, because removing the explicit cancellation assumes that the gesture state machine is not creating the races and chattering that S4 eliminated.

---

## 2. The philosophical problem: three animation systems where one should exist {#philosophy}

### Why separate animation systems fight each other

The current camera has three objects that own `requestAnimationFrame` loops: `CameraAnimator`, the elastic animator (also a `CameraAnimator` instance with different stiffness), and `SmoothZoomAnimator`. Each advances independently at approximately 60Hz. When the user performs a complex gesture sequence (drag past boundary, release, then immediately zoom), the three systems need to coordinate.

Consider what happens today. The user drags past the right boundary, creating 40px of elastic offset. They release. The elastic animator starts its spring, pulling the elastic offset toward zero. The `GestureStateMachine` transitions to SNAP_BACK. The elastic animator's rAF loop runs, reducing `elasticOffsetX` from 40 toward 0 over roughly 200ms.

Now, 100ms into the snap-back, the user Ctrl+scrolls to zoom. The gesture state machine transitions from SNAP_BACK to ZOOM_ANIMATE. `_cancelCurrent()` fires, which calls `this._camera._elasticAnimator.cancel()`. The elastic animator's rAF is cancelled. `elasticOffsetX` freezes at whatever value it had at the instant of cancellation, say 15px. The `SmoothZoomAnimator` starts its own rAF loop for the zoom animation. But nothing is resolving the remaining 15px of elastic offset. The user sees the viewport stuck 15px to the right of where it should be, with no spring pulling it back, until the next gesture that happens to trigger a snap-back.

The fix in the current architecture is to add special-case logic: when cancelling SNAP_BACK due to a zoom, manually schedule a new snap-back after the zoom completes. This is a patch on a patch. The real fix is structural.

### The Apple insight: one spring per property

Apple's WWDC 2018 "Designing Fluid Interfaces" talk (Session 803) makes the case that springs should be the universal primitive for all interactive animations. The key insight is that a spring is not an animation, it is a physical system that continuously resolves toward a target. You do not start and stop a spring. You set its target, and it moves. You change the target, and it changes course without losing velocity. You change the target again, and it changes course again. The spring is always running (conceptually), always tracking, always smooth.

This eliminates the entire lifecycle management problem. There is no "start animation," "cancel animation," "is animation running" API surface. There is only "set target." The loop runs while any spring is unsettled and stops when all springs are at rest. A zoom during elastic snap-back simply changes the zoom spring's target. The elastic spring keeps resolving independently because it is a separate spring on a separate axis.

The current architecture inverts this relationship. It treats animations as discrete operations with start/end semantics, and then struggles to manage overlapping operations. The unified spring architecture treats animation as the natural consequence of target changes, and overlapping changes are handled automatically because each axis is independent.

### What "unified" means in practice

Unification does not mean one spring object doing three things. It means three independent springs (panX, panY, logZoom) that share a single tick function, a single rAF loop, and a single concept of "settled." Each spring has its own position, velocity, target, and stiffness. The tick function advances all three, writes one camera state update, and emits one `camera:changed` event. If only one spring is unsettled (e.g., elastic snap-back on X while Y and zoom are at rest), the loop still runs, but the Y and zoom springs produce no change because they are already at their targets.

For Phase S5, the elastic offset springs operate as additional axes alongside the camera position springs. The camera effectively has five spring axes: `x`, `y`, `logZoom`, `elasticX`, and `elasticY`. The first three track the camera's logical position. The last two track the visual displacement from elastic overscroll. This separation preserves the dual-position model from Phase 6 (logical position vs. visual position) while unifying the animation infrastructure.

---

## 3. How production frameworks achieve one-spring-per-axis {#production-approaches}

### React Spring

React Spring's `SpringValue<T>` class is the single primitive. It stores a current value, a current velocity, a goal, and configuration (tension, friction, mass). The `.start({ to: newTarget })` method changes the goal. If the spring is already animating toward a different target, the current position and velocity carry forward. No discontinuity. The `FrameLoop` class (published as the `@react-spring/rafz` package) runs a single `requestAnimationFrame` that advances all active `SpringValue` instances. It auto-starts when the first spring becomes active and auto-stops when the last spring settles.

The default configuration is tension: 170, friction: 26, mass: 1, which yields a damping ratio of approximately 0.997, effectively critically damped. The threshold for "settled" is configurable via `restDelta` (default: 0.01 for numeric springs) and `restSpeed` (default: 0.01). Both must be satisfied simultaneously.

### Android DynamicAnimation

Android's `SpringAnimation` class pairs with a `SpringForce` object that holds stiffness and damping ratio. The `animateToFinalPosition(float target)` method is the core API. Calling it on a running spring updates the target and continues from the current state. The system uses `DAMPING_RATIO_NO_BOUNCY = 1.0` for critically damped behavior and `STIFFNESS_MEDIUM = 1500` as a common default. The `MinimumVisibleChange.PIXELS = 1.0` defines the settling threshold.

### Apple UIKit / SwiftUI

`UIViewPropertyAnimator` with a `UISpringTimingParameters` is the UIKit approach. SwiftUI's `withAnimation(.spring())` defaults to `dampingFraction: 1.0, stiffness: 1.0`. The WWDC 2018 talk explicitly recommends that every UI animation be a spring, because springs are the only animation type that maintains position and velocity continuity across interruptions.

### Facebook Pop

Pop's `POPSpringAnimation` uses bounciness (0-20) and speed (0-20) scales that convert to tension and friction internally. The key architectural detail: animations are keyed by property name. Starting a new spring on the same property as a running spring replaces it with state continuity. This is the "one spring per animated property" pattern.

### The pattern that emerges

Every framework converges on the same architecture:

1. One spring instance per animated property
2. Changing the target preserves current position and velocity
3. A single loop advances all springs per frame
4. The loop auto-starts and auto-stops based on settlement
5. Settlement requires both position and velocity to be below thresholds

Phase S5 adopts this exact architecture.

---

## 4. The mathematics of critically damped springs, revisited for unification {#spring-math}

### The closed-form solution

Phase S2 introduced the spring ODE and its critically damped solution. Phase S5 uses the same math, so this section is a concise reference for the implementation.

The damped harmonic oscillator:

```
x''(t) + 2ζω₀·x'(t) + ω₀²·x(t) = 0
```

For critical damping (ζ = 1), the solution is:

```
x(t) = (A + B·t) · e^(-ω₀·t)

where:
  A = x₀                    (initial displacement from target)
  B = v₀ + ω₀·x₀           (initial velocity contribution)
  ω₀ = √(stiffness/mass)    (natural frequency)
```

The velocity at time t:

```
v(t) = (B - ω₀·(A + B·t)) · e^(-ω₀·t)
```

For Phase S5's `AxisSpring.advance(dt)` method, `t` is the timestep (not elapsed time from start), and the computation resets initial conditions each frame. This is mathematically equivalent to the closed-form evaluation but structured for interruption: at any moment, the spring's state is fully described by `(position, velocity)`, and the next step is computed from those values.

### Why closed-form beats Euler for this use case

Semi-implicit Euler (`velocity += acceleration * dt; position += velocity * dt`) accumulates numerical error over time. For a spring that runs for 200ms, this error is negligible. But the unified architecture means a spring might run for seconds (an inertial coast that transitions into a long elastic snap-back). Closed-form evaluation has zero accumulated error because each step is an independent analytical calculation.

Closed-form evaluation is also inherently frame-rate independent. Whether the browser runs at 30fps (dt = 33ms) or 144fps (dt = 7ms), the position after elapsed time T is identical. This matters for the VTT because the Display window might run at a different refresh rate than the Controller.

### Log-space zoom

Zoom is multiplicative: doubling from 1x to 2x should feel the same as doubling from 2x to 4x. A linear spring on zoom would make the 2x-to-4x transition cover twice as much numeric distance and feel twice as fast.

The fix: animate in log-space. The zoom spring's `position` and `target` are `log(zoom)` rather than `zoom` directly. When the caller sets a zoom target of 2.0, the spring target becomes `log(2.0) ≈ 0.693`. The position tracks `log(currentZoom)`. The velocity is in log-zoom-per-second. After each step, the actual zoom is recovered as `exp(springPosition)`.

Initial conditions when the zoom spring is interrupted:

```
logPosition = log(currentZoom)
logTarget = log(targetZoom)
logVelocity = zoomVelocity / currentZoom
```

The `/ currentZoom` conversion accounts for the derivative of `log(z)` being `1/z`. A zoom velocity of 2.0 zoom-units/second at zoom=4.0 translates to `2.0/4.0 = 0.5` log-zoom-units/second.

### Settling thresholds for each axis

The three axis types need different thresholds because their units have different perceptual significance.

**Pan axes (x, y):** 0.5 world-space pixels for position, 0.5 world-space pixels per second for velocity. This matches Phase S2's `SETTLE_THRESHOLD_PX` and ensures sub-pixel convergence.

**Elastic axes (elasticX, elasticY):** 0.5 world-space pixels for position, 0.5 world-space pixels per second for velocity. Same as pan because elastic offset is measured in the same units.

**Zoom axis (logZoom):** 0.001 for position (which is `exp(0.001) ≈ 1.001x`, a 0.1% zoom difference, imperceptible), 0.001 per second for velocity. This is tighter than the pan threshold because zoom differences are more visually salient (they affect every pixel on screen).

---

## 5. Complete annotated implementation: AxisSpring {#axis-spring}

Create this as a new file `vtt/js/axis-spring.js`. It is a standalone module with no dependencies, making it trivially unit-testable.

```javascript
// ============================================================
// AxisSpring — One spring per animated property
// ============================================================
//
// The universal primitive for camera animation. Instead of
// separate systems for snap-back, inertial coast, and smooth
// zoom, each animated property gets one AxisSpring. To change
// behavior, change the target. Velocity carries forward.
//
// Uses the closed-form critically damped spring solution:
//   x(t) = (A + B·t) · e^(-ω₀·t)
//   v(t) = (B - ω₀·(A + B·t)) · e^(-ω₀·t)
//
// This is frame-rate independent by construction — no numerical
// error accumulates, and the position after time T is identical
// whether the browser runs at 30fps or 144fps.
//
// Design principles:
//   - "Current value, current velocity" is the complete state
//   - setTarget() preserves both, creating C¹-continuous motion
//   - Settling requires BOTH position AND velocity below threshold
//   - Zero allocations in the hot path (advance method)

const DEFAULT_STIFFNESS = 200;
const DEFAULT_MASS = 1.0;
const DEFAULT_POSITION_THRESHOLD = 0.5;
const DEFAULT_VELOCITY_THRESHOLD = 0.5;

export class AxisSpring {
  /**
   * @param {object} opts
   * @param {number} [opts.stiffness=200]  Spring constant k
   * @param {number} [opts.mass=1.0]       Mass (rarely changed)
   * @param {number} [opts.positionThreshold=0.5]  Settlement position threshold
   * @param {number} [opts.velocityThreshold=0.5]  Settlement velocity threshold
   */
  constructor(opts = {}) {
    this.position = 0;
    this.velocity = 0;
    this.target = 0;
    this.stiffness = opts.stiffness ?? DEFAULT_STIFFNESS;
    this.mass = opts.mass ?? DEFAULT_MASS;
    this.positionThreshold = opts.positionThreshold ?? DEFAULT_POSITION_THRESHOLD;
    this.velocityThreshold = opts.velocityThreshold ?? DEFAULT_VELOCITY_THRESHOLD;

    // Derived constant: natural frequency
    // Recalculated when stiffness or mass changes (see setStiffness)
    this._omega = Math.sqrt(this.stiffness / this.mass);
  }

  /**
   * Set a new target. The spring will resolve toward this value
   * from whatever position and velocity it currently has.
   *
   * This is THE core operation. No "start animation" or "cancel
   * animation" — just set the target. If the spring was already
   * moving toward a different target, it continues from the
   * current state. Velocity is preserved by default.
   *
   * @param {number} target  The new target value
   * @param {object} [opts]
   * @param {number} [opts.velocity]  Override the current velocity.
   *   Used when seeding a spring from a gesture release velocity.
   */
  setTarget(target, opts) {
    this.target = target;
    if (opts?.velocity !== undefined) {
      this.velocity = opts.velocity;
    }
  }

  /**
   * Set the spring's position directly, without animation.
   * Used when the user is actively dragging (direct manipulation)
   * and the spring should track the input 1:1 rather than animate.
   *
   * Zeroes velocity because direct manipulation implies the user
   * has taken control. When they release, the caller sets a new
   * target and optionally a release velocity.
   */
  setPosition(position) {
    this.position = position;
    this.velocity = 0;
  }

  /**
   * Snap the spring to its target instantly.
   * Used when animation is inappropriate (e.g., responding to
   * window resize or programmatic camera jump).
   */
  snapToTarget() {
    this.position = this.target;
    this.velocity = 0;
  }

  /**
   * Change the spring stiffness. Preserves current position and
   * velocity. Used when switching behavioral modes: elastic
   * snap-back uses higher stiffness (400) than inertial coast
   * (lower stiffness acts as friction-only deceleration).
   *
   * @param {number} stiffness  New spring constant k
   */
  setStiffness(stiffness) {
    this.stiffness = stiffness;
    this._omega = Math.sqrt(this.stiffness / this.mass);
  }

  /**
   * Advance the spring by one timestep using the closed-form
   * critically damped solution.
   *
   * If the spring is settled (both position and velocity within
   * threshold of target), snaps exactly to the target and returns
   * true. Otherwise returns false.
   *
   * This method has zero allocations. It reads four numbers from
   * `this`, computes two exponentials, writes two numbers back.
   * The hot path at 60fps should be ~50ns on modern hardware.
   *
   * @param {number} dt  Timestep in seconds (typically ~0.016)
   * @returns {boolean}  True if the spring has settled
   */
  advance(dt) {
    const displacement = this.position - this.target;
    const velocity = this.velocity;

    // Early exit: already settled
    if (Math.abs(displacement) < this.positionThreshold
        && Math.abs(velocity) < this.velocityThreshold) {
      this.position = this.target;
      this.velocity = 0;
      return true; // settled
    }

    // Closed-form critically damped spring (ζ = 1):
    //   x(t) = (A + B·t) · e^(-ω·t)
    //   v(t) = (B - ω·(A + B·t)) · e^(-ω·t)
    const omega = this._omega;
    const A = displacement;
    const B = velocity + omega * displacement;
    const exp = Math.exp(-omega * dt);

    this.position = this.target + (A + B * dt) * exp;
    this.velocity = (B - omega * (A + B * dt)) * exp;

    // Post-advance settlement check
    // (The pre-advance check handles the "already there" case;
    //  this handles the "just arrived" case.)
    if (Math.abs(this.position - this.target) < this.positionThreshold
        && Math.abs(this.velocity) < this.velocityThreshold) {
      this.position = this.target;
      this.velocity = 0;
      return true;
    }

    return false;
  }

  /**
   * Whether the spring is at rest (at target with no velocity).
   * Used by the loop to determine when to auto-stop.
   */
  get settled() {
    return Math.abs(this.position - this.target) < this.positionThreshold
        && Math.abs(this.velocity) < this.velocityThreshold;
  }
}
```

### Design decisions explained

**Why closed-form rather than semi-implicit Euler?** The spring axis may run for extended periods (an inertial coast can last 2+ seconds), and closed-form has zero accumulated numerical error. It is also trivially frame-rate independent: the position after time T is the same whether computed in 120 steps of 16.67ms or 60 steps of 33.33ms. Semi-implicit Euler would require dt-normalization to achieve approximate frame-rate independence, and the normalization is imperfect for large dt values (tab backgrounding).

**Why the dual settlement check (before and after advance)?** The pre-advance check handles the common case where the spring was snapped to target on the previous frame and nothing has changed. Skipping the exponential computation for settled springs is important when only one of five axes is active, the other four should be free. The post-advance check handles the case where the spring just converged this frame, snapping exactly to target to prevent sub-pixel drift.

**Why `setStiffness` instead of a constructor-only parameter?** Different animation behaviors (snap-back at stiffness 400, inertial coast at effective stiffness ~50) use the same spring instance. Rather than creating and destroying springs, the caller adjusts stiffness when the behavioral mode changes. This preserves the "current value, current velocity" state across mode transitions.

---

## 6. Complete annotated implementation: CameraSpringLoop {#spring-loop}

This is the consolidated `requestAnimationFrame` loop that replaces the three independent loops in `CameraAnimator`, the elastic animator, and `SmoothZoomAnimator`. Add this to a new file `vtt/js/camera-spring-loop.js`.

```javascript
// ============================================================
// CameraSpringLoop — One rAF loop for all camera animation
// ============================================================
//
// Consolidates what was previously three independent rAF loops
// (CameraAnimator, elastic animator, SmoothZoomAnimator) into a
// single loop that advances all spring axes per frame.
//
// Auto-starts when any spring becomes unsettled.
// Auto-stops when ALL springs are settled.
//
// This eliminates the coordination problem where independent loops
// could not batch DOM reads/writes, and where cancelling one loop
// left orphaned state on another axis.

import { AxisSpring } from './axis-spring.js';

const MAX_DT = 0.064;    // Cap dt to ~64ms (handles tab backgrounding)
const MIN_DT = 0.001;    // Floor dt to 1ms (handles performance.now quirks)

// Stiffness presets for different behavioral modes.
// These are the single source of truth — no magic numbers elsewhere.
export const SPRING_STIFFNESS = {
  SNAP_BACK: 400,       // Snappy elastic return (matches existing elastic animator)
  CAMERA_SNAP: 200,     // Camera position snap-back (matches existing CameraAnimator)
  SMOOTH_ZOOM: 300,     // Zoom animation (tuned for scroll-wheel feel)
  INERTIAL: 20,         // Very low: acts as friction-only deceleration
};

export class CameraSpringLoop {
  /**
   * @param {Camera} camera  The Camera instance to update
   */
  constructor(camera) {
    this._camera = camera;
    this._rafId = null;
    this._lastTime = 0;
    this._running = false;

    // The five spring axes.
    // panX/panY: logical camera position (world-space)
    // elasticX/elasticY: elastic offset (world-space)
    // logZoom: zoom in log-space for perceptually uniform animation
    this.panX = new AxisSpring({ stiffness: SPRING_STIFFNESS.CAMERA_SNAP });
    this.panY = new AxisSpring({ stiffness: SPRING_STIFFNESS.CAMERA_SNAP });
    this.elasticX = new AxisSpring({ stiffness: SPRING_STIFFNESS.SNAP_BACK });
    this.elasticY = new AxisSpring({ stiffness: SPRING_STIFFNESS.SNAP_BACK });
    this.logZoom = new AxisSpring({
      stiffness: SPRING_STIFFNESS.SMOOTH_ZOOM,
      positionThreshold: 0.001,
      velocityThreshold: 0.001,
    });

    // Pre-bind the tick method to avoid allocation per frame
    this._tick = this._tick.bind(this);
  }

  /**
   * Ensure the loop is running. Idempotent — calling this when
   * the loop is already running is a no-op.
   *
   * This is the only "start" API. Callers never need to stop the
   * loop explicitly; it stops itself when all springs settle.
   */
  ensureRunning() {
    if (this._running) return;
    this._running = true;
    this._lastTime = 0;
    this._rafId = requestAnimationFrame(this._tick);
  }

  /**
   * Force-stop the loop. Used during cleanup (e.g., when the
   * camera is detached from its element). Normal operation should
   * rely on auto-stop via settlement.
   */
  stop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._running = false;
  }

  /**
   * Sync all spring positions FROM the camera state.
   * Called once during initialization and whenever the camera
   * state is set externally (e.g., BroadcastChannel sync,
   * programmatic setPosition).
   */
  syncFromCamera() {
    const cam = this._camera;
    this.panX.position = cam.x;
    this.panX.target = cam.x;
    this.panX.velocity = 0;

    this.panY.position = cam.y;
    this.panY.target = cam.y;
    this.panY.velocity = 0;

    this.elasticX.position = cam.elasticOffsetX;
    this.elasticX.target = 0;
    this.elasticX.velocity = 0;

    this.elasticY.position = cam.elasticOffsetY;
    this.elasticY.target = 0;
    this.elasticY.velocity = 0;

    this.logZoom.position = Math.log(cam.zoom);
    this.logZoom.target = Math.log(cam.zoom);
    this.logZoom.velocity = 0;
  }

  /**
   * The consolidated tick function.
   * Advances all five springs, writes camera state once,
   * emits one event. Auto-stops when all springs settle.
   *
   * @param {number} timestamp  The rAF timestamp
   */
  _tick(timestamp) {
    // Compute dt with clamping
    if (this._lastTime === 0) this._lastTime = timestamp;
    const rawDt = (timestamp - this._lastTime) / 1000;
    const dt = Math.max(MIN_DT, Math.min(rawDt, MAX_DT));
    this._lastTime = timestamp;

    // Advance all springs
    const panXSettled = this.panX.advance(dt);
    const panYSettled = this.panY.advance(dt);
    const elasticXSettled = this.elasticX.advance(dt);
    const elasticYSettled = this.elasticY.advance(dt);
    const zoomSettled = this.logZoom.advance(dt);

    // Write camera state (one write per frame)
    const cam = this._camera;
    cam.x = this.panX.position;
    cam.y = this.panY.position;
    cam.elasticOffsetX = this.elasticX.position;
    cam.elasticOffsetY = this.elasticY.position;
    cam.zoom = Math.exp(this.logZoom.position);

    // Apply constraints (boundary clamping) after spring update.
    // This keeps the camera within bounds even during animation.
    // The spring may overshoot bounds slightly due to velocity,
    // and the constraint pulls it back immediately.
    cam._applyConstraints();

    // Emit a single change event for all five axes
    cam._emitChanged();

    // Auto-stop when all springs are settled
    const allSettled = panXSettled && panYSettled
                    && elasticXSettled && elasticYSettled
                    && zoomSettled;

    if (allSettled) {
      this._running = false;
      this._rafId = null;
    } else {
      this._rafId = requestAnimationFrame(this._tick);
    }
  }

  /**
   * Whether all springs are at rest.
   */
  get settled() {
    return this.panX.settled
        && this.panY.settled
        && this.elasticX.settled
        && this.elasticY.settled
        && this.logZoom.settled;
  }
}
```

### Design decisions explained

**Why five axes instead of three?** The dual-position model (logical position + elastic offset) is a deliberate architectural choice from Phase 6. The logical position (`x`, `y`) is what gets synced across windows and used for coordinate calculations. The elastic offset (`elasticOffsetX`, `elasticOffsetY`) is a local visual effect that is never transmitted. Keeping them as separate spring axes preserves this separation. The alternative (a single spring per visual axis that combines both) would require disentangling the logical and visual components for every sync event.

**Why `_emitChanged()` instead of `EventBus.emit('camera:changed')`?** The Camera class should own the event emission pattern. The spring loop calls a method on the camera that handles any debouncing, dirty-flag checks, or rendering triggers. This keeps the loop decoupled from the event system.

**Why `syncFromCamera()` as a manual call rather than automatic?** During direct manipulation (the user dragging the map), the camera position is set by the input handler, not by the spring. The spring's position must be kept in sync so that when the user releases, the spring starts from the correct state. But the sync direction is "camera to spring" during input and "spring to camera" during animation. Making this explicit prevents the two from fighting.

**Why MAX_DT = 64ms?** When the user switches tabs, the browser stops calling rAF. On return, the first frame has a massive dt (potentially seconds). Without clamping, the spring would "jump" by computing `(A + B * 5.0) * exp(-omega * 5.0)`, which would settle instantly but with a visual pop. The 64ms cap means the spring advances at most four frames worth in one step, which looks like momentary slowdown rather than a teleport. This matches the pattern used by the existing `_startInertialCoast` (`MAX_DT = 64`).

---

## 7. Complete annotated implementation: simplified cumulative overflow with input-proportional drain {#overflow-impl}

This replaces the current `panBy()` overflow tracking in `map-camera.js`. The key change: instead of a fixed 0.8 decay per frame (which runs at frame rate regardless of input, creating rate-dependent behavior), overflow drains proportionally to the user's reverse-direction input.

### The problem with fixed-rate decay

The current code applies a 0.8 multiplier to cumulative overflow every frame during trackpad momentum. This means overflow decays at `0.8^60 ≈ 0.0000013` per second at 60fps, but `0.8^144 ≈ 1.7e-14` per second at 144fps. The visual drain rate changes with frame rate, which violates the principle of frame-rate independence.

More importantly, the decay is not correlated with user input. When the user scrolls back from the boundary, the overflow drains at the same rate whether they scroll slowly or quickly. The visual feedback does not match the physical gesture, creating a disconnect between input and output.

### Input-proportional drain

The replacement model is simple: when the user scrolls in the opposite direction of the overflow, their input is consumed to reduce the overflow first. Only after the overflow reaches zero does the remaining input pass through to normal scrolling.

This is the pattern Android 12 introduced with `EdgeEffect.onPullDistance(deltaDistance, displacement)`. The method returns the amount of the pull that was consumed by the overscroll effect. The caller subtracts the consumed amount from its scroll delta before passing the remainder to the normal scroll handler.

```javascript
// Replace the overflow tracking in panBy() with this logic.
// This goes inside the Camera class, replacing the existing
// _cumulativeOverflowX/_cumulativeOverflowY handling.

/**
 * Feed pan overflow into the cumulative overflow model.
 * Uses input-proportional drain: reverse-direction input reduces
 * overflow at the rate of input, not at a fixed rate per frame.
 *
 * @param {number} overflow  This frame's overflow (distance past bound, world-space)
 * @param {number} inputDelta  The user's input delta (world-space, signed)
 * @param {number} cumulative  Current cumulative overflow
 * @returns {number}  Updated cumulative overflow
 */
_updateCumulativeOverflow(overflow, inputDelta, cumulative) {
  if (overflow !== 0) {
    // The camera is past the boundary on this axis.
    if (Math.sign(overflow) !== Math.sign(cumulative) && cumulative !== 0) {
      // Direction reversed: the user crossed from one boundary
      // to the opposite. Hard-reset to the new overflow value.
      return overflow;
    }
    // Same direction or first overflow: accumulate.
    return cumulative + overflow;
  }

  // No overflow this frame — the camera is within bounds.
  if (Math.abs(cumulative) < 0.01) {
    // Already drained (or never overflowed). Nothing to do.
    return 0;
  }

  // The user is scrolling back from the boundary.
  // Drain the cumulative overflow proportionally to input magnitude.
  // The sign of inputDelta tells us direction; we only drain when
  // the input is in the opposite direction of the overflow.
  const inputOpposesOverflow = Math.sign(inputDelta) !== Math.sign(cumulative);
  if (!inputOpposesOverflow) {
    // Input is in the same direction as overflow but no new overflow
    // was generated. This means the user is scrolling along the
    // boundary without going further past it. Hold the current value.
    return cumulative;
  }

  // Consume input to reduce overflow. The drain rate equals the
  // input magnitude, so the visual feedback is 1:1 with the gesture.
  const drain = Math.min(Math.abs(inputDelta), Math.abs(cumulative));
  return cumulative - Math.sign(cumulative) * drain;
}
```

### Updated panBy() method

The `panBy()` method in the Camera class uses the above helper. Here is the overflow-relevant portion, replacing the existing overflow tracking:

```javascript
panBy(dx, dy) {
  // Convert screen-space delta to world-space displacement
  const rawX = this.x - dx / this.zoom;
  const rawY = this.y - dy / this.zoom;

  // Apply hard constraints
  this.x = rawX;
  this.y = rawY;
  this._applyConstraints();

  // Compute this frame's overflow (distance between intended and clamped)
  const overflowX = rawX - this.x;
  const overflowY = rawY - this.y;

  if (this._gestureActive) {
    // Input deltas in world-space (for proportional drain)
    const inputDeltaX = dx / this.zoom;
    const inputDeltaY = dy / this.zoom;

    this._cumulativeOverflowX = this._updateCumulativeOverflow(
      overflowX, inputDeltaX, this._cumulativeOverflowX
    );
    this._cumulativeOverflowY = this._updateCumulativeOverflow(
      overflowY, inputDeltaY, this._cumulativeOverflowY
    );

    this._feedElasticOverflow(
      this._cumulativeOverflowX,
      this._cumulativeOverflowY
    );
    EventBus.emit('camera:changed');
  }
}
```

### Why this is better

The fixed-rate decay had three failure modes:

1. **Frame-rate dependent drain speed.** At 144Hz, overflow drained 2.4x faster than at 60Hz because the 0.8 multiplier compounded more times per second.

2. **Input-decoupled visuals.** The user could scroll back slowly from the boundary and the overflow would still drain at the same fixed rate, creating a disconnect between gesture speed and visual response.

3. **Discontinuous direction change.** The transition from "accumulating" to "draining" was abrupt because the decay kicked in the frame after overflow stopped, rather than responding to the user's reverse input.

The input-proportional model eliminates all three. Drain rate equals input rate (frame-rate independent). Visual feedback matches gesture speed (1:1 input correlation). Direction changes are smooth because the drain is driven by the same input stream that created the overflow.

---

## 8. Complete annotated implementation: elastic ceiling {#elastic-ceiling}

The current rubber-band formula (`rubberBand(distance, dimension, c)`) naturally asymptotes toward `dimension`, but for extremely aggressive scrolling, the visual offset can reach values that look broken. Adding an explicit ceiling prevents this.

```javascript
// Add this constant near the top of map-camera.js, alongside
// the existing rubberBand function.

// Maximum elastic offset in screen-space pixels.
// The rubber-band formula asymptotes to the viewport dimension,
// but we cap earlier for a tighter feel. 150px is roughly the
// distance at which the effect stops communicating "you've reached
// the edge" and starts looking like a bug.
const MAX_ELASTIC_SCREEN_PX = 150;

// Updated _feedElasticOverflow with ceiling enforcement.
// Replace the existing method entirely.

_feedElasticOverflow(overflowX, overflowY) {
  if (!this._gestureActive) return;

  // Dampen rubber-band during trackpad momentum (c=0.3 vs 0.55)
  const c = this._momentumScrollActive ? 0.3 : 0.55;

  // The ceiling in world-space depends on current zoom
  const maxElastic = MAX_ELASTIC_SCREEN_PX / this.zoom;

  if (overflowX !== 0) {
    const screenOverflow = overflowX * this.zoom;
    const dampened = rubberBand(Math.abs(screenOverflow), this.viewportW, c);
    const capped = Math.min(dampened, MAX_ELASTIC_SCREEN_PX);
    this.elasticOffsetX = Math.sign(overflowX) * capped / this.zoom;
  } else {
    this.elasticOffsetX = 0;
  }

  if (overflowY !== 0) {
    const screenOverflow = overflowY * this.zoom;
    const dampened = rubberBand(Math.abs(screenOverflow), this.viewportH, c);
    const capped = Math.min(dampened, MAX_ELASTIC_SCREEN_PX);
    this.elasticOffsetY = Math.sign(overflowY) * capped / this.zoom;
  } else {
    this.elasticOffsetY = 0;
  }
}
```

### Why screen-space capping

The ceiling must be in screen-space (CSS pixels), not world-space. At zoom=0.5, a 150px screen-space cap equals 300 world-space pixels. At zoom=2.0, it equals 75 world-space pixels. The visual displacement on screen is the same 150 pixels in both cases. If we capped in world-space instead, the elastic effect would look huge when zoomed out and tiny when zoomed in.

### Why 150 pixels

150px is roughly 10% of a 1440px-tall viewport, or 14% of a 1080px-tall viewport. iOS allows elastic overscroll up to approximately 35% of the scrollable area's dimension before the rubber-band formula saturates. For a VTT, tighter feels better because the map content is the primary focus and excessive displacement is disorienting. 150px communicates "edge reached" without looking broken.

This value is a good starting point. If testing reveals it feels too tight on large monitors or too loose on the 13-inch MacBook Pro, adjust `MAX_ELASTIC_SCREEN_PX` and retest. The perceptual target is: the user should never think "the map is broken," only "I've reached the edge."

---

## 9. Complete annotated implementation: scroll-wheel behavior preference {#scroll-pref}

### The three modes

- **`'auto'`** (default): Uses the `WheelDeviceClassifier` from Phase S1. Trackpad events pan, mouse events zoom. This is the intelligent default that works correctly for the majority of hardware.
- **`'pan'`**: All non-Ctrl wheel events pan, regardless of device. For users who never want scroll-to-zoom.
- **`'zoom'`**: All non-Ctrl wheel events zoom, regardless of device. For mouse users who want Figma-like behavior without holding Ctrl.

In all three modes, Ctrl+scroll (including trackpad pinch, which the browser synthesizes as `ctrlKey: true`) always zooms. The preference only affects non-modified wheel events.

### Camera constructor addition

```javascript
// In the Camera constructor, add alongside the existing state:
this._scrollWheelBehavior = 'auto'; // 'auto' | 'pan' | 'zoom'
```

### EventBus wiring

```javascript
// In attachTo(el), add alongside the existing EventBus listeners:
EventBus.on('camera:scroll-behavior', (behavior) => {
  if (['auto', 'pan', 'zoom'].includes(behavior)) {
    this._scrollWheelBehavior = behavior;
  }
});
```

### Updated wheel handler routing

Replace the `dx !== 0 || dy !== 0` branch in `_attachWheelHandler`'s wheel listener:

```javascript
// In the wheel event listener, replace the non-ctrl path:

if (dx !== 0 || dy !== 0) {
  // Determine behavior: user preference > classifier > default
  let behavior;
  if (this._scrollWheelBehavior === 'auto') {
    // Use the stateful classifier (Phase S1)
    const device = this._wheelClassifier.classify(e);
    behavior = device === 'mouse' ? 'zoom' : 'pan';
  } else {
    behavior = this._scrollWheelBehavior;
  }

  if (behavior === 'zoom') {
    // Zoom at cursor position
    const screen = this.eventToScreen(e);
    if (this._gestures) this._gestures.request('ZOOM_ANIMATE');
    this._smoothZoom.onWheelZoom(dy / 100, screen.x, screen.y);
  } else {
    // Pan (default, safe)
    this._trackpadDetector.handleWheel(e);
    this.panBy(-dx, -dy);
  }
}
```

### DM Guide integration

The preference is exposed in the DM Guide settings panel. The exact UI implementation depends on the DM Guide's settings infrastructure, but the contract is simple: emit `EventBus.emit('camera:scroll-behavior', value)` when the user changes the setting. The Camera listens and updates immediately.

For programmatic access (useful during testing and for users who prefer the console):

```javascript
// Set via the camera instance directly
window.__vtt.mapRenderer.camera._scrollWheelBehavior = 'zoom';

// Or via EventBus for cross-component communication
EventBus.emit('camera:scroll-behavior', 'pan');
```

### Persistence

The preference should persist across sessions. Store it in `localStorage` under a key like `vtt_scroll_behavior`. On Camera initialization:

```javascript
// In Camera constructor, after setting the default:
const saved = localStorage.getItem('vtt_scroll_behavior');
if (saved && ['auto', 'pan', 'zoom'].includes(saved)) {
  this._scrollWheelBehavior = saved;
}

// In the EventBus listener, persist the change:
EventBus.on('camera:scroll-behavior', (behavior) => {
  if (['auto', 'pan', 'zoom'].includes(behavior)) {
    this._scrollWheelBehavior = behavior;
    localStorage.setItem('vtt_scroll_behavior', behavior);
  }
});
```

### The classifier still runs in 'pan' and 'zoom' modes

Even when the user has overridden the behavior, the `WheelDeviceClassifier` continues to receive events (the `classify()` call happens unconditionally in the `dz !== 0` path for ctrl/pinch detection). This is intentional: the classifier's output is used by `SmoothZoomAnimator` to choose between smooth animated zoom (mouse) and direct 1:1 zoom (trackpad pinch), a distinction that matters even when the routing decision is overridden.

---

## 10. Complete annotated implementation: cooperative gesture handling {#cooperative}

### When cooperative mode activates

Cooperative gesture handling is for embedded contexts where the VTT canvas is inside a scrollable page or an iframe. In standalone mode (the VTT fills the browser window), all wheel events should be captured by the VTT. In embedded mode, unmodified scroll events should pass through to the parent page, and only Ctrl+scroll should interact with the VTT's camera.

### Detection

```javascript
// Cooperative mode detection.
// Add this as a method on the Camera class.

_detectCooperativeContext() {
  // Inside an iframe: always cooperative
  if (window.self !== window.top) return true;

  // Page is scrollable: cooperative
  if (document.body.scrollHeight > window.innerHeight) return true;

  // Standalone: greedy (capture all events)
  return false;
}
```

### The cooperative flag

```javascript
// In the Camera constructor:
this._cooperativeGestures = false; // Set by detection or manual override
this._cooperativeOverlayTimer = null;

// In attachTo(el):
this._cooperativeGestures = this._detectCooperativeContext();

// Allow manual override via EventBus
EventBus.on('camera:cooperative-mode', (enabled) => {
  this._cooperativeGestures = !!enabled;
});
```

### Updated wheel handler with cooperative logic

The wheel handler gains a cooperative check at the top of the non-ctrl path:

```javascript
// At the very start of the wheel event listener, BEFORE
// the existing preventDefault():

el.addEventListener('wheel', (e) => {
  const { dx, dy, dz } = normalizeWheel(e);

  // Cooperative mode: unmodified scroll passes through to page
  if (this._cooperativeGestures && dz === 0 && !e.ctrlKey && !e.metaKey) {
    this._showCooperativeOverlay();
    return; // Do NOT call preventDefault — let the page scroll
  }

  // From here on, the VTT owns this event
  e.preventDefault();

  // ... rest of existing wheel handler (dz path, dx/dy path) ...
}, { passive: false });
```

### The overlay prompt

```javascript
// The overlay element. Created lazily, reused across activations.

_showCooperativeOverlay() {
  if (this._cooperativeOverlayTimer) {
    clearTimeout(this._cooperativeOverlayTimer);
  }

  if (!this._cooperativeOverlay) {
    const overlay = document.createElement('div');
    overlay.className = 'vtt-cooperative-overlay';

    // Platform-aware modifier key
    const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform)
               || navigator.userAgent.includes('Mac');
    const key = isMac ? '\u2318' : 'Ctrl';
    overlay.textContent = `Use ${key} + scroll to zoom the map`;

    // Style inline to avoid external CSS dependency
    Object.assign(overlay.style, {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      background: 'rgba(0, 0, 0, 0.7)',
      color: '#fff',
      padding: '12px 24px',
      borderRadius: '8px',
      fontSize: '14px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      pointerEvents: 'none',
      zIndex: '9999',
      opacity: '0',
      transition: 'opacity 0.2s ease-in-out',
    });

    this._cooperativeOverlay = overlay;
  }

  // Ensure the overlay is in the DOM
  if (!this._cooperativeOverlay.parentNode && this._el) {
    // The overlay is positioned relative to the map container
    this._el.style.position = this._el.style.position || 'relative';
    this._el.appendChild(this._cooperativeOverlay);
  }

  // Show with fade-in
  requestAnimationFrame(() => {
    this._cooperativeOverlay.style.opacity = '1';
  });

  // Auto-hide after 1.5 seconds
  this._cooperativeOverlayTimer = setTimeout(() => {
    if (this._cooperativeOverlay) {
      this._cooperativeOverlay.style.opacity = '0';
    }
    this._cooperativeOverlayTimer = null;
  }, 1500);
}
```

### Passive event listener considerations

Chrome 73 and later make wheel listeners on `window`, `document`, and `document.body` passive by default. Passive listeners cannot call `preventDefault()`, so the browser silently ignores the call. This is why the VTT's wheel listener is attached to the canvas element (`el`), not the window. Non-root target elements are not subject to the passive-by-default behavior.

The `{ passive: false }` option in the listener registration is explicit documentation of this requirement. Even though it is the default for non-root elements, including it prevents a future refactor from accidentally moving the listener to the window.

In cooperative mode, the handler deliberately does NOT call `preventDefault()` for unmodified scroll events. This lets the browser's native scrolling take effect. The event still fires on the VTT element (the browser delivers it before deciding whether to scroll), but by not preventing default, the page scrolls normally.

---

## 11. Migrating existing animation callers to the unified spring {#migration-callers}

### _snapBackElastic() migration

The current `_snapBackElastic()` creates an elastic animator, passes initial conditions, and starts a new rAF loop. With the unified spring, it becomes a target change on the elastic spring axes:

```javascript
// OLD:
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

// NEW:
_snapBackElastic(velocity = { vx: 0, vy: 0 }) {
  this._cumulativeOverflowX = 0;
  this._cumulativeOverflowY = 0;

  if (Math.abs(this.elasticOffsetX) < 0.5 && Math.abs(this.elasticOffsetY) < 0.5) {
    this.elasticOffsetX = 0;
    this.elasticOffsetY = 0;
    EventBus.emit('camera:changed');
    return;
  }

  const loop = this._springLoop;

  // Sync the spring positions from current elastic offset
  loop.elasticX.position = this.elasticOffsetX;
  loop.elasticY.position = this.elasticOffsetY;

  // Set target to zero (the rest position) with release velocity.
  // The velocity clamp from Phase S2 applies here.
  const omega = loop.elasticX._omega;
  const clampedVx = this._clampSpringVelocity(this.elasticOffsetX, velocity.vx, omega);
  const clampedVy = this._clampSpringVelocity(this.elasticOffsetY, velocity.vy, omega);

  loop.elasticX.setTarget(0, { velocity: clampedVx });
  loop.elasticY.setTarget(0, { velocity: clampedVy });

  // Ensure the loop is running (it will auto-stop when settled)
  loop.ensureRunning();
}
```

### _startInertialCoast() migration

Inertial coast is currently a custom rAF loop with exponential friction. With the unified spring, it becomes a spring configuration: low stiffness (acting as pure friction) with the release velocity as initial velocity and the current position as target.

```javascript
// OLD: Custom rAF loop with FRICTION = 0.96 exponential decay
// NEW: Spring with low stiffness (friction-only deceleration)

_startInertialCoast(velocity) {
  this._gestureActive = true;

  if (this._el) this._el.classList.add('coasting');
  if (this._gestures) this._gestures.request('INERTIA');

  const loop = this._springLoop;

  // For inertial coast, we project where the camera would end up
  // after the velocity decays, and set that as the target. The
  // spring with low stiffness will decelerate naturally.
  //
  // Projected endpoint: position + velocity / omega
  // (where omega = sqrt(stiffness/mass) at INERTIAL stiffness)
  const omega = Math.sqrt(SPRING_STIFFNESS.INERTIAL / 1.0);
  const projectedX = this.x + velocity.x / (this.zoom * omega);
  const projectedY = this.y + velocity.y / (this.zoom * omega);

  loop.panX.setStiffness(SPRING_STIFFNESS.INERTIAL);
  loop.panY.setStiffness(SPRING_STIFFNESS.INERTIAL);

  loop.panX.position = this.x;
  loop.panY.position = this.y;
  loop.panX.setTarget(projectedX, { velocity: -velocity.x / this.zoom });
  loop.panY.setTarget(projectedY, { velocity: -velocity.y / this.zoom });

  loop.ensureRunning();
}
```

### SmoothZoomAnimator migration

The smooth zoom system becomes a target change on the logZoom spring:

```javascript
// This replaces the core of SmoothZoomAnimator.onWheelZoom().
// The SmoothZoomAnimator class can be retained as a thin wrapper
// that manages the zoom anchor point calculation, or it can be
// inlined into the wheel handler.

_smoothZoomTo(logZoomDelta, screenX, screenY) {
  const loop = this._springLoop;

  // Compute zoom anchor in logical coordinates
  // (uses logicalScreenToWorld from Phase S4 to avoid
  // elastic offset contamination)
  const anchorWorld = this.logicalScreenToWorld(screenX, screenY);

  // Accumulate the zoom delta onto the current target
  // (not the current position — this allows multiple wheel
  // events to stack without waiting for animation)
  const newLogTarget = loop.logZoom.target + logZoomDelta;

  // Clamp to zoom bounds
  const effectiveMinZoom = this._getMinZoom();
  const clampedLog = Math.max(
    Math.log(effectiveMinZoom),
    Math.min(Math.log(MAX_ZOOM), newLogTarget)
  );

  loop.logZoom.setTarget(clampedLog);

  // Adjust pan targets to keep the anchor point stable.
  // After zooming, the anchor's screen position should not change.
  // This is the zoom-at-cursor correction.
  const newZoom = Math.exp(clampedLog);
  const newX = anchorWorld.x - screenX / newZoom;
  const newY = anchorWorld.y - screenY / newZoom;

  loop.panX.setTarget(newX);
  loop.panY.setTarget(newY);

  loop.ensureRunning();
}
```

### GestureStateMachine._cancelCurrent() simplification

With the unified spring, cancelling an animation becomes "set the target to the current position." The spring is already there (or close to it), so it decelerates and stops naturally.

```javascript
// OLD: Switch statement with per-animation-system cancel APIs
// NEW: Set spring targets to current positions

_cancelCurrent() {
  const loop = this._camera._springLoop;

  switch (this._activeGesture) {
    case 'INERTIA':
      // Stop coasting: target = current position
      loop.panX.setTarget(loop.panX.position);
      loop.panX.velocity = 0;
      loop.panY.setTarget(loop.panY.position);
      loop.panY.velocity = 0;
      loop.panX.setStiffness(SPRING_STIFFNESS.CAMERA_SNAP);
      loop.panY.setStiffness(SPRING_STIFFNESS.CAMERA_SNAP);
      this._camera._gestureActive = false;
      if (this._camera._el) this._camera._el.classList.remove('coasting');
      break;

    case 'SNAP_BACK':
      // Stop elastic snap-back: target = current elastic offset
      loop.elasticX.setTarget(loop.elasticX.position);
      loop.elasticX.velocity = 0;
      loop.elasticY.setTarget(loop.elasticY.position);
      loop.elasticY.velocity = 0;
      if (this._camera._cancelSpeculativeSnapBack) {
        this._camera._cancelSpeculativeSnapBack();
      }
      break;

    case 'ZOOM_ANIMATE':
      // Stop smooth zoom: target = current zoom
      loop.logZoom.setTarget(loop.logZoom.position);
      loop.logZoom.velocity = 0;
      break;

    case 'SCROLL_PAN':
      if (this._camera._trackpadDetector) {
        this._camera._trackpadDetector.cancel();
      }
      break;
  }
}
```

---

## 12. Edge cases and what to watch out for {#watch-out}

### Tab backgrounding and spring explosion

When the user switches away from the VTT tab and returns, the first rAF callback reports a dt of several seconds. The `MAX_DT = 0.064` clamp in `CameraSpringLoop._tick()` prevents the spring from computing a massive timestep that would produce unexpected positions. But this means the spring "runs slow" during the return, taking several clamped frames to catch up. For a camera that was mid-snap-back when the tab was backgrounded, this looks like momentary slowdown, which is better than the alternative (teleporting to the final position).

Watch for: if the spring was mid-inertial-coast when the tab was backgrounded, it resumes coasting from wherever it stopped. This is correct behavior (the user expects the camera to be where they left it), but it means the coast duration is effectively paused during background, not elapsed.

### The overflow direction-change boundary-hop

On a small map at high zoom, the user can scroll past the right boundary, reverse direction, and immediately hit the left boundary. The `_updateCumulativeOverflow()` method handles this correctly because the direction-change branch resets `cumulative` to the new overflow value. But the elastic spring position must also be reset when this happens, or the spring will try to animate from the right-side offset to zero while the new left-side overflow pushes it the other way.

The fix is in `_feedElasticOverflow()`: whenever overflow is fed, the elastic spring axes' positions are set directly (not animated), because the user is actively dragging and the spring should track input 1:1.

### Cooperative mode and the DM Guide

The DM Guide is typically a separate browser window, not embedded. The cooperative detection (`window.self !== window.top` and scroll height check) should return `false` for the standalone DM Guide, meaning all scroll events are captured normally. If the DM Guide is ever opened inside an iframe (unlikely but possible in a content management system), cooperative mode activates automatically.

### The scroll preference and touchpad pinch

The scroll preference only affects non-Ctrl wheel events. Trackpad pinch-to-zoom synthesizes `ctrlKey: true` on the wheel event, which routes through the `dz !== 0` branch in the wheel handler, bypassing the preference entirely. This is correct: pinch-to-zoom should always zoom, regardless of the scroll preference setting. A user who sets "scroll wheel = pan" still expects pinch to zoom.

### SmoothZoomAnimator zoom anchor drift during spring motion

When the zoom spring is animating (e.g., the user scrolled the mouse wheel and the zoom is interpolating), each frame computes a new zoom value. The pan targets must be adjusted each frame to keep the zoom anchor stable. If the pan springs are also animating (e.g., the user zoomed during an inertial coast), the pan correction and the coast deceleration compete for the pan position. The spring resolves this naturally: both forces contribute to the same spring, and the resulting motion is the physical combination of both influences. The camera drifts slightly from the exact anchor point, which is acceptable because the drift is continuous and small.

### The velocity clamp from Phase S2 in the unified spring

Phase S2's velocity clamp prevents spring overshoot by limiting the initial velocity to `v_max = -omega * displacement`. This clamp must be applied when setting the elastic spring's initial velocity for snap-back. The `_clampSpringVelocity()` method from Phase S2 is called in the migrated `_snapBackElastic()`, preserving the overshoot protection. The clamp is NOT applied for inertial coast (which uses a different stiffness and is expected to travel far from its starting position) or for smooth zoom (which animates in log-space where overshoot is perceptually acceptable as a slight zoom bounce).

---

## 13. Testing protocols {#testing}

### Unit tests for AxisSpring

```javascript
// tests/axis-spring.spec.js

import { test, expect } from '@playwright/test';

test.describe('AxisSpring', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'load' });
  });

  // ===========================================================
  // Basic convergence: spring reaches target
  // ===========================================================
  test('critically damped spring converges to target', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { AxisSpring } = await import('/vtt/js/axis-spring.js');
      const s = new AxisSpring({ stiffness: 200 });
      s.position = 100;
      s.target = 0;
      s.velocity = 0;

      // Simulate 2 seconds at 60fps
      for (let i = 0; i < 120; i++) {
        s.advance(1 / 60);
      }
      return { position: s.position, velocity: s.velocity, settled: s.settled };
    });

    expect(result.position).toBeCloseTo(0, 1);
    expect(result.velocity).toBeCloseTo(0, 1);
    expect(result.settled).toBe(true);
  });

  // ===========================================================
  // No overshoot with zero initial velocity
  // ===========================================================
  test('no overshoot with zero initial velocity', async ({ page }) => {
    const crossedZero = await page.evaluate(async () => {
      const { AxisSpring } = await import('/vtt/js/axis-spring.js');
      const s = new AxisSpring({ stiffness: 200 });
      s.position = 50;
      s.target = 0;
      s.velocity = 0;

      let crossed = false;
      for (let i = 0; i < 300; i++) {
        s.advance(1 / 60);
        if (s.position < -0.01) crossed = true;
      }
      return crossed;
    });

    expect(crossedZero).toBe(false);
  });

  // ===========================================================
  // setTarget mid-animation preserves velocity continuity
  // ===========================================================
  test('setTarget preserves velocity', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { AxisSpring } = await import('/vtt/js/axis-spring.js');
      const s = new AxisSpring({ stiffness: 200 });
      s.position = 100;
      s.target = 0;
      s.velocity = 0;

      // Run for 5 frames
      for (let i = 0; i < 5; i++) s.advance(1 / 60);
      const velBefore = s.velocity;

      // Change target mid-animation
      s.setTarget(50);
      const velAfter = s.velocity;

      return { velBefore, velAfter };
    });

    // Velocity should be identical before and after setTarget
    expect(result.velAfter).toBeCloseTo(result.velBefore, 10);
  });

  // ===========================================================
  // Frame-rate independence
  // ===========================================================
  test('position is frame-rate independent', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { AxisSpring } = await import('/vtt/js/axis-spring.js');

      // 60fps: 60 steps of 16.67ms
      const s60 = new AxisSpring({ stiffness: 200 });
      s60.position = 100;
      s60.target = 0;
      for (let i = 0; i < 60; i++) s60.advance(1 / 60);

      // 30fps: 30 steps of 33.33ms
      const s30 = new AxisSpring({ stiffness: 200 });
      s30.position = 100;
      s30.target = 0;
      for (let i = 0; i < 30; i++) s30.advance(1 / 30);

      return { pos60: s60.position, pos30: s30.position };
    });

    // Both should be within 0.01 of each other after 1 second
    expect(Math.abs(result.pos60 - result.pos30)).toBeLessThan(0.01);
  });

  // ===========================================================
  // Settlement snaps exactly to target
  // ===========================================================
  test('settlement snaps position to target', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { AxisSpring } = await import('/vtt/js/axis-spring.js');
      const s = new AxisSpring({ stiffness: 200 });
      s.position = 10;
      s.target = 0;

      let settled = false;
      for (let i = 0; i < 300 && !settled; i++) {
        settled = s.advance(1 / 60);
      }
      return { position: s.position, velocity: s.velocity, settled };
    });

    expect(result.settled).toBe(true);
    expect(result.position).toBe(0);  // Exactly zero, not approximately
    expect(result.velocity).toBe(0);
  });

  // ===========================================================
  // setStiffness changes dynamics without losing state
  // ===========================================================
  test('setStiffness preserves position and velocity', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { AxisSpring } = await import('/vtt/js/axis-spring.js');
      const s = new AxisSpring({ stiffness: 200 });
      s.position = 50;
      s.velocity = -100;
      s.target = 0;

      const posBefore = s.position;
      const velBefore = s.velocity;
      s.setStiffness(400);

      return {
        posBefore, velBefore,
        posAfter: s.position, velAfter: s.velocity,
      };
    });

    expect(result.posAfter).toBe(result.posBefore);
    expect(result.velAfter).toBe(result.velBefore);
  });

  // ===========================================================
  // Log-space zoom: perceptually uniform
  // ===========================================================
  test('log-space zoom has uniform step feel', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { AxisSpring } = await import('/vtt/js/axis-spring.js');

      // Zoom from 1x to 2x (log distance = 0.693)
      const s1 = new AxisSpring({ stiffness: 300, positionThreshold: 0.001 });
      s1.position = Math.log(1.0);
      s1.target = Math.log(2.0);
      let frames1 = 0;
      while (!s1.settled && frames1 < 300) {
        s1.advance(1 / 60);
        frames1++;
      }

      // Zoom from 2x to 4x (same log distance = 0.693)
      const s2 = new AxisSpring({ stiffness: 300, positionThreshold: 0.001 });
      s2.position = Math.log(2.0);
      s2.target = Math.log(4.0);
      let frames2 = 0;
      while (!s2.settled && frames2 < 300) {
        s2.advance(1 / 60);
        frames2++;
      }

      return { frames1, frames2 };
    });

    // Both should take the same number of frames (within 1 frame)
    expect(Math.abs(result.frames1 - result.frames2)).toBeLessThanOrEqual(1);
  });
});
```

### Unit tests for input-proportional overflow

```javascript
// tests/overflow-drain.spec.js

test.describe('Input-proportional overflow drain', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'load' });
  });

  test('overflow accumulates in same direction', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      return cam._updateCumulativeOverflow(10, 0, 5); // 5 + 10 = 15
    });
    expect(result).toBe(15);
  });

  test('overflow resets on direction change', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      return cam._updateCumulativeOverflow(-5, 0, 10); // direction reversed
    });
    expect(result).toBe(-5);
  });

  test('reverse input drains overflow proportionally', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      // Overflow is +20, input is -8 (reverse direction)
      return cam._updateCumulativeOverflow(0, -8, 20);
    });
    expect(result).toBe(12); // 20 - 8 = 12
  });

  test('drain never goes past zero', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      // Overflow is +5, reverse input is -20 (more than overflow)
      return cam._updateCumulativeOverflow(0, -20, 5);
    });
    expect(result).toBe(0); // Clamped to zero, not -15
  });
});
```

### Integration tests

```javascript
// tests/phase-s5-integration.spec.js

test.describe('Phase S5 integration', () => {
  // ===========================================================
  // Elastic snap-back completes via unified spring
  // ===========================================================
  test('elastic snap-back settles within 400ms', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'load' });
    // ... setup: navigate to map mode, inject test accessors ...

    // Pan past boundary to create elastic offset
    await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam._gestureActive = true;
      for (let i = 0; i < 20; i++) {
        cam.panBy(50, 0); // Scroll hard right
      }
    });

    // Verify elastic offset exists
    const offsetBefore = await page.evaluate(() =>
      window.__vtt.mapRenderer.camera.elasticOffsetX
    );
    expect(Math.abs(offsetBefore)).toBeGreaterThan(1);

    // Trigger snap-back
    await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam._gestureActive = false;
      cam._snapBackElastic();
    });

    // Wait for settlement
    await page.waitForFunction(() => {
      const cam = window.__vtt.mapRenderer.camera;
      return Math.abs(cam.elasticOffsetX) < 0.5
          && Math.abs(cam.elasticOffsetY) < 0.5;
    }, { timeout: 500 });

    const offsetAfter = await page.evaluate(() =>
      window.__vtt.mapRenderer.camera.elasticOffsetX
    );
    expect(Math.abs(offsetAfter)).toBeLessThan(0.5);
  });

  // ===========================================================
  // Scroll preference override works
  // ===========================================================
  test('scroll preference pan mode prevents zoom', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'load' });
    // ... setup ...

    // Set preference to 'pan'
    await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam._scrollWheelBehavior = 'pan';
    });

    const zoomBefore = await page.evaluate(() =>
      window.__vtt.mapRenderer.camera.zoom
    );

    // Dispatch mouse-like wheel events (which would normally zoom)
    await page.evaluate(() => {
      const el = document.getElementById('map-container');
      for (let i = 0; i < 5; i++) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -100, deltaX: 0, deltaMode: 0,
          ctrlKey: false, bubbles: true, cancelable: true
        }));
      }
    });

    await page.waitForTimeout(100);
    const zoomAfter = await page.evaluate(() =>
      window.__vtt.mapRenderer.camera.zoom
    );

    // Zoom should NOT have changed (preference overrides classifier)
    expect(zoomAfter).toBeCloseTo(zoomBefore, 4);
  });

  // ===========================================================
  // Elastic ceiling prevents extreme offset
  // ===========================================================
  test('elastic offset never exceeds ceiling', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'load' });
    // ... setup ...

    // Aggressively scroll past boundary
    await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam._gestureActive = true;
      for (let i = 0; i < 200; i++) {
        cam.panBy(100, 0); // Very aggressive scroll
      }
    });

    const offset = await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      return Math.abs(cam.elasticOffsetX * cam.zoom); // Screen-space
    });

    // Should never exceed MAX_ELASTIC_SCREEN_PX (150)
    expect(offset).toBeLessThanOrEqual(151); // +1 for floating point
  });
});
```

### Manual testing checklist

1. **Elastic snap-back feels smooth.** Drag past the boundary, release. The camera should spring back without visual jank, without freezing, and without overshooting. This tests the unified spring replacing the separate elastic animator.

2. **Zoom during elastic snap-back.** Drag past boundary, release, then immediately Ctrl+scroll to zoom. The zoom should animate smoothly while the elastic offset continues resolving independently. The camera should not jump or stutter. This is the key test for the unified spring architecture.

3. **Inertial coast transitions to snap-back.** Right-click drag past boundary, release with velocity. The camera should coast (decelerating), hit the boundary, show elastic offset, and spring back. The entire sequence should be one continuous motion with no discontinuities.

4. **Scroll preference: pan mode.** Set `_scrollWheelBehavior = 'pan'`. Scroll with mouse wheel. Camera should pan, not zoom. Ctrl+scroll should still zoom. Trackpad pinch should still zoom.

5. **Scroll preference: zoom mode.** Set `_scrollWheelBehavior = 'zoom'`. Scroll with mouse wheel. Camera should zoom. Trackpad two-finger scroll should also zoom (because the preference overrides the classifier).

6. **Scroll preference: auto mode (default).** Verify behavior matches Phases S1-S4: trackpad scrolls pan, mouse wheel zooms.

7. **Elastic ceiling.** Scroll aggressively past boundary for 5+ seconds. The elastic offset should reach a visual maximum and stop growing. It should not keep stretching indefinitely.

8. **Input-proportional overflow drain.** Scroll past the right boundary (elastic visible), then slowly scroll left. The elastic offset should drain at the speed of your scrolling, not at a fixed rate. Scroll back faster and it drains faster. This should feel 1:1 with your input.

9. **Frame-rate independence.** If possible, test on both a 60Hz and a higher-refresh-rate display. The snap-back duration and elastic feel should be identical on both.

10. **Tab backgrounding.** Start an elastic snap-back, switch tabs, wait 3 seconds, switch back. The camera should be near (but not necessarily at) its rest position, and should smoothly finish settling. It should not teleport.

11. **Open Controller and Display.** All spring-based animations are local-only (the springs are not synced across windows). The Display should receive smooth camera state updates through BroadcastChannel. Verify no jank on the Display during Controller-side snap-back or zoom animations.

---

## 14. Long-term tie-ins to future phases {#long-term}

### Phase 7 (Touch support via PointerEvent)

Touch gestures (two-finger pinch, two-finger pan) register through PointerEvent, not WheelEvent. They bypass the wheel classifier and scroll preference entirely, entering the gesture state machine at PINCH_ZOOM and DRAG_PAN priority levels.

The unified spring architecture makes touch integration straightforward. Two-finger pinch feeds the logZoom spring (the same one that handles Ctrl+scroll). Two-finger pan feeds the panX/panY springs. The spring handles simultaneous pinch-and-pan naturally because each axis is independent. No special coordination logic is needed, unlike the current architecture where `SmoothZoomAnimator` and the pan system must be explicitly choreographed.

Touch inertia (the momentum after a flick on a touchscreen) maps directly to the same inertial coast spring configuration that Phase S5 uses for mouse drag release. Set the pan springs to low stiffness, inject the release velocity, and the camera decelerates. Identical code path, identical physics.

### Phase 8 (Camera presets with spring transitions)

Camera presets use the flyTo animation from the Phase 5 Advanced Features plan. With the unified spring, recalling a preset becomes:

```javascript
springLoop.panX.setTarget(preset.centerX - viewportW / (2 * preset.zoom));
springLoop.panY.setTarget(preset.centerY - viewportH / (2 * preset.zoom));
springLoop.logZoom.setTarget(Math.log(preset.zoom));
springLoop.ensureRunning();
```

The camera flies smoothly from wherever it is to the preset position. If the user interrupts mid-flight (scrolls, drags), the springs absorb the interruption: the target changes, velocity carries forward, no discontinuity. This is dramatically simpler than the flyTo path-based animation, which requires explicit interruption handling and path recomputation.

For cinematic presets (where the van Wijk & Nuij optimal path is desired), the path algorithm can feed the springs' targets at each frame, using the springs as a smoothing layer that handles interruption. The path provides the trajectory; the springs provide the physics.

### Cooperative mode and the embedded VTT vision

If the VTT is ever published as an embeddable component (think: a blog post with an interactive battle map, or session notes with an inline map), cooperative gesture handling is the minimum viable requirement. Without it, scrolling past the VTT on a web page would zoom the map instead of continuing the page scroll, which is the single most frustrating interaction pattern in embedded maps.

The cooperative overlay system from this phase is the foundation. Future refinements include: localized overlay text (Leaflet's gesture-handling plugin includes 52 language translations), configurable timeout (some users need more time to read the prompt), and a "touch: drag with two fingers to move the map" variant for mobile contexts.

### Performance monitoring

The unified spring loop provides natural telemetry hooks:

- **Active spring count per frame.** If all five springs are active simultaneously, something complex is happening (zoom during elastic snap-back during inertial coast). Logging these peaks helps identify interaction patterns worth optimizing.
- **Settlement time per animation.** How long does each spring take to settle? Long settlement times indicate the stiffness needs tuning.
- **Max dt per frame.** Spikes in dt indicate the main thread is blocked by other work. This is a general performance signal, but the spring loop is a good place to measure it because it runs continuously during animation.

These metrics can be logged to `console.debug` during development and piped to a monitoring dashboard if the VTT adds telemetry infrastructure.

---

## 15. Migration checklist for Claude Code {#migration}

This is the ordered list of changes. Execute in order. Each step references the section above.

1. **Create `vtt/js/axis-spring.js`.**
   - Add the `AxisSpring` class with `advance()`, `setTarget()`, `setPosition()`, `snapToTarget()`, `setStiffness()`, and the `settled` getter.
   - Add the four default constants (`DEFAULT_STIFFNESS`, `DEFAULT_MASS`, `DEFAULT_POSITION_THRESHOLD`, `DEFAULT_VELOCITY_THRESHOLD`).
   - Export the class.
   - See: [Section 5, AxisSpring implementation](#axis-spring)

2. **Create `vtt/js/camera-spring-loop.js`.**
   - Add the `CameraSpringLoop` class with five `AxisSpring` instances, `ensureRunning()`, `stop()`, `syncFromCamera()`, and the `_tick()` loop.
   - Add the `SPRING_STIFFNESS` constants object and export it.
   - Import `AxisSpring` from `./axis-spring.js`.
   - See: [Section 6, CameraSpringLoop implementation](#spring-loop)

3. **Create `tests/axis-spring.spec.js`.**
   - Add all unit tests: convergence, no-overshoot, velocity preservation, frame-rate independence, settlement snapping, stiffness change, log-space zoom.
   - See: [Section 13, Unit tests for AxisSpring](#testing)

4. **Run the AxisSpring unit tests.** Verify all pass before proceeding. These tests have no dependencies on the camera or DOM.

5. **Add the `_updateCumulativeOverflow()` method to the Camera class.**
   - Place it alongside the existing `_feedElasticOverflow()` method.
   - See: [Section 7, input-proportional drain](#overflow-impl)

6. **Update `panBy()` to use `_updateCumulativeOverflow()`.**
   - Replace the existing overflow tracking with the new method calls for X and Y.
   - See: [Section 7, updated panBy()](#overflow-impl)

7. **Add overflow drain unit tests.**
   - See: [Section 13, Unit tests for overflow drain](#testing)

8. **Update `_feedElasticOverflow()` to enforce the elastic ceiling.**
   - Add the `MAX_ELASTIC_SCREEN_PX` constant.
   - Add the `Math.min(dampened, MAX_ELASTIC_SCREEN_PX)` cap to both axes.
   - See: [Section 8, elastic ceiling](#elastic-ceiling)

9. **Add `_scrollWheelBehavior` to the Camera constructor.**
   - Default to `'auto'`.
   - Add `localStorage` persistence.
   - Add the `camera:scroll-behavior` EventBus listener in `attachTo()`.
   - See: [Section 9, scroll preference](#scroll-pref)

10. **Update the wheel handler's non-ctrl path.**
    - Add the behavior resolution logic (preference > classifier > default).
    - Gate the zoom-vs-pan routing on the resolved behavior.
    - See: [Section 9, updated wheel handler routing](#scroll-pref)

11. **Add cooperative gesture detection and overlay.**
    - Add `_detectCooperativeContext()`, `_cooperativeGestures` flag, and `_showCooperativeOverlay()` to the Camera class.
    - Add the cooperative check at the top of the wheel handler.
    - See: [Section 10, cooperative gesture handling](#cooperative)

12. **Integrate `CameraSpringLoop` into the Camera class.**
    - In the Camera constructor, create `this._springLoop = new CameraSpringLoop(this)`.
    - In `attachTo()`, call `this._springLoop.syncFromCamera()` after the camera's initial position is set.
    - See: [Section 6, CameraSpringLoop](#spring-loop)

13. **Migrate `_snapBackElastic()` to use the spring loop.**
    - Replace the `_elasticAnimator.snapBack()` call with elastic spring target changes.
    - Preserve the Phase S2 velocity clamp.
    - See: [Section 11, _snapBackElastic migration](#migration-callers)

14. **Migrate `_startInertialCoast()` to use the spring loop.**
    - Replace the custom rAF loop with pan spring configuration.
    - See: [Section 11, _startInertialCoast migration](#migration-callers)

15. **Migrate smooth zoom to use the spring loop.**
    - Add the `_smoothZoomTo()` method (or update `SmoothZoomAnimator.onWheelZoom()`).
    - See: [Section 11, SmoothZoomAnimator migration](#migration-callers)

16. **Simplify `GestureStateMachine._cancelCurrent()` to use spring targets.**
    - Replace the per-animation-system cancel calls with spring target sets.
    - See: [Section 11, _cancelCurrent simplification](#migration-callers)

17. **Add integration tests.**
    - Elastic snap-back via unified spring.
    - Scroll preference override.
    - Elastic ceiling enforcement.
    - See: [Section 13, Integration tests](#testing)

18. **Run all existing tests and verify no regressions.**
    - The `WheelDeviceClassifier` tests from Phase S1 should still pass (classifier unchanged).
    - The velocity clamp tests from Phase S2 should still pass (clamp logic is called in the migrated `_snapBackElastic()`).
    - The speculative snap-back tests from Phase S3 should still pass (speculative monitoring is unchanged; only the animation it triggers is now a spring target change).
    - The `GestureStateMachine` tests from Phase S4 should still pass (the state machine's request/release/dwell logic is unchanged; only `_cancelCurrent()`'s internals changed).
    - The existing elastic overscroll and inertial coast integration tests should still pass (behavior is identical, only the animation infrastructure changed).

19. **Clean up deprecated code.**
    - Mark `CameraAnimator` as `@deprecated` (it is subsumed by `CameraSpringLoop.panX`/`panY`).
    - Mark the elastic animator instance as `@deprecated` (it is subsumed by `CameraSpringLoop.elasticX`/`elasticY`).
    - Do NOT delete these classes yet. They may still be referenced by tests or by code paths that have not yet been migrated. Deletion happens in a follow-up cleanup pass after all tests confirm the unified spring handles every case.

20. **Manual testing with real hardware.**
    - Follow the manual testing checklist in Section 13.
    - The critical tests: (a) zoom during elastic snap-back produces no jank, (b) scroll preference override works for all three modes, (c) elastic offset never exceeds the ceiling, (d) input-proportional drain feels 1:1 with gesture.
    - Test on the MacBook Pro trackpad.
    - Test with an external mouse (if available).
    - Test with Controller and Display both open.
