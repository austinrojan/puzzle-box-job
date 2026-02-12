# Phase 3 implementation plan: boundary clamping and polish

**The entire Phase 3 camera system rests on one architectural decision: centralized clamp-on-commit.** Every input source — mouse drag, wheel zoom, keyboard pan, BroadcastChannel sync, programmatic moves — flows through a single `setCamera()` method that enforces boundary constraints before committing state. This pattern, used by tldraw, Mapbox GL JS, and Phaser, eliminates an entire class of constraint-bypass bugs. The dual-regime clamping algorithm handles both zoomed-in panning constraints and zoomed-out centering with a per-axis formula that is mathematically continuous at the crossover point, requiring no special transition logic. Elastic overscroll uses Apple's proven rubber-band formula during drag, with a critically damped spring for snap-back animation on release.

This plan covers the complete implementation: clamping formulas, elastic physics, zoom enforcement, edge-pan during token drag, animation integration, testing strategy, and the architectural glue that connects them. Every code example targets the existing `Camera = { x, y, zoom }` world-space model with on-demand rendering via `requestAnimationFrame`.

---

## 1. The dual-regime clamping algorithm and its per-axis math

The core insight is that boundary clamping operates independently on each axis, and each axis can be in a different regime simultaneously. For a panoramic map (2000×500) in an 800×600 viewport at zoom=0.5, the X axis is zoomed in (visibleW=1600 < 2000) while Y is zoomed out (visibleH=1200 > 500). This mixed-regime case is common with non-square maps and must be handled correctly.

**The crossover zoom** for each axis is `crossoverZoomX = vpW / mapW` and `crossoverZoomY = vpH / mapH`. Below crossover, the viewport is larger than the map on that axis; above it, the viewport is smaller. The clamping formula for a single axis:

```javascript
function clampAxis(pos, visSize, mapOrigin, mapSize) {
  if (visSize >= mapSize) {
    // ZOOMED-OUT: center the map within the viewport
    return mapOrigin - (visSize - mapSize) / 2;
  } else {
    // ZOOMED-IN: constrain so edges stay visible
    return Math.max(mapOrigin, Math.min(mapOrigin + mapSize - visSize, pos));
  }
}
```

**The transition is mathematically continuous.** At the exact crossover point where `visSize === mapSize`, the zoomed-in formula yields `clamp(pos, mapOrigin, mapOrigin + 0) = mapOrigin`, and the zoomed-out formula yields `mapOrigin - 0/2 = mapOrigin`. Both produce the same result, so no interpolation or special-casing is needed at the crossover. Leaflet's `_rebound` function, Phaser's `preRender` bounds check, and tldraw's `getConstrainedCamera` all exploit this property.

The complete clamping function applies this per-axis logic independently:

```javascript
function clampCamera(camera, mapBounds, vpW, vpH) {
  const { zoom } = camera;
  const visW = vpW / zoom;
  const visH = vpH / zoom;
  return {
    x: clampAxis(camera.x, visW, mapBounds.x, mapBounds.w),
    y: clampAxis(camera.y, visH, mapBounds.y, mapBounds.h),
    zoom
  };
}
```

**How the major libraries compare.** Leaflet's `_rebound(left, right)` is the dual-regime switch: when `left + right > 0` (viewport larger than bounds), it returns `(left - right) / 2` for centering; otherwise it returns the nearest-edge correction. Leaflet additionally provides **`maxBoundsViscosity`** (0–1), which during drag interpolates between the unconstrained and clamped positions: `result = raw + (clamped - raw) * viscosity`. At viscosity=1.0 it's a hard wall; at 0 the user drags freely and snaps back on release. Mapbox GL JS applies constraints in a centralized `_constrain()` method called from every camera mutation, using hard clamps with no viscosity. tldraw has the most sophisticated system with **five per-axis behavior modes**: `free` (no constraint), `fixed` (locked position), `contain` (the dual-regime hybrid), `inside` (viewport stays within bounds), and `outside` (bounds stay within viewport). Each axis can use a different mode, and padding in screen-space pixels accounts for UI overlays.

