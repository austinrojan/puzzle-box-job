# VTT camera Phase 2: the complete input handling guide

**Every interaction a user has with a 2D canvas — scroll-zooming, trackpad pinching, arrow-key panning, flick-to-glide — passes through a gauntlet of browser quirks, platform differences, and frame-timing constraints before it moves a single pixel.** This report covers all 12 input handling subsystems needed to build a production-quality Virtual Tabletop camera in vanilla JavaScript on HTML5 Canvas, building on a Phase 1 foundation of `Camera = { x, y, zoom }` with basic zoom-at-cursor, wheel handling, and mouse drag panning. Each section provides mathematical foundations, cross-browser specifics, code implementations, and references to how tldraw, Excalidraw, Leaflet, Mapbox GL JS, Fabric.js, and Konva.js solve these problems in production.

---

## 1. Why logarithmic zoom interpolation replaces fixed multiplicative steps

Linear zoom interpolation (`zoom += constant`) feels perceptually uneven because zoom is a **multiplicative quantity**. Zooming from 1× to 2× doubles the visible area; zooming from 2× to 4× also doubles it, but the absolute change differs. Human perception responds to ratios, not absolute differences (Weber–Fechner law). A fixed additive step of 0.5 at zoom level 1.0 is a 50% change; the same step at zoom level 10.0 is only 5%.

The solution is **logarithmic interpolation** (`logerp`), which performs linear interpolation in log-space:

```javascript
function logerp(a, b, t) {
  return a * Math.pow(b / a, t);
}
```

**Derivation**: Convert endpoints to log-space (`logA = Math.log(a)`, `logB = Math.log(b)`), lerp in that space (`logResult = logA + (logB - logA) * t`), then exponentiate back. This simplifies algebraically to `a^(1-t) * b^t = a * (b/a)^t`. At `t=0.5`, the result is the **geometric mean** `√(a·b)`, not the arithmetic mean — this is perceptually correct for zoom.

For wheel-driven zoom, the production pattern used by the AntV infinite canvas tutorial and confirmed by Mozilla's implementation is:

```javascript
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  // Each deltaY unit adds a constant in log-space
  camera.zoom *= Math.pow(2, e.deltaY * -0.01);
  camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom));
}, { passive: false });
```

The constant **`-0.01`** scales sensitivity: with Chrome's typical `deltaY ≈ 100` per scroll notch, one notch yields `Math.pow(2, -1) = 0.5`, halving the zoom. The negation inverts direction (scroll up = zoom in). The multiplication (`*=`) ensures each scroll step produces a constant perceptual change regardless of current zoom level, because `log(zoom * 2^k) = log(zoom) + k·log(2)` — a **constant additive offset in log-space**.

**Zoom clamping in log-space** prevents abrupt boundary behavior:

```javascript
function clampZoom(zoom, minZoom, maxZoom) {
  const logZoom = Math.log2(zoom);
  const logMin = Math.log2(minZoom);
  const logMax = Math.log2(maxZoom);
  return Math.pow(2, Math.max(logMin, Math.min(logMax, logZoom)));
}
```

**How major projects handle this**: tldraw uses `zoom = camera.z - dz * camera.z` (multiplicative adjustment) with discrete zoom steps `[0.1, 0.25, 0.5, 1, 2, 4, 8]`. Mapbox GL JS's PR #15281 confirmed that "linear interpolation over zoom looks more natural" — meaning interpolation in the zoom exponent, not the scale factor. Leaflet's zoom system is inherently logarithmic: each integer zoom level doubles tile dimensions (`world = 256·2^zoom` pixels wide).

---

## 2. Cross-browser wheel event normalization demands careful handling

Browsers report wheel events with dramatically different values. The core variable is `deltaMode`:

