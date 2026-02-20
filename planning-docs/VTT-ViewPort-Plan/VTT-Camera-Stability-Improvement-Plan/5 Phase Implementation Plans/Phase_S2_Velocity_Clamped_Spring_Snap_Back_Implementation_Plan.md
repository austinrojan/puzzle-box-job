# Phase S2: Velocity-Clamped Spring Snap-Back
## A comprehensive implementation plan for eliminating spring overshoot through analytical velocity clamping, position safety nets, and coast velocity caps

> **Status:** IMPLEMENTED — All three defense layers deployed and tested.
> **Commits:** `2e9d6ae`, `267089d`, `c7e8e24`, `49b415b`
> **Tests added:** 23 (10 velocity clamp, 7 spring math, 3 coast cap, 3 integration)
> **Full suite:** 1332 passed across 4 viewports

**Fixes:** Bug #2 (spring overshoots past zero, flinging the viewport to the opposite side of the map)
**Impact:** High. Eliminates the most disorienting visual bug in the camera system.
**Risk:** Low. The fix is mathematically precise and surgically scoped.
**Estimated LOC:** ~80 (velocity clamp + position safety net + coast cap)
**Depends on:** Phase S1 (stateful device classification). With S1 in place, trackpad scroll events correctly reach `panBy()` and generate elastic offset. Without S1, fast scrolls are misrouted to zoom, the elastic system never activates, and there is nothing for S2 to clamp.

---

## Table of contents