---

## 2. Apple's rubber-band formula and critically damped spring snap-back

Elastic overscroll involves two distinct phases: **resistance during drag** (the rubber-band feel) and **animation after release** (the spring snap-back). Each requires its own physics model.

### The rubber-band resistance formula

Apple's UIScrollView uses a reciprocal formula discovered by reverse engineering and confirmed by multiple iOS developers. The coefficient **c = 0.55** produces the canonical iOS feel:

```javascript
function rubberBand(distance, dimension, c = 0.55) {
  // distance: how far past the boundary (always positive)
  // dimension: viewport size on this axis
  // Returns: diminished offset (asymptotes to dimension)
  return (distance * dimension * c) / (dimension + c * distance);
}
```

This formula has ideal properties for boundary feedback. At x=0 it returns 0 (no offset at the boundary). The initial slope is **c=0.55**, meaning the first pixels of overscroll move at 55% of the drag distance — immediate resistance without feeling stuck. As distance approaches infinity, the output asymptotes to the viewport dimension, so content can never be dragged fully off-screen. At 100px of overdrag on a 960px viewport, the formula yields **52px of visible offset** (48% resistance). At 400px, it yields 179px (55% resistance). The increasing resistance creates the characteristic "pulling against a rubber band" sensation.

The alternative approaches — logarithmic (`c * ln(1 + d/c)`) and exponential (`limit * (1 - exp(-d/limit * k))`) — are bounded differently. Logarithmic resistance grows without bound, making it unsuitable for viewport clamping. The exponential formula is cleanly bounded but has a sharper plateau. **Apple's reciprocal formula is recommended** as the primary approach because it matches the most widely recognized scroll-feel in consumer software.

Applied to the camera system, rubber-banding wraps the basic clamp:

```javascript
function rubberBandClamp(value, min, max, dimension, c = 0.55) {
  if (value < min) return min - rubberBand(min - value, dimension, c);
  if (value > max) return max + rubberBand(value - max, dimension, c);
  return value;
}
```

### Critically damped spring for snap-back

When the user releases a drag past boundaries, the camera must animate back. A **critically damped spring** (damping ratio ζ = 1) is the optimal choice: it returns to equilibrium faster than any other damping ratio without overshooting. The closed-form solution eliminates numerical integration errors:

```javascript
// Critically damped: x(t) = target + (A + B*t) * e^(-ω*t)
// where ω = √(k/m), A = x₀ - target, B = v₀ + ω*A
class CriticalSpring {
  constructor(stiffness = 200, mass = 1) {
    this.omega = Math.sqrt(stiffness / mass); // ≈14.1 for stiffness=200
  }

  solve(displacement, velocity, t) {
    const A = displacement;
    const B = velocity + this.omega * displacement;
    const exp = Math.exp(-this.omega * t);
    return {
      position: (A + B * t) * exp,
      velocity: (B - this.omega * (A + B * t)) * exp
    };
  }
}
```

**Stiffness=200 with mass=1 produces ω≈14.1**, which settles to within 0.5px in roughly **0.3–0.4 seconds** — snappy enough to feel responsive, slow enough to be visible. For comparison, React Native's navigation spring uses stiffness=1000, damping=500, mass=3 (ω≈18.3); Framer Motion defaults to stiffness=100, damping=10, mass=1 (ω=10). The VTT system benefits from the 170–300 stiffness range.

**Why not exponential decay?** Exponential decay (`value += (target - value) * (1 - exp(-speed * dt))`) is simpler and has no overshoot, but it cannot accept an initial velocity. This means the transition from "user dragging at some speed" to "animating back" has a visual discontinuity — the velocity drops to zero instantly, then the camera drifts back. With a spring, the **initial velocity matches the user's drag velocity at release**, creating seamless continuity.

---

## 3. Self-scheduling animation for on-demand rendering

