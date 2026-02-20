# Elastic overscroll and advanced input handling for a browser VTT camera

**No major canvas or mapping library implements elastic overscroll on wheel/scroll events** — every production app surveyed (tldraw, Mapbox GL JS, Leaflet, Figma, Miro, Google Maps, Excalidraw) uses hard clamping at boundaries for wheel input. Elastic effects exist only for drag and touch interactions. Implementing this for trackpad scroll would be a genuine differentiator for the VTT. The core technical challenge — detecting when trackpad fingers lift — has no browser API solution, but proven heuristic approaches exist using delta decay analysis and timeout-based gesture end detection. Apple's own UIScrollView *does* allow momentum to push past boundaries with rubber-banding, making that the correct target behavior for macOS users.

---

## The scroll gesture lifecycle problem and how to solve it

The fundamental challenge is that browsers expose no event for "user's fingers left the trackpad." The W3C proposal for `WheelEvent.isInertialScrolling` (uievents#58) has been open since 2015 with no implementation in any browser. The `scrollend` event (baseline since 2023) fires only *after* momentum completes, far too late for triggering snap-back. And critically, since the VTT calls `preventDefault()` on wheel events to take control of scrolling, `scrollend` never fires at all.

The proven solution is a three-state machine — **IDLE → ACTIVE → MOMENTUM** — driven by two complementary heuristics. First, a **timeout debounce** of 120–150ms resets on every wheel event and fires the gesture-end transition when no events arrive. This timeout must be long enough to avoid false triggers during slow deliberate scrolling (where gaps of 50–80ms between events are normal) but short enough to feel responsive. Second, **delta decay detection** identifies the ACTIVE→MOMENTUM transition: momentum events on macOS arrive at a steady ~16ms cadence with monotonically decreasing delta magnitudes, while active scrolling produces irregular, non-decaying deltas. Three or more consecutive events where `|delta|` decreases reliably signals the onset of momentum.

The `wheel-gestures` library (174K weekly npm downloads, tested on macOS/Windows across all browsers) packages this exact pattern, exposing `isStart`, `isMomentum`, `isEnding`, and `isMomentumCancel` flags. For a vanilla JS implementation without the dependency, here is the recommended detector:

```javascript
class TrackpadGestureDetector {
  constructor({ onStart, onMove, onMomentumStart, onEnd }) {
    this.callbacks = { onStart, onMove, onMomentumStart, onEnd };
    this.state = 'IDLE'; // IDLE | ACTIVE | MOMENTUM
    this.endTimer = null;
    this.lastAbsDelta = 0;
    this.decayStreak = 0;
    this.eventCount = 0;
    this.lastEventTime = 0;
  }

  handleWheel(e) {
    const now = performance.now();
    const absDelta = Math.abs(e.deltaY) + Math.abs(e.deltaX);
    const timeSinceLast = now - this.lastEventTime;
    clearTimeout(this.endTimer);

    if (this.state === 'IDLE') {
      this.state = 'ACTIVE';
      this.decayStreak = 0;
      this.eventCount = 0;
      this.callbacks.onStart?.(e);
    } else if (this.state === 'MOMENTUM') {
      // New gesture interrupting momentum: delta jumps up or long gap
      if (absDelta > this.lastAbsDelta * 1.5 || timeSinceLast > 120) {
        this.state = 'ACTIVE';
        this.decayStreak = 0;
        this.eventCount = 0;
        this.callbacks.onStart?.(e);
      }
    }

    if (this.state === 'ACTIVE') {
      this.eventCount++;
      if (absDelta < this.lastAbsDelta * 0.97 && absDelta > 0) {
        this.decayStreak++;
      } else {
        this.decayStreak = 0;
      }
      // Sustained decay after enough samples → momentum
      if (this.decayStreak >= 3 && this.eventCount > 6) {
        this.state = 'MOMENTUM';
        this.callbacks.onMomentumStart?.(e);
      }
    }

    this.callbacks.onMove?.(e, this.state);
    this.lastAbsDelta = absDelta;
    this.lastEventTime = now;

    const timeout = this.state === 'MOMENTUM' ? 100 : 150;
    this.endTimer = setTimeout(() => {
      this.state = 'IDLE';
      this.callbacks.onEnd?.();
    }, timeout);
  }
}
```

A key edge case: **Firefox does not expose the non-standard `wheelDeltaY` property** that `lethargy` relies on. The standard `deltaY` works for decay detection across all browsers, but Firefox's delta magnitudes differ from Chrome/Safari. The `0.97` threshold factor (rather than strict less-than) absorbs this noise. Another edge case: when a user starts a new scroll gesture during active momentum, the delta will suddenly increase or a >120ms gap appears — both signals trigger the `isMomentumCancel` transition back to ACTIVE.

---

## How Apple actually handles momentum at boundaries

Apple's UIScrollView treats momentum and active drag differently in implementation but **both produce elastic overscroll**. This was confirmed through Ilya Lobanov's reverse-engineering of UIScrollView and Apple's WWDC 2018 "Designing Fluid Interfaces" session. The implementation uses two sequential animations joined by preserving velocity at the transition point:

1. **Deceleration phase**: After finger lift, velocity decays per `v(t) = v₀ · d^(1000t)` where `d = 0.998` (UIScrollView.DecelerationRate.normal). At 60fps, this means the per-frame multiplier is approximately **0.967**.

2. **Boundary collision**: The system projects the final resting position. If it falls past a boundary, it calculates the exact time and velocity at the boundary intersection.

3. **Spring bounce**: A **critically damped spring** (damping ratio ζ = 1.0) takes over with the collision velocity as its initial velocity. This causes the content to overshoot past the boundary and smoothly return — the rubber-band formula is **not** used during momentum bounce. The spring alone produces the correct visual displacement and return.

4. **Active drag past boundary**: When a finger is actively pushing past the boundary, the rubber-band formula determines the visual offset: **`b = (1.0 - (1.0 / ((x * 0.55 / d) + 1.0))) * d`** where `x` is the distance past the edge, `c = 0.55` is the resistance coefficient, and `d` is the viewport dimension. The output asymptotically approaches `d` — content can never rubber-band more than one viewport dimension past the boundary.

The critical insight for the VTT implementation: **velocity continuity at the deceleration→spring junction makes the transition seamless**. The spring's initial velocity must match the momentum velocity at the exact moment of boundary contact. As Lobanov noted, "Due to the fact that we used the same concept of velocity, the junction of the two animations automatically turned out to be smooth."

For the VTT, the recommended rubber-band function and spring:

```javascript
function rubberBand(offset, dimension, c = 0.55) {
  if (offset === 0) return 0;
  const sign = Math.sign(offset);
  const x = Math.abs(offset);
  return sign * (1.0 - (1.0 / ((x * c / dimension) + 1.0))) * dimension;
}

class CriticallyDampedSpring {
  constructor(stiffness = 400, mass = 1) {
    this.omega = Math.sqrt(stiffness / mass); // ≈ 20, settles in ~250ms
  }
  evaluate(x0, v0, t) {
    const w = this.omega;
    const exp = Math.exp(-w * t);
    const value = (x0 + (v0 + w * x0) * t) * exp;
    const velocity = ((v0 + w * x0) - w * (x0 + (v0 + w * x0) * t)) * exp;
    return { value, velocity, done: Math.abs(value) < 0.5 && Math.abs(velocity) < 0.5 };
  }
}
```

With **stiffness = 400** and **mass = 1**, the spring natural frequency ω ≈ 20 produces a settling time of roughly **250ms** (reaching 2% of initial displacement at t ≈ 4/ω). This matches Apple's snap-back feel. The closed-form solution avoids Euler integration entirely, consistent with the existing codebase.

---

## Dual-position architecture for elastic offset

The cleanest pattern separates the "logical" camera position (always constrained to valid bounds) from the "elastic offset" (a visual-only displacement that renders past boundaries). This avoids corrupting the real camera state and makes BroadcastChannel sync straightforward — only logical position is broadcast.

```javascript
class Camera {
  constructor() {
    this.x = 0;               // logical position (always within bounds)
    this.y = 0;
    this.zoom = 1;
    this.elasticX = 0;         // visual offset beyond bounds
    this.elasticY = 0;
  }

  get visualX() { return this.x + this.elasticX; }
  get visualY() { return this.y + this.elasticY; }

  panBy(dx, dy, bounds, allowElastic = false) {
    const rawX = this.x + dx;
    const rawY = this.y + dy;
    const clampedX = clamp(rawX, bounds.minX, bounds.maxX);
    const clampedY = clamp(rawY, bounds.minY, bounds.maxY);
    this.x = clampedX;
    this.y = clampedY;

    if (allowElastic) {
      const overflowX = rawX - clampedX;
      const overflowY = rawY - clampedY;
      // Accumulate and rubber-band the overflow
      this.elasticX = rubberBand(this.elasticX + overflowX, bounds.width);
      this.elasticY = rubberBand(this.elasticY + overflowY, bounds.height);
    }
  }
}
```

The existing `_applyConstraints()` method can branch on gesture state: during ACTIVE scroll and MOMENTUM states, overflow feeds into the elastic offset via the rubber-band formula. During IDLE or after momentum ends, the elastic offset drives the spring snap-back animation. The renderer always uses `visualX`/`visualY`, and `sendImmediate()` on the BroadcastChannel always sends the logical `x`/`y` — display windows clamp to bounds without elastic artifacts.

---

## Momentum handling: rely on macOS or build your own?

For **two-finger trackpad scroll**, the recommendation is to **rely on OS momentum events and apply rubber-banding to them**. macOS generates synthetic wheel events with decaying deltas after finger lift; these events are already tuned to the user's system preferences (including "Use inertia when scrolling" toggle and natural/traditional scroll direction). The browser normalizes `deltaY` sign regardless of the scroll direction preference — no compensation needed.

The gesture detector's `onMomentumStart` callback signals the transition. During momentum, continue applying deltas to the camera but with **dampened elasticity**: either reduce the rubber-band coefficient (use `c = 0.3` instead of `0.55`) or cap the maximum elastic displacement during momentum to prevent excessive overscroll from high-velocity flings. When momentum events stop (timeout fires), trigger the spring snap-back from whatever elastic offset accumulated.

For **mouse drag panning**, the OS provides no momentum — implement your own using the exponential decay model with velocity tracking over a 100ms rolling window:

```javascript
class VelocityTracker {
  constructor(windowMs = 100) {
    this.samples = [];
    this.windowMs = windowMs;
  }
  addSample(x, y) {
    const now = performance.now();
    this.samples.push({ x, y, t: now });
    while (this.samples.length > 1 && now - this.samples[0].t > this.windowMs)
      this.samples.shift();
  }
  getVelocity() {
    if (this.samples.length < 2) return { x: 0, y: 0 };
    const first = this.samples[0], last = this.samples.at(-1);
    const dt = (last.t - first.t) / 1000;
    if (dt < 0.001) return { x: 0, y: 0 };
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
  }
}
```

Use position samples (not frame-to-frame deltas, which are too noisy). On mouseup, if velocity exceeds a threshold (~100 px/s), start momentum with per-frame friction of **0.95–0.97**. When momentum hits a boundary, transfer remaining velocity to the spring for a seamless bounce.

---

## Smooth zoom animation for discrete mouse wheel input

Mouse scroll wheels produce jarring step changes. Production apps solve this with **target-based animation**: each wheel notch sets a new target zoom level, and an exponential lerp chases it. Rapid scrolling accumulates a larger target difference, creating natural acceleration. Mapbox GL JS uses a Bezier easing curve; Figma and Google Maps use similar interpolation:

```javascript
class SmoothZoomAnimator {
  constructor(camera) {
    this.camera = camera;
    this.targetZoom = camera.zoom;
    this.animating = false;
    this.anchor = { wx: 0, wy: 0, sx: 0, sy: 0 };
    this.SMOOTHING = 0.15; // lerp factor: 0.1 = silky, 0.3 = snappy
  }

  onWheelZoom(deltaY, screenX, screenY) {
    const factor = deltaY > 0 ? 1 / 1.15 : 1.15; // ~15% per notch
    this.targetZoom = clamp(this.targetZoom * factor, MIN_ZOOM, MAX_ZOOM);
    // Anchor: convert cursor to world space ONCE per new event
    this.anchor.sx = screenX;
    this.anchor.sy = screenY;
    this.anchor.wx = (screenX - this.camera.offsetX) / this.camera.zoom;
    this.anchor.wy = (screenY - this.camera.offsetY) / this.camera.zoom;
    if (!this.animating) this.animate();
  }

  animate() {
    this.animating = true;
    const step = () => {
      const logCur = Math.log(this.camera.zoom);
      const logTgt = Math.log(this.targetZoom);
      this.camera.zoom = Math.exp(logCur + (logTgt - logCur) * this.SMOOTHING);
      // Preserve cursor anchor: same world point stays under cursor
      this.camera.offsetX = this.anchor.sx - this.anchor.wx * this.camera.zoom;
      this.camera.offsetY = this.anchor.sy - this.anchor.wy * this.camera.zoom;
      if (Math.abs(this.camera.zoom - this.targetZoom) > 0.001) {
        requestAnimationFrame(step);
      } else {
        this.camera.zoom = this.targetZoom;
        this.animating = false;
      }
    };
    requestAnimationFrame(step);
  }
}
```

The **lerp in log-space** (exponential smoothing) ensures zooming in and out feel symmetrical. The cursor-anchor formula is: `newOffset = screenPoint - worldPoint × newZoom`. Mapbox GL JS additionally uses a heuristic to distinguish trackpad from mouse — `(Math.abs(timeDelta * value) < 200) ? 'trackpad' : 'wheel'` — applying smooth animation only for mouse and direct 1:1 mapping for trackpad pinch. This dual-mode behavior is worth replicating.

---

## Pinch zoom, rotation, and platform-specific input handling

**Pinch-to-zoom** manifests as `wheel` events with `ctrlKey: true` in Chrome and Firefox, and additionally as `GestureEvent` in Safari. Safari 15+ also emits the ctrlKey wheel events, so using wheel as the unified approach works across browsers. The critical implementation detail: `{ passive: false }` is mandatory on the event listener to call `preventDefault()` and suppress native browser page zoom. Chrome 56+ defaults wheel listeners to passive on document/window.

```javascript
element.addEventListener('wheel', handler, { passive: false });
// Safari: also prevent gesture defaults
element.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
element.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
```

**Rotation** is Safari-only via `GestureEvent.rotation` (degrees, clockwise positive). Chrome and Firefox expose no rotation data from trackpad gestures — the W3C has open proposals but no implementations. For a VTT, rotation adds complexity without broad browser support. If implemented, it should be opt-in with a snap-to-north reset to prevent accidental disorientation.

**Delta normalization** is essential for cross-platform consistency. Firefox is the only browser that uses `DOM_DELTA_LINE` (value 1) and `DOM_DELTA_PAGE` (value 2); Chrome and Safari almost always report `DOM_DELTA_PIXEL` (value 0). Apply multipliers: **8px per line, 24px per page** as conservative conversion factors. Also detect likely mouse-vs-trackpad input: `Math.abs(deltaY) >= 50 && deltaY % 1 === 0` suggests a notched mouse wheel; smaller fractional values suggest trackpad.

**Three-finger gestures** are not viable — macOS captures them for Mission Control and app switching before they reach the browser. **Force Touch** (Safari-only `webkitmouseforcechanged` events) provides pressure data on MacBook Pro trackpads but should never be the only path to functionality. **Middle-click drag** for panning is a standard expectation for mouse users — listen on button 1 with `auxclick` prevention to suppress the browser's autoscroll icon. **Forward/back mouse buttons** (buttons 3 and 4) can be captured via `auxclick` with `preventDefault()` to block default browser navigation; useful for undo/redo.

For **Linux**, trackpad pinch zoom requires Wayland (Firefox 88+, enabled via `apz.gtk.touchpad_pinch.enabled`). X11 has no reliable touchpad gesture support in browsers. Windows precision touchpads behave nearly identically to macOS trackpads in Chrome/Edge.

---

## The unified gesture state machine

The recommended architecture is a hierarchical state machine with states ordered by priority. Direct manipulation (pointer events) always preempts indirect input (wheel/momentum). The elastic overscroll layer is orthogonal — a visual offset computed from the difference between logical and display position, not a state in itself.

```
IDLE ──wheel──→ SCROLL_PANNING ──decay──→ MOMENTUM ──timeout──→ SNAP_BACK → IDLE
  │                  ↑                        │
  │──pointer down──→ DRAGGING ──pointer up──→ MOMENTUM (if velocity > threshold)
  │                                           │              │
  │──wheel+ctrl──→ PINCH_ZOOMING             │──new gesture──→ cancel → new state
  │──discrete wheel──→ ZOOM_ANIMATING (retargetable)
```

Transition rules: any `pointerdown` immediately cancels momentum or snap-back and enters DRAGGING. Any wheel event during momentum with a delta spike (>1.5× previous) or after a >120ms gap restarts as ACTIVE scroll. Zoom animation is retargetable — new wheel events accumulate the target without interrupting the animation. Snap-back is interruptible by any user gesture, preserving the current spring velocity as the new gesture's initial state.

For the animation system, a single `AnimationController` manages active animations by key, running `requestAnimationFrame` only when animations exist. Cap `dt` at **64ms** to handle background tab throttling gracefully — this prevents huge position jumps when the tab regains focus. For BroadcastChannel sync, always call `sendImmediate()` with the logical camera state (not visual), and receiving windows apply positions directly without animation.

---

## Testing strategies with Playwright

Playwright's `page.mouse.wheel(deltaX, deltaY)` simulates basic wheel events but cannot set `ctrlKey`, `deltaMode`, or other properties. For pinch-zoom testing, hold Control:

```javascript
await page.keyboard.down('Control');
await page.mouse.wheel(0, -50);
await page.keyboard.up('Control');
```

Momentum scrolling cannot be simulated natively. Instead, dispatch custom wheel events with progressively decaying deltas via `page.evaluate()`, or expose test hooks (`window.__simulateGesture(type, params)`) that bypass the DOM event layer and drive the gesture state machine directly. For testing spring animations, **mock `requestAnimationFrame`** to step frames deterministically:

```javascript
await page.evaluate(() => {
  const cbs = [];
  window._realRAF = window.requestAnimationFrame;
  window.requestAnimationFrame = cb => cbs.push(cb) && cbs.length;
  window._stepFrame = (ms) => {
    const batch = [...cbs]; cbs.length = 0;
    batch.forEach(cb => cb(performance.now() + ms));
  };
});
// Step 15 frames at 16.67ms each
for (let i = 0; i < 15; i++)
  await page.evaluate(() => window._stepFrame(16.67));
```

This gives deterministic control over animation progression, essential for asserting intermediate spring positions and elastic offsets.

## Conclusion

The core architectural insight is the **dual-position model** — logical camera state (always clamped, synced via BroadcastChannel) separated from elastic visual offset (local, animated, rubber-banded). This keeps the constraint system clean: `_applyConstraints()` continues to hard-clamp the logical position, while overflow feeds into a rubber-band function whose output drives the visual offset alone. The gesture detector's state (ACTIVE vs MOMENTUM vs IDLE) determines whether overflow is permitted and triggers the spring snap-back.

The biggest implementation risk is **false momentum detection during slow scrolling**, where small constant deltas resemble late-stage momentum decay. The mitigation is to require monotonic *decrease* (not just small magnitude) over 3+ consecutive events, combined with a minimum event count threshold of 6. This means a slow, steady scroll with constant deltas of 2–3 px will never trigger the MOMENTUM transition regardless of magnitude.

No production canvas library has implemented elastic overscroll on wheel input — they all hard-clamp. Apple's own UIScrollView does permit momentum to produce elastic overscroll, and macOS users have this as their baseline expectation. Matching that behavior with the dual-position architecture, the rubber-band formula (`c = 0.55`, `d = viewport dimension`), and a critically damped spring (stiffness 400, mass 1, ω ≈ 20, settling ~250ms) will produce the most natural-feeling result achievable in a browser today.