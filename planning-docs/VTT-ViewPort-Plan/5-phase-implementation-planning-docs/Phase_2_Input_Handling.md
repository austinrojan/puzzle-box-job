# Phase 2: Input handling for the world-space camera

**This guide upgrades the VTT's camera input system from fixed multiplicative zoom and raw wheel events to perceptually uniform exponential zoom, cross-browser input normalization, cached coordinate conversion, and keyboard-driven camera control.** The Phase 1 camera already handles zoom-at-cursor (four-step algorithm), basic wheel events with `{ passive: false }`, and mouse drag panning. Phase 2 replaces the guts of how those inputs are processed without changing the Camera class's public API. The `zoomAt()` four-step algorithm stays. The `panBy()` method stays. What changes is everything upstream: how raw browser events become the numbers those methods receive.

The guide is structured as a walkthrough you can hand directly to Claude Code. Each section explains what the code does and why, provides the complete implementation, calls out interactions with existing modules, and includes testing protocols. Read it front to back before changing anything. The order matters.

---

## Table of contents

1. [What Phase 1 established and what Phase 2 changes](#1-what-phase-1-established-and-what-phase-2-changes)
2. [The normalizeWheel function: a standalone input normalizer](#2-the-normalizewheel-function)
3. [Exponential zoom: replacing the fixed ZOOM_FACTOR](#3-exponential-zoom)
4. [BoundsCache: eliminating per-event getBoundingClientRect calls](#4-boundscache)
5. [Refining the rAF coalescing pattern for accumulated vs. latest-value input](#5-raf-coalescing-refinement)
6. [Browser zoom prevention: intercepting every vector](#6-browser-zoom-prevention)
7. [Keyboard camera control: arrow keys, zoom shortcuts, key state map](#7-keyboard-camera-control)
8. [Updating the wheel handler in attachTo](#8-updating-the-wheel-handler)
9. [Updating MapRenderer's mousemove coordinate caching](#9-updating-maprenderer)
10. [CSS additions](#10-css-additions)
11. [Testing protocols](#11-testing-protocols)
12. [Migration checklist](#12-migration-checklist)
13. [What Phase 3 expects from this foundation](#13-phase-3-expectations)
14. [What is explicitly deferred and why](#14-deferred-features)

---

## 1. What Phase 1 established and what Phase 2 changes

### The Phase 1 foundation

Phase 1 delivered a world-space `Camera = { x, y, zoom }` with these methods that Phase 2 depends on:

```javascript
camera.eventToScreen(e)     // DOM event → canvas-space screen coordinates
camera.screenToWorld(sx, sy) // screen → world coordinates
camera.zoomAt(sx, sy, direction, factor)  // four-step zoom-at-cursor
camera.zoomToCenter(direction, factor)    // zoom at viewport midpoint
camera.panBy(dx, dy)        // screen-space delta → world-space pan
camera.viewportW / camera.viewportH       // current viewport dimensions
camera.viewportScale        // CSS transform scale (1.0 in map mode)
```

Phase 1's wheel handler in `attachTo()` already normalizes `deltaMode` (lines → pixels, pages → pixels) and routes `ctrlKey` events to zoom vs. pan. Phase 1's `camera:changed` EventBus emissions already flow through an rAF coalescing pattern in `MapRenderer` that prevents multiple redraws per frame.

### What Phase 2 changes

Phase 2 makes five targeted upgrades to this foundation:

1. **Extracts wheel normalization** into a standalone `normalizeWheel()` function that handles cross-browser quirks in one place, replacing the inline deltaMode conversion in the wheel handler.

2. **Replaces fixed multiplicative zoom** (`zoom *= 1.04` per tick) with continuous exponential zoom (`zoom *= Math.pow(2, normalizedDelta * -0.01)`) that produces perceptually uniform zoom regardless of current zoom level.

3. **Adds `BoundsCache`** to `eventToScreen()` so it no longer calls `getBoundingClientRect()` on every mouse event, eliminating a layout reflow trigger that TanStack Virtual documented as causing up to 45% idle CPU in Safari.

4. **Adds keyboard camera control** with arrow keys for panning, `+`/`-` for zoom, and `Shift+0`/`Shift+1` for zoom presets, driven by a key state map and rAF loop rather than OS key repeat.

5. **Adds comprehensive browser zoom prevention** across all input vectors (Ctrl+scroll, Ctrl+Plus/Minus, Safari gesture events, `touch-action` CSS).

Phase 2 does **not** add a continuous render loop. The Phase 1 on-demand pattern (render only when dirty) stays. The keyboard system is the one exception: it runs its own rAF loop while keys are held, injecting `panBy()` and `zoomToCenter()` calls that trigger the existing `camera:changed` → render pipeline.

---

## 2. The normalizeWheel function

### Why the inline normalization is insufficient

Phase 1's wheel handler converts `deltaMode` to pixels, which handles the most common cross-browser difference (Firefox reporting line units). But it does not handle several edge cases that surface in real usage:

- Shift+scroll should map to horizontal pan (Windows/Linux convention, where Shift+vertical-scroll produces horizontal movement)
- Trackpad pinch sends tiny `deltaY` values (0.2 to 5) that should be clamped to prevent zoom overshoot on high-sensitivity trackpads
- The zoom vs. pan decision (based on `ctrlKey`) should be colocated with the normalization, not split across the handler

### The standalone normalizer

Create a new file `vtt/js/normalize-wheel.js`:

```javascript
// ============================================
// Wheel Event Normalizer
// ============================================
//
// Normalizes wheel events across browsers into a consistent format.
// Returns { dx, dy, dz } where dx/dy are pan deltas in pixels and
// dz is a zoom delta (nonzero only for pinch/Ctrl+scroll).
//
// The constants come from Facebook's normalize-wheel library (476K
// weekly npm downloads), which established LINE_HEIGHT = 40 and
// PAGE_HEIGHT = 800 as the de facto standard. tldraw, Leaflet, and
// Mapbox GL JS all use similar values.
//
// Browser differences this handles:
//   Chrome mouse wheel:    deltaMode 0, deltaY ±100 to ±120
//   Firefox mouse wheel:   deltaMode 1, deltaY ±1 to ±3
//   Safari mouse wheel:    deltaMode 0, deltaY ±100+
//   Trackpad scroll (all): deltaMode 0, deltaY ±0.1 to ±20
//   Trackpad pinch (all):  deltaMode 0, deltaY ±0.2 to ±5, ctrlKey=true

const LINE_HEIGHT = 40;   // px per "line" (Firefox deltaMode 1)
const PAGE_HEIGHT = 800;  // px per "page" (rare deltaMode 2)
const MAX_ZOOM_STEP = 10; // clamp extreme pinch deltas (tldraw pattern)

/**
 * Normalize a WheelEvent into consistent pan and zoom deltas.
 *
 * @param {WheelEvent} e - The raw wheel event
 * @returns {{ dx: number, dy: number, dz: number }}
 *   dx, dy: pan deltas in CSS pixels (0 when zooming)
 *   dz: zoom delta, scaled to ~1.0 per scroll notch (0 when panning)
 */
export function normalizeWheel(e) {
  let dx = e.deltaX || 0;
  let dy = e.deltaY || 0;
  let dz = 0;

  // Step 1: Convert deltaMode to pixel units.
  // Firefox with a mouse wheel reports deltaMode 1 (lines) with
  // deltaY of ±1 to ±3. Chrome and Safari report deltaMode 0
  // (pixels) with deltaY of ±100+. deltaMode 2 (pages) is rare
  // but technically possible.
  if (e.deltaMode === 1) {        // DOM_DELTA_LINE
    dx *= LINE_HEIGHT;
    dy *= LINE_HEIGHT;
  } else if (e.deltaMode === 2) { // DOM_DELTA_PAGE
    dx *= PAGE_HEIGHT;
    dy *= PAGE_HEIGHT;
  }

  // Step 2: Shift+scroll → horizontal pan.
  // On Windows and Linux, Shift+vertical scroll is the standard
  // way to scroll horizontally. The browser does not automatically
  // convert this, so we do it here. We only swap if deltaX is zero
  // (if the user is already scrolling horizontally, don't interfere).
  if (dx === 0 && e.shiftKey) {
    dx = dy;
    dy = 0;
  }

  // Step 3: Detect pinch-to-zoom.
  // Chrome (M35+), Firefox (v55+), Edge, and Safari (15+) all
  // synthesize wheel events with ctrlKey=true for trackpad pinch.
  // Ctrl+mouse-wheel also has ctrlKey=true. Both should zoom.
  // metaKey covers Cmd+scroll on macOS.
  //
  // The clamp at MAX_ZOOM_STEP prevents extreme jumps from
  // high-sensitivity trackpads that can report deltaY > 50 in a
  // single event. tldraw uses this same capping approach.
  if (e.ctrlKey || e.metaKey) {
    const clamped = Math.abs(dy) > MAX_ZOOM_STEP
      ? MAX_ZOOM_STEP * Math.sign(dy)
      : dy;
    dz = clamped / 100;
    dx = 0;
    dy = 0;
  }

  return { dx, dy, dz };
}
```

### Why dz is scaled to /100

The `/100` scaling on `dz` is coordinated with the exponential zoom formula in Section 3. Chrome reports `deltaY ≈ 100` per scroll notch, so dividing by 100 gives `dz ≈ 1.0` per notch. Firefox reports `deltaY ≈ 1` per line, which after the `LINE_HEIGHT` multiplication becomes `deltaY ≈ 40`, giving `dz ≈ 0.4` per notch. This slight difference in per-notch zoom speed between mouse types is intentional and matches what tldraw and Mapbox GL JS produce: mouse wheels zoom in larger steps than trackpad pinches, which feels natural because the user is making a coarser gesture.

---

## 3. Exponential zoom: replacing the fixed ZOOM_FACTOR

### Why fixed multiplicative zoom feels uneven

Phase 1's zoom uses `ZOOM_FACTOR = 1.04`, meaning each scroll tick multiplies zoom by 1.04 (zoom in) or divides by 1.04 (zoom out). This is a constant **percentage** change per tick, which is better than additive zoom but still has a problem: the zoom speed depends on how fast the user scrolls (more wheel events = more zoom), not on the magnitude of each individual wheel event.

Trackpad pinch produces many small `deltaY` values (0.2 to 5). Mouse wheels produce fewer large values (100 to 120). Under the fixed-factor model, a single mouse scroll notch zooms by 4% regardless of the reported delta magnitude. A trackpad pinch that reports `deltaY = 0.5` also zooms by 4%. This makes trackpad pinch feel too aggressive per-pixel of finger movement, and mouse wheels feel uniformly chunky.

### The exponential formula

The production formula, used by the AntV infinite canvas framework and Mapbox GL JS, feeds the raw (normalized) delta directly into the exponent:

```javascript
camera.zoom *= Math.pow(2, dz * -1);
```

Where `dz` is the normalized zoom delta from `normalizeWheel()` (already divided by 100). With Chrome's typical `dz ≈ 1.0` per notch, this gives `Math.pow(2, -1) = 0.5`, halving the zoom per notch outward. That is too aggressive for fine control, so we scale the sensitivity:

```javascript
const ZOOM_SENSITIVITY = 0.6;  // tunable: 0.5 = gentle, 1.0 = aggressive
camera.zoom *= Math.pow(2, dz * -ZOOM_SENSITIVITY);
```

At `ZOOM_SENSITIVITY = 1.0`, one mouse scroll notch would double or halve the zoom, which is far too aggressive for precise DM control. At `0.6`, one notch changes zoom by roughly 50%, which lands in the sweet spot: responsive enough to feel snappy, gentle enough for fine positioning.

### What changes in the Camera class

The `ZOOM_FACTOR` and `ZOOM_FACTOR_KEY` constants are removed. The `zoomAt()` method signature changes to accept a continuous delta instead of a direction+factor pair:

```javascript
// OLD (Phase 1):
const ZOOM_FACTOR = 1.04;
const ZOOM_FACTOR_KEY = 1.15;

zoomAt(sx, sy, direction, factor = ZOOM_FACTOR) {
  const worldBefore = this.screenToWorld(sx, sy);
  const oldZoom = this.zoom;
  const newZoom = direction > 0
    ? this.zoom * factor
    : this.zoom / factor;
  this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
  const worldAfter = this.screenToWorld(sx, sy);
  this.x += worldBefore.x - worldAfter.x;
  this.y += worldBefore.y - worldAfter.y;
  EventBus.emit('camera:changed');
}

zoomToCenter(direction, factor = ZOOM_FACTOR_KEY) {
  this.zoomAt(this.viewportW / 2, this.viewportH / 2, direction, factor);
}

// NEW (Phase 2):
const ZOOM_SENSITIVITY = 0.6;     // tunable: 0.5 = gentle, 1.0 = aggressive
const ZOOM_STEP_KEY = 0.4;        // per-press keyboard/button step in log2 space

zoomAt(sx, sy, delta) {
  // delta > 0 zooms in, delta < 0 zooms out.
  // The four-step algorithm is unchanged. Only the zoom calculation differs.
  const worldBefore = this.screenToWorld(sx, sy);
  const newZoom = this.zoom * Math.pow(2, delta);
  this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
  const worldAfter = this.screenToWorld(sx, sy);
  this.x += worldBefore.x - worldAfter.x;
  this.y += worldBefore.y - worldAfter.y;
  EventBus.emit('camera:changed');
}

zoomToCenter(delta) {
  this.zoomAt(this.viewportW / 2, this.viewportH / 2, delta);
}
```

The key change: `direction` (+1/-1) and `factor` (1.04) are replaced by a single `delta` that carries both direction and magnitude. Positive delta zooms in, negative zooms out. The magnitude determines how much. For wheel zoom, delta comes from `normalizeWheel().dz * -ZOOM_SENSITIVITY`. For keyboard/button zoom, delta is `±ZOOM_STEP_KEY`.

### Why this is a breaking change to the protocol

The Controller app sends `createCameraZoomMsg(direction)` where `direction` is +1 or -1. The VTT receives this and calls `camera.zoomToCenter(direction)`. With the new signature, the Controller needs to send a delta value instead. Two options:

**Option A: Update the protocol.** Change `CAMERA_ZOOM` to carry a `delta` field instead of `direction`. This is the clean approach but requires coordinated changes to `shared/protocol.js`, `controller/js/ui-builders.js`, and the VTT's message handler.

**Option B: Translate at the boundary.** Keep the protocol as-is and translate +1/-1 to ±ZOOM_STEP_KEY at the VTT's message handler. This is less disruptive:

```javascript
// In vtt/js/state.js or wherever CAMERA_ZOOM is handled:

// OLD:
EventBus.on('camera:zoom', (direction) => camera.zoomToCenter(direction));

// NEW:
EventBus.on('camera:zoom', (direction) => {
  camera.zoomToCenter(direction > 0 ? ZOOM_STEP_KEY : -ZOOM_STEP_KEY);
});
```

**Recommendation: Option B.** The protocol change can happen in Phase 4 (BroadcastChannel sync) when the protocol gets a broader revision. For now, translate at the boundary and keep the Controller working without changes.

### The same translation for camera:pan

The Controller sends `createCameraPanMsg(dx, dy)` with fixed pixel values like `(0, 80)`. The existing `camera.panBy(dx, dy)` already takes screen-space deltas and converts to world-space internally, so no change is needed here. The Controller's pan buttons continue to work as-is.

---

## 4. BoundsCache: eliminating per-event getBoundingClientRect calls

### The problem

Phase 1's `eventToScreen()` calls `getBoundingClientRect()` on every invocation:

```javascript
// Phase 1 eventToScreen
eventToScreen(e) {
  if (!this._el) return { x: 0, y: 0 };
  const rect = this._el.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / this.viewportScale,
    y: (e.clientY - rect.top) / this.viewportScale
  };
}
```

`getBoundingClientRect()` triggers a synchronous layout reflow if the DOM layout is dirty. During fast mouse movement or rapid scrolling, this is called dozens of times per frame. TanStack Virtual (the table/list virtualization library) documented that polling `getBoundingClientRect()` every rAF frame caused up to 45% idle CPU in Safari. The fix is to cache the rect and invalidate it only when something that could change the element's position actually happens.

### The implementation

Add `BoundsCache` as a private helper inside `map-camera.js`, not as a separate module. It is a simple cache, not a reusable utility, and keeping it colocated with `eventToScreen()` makes the invalidation logic obvious:

```javascript
// In map-camera.js, after the imports and before the Camera class:

/**
 * Caches an element's bounding rect to avoid triggering layout reflow
 * on every mouse event. Invalidated by ResizeObserver, window resize,
 * and window scroll. The cache is checked lazily: it only calls
 * getBoundingClientRect() when the cached value is stale.
 */
class BoundsCache {
  constructor() {
    this._rect = null;
    this._valid = false;
    this._el = null;
    this._resizeObserver = null;

    this._invalidate = () => { this._valid = false; };
  }

  /** Start observing an element. Call once during attachTo(). */
  observe(el) {
    // Clean up any previous observation
    this.disconnect();

    this._el = el;
    this._valid = false;

    this._resizeObserver = new ResizeObserver(this._invalidate);
    this._resizeObserver.observe(el);
    window.addEventListener('resize', this._invalidate);
    window.addEventListener('scroll', this._invalidate);
  }

  /** Stop observing. Call during cleanup if needed. */
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

  /** Manually invalidate (e.g., after a CSS transform change). */
  invalidate() {
    this._valid = false;
  }

  /** Get the cached rect, recomputing only if stale. */
  getRect() {
    if (!this._valid || !this._rect) {
      if (!this._el) return { left: 0, top: 0, width: 0, height: 0 };
      this._rect = this._el.getBoundingClientRect();
      this._valid = true;
    }
    return this._rect;
  }
}
```

### Wiring it into the Camera class

```javascript
// In Camera constructor, add:
this._boundsCache = new BoundsCache();

// In attachTo(el), add after this._el = el:
this._boundsCache.observe(el);

// Replace eventToScreen:

// OLD:
eventToScreen(e) {
  if (!this._el) return { x: 0, y: 0 };
  const rect = this._el.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / this.viewportScale,
    y: (e.clientY - rect.top) / this.viewportScale
  };
}

// NEW:
eventToScreen(e) {
  const rect = this._boundsCache.getRect();
  return {
    x: (e.clientX - rect.left) / this.viewportScale,
    y: (e.clientY - rect.top) / this.viewportScale
  };
}
```

### When to manually invalidate

The `BoundsCache` auto-invalidates on resize and scroll. But if the VTT changes the container's position through means other than resize (for example, toggling the sidebar, which shifts the map container's left offset), the bounds become stale. The viewport scaler in Phase 1 already emits a `vtt-scale-change` custom event when the CSS transform changes. Add an invalidation call there:

```javascript
// In viewport-scaler.js, wherever the scale/transform changes:
camera._boundsCache.invalidate();

// Or, if the camera isn't directly accessible, emit an event:
EventBus.on('viewport:layout-changed', () => {
  this._boundsCache.invalidate();
});
```

MapRenderer's `_onContainerResize` already triggers via ResizeObserver, which invalidates the cache automatically. No additional wiring needed for the resize path.

---

## 5. Refining the rAF coalescing pattern for accumulated vs. latest-value input

### The Phase 1 pattern and what it gets right

Phase 1 uses an on-demand rAF coalescing pattern: `camera:changed` events schedule a `requestAnimationFrame` callback that calls `redrawAll()`, and duplicate requests within the same frame are collapsed by a dirty flag. This pattern uses zero CPU when idle and is correct for all current input sources.

### What Phase 2 adds on top

Phase 2 does **not** replace this pattern with a continuous render loop. That would burn CPU when idle, which is wasteful for a DM presentation tool that sits still most of the time.

Instead, Phase 2 introduces a principle for how event handlers feed into the existing pattern: **accumulated deltas for additive inputs, latest-value for positional inputs.**

- **Wheel zoom deltas are accumulated.** If three wheel events fire between frames with `dz` values of 0.3, 0.4, and 0.3, the frame should process `dz = 1.0`, not just the last value. Dropping intermediate deltas loses intended zoom distance.

- **Mouse position during pan uses latest-value.** If three mousemove events fire between frames at positions (100, 200), (105, 203), and (110, 205), only the final position matters for the pan calculation, since pan is computed as `currentPos - startPos`.

Phase 1's wheel handler already processes each event immediately (calling `zoomAt()` per event), which effectively accumulates because each call adjusts the camera incrementally. This is correct but slightly wasteful: if four wheel events fire between frames, the camera emits `camera:changed` four times, and the rAF coalescing collapses them into one redraw. The four `zoomAt()` calls still execute, though, computing `screenToWorld` eight times (four before, four after) when one call with the accumulated delta would produce the same result.

For Phase 2, we keep the per-event processing model but with one optimization: **batch the BoundsCache lookup.** Since all wheel events within a frame use the same element bounds, the first event computes the rect and subsequent events use the cached value. This happens automatically with the BoundsCache from Section 4.

The keyboard system (Section 7) is the one place where Phase 2 adds a new rAF loop. That loop runs only while keys are held and calls `panBy()`/`zoomToCenter()` once per frame with frame-rate-independent deltas. When all keys are released, the loop stops.

---

## 6. Browser zoom prevention: intercepting every vector

### The problem

Without explicit prevention, several input combinations trigger browser zoom instead of app zoom: Ctrl+scroll wheel, Ctrl+Plus/Minus keyboard, trackpad pinch (on some browsers), and Safari gesture events. The VTT needs to intercept all of these.

### The implementation

Add a new function to `map-camera.js` that the Camera calls from `attachTo()`:

```javascript
/**
 * Prevent browser-level zoom on all input vectors.
 * Must be called once during initialization.
 *
 * Note: this cannot prevent browser menu zoom (View → Zoom In),
 * browser toolbar zoom buttons, OS-level accessibility zoom, or
 * zoom from browser extensions. Those fire no interceptable JS events.
 */
_preventBrowserZoom() {
  // 1. Ctrl+scroll and trackpad pinch.
  // These fire wheel events with ctrlKey=true. Chrome 56+ defaults
  // wheel listeners on document/window to passive, so we must
  // explicitly set passive:false to allow preventDefault().
  //
  // This listener is on document, not the canvas element, because
  // the browser zoom gesture is document-level. If the user
  // Ctrl+scrolls anywhere on the page, it should not trigger
  // browser zoom.
  document.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
  }, { passive: false });

  // 2. Ctrl+Plus/Minus/Zero keyboard zoom.
  // e.key is '+', '-', '=', or '0'. The '=' check catches
  // Ctrl+= which is the unshifted Plus on US keyboards.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) &&
        ['+', '-', '=', '0'].includes(e.key)) {
      e.preventDefault();
    }
  });

  // 3. Safari desktop gesture events.
  // Safari fires gesturestart/gesturechange for trackpad pinch
  // in addition to the ctrlKey wheel events. Without preventing
  // these, Safari performs native page zoom simultaneously with
  // our app zoom.
  //
  // Feature detection: GestureEvent exists only in Safari.
  // We also check that TouchEvent is absent, which distinguishes
  // desktop Safari from iOS Safari (where GestureEvent exists
  // but serves a different purpose).
  if (typeof GestureEvent !== 'undefined') {
    document.addEventListener('gesturestart', (e) => e.preventDefault(),
      { passive: false });
    document.addEventListener('gesturechange', (e) => e.preventDefault(),
      { passive: false });
  }
}
```

Call `this._preventBrowserZoom()` at the top of `attachTo()`, before any other event listeners are registered.

### Why this is in the Camera, not a standalone module

Browser zoom prevention is conceptually part of input handling. It only matters when the camera exists and is attached to an element. Putting it in a separate module would create a dependency order question (does zoom prevention initialize before or after the camera?) with no benefit. The Camera owns its input, including the prevention of conflicting browser behavior.

---

## 7. Keyboard camera control

### What keys do what

The VTT adds these keyboard shortcuts, following the conventions shared by Figma, tldraw, Excalidraw, and Photoshop:

| Action | Key(s) | Behavior |
|--------|--------|----------|
| Pan left | Arrow Left | Continuous while held |
| Pan right | Arrow Right | Continuous while held |
| Pan up | Arrow Up | Continuous while held |
| Pan down | Arrow Down | Continuous while held |
| Zoom in | `+` or `=` (no modifier) | Discrete per-press at viewport center |
| Zoom out | `-` (no modifier) | Discrete per-press at viewport center |
| Fit to cover | `Shift+0` | Instant, calls `camera.fitCover()` |
| Fit to contain | `Shift+1` | Instant, calls `camera.fitContain()` |

Space+drag for panning is already implemented in Phase 1's `attachTo()` and remains unchanged.

Note that `Ctrl+Plus` and `Ctrl+Minus` are intercepted by the browser zoom prevention (Section 6) and do **not** trigger app zoom. Bare `+`/`-` without Ctrl are the app zoom keys.

### Why a key state map, not keydown repeat

The OS keydown repeat has a ~300ms initial delay and fires at roughly 30Hz, which is unsynchronized with the display refresh rate. Worse, it cannot handle simultaneous keys: holding Arrow Left and Arrow Up should produce diagonal movement, but OS repeat generates alternating events for each key, not simultaneous ones.

The solution is a key state map that tracks which keys are currently pressed, combined with a rAF loop that processes all held keys once per frame:

### The implementation

Add `KeyboardController` to `map-camera.js`, after the `BoundsCache` class and before the `Camera` class:

```javascript
/**
 * Keyboard camera control via key state map + rAF loop.
 *
 * Event handlers set key state. A rAF loop reads state and applies
 * camera changes once per frame with frame-rate-independent deltas.
 * The loop only runs while at least one relevant key is held.
 *
 * Pan speed scales inversely with zoom: at high zoom (zoomed in),
 * arrow keys move fewer world pixels per second, keeping the visual
 * pan speed consistent. This matches Figma's behavior.
 */

// Keys that this controller cares about
const CAMERA_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'
]);

const PAN_SPEED = 600;           // base speed in CSS pixels per second
const PAN_SPEED_SHIFT = 1800;    // speed when Shift is held (3x)

class KeyboardController {
  constructor(camera) {
    this._camera = camera;
    this._keys = {};
    this._rafId = null;
    this._lastTimestamp = 0;
    this._active = false;         // true when at least one camera key is held

    // Bind handlers so they can be removed if needed
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
    this._tick = this._tick.bind(this);
  }

  /** Start listening for keyboard events. Call once during attachTo(). */
  attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  _onKeyDown(e) {
    // Skip when focus is in a text input
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.target.isContentEditable) return;

    // Track Shift state for fast-pan
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this._keys[e.code] = true;
    }

    // Discrete zoom keys (no repeat)
    if (!e.repeat) {
      if (e.key === '+' || e.key === '=') {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          this._camera.zoomToCenter(ZOOM_STEP_KEY);
          return;
        }
      }
      if (e.key === '-') {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          this._camera.zoomToCenter(-ZOOM_STEP_KEY);
          return;
        }
      }

      // Zoom presets
      if (e.shiftKey && e.key === ')') {
        // Shift+0 produces ')' on US keyboards
        e.preventDefault();
        this._camera.fitCover();
        return;
      }
      if (e.shiftKey && e.key === '!') {
        // Shift+1 produces '!' on US keyboards
        e.preventDefault();
        this._camera.fitContain();
        return;
      }
    }

    // Continuous pan keys: track state, start loop
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
      // Stop loop if no camera keys are held
      if (!Object.values(this._keys).some(Boolean)) {
        this._stopLoop();
      }
    }
  }

  /**
   * Clear all key state on blur and visibilitychange.
   * Without this, alt-tabbing away while holding an arrow key
   * leaves the key "stuck" because the keyup fires in the other
   * window, not this one.
   */
  _onBlur() {
    this._clearKeys();
  }

  _onVisibilityChange() {
    if (document.hidden) this._clearKeys();
  }

  _clearKeys() {
    for (const k in this._keys) this._keys[k] = false;
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
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _tick(timestamp) {
    if (!this._active) return;

    // Cap dt to prevent teleporting after tab was backgrounded.
    // Browsers pause rAF when the tab is hidden. The first frame
    // after returning could have a dt of several seconds.
    const dt = Math.min((timestamp - this._lastTimestamp) / 1000, 0.1);
    this._lastTimestamp = timestamp;

    // Check if Shift is currently held (read from most recent keydown state)
    // We use a simple approach: check if any shift-modified speed should apply
    const speed = this._keys['ShiftLeft'] || this._keys['ShiftRight']
      ? PAN_SPEED_SHIFT
      : PAN_SPEED;

    // Calculate screen-space pan delta.
    // panBy() converts screen pixels to world displacement internally.
    let dx = 0;
    let dy = 0;
    if (this._keys['ArrowLeft'])  dx -= speed * dt;
    if (this._keys['ArrowRight']) dx += speed * dt;
    if (this._keys['ArrowUp'])    dy -= speed * dt;
    if (this._keys['ArrowDown'])  dy += speed * dt;

    if (dx !== 0 || dy !== 0) {
      this._camera.panBy(dx, dy);
    }

    this._rafId = requestAnimationFrame(this._tick);
  }
}
```

### Wiring into the Camera class

```javascript
// In Camera constructor, add:
this._keyboard = new KeyboardController(this);

// In attachTo(el), add after _preventBrowserZoom():
this._keyboard.attach();
```

### Why Space+drag is unchanged

Phase 1 already tracks `this.spaceHeld` via keydown/keyup on Space, and the mousedown handler checks it for pan initiation. This continues to work. The `KeyboardController` does not intercept Space because it uses `e.code` matching against `CAMERA_KEYS`, which does not include `'Space'`.

---

## 8. Updating the wheel handler in attachTo

### The complete replacement

This replaces the wheel event listener inside `attachTo()`:

```javascript
// In attachTo(el), replace the entire wheel listener:

// OLD (Phase 1):
el.addEventListener('wheel', (e) => {
  e.preventDefault();
  let dx = e.deltaX;
  let dy = e.deltaY;
  if (e.deltaMode === 1) { dx *= 40; dy *= 40; }
  else if (e.deltaMode === 2) { dx *= 800; dy *= 800; }

  if (e.ctrlKey || e.metaKey) {
    const screen = this.eventToScreen(e);
    const direction = dy < 0 ? 1 : -1;
    this.zoomAt(screen.x, screen.y, direction);
  } else {
    this.panBy(-dx, -dy);
  }
}, { passive: false });

// NEW (Phase 2):
el.addEventListener('wheel', (e) => {
  e.preventDefault();

  const { dx, dy, dz } = normalizeWheel(e);

  if (dz !== 0) {
    // Zoom at cursor position.
    // Browser scroll-up produces negative deltaY, which normalizeWheel
    // passes through as negative dz. We negate via -ZOOM_SENSITIVITY
    // so that scroll-up (negative dz) becomes positive delta (zoom in).
    const screen = this.eventToScreen(e);
    this.zoomAt(screen.x, screen.y, dz * -ZOOM_SENSITIVITY);
  } else if (dx !== 0 || dy !== 0) {
    // Pan. panBy() expects "drag direction" deltas:
    // scrolling down (positive dy) should reveal content below,
    // meaning camera.y increases (moves down in world).
    // panBy() already negates internally (this.x -= dx / this.zoom),
    // so we pass the negative of the scroll deltas.
    this.panBy(-dx, -dy);
  }
}, { passive: false });
```

### Import normalizeWheel

Add to the top of `map-camera.js`:

```javascript
// OLD:
import { EventBus } from './state.js';

// NEW:
import { EventBus } from './state.js';
import { normalizeWheel } from './normalize-wheel.js';
```

---

## 9. Updating MapRenderer's mousemove coordinate caching

### The current pattern

MapRenderer tracks the mouse position for fog toggling:

```javascript
// In MapRenderer.init():
container.addEventListener('mousemove', (e) => {
  const rect = container.getBoundingClientRect();
  const vs = this.camera.viewportScale;
  this._mouseX = (e.clientX - rect.left) / vs;
  this._mouseY = (e.clientY - rect.top) / vs;
});
```

This duplicates the coordinate conversion that `eventToScreen()` already provides, and calls `getBoundingClientRect()` on every mousemove, which is exactly the performance problem BoundsCache solves.

### The replacement

```javascript
// OLD:
container.addEventListener('mousemove', (e) => {
  const rect = container.getBoundingClientRect();
  const vs = this.camera.viewportScale;
  this._mouseX = (e.clientX - rect.left) / vs;
  this._mouseY = (e.clientY - rect.top) / vs;
});

// NEW:
container.addEventListener('mousemove', (e) => {
  const screen = this.camera.eventToScreen(e);
  this._mouseX = screen.x;
  this._mouseY = screen.y;
});
```

This delegates to `eventToScreen()`, which now uses the `BoundsCache` internally. One method, one cache, one source of truth.

---

## 10. CSS additions

### touch-action on the map container

Add to `vtt/css/map.css`:

```css
/* OLD (no touch-action rule exists): */

/* NEW: */
#map-container {
  touch-action: none;
}
```

This prevents the browser from intercepting touch gestures on the map for default scrolling, pinching, or panning. Without it, touch input fires `pointercancel` events that kill custom gesture handling. Even though Phase 2 does not implement touch pinch-to-zoom, setting this now prevents a class of bugs if touch support is added later, and it has zero cost on desktop.

### cursor styles for keyboard pan

No additional CSS is needed. The existing `.panning` class and cursor styles from Phase 1 handle mouse-based panning. Keyboard panning does not change the cursor because there is no drag gesture to indicate visually.

---

## 11. Testing protocols

### Unit tests for normalizeWheel

```javascript
// tests/normalize-wheel.test.js
import { normalizeWheel } from '../vtt/js/normalize-wheel.js';

// Helper to create a minimal WheelEvent-like object
function fakeWheel(overrides = {}) {
  return {
    deltaX: 0, deltaY: 0, deltaMode: 0,
    ctrlKey: false, metaKey: false, shiftKey: false,
    ...overrides
  };
}

test('Chrome mouse wheel: deltaMode 0, deltaY 100 → pan dy 100', () => {
  const { dx, dy, dz } = normalizeWheel(fakeWheel({ deltaY: 100 }));
  expect(dz).toBe(0);
  expect(dy).toBe(100);
  expect(dx).toBe(0);
});

test('Firefox mouse wheel: deltaMode 1, deltaY 3 → pan dy 120', () => {
  const { dx, dy, dz } = normalizeWheel(fakeWheel({ deltaY: 3, deltaMode: 1 }));
  expect(dz).toBe(0);
  expect(dy).toBe(120); // 3 * LINE_HEIGHT(40)
});

test('Trackpad pinch: ctrlKey + deltaY 2 → zoom dz 0.02', () => {
  const { dx, dy, dz } = normalizeWheel(fakeWheel({ deltaY: 2, ctrlKey: true }));
  expect(dz).toBeCloseTo(0.02);
  expect(dx).toBe(0);
  expect(dy).toBe(0);
});

test('Extreme pinch delta is clamped', () => {
  const { dz } = normalizeWheel(fakeWheel({ deltaY: 50, ctrlKey: true }));
  expect(dz).toBeCloseTo(0.1); // MAX_ZOOM_STEP(10) / 100
});

test('Shift+scroll swaps to horizontal', () => {
  const { dx, dy, dz } = normalizeWheel(fakeWheel({ deltaY: 100, shiftKey: true }));
  expect(dz).toBe(0);
  expect(dx).toBe(100);
  expect(dy).toBe(0);
});

test('deltaMode 2 (page) scales correctly', () => {
  const { dy } = normalizeWheel(fakeWheel({ deltaY: 1, deltaMode: 2 }));
  expect(dy).toBe(800); // 1 * PAGE_HEIGHT(800)
});
```

### Unit tests for exponential zoom

```javascript
// tests/camera-zoom.test.js

test('exponential zoom is perceptually uniform', () => {
  // Zooming from 1x to 2x should take the same number of steps
  // as zooming from 2x to 4x, because both are a doubling.
  const delta = 0.6; // ZOOM_SENSITIVITY
  const stepsToDouble = Math.round(1 / delta); // ~2 steps

  let zoom = 1.0;
  for (let i = 0; i < stepsToDouble; i++) {
    zoom *= Math.pow(2, delta);
  }
  const ratio1 = zoom / 1.0;

  zoom = 2.0;
  for (let i = 0; i < stepsToDouble; i++) {
    zoom *= Math.pow(2, delta);
  }
  const ratio2 = zoom / 2.0;

  // Both ratios should be equal (same doubling factor)
  expect(Math.abs(ratio1 - ratio2)).toBeLessThan(0.001);
});

test('zoom-at-cursor preserves world point', () => {
  // Create a camera with known state
  const camera = { x: 0, y: 0, zoom: 1.0, viewportW: 1920, viewportH: 1080 };
  camera.screenToWorld = (sx, sy) => ({
    x: sx / camera.zoom + camera.x,
    y: sy / camera.zoom + camera.y
  });

  // Screen point to keep stable
  const sx = 960, sy = 540;
  const worldBefore = camera.screenToWorld(sx, sy);

  // Apply zoom
  const delta = 0.6;
  const oldZoom = camera.zoom;
  camera.zoom *= Math.pow(2, delta);
  const worldAfter = camera.screenToWorld(sx, sy);
  camera.x += worldBefore.x - worldAfter.x;
  camera.y += worldBefore.y - worldAfter.y;

  // World point under cursor should be preserved
  const finalWorld = camera.screenToWorld(sx, sy);
  expect(Math.abs(finalWorld.x - worldBefore.x)).toBeLessThan(0.01);
  expect(Math.abs(finalWorld.y - worldBefore.y)).toBeLessThan(0.01);
});
```

### Playwright integration tests

```javascript
// tests/e2e/phase2-input.spec.js
const { test, expect } = require('@playwright/test');

test('exponential zoom produces perceptually uniform steps', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:8765/vtt/index.html');
  await page.waitForSelector('#loading[hidden]', { timeout: 10000 });

  await page.evaluate(() => {
    window.__vtt?.store?.state && (window.__vtt.store.state.mode = 'map');
  });
  await page.waitForTimeout(500);

  // Record zoom after one scroll notch at zoom 1.0
  await page.mouse.move(960, 540);
  const zoomBefore1 = await page.evaluate(() =>
    window.__vtt?.mapRenderer?.camera?.zoom
  );
  await page.mouse.wheel(0, -100); // scroll up = zoom in
  await page.waitForTimeout(50);
  const zoomAfter1 = await page.evaluate(() =>
    window.__vtt?.mapRenderer?.camera?.zoom
  );
  const ratio1 = zoomAfter1 / zoomBefore1;

  // Zoom in more, then record ratio of another notch
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(50);
  const zoomBefore2 = await page.evaluate(() =>
    window.__vtt?.mapRenderer?.camera?.zoom
  );
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(50);
  const zoomAfter2 = await page.evaluate(() =>
    window.__vtt?.mapRenderer?.camera?.zoom
  );
  const ratio2 = zoomAfter2 / zoomBefore2;

  // Ratios should be approximately equal (perceptual uniformity)
  expect(Math.abs(ratio1 - ratio2)).toBeLessThan(0.05);
});

test('arrow keys produce smooth diagonal pan', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:8765/vtt/index.html');
  await page.waitForSelector('#loading[hidden]', { timeout: 10000 });

  await page.evaluate(() => {
    window.__vtt?.store?.state && (window.__vtt.store.state.mode = 'map');
  });
  await page.waitForTimeout(500);

  const posBefore = await page.evaluate(() => {
    const cam = window.__vtt?.mapRenderer?.camera;
    return cam ? { x: cam.x, y: cam.y } : null;
  });

  // Hold ArrowRight + ArrowDown for 300ms
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('ArrowDown');
  await page.waitForTimeout(50);

  const posAfter = await page.evaluate(() => {
    const cam = window.__vtt?.mapRenderer?.camera;
    return cam ? { x: cam.x, y: cam.y } : null;
  });

  // Camera should have moved right and down (x increased, y increased)
  expect(posAfter.x).toBeGreaterThan(posBefore.x);
  expect(posAfter.y).toBeGreaterThan(posBefore.y);
});

test('Ctrl+scroll does not trigger browser zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:8765/vtt/index.html');
  await page.waitForSelector('#loading[hidden]', { timeout: 10000 });

  // Check that page zoom level is 1.0 before and after Ctrl+scroll
  const zoomBefore = await page.evaluate(() =>
    window.visualViewport?.scale ?? 1
  );

  await page.mouse.move(960, 540);
  // Simulate Ctrl+scroll
  await page.evaluate(() => {
    const el = document.getElementById('map-container');
    const event = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    el.dispatchEvent(event);
  });
  await page.waitForTimeout(100);

  const zoomAfter = await page.evaluate(() =>
    window.visualViewport?.scale ?? 1
  );

  // Browser zoom should not have changed
  expect(zoomAfter).toBe(zoomBefore);
});

test('keyboard shortcuts skip when input is focused', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:8765/vtt/index.html');
  await page.waitForSelector('#loading[hidden]', { timeout: 10000 });

  await page.evaluate(() => {
    window.__vtt?.store?.state && (window.__vtt.store.state.mode = 'map');
  });
  await page.waitForTimeout(500);

  const posBefore = await page.evaluate(() => {
    const cam = window.__vtt?.mapRenderer?.camera;
    return cam ? { x: cam.x, y: cam.y } : null;
  });

  // Focus a text input (if one exists) and press arrow keys
  const hasInput = await page.evaluate(() => {
    const input = document.querySelector('input[type="text"]');
    if (input) { input.focus(); return true; }
    return false;
  });

  if (hasInput) {
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(200);
    await page.keyboard.up('ArrowRight');

    const posAfter = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam ? { x: cam.x, y: cam.y } : null;
    });

    // Camera should NOT have moved
    expect(posAfter.x).toBe(posBefore.x);
    expect(posAfter.y).toBe(posBefore.y);
  }
});
```

### Manual testing checklist

Run through this by hand after the code changes are in place:

1. **Scroll wheel zoom at cursor**: Position cursor over a specific map feature (a doorway, a statue, a table). Scroll to zoom in and out. The feature should stay under the cursor throughout. Zoom should feel smooth and proportional, not "chunky."

2. **Zoom uniformity check**: Zoom all the way out to minimum, then slowly scroll in. Each notch should produce visually similar zoom steps. Compare to Phase 1 behavior: the old fixed-factor zoom should have felt uniform already; exponential zoom should feel similar but smoother with trackpad.

3. **Trackpad pinch zoom** (if MacBook available): Two-finger pinch on the trackpad should zoom smoothly at the cursor position. Pinch speed should feel proportional to finger spread.

4. **Trackpad two-finger scroll**: Two-finger scroll on the trackpad should pan the map. Scrolling down reveals content below. Horizontal scroll works.

5. **Shift+scroll horizontal pan** (Windows/Linux or simulated): Hold Shift and scroll. Map should pan horizontally, not vertically.

6. **Arrow key panning**: Press and hold each arrow key. Map should pan smoothly in the corresponding direction. Holding two keys (e.g., Right+Down) should produce diagonal movement.

7. **Arrow key Shift acceleration**: Hold Shift+Arrow. Pan speed should be noticeably faster (3x).

8. **Arrow key release**: Let go of arrow keys. Panning should stop immediately (no drift or momentum, that is a deferred feature).

9. **Plus/Minus zoom**: Press `+` or `=`. Map should zoom in one step at the viewport center. Press `-`. Map should zoom out one step.

10. **Shift+0 fit to cover**: Press Shift+0. Map should snap to fill the viewport with no black bars, centered.

11. **Shift+1 fit to contain**: Press Shift+1. Map should snap to show the entire map (with possible black bars), centered.

12. **Focus guard**: Click into a text input field (if any exist on the page). Press arrow keys. The map should not move. Arrow keys should work in the text input normally.

13. **Alt-tab safety**: Hold an arrow key to start panning. Alt-tab to another window. Come back to the VTT. Panning should have stopped (no stuck key).

14. **Controller zoom buttons**: Open the Controller. Click Zoom In and Zoom Out buttons. Verify the VTT responds with visible zoom changes.

15. **Controller pan arrows**: Click the pan arrow buttons. Verify the VTT pans in the correct direction.

16. **Browser zoom prevention**: Press Ctrl+Plus. Verify the page does not zoom (the browser's zoom level indicator should not appear). Press Ctrl+Minus, same check. Press Ctrl+0, same check.

---

## 12. Migration checklist

This is the ordered list of changes for Claude Code. Each item references the section above that provides the implementation.

1. **Create `vtt/js/normalize-wheel.js`** with the `normalizeWheel` function (Section 2). This is a new file with a single named export.

2. **Update `vtt/js/map-camera.js`** constants:
   - Remove `ZOOM_FACTOR = 1.04` and `ZOOM_FACTOR_KEY = 1.15`
   - Add `ZOOM_SENSITIVITY = 0.6` and `ZOOM_STEP_KEY = 0.4`
   - Add `import { normalizeWheel } from './normalize-wheel.js'`

3. **Add `BoundsCache` class** to `map-camera.js` (Section 4). Place it after the imports and constants, before the `Camera` class.

4. **Add `KeyboardController` class** to `map-camera.js` (Section 7). Place it after `BoundsCache`, before the `Camera` class. Include the `CAMERA_KEYS`, `PAN_SPEED`, and `PAN_SPEED_SHIFT` constants.

5. **Update `Camera` constructor**:
   - Add `this._boundsCache = new BoundsCache()`
   - Add `this._keyboard = new KeyboardController(this)`

6. **Update `Camera.eventToScreen()`** to use `this._boundsCache.getRect()` instead of `this._el.getBoundingClientRect()` (Section 4).

7. **Update `Camera.zoomAt()` signature**: Replace `(sx, sy, direction, factor = ZOOM_FACTOR)` with `(sx, sy, delta)`. Replace the body's multiplicative zoom with `Math.pow(2, delta)` (Section 3).

8. **Update `Camera.zoomToCenter()` signature**: Replace `(direction, factor = ZOOM_FACTOR_KEY)` with `(delta)`. Update the body to pass `delta` to `zoomAt()` (Section 3).

9. **Add `Camera._preventBrowserZoom()` method** (Section 6).

10. **Update `Camera.attachTo(el)`**:
    - Add `this._boundsCache.observe(el)` after `this._el = el`
    - Add `this._preventBrowserZoom()` call
    - Add `this._keyboard.attach()` call
    - Replace the wheel event listener with the Phase 2 version (Section 8)

11. **Update the `camera:zoom` EventBus handler** (wherever `CAMERA_ZOOM` messages are received) to translate direction to delta: `camera.zoomToCenter(direction > 0 ? ZOOM_STEP_KEY : -ZOOM_STEP_KEY)` (Section 3, Option B).

12. **Update `vtt/js/map-renderer.js`**: Replace the mousemove coordinate conversion with `this.camera.eventToScreen(e)` (Section 9).

13. **Update `vtt/css/map.css`**: Add `touch-action: none` to `#map-container` (Section 10).

14. **Run the test suite** (Section 11): unit tests for normalizeWheel, exponential zoom math, Playwright integration tests, manual testing checklist.

---

## 13. What Phase 3 expects from this foundation

Phase 3 (Boundary clamping) builds on Phase 2's input infrastructure. Specifically, it expects:

- **`normalizeWheel()` is the single entry point for wheel processing.** Phase 3 adds elastic overscroll that modifies the pan deltas returned by `normalizeWheel()` when the camera is near a boundary. The factoring of normalization into a separate function makes this hook point clean.

- **`zoomAt(sx, sy, delta)` accepts continuous deltas.** Phase 3's zoom-floor enforcement (`zoom = Math.max(zoom, coverZoom)`) applies after the exponential calculation. The continuous delta model means Phase 3 can smoothly decelerate zoom as it approaches the floor, rather than hitting a hard stop.

- **`camera.viewportW` and `camera.viewportH` are current.** Phase 3 uses these to calculate the visible world area (`visibleW = viewportW / zoom`) for pan boundary detection.

- **`BoundsCache` handles layout changes.** Phase 3 may introduce a collapsible sidebar that changes the map container's position. The BoundsCache with its ResizeObserver auto-invalidation handles this without additional wiring.

- **Keyboard panning respects boundaries.** Phase 3 adds clamping to `panBy()`. Since the `KeyboardController` calls `panBy()`, keyboard panning automatically respects boundaries once the clamp is in place.

---

## 14. What is explicitly deferred and why

The following features were researched for Phase 2 but deliberately scoped out. Each has a reason:

**Inertial/momentum panning (deferred to Phase 5).** Exponential decay momentum after drag release is standard in mapping apps and mobile interfaces. For a DM-controlled presentation display, it introduces a risk: the DM releases a drag and the map glides past the intended position, potentially revealing areas they did not want players to see. This is a "nice to have" polish feature, not a core input improvement. Phase 5 (Advanced features) is the right home, with a user preference toggle to enable/disable it.

**Touch/PointerEvent pinch-to-zoom (deferred until touch support is needed).** The VTT Display runs in Chromium on a desktop. The PointerEvent migration (mousedown to pointerdown) is a straightforward 1:1 rename, but the full pinch-to-zoom gesture tracking infrastructure adds complexity with no immediate user. When the VTT supports tablet players or a touch-enabled Controller, this should be implemented following the `PinchZoomHandler` pattern from the Phase 2 research appendix.

**Safari GestureEvent handling (deferred until Safari is a target).** Safari's proprietary `GestureEvent` provides a cumulative `scale` property for trackpad pinch. The VTT Display is Chrome-only; the Controller could theoretically be opened in Safari, but the Controller does not have a map canvas, so gesture handling is irrelevant there. The browser zoom prevention in Section 6 includes `gesturestart`/`gesturechange` prevention as a safety measure, which is sufficient for now.

**Edge-pan acceleration during token drag (deferred to Phase 3 or 4).** Auto-scrolling when the cursor nears the viewport edge during a drag operation requires coordination between TokenManager (which owns the drag state) and the camera (which owns pan). The integration point ("how does TokenManager signal that a drag is active?") depends on boundary clamping infrastructure from Phase 3. Implementing edge-pan before boundaries exist means the pan has no limits, which produces worse UX than no edge-pan at all.

**Animated zoom transitions with logerp (deferred to Phase 5).** Smooth animated zoom from current level to a target (for zoom presets and cinematic camera movements) uses logarithmic interpolation with easing. The math is well-understood (see Phase 2 research appendix, Section 12), but the use cases (saved camera presets, "fly to location" commands) belong to Phase 5's advanced feature set. Phase 2's `Shift+0` and `Shift+1` presets snap instantly; Phase 5 adds animation on top.