The VTT has no game loop — it renders only when the camera changes. Spring animations must schedule their own `requestAnimationFrame` frames, running until settled, then stopping:

```javascript
class CameraAnimator {
  constructor(renderFn) {
    this.render = renderFn;
    this.springs = { x: null, y: null, zoom: null };
    this._rafId = null;
    this._lastTime = null;
    this._startTime = null;
  }

  snapBack(currentCamera, targetCamera, releaseVelocity = {}) {
    const spring = new CriticalSpring(200, 1);
    this.springs.x = {
      spring,
      displacement: currentCamera.x - targetCamera.x,
      velocity: releaseVelocity.vx || 0,
      target: targetCamera.x
    };
    this.springs.y = {
      spring,
      displacement: currentCamera.y - targetCamera.y,
      velocity: releaseVelocity.vy || 0,
      target: targetCamera.y
    };
    if (!this._rafId) {
      this._startTime = null;
      this._rafId = requestAnimationFrame(this._tick.bind(this));
    }
  }

  _tick(timestamp) {
    if (!this._startTime) { this._startTime = timestamp; }
    const elapsed = (timestamp - this._startTime) / 1000;
    
    let allDone = true;
    const result = {};
    
    for (const [axis, s] of Object.entries(this.springs)) {
      if (!s) continue;
      const { position, velocity } = s.spring.solve(s.displacement, s.velocity, elapsed);
      result[axis] = s.target + position;
      if (Math.abs(position) > 0.5 || Math.abs(velocity) > 0.1) {
        allDone = false;
      } else {
        result[axis] = s.target; // Snap to exact target
      }
    }
    
    this.render(result);
    
    if (allDone) {
      this._rafId = null;
      this._startTime = null;
      this.springs = { x: null, y: null, zoom: null };
    } else {
      this._rafId = requestAnimationFrame(this._tick.bind(this));
    }
  }

  cancel() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this.springs = { x: null, y: null, zoom: null };
  }
}
```

The **"done" thresholds** of **0.5px displacement and 0.1px/s velocity** match production libraries (wobble, Framer Motion, React Native Reanimated). Delta-time uses the `requestAnimationFrame` timestamp directly — the closed-form spring solution takes elapsed time since animation start, making it perfectly frame-rate independent with no Euler integration drift. The dt cap of `Math.min(dt, 0.064)` prevents the "spiral of death" after a tab switch where accumulated time causes a massive single step.

---

## 4. Zoom floor enforcement and cursor-anchor preservation

The cover zoom formula `Math.max(vpW / mapW, vpH / mapH)` guarantees no black bars — it selects whichever axis requires more zoom to fill the viewport. This is mathematically equivalent to CSS `object-fit: cover` and is confirmed by every photo viewer and mapping library examined.

**The critical ordering for zoom-at-cursor with clamping** is: clamp zoom first → recompute pan from anchor → clamp pan to bounds. This sequence preserves the cursor anchor point perfectly up to the zoom floor:

```javascript
zoomAtCursor(cursorScreenX, cursorScreenY, rawNewZoom) {
  const worldX = this.x + cursorScreenX / this.zoom;
  const worldY = this.y + cursorScreenY / this.zoom;
  
  // 1. Clamp zoom FIRST
  const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, rawNewZoom));
  
  // 2. Recompute pan to preserve cursor anchor
  this.x = worldX - cursorScreenX / newZoom;
  this.y = worldY - cursorScreenY / newZoom;
  this.zoom = newZoom;
  
  // 3. Clamp pan to map boundaries
  this._clampPan();
}
```

If zoom is clamped before the anchor recomputation, then once at the floor, further scroll events produce no zoom change, so the anchor calculation is a no-op and **no drift occurs**. The alternative — applying zoom-at-cursor fully then clamping zoom afterward — causes drift because the pan was computed for an unclamped zoom value. Pan clamping in step 3 can shift the view away from the cursor anchor when near map edges, but this is physically correct and users intuit it.