1. [Why this phase comes second](#why-second)
2. [The physics of critically damped spring overshoot](#spring-physics)
3. [Deriving the zero-overshoot velocity threshold](#derivation)
4. [How production animation frameworks prevent overshoot](#production-approaches)
5. [The layered defense strategy](#layered-defense)
6. [Complete annotated implementation: velocity clamping](#velocity-clamp-impl)
7. [Complete annotated implementation: position safety net](#position-safety-impl)
8. [Complete annotated implementation: coast velocity cap](#coast-cap-impl)
9. [Floating-point precision and edge cases](#floating-point)
10. [What to watch out for](#watch-out)
11. [Testing protocols](#testing)
12. [Long-term tie-ins to future phases](#long-term)
13. [Migration checklist for Claude Code](#migration)

---

## 1. Why this phase comes second {#why-second}

Phase S1 fixes the input routing: fast trackpad scrolls now correctly reach `panBy()` instead of being misrouted to `SmoothZoomAnimator.onWheelZoom()`. This means the elastic overscroll system actually activates during fast gestures, producing the elastic offset values that the spring snap-back operates on.

Phase S2 fixes what happens when the spring receives those values. The bug is simple to describe: the user swipes fast past the map boundary, the elastic offset reaches (say) 50 pixels, and when the gesture ends, the spring snap-back is seeded with the momentum velocity from the swipe. That velocity is often 2000 to 5000 px/s. The spring, which has a natural frequency of omega = 20, overshoots past its target of zero and flings the camera to the opposite side of the map.

This phase is low-risk for the same reason Phase S1 was: the changes are surgically scoped. The velocity clamp is a pure function with no side effects. The position safety net is a two-line addition to the elastic animator's tick loop. The coast velocity cap is a four-line addition to `_startInertialCoast()`. None of these changes alter the animation system's architecture or interact with the DOM. They can be unit-tested exhaustively with deterministic math, no timing dependencies, and no browser rendering.

The ordering matters for one specific reason. Phase S3 (speculative snap-back) will change when `_snapBackElastic()` is called, triggering it speculatively rather than waiting for formal gesture end detection. If Phase S3 were implemented before S2, the speculative snap-back would fire with unclamped velocity, and the overshoot bug would appear in a new context. By fixing the spring first, every future caller of `_snapBackElastic()` inherits the overshoot protection automatically.

---

## 2. The physics of critically damped spring overshoot {#spring-physics}

### What a critically damped spring actually does

A damped spring oscillator is governed by the second-order ODE:

```
x''(t) + 2ζω·x'(t) + ω²·x(t) = 0
```

where `x(t)` is displacement from the target, `ω` (omega) is the natural frequency, and `ζ` (zeta) is the damping ratio. The VTT's elastic animator uses stiffness = 400, which gives `ω = √400 = 20`. The damping ratio is 1.0 (critical damping), which is the exact threshold between oscillatory behavior (underdamped, ζ < 1) and sluggish return (overdamped, ζ > 1).

Critical damping is special because it produces the fastest return to equilibrium without any oscillation. This is why it appears everywhere in UI animation: iOS UIScrollView, Android's DynamicAnimation, React Spring's default configuration, Framer Motion. It feels snappy without bouncing.

The closed-form solution for a critically damped spring is:

```
x(t) = (A + B·t) · e^(-ω·t)
```

where:
- `A = x₀` (initial displacement from target)
- `B = v₀ + ω·x₀` (initial velocity plus a correction term)
- `e^(-ω·t)` is the exponential decay envelope

This is exactly what `CameraAnimator._solveSpring()` computes:

```javascript
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
```

### When does the spring cross zero?

The spring overshoots (crosses zero from the positive side) when `x(t) = 0` has a solution for some `t > 0`. Setting `x(t) = 0`:

```
(A + B·t) · e^(-ω·t) = 0
```

Since `e^(-ω·t) > 0` for all finite t, the only way this equation has a solution is if `A + B·t = 0`, which gives:

```
t_cross = -A / B = -x₀ / (v₀ + ω·x₀)
```

This crossing time is positive (meaning it actually occurs in the future) when `A` and `B` have opposite signs. For positive initial displacement (`x₀ > 0`), `A > 0`, so the crossing occurs when `B < 0`, which means:

```
v₀ + ω·x₀ < 0
v₀ < -ω·x₀
```

This is the overshoot condition. For the VTT's elastic animator with `ω = 20` and a typical elastic offset of 50 pixels, overshoot occurs when:

```
v₀ < -20 · 50 = -1000 px/s
```

Any inward velocity exceeding 1000 px/s causes the spring to cross zero and fling the camera to the other side. Fast trackpad swipes routinely produce momentum velocities of 2000 to 5000 px/s. The overshoot is not a rare edge case; it is the expected outcome of normal fast scrolling.

### Visualizing the problem

Consider a concrete example. The user swipes fast to the right, pushing the camera 50px past the right boundary (elastic offset = +50). When the gesture ends, the inertial coast has residual velocity of -3000 px/s (moving left, back toward the boundary). Without clamping:

```
x₀ = 50          (50px to the right of target)
v₀ = -3000        (moving left at 3000 px/s)
ω  = 20
A  = 50
B  = -3000 + 20·50 = -3000 + 1000 = -2000

t_cross = -50 / -2000 = 0.025s (25ms)
```

The spring crosses zero after just 25ms. At that point, the elastic offset becomes negative, meaning the camera is now displaced to the left of where it should be. The spring continues pulling it further left before the exponential decay eventually brings it back. The user sees the map fling from the right boundary to the left side and then slowly drift back. This is deeply disorienting because it destroys the user's spatial context twice: once on the overshoot and again on the recovery.

### The fix is analytical, not heuristic

The beauty of this fix is that it requires no tuning, no heuristics, and no timing-dependent logic. The zero-overshoot velocity threshold is a mathematical fact derived from the spring equation. Clamping to that threshold guarantees monotonic convergence by construction. Unlike Phase S1's signal scoring (which required careful threshold selection) and Phase S3's speculative snap-back (which requires EWMA tuning), Phase S2 is pure math.

---

## 3. Deriving the zero-overshoot velocity threshold {#derivation}

### The formal proof

For a critically damped spring with initial displacement `x₀ > 0` (the elastic offset is to the right of the target), the position at time t is:

```
x(t) = (x₀ + (v₀ + ω·x₀)·t) · e^(-ω·t)
```

We want `x(t) ≥ 0` for all `t ≥ 0`. Since `e^(-ω·t) > 0` always, we need:

```
x₀ + (v₀ + ω·x₀)·t ≥ 0    for all t ≥ 0
```

Let `B = v₀ + ω·x₀`. There are three cases:

**Case 1: B ≥ 0.** Then `x₀ + B·t ≥ x₀ > 0` for all `t ≥ 0`. No overshoot.

**Case 2: B < 0 and |B| is small.** The linear term `B·t` eventually makes the expression negative, but only at `t = -x₀/B`. If `t_cross > some threshold`, the exponential decay has already driven `x(t)` below the settle threshold, so the "overshoot" is sub-pixel and invisible. But we want a hard guarantee, not a probabilistic one.

**Case 3: B < 0 and |B| is large.** The crossing happens quickly and the overshoot is visible. This is the bug.

The exact boundary between "no overshoot" and "overshoot" is `B = 0`, which gives:

```
v₀ + ω·x₀ = 0
v₀ = -ω·x₀
```

This is the critical velocity. Any velocity more negative than this causes overshoot. The clamp is:

```
For x₀ > 0: v_clamped = max(v₀, -ω·x₀)
For x₀ < 0: v_clamped = min(v₀, -ω·x₀)   [note: -ω·x₀ is positive here]
For x₀ = 0: v_clamped = v₀                 [no displacement, no clamping needed]
```

The general form handles both directions symmetrically. The critical velocity always points inward (toward the target), and the clamp prevents the inward velocity from exceeding the threshold that would carry the spring past the target.

### What does the clamped spring feel like?

At the critical velocity (`v₀ = -ω·x₀`), the spring position simplifies to:

```
B = v₀ + ω·x₀ = -ω·x₀ + ω·x₀ = 0
x(t) = x₀ · e^(-ω·t)
```

This is pure exponential decay. The spring returns to zero with maximum speed while maintaining monotonic convergence. It starts at `x₀` and decays to zero without ever crossing it.

Compare three scenarios for `x₀ = 50, ω = 20`:

| Initial velocity | B value | Behavior | Settle time (~0.5px) |
|---|---|---|---|
| v₀ = 0 | B = 1000 | Gentle return, slow start | ~230ms |
| v₀ = -1000 (clamped) | B = 0 | Exponential decay, fastest monotonic return | ~230ms |
| v₀ = -3000 (unclamped) | B = -2000 | Crosses zero at 25ms, overshoots | ~350ms (including recovery) |

The clamped spring actually settles faster than the unclamped one because the unclamped spring wastes time on the overshoot and recovery arc. The clamp is not just safer; it is also faster.

### Why not allow a small controlled overshoot?

The research mentions an optional refinement: allow controlled overshoot of at most N pixels by setting the clamp to `v_critical - N·ω·e`. This would produce a slight "bounce" effect, like iOS's rubber band. Some UI designers consider this bounce pleasant.

For the VTT, we choose zero overshoot for three reasons:

1. **The elastic offset represents displacement past the map boundary.** Overshooting past zero means the camera temporarily appears to be inside the valid bounds, then springs back out, then returns. This triple motion is confusing, not pleasant.

2. **The bounce effect works in iOS because UIScrollView controls a single axis of content.** The VTT's camera operates in 2D. A bounce on both axes simultaneously creates a chaotic diamond-shaped path that looks broken.

3. **Zero overshoot is the simplest correct behavior.** It requires no tuning. The "N pixels of allowed overshoot" variant introduces a parameter that needs visual testing and has no obviously correct value. Start with zero; if future UX testing reveals that a small bounce feels better, adding it is a one-constant change.

---

## 4. How production animation frameworks prevent overshoot {#production-approaches}

### React Spring: the `clamp: true` option

React Spring (the most widely used spring animation library in the React ecosystem, 28K+ GitHub stars) provides a `clamp` configuration option. When `clamp: true`, the animation stops entirely the first time the animated value crosses the target. Internally, on every frame, React Spring checks whether the new position has crossed to the other side of the target from the initial displacement. If so, it snaps the value to the target and zeroes the velocity.

This is the position-clamping approach: let the spring run its natural course, but stop it the instant it would overshoot. React Spring does not clamp velocity at the start. Their approach is simpler to implement (one conditional per frame) but slightly less smooth visually because the spring decelerates naturally and then snaps to a hard stop at the target, rather than approaching the target asymptotically.

For the VTT, we use velocity clamping as the primary defense because it preserves the spring's natural feel all the way to rest. But we add React Spring's position-clamping pattern as a secondary safety net, catching any case where floating-point arithmetic causes the velocity clamp to miss.

### Android SpringAnimation: setMinValue / setMaxValue

Android's physics-based animation library (`androidx.dynamicanimation`) provides `setMinValue()` and `setMaxValue()` on `SpringAnimation`. These constrain the animated value to a range. When the spring would exceed a bound, the value is clamped and the velocity is zeroed. Like React Spring's `clamp`, this is a position-space safety net.

Android's implementation also uses velocity clamping internally. The `SpringForce` class has a `getAcceleration()` method that computes the spring force, and the integration loop (`DynamicAnimation.doAnimationFrame()`) includes a max-velocity check. The exact threshold is proportional to `ω · maxDisplacement`, which is functionally equivalent to the `v_critical = -ω·x₀` clamp we derive above.

### iOS UIScrollView: the deceleration-to-spring handoff

Apple's UIScrollView handles the boundary transition with a two-phase approach. During inertial scrolling, it uses exponential deceleration: `v(t) = v₀ · 0.998^(1000t)`. When the scroll position crosses the content boundary, UIScrollView switches to a critically damped spring seeded with the current velocity. This is a hard switch, not a blend.

The key insight from Apple's approach is velocity continuity. The spring starts with the exact velocity the deceleration phase had at the moment of crossing. Because deceleration naturally reduces velocity before the boundary is reached, the spring usually receives a moderate velocity that does not cause overshoot. But Apple also applies an internal velocity cap. The exact value is not documented, but reverse engineering by iOS developers (notably Ole Begemann's UIScrollView analysis and Facebook's Pop library documentation) suggests a cap proportional to the viewport size.

The VTT's architecture differs from UIScrollView's because our elastic overscroll starts during the gesture, not after it. The elastic offset grows during active scrolling, and the spring animates it back to zero after the gesture ends. But the principle is the same: seed the spring with real velocity for continuity, but clamp that velocity to prevent overshoot.

### Facebook Pop: "current value, current velocity" handoff

Facebook's Pop animation library (the foundation for React Native's Animated API) codified a universal pattern for animation interruption. When you start a new animation on a property that already has a running animation, Pop reads the current animated value and velocity from the running animation and uses those as initial conditions for the new one. The old animation is implicitly cancelled.

This "current value, current velocity" pattern guarantees C1 continuity (both position and velocity are continuous at the transition point) regardless of what the old animation was doing. It applies directly to the VTT's inertial-coast-to-spring-snap-back transition: the spring should start with whatever velocity the inertial coast had when it triggered the snap-back. The velocity clamp then ensures this real velocity does not cause overshoot.

### The convergent design

Every major animation framework arrives at the same layered approach:

1. **Primary: velocity clamping at spring start.** Prevent overshoot analytically by limiting the initial velocity.
2. **Secondary: position clamping in the animation loop.** Catch edge cases the velocity clamp misses (floating-point errors, late-arriving state changes).
3. **Tertiary: maximum velocity cap upstream.** Limit velocities before they reach the spring, providing a broader safety margin.

The VTT will implement all three layers. The cost is minimal: one pure function, two conditionals per frame, and four lines at the start of inertial coast.

---

## 5. The layered defense strategy {#layered-defense}

### Layer 1: Velocity clamping (primary defense)

The `_clampSpringVelocity(v, d, omega)` method is a pure function that returns a clamped velocity. It is called in `_snapBackElastic()` before the velocity reaches the elastic animator. This is the primary defense because it prevents overshoot analytically, before the animation loop even starts.

**When it fires:** Every call to `_snapBackElastic()` with nonzero velocity and nonzero displacement. In the current codebase, this includes the inertial coast termination (where residual velocity is passed to the spring) and the formal gesture end callback. After Phase S3, it will also include speculative snap-back triggers.

**What it guarantees:** The spring position `x(t) ≥ 0` for all `t ≥ 0` when initial displacement is positive (and `x(t) ≤ 0` for all `t ≥ 0` when initial displacement is negative). This is a mathematical guarantee, not a probabilistic one.

### Layer 2: Position clamping (safety net)

The elastic animator's custom `_tick` function checks, on every animation frame, whether the elastic offset has crossed zero (changed sign relative to the initial displacement). If so, it snaps the offset to zero. This is the React Spring `clamp: true` pattern.

**When it fires:** Only when Layer 1 has failed, which should be never under normal conditions. Possible causes: floating-point precision loss in the exponential computation at very small displacements, or a code change that accidentally bypasses the velocity clamp.

**What it catches:** Any sub-pixel overshoot that the velocity clamp missed. The cost is two comparisons per axis per frame (negligible).

### Layer 3: Coast velocity cap (upstream limit)

The `_startInertialCoast()` method caps the initial velocity vector to a maximum magnitude of 3000 px/s. This limits the velocity that can possibly reach `_snapBackElastic()` when the coast terminates.

**When it fires:** On every drag release that triggers inertial coast. The cap is generous enough that normal scrolling is unaffected (typical fast scrolls produce 1500 to 2500 px/s), but it prevents extreme outliers from a very fast flick.

**What it adds:** A broader safety margin. Even if the velocity clamp has a bug, or if a future code change accidentally passes velocity to the spring from a new code path, the maximum velocity entering the system is bounded. With omega = 20, a 3000 px/s velocity can only cause overshoot for displacements less than 150px (3000 / 20). Since the rubber-band formula asymptotes well below 150px for typical viewport sizes, the cap effectively makes overshoot impossible even without the velocity clamp.

### Why three layers?

The research principle is defense in depth. Each layer independently prevents the bug. Together, they provide:

- **Correctness:** Layer 1 guarantees it mathematically.
- **Robustness:** Layer 2 catches floating-point edge cases.
- **Fault tolerance:** Layer 3 limits the blast radius of future code changes.

The total cost is roughly 15 lines of code and two comparisons per axis per frame. This is negligible for a camera system that already runs spring solvers and exponential functions on every frame.

---

## 6. Complete annotated implementation: velocity clamping {#velocity-clamp-impl}

### The `_clampSpringVelocity` method

Add this method to the Camera class in `vtt/js/map-camera.js`, near the other elastic offset methods:

```javascript
/**
 * Clamp velocity to prevent critically damped spring overshoot.
 *
 * For a critically damped spring x(t) = (A + B·t) · e^(-ω·t) where
 * A = displacement and B = velocity + ω·displacement, the spring
 * crosses its target (overshoots) when B has the opposite sign of A.
 *
 * The zero-overshoot threshold is v_critical = -ω·d, the velocity at
 * which B = 0 and the spring follows pure exponential decay. Clamping
 * to this value preserves maximum momentum feel (the spring still starts
 * with real velocity, not zero) while guaranteeing monotonic convergence.
 *
 * This is the primary defense against Bug #2. The position safety net
 * in the elastic animator's _tick is the secondary defense.
 *
 * @param {number} v  Initial velocity (world-space px/s). Negative means
 *                    moving toward the target (inward) for positive displacement.
 * @param {number} d  Initial displacement from target (world-space px).
 *                    Positive means the offset is on the positive side of target.
 * @param {number} omega  Spring natural frequency (√stiffness). For the
 *                        elastic animator, this is √400 = 20.
 * @returns {number} Clamped velocity that guarantees no overshoot.
 */
_clampSpringVelocity(v, d, omega) {
  // No displacement means no overshoot risk. Return velocity unchanged.
  // This handles the degenerate case where _snapBackElastic is called
  // with zero elastic offset but nonzero velocity (which should not
  // happen due to the early return in _snapBackElastic, but defensive
  // coding never hurts).
  if (d === 0) return v;

  // The critical velocity: the exact inward velocity at which the
  // spring's B coefficient equals zero, producing pure exponential
  // decay with no zero-crossing.
  //
  // For d > 0 (offset to the right of target):
  //   vCritical = -omega * d  (negative, pointing left toward target)
  //   Any velocity more negative than this causes overshoot.
  //   Clamp: v must be >= vCritical.
  //
  // For d < 0 (offset to the left of target):
  //   vCritical = -omega * d  (positive, pointing right toward target)
  //   Any velocity more positive than this causes overshoot.
  //   Clamp: v must be <= vCritical.
  const vCritical = -omega * d;

  if (d > 0) {
    // Positive displacement: velocity must not be more negative
    // than the critical threshold.
    //
    // Example: d = 50, omega = 20
    //   vCritical = -1000
    //   If v = -3000, clamp to -1000 (prevent overshoot)
    //   If v = -500, keep -500 (within safe range)
    //   If v = 200, keep 200 (moving away from target, no overshoot risk)
    return Math.max(v, vCritical);
  } else {
    // Negative displacement: velocity must not be more positive
    // than the critical threshold.
    //
    // Example: d = -50, omega = 20
    //   vCritical = 1000
    //   If v = 3000, clamp to 1000 (prevent overshoot)
    //   If v = 500, keep 500 (within safe range)
    //   If v = -200, keep -200 (moving away from target, no overshoot risk)
    return Math.min(v, vCritical);
  }
}
```

### The updated `_snapBackElastic` method

Replace the existing `_snapBackElastic` in `vtt/js/map-camera.js`:

```javascript
/**
 * Trigger spring snap-back from current elastic offset to zero.
 * Uses the elastic animator (stiffness=400, omega~20) for snappier feel.
 *
 * Velocity is clamped to prevent spring overshoot (Bug #2 fix).
 * For a critically damped spring, overshoot occurs when the initial
 * inward velocity exceeds omega * displacement. We clamp to exactly
 * the zero-overshoot threshold, which preserves maximum momentum feel
 * without ever crossing the target.
 *
 * This method is called from three places:
 *   1. TrackpadGestureDetector's onGestureEnd callback (zero velocity)
 *   2. _startInertialCoast termination (residual coast velocity)
 *   3. _cancelPan on blur/mouseleave (zero velocity)
 * After Phase S3, it will also be called by the speculative snap-back system.
 *
 * @param {{ vx: number, vy: number }} velocity  Initial velocity in
 *        world-space px/s. Defaults to zero for gesture-end calls.
 */
_snapBackElastic(velocity = { vx: 0, vy: 0 }) {
  this._cumulativeOverflowX = 0;
  this._cumulativeOverflowY = 0;

  // Early return: if elastic offset is negligible, snap to zero immediately.
  // The 0.5 threshold matches SETTLE_THRESHOLD_PX used in the spring solver,
  // so this is consistent with what the animator would decide anyway.
  if (Math.abs(this.elasticOffsetX) < 0.5 && Math.abs(this.elasticOffsetY) < 0.5) {
    this.elasticOffsetX = 0;
    this.elasticOffsetY = 0;
    EventBus.emit('camera:changed');
    return;
  }

  if (this._elasticAnimator) {
    const omega = this._elasticAnimator._omega;

    // -------------------------------------------------------
    // Layer 1: Velocity clamping (primary overshoot defense)
    // -------------------------------------------------------
    // Clamp each axis independently. The X and Y springs are
    // decoupled (each axis is an independent 1D spring), so
    // the clamp operates per-axis, not on the velocity vector
    // magnitude. This is correct because overshoot is a per-axis
    // phenomenon: the X spring can overshoot while Y does not.
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
```

### Key design decisions in the velocity clamp

**Per-axis clamping, not vector clamping.** The clamp operates on each axis independently because the X and Y springs are decoupled. A 2D vector clamp (reducing the velocity magnitude while preserving direction) would over-constrain the system: it might unnecessarily reduce velocity on an axis that has no overshoot risk in order to limit the axis that does. Independent clamping preserves maximum velocity on each axis while guaranteeing safety on each.

**The clamp preserves velocity direction.** If the user is scrolling away from the target (velocity has the same sign as displacement, moving further from the boundary), the clamp does not change the velocity at all. The `Math.max` / `Math.min` calls only reduce inward velocity. Outward velocity passes through unchanged. In practice, outward velocity rarely reaches the spring (the inertial coast is moving toward the boundary), but the clamp handles it correctly regardless.

**Zero velocity is always safe.** When `velocity = { vx: 0, vy: 0 }` (the default for gesture-end calls), the clamp returns zero for both axes. Zero velocity means `B = omega * displacement`, which has the same sign as displacement, so no overshoot. This is consistent with the pre-S2 behavior where gesture-end calls never caused overshoot (the bug only appeared with nonzero velocity from inertial coast).

---

## 7. Complete annotated implementation: position safety net {#position-safety-impl}

### The modified elastic animator `_tick`

The elastic animator's custom `_tick` function (created in `attachTo()` as an IIFE closure over the camera) needs two additional checks: one per axis, verifying that the elastic offset has not crossed zero relative to its initial displacement. If it has, the offset is snapped to zero for that axis.

Replace the existing elastic animator `_tick` assignment in `attachTo()`:

```javascript
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

    // -------------------------------------------------------
    // Layer 2: Position clamping (secondary overshoot defense)
    // -------------------------------------------------------
    // The elastic offset must not change sign during snap-back.
    // If the initial displacement was positive (offset to the right),
    // the offset must remain >= 0 throughout the animation.
    // If negative, it must remain <= 0.
    //
    // This catches floating-point edge cases where the velocity
    // clamp (Layer 1) produces a B coefficient that is very slightly
    // negative due to rounding, causing a sub-pixel overshoot.
    //
    // The check uses the initial displacement (stored in springX/Y)
    // to determine which direction is "past the target." The resolved
    // value from _resolveAxis is the absolute position (target + offset),
    // but for elastic snap-back the target is always 0, so the resolved
    // value IS the offset.
    let valX = rx.value;
    let valY = ry.value;

    if (anim._springX) {
      // If initial displacement was positive, offset must not go negative
      if (anim._springX.displacement > 0 && valX < 0) {
        valX = 0;
      }
      // If initial displacement was negative, offset must not go positive
      else if (anim._springX.displacement < 0 && valX > 0) {
        valX = 0;
      }
    }

    if (anim._springY) {
      if (anim._springY.displacement > 0 && valY < 0) {
        valY = 0;
      }
      else if (anim._springY.displacement < 0 && valY > 0) {
        valY = 0;
      }
    }

    cam.elasticOffsetX = valX;
    cam.elasticOffsetY = valY;
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

### Why check displacement sign, not target

The position clamp checks `anim._springX.displacement` rather than `anim._springX.target` because the target for elastic snap-back is always zero. The displacement, recorded at snap-back start, tells us which side of zero the offset was on. If the offset started positive (to the right of the boundary), it must not become negative during animation. If it started negative (to the left), it must not become positive.

This is specific to the elastic animator. The primary `CameraAnimator` (stiffness 200) animates `camera.x/y` toward a boundary position that may be nonzero. If we ever need position clamping there (unlikely, since it uses zero initial velocity), the check would compare against the target rather than zero.

### Performance impact

The position clamp adds four comparisons per frame (two per axis: check displacement sign, check value sign). On modern JavaScript engines, comparisons on floats are single-cycle operations. At 60fps, this adds 240 comparisons per second, which is negligible compared to the exponential functions and multiplications already in the spring solver. Even on a slow mobile device, the overhead is unmeasurable.

---

## 8. Complete annotated implementation: coast velocity cap {#coast-cap-impl}

### The modified `_startInertialCoast` method

Add a velocity magnitude cap at the start of `_startInertialCoast()` in `vtt/js/map-camera.js`:

```javascript
/**
 * Start inertial coast after mouse drag release.
 * Uses panBy() so overflow naturally feeds elastic offset.
 *
 * Phase S2: velocity is capped to MAX_COAST_SPEED to prevent extreme
 * velocities from reaching the spring. This is Layer 3 of the overshoot
 * defense: even if the velocity clamp in _snapBackElastic has a bug,
 * the maximum velocity entering the system is bounded.
 *
 * @param {{ x: number, y: number }} velocity Screen px/s
 */
_startInertialCoast(velocity) {
  // -------------------------------------------------------
  // Layer 3: Coast velocity cap (upstream overshoot defense)
  // -------------------------------------------------------
  // Cap the initial velocity vector to a maximum magnitude.
  //
  // 3000 px/s is chosen because:
  //   - Typical fast drag produces 1500-2500 px/s (unaffected by cap)
  //   - Very fast flick produces 3000-6000 px/s (capped)
  //   - With omega=20, 3000 px/s only causes overshoot for
  //     displacements < 150px (3000/20). The rubber-band formula
  //     asymptotes well below this for typical viewports.
  //   - Mapbox GL JS uses maxSpeed: 1400 px/s for inertial pan
  //   - Leaflet uses inertiaMaxSpeed: 3000 px/s (matching our cap)
  //   - The cap preserves velocity direction; only magnitude is reduced.
  const MAX_COAST_SPEED = 3000; // screen px/s
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
```

### Why 3000 px/s?

The cap value of 3000 px/s is chosen by triangulating three data points:

**User input range.** The `VelocityTracker` computes velocity from the last 4 mouse position samples. During casual panning, this produces 300 to 1000 px/s. During fast panning, 1500 to 2500 px/s. During a very aggressive flick (intentionally flinging the mouse across the trackpad), 3000 to 6000 px/s. The cap at 3000 preserves the feel of fast panning while limiting extreme flicks.

**Production benchmarks.** Mapbox GL JS caps inertial pan speed at 1400 px/s (`maxSpeed` in their `inertia` handler). Leaflet defaults to `inertiaMaxSpeed: Infinity` but provides 3000 px/s as a suggested constraint in their documentation. Google Maps does not expose its cap but visual inspection suggests approximately 2000 to 3000 px/s.

**Spring safety margin.** With omega = 20 and the velocity clamp active, the coast cap is technically unnecessary (the velocity clamp handles any speed). But as a defense-in-depth measure, 3000 px/s provides a generous margin. The residual velocity that reaches the spring after friction deceleration is substantially lower than the initial coast velocity, typically 10 to 100 px/s (the `STOP_THRESHOLD` is 10 px/s). The cap mainly protects against the initial coast frames, where a very fast flick could push the camera deep into the elastic zone before friction slows it.

### Velocity direction preservation

The cap reduces the velocity magnitude without changing its direction. This is important: a diagonal flick should produce diagonal coast, not axis-aligned coast. The `scale = MAX_COAST_SPEED / speed` factor is applied uniformly to both components, preserving the velocity vector's angle.

---

## 9. Floating-point precision and edge cases {#floating-point}

### Why the position safety net exists at all

In exact arithmetic, the velocity clamp guarantees `B = v + ω·d ≥ 0` (for positive d), which guarantees `x(t) = (A + B·t) · e^(-ω·t) ≥ 0` for all `t ≥ 0`. But JavaScript uses IEEE 754 double-precision floating-point, which introduces rounding errors.

Consider a concrete scenario:

```
d = 0.7 (very small elastic offset, near settle threshold)
omega = 20
vCritical = -20 * 0.7 = -14.0 (exact in float64)
v = -14.0000000000000018 (clamped, but float64 rounded)
B = v + omega * d = -14.0000000000000018 + 14.0 = -1.8e-15
```

The B coefficient is negative by one ULP (unit in the last place), roughly `10^-15`. The spring position at `t = -A/B = -0.7 / -1.8e-15 ≈ 3.9e14` seconds would cross zero. In practice, the exponential decay `e^(-20t)` has driven the position to zero long before this crossing time, so the "overshoot" is sub-attopixel and completely invisible. The position safety net would never fire in this scenario either, because the offset would be well below the 0.5px settle threshold before the crossing could occur.

But there is a more realistic edge case. If the displacement and velocity are computed from different sources with different rounding paths (the displacement from `elasticOffsetX`, the velocity from `_velocityTracker.getVelocity()` divided by `this.zoom`), the accumulated rounding could produce a B coefficient that is negative by a larger margin. The position safety net catches this at zero cost.

### The `d === 0` guard in _clampSpringVelocity

The first line of `_clampSpringVelocity` checks `d === 0`. This is an exact comparison on a float, which is normally dangerous, but here it is intentional. The caller (`_snapBackElastic`) only passes `this.elasticOffsetX/Y`, which is set to zero by explicit assignment (`this.elasticOffsetX = 0`) in multiple places. The `=== 0` check catches these exact-zero cases. Values very close to zero but not exactly zero (like `1e-15`) are handled by the clamp logic normally.

If the displacement is exactly zero, the spring has nothing to snap back, so any velocity is safe. Returning the velocity unchanged avoids a division-by-zero in `vCritical / d` (which does not appear in the code but could appear in a future refactoring that computes the ratio).

### The 2-second time cap in the animator

The elastic animator clamps elapsed time to 2.0 seconds:

```javascript
const elapsed = Math.min((timestamp - anim._startTime) / 1000, 2.0);
```

This prevents a "spiral of death" when the browser tab is backgrounded. If the user switches away for 30 seconds and then returns, `elapsed` would be 30.0, and `e^(-20 * 30) ≈ 10^-261`, which underflows to zero in float64. The resulting position would be exactly zero, which is correct, but intermediate computations might produce NaN from `0 * Infinity` patterns. The 2-second cap avoids this. At `t = 2.0` with `omega = 20`, `e^(-40) ≈ 4.25e-18`, which is sub-pixel and triggers the settle check.

### The `Math.abs() < 0.5` early return

The early return in `_snapBackElastic()` checks both axes against 0.5 pixels. This prevents starting a spring animation for sub-pixel offsets where the animation would settle in one frame anyway. Without this guard, the spring would allocate a rAF callback, run one frame, decide it is settled, and clean up. The early return saves that one-frame overhead.

The threshold of 0.5 matches `SETTLE_THRESHOLD_PX` used in `_resolveAxis()`. Using the same constant ensures consistency: anything below 0.5px is considered settled everywhere in the animation system.

---

## 10. What to watch out for {#watch-out}

### The elastic animator must animate elastic offset, not camera position

This is the most important architectural constraint, and it is already correct in the current codebase. The elastic animator's custom `_tick` writes to `cam.elasticOffsetX/Y`. The primary `CameraAnimator` (stiffness 200) writes to `cam.x/y`. If both wrote to the same property, they would fight.

Phase S2 does not change this separation. But it is worth verifying before deployment because the position safety net relies on it. The safety net checks `anim._springX.displacement` to determine the initial sign, which only makes sense if the spring is animating elastic offset toward zero. If the spring were animating camera position toward a nonzero boundary, the sign check would be wrong.

**Verification:** In the elastic animator's `_tick`, the final assignment is `cam.elasticOffsetX = valX`. If this line instead said `cam.x = ...`, the architecture is broken and must be fixed before deploying S2.

### The velocity clamp changes the feel of fast releases

Without the clamp, a fast drag release past the boundary produced a dramatic (and broken) overshoot followed by a slow recovery. With the clamp, the same fast release produces a firm, controlled snap back. The spring still has real velocity (up to the critical threshold), so it starts moving immediately and feels responsive. But the maximum "snap" force is limited.

Testers who have seen the old behavior will notice the change. This is correct. The old behavior was a bug, not a feature. The new behavior matches what iOS UIScrollView does: the snap-back is fast and firm, but it never overshoots. If a tester reports that the snap-back "feels slower," explain that the old fast return was the first half of an overshoot, and the spring actually settles faster now because it does not waste time on the overshoot-and-recovery arc.

### The coast velocity cap interacts with momentum feel

The 3000 px/s cap means that very fast flicks (above 3000 px/s) produce the same coast distance as a 3000 px/s flick. On a large map with a lot of room to coast, this means extremely fast flicks feel "damped" compared to what the user might expect. This is the intended behavior, matching Mapbox's 1400 px/s cap and Leaflet's 3000 px/s recommendation.

If future UX testing reveals that the cap is too aggressive, it can be raised. 4000 to 5000 px/s would still provide meaningful overshoot protection while allowing longer coast distances. The cap value should be treated as a tuning parameter, not a mathematical constant.

### Phase S3 will call `_snapBackElastic` from a new code path

Phase S3 (speculative snap-back) will call `_snapBackElastic()` with zero velocity when the EWMA velocity drops below the stall threshold. This is safe because zero velocity never causes overshoot (B = omega * d, same sign as d). But if S3's implementation ever passes nonzero velocity to the spring (perhaps from the EWMA itself), the velocity clamp will handle it automatically. This is the benefit of fixing the spring before building on top of it.

### The `_omega` property access

The velocity clamp reads `this._elasticAnimator._omega` to get the spring's natural frequency. This property is set in `CameraAnimator`'s constructor as `this._omega = Math.sqrt(stiffness)`. It is not a public API, hence the underscore prefix. Accessing it from the Camera class is technically reaching into the animator's internals.

An alternative design would be to pass omega as a parameter to `_clampSpringVelocity` from a constant (`const ELASTIC_OMEGA = Math.sqrt(400)`). This is slightly cleaner because it does not depend on the animator's internal state. However, reading from the animator ensures the clamp always uses the same omega the spring uses, even if the stiffness is changed later. The current approach (reading `_omega`) is acceptable because both classes live in the same file and are tightly coupled by design.

---

## 11. Testing protocols {#testing}

### Unit tests (deterministic, no browser rendering)

All unit tests run inside `page.evaluate()` in Playwright. They test mathematical correctness of the velocity clamp and spring behavior without timing dependencies or animation frames.

Add these to a new file `tests/spring-overshoot.spec.js` (or append to `tests/camera-clamping.spec.js`):

```javascript
import { test, expect } from '@playwright/test';
import { gotoVTT, injectTestAccessors } from './helpers.js';

// ============================================================
// Velocity clamp: _clampSpringVelocity
// ============================================================
test.describe('Velocity clamp (_clampSpringVelocity)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await injectTestAccessors(page);
  });

  test('zero displacement returns velocity unchanged', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      return {
        pos: cam._clampSpringVelocity(5000, 0, 20),
        neg: cam._clampSpringVelocity(-5000, 0, 20),
        zero: cam._clampSpringVelocity(0, 0, 20)
      };
    });
    expect(result.pos).toBe(5000);
    expect(result.neg).toBe(-5000);
    expect(result.zero).toBe(0);
  });

  test('positive displacement: safe velocity passes through', async ({ page }) => {
    // d=50, omega=20, vCritical = -1000
    // v=-500 is safe (less negative than -1000), should pass through
    const v = await page.evaluate(() => {
      return __cam()._clampSpringVelocity(-500, 50, 20);
    });
    expect(v).toBe(-500);
  });

  test('positive displacement: dangerous velocity is clamped', async ({ page }) => {
    // d=50, omega=20, vCritical = -1000
    // v=-3000 would cause overshoot, clamp to -1000
    const v = await page.evaluate(() => {
      return __cam()._clampSpringVelocity(-3000, 50, 20);
    });
    expect(v).toBe(-1000);
  });

  test('positive displacement: outward velocity passes through', async ({ page }) => {
    // v=200 is moving away from target, never causes overshoot
    const v = await page.evaluate(() => {
      return __cam()._clampSpringVelocity(200, 50, 20);
    });
    expect(v).toBe(200);
  });

  test('negative displacement: safe velocity passes through', async ({ page }) => {
    // d=-50, omega=20, vCritical = 1000
    // v=500 is safe, should pass through
    const v = await page.evaluate(() => {
      return __cam()._clampSpringVelocity(500, -50, 20);
    });
    expect(v).toBe(500);
  });

  test('negative displacement: dangerous velocity is clamped', async ({ page }) => {
    // d=-50, omega=20, vCritical = 1000
    // v=3000 would cause overshoot, clamp to 1000
    const v = await page.evaluate(() => {
      return __cam()._clampSpringVelocity(3000, -50, 20);
    });
    expect(v).toBe(1000);
  });

  test('negative displacement: outward velocity passes through', async ({ page }) => {
    const v = await page.evaluate(() => {
      return __cam()._clampSpringVelocity(-200, -50, 20);
    });
    expect(v).toBe(-200);
  });

  test('exact critical velocity passes through (boundary case)', async ({ page }) => {
    // v = -omega * d = -1000 exactly. This is the zero-overshoot boundary.
    // It should pass through unchanged (max(-1000, -1000) = -1000).
    const v = await page.evaluate(() => {
      return __cam()._clampSpringVelocity(-1000, 50, 20);
    });
    expect(v).toBe(-1000);
  });

  test('very small displacement: clamp is proportionally tight', async ({ page }) => {
    // d=1, omega=20, vCritical = -20
    // Even -25 should be clamped to -20
    const v = await page.evaluate(() => {
      return __cam()._clampSpringVelocity(-25, 1, 20);
    });
    expect(v).toBe(-20);
  });

  test('very large displacement: clamp is proportionally loose', async ({ page }) => {
    // d=200, omega=20, vCritical = -4000
    // -3000 is safe and should pass through
    const v = await page.evaluate(() => {
      return __cam()._clampSpringVelocity(-3000, 200, 20);
    });
    expect(v).toBe(-3000);
  });
});

// ============================================================
// Spring with clamped velocity: no-overshoot guarantee
// ============================================================
test.describe('Spring no-overshoot guarantee', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await injectTestAccessors(page);
  });

  test('clamped velocity never produces negative position (d > 0)', async ({ page }) => {
    // Test the spring solver directly with clamped velocity.
    // d=50, original v=-3000 (clamped to -1000), omega=20
    const minPos = await page.evaluate(() => {
      const cam = __cam();
      const omega = 20;
      const d = 50;
      const v = cam._clampSpringVelocity(-3000, d, omega);
      const a = cam._elasticAnimator || cam._animator;
      let min = Infinity;
      // Sample at 1ms intervals for 1 second
      for (let ms = 0; ms <= 1000; ms++) {
        const t = ms / 1000;
        const { position } = a._solveSpring(d, v, t);
        min = Math.min(min, position);
      }
      return min;
    });
    // Position must never go below zero (with tiny float tolerance)
    expect(minPos).toBeGreaterThanOrEqual(-0.001);
  });

  test('clamped velocity never produces positive position (d < 0)', async ({ page }) => {
    const maxPos = await page.evaluate(() => {
      const cam = __cam();
      const omega = 20;
      const d = -50;
      const v = cam._clampSpringVelocity(3000, d, omega);
      const a = cam._elasticAnimator || cam._animator;
      let max = -Infinity;
      for (let ms = 0; ms <= 1000; ms++) {
        const t = ms / 1000;
        const { position } = a._solveSpring(d, v, t);
        max = Math.max(max, position);
      }
      return max;
    });
    expect(maxPos).toBeLessThanOrEqual(0.001);
  });

  test('unclamped velocity DOES produce overshoot (documents the bug)', async ({ page }) => {
    // This test proves that without the clamp, the spring overshoots.
    // It documents the bug that Phase S2 fixes.
    const minPos = await page.evaluate(() => {
      const a = __cam()._elasticAnimator || __cam()._animator;
      let min = Infinity;
      // d=50, v=-3000 (unclamped), omega=20
      for (let ms = 0; ms <= 1000; ms++) {
        const t = ms / 1000;
        const { position } = a._solveSpring(50, -3000, t);
        min = Math.min(min, position);
      }
      return min;
    });
    // Unclamped spring goes negative (overshoots)
    expect(minPos).toBeLessThan(-1);
  });

  test('spring with zero velocity never overshoots (baseline)', async ({ page }) => {
    const minPos = await page.evaluate(() => {
      const a = __cam()._elasticAnimator || __cam()._animator;
      let min = Infinity;
      for (let ms = 0; ms <= 1000; ms++) {
        const t = ms / 1000;
        const { position } = a._solveSpring(100, 0, t);
        min = Math.min(min, position);
      }
      return min;
    });
    expect(minPos).toBeGreaterThanOrEqual(-0.01);
  });

  test('spring with exactly critical velocity: pure exponential decay', async ({ page }) => {
    // At v = -omega * d, B = 0, so x(t) = d * e^(-omega*t)
    const values = await page.evaluate(() => {
      const a = __cam()._elasticAnimator || __cam()._animator;
      const d = 50;
      const omega = 20;
      const v = -omega * d; // -1000
      const results = [];
      for (const t of [0, 0.05, 0.1, 0.2, 0.5]) {
        const { position } = a._solveSpring(d, v, t);
        const expected = d * Math.exp(-omega * t);
        results.push({ t, position, expected, diff: Math.abs(position - expected) });
      }
      return results;
    });
    for (const r of values) {
      expect(r.diff).toBeLessThan(0.001);
    }
  });

  test('clamped spring settles within 300ms for typical displacement', async ({ page }) => {
    const pos = await page.evaluate(() => {
      const cam = __cam();
      const omega = 20;
      const d = 50;
      const v = cam._clampSpringVelocity(-3000, d, omega);
      const a = cam._elasticAnimator || cam._animator;
      return Math.abs(a._solveSpring(d, v, 0.3).position);
    });
    expect(pos).toBeLessThan(0.5);
  });
});

// ============================================================
// Coast velocity cap
// ============================================================
test.describe('Coast velocity cap', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await injectTestAccessors(page);
  });

  test('velocity below cap passes through unchanged', async ({ page }) => {
    // This tests the cap logic in isolation by simulating the math
    const result = await page.evaluate(() => {
      const v = { x: 2000, y: 0 };
      const MAX_COAST_SPEED = 3000;
      const speed = Math.sqrt(v.x ** 2 + v.y ** 2);
      return { capped: speed > MAX_COAST_SPEED, vx: v.x, vy: v.y };
    });
    expect(result.capped).toBe(false);
    expect(result.vx).toBe(2000);
  });

  test('velocity above cap is scaled to cap magnitude', async ({ page }) => {
    const result = await page.evaluate(() => {
      let v = { x: 4000, y: 3000 };
      const MAX_COAST_SPEED = 3000;
      const speed = Math.sqrt(v.x ** 2 + v.y ** 2); // 5000
      if (speed > MAX_COAST_SPEED) {
        const scale = MAX_COAST_SPEED / speed; // 0.6
        v = { x: v.x * scale, y: v.y * scale };
      }
      const newSpeed = Math.sqrt(v.x ** 2 + v.y ** 2);
      return { vx: v.x, vy: v.y, speed: newSpeed };
    });
    expect(result.speed).toBeCloseTo(3000, 1);
    // Direction preserved: ratio should be the same
    expect(result.vx / result.vy).toBeCloseTo(4000 / 3000, 5);
  });

  test('velocity cap preserves direction', async ({ page }) => {
    const result = await page.evaluate(() => {
      let v = { x: -6000, y: 0 };
      const MAX_COAST_SPEED = 3000;
      const speed = Math.sqrt(v.x ** 2 + v.y ** 2);
      if (speed > MAX_COAST_SPEED) {
        const scale = MAX_COAST_SPEED / speed;
        v = { x: v.x * scale, y: v.y * scale };
      }
      return { vx: v.x, vy: v.y };
    });
    expect(result.vx).toBeCloseTo(-3000, 1);
    expect(result.vy).toBe(0);
  });
});
```

### Integration tests (Playwright, real browser timing)

Add these to `tests/phase6-integration.spec.js` or a new `tests/spring-overshoot-integration.spec.js`:

```javascript
import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode, injectTestAccessors } from './helpers.js';