| Browser/Input | deltaMode | Typical deltaY per notch |
|---|---|---|
| Chrome (mouse wheel) | `DOM_DELTA_PIXEL (0)` | ±100 to ±120+ (premultiplied) |
| Firefox (mouse wheel) | `DOM_DELTA_LINE (1)` | ±1 to ±3 (line units) |
| Safari (mouse wheel) | `DOM_DELTA_PIXEL (0)` | ±100+ (premultiplied) |
| All browsers (trackpad scroll) | `DOM_DELTA_PIXEL (0)` | ±0.1 to ±20 (fine-grained) |
| All browsers (trackpad pinch) | `DOM_DELTA_PIXEL (0)` | ±0.2 to ±5 (with `ctrlKey: true`) |
| Firefox (page scroll mode) | `DOM_DELTA_PAGE (2)` | ±1 (page units) |

**The `ctrlKey` pinch convention**: Chrome (since M35), Firefox (since v55), and Edge synthesize `wheel` events with `ctrlKey: true` for trackpad pinch-to-zoom. Safari 15+ does this too, but also provides proprietary `GestureEvent` with `gesturestart`/`gesturechange`/`gestureend` and a cumulative `scale` property.

The **Facebook normalize-wheel** library (476K weekly npm downloads) established the standard constants: `LINE_HEIGHT = 40` pixels per line, `PAGE_HEIGHT = 800` pixels per page. Here is a complete normalization function synthesizing approaches from tldraw, Leaflet, and Mapbox GL JS:

```javascript
const LINE_HEIGHT = 40;
const PAGE_HEIGHT = 800;
const MAX_ZOOM_STEP = 10; // tldraw's clamp

function normalizeWheel(e) {
  let dx = e.deltaX || 0;
  let dy = e.deltaY || 0;
  let dz = 0; // zoom delta

  // 1. Convert deltaMode to pixels
  if (e.deltaMode === 1) {         // DOM_DELTA_LINE (Firefox mouse)
    dx *= LINE_HEIGHT;
    dy *= LINE_HEIGHT;
  } else if (e.deltaMode === 2) {  // DOM_DELTA_PAGE (rare)
    dx *= PAGE_HEIGHT;
    dy *= PAGE_HEIGHT;
  }

  // 2. Shift+scroll → horizontal (Windows/Linux convention)
  if (dx === 0 && e.shiftKey) { dx = dy; dy = 0; }

  // 3. Detect pinch-to-zoom (ctrlKey synthesized by browser)
  if (e.ctrlKey || e.metaKey) {
    dz = (Math.abs(dy) > MAX_ZOOM_STEP
      ? MAX_ZOOM_STEP * Math.sign(dy) : dy) / 100;
    dx = 0; dy = 0;
  }

  return { dx, dy, dz };
}
```

**Mapbox GL JS adds device detection heuristics**: if `deltaY !== 0 && (deltaY % 4.000244140625) === 0`, it's a mouse wheel (120-based); if `Math.abs(deltaY) < 4`, it's a trackpad. This distinction drives different zoom rates. Leaflet's `getWheelPxFactor()` applies platform-specific divisors: **3× on macOS**, **1× on Linux Chrome**, **2× elsewhere**.

---

## 3. Preventing browser zoom across all input vectors

A canvas app must intercept browser zoom from every vector. Here is the complete prevention strategy:

```javascript
// 1. Ctrl+scroll and trackpad pinch (same mechanism)
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) e.preventDefault();
}, { passive: false }); // CRITICAL: Chrome defaults to passive on document

// 2. Ctrl+Plus/Minus/Zero keyboard zoom
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) &&
      ['+', '-', '=', '0'].includes(e.key)) {
    e.preventDefault();
  }
});

// 3. Safari gesture events
document.addEventListener('gesturestart', (e) => e.preventDefault(),
  { passive: false });
document.addEventListener('gesturechange', (e) => e.preventDefault(),
  { passive: false });
```

```css
/* 4. Disable all browser touch behaviors on the canvas */
.canvas-container { touch-action: none; }
```