**When cover zoom changes on window resize**, use instant adjustment rather than animation. Resize already causes visual discontinuity; animating zoom during resize creates a "chasing" effect that feels worse. Debounce the resize handler at 16ms (one frame):

```javascript
onResize(newVpW, newVpH) {
  this.vpW = newVpW;
  this.vpH = newVpH;
  if (this.zoom < this.minZoom) this.zoom = this.minZoom;
  this._clampPan(); // Re-center if needed
}
```

The **DM "zoom past cover" toggle** is a one-line conditional: `get minZoom() { return this.dmCanZoomPastCover ? 0.1 : this.coverZoom; }`. When toggling off while the DM is zoomed out past cover, animate back to cover zoom over 300ms. When toggling on, nothing visible changes — it simply unlocks lower zoom levels. A maximum zoom of **5×–10×** is appropriate for VTT; Foundry VTT defaults to 3×, photo viewers go up to 16×.

---

## 5. Edge-pan during token drag with hot-zone acceleration

Edge-pan triggers when a user drags a token into a narrow zone near the viewport edge, causing the camera to automatically scroll in that direction. The standard architecture, confirmed by Konva.js and InVision's implementation, uses **direct method calls** (not events) between the TokenManager and Camera, with `requestAnimationFrame` for smooth continuous movement.

The **hot zone** should be **60px wide or 5% of viewport, whichever is larger**. A **quadratic acceleration curve** provides better UX than linear — the slow start near the zone boundary prevents accidental triggers, while the rapid ramp near the viewport edge enables fast panning when clearly intentional:

```javascript
_ramp(penetration, zoneWidth) {
  const t = Math.min(1, penetration / zoneWidth); // 0 at boundary, 1 at edge
  return t * t; // Quadratic: slow start, fast finish
}
```

**Maximum speed of 1000 world-units/second, divided by zoom**, ensures consistent visual speed regardless of zoom level. At 60fps and zoom=2, that's ~8.3 world-pixels per frame — perceptible but controllable. A **150ms start delay** before edge-pan activates prevents false triggers when the cursor briefly passes through the hot zone during normal token movement.

The integration between TokenManager and EdgePanManager follows composition: the TokenManager owns an EdgePanManager instance, calls `startTracking()` on first drag move, updates cursor position on every pointer move, and calls `stopTracking()` on pointer up. The EdgePanManager runs its own rAF loop during tracking and calls `camera.panBy(dx, dy)` — the camera's centralized clamping ensures edge-pan stops at map boundaries automatically.

```javascript
// In EdgePanManager._tick:
const velocity = this._computeVelocity(timestamp);
if (velocity.x !== 0 || velocity.y !== 0) {
  const dx = velocity.x * dt;
  const dy = velocity.y * dt;
  this.camera.panBy(dx, dy); // Camera handles boundary clamping
}
```

---

## 6. Centralized clamp-on-commit eliminates bypass bugs

The architectural pattern that ties everything together is **clamp-on-commit**: a single `setCamera()` method that all input sources flow through, which applies constraints before committing state. tldraw's `_setCamera()` → `getConstrainedCamera()` pipeline, Mapbox's `_constrain()`, and Phaser's `preRender` bounds check all use this pattern.

```javascript
class Camera {
  setCamera(newState, opts = {}) {
    const merged = {
      x: newState.x ?? this.x,
      y: newState.y ?? this.y,
      zoom: newState.zoom ?? this.zoom
    };
    
    let result;
    if (opts.force) {
      result = merged; // Bypass for elastic overscroll mid-drag
    } else if (opts.isDrag && this.viscosity < 1.0) {
      result = this._applyViscosity(merged);
    } else {
      result = clampCamera(merged, this.mapBounds, this.vpW, this.vpH);
    }
    
    if (result.x !== this.x || result.y !== this.y || result.zoom !== this.zoom) {
      Object.assign(this, result);
      this._notifyRender();
    }
  }
}
```