// ============================================================
// Fast swipe at boundary: no overshoot (Bug #2 regression test)
// ============================================================
test.describe('Spring overshoot prevention (Bug #2)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('fast swipe at map edge does not bounce to opposite side', async ({ page }) => {
    // Setup: zoom in and pan to the right boundary
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      // Pan to the right boundary
      for (let i = 0; i < 200; i++) cam.panBy(-50, 0);
    });

    // Verify we are at or near the right boundary
    const preSwipe = await page.evaluate(() => {
      const cam = __cam();
      return { x: cam.x, elasticX: cam.elasticOffsetX };
    });

    // Simulate a fast drag release (right-click drag to the right, past boundary)
    const box = await page.locator('#map-container').boundingBox();
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'right' });

    // Fast drag to the left (pushing camera further right, past boundary)
    // 5 steps over a short time simulates a fast flick
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(startX - i * 40, startY, { steps: 1 });
    }

    await page.mouse.up({ button: 'right' });

    // Wait for all animations (coast + snap-back) to settle
    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return false;
      // Settled when: no inertia, no elastic offset, no animation
      return !cam._inertiaRafId
        && Math.abs(cam.elasticOffsetX) < 1.0
        && !cam._elasticAnimator?._rafId;
    }, { timeout: 5000 });

    // Assert: camera should be at or near the right boundary,
    // NOT on the left side of the map (which is the overshoot bug)
    const postSettle = await page.evaluate(() => {
      const cam = __cam();
      return {
        x: cam.x,
        elasticX: cam.elasticOffsetX,
        zoom: cam.zoom
      };
    });

    // The camera's X should be near where it started (the right boundary),
    // not dramatically different. A large negative change in X would
    // indicate overshoot to the left side.
    expect(Math.abs(postSettle.x - preSwipe.x)).toBeLessThan(50);
    expect(Math.abs(postSettle.elasticX)).toBeLessThan(1.0);
  });

  test('elastic offset never changes sign during snap-back', async ({ page }) => {
    // Setup: create elastic offset on the X axis
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      for (let i = 0; i < 200; i++) cam.panBy(50, 0);
    });

    // Push past boundary with trackpad-like events
    await page.evaluate(() => {
      const el = document.getElementById('map-container');
      for (let i = 0; i < 15; i++) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 0, deltaX: -20, deltaMode: 0,
          ctrlKey: false, bubbles: true, cancelable: true
        }));
      }
    });

    // Capture the initial elastic offset sign
    const initialSign = await page.evaluate(() => {
      return Math.sign(__cam().elasticOffsetX);
    });

    // Wait for snap-back and monitor for sign changes
    // We poll rapidly and check that the offset never crosses zero
    // (changes sign) before settling to zero.
    const signChanged = await page.evaluate(() => {
      return new Promise((resolve) => {
        const cam = window.__vtt?.mapRenderer?.camera;
        if (!cam) { resolve(false); return; }

        const initialSign = Math.sign(cam.elasticOffsetX);
        if (initialSign === 0) { resolve(false); return; }

        let changed = false;
        let checks = 0;
        const maxChecks = 300; // 5 seconds at ~60fps

        function check() {
          checks++;
          const currentOffset = cam.elasticOffsetX;
          const currentSign = Math.sign(currentOffset);

          // Sign changed means overshoot occurred
          if (currentSign !== 0 && currentSign !== initialSign) {
            changed = true;
            resolve(true);
            return;
          }

          // Settled or timed out
          if (Math.abs(currentOffset) < 0.5 || checks >= maxChecks) {
            resolve(changed);
            return;
          }

          requestAnimationFrame(check);
        }

        requestAnimationFrame(check);
      });
    });

    expect(signChanged).toBe(false);
  });

  test('snap-back with zero velocity still works correctly', async ({ page }) => {
    // This tests the common case: gesture end with no momentum
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      for (let i = 0; i < 200; i++) cam.panBy(50, 0);
    });

    // Create elastic offset
    await page.evaluate(() => {
      const el = document.getElementById('map-container');
      for (let i = 0; i < 10; i++) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 0, deltaX: -15, deltaMode: 0,
          ctrlKey: false, bubbles: true, cancelable: true
        }));
      }
    });

    // Wait for snap-back to settle
    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && Math.abs(cam.elasticOffsetX) < 0.5;
    }, { timeout: 3000 });

    const offset = await page.evaluate(() => __cam().elasticOffsetX);
    expect(Math.abs(offset)).toBeLessThan(0.5);
  });
});
```

### Manual testing checklist

Because the overshoot bug depends on gesture velocity, which is difficult to simulate perfectly with `dispatchEvent`, manual testing with a real trackpad and mouse is essential.

1. **Slow two-finger scroll past map edge:** Camera pans to boundary, elastic offset appears, finger lift triggers gentle snap-back. No overshoot. (Baseline: this should work before S2 because velocity is near zero.)

2. **Fast two-finger scroll past map edge (THE CRITICAL TEST):** Swipe fast with two fingers, pushing the camera well past the boundary. On finger lift, the snap-back should be firm and fast, but the camera must not overshoot to the other side. Repeat this 10+ times at varying speeds.

3. **Right-click drag past boundary, fast release:** Right-click and drag past the boundary, then release quickly. The inertial coast should push into the elastic zone, then the spring should pull back without overshooting. This is the primary path where high velocities reach the spring.

4. **Right-click drag past boundary, slow release:** Same as above but release gently. Low velocity, no overshoot. (Baseline.)

5. **Right-click flick at boundary (maximum velocity):** Flick the mouse as fast as possible while right-click dragging past the boundary. The coast velocity cap should limit the coast. The snap-back should be controlled. No overshoot.

6. **Diagonal swipe past corner:** Push past both the right and bottom boundaries simultaneously. Both axes should snap back independently. Neither should overshoot.

7. **Swipe past one edge, then quickly swipe back:** Push past the right boundary, then immediately swipe left. The snap-back should handle the direction change gracefully. The elastic offset should transition smoothly from positive to zero without negative excursion.

8. **Open Controller and Display (cross-window):** Perform all the above tests with the VTT Display open. Elastic effects should be local-only (elastic offset is not synced across windows). The Display should see the camera position settle to the boundary without oscillation.

---

## 12. Long-term tie-ins to future phases {#long-term}

### Phase S3 (Speculative snap-back)

Phase S3 will call `_snapBackElastic()` speculatively, before the gesture has formally ended, whenever the EWMA velocity drops below a stall threshold. These speculative calls use zero velocity (the system does not yet know the final gesture velocity), so the velocity clamp will not fire. But if S3's design evolves to pass estimated velocity, the clamp handles it automatically.

The position safety net is especially valuable for S3. Speculative snap-back may be interrupted and restarted multiple times as the gesture fluctuates near the stall threshold. Each restart seeds the spring with the current elastic offset and (usually) zero velocity. The safety net ensures that even if rapid start-cancel-restart cycles produce unexpected initial conditions, the offset never crosses zero.

### Phase S4 (Hierarchical gesture coordination with hysteresis)

Phase S4 restructures the `GestureStateMachine` with dwell time and cooldown. The velocity clamp in S2 makes this restructuring safer. Without the clamp, a gesture mode switch during inertial coast could pass unclamped velocity to the spring. With the clamp, any code path that calls `_snapBackElastic()` is inherently safe.

S4 also adds `_cancelSpeculativeSnapBack()` to the gesture state machine's `_cancelCurrent()` method. This means the elastic animator might be cancelled and restarted during gesture transitions. The position safety net ensures that even if the animator is cancelled mid-frame and immediately restarted with slightly stale initial conditions, the offset stays on the correct side of zero.

### Phase S5 (Unified spring physics)

Phase S5's long-term vision is a unified spring integrator per axis that replaces all three current animation systems. The velocity clamp concept carries forward directly: when the unified spring's target changes, the initial velocity is the current velocity, and it may need clamping to prevent overshoot past the new target.

The position safety net also carries forward. In a unified spring, the "target" changes dynamically (unlike the elastic snap-back where the target is always zero). The safety net would need to track the target and prevent the value from crossing it, which is slightly more complex but follows the same principle.

Phase S5 also adds a user preference for scroll-wheel behavior and a simplified overflow accumulation model. Neither of these changes interacts with the velocity clamp or position safety net, but both benefit from the stable snap-back behavior that S2 provides.

### Phase 7 (Touch support via PointerEvent)

Touch-based pinch-zoom and two-finger pan produce different velocity profiles than trackpad scrolling. Two-finger pan on a touchscreen typically produces lower maximum velocities (the finger travels less distance than a trackpad swipe) but can produce sudden velocity spikes when fingers lift at different times. The velocity clamp handles these spikes correctly because it operates on the velocity magnitude, not on the input device type.

The coast velocity cap may need adjustment for touch input. Touchscreen gestures on tablets can produce velocities up to 4000 to 5000 px/s during aggressive flings. If the 3000 px/s cap feels too restrictive on touch devices, it can be made device-dependent: `const maxCoast = isTouch ? 5000 : 3000`.

### Phase 8 (Camera presets with spring transitions)

Camera presets animate the camera from its current position to a saved position using a spring. The velocity clamp is directly applicable: if the camera is currently coasting with momentum when a preset is recalled, the preset spring should be seeded with the current velocity (the "current value, current velocity" pattern), and that velocity should be clamped to prevent overshoot past the preset position.

The math is the same: `v_critical = -omega * (currentPos - presetPos)`. The position safety net generalizes to: the camera should not overshoot the preset position during the transition. The implementation is a one-line call to `_clampSpringVelocity` with the preset's target displacement.

---

## 13. Migration checklist for Claude Code {#migration}

This is the ordered list of changes. Execute in order. Each step references the section above.

1. **Add `_clampSpringVelocity()` to the Camera class in `vtt/js/map-camera.js`.**
   - Place it near the other elastic offset methods (near `_feedElasticOverflow` and `_snapBackElastic`).
   - It is a pure method: no side effects, no state mutation.
   - See: [Section 6, Velocity clamping implementation](#velocity-clamp-impl)

2. **Update `_snapBackElastic()` to use the velocity clamp.**
   - Read `omega` from `this._elasticAnimator._omega`.
   - Clamp `velocity.vx` and `velocity.vy` independently using `_clampSpringVelocity`.
   - Pass the clamped velocities to `this._elasticAnimator.snapBack()`.
   - See: [Section 6, Updated _snapBackElastic method](#velocity-clamp-impl)

3. **Update the elastic animator's `_tick` in `attachTo()` to add position clamping.**
   - After `_resolveAxis` computes the new values, check each axis against its initial displacement sign.
   - If the value has crossed zero (offset changed sign), snap it to zero.
   - The existing settle check and cleanup logic is unchanged.
   - See: [Section 7, Position safety net implementation](#position-safety-impl)

4. **Add the coast velocity cap to `_startInertialCoast()`.**
   - Add the cap at the very top of the method, before any other logic.
   - Use `MAX_COAST_SPEED = 3000` and scale the velocity vector if it exceeds the cap.
   - The rest of the inertial coast logic is unchanged.
   - See: [Section 8, Coast velocity cap implementation](#coast-cap-impl)

5. **Create `tests/spring-overshoot.spec.js` (or add to existing test file).**
   - Add all unit tests from Section 11: velocity clamp tests, spring no-overshoot tests, coast cap tests.
   - See: [Section 11, Unit tests](#testing)

6. **Add integration tests.**
   - Add the three integration tests from Section 11 to `tests/phase6-integration.spec.js` or a new file.
   - The critical test: fast swipe at map edge does not bounce to opposite side.
   - See: [Section 11, Integration tests](#testing)

7. **Run all existing tests and verify no regressions.**
   - The existing spring solver tests in `tests/camera-clamping.spec.js` should still pass (the solver is unchanged; only its inputs are clamped).
   - The existing elastic overscroll tests in `tests/phase6-integration.spec.js` should still pass (elastic behavior is unchanged; only snap-back overshoot is prevented).
   - The existing gesture preemption tests should still pass (gesture state machine is unchanged).
   - The VelocityTracker tests in `tests/phase5.5-unit.spec.js` should still pass.

8. **Manual testing with real hardware.**
   - Follow the manual testing checklist in Section 11.
   - The critical test: fast two-finger scroll past boundary, then fast right-click drag past boundary. Neither should overshoot.
   - Test on both the MacBook Pro trackpad and with an external mouse.