**The `passive: false` requirement** is non-negotiable. Chrome 56+ made `wheel` and `touchstart`/`touchmove` listeners passive by default on `document` and `window`. A passive listener **cannot** call `preventDefault()` — Chrome silently ignores it and logs a console warning.

**What cannot be prevented**: browser menu zoom (View → Zoom In fires no JS event), browser toolbar zoom controls, OS-level accessibility zoom, and user extensions that force zoom. The `<meta name="viewport" content="user-scalable=no">` tag works on mobile but **desktop browsers ignore it entirely**, and modern mobile browsers increasingly override it for accessibility compliance.

---

## 4. requestAnimationFrame batching separates input from rendering

Multiple input events fire between animation frames — **2–4+ mousemoves per 16.67ms frame**, more during fast scrolling. The fundamental rule: **event handlers store state; the rAF callback processes and renders.**

The critical distinction is **accumulate vs. latest-value**:
- **Accumulate deltas**: wheel `deltaY`, keyboard movement — these are additive; dropping intermediates loses intended input
- **Use latest value**: mouse position during pan — only the final position matters

```javascript
class RenderLoop {
  constructor(canvas) {
    this.dirty = false;
    this.pendingWheelDelta = 0;         // accumulated
    this.pendingMousePos = { x: 0, y: 0 }; // latest value
    this.lastTimestamp = 0;

    canvas.addEventListener('mousemove', (e) => {
      this.pendingMousePos = { x: e.clientX, y: e.clientY };
      this.dirty = true;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.pendingWheelDelta += e.deltaY; // sum all between frames
      this.dirty = true;
    }, { passive: false });
  }

  tick(timestamp) {
    requestAnimationFrame((t) => this.tick(t));
    if (!this.dirty) return; // skip frame if nothing changed

    const dt = Math.min((timestamp - this.lastTimestamp) / 1000, 0.1);
    this.lastTimestamp = timestamp;

    // Process accumulated wheel delta
    if (this.pendingWheelDelta !== 0) {
      camera.zoom *= Math.pow(2, this.pendingWheelDelta * -0.01);
      this.pendingWheelDelta = 0; // reset accumulator
    }

    this.render();
    this.dirty = false;
  }
}
```

**Two rendering patterns**: Game engines use **continuous loops** (always call rAF, early-exit when clean). Design tools like Figma use **on-demand rendering** (only schedule rAF when dirty, via a `scheduleRender()` guard function). On-demand uses zero CPU when idle but risks missed renders if `scheduleRender()` is forgotten.

**DeltaTime capping** is essential: when a tab is backgrounded, browsers pause rAF. The first `dt` on return could be seconds. **Cap at 100ms** (`0.1` seconds) to prevent teleporting. The rAF callback's `timestamp` parameter is the same time base as `performance.now()` — use it directly rather than calling `performance.now()` separately.

---

## 5. Trackpad gestures require three separate code paths

Trackpad input arrives through three mechanisms depending on browser:

**Chrome/Firefox/Edge**: Two-finger scroll fires `wheel` events with `ctrlKey: false` and pixel-based `deltaX`/`deltaY`. Pinch-to-zoom fires `wheel` events with `ctrlKey: true` and small `deltaY` values (±0.2 to ±5).

**Safari**: Provides proprietary `GestureEvent` with a cumulative `scale` property (1.0 = no change, >1 = zoom in, <1 = zoom out). Since Safari 15, also fires `wheel` events with `ctrlKey` for pinch.

**Detection pattern**: `if (window.GestureEvent !== undefined && window.TouchEvent === undefined)` identifies desktop Safari.

**Safari GestureEvent critical gotcha**: The `scale` property is **cumulative since gesturestart**, not incremental. Never multiply current zoom by `event.scale` each frame — this causes exponential growth. Instead, cache the zoom at gesture start and multiply once:

```javascript
let gestureStartZoom = 1;

element.addEventListener('gesturestart', (e) => {
  e.preventDefault();
  gestureStartZoom = camera.zoom;
}, { passive: false });

element.addEventListener('gesturechange', (e) => {
  e.preventDefault();
  camera.zoom = gestureStartZoom * e.scale; // cumulative, not incremental
}, { passive: false });
```