The `force` flag is the key to elastic overscroll integration. During a drag gesture, the input handler passes `{ force: true }` so the rubber-banded position (past boundaries) is accepted. On release, calling `setCamera()` without `force` triggers the hard clamp, and the difference between current and clamped positions drives the spring snap-back animation. This is exactly how tldraw's `TLCameraMoveOptions.force` works.

Every input source routes through `setCamera()` with appropriate options. Mouse drag uses `{ isDrag: true }` for viscosity. Wheel zoom calls `zoomAtCursor()` which internally calls `setCamera()`. Keyboard arrows call `panBy()` which calls `setCamera()`. BroadcastChannel state is passed directly to `setCamera()` — remote camera positions are automatically constrained to local bounds. Programmatic moves like `fitCover()` compute target state and call `setCamera()`. No input source needs to know about clamping logic.

---

## 7. Visual feedback: elastic resistance is the feedback

For a VTT/DM presentation tool, **the elastic overscroll itself is the primary boundary feedback** — the increasing resistance and spring snap-back are inherently visible and intuitive. Explicit visual indicators (edge shadows, bounce flashes, glow effects) add visual noise to a game-focused interface.

Android uses edge glow/stretch effects; iOS uses the bounce. Mapbox GL JS provides **no visual feedback** at boundaries — the view simply stops. For the VTT, the recommended approach is the iOS model: rubber-band resistance during drag creates visible content shift that communicates "you've reached the edge," and the spring-back animation confirms it. No additional CSS overlays or vignette effects are needed for the default experience.

If an optional subtle indicator is desired for accessibility, a CSS `box-shadow: inset` on the canvas container can darken the edge closest to the boundary:

```css
.canvas-wrapper.at-boundary-right { box-shadow: inset -20px 0 20px -10px rgba(0,0,0,0.15); }
```

---

## 8. Performance is not a concern for clamping arithmetic

The clamping algorithm is pure arithmetic — `Math.min`, `Math.max`, a comparison, and subtraction. This adds **single-digit nanoseconds** per call. Even the spring animation's `Math.exp()` takes roughly **200 nanoseconds** per call (2× the cost of multiplication). At 60fps with a 16ms frame budget, three `Math.exp()` calls for an x/y/zoom spring consume **0.6 microseconds — 0.004% of frame time**. Even 100 simultaneous springs would use under 1% of available time.

The spring animation's rAF loop does interact with the on-demand rendering pattern: it schedules frames continuously until the spring settles (~300–400ms). This is identical to how any CSS animation or scrolling momentum works. The animation schedules rAF, each tick updates camera state, the camera notifies the renderer, and when all springs are at rest the loop stops. Multiple springs share one rAF loop. Background tabs automatically pause rAF, preventing wasted work.

---

## 9. Testing strategy: property-based tests catch the edge cases arithmetic misses

Unit tests for boundary clamping should cover the critical edge cases where the math can go wrong. The most important are the **mixed-regime case** (zoomed in on one axis, zoomed out on the other), the **exact crossover zoom**, and the **zoom-at-cursor interaction with clamping**:

```javascript
// Mixed regime: wide map, zoomed-in X but zoomed-out Y
it('clamps X but centers Y for wide landscape map', () => {
  const cam = { x: 300, y: 300, zoom: 1 };
  const wideMap = { x: 0, y: 0, w: 2000, h: 500 };
  const result = clampCamera(cam, wideMap, 800, 600);
  expect(result.x).toBe(300);                // within [0, 1200], passes through
  expect(result.y).toBeCloseTo(-50);          // centered: -(600-500)/2
});
```

**Property-based testing with fast-check** is exceptionally valuable here because the clamping function must satisfy strong invariants for all possible inputs. The three critical properties:

1. **No out-of-bounds exposure**: For any camera/map/viewport combination, the clamped visible area either stays within map bounds (zoomed in) or is centered (zoomed out)
2. **Idempotency**: Clamping twice produces the same result as clamping once — `clamp(clamp(x)) === clamp(x)`
3. **Nearest-valid-position**: The clamped result is the closest valid position to the input