**macOS momentum scrolling** continues firing `wheel` events after fingers lift with decaying delta values. No standard API exists to distinguish momentum from active scrolling (W3C has an open proposal `isInertialScrolling` in uievents#58, but no browser implements it). The **best workaround** is a timeout heuristic — consider the gesture ended after **200ms** of silence — or use the **lethargy-ts** library which detects momentum by tracking delta decay patterns.

---

## 6. Touch events should use PointerEvent, not the deprecated Touch API

PointerEvent unifies mouse, touch, and pen into a single API with **stable `pointerId`** per finger (vs. TouchEvent's cumbersome `touches`/`changedTouches` arrays), **`setPointerCapture()`** for reliable gesture tracking, and device-specific properties (`pressure`, `tiltX`, `pointerType`).

**`touch-action: none` CSS is mandatory** on the canvas element. Without it, the browser intercepts touch gestures for default scrolling/zooming and fires `pointercancel`, killing custom gesture handling.

The pinch-to-zoom formula: **`scaleDelta = newDistance / oldDistance`** where distance is `Math.hypot(p2.x - p1.x, p2.y - p1.y)` between the two pointers. The zoom origin is the midpoint of the two pointers.

```javascript
class PinchZoomHandler {
  constructor(element) {
    this.pointers = new Map();
    this.prevDist = 0;
    this.prevCenter = null;
    element.style.touchAction = 'none';

    element.addEventListener('pointerdown', (e) => {
      element.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [p1, p2] = [...this.pointers.values()];
        this.prevDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        this.prevCenter = {
          x: (p1.x + p2.x) / 2,
          y: (p1.y + p2.y) / 2
        };
      }
    });

    element.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [p1, p2] = [...this.pointers.values()];
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const center = {
          x: (p1.x + p2.x) / 2,
          y: (p1.y + p2.y) / 2
        };
        const scaleDelta = dist / this.prevDist;
        // Apply zoom at center point, plus pan delta
        this.prevDist = dist;
        this.prevCenter = center;
      }
    });

    const cleanup = (e) => {
      this.pointers.delete(e.pointerId);
      element.releasePointerCapture(e.pointerId);
    };
    element.addEventListener('pointerup', cleanup);
    element.addEventListener('pointercancel', cleanup);
  }
}
```

**Finger transition handling**: when one finger lifts during a pinch (2→1 pointer), transition to a single-finger pan by resetting `prevCenter` to the remaining pointer's position. `getCoalescedEvents()` (Chrome 58+, Firefox 59+, Safari 18.4+) recovers intermediate points the browser coalesced — essential for drawing apps, but unnecessary for camera pan/zoom where only the final or accumulated value matters.

---

## 7. Keyboard shortcuts follow strong industry conventions

All major design tools converge on these conventions:

| Action | Figma | Photoshop | tldraw | Excalidraw | Google Maps |
|---|---|---|---|---|---|
| Zoom In | Ctrl/⌘ + `+` | Ctrl/⌘ + `+` | Ctrl/⌘ + `+` | Ctrl/⌘ + `+` | `+` |
| Zoom Out | Ctrl/⌘ + `-` | Ctrl/⌘ + `-` | Ctrl/⌘ + `-` | Ctrl/⌘ + `-` | `-` |
| 100% | Shift + `0` | Ctrl/⌘ + `1` | Shift + `0` | Ctrl/⌘ + `0` | — |
| Fit to view | Shift + `1` | Ctrl/⌘ + `0` | Shift + `1` | Shift + `1` | — |
| Pan | Arrow keys / Space+drag | Space+drag | Arrow keys / Space+drag | Space+drag | Arrow keys |

**Smooth continuous panning** requires a **key state map + rAF loop**, not relying on the OS keydown repeat. The OS repeat has a ~300ms initial delay and fires at ~30Hz — unsynchronized with the frame rate and unable to handle simultaneous keys (diagonal movement):

```javascript
const keys = {};
document.addEventListener('keydown', (e) => { keys[e.key] = true; });
document.addEventListener('keyup', (e) => { keys[e.key] = false; });
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false; // prevent stuck keys
});

function update(dt) {
  const PAN_SPEED = 500; // px/sec
  if (keys['ArrowLeft'])  camera.x -= PAN_SPEED * dt;
  if (keys['ArrowRight']) camera.x += PAN_SPEED * dt;
  if (keys['ArrowUp'])    camera.y -= PAN_SPEED * dt;
  if (keys['ArrowDown'])  camera.y += PAN_SPEED * dt;
}
```

**Platform-aware modifier detection** uses a fallback chain: `navigator.userAgentData?.platform === 'macOS'` (modern Chrome/Edge), then `navigator.platform` (deprecated but reliable), then `navigator.userAgent`. On Mac, `event.metaKey` is Cmd; on Windows/Linux, `event.ctrlKey` is Ctrl. Always detect the platform once and abstract via an `isModKey(event)` helper.

**Focus management**: skip shortcuts when `event.target` is `INPUT`, `TEXTAREA`, `SELECT`, or `contentEditable`. Clear all key states on `window.blur` and `visibilitychange` to prevent stuck keys after alt-tabbing.

For **arrow key acceleration**, track hold duration per key and ramp speed linearly from a base (200 px/s) to maximum (1500 px/s) over ~1 second:

```javascript
const speed = Math.min(
  BASE_SPEED + ACCELERATION * holdDuration,
  MAX_SPEED
);
```

Figma also scales pan distance by `1 / camera.zoom` so panning covers more world-space when zoomed out — a subtle but important UX detail.

---

## 8. Inertial panning uses exponential decay matched to iOS physics

**Exponential decay** (`velocity *= damping` per frame) is the gold standard for momentum panning. Position follows `target + amplitude * e^(-elapsed / timeConstant)`. This feels natural because deceleration is proportional to current velocity — fast flicks slow quickly at first then glide; slow flicks stop gently. **iOS uses a time constant of 325ms** (matching `UIScrollViewDecelerationRateNormal`).

**Velocity calculation from drag history**: Mapbox GL JS maintains a **ring buffer of the last 160ms** of movement data. Older entries are drained continuously. On release, velocity = `(newest.position - oldest.position) / elapsed`. This naturally handles the "pause before release" problem — if the user pauses at the end of a drag, the buffer empties and no inertia is applied. Ariya Hidayat's approach adds a **0.8/0.2 moving average filter** (`v = 0.8 * currentV + 0.2 * prevV`) to smooth out noisy input.

**Frame-rate independent deceleration** is critical:

```javascript
velocity *= Math.pow(damping, deltaTime * 60);
```

The naive `velocity *= 0.95` applies damping once per frame. At 60fps, this compounds to `0.95^60 ≈ 0.046` per second; at 144fps, `0.95^144 ≈ 0.0006` — a **76× difference**. The fix: if damping is calibrated for 60fps, raise it to the power of `dt * 60` to normalize across frame rates. After 1 second, velocity is multiplied by `0.95^60` regardless of how many frames occurred.

**Production damping values**: Leaflet uses `inertiaDeceleration: 3400` px/s² with `easeLinearity: 0.2`. Mapbox GL JS uses `linearity: 0.3`, `maxSpeed: 1400` px/s, `deceleration: 2500`. A damping factor of **0.95 per frame at 60fps** (equivalent to `timeConstant ≈ 325ms`) provides an iOS-like feel. Lower values (0.90) feel "heavier"; higher (0.97) feel ice-like.

**Stopping threshold**: **0.5 px/s** is typical. Below this, snap to the final position and cancel the rAF loop. **Interruption**: any new `pointerdown` must immediately cancel momentum (`cancelAnimationFrame(rafId)`, zero out velocity). New input always wins.

---

## 9. Edge-pan acceleration activates only during drag operations

Edge-panning auto-scrolls the viewport when the cursor approaches the edge during drag operations (dragging objects, selecting regions, connecting nodes). It is **not** active during normal mouse movement or camera panning.

**Three parameters define the behavior**: a **dead zone** (50–200px from the viewport edge before activation starts), an **acceleration curve** (typically quadratic for smooth ramping), and a **maximum speed** (800 px/s is a good default). The formula:

```javascript
const distIntoEdge = edgeSize - distanceFromBoundary;
const intensity = Math.pow(distIntoEdge / edgeSize, 2); // quadratic ramp
const scrollSpeed = maxSpeed * intensity;
```

**The rAF loop must continue scrolling even if the mouse is stationary** — the cursor may be held still at the edge while the viewport pans. Activate the loop on `dragstart`, update mouse position on `pointermove`, deactivate on `dragend`. Konva.js implements this with `setInterval` at 60Hz; a `requestAnimationFrame` loop with `deltaTime` is more precise. Corner cases (cursor in a viewport corner) naturally produce diagonal pan because both axes calculate independently.

---

## 10. Debouncing vs. throttling vs. rAF batching for different input types

| Input | Technique | Rationale |
|---|---|---|
| Wheel (zoom) | rAF batching (accumulate deltas) | Don't debounce — would delay zoom. Sum all deltas between frames. |
| Mousemove (pan) | rAF batching (latest value) | Only final position matters per frame. |
| Window resize | Debounce (150–250ms) | Wait for user to finish resizing. |
| Keyboard hold | rAF loop with key state map | Process per frame, not per OS repeat event. |
| Touch drawing | `getCoalescedEvents()` | Recover all intermediate points for smooth curves. |

**rAF-based throttle** replaces manual throttle for all canvas visual updates:

```javascript
function rafThrottle(fn) {
  let rafId = null, lastArgs = null;
  return function(...args) {
    lastArgs = args;
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      fn.apply(this, lastArgs);
    });
  };
}
```

This is effectively `throttle(fn, 16ms)` but synchronized with the browser's actual paint cycle. **Leading-edge + trailing-edge throttle** is best for perceived responsiveness when rAF isn't applicable (fires immediately on first event, then at interval, plus a final invocation to capture the last state).

---

## 11. Performance pitfalls in input-heavy canvas applications

**`getBoundingClientRect()` triggers synchronous layout reflow** if the DOM layout is dirty. Calling it on every mouse event is expensive. **Cache it** and invalidate via `ResizeObserver` and `window.resize`/`scroll`:

```javascript
class BoundsCache {
  constructor(element) {
    this._rect = null;
    this._valid = false;
    new ResizeObserver(() => { this._valid = false; }).observe(element);
    window.addEventListener('resize', () => { this._valid = false; });
    this.element = element;
  }
  getRect() {
    if (!this._valid) {
      this._rect = this.element.getBoundingClientRect();
      this._valid = true;
    }
    return this._rect;
  }
}
```

TanStack Virtual documented that polling `getBoundingClientRect()` every rAF frame caused **up to 45% idle CPU** in Safari. Replacing with `ResizeObserver` eliminated it.

**Properties that trigger layout reflow** (from Paul Irish's comprehensive list with 8,300+ GitHub stars): `offsetLeft/Top/Width/Height`, `clientLeft/Top/Width/Height`, `getClientRects()`, `getBoundingClientRect()`, `scrollWidth/Height/Left/Top`, `getComputedStyle()`, `elem.focus()`, and `mouseEvent.layerX/offsetX`. **Avoid reading any of these after writing styles** in the same frame.

**CSS transforms for camera offset** can bypass the main thread entirely. The browser compositor thread handles `transform`, `opacity`, and `filter` independently. Applying `canvas.style.transform = \`translate(${x}px, ${y}px) scale(${zoom})\`` lets the compositor handle camera panning smoothly even while the main thread is busy redrawing canvas content. However, this introduces coordinate system complexity when converting between screen and world space.

**`will-change: transform`** promotes an element to its own compositor layer. Canvas elements typically already get their own layer, making this redundant — and overuse consumes GPU memory proportional to element dimensions. Use sparingly and remove when not needed.

**`requestIdleCallback`** schedules non-critical work (updating spatial indexes, serializing undo history, computing thumbnails) during browser idle periods. Set a `timeout` option to ensure eventual execution. Supported in all modern browsers including Safari.

---

## 12. Smooth animated zoom transitions use logerp, not lerp

Linear interpolation between zoom levels looks wrong because the perceptual midpoint between 1× and 4× is 2× (geometric mean), not 2.5× (arithmetic mean). Animated zoom must use **logarithmic interpolation with easing applied to the time parameter**:

```javascript
function animateZoomAtPoint(camera, screenPoint, targetZoom, duration = 300) {
  const startZoom = camera.zoom;
  const startTime = performance.now();
  // Compute world point to keep fixed
  const worldX = screenPoint.x / startZoom - camera.x;
  const worldY = screenPoint.y / startZoom - camera.y;
  const startX = camera.x, startY = camera.y;

  function frame(now) {
    const rawT = Math.min((now - startTime) / duration, 1);
    const t = 1 - Math.pow(1 - rawT, 3); // easeOutCubic

    // Zoom in log-space
    const z = startZoom * Math.pow(targetZoom / startZoom, t);
    // Maintain zoom-at-point invariant
    camera.x = screenPoint.x / z - worldX;
    camera.y = screenPoint.y / z - worldY;
    camera.zoom = z;

    render();
    if (rawT < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
```

**Best easing functions**: `easeOutCubic` (`1 - (1-t)^3`) for button-triggered zoom presets (immediate response, smooth settle). `easeInOutCubic` for longer animated transitions. The easing is applied to `t` **before** passing to `logerp`, not directly to the zoom value.

**Leaflet's `flyTo`** implements the van Wijk & Nuij (2003) "Smooth and Efficient Zooming and Panning" algorithm using hyperbolic functions (sinh, cosh, tanh) to compute the optimal zoom-out-fly-zoom-in path. The `rho = 1.42` parameter controls curvature; duration auto-scales with path length. Mapbox GL JS implements the same paper. This is the gold standard for long-distance animated camera transitions in mapping applications.

tldraw's animation system uses tick-based updates with configurable easing (`EASINGS.easeOutCubic`), a duration parameter, and respects a user `animationSpeed` preference (0 = skip animation, jump to final state). Zoom preset steps follow the array `[0.1, 0.25, 0.5, 1, 2, 4, 8]`, with "zoom in" snapping to the next step above current and "zoom out" to the next below.

---

## Conclusion: architecture emerges from composing these systems

The 12 input subsystems described here compose into a layered architecture. At the base, **wheel normalization** and **browser zoom prevention** form the platform abstraction layer. Above that, **rAF batching** creates the frame-synchronized update loop that all other systems feed into. The **trackpad**, **touch**, and **keyboard** handlers are parallel input channels that write to shared pending state (accumulated deltas and latest values). **Momentum panning** and **edge-pan** are autonomous animation systems that inject camera updates into the same rAF loop. **Logarithmic zoom interpolation** and **smooth animated transitions** share the same `logerp` math, whether driven by wheel events or preset buttons.

Three insights emerge that aren't obvious from studying individual components. First, **rAF batching effectively replaces throttling** for all visual updates — manual throttle is only needed for non-rendering side effects. Second, **the `ctrlKey` pinch convention** is the single most important cross-browser normalization detail — it's the bridge that makes trackpad pinch, Ctrl+scroll, and touch pinch converge to the same code path. Third, **frame-rate independence via `Math.pow(damping, dt * 60)`** isn't optional — without it, momentum panning feels completely different on 60Hz vs. 144Hz displays, and this is the class of bug that's invisible during development on a single machine.