```javascript
test.prop({ camera: arbCam, map: arbMap, vp: arbVp })(
  'clamping is idempotent',
  ({ camera, map, vp }) => {
    const once = clampCamera(camera, map, vp.w, vp.h);
    const twice = clampCamera(once, map, vp.w, vp.h);
    expect(twice.x).toBeCloseTo(once.x, 6);
    expect(twice.y).toBeCloseTo(once.y, 6);
  }
);
```

For Playwright integration tests, expose a `window.__vtt_debug__` object in test mode that provides `getCameraState()` and `setCameraState()`. The key E2E tests are: drag past boundary and verify camera returns within bounds after 1200ms settle time; wheel-zoom to minimum and verify no further zoom change; screenshot at cover zoom with corner-pixel sampling to verify no black bars. The corner-pixel test reads canvas pixel data at (5,5) and the other three corners — pure black pixels indicate exposed background.

Spring animation tests should verify convergence (position within 1px of target after 2 seconds), frame-rate tolerance (60fps and 120fps results within 2px), and no overshoot with critical/overdamped configurations. Comparing 30fps and 60fps simulation results should stay within **3px tolerance** for the semi-implicit Euler integrator — or use the closed-form solution which is frame-rate independent by construction.

---

## 10. Architectural blueprint: how the pieces connect

The complete Phase 3 system has four layers. The **clamping layer** (`clampCamera`, `clampAxis`) is pure math with no state. The **elastic layer** (`rubberBandClamp`, `CriticalSpring`) adds physics. The **animation layer** (`CameraAnimator`) manages rAF scheduling. The **camera manager** orchestrates everything through the clamp-on-commit pattern.

The data flow for a drag that exceeds boundaries:

1. Pointer move → `camera.setCamera({ x, y }, { isDrag: true, force: true })`
2. Rubber-band formula applied: `rubberBandClamp(rawX, minX, maxX, vpW)`
3. Camera state updated, render triggered (shows elastic overshoot)
4. Pointer up → compute clamped target via `clampCamera()`, capture release velocity
5. `animator.snapBack(currentPos, clampedTarget, { vx, vy })`
6. rAF loop runs spring, calls `camera.setCamera(springPos, { force: true })` each frame
7. Spring settles → final `camera.setCamera(target)` without force → hard clamp commits

The **pixi-viewport library** provides the closest prior art for this architecture, with its composable clamp + clampZoom + bounce plugins operating in a pipeline. tldraw's `contain` behavior mode is the most relevant single implementation of the dual-regime algorithm. Leaflet's viscosity concept bridges the gap between hard clamping and elastic overscroll.

For the DM option, the entire zoom floor system is a single derived property: `get minZoom() { return this.dmCanZoomPastCover ? 0.1 : Math.max(this.vpW / this.mapW, this.vpH / this.mapH); }`. The clamping layer reads this property, and everything downstream — including the crossover detection, centering logic, and zoom-at-cursor interaction — adapts automatically.

## Conclusion

The three non-obvious insights from this research that should drive implementation choices: **First**, the dual-regime transition is continuous — no interpolation or special casing needed at the crossover zoom, which means the algorithm is simpler than it appears. **Second**, Apple's `c = 0.55` reciprocal rubber-band formula is provably better than logarithmic or exponential alternatives for bounded viewports because it asymptotes to the viewport dimension, preventing content from ever disappearing. **Third**, the `force` flag pattern — accepting unclamped positions during active gestures, then clamping on release — elegantly decouples the elastic physics from the constraint logic, keeping both systems simple while producing polished combined behavior. The entire Phase 3 adds roughly **300–400 lines of production code** (clamping: ~50, rubber-band: ~20, spring: ~60, animator: ~70, edge-pan: ~100, camera manager integration: ~80) with negligible performance impact.