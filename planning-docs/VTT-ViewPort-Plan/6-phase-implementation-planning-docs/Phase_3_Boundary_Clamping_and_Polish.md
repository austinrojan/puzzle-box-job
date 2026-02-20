# Phase 3: Boundary clamping and polish for the world-space camera

**This guide adds boundary constraints, elastic overscroll, zoom floor enforcement, and edge-pan during token drag to the VTT's camera system.** The Phase 1 camera established a world-space `Camera = { x, y, zoom }` with cover-zoom calculation and coordinate conversion. Phase 2 added exponential zoom, normalized wheel input, BoundsCache, keyboard control, and browser zoom prevention. Phase 3 wraps all of that in a centralized constraint system that prevents the camera from showing black bars, adds tactile resistance at map edges, and automatically scrolls the viewport when dragging tokens near the edge.

The architectural centerpiece is **clamp-on-commit**: a single `_applyConstraints()` method that every camera mutation flows through. Instead of each input source (mouse drag, wheel zoom, keyboard pan, BroadcastChannel sync, programmatic moves) independently checking boundaries, they all call the same commit point. This eliminates an entire class of constraint-bypass bugs and is the pattern used by tldraw, Mapbox GL JS, and Phaser.

The guide is structured as a walkthrough you can hand directly to Claude Code. Each section explains what the code does and why, provides the complete implementation, calls out interactions with existing modules, and includes testing protocols. Read it front to back before changing anything. The order matters.

---

## Table of contents

1. [What Phase 2 established and what Phase 3 changes](#1-what-phase-2-established-and-what-phase-3-changes)
2. [The clamp-on-commit architecture: refactoring Camera's commit path](#2-the-clamp-on-commit-architecture)
3. [The dual-regime clamping algorithm](#3-the-dual-regime-clamping-algorithm)
4. [Zoom floor enforcement and cursor-anchor preservation](#4-zoom-floor-enforcement)
5. [Elastic overscroll with Apple's rubber-band formula](#5-elastic-overscroll)
6. [Critically damped spring snap-back animation](#6-spring-snap-back-animation)
7. [Edge-pan during token drag](#7-edge-pan-during-token-drag)
8. [DM "zoom past cover" toggle](#8-dm-zoom-past-cover-toggle)
9. [BroadcastChannel protocol implications](#9-broadcastchannel-protocol)
10. [CSS changes](#10-css-changes)
11. [Testing protocols](#11-testing-protocols)
12. [Migration checklist](#12-migration-checklist)
13. [What Phase 4 expects from this foundation](#13-phase-4-expectations)

---

## 1. What Phase 2 established and what Phase 3 changes

### The Phase 2 foundation

Phase 2 delivered normalized input handling on top of the Phase 1 world-space camera. The methods that Phase 3 depends on:

```javascript
camera.screenToWorld(sx, sy)       // screen → world coordinates
camera.worldToScreen(wx, wy)       // world → screen coordinates
camera.eventToScreen(e)            // DOM event → canvas-space screen coordinates (BoundsCache)
camera.zoomAt(sx, sy, delta)       // four-step zoom-at-cursor with exponential delta
camera.zoomToCenter(delta)         // zoom at viewport midpoint
camera.panBy(dx, dy)               // screen-space delta → world-space pan
camera.fitCover()                  // snap to cover zoom, center map
camera.fitContain()                // snap to contain zoom, center map
camera.setPosition(x, y, zoom)    // direct state set (for sync and presets)
camera.setViewportSize(w, h)       // update viewport dims, recalc cover zoom
camera.serialize() / deserialize() // cross-window sync
camera._coverZoom                  // dynamic zoom floor (recalculated on resize + map load)
camera.viewportW / camera.viewportH // current viewport dimensions
camera.mapW / camera.mapH           // current map dimensions in world pixels
```

Phase 2's `normalizeWheel()` (in `vtt/js/normalize-wheel.js`) returns `{ dx, dy, dz }` where `dz` is the zoom delta. The `KeyboardController` (in `vtt/js/map-camera.js`) drives arrow-key panning via `camera.panBy()` and zoom via `camera.zoomToCenter()`. All camera mutations emit `camera:changed` via EventBus, which feeds into the rAF coalescing pattern in MapRenderer.

### What Phase 3 changes

Phase 3 makes five additions to this foundation:

1. **Introduces `_applyConstraints()` as the single constraint enforcement point.** Every method that modifies `this.x`, `this.y`, or `this.zoom` now routes through `_applyConstraints()` instead of directly setting state and emitting `camera:changed`. This is the refactoring heart of Phase 3.

2. **Adds dual-regime pan clamping.** When zoomed in (visible area smaller than the map), the camera is constrained so map edges never pull inward from the viewport edge. When zoomed out (visible area larger than the map on one or both axes), the map is centered on that axis. Each axis is clamped independently, so a panoramic map can be zoomed-in on X and zoomed-out on Y simultaneously.

3. **Enforces the cover zoom as the zoom floor.** `camera._coverZoom` becomes the effective minimum zoom. The user cannot zoom out past the point where black bars would appear (by default). A DM toggle can override this floor.

4. **Adds elastic overscroll during drag.** When the user drags past a map boundary, the camera applies logarithmic resistance (Apple's rubber-band formula) that lets the map visibly pull but prevents it from being dragged off-screen. On release, a critically damped spring animates the camera back to the nearest valid position.

5. **Adds edge-pan during token drag.** When dragging a token near a viewport edge, the camera automatically scrolls in that direction. The `EdgePanManager` is a new class in a new file (`vtt/js/edge-pan.js`) that coordinates between `TokenManager` (which owns drag state) and the camera (which owns pan).

Phase 3 does **not** change the `normalizeWheel()` function, the `BoundsCache`, the `KeyboardController`, or the wheel event listener in `attachTo()`. Those all remain as Phase 2 left them. The changes are to the Camera class's internal commit path and the addition of new constraint/animation machinery.

---

## 2. The clamp-on-commit architecture

### The problem with direct state mutation

Phase 2's camera methods modify `this.x`, `this.y`, and `this.zoom` directly, then emit `camera:changed`:

```javascript
// Phase 2's panBy (current):
panBy(dx, dy) {
  this.x -= dx / this.zoom;
  this.y -= dy / this.zoom;
  EventBus.emit('camera:changed');
}

// Phase 2's zoomAt (current):
zoomAt(sx, sy, delta) {
  const worldBefore = this.screenToWorld(sx, sy);
  const newZoom = this.zoom * Math.pow(2, delta);
  this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
  const worldAfter = this.screenToWorld(sx, sy);
  this.x += worldBefore.x - worldAfter.x;
  this.y += worldBefore.y - worldAfter.y;
  EventBus.emit('camera:changed');
}
```

If you add boundary clamping to `panBy()`, you also need to add it to `zoomAt()`, `setPosition()`, `fitCover()`, `fitContain()`, `setViewportSize()`, `deserialize()`, and the mousemove handler in `attachTo()`. That is seven call sites, each with the same clamping logic copy-pasted. Miss one, and you get a constraint bypass bug.

tldraw solves this with a centralized `_setCamera()` method. Mapbox GL JS uses `_constrain()`. Phaser checks bounds in `preRender()`. The pattern is universal because the problem is universal: when multiple input sources can mutate the same state, constraint enforcement belongs in one place.

### The architectural change

Every method that currently ends with `EventBus.emit('camera:changed')` is refactored to call `_applyConstraints()` instead. The `_applyConstraints()` method enforces boundaries, then emits the event. No other code path emits `camera:changed` directly.

The critical addition is the `_isDragging` flag. During an active mouse drag, `_applyConstraints()` applies the elastic rubber-band formula instead of hard clamping. On drag release, `_applyConstraints()` applies the hard clamp and the difference drives the spring snap-back animation. This is how the elastic overscroll integrates cleanly: the constraint system has two modes, and the drag gesture controls which mode is active.

### The new `_applyConstraints()` method

Add this to the Camera class in `vtt/js/map-camera.js`, in the section after the zoom operations and before the pan operations:

```javascript
// -------------------------------------------------------------------
// Constraint enforcement (Phase 3)
// -------------------------------------------------------------------

/**
 * Central constraint enforcement. Called by every method that
 * modifies camera state. Enforces zoom bounds and pan boundaries,
 * then emits camera:changed.
 *
 * During an active drag (_isDragging = true), pan boundaries use
 * elastic rubber-banding instead of hard clamping. This lets the
 * map visibly "pull" past edges without fully escaping. On drag
 * release, hard clamping triggers and the spring snap-back
 * animation covers the difference.
 *
 * The constraint pipeline:
 *   1. Clamp zoom to [minZoom, MAX_ZOOM]
 *   2. If dragging: apply rubber-band to pan position
 *      If not dragging: hard-clamp pan to valid bounds
 *   3. Emit camera:changed if state actually changed
 */
_applyConstraints() {
  const prevX = this.x;
  const prevY = this.y;
  const prevZoom = this.zoom;

  // 1. Zoom bounds
  const effectiveMinZoom = this._getMinZoom();
  this.zoom = Math.max(effectiveMinZoom, Math.min(MAX_ZOOM, this.zoom));

  // 2. Pan boundaries
  if (this.mapW <= 0 || this.mapH <= 0) {
    // No map loaded; skip pan clamping
  } else if (this._isDragging) {
    // Elastic mode: rubber-band past boundaries
    this._applyElasticBounds();
  } else {
    // Hard clamp: enforce strict boundaries
    this._applyHardBounds();
  }

  // 3. Emit only if state actually changed (avoids redundant redraws)
  if (this.x !== prevX || this.y !== prevY || this.zoom !== prevZoom) {
    EventBus.emit('camera:changed');
  }
}
```

### Refactoring every method to route through `_applyConstraints()`

Here is every method that currently emits `camera:changed` directly, shown as OLD → NEW:

**`panBy(dx, dy)`** in `vtt/js/map-camera.js`:

```javascript
// OLD (Phase 2):
panBy(dx, dy) {
  this.x -= dx / this.zoom;
  this.y -= dy / this.zoom;
  EventBus.emit('camera:changed');
}

// NEW (Phase 3):
panBy(dx, dy) {
  this.x -= dx / this.zoom;
  this.y -= dy / this.zoom;
  this._applyConstraints();
}
```

**`zoomAt(sx, sy, delta)`** in `vtt/js/map-camera.js`:

```javascript
// OLD (Phase 2):
zoomAt(sx, sy, delta) {
  const worldBefore = this.screenToWorld(sx, sy);
  const newZoom = this.zoom * Math.pow(2, delta);
  this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
  const worldAfter = this.screenToWorld(sx, sy);
  this.x += worldBefore.x - worldAfter.x;
  this.y += worldBefore.y - worldAfter.y;
  EventBus.emit('camera:changed');
}

// NEW (Phase 3):
zoomAt(sx, sy, delta) {
  // 1. World point under cursor before zoom
  const worldBefore = this.screenToWorld(sx, sy);

  // 2. Compute new zoom (unclamped — _applyConstraints handles bounds)
  this.zoom = this.zoom * Math.pow(2, delta);

  // 3. Recompute pan to preserve cursor anchor BEFORE clamping zoom.
  //    _applyConstraints will clamp zoom, but we need the anchor
  //    adjustment calculated against the unclamped zoom first.
  //    Wait — that's wrong. If we compute the anchor offset using
  //    an unclamped zoom value that _applyConstraints then changes,
  //    the anchor point will drift.
  //
  //    Correct sequence: clamp zoom first, THEN compute anchor offset,
  //    THEN clamp pan. But _applyConstraints clamps zoom and pan
  //    together. So we pre-clamp zoom here:
  const effectiveMinZoom = this._getMinZoom();
  this.zoom = Math.max(effectiveMinZoom, Math.min(MAX_ZOOM, this.zoom));

  // 3. World point under cursor after zoom (same screen position)
  const worldAfter = this.screenToWorld(sx, sy);

  // 4. Adjust camera so the world point stays at the same screen position
  this.x += worldBefore.x - worldAfter.x;
  this.y += worldBefore.y - worldAfter.y;

  // 5. Apply pan constraints (zoom is already clamped, so
  //    _applyConstraints will not modify it again)
  this._applyConstraints();
}
```

Why the zoom pre-clamp is necessary: the four-step algorithm converts the screen cursor position to world coordinates at the old zoom, then again at the new zoom, and adjusts the camera by the difference. If the new zoom is unclamped (say, 0.05 when the floor is 0.3), the world-after conversion produces incorrect coordinates. When `_applyConstraints` then clamps zoom to 0.3, the pan offset was calculated for 0.05, causing the viewport to jump. Pre-clamping zoom ensures the anchor calculation uses the actual final zoom value.

**`zoomToCenter(delta)`** in `vtt/js/map-camera.js`:

```javascript
// OLD (Phase 2):
zoomToCenter(delta) {
  this.zoomAt(this.viewportW / 2, this.viewportH / 2, delta);
}

// NEW (Phase 3): No change needed. It delegates to zoomAt(), which
// now routes through _applyConstraints(). Leave as-is.
```

**`fitCover()`** in `vtt/js/map-camera.js`:

```javascript
// OLD (Phase 2):
fitCover() {
  this.zoom = this._coverZoom;
  this._centerMap();
  EventBus.emit('camera:changed');
}

// NEW (Phase 3):
fitCover() {
  this.zoom = this._coverZoom;
  this._centerMap();
  this._applyConstraints();
}
```

**`fitContain()`** in `vtt/js/map-camera.js`:

```javascript
// OLD (Phase 2):
fitContain() {
  if (this.mapW <= 0 || this.mapH <= 0) return;
  this.zoom = Math.min(
    this.viewportW / this.mapW,
    this.viewportH / this.mapH,
    MAX_ZOOM
  );
  this._centerMap();
  EventBus.emit('camera:changed');
}

// NEW (Phase 3):
fitContain() {
  if (this.mapW <= 0 || this.mapH <= 0) return;
  this.zoom = Math.min(
    this.viewportW / this.mapW,
    this.viewportH / this.mapH,
    MAX_ZOOM
  );
  this._centerMap();
  // Note: fitContain may set zoom below coverZoom (intentionally showing
  // the entire map with black bars). _applyConstraints would clamp it
  // back up to coverZoom. So fitContain bypasses the zoom constraint
  // and only applies pan constraints.
  this._applyHardBounds();
  EventBus.emit('camera:changed');
}
```

Wait. This creates a design tension: `fitContain()` intentionally sets zoom below the cover floor. If `_applyConstraints()` clamps zoom to `coverZoom`, then `fitContain()` is broken. There are two options:

**Option A: fitContain bypasses zoom constraints.** It applies pan constraints directly (centering is already correct) and emits `camera:changed` without routing through `_applyConstraints()`. This is clean but introduces one code path that bypasses the commit point.

**Option B: _applyConstraints accepts a `skipZoomClamp` flag.** This keeps a single commit point but adds conditional logic.

**Recommendation: Option A.** `fitContain()` is a deliberate override of the normal zoom floor. It is the one place where "show black bars on purpose" is the intended behavior. Making it bypass the zoom constraint is semantically correct and avoids flag-creep in `_applyConstraints()`. The same applies to the DM "zoom past cover" toggle (Section 8), which adjusts what `_getMinZoom()` returns rather than bypassing constraints.

```javascript
// NEW (Phase 3) — final version:
fitContain() {
  if (this.mapW <= 0 || this.mapH <= 0) return;
  this.zoom = Math.min(
    this.viewportW / this.mapW,
    this.viewportH / this.mapH,
    MAX_ZOOM
  );
  this._centerMap();
  // Bypass _applyConstraints because fitContain intentionally sets zoom
  // below the cover floor. Pan constraints are satisfied by _centerMap().
  EventBus.emit('camera:changed');
}
```

**`setPosition(x, y, zoom)`** in `vtt/js/map-camera.js`:

```javascript
// OLD (Phase 2):
setPosition(x, y, zoom) {
  this.x = x;
  this.y = y;
  if (zoom !== undefined) this.zoom = zoom;
  EventBus.emit('camera:changed');
}

// NEW (Phase 3):
setPosition(x, y, zoom) {
  this.x = x;
  this.y = y;
  if (zoom !== undefined) this.zoom = zoom;
  this._applyConstraints();
}
```

**`setViewportSize(w, h)`** in `vtt/js/map-camera.js`:

```javascript
// OLD (Phase 2):
setViewportSize(w, h) {
  if (w <= 0 || h <= 0) return;
  const oldCoverZoom = this._coverZoom;
  this.viewportW = w;
  this.viewportH = h;
  this._updateCoverZoom();

  if (oldCoverZoom > 0 && this.zoom <= oldCoverZoom + 0.001) {
    this.zoom = this._coverZoom;
    this._centerMap();
  }

  EventBus.emit('camera:changed');
}

// NEW (Phase 3):
setViewportSize(w, h) {
  if (w <= 0 || h <= 0) return;
  const oldCoverZoom = this._coverZoom;
  this.viewportW = w;
  this.viewportH = h;
  this._updateCoverZoom();

  // If the camera was sitting at the old cover zoom, snap to the new
  // floor and re-center. Otherwise, just enforce the new constraints.
  if (oldCoverZoom > 0 && this.zoom <= oldCoverZoom + 0.001) {
    this.zoom = this._coverZoom;
    this._centerMap();
  }

  this._applyConstraints();
}
```

**`deserialize(data)`** in `vtt/js/map-camera.js`:

```javascript
// OLD (Phase 2):
deserialize(data) {
  if (data.x !== undefined) this.x = data.x;
  if (data.y !== undefined) this.y = data.y;
  if (data.zoom !== undefined) this.zoom = data.zoom;
  if (data.mapW !== undefined && data.mapH !== undefined) {
    this.mapW = data.mapW;
    this.mapH = data.mapH;
    this._updateCoverZoom();
  }
  EventBus.emit('camera:changed');
}

// NEW (Phase 3):
deserialize(data) {
  if (data.x !== undefined) this.x = data.x;
  if (data.y !== undefined) this.y = data.y;
  if (data.zoom !== undefined) this.zoom = data.zoom;
  if (data.mapW !== undefined && data.mapH !== undefined) {
    this.mapW = data.mapW;
    this.mapH = data.mapH;
    this._updateCoverZoom();
  }
  // Constrain deserialized state to this window's bounds.
  // A remote camera might be zoomed to a level below this
  // window's cover zoom, or panned to a position that doesn't
  // make sense for this window's viewport dimensions.
  this._applyConstraints();
}
```

**The mousemove pan handler** inside `attachTo()` in `vtt/js/map-camera.js`:

```javascript
// OLD (Phase 2, inside the window mousemove listener):
this.x = this._panStartCamX - dxScreen / (this.zoom * this.viewportScale);
this.y = this._panStartCamY - dyScreen / (this.zoom * this.viewportScale);
EventBus.emit('camera:changed');

// NEW (Phase 3):
this.x = this._panStartCamX - dxScreen / (this.zoom * this.viewportScale);
this.y = this._panStartCamY - dyScreen / (this.zoom * this.viewportScale);
this._applyConstraints();
```

Because this is inside the mousemove handler during an active drag, `this._isDragging` is true, so `_applyConstraints()` applies elastic rubber-banding instead of hard clamping. The `_isDragging` flag is set/cleared in the mousedown and mouseup handlers (covered in Section 5).

### New constructor properties

Add these to the Camera constructor in `vtt/js/map-camera.js`:

```javascript
// In Camera constructor, after the existing panning state properties:

// Phase 3: constraint state
this._isDragging = false;         // true during active pan drag (for elastic mode)
this._animator = null;            // CameraAnimator instance (created in attachTo)
this._dmCanZoomPastCover = false; // DM toggle: allow zoom below cover zoom
```

### The `_getMinZoom()` helper

Add this to the Camera class, near `_updateCoverZoom()`:

```javascript
/**
 * Return the effective minimum zoom level.
 *
 * By default, this is the cover zoom (no black bars). When the DM
 * toggles "zoom past cover," it drops to the absolute MIN_ZOOM floor.
 */
_getMinZoom() {
  if (this._dmCanZoomPastCover) return MIN_ZOOM;
  return Math.max(MIN_ZOOM, this._coverZoom);
}
```

---

## 3. The dual-regime clamping algorithm

### Why per-axis, and why the transition is seamless

The camera can be in different constraint regimes on each axis simultaneously. Consider a panoramic battle map that is 3000×800 world pixels, viewed through an 800×600 viewport at zoom=0.5. The visible area is 1600×1200. On the X axis, the visible width (1600) is smaller than the map width (3000), so the camera is "zoomed in" horizontally and should be constrained so the map edges do not pull inward. On the Y axis, the visible height (1200) is larger than the map height (800), so the camera is "zoomed out" vertically and the map should be centered.

The `_clampAxis()` function handles both regimes with a single formula. The key insight is that the transition between regimes is mathematically continuous at the crossover point. When the visible size exactly equals the map size, the zoomed-in formula yields `clamp(pos, origin, origin + 0) = origin`, and the zoomed-out formula yields `origin - 0/2 = origin`. Both produce the same result. No interpolation or special-casing is needed.

Leaflet's `_rebound()` function, Phaser's `preRender()` bounds check, and tldraw's `getConstrainedCamera()` all exploit this continuity property. It is one of those cases where the math works out cleaner than you would expect.

### The implementation

Add these private methods to the Camera class in `vtt/js/map-camera.js`, after `_applyConstraints()`:

```javascript
/**
 * Clamp a single axis of the camera position.
 *
 * @param {number} pos - Current camera position on this axis (world coords)
 * @param {number} visSize - Visible world size on this axis (viewportDim / zoom)
 * @param {number} mapSize - Map size on this axis (world pixels)
 * @returns {number} Clamped position
 *
 * Two regimes:
 *   Zoomed in (visSize < mapSize): constrain so edges stay at viewport edges.
 *     pos is clamped to [0, mapSize - visSize].
 *     At pos=0, viewport left/top aligns with map left/top.
 *     At pos=mapSize-visSize, viewport right/bottom aligns with map right/bottom.
 *
 *   Zoomed out (visSize >= mapSize): center the map within the viewport.
 *     pos is set to -(visSize - mapSize) / 2, which is negative.
 *     Negative camera.x means the viewport extends left of the map origin,
 *     showing background color. The map sits centered in the viewport.
 */
_clampAxis(pos, visSize, mapSize) {
  if (visSize >= mapSize) {
    // Zoomed out: center
    return -(visSize - mapSize) / 2;
  }
  // Zoomed in: constrain to [0, mapSize - visSize]
  return Math.max(0, Math.min(mapSize - visSize, pos));
}

/**
 * Apply hard pan boundaries to the current camera state.
 * Modifies this.x and this.y in place.
 */
_applyHardBounds() {
  if (this.mapW <= 0 || this.mapH <= 0) return;

  const visW = this.viewportW / this.zoom;
  const visH = this.viewportH / this.zoom;

  this.x = this._clampAxis(this.x, visW, this.mapW);
  this.y = this._clampAxis(this.y, visH, this.mapH);
}
```

### A worked example

Map: 2400×1600 pixels. Viewport: 1920×1080. Zoom: 1.0.

Visible area: 1920/1 = 1920 wide, 1080/1 = 1080 tall.

X axis: visW (1920) < mapW (2400). Zoomed-in regime. Pan range: [0, 2400-1920] = [0, 480]. If the camera tries to pan to x=-50, it snaps to 0. If it pans to x=500, it snaps to 480. The map's left edge never goes right of the viewport's left edge, and the map's right edge never goes left of the viewport's right edge.

Y axis: visH (1080) < mapH (1600). Also zoomed-in. Pan range: [0, 1600-1080] = [0, 520].

Now resize the viewport to 3000×1200 at the same zoom=1.0:

X axis: visW (3000) >= mapW (2400). Zoomed-out regime. Camera x = -(3000-2400)/2 = -300. The viewport extends 300px left of the map, showing background color. The map is centered.

Y axis: visH (1200) < mapH (1600). Still zoomed-in. Pan range: [0, 400].

This is the mixed-regime case. The map is centered horizontally (black bars on left/right, or rather background color) but constrained vertically.

### Why the map origin is always 0

You might notice that `_clampAxis()` assumes the map starts at world coordinate 0. This is correct for the VTT because `MapRenderer.loadMap()` draws the map image at `ctx.drawImage(img, 0, 0, w, h)`, meaning the map's top-left corner is always at world (0, 0). If future maps support arbitrary world-space origins (e.g., placing a map at world position 500, 300), the clamp bounds would change from `[0, mapSize - visSize]` to `[mapOrigin, mapOrigin + mapSize - visSize]`. The `_clampAxis()` signature already supports this by treating 0 as the implicit origin.

---

## 4. Zoom floor enforcement and cursor-anchor preservation

### The zoom floor: coverZoom as the default minimum

Phase 1 introduced `_coverZoom = Math.max(viewportW / mapW, viewportH / mapH)` as a calculated property, but Phase 1 and Phase 2 did not enforce it as a minimum. The static `MIN_ZOOM = 0.1` was the only floor, meaning users could zoom out far enough to see the entire map as a tiny rectangle surrounded by background color.

Phase 3 promotes `_coverZoom` to the effective zoom floor via `_getMinZoom()` (defined in Section 2). Every call to `_applyConstraints()` enforces `this.zoom = Math.max(this._getMinZoom(), ...)`, which means the user cannot zoom out past the point where the map fills the viewport. No black bars, no exposed background color.

The `_coverZoom` is recalculated automatically when the viewport resizes (`setViewportSize()`) or a new map loads (`setMapSize()`). Because `_getMinZoom()` is called inside `_applyConstraints()`, which runs on every camera mutation, the floor is always current. No stale-floor bugs.

### The cursor-anchor ordering problem

The interaction between zoom clamping and the zoom-at-cursor algorithm requires careful ordering. The four-step algorithm in `zoomAt()` is:

1. Convert screen cursor to world coords at old zoom
2. Apply new zoom
3. Convert same screen cursor to world coords at new zoom
4. Adjust camera position by the difference

If step 2 sets an unclamped zoom (say 0.05 when the floor is 0.3) and step 3 uses that unclamped value, the world-after conversion produces coordinates that assume zoom=0.05. When `_applyConstraints()` later clamps zoom to 0.3, the pan offset from step 4 was calculated for the wrong zoom level, causing the viewport to jump away from the cursor anchor point.

The solution, already shown in the refactored `zoomAt()` in Section 2: **pre-clamp zoom before the anchor calculation**. Steps 2 and 3 use the clamped zoom, so the pan offset is correct. `_applyConstraints()` then clamps pan (the zoom is already at the floor, so it is a no-op for the zoom clamp). The cursor stays anchored.

```javascript
// This is the relevant section of the refactored zoomAt() from Section 2.
// Repeating here for the zoom-floor context.

zoomAt(sx, sy, delta) {
  const worldBefore = this.screenToWorld(sx, sy);

  // Pre-clamp zoom BEFORE anchor calculation
  const effectiveMinZoom = this._getMinZoom();
  this.zoom = Math.max(effectiveMinZoom, Math.min(MAX_ZOOM,
    this.zoom * Math.pow(2, delta)
  ));

  const worldAfter = this.screenToWorld(sx, sy);
  this.x += worldBefore.x - worldAfter.x;
  this.y += worldBefore.y - worldAfter.y;

  this._applyConstraints();
}
```

Once zoom is at the floor, further scroll-down events compute `Math.pow(2, negative_delta) * coverZoom`, which is less than `coverZoom`. The pre-clamp snaps it back to `coverZoom`, the before/after world points are identical (zoom did not change), the pan offset is zero, and nothing moves. The user experiences a natural "bottomed out" stop with no jitter.

### When coverZoom changes on window resize

The `setViewportSize()` refactoring in Section 2 already handles this: it recalculates `_coverZoom`, and if the camera was at the old floor, snaps to the new floor and re-centers. The `_applyConstraints()` call at the end enforces the new constraints for all other cases (camera was zoomed in beyond the old floor but the new floor is higher due to a smaller viewport).

No animation is needed on resize. The window resize itself is a discontinuous visual event (content reflows, DOM layout changes), so a smooth camera transition would look odd. Instant adjustment is the standard behavior in mapping apps, photo viewers, and design tools.

---

## 5. Elastic overscroll with Apple's rubber-band formula

### Why elastic overscroll matters for a DM tool

Hard boundaries (the map simply stops at the edge) work, but they feel stiff. The DM is dragging the map to show players a room, hits the edge, and the map refuses to move. There is no visual feedback explaining why. Did the input break? Did the mouse slip?

Elastic overscroll solves this: the map continues to move past the edge, but with increasing resistance. The DM sees the background color starting to appear and instinctively releases. The map springs back. The interaction communicates "you've reached the edge" through physics rather than a sudden stop.

This is not a gimmick. Apple's rubber-band scroll is the single most recognizable tactile interaction in consumer software. It was patented in 2012 (US Patent 7,469,381, now expired) and is the default in iOS, macOS, and adopted by every major design tool. Users expect it.

### Apple's rubber-band formula

The formula creates diminishing returns: the first pixels of overdrag move almost freely, and each additional pixel of drag moves the map less. The output asymptotes to the viewport dimension, meaning the map can never be dragged fully off-screen.

```javascript
/**
 * Apple's rubber-band resistance formula.
 *
 * @param {number} distance - How far past the boundary (always positive)
 * @param {number} dimension - Viewport size on this axis (the "rubber-band length")
 * @param {number} c - Resistance coefficient (0.55 = iOS default)
 * @returns {number} Diminished offset (always < dimension)
 *
 * Properties:
 *   f(0) = 0                    — no offset at the boundary
 *   f'(0) = c = 0.55            — initial slope (55% of drag distance)
 *   lim(x→∞) = dimension        — cannot exceed viewport size
 *   f(100) ≈ 52 (for dim=960)   — ~48% resistance at 100px overdrag
 */
function rubberBand(distance, dimension, c = 0.55) {
  return (distance * dimension * c) / (dimension + c * distance);
}
```

Place this as a module-level function in `vtt/js/map-camera.js`, after the constants and before the `BoundsCache` class.

### Integrating rubber-banding into the constraint pipeline

The `_applyElasticBounds()` method is the elastic counterpart to `_applyHardBounds()`. During a drag, `_applyConstraints()` calls this instead of the hard clamp:

```javascript
/**
 * Apply elastic (rubber-band) boundaries during an active drag.
 * Instead of hard-clamping, the position is allowed past boundaries
 * but with logarithmic resistance.
 *
 * The unclamped position is the raw result of the pan calculation.
 * The clamped position is what _applyHardBounds would produce.
 * The difference (overshoot) is run through rubberBand() to produce
 * a diminished offset that gets added back to the boundary edge.
 */
_applyElasticBounds() {
  if (this.mapW <= 0 || this.mapH <= 0) return;

  const visW = this.viewportW / this.zoom;
  const visH = this.viewportH / this.zoom;

  this.x = this._elasticClampAxis(this.x, visW, this.mapW, this.viewportW);
  this.y = this._elasticClampAxis(this.y, visH, this.mapH, this.viewportH);
}

/**
 * Elastic clamp for a single axis.
 *
 * @param {number} pos - Current camera position (world coords, unclamped)
 * @param {number} visSize - Visible world size on this axis
 * @param {number} mapSize - Map dimension on this axis
 * @param {number} vpDim - Viewport dimension on this axis (for rubber-band scaling)
 * @returns {number} Elastically constrained position
 */
_elasticClampAxis(pos, visSize, mapSize, vpDim) {
  if (visSize >= mapSize) {
    // Zoomed-out regime: center is the target. Apply rubber-band
    // around the center position.
    const center = -(visSize - mapSize) / 2;
    const overshoot = pos - center;
    if (Math.abs(overshoot) < 0.5) return center;
    // Convert world-space overshoot to screen pixels for rubber-band,
    // then convert back. This ensures the rubber-band feel is consistent
    // regardless of zoom level.
    const screenOvershoot = overshoot * this.zoom;
    const dampened = rubberBand(Math.abs(screenOvershoot), vpDim);
    return center + Math.sign(overshoot) * dampened / this.zoom;
  }

  // Zoomed-in regime: clamp range is [0, mapSize - visSize]
  const min = 0;
  const max = mapSize - visSize;

  if (pos < min) {
    const screenOvershoot = (min - pos) * this.zoom;
    const dampened = rubberBand(screenOvershoot, vpDim);
    return min - dampened / this.zoom;
  }
  if (pos > max) {
    const screenOvershoot = (pos - max) * this.zoom;
    const dampened = rubberBand(screenOvershoot, vpDim);
    return max + dampened / this.zoom;
  }

  return pos;
}
```

The screen-space conversion (`* this.zoom` and `/ this.zoom`) ensures that the rubber-band resistance feels the same at all zoom levels. Without it, zooming in would make the rubber band feel stiffer (because a small world-space overshoot corresponds to many screen pixels), and zooming out would make it feel loose.

### Setting `_isDragging` in the mouse handlers

The `_isDragging` flag controls whether `_applyConstraints()` uses elastic or hard mode. It must be set when a pan drag starts and cleared when it ends. Modify the existing mouse handlers in `attachTo()`:

In `_startPan()`:

```javascript
// OLD (Phase 2):
_startPan(e, button) {
  this._panning = true;
  this._pendingPan = false;
  this._panButton = button;
  this._panStartX = e.clientX;
  this._panStartY = e.clientY;
  this._panStartCamX = this.x;
  this._panStartCamY = this.y;
  this._panScreenDist = 0;
  this._setPanCursor(true);
}

// NEW (Phase 3):
_startPan(e, button) {
  this._panning = true;
  this._pendingPan = false;
  this._panButton = button;
  this._panStartX = e.clientX;
  this._panStartY = e.clientY;
  this._panStartCamX = this.x;
  this._panStartCamY = this.y;
  this._panScreenDist = 0;
  this._isDragging = true;
  // Cancel any in-progress snap-back animation. The user has grabbed
  // the map again, so the spring should stop immediately.
  if (this._animator) this._animator.cancel();
  this._setPanCursor(true);
}
```

In `_commitPan()`:

```javascript
// OLD (Phase 2):
_commitPan() {
  this._panning = true;
  this._pendingPan = false;
  this._panButton = 0;
  this._setPanCursor(true);
}

// NEW (Phase 3):
_commitPan() {
  this._panning = true;
  this._pendingPan = false;
  this._panButton = 0;
  this._isDragging = true;
  if (this._animator) this._animator.cancel();
  this._setPanCursor(true);
}
```

In `_cancelPan()`:

```javascript
// OLD (Phase 2):
_cancelPan() {
  this._panning = false;
  this._pendingPan = false;
  this._panButton = -1;
  this._setPanCursor(false);
}

// NEW (Phase 3):
_cancelPan() {
  this._panning = false;
  this._pendingPan = false;
  this._panButton = -1;
  this._isDragging = false;
  this._setPanCursor(false);
  // Snap to hard bounds (in case drag was cancelled while past boundary)
  this._triggerSnapBack();
}
```

In the mouseup handler inside `attachTo()`:

```javascript
// OLD (Phase 2):
window.addEventListener('mouseup', (e) => {
  this._pendingPan = false;
  if (!this._panning || e.button !== this._panButton) return;
  this._panning = false;
  this._panButton = -1;
  if (this._el) {
    this._el.classList.remove('panning');
    this._el.style.cursor = this.spaceHeld ? 'grab' : '';
  }
});

// NEW (Phase 3):
window.addEventListener('mouseup', (e) => {
  this._pendingPan = false;
  if (!this._panning || e.button !== this._panButton) return;
  this._panning = false;
  this._panButton = -1;
  this._isDragging = false;
  if (this._el) {
    this._el.classList.remove('panning');
    this._el.style.cursor = this.spaceHeld ? 'grab' : '';
  }
  // If the camera is past boundaries (elastic overscroll was active),
  // trigger spring snap-back to the nearest valid position.
  this._triggerSnapBack();
});
```

### The `_triggerSnapBack()` method

This method checks if the camera is outside hard bounds, and if so, starts the spring animation:

```javascript
/**
 * If the camera is currently past hard boundaries (elastic overscroll
 * was active during a drag), start the spring snap-back animation
 * to the nearest valid position.
 *
 * If the camera is already within bounds, this is a no-op.
 */
_triggerSnapBack() {
  if (this.mapW <= 0 || this.mapH <= 0) return;
  if (!this._animator) return;

  const visW = this.viewportW / this.zoom;
  const visH = this.viewportH / this.zoom;

  const targetX = this._clampAxis(this.x, visW, this.mapW);
  const targetY = this._clampAxis(this.y, visH, this.mapH);

  const dx = Math.abs(this.x - targetX);
  const dy = Math.abs(this.y - targetY);

  // Only animate if there is meaningful displacement (> 0.5 world px)
  if (dx < 0.5 && dy < 0.5) return;

  this._animator.snapBack(
    { x: this.x, y: this.y },
    { x: targetX, y: targetY }
  );
}
```

---

## 6. Critically damped spring snap-back animation

### Why a spring, not exponential decay

When the user releases a drag past the boundary, the camera must animate back to the nearest valid position. The two candidates are:

**Exponential decay** (`value += (target - value) * (1 - exp(-speed * dt))`). Simpler. No overshoot. But it cannot accept an initial velocity. The transition from "user dragging at some speed" to "animating back" has a visual discontinuity: velocity drops to zero instantly, then the camera drifts back slowly. This looks like a stutter.

**Critically damped spring** (damping ratio ζ = 1). Has a closed-form solution. Returns to equilibrium faster than any other damping ratio without overshooting. Can accept an initial velocity, matching the user's drag velocity at release for seamless continuity.

For the VTT, we do not currently track drag velocity (that belongs to Phase 5's momentum panning feature), so the initial velocity is 0. Even without velocity continuity, the critically damped spring has a more natural deceleration curve than exponential decay: it starts fast and slows gradually, rather than the exponential's gradual-start-then-sudden-stop feel. The spring also provides a natural upgrade path: when Phase 5 adds velocity tracking, feeding `releaseVelocity` into the spring is a one-line change.

### The `CameraAnimator` class

Create this as a new section within `vtt/js/map-camera.js`, after the `rubberBand()` function and before the `BoundsCache` class. It is not a separate file because it is tightly coupled to the Camera's internal state and the `camera:changed` event pipeline.

```javascript
// ============================================
// Camera Animator — Critically Damped Spring Snap-Back
// ============================================
//
// Self-scheduling rAF loop that animates the camera back to a
// target position using a critically damped spring. Runs only
// during active animation; stops when settled.
//
// The closed-form solution eliminates Euler integration drift:
//   x(t) = target + (A + B*t) * e^(-ω*t)
//   where A = displacement, B = velocity + ω * displacement
//
// This is frame-rate independent by construction. Whether the
// browser runs at 30fps or 144fps, the position at time t is
// the same. No dt accumulation, no spiral-of-death after tab switch.

const SPRING_STIFFNESS = 200;   // Higher = snappier. 200 settles in ~0.3s
const SPRING_MASS = 1;          // Keep at 1; tune via stiffness only
const SPRING_OMEGA = Math.sqrt(SPRING_STIFFNESS / SPRING_MASS); // ≈ 14.14
const SETTLE_THRESHOLD_PX = 0.5;  // Position threshold to stop animation
const SETTLE_THRESHOLD_VEL = 0.5; // Velocity threshold (world px/s)

class CameraAnimator {
  constructor(camera) {
    this._camera = camera;
    this._rafId = null;
    this._startTime = null;

    // Per-axis spring parameters (set by snapBack)
    this._springX = null;  // { displacement, velocity, target }
    this._springY = null;

    this._tick = this._tick.bind(this);
  }

  /**
   * Start a snap-back animation from the current position to a target.
   *
   * @param {{ x: number, y: number }} current - Current camera position
   * @param {{ x: number, y: number }} target - Target (clamped) position
   * @param {{ vx: number, vy: number }} velocity - Release velocity (Phase 5; 0 for now)
   */
  snapBack(current, target, velocity = { vx: 0, vy: 0 }) {
    const dx = current.x - target.x;
    const dy = current.y - target.y;

    // Don't animate trivial displacements
    if (Math.abs(dx) < SETTLE_THRESHOLD_PX && Math.abs(dy) < SETTLE_THRESHOLD_PX) {
      this._camera.x = target.x;
      this._camera.y = target.y;
      this._camera._applyHardBounds();
      EventBus.emit('camera:changed');
      return;
    }

    this._springX = {
      displacement: dx,
      velocity: velocity.vx || 0,
      target: target.x
    };
    this._springY = {
      displacement: dy,
      velocity: velocity.vy || 0,
      target: target.y
    };

    this._startTime = null;

    if (!this._rafId) {
      this._rafId = requestAnimationFrame(this._tick);
    }
  }

  /**
   * Solve the critically damped spring at elapsed time t.
   *
   * Closed-form solution for ζ=1 (critical damping):
   *   x(t) = (A + B*t) * e^(-ω*t)
   *   v(t) = (B - ω*(A + B*t)) * e^(-ω*t)
   *
   * where A = initial displacement, B = initial velocity + ω * A
   *
   * Returns the offset from target (not the absolute position).
   */
  _solveSpring(displacement, velocity, t) {
    const A = displacement;
    const B = velocity + SPRING_OMEGA * displacement;
    const exp = Math.exp(-SPRING_OMEGA * t);
    return {
      position: (A + B * t) * exp,
      velocity: (B - SPRING_OMEGA * (A + B * t)) * exp
    };
  }

  _tick(timestamp) {
    if (!this._startTime) this._startTime = timestamp;
    const elapsed = (timestamp - this._startTime) / 1000; // seconds

    // Cap elapsed to prevent massive jump after tab was backgrounded.
    // With the closed-form solution, a large t just evaluates to ~0,
    // so this cap is more of a safety net than a necessity.
    const t = Math.min(elapsed, 2.0);

    let settled = true;

    if (this._springX) {
      const { position, velocity } = this._solveSpring(
        this._springX.displacement, this._springX.velocity, t
      );
      if (Math.abs(position) > SETTLE_THRESHOLD_PX ||
          Math.abs(velocity) > SETTLE_THRESHOLD_VEL) {
        this._camera.x = this._springX.target + position;
        settled = false;
      } else {
        this._camera.x = this._springX.target;
      }
    }

    if (this._springY) {
      const { position, velocity } = this._solveSpring(
        this._springY.displacement, this._springY.velocity, t
      );
      if (Math.abs(position) > SETTLE_THRESHOLD_PX ||
          Math.abs(velocity) > SETTLE_THRESHOLD_VEL) {
        this._camera.y = this._springY.target + position;
        settled = false;
      } else {
        this._camera.y = this._springY.target;
      }
    }

    // Emit camera:changed directly (bypassing _applyConstraints because
    // the target is already the constrained position and we are animating
    // toward it; re-clamping mid-animation would fight the spring).
    EventBus.emit('camera:changed');

    if (settled) {
      this._stop();
    } else {
      this._rafId = requestAnimationFrame(this._tick);
    }
  }

  /** Cancel any in-progress animation immediately. */
  cancel() {
    this._stop();
  }

  _stop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._startTime = null;
    this._springX = null;
    this._springY = null;
  }
}
```

### Wiring the animator into the Camera

In `attachTo()`, after `this._keyboard.attach()`:

```javascript
// OLD (Phase 2): nothing here

// NEW (Phase 3):
this._animator = new CameraAnimator(this);
```

### Why the animator emits `camera:changed` directly

The animator bypasses `_applyConstraints()` because its target position is already the clamped position (computed by `_triggerSnapBack()`). If the animation ticks went through `_applyConstraints()`, the hard-clamp path would fight the spring: the spring wants to show the camera slightly past bounds during its natural deceleration approach, but the hard clamp would snap it to the boundary immediately, making the animation look choppy.

The bypass is safe because a critically damped spring (ζ=1) approaches the target monotonically from one side, never crossing it. With zero initial velocity (Phase 3), displacement strictly decreases toward zero. Phase 5 will add release velocity, which can temporarily increase displacement before convergence, but the position always remains on the same side of the target.

---

## 7. Edge-pan during token drag

### The problem

The DM drags a token toward the edge of the viewport. The token needs to be placed on a grid cell that is currently off-screen. Without edge-pan, the DM has to drop the token, pan the camera, pick the token back up, and continue dragging. This is clumsy, especially during combat.

Edge-pan solves this: when the cursor enters a "hot zone" near the viewport edge during a token drag, the camera automatically scrolls in that direction. The DM keeps dragging, the map scrolls underneath, and the token lands where intended.

### Why this is a new file

The `EdgePanManager` coordinates between two modules that do not otherwise know about each other: `TokenManager` (which knows when a drag is active) and `Camera` (which handles panning). Putting it in either module creates a circular dependency or an awkward coupling. A standalone `vtt/js/edge-pan.js` file keeps the dependency graph clean: `TokenManager` → `EdgePanManager` → `Camera`.

### The implementation

Create `vtt/js/edge-pan.js`:

```javascript
// ============================================
// Edge Pan Manager — Auto-scroll during token drag
// ============================================
//
// When a token is being dragged near a viewport edge, the camera
// auto-scrolls in that direction. The TokenManager calls startTracking()
// on drag start, updateCursor() on each pointer move, and
// stopTracking() on pointer up.
//
// Architecture:
//   TokenManager owns the drag lifecycle (mousedown → mousemove → mouseup).
//   EdgePanManager owns the auto-scroll rAF loop.
//   Camera.panBy() handles the actual pan (including boundary clamping).
//
//   TokenManager → EdgePanManager.updateCursor() → Camera.panBy()
//
// The camera's centralized clamping (_applyConstraints) ensures the
// edge-pan automatically stops at map boundaries. No boundary logic
// is needed here.

const HOT_ZONE_PX = 60;         // Edge zone width in CSS pixels
const HOT_ZONE_MIN_FRAC = 0.05; // Minimum zone: 5% of viewport dimension
const MAX_SPEED = 1000;          // Maximum pan speed in screen pixels per second
const START_DELAY_MS = 150;      // Delay before edge-pan activates (prevents false triggers)

export class EdgePanManager {
  /**
   * @param {Camera} camera - The camera instance to pan
   */
  constructor(camera) {
    this._camera = camera;
    this._tracking = false;
    this._cursorX = 0;            // Last known cursor position (screen pixels)
    this._cursorY = 0;
    this._rafId = null;
    this._lastTimestamp = 0;
    this._activeSince = 0;        // Timestamp when cursor first entered hot zone
    this._inHotZone = false;

    this._tick = this._tick.bind(this);
  }

  /**
   * Begin tracking cursor position for edge-pan.
   * Called by TokenManager when a token drag starts.
   */
  startTracking() {
    this._tracking = true;
    this._inHotZone = false;
    this._activeSince = 0;
  }

  /**
   * Update the cursor position during an active drag.
   * Called by TokenManager on every pointer move.
   *
   * @param {number} screenX - Cursor X in screen/CSS pixels relative to viewport
   * @param {number} screenY - Cursor Y in screen/CSS pixels relative to viewport
   */
  updateCursor(screenX, screenY) {
    if (!this._tracking) return;
    this._cursorX = screenX;
    this._cursorY = screenY;

    // Start the rAF loop if not already running
    if (!this._rafId) {
      this._lastTimestamp = performance.now();
      this._rafId = requestAnimationFrame(this._tick);
    }
  }

  /**
   * Stop tracking. Called by TokenManager on drag end.
   */
  stopTracking() {
    this._tracking = false;
    this._inHotZone = false;
    this._activeSince = 0;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /**
   * Compute the hot zone width for an axis.
   * Uses the larger of HOT_ZONE_PX and HOT_ZONE_MIN_FRAC * viewport dimension.
   */
  _zoneWidth(vpDim) {
    return Math.max(HOT_ZONE_PX, vpDim * HOT_ZONE_MIN_FRAC);
  }

  /**
   * Compute pan velocity for one axis.
   *
   * Returns a value in [-MAX_SPEED, MAX_SPEED] screen pixels per second.
   * Negative = pan left/up, positive = pan right/down.
   *
   * Uses quadratic acceleration: slow start near zone boundary,
   * fast ramp near viewport edge. This prevents accidental triggers
   * while enabling fast panning when clearly intentional.
   *
   * @param {number} cursor - Cursor position on this axis
   * @param {number} vpDim - Viewport dimension on this axis
   * @returns {number} Pan velocity in screen px/s
   */
  _axisVelocity(cursor, vpDim) {
    const zone = this._zoneWidth(vpDim);

    // Near the left/top edge
    if (cursor < zone) {
      const penetration = zone - cursor;
      const t = Math.min(1, penetration / zone); // 0 at boundary, 1 at edge
      return -MAX_SPEED * t * t; // Quadratic: slow → fast
    }

    // Near the right/bottom edge
    if (cursor > vpDim - zone) {
      const penetration = cursor - (vpDim - zone);
      const t = Math.min(1, penetration / zone);
      return MAX_SPEED * t * t;
    }

    return 0;
  }

  _tick(timestamp) {
    if (!this._tracking) {
      this._rafId = null;
      return;
    }

    const dt = Math.min((timestamp - this._lastTimestamp) / 1000, 0.1);
    this._lastTimestamp = timestamp;

    const vpW = this._camera.viewportW;
    const vpH = this._camera.viewportH;

    const vx = this._axisVelocity(this._cursorX, vpW);
    const vy = this._axisVelocity(this._cursorY, vpH);

    const inZone = vx !== 0 || vy !== 0;

    if (inZone && !this._inHotZone) {
      // Cursor just entered hot zone — start delay timer
      this._inHotZone = true;
      this._activeSince = timestamp;
    } else if (!inZone) {
      this._inHotZone = false;
      this._activeSince = 0;
    }

    // Only pan after the start delay has elapsed
    if (inZone && this._activeSince > 0 &&
        (timestamp - this._activeSince) >= START_DELAY_MS) {
      // panBy expects "drag direction" deltas in screen pixels.
      // Edge-pan velocity is already in screen px/s, so multiply by dt.
      //
      // The sign convention: positive vx means "scroll right" = camera
      // moves right in world space. panBy interprets positive dx as
      // "user dragged right" which SUBTRACTS from camera.x. So we
      // negate the velocity to get the correct panBy delta.
      const dx = -vx * dt;
      const dy = -vy * dt;
      this._camera.panBy(dx, dy);
    }

    this._rafId = requestAnimationFrame(this._tick);
  }
}
```

### Integrating with TokenManager

The `TokenManager` in `vtt/js/token-manager.js` needs three changes: create the `EdgePanManager`, call `startTracking()` on drag start, `updateCursor()` on drag move, and `stopTracking()` on drag end.

**Import and construction** in `vtt/js/token-manager.js`:

```javascript
// OLD (Phase 2, at top of file):
import { EventBus, state } from './state.js';
import { TOKENS, MAP_PRESETS, CONDITIONS, CONDITION_COLORS } from './data.js';
import { resolveCSSVar } from './utils.js';

// NEW (Phase 3):
import { EventBus, state } from './state.js';
import { TOKENS, MAP_PRESETS, CONDITIONS, CONDITION_COLORS } from './data.js';
import { resolveCSSVar } from './utils.js';
import { EdgePanManager } from './edge-pan.js';
```

In the `TokenManager` constructor:

```javascript
// OLD (Phase 2, in constructor):
this._nextId = 1;

// NEW (Phase 3, add after _nextId):
this._nextId = 1;
this._edgePan = null;  // Initialized in init() after camera is available
```

In `TokenManager.init()`, after the canvas and event setup:

```javascript
// OLD (Phase 2): nothing here

// NEW (Phase 3, at the end of init()):
this._edgePan = new EdgePanManager(this.map.camera);
```

**`onMouseDown(e)`** in `vtt/js/token-manager.js`:

The drag starts when a token is clicked. The existing code sets `this._dragging = token`. Add `startTracking()` right after:

```javascript
// In onMouseDown, at the point where _dragging is set:

// OLD (Phase 2):
this._dragging = token;
this._dragScreenX = sx;
this._dragScreenY = sy;
$('map-container').classList.add('dragging-token');

// NEW (Phase 3):
this._dragging = token;
this._dragScreenX = sx;
this._dragScreenY = sy;
$('map-container').classList.add('dragging-token');
if (this._edgePan) this._edgePan.startTracking();
```

**`onMouseMove(e)`** in `vtt/js/token-manager.js`:

During drag, update the edge-pan cursor position:

```javascript
// In onMouseMove, in the _dragging branch:

// OLD (Phase 2):
if (!this._dragging) return;
const { x, y } = this._screenCoords(e);
this._dragScreenX = x;
this._dragScreenY = y;
this.draw();

// NEW (Phase 3):
if (!this._dragging) return;
const { x, y } = this._screenCoords(e);
this._dragScreenX = x;
this._dragScreenY = y;
if (this._edgePan) this._edgePan.updateCursor(x, y);
this.draw();
```

**`onMouseUp(e)`** in `vtt/js/token-manager.js`:

Stop edge-pan tracking when the drag ends:

```javascript
// In onMouseUp:

// OLD (Phase 2):
if (!this._dragging) return;
const world = this.map.camera.screenToWorld(this._dragScreenX, this._dragScreenY);
this._dragging.col = Math.floor(world.x / this.map.cellPx);
this._dragging.row = Math.floor(world.y / this.map.cellPx);
this._dragging = null;
$('map-container').classList.remove('dragging-token');
this._redraw();

// NEW (Phase 3):
if (!this._dragging) return;
if (this._edgePan) this._edgePan.stopTracking();
const world = this.map.camera.screenToWorld(this._dragScreenX, this._dragScreenY);
this._dragging.col = Math.floor(world.x / this.map.cellPx);
this._dragging.row = Math.floor(world.y / this.map.cellPx);
this._dragging = null;
$('map-container').classList.remove('dragging-token');
this._redraw();
```

### Why edge-pan and boundary clamping work together automatically

The `EdgePanManager` calls `camera.panBy()`. `panBy()` now routes through `_applyConstraints()`. `_applyConstraints()` applies hard bounds (edge-pan is not a drag, so `_isDragging` is false). When the pan hits the map boundary, `_clampAxis()` pins the position, and the camera stops moving despite the edge-pan velocity continuing. If the user drags the cursor back out of the hot zone, the velocity drops to zero and the rAF loop idles. No boundary-specific logic is needed in `EdgePanManager`.

---

## 8. DM "zoom past cover" toggle

### The feature

By default, the cover zoom is the zoom floor: the DM cannot zoom out past the point where the map fills the viewport. Some DMs want to show the entire map with background color visible (to give players an overview, or because the map art has intentional borders). The "zoom past cover" toggle unlocks the lower zoom range.

### The implementation

The `_dmCanZoomPastCover` flag is already defined in the constructor (Section 2). The `_getMinZoom()` method already reads it. The only remaining piece is the EventBus integration to toggle it.

Add this handler in `attachTo()`, after the keyboard controller attachment:

```javascript
// In attachTo(), after this._keyboard.attach():

// DM toggle: zoom past cover
EventBus.on('camera:zoom-past-cover', (enabled) => {
  this._dmCanZoomPastCover = enabled;

  if (!enabled && this.zoom < this._coverZoom) {
    // DM turned off "zoom past cover" while zoomed out past cover.
    // Animate back to cover zoom and center.
    //
    // Calculate the target state: cover zoom, centered.
    const targetZoom = this._coverZoom;
    const visW = this.viewportW / targetZoom;
    const visH = this.viewportH / targetZoom;
    const targetX = (this.mapW - visW) / 2;
    const targetY = (this.mapH - visH) / 2;

    // For now, snap instantly. Phase 5 adds animated zoom transitions.
    this.zoom = targetZoom;
    this.x = targetX;
    this.y = targetY;
    this._applyConstraints();
  }
});
```

### Adding the Controller button

The Controller app needs a button to send this toggle. In `shared/protocol.js`:

```javascript
// In the MSG object, add:
CAMERA_ZOOM_PAST_COVER: 'camera:zoom-past-cover',

// In REQUIRED_FIELDS, add:
[MSG.CAMERA_ZOOM_PAST_COVER]: ['enabled'],

// Add factory function:
export const createCameraZoomPastCoverMsg = (enabled) =>
  msg(MSG.CAMERA_ZOOM_PAST_COVER, { enabled });
```

In `vtt/js/state.js`, add the handler in `handleSyncMessage()`:

```javascript
// In the switch statement, add before the default case:
case MSG.CAMERA_ZOOM_PAST_COVER:
  EventBus.emit('camera:zoom-past-cover', msg.enabled);
  break;
```

---

## 9. BroadcastChannel protocol implications

### Existing messages: no changes needed

The existing camera messages (`CAMERA_ZOOM`, `CAMERA_PAN`, `CAMERA_RESET`) continue to work as-is. `CAMERA_ZOOM` sends a `direction`, which gets translated to `camera.zoomToCenter(direction > 0 ? ZOOM_STEP_KEY : -ZOOM_STEP_KEY)` at the boundary, and `zoomToCenter()` calls `zoomAt()`, which now routes through `_applyConstraints()`. Constraints are automatically applied.

`CAMERA_PAN` sends `{ dx, dy }` and calls `camera.panBy()`, which routes through `_applyConstraints()`. Boundary clamping is applied.

`CAMERA_RESET` calls `camera.fitCover()`, which now calls `_applyConstraints()`.

### New message: `CAMERA_ZOOM_PAST_COVER`

One new message type (Section 8). The protocol version does not need to bump because existing apps ignore unknown message types gracefully (the `default` case in `handleSyncMessage()` logs a warning but does not error).

### Serialized camera state: constraints applied on deserialize

`camera.deserialize()` now routes through `_applyConstraints()`, which means a remote camera state that is outside this window's bounds gets constrained on receipt. This is correct: different windows have different viewports, so a camera position valid for one window might show black bars in another.

### Phase 4's continuous sync

Phase 4 will add 30fps continuous camera sync across windows. That sync will use `serialize()`/`deserialize()`. Because `deserialize()` applies constraints, the receiving window's boundaries are always respected, regardless of what the sending window's zoom floor is. This is the behavior Phase 4 needs, and Phase 3 delivers it without further work.

---

## 10. CSS changes

Phase 3 requires no CSS changes.

The elastic overscroll and spring animation are applied to the canvas drawing via the camera transform, not to DOM elements. Edge-pan is handled via JavaScript pan operations. The constraint system is pure math on camera state.

The existing `cursor: grab/grabbing` styles from Phase 1 handle the visual feedback for pan dragging. The existing `.dragging-token` class from TokenManager handles the token drag cursor. No additional visual indicators are needed for boundary feedback (the elastic overscroll itself is the visual indicator, as discussed in the research appendix).

---

## 11. Testing protocols

### Unit tests: camera clamping

These tests verify the core clamping logic. Create or add to `tests/camera-clamp.test.js`:

```javascript
import { describe, it, expect } from 'vitest';

// Since _clampAxis is a private method, test it through the Camera's
// public API by setting state and calling _applyHardBounds.
// Alternatively, extract _clampAxis as a module-level function and
// export it for testing. The implementation in Section 3 already
// defines it as a method, so we test via the Camera.

// For direct testing, extract as a standalone function:
function clampAxis(pos, visSize, mapSize) {
  if (visSize >= mapSize) return -(visSize - mapSize) / 2;
  return Math.max(0, Math.min(mapSize - visSize, pos));
}

describe('clampAxis', () => {
  it('zoomed-in: clamps to [0, mapSize - visSize]', () => {
    // Map: 2000px, visible: 800px → pan range [0, 1200]
    expect(clampAxis(-50, 800, 2000)).toBe(0);      // below min
    expect(clampAxis(600, 800, 2000)).toBe(600);     // within range
    expect(clampAxis(1300, 800, 2000)).toBe(1200);   // above max
  });

  it('zoomed-out: centers the map', () => {
    // Map: 800px, visible: 1200px → center at -(1200-800)/2 = -200
    expect(clampAxis(0, 1200, 800)).toBe(-200);
    expect(clampAxis(500, 1200, 800)).toBe(-200);
    expect(clampAxis(-999, 1200, 800)).toBe(-200);
  });

  it('exact crossover: both regimes agree', () => {
    // visSize === mapSize → zoomed-out path: -(1000-1000)/2 = 0
    // zoomed-in path would give: clamp(pos, 0, 0) = 0
    expect(clampAxis(0, 1000, 1000)).toBe(0);
    expect(clampAxis(100, 1000, 1000)).toBe(0);
    expect(clampAxis(-100, 1000, 1000)).toBe(0);
  });

  it('mixed regime: panoramic map', () => {
    // Map: 3000×500, viewport: 800×600, zoom: 0.5
    // visW = 800/0.5 = 1600, visH = 600/0.5 = 1200
    // X axis: 1600 < 3000 → zoomed in, range [0, 1400]
    expect(clampAxis(700, 1600, 3000)).toBe(700);  // within range
    expect(clampAxis(1500, 1600, 3000)).toBe(1400); // clamped

    // Y axis: 1200 > 500 → zoomed out, center at -(1200-500)/2 = -350
    expect(clampAxis(0, 1200, 500)).toBe(-350);
  });
});

describe('rubber-band formula', () => {
  function rubberBand(distance, dimension, c = 0.55) {
    return (distance * dimension * c) / (dimension + c * distance);
  }

  it('returns 0 at boundary', () => {
    expect(rubberBand(0, 960)).toBe(0);
  });

  it('initial slope is approximately c', () => {
    // At very small distances, f(d) ≈ c * d
    const result = rubberBand(0.01, 960);
    expect(result).toBeCloseTo(0.01 * 0.55, 4);
  });

  it('asymptotes to dimension', () => {
    // At very large distances, f(d) approaches dimension
    const result = rubberBand(100000, 960);
    expect(result).toBeCloseTo(960, 0);
  });

  it('produces expected resistance at 100px', () => {
    // rubberBand(100, 960) = (100 * 960 * 0.55) / (960 + 0.55 * 100)
    //                       = 52800 / 1015 ≈ 52.02
    const result = rubberBand(100, 960);
    expect(result).toBeCloseTo(52, 0);
  });
});

describe('critically damped spring', () => {
  const OMEGA = Math.sqrt(200);

  function solveSpring(displacement, velocity, t) {
    const A = displacement;
    const B = velocity + OMEGA * displacement;
    const exp = Math.exp(-OMEGA * t);
    return {
      position: (A + B * t) * exp,
      velocity: (B - OMEGA * (A + B * t)) * exp
    };
  }

  it('returns displacement at t=0', () => {
    const result = solveSpring(100, 0, 0);
    expect(result.position).toBeCloseTo(100, 6);
  });

  it('converges to 0 (within 0.5px) by t=0.5s', () => {
    const result = solveSpring(100, 0, 0.5);
    expect(Math.abs(result.position)).toBeLessThan(0.5);
  });

  it('never overshoots (critical damping)', () => {
    // Sample at 1ms intervals for 1 second
    for (let ms = 0; ms <= 1000; ms++) {
      const result = solveSpring(100, 0, ms / 1000);
      // Position should always be >= 0 (approaching target from positive side)
      expect(result.position).toBeGreaterThanOrEqual(-0.01);
    }
  });

  it('closed-form matches fine-grained Euler approximation', () => {
    const displacement = 100, velocity = 0;
    const analytical = solveSpring(displacement, velocity, 0.1);

    // Simulate with tiny Euler steps for comparison
    let pos = displacement, vel = velocity;
    const steps = 1000;
    const dt = 0.1 / steps;
    for (let i = 0; i < steps; i++) {
      const accel = -SPRING_STIFFNESS * pos - 2 * SPRING_OMEGA * vel;
      vel += accel * dt;
      pos += vel * dt;
    }

    expect(analytical.position).toBeCloseTo(pos, 1);
  });
});
```

### Property-based tests with fast-check

These tests verify invariants that must hold for all possible inputs. Add to `tests/camera-clamp.test.js` (install `fast-check` as a dev dependency):

```javascript
import fc from 'fast-check';

describe('clampAxis invariants', () => {
  const arbPos = fc.double({ min: -5000, max: 5000, noNaN: true });
  const arbSize = fc.double({ min: 1, max: 10000, noNaN: true });

  it('is idempotent: clamping twice equals clamping once', () => {
    fc.assert(fc.property(arbPos, arbSize, arbSize, (pos, visSize, mapSize) => {
      const once = clampAxis(pos, visSize, mapSize);
      const twice = clampAxis(once, visSize, mapSize);
      expect(twice).toBeCloseTo(once, 10);
    }));
  });

  it('when zoomed in, clamped position keeps map filling viewport', () => {
    fc.assert(fc.property(arbPos, arbSize, arbSize, (pos, visSize, mapSize) => {
      if (visSize >= mapSize) return; // Skip zoomed-out cases
      const clamped = clampAxis(pos, visSize, mapSize);
      // Camera position + visible size should not exceed map size
      expect(clamped).toBeGreaterThanOrEqual(-0.001);
      expect(clamped + visSize).toBeLessThanOrEqual(mapSize + 0.001);
    }));
  });

  it('when zoomed out, map is always centered', () => {
    fc.assert(fc.property(arbPos, arbSize, arbSize, (pos, visSize, mapSize) => {
      if (visSize < mapSize) return; // Skip zoomed-in cases
      const clamped = clampAxis(pos, visSize, mapSize);
      const expected = -(visSize - mapSize) / 2;
      expect(clamped).toBeCloseTo(expected, 10);
    }));
  });
});
```

### Playwright integration tests

Add to `tests/visual/camera-bounds.spec.ts` (or `.js`):

```javascript
import { test, expect } from '@playwright/test';

test.describe('Camera boundary clamping', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/vtt/index.html');
    await page.waitForTimeout(2000); // Wait for VTT to fully initialize
    // Switch to map mode and load a map
    await page.evaluate(() => {
      window.__vtt.EventBus.emit('mode:switch', 'map');
      window.__vtt.EventBus.emit('map:load', 'M01');
    });
    await page.waitForTimeout(1000); // Wait for map image to load
  });

  test('no black bars at cover zoom (corner pixel test)', async ({ page }) => {
    // Reset camera to cover zoom
    await page.evaluate(() => window.__vtt.mapRenderer.camera.fitCover());
    await page.waitForTimeout(200);

    // Sample pixel colors at all four corners of the map-bg canvas.
    // If any corner is pure black (0,0,0), it means the background
    // is showing through, indicating black bars.
    const cornerColors = await page.evaluate(() => {
      const canvas = document.getElementById('map-bg');
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      const corners = [
        { x: 5, y: 5 },                 // top-left
        { x: w - 5, y: 5 },             // top-right
        { x: 5, y: h - 5 },             // bottom-left
        { x: w - 5, y: h - 5 }          // bottom-right
      ];
      return corners.map(({ x, y }) => {
        const pixel = ctx.getImageData(x, y, 1, 1).data;
        return { r: pixel[0], g: pixel[1], b: pixel[2] };
      });
    });

    // None of the corners should be the background fill color (#0D0F14 = 13,15,20)
    // Allow some tolerance for antialiasing
    for (const color of cornerColors) {
      const isBackground = color.r <= 15 && color.g <= 17 && color.b <= 22;
      expect(isBackground).toBe(false);
    }
  });

  test('zoom does not go below cover zoom', async ({ page }) => {
    // Zoom out many times
    for (let i = 0; i < 50; i++) {
      await page.evaluate(() => {
        window.__vtt.mapRenderer.camera.zoomToCenter(-0.4);
      });
    }
    await page.waitForTimeout(100);

    const { zoom, coverZoom } = await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      return { zoom: cam.zoom, coverZoom: cam._coverZoom };
    });

    // Zoom should be at or very near cover zoom, not below it
    expect(zoom).toBeGreaterThanOrEqual(coverZoom - 0.001);
  });

  test('pan stops at map edges (zoomed in)', async ({ page }) => {
    // Zoom in significantly
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => {
        window.__vtt.mapRenderer.camera.zoomToCenter(0.4);
      });
    }

    // Try to pan far left (camera.x should not go below 0)
    for (let i = 0; i < 100; i++) {
      await page.evaluate(() => {
        window.__vtt.mapRenderer.camera.panBy(50, 0);
      });
    }
    await page.waitForTimeout(100);

    const { x } = await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      return { x: cam.x };
    });

    // Camera X should be at or near 0 (left boundary)
    expect(x).toBeCloseTo(0, 0);
  });

  test('elastic overscroll snaps back after drag release', async ({ page }) => {
    // Zoom in
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        window.__vtt.mapRenderer.camera.zoomToCenter(0.4);
      });
    }

    // Simulate a drag past the left boundary
    const canvas = page.locator('#map-container');
    const box = await canvas.boundingBox();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });
    // Drag far to the right (pushes camera.x toward 0 and past)
    await page.mouse.move(box.x + box.width + 200, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up({ button: 'right' });

    // Wait for spring animation to settle
    await page.waitForTimeout(600);

    const { x } = await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      return { x: cam.x };
    });

    // After snap-back, x should be within valid bounds (>= 0)
    expect(x).toBeGreaterThanOrEqual(-0.5);
  });
});
```

### Manual testing checklist

Run through this by hand after the code changes are in place:

1. **Cold start, cover zoom, no black bars**: Load the VTT. Switch to map mode. The map should fill the entire viewport with no background color visible at any edge.

2. **Zoom out stopped at floor**: Scroll to zoom out. The map should stop zooming out at the point where it fills the viewport. Additional scroll-down should produce no visible change.

3. **Pan clamping (zoomed in)**: Zoom in 2-3 notches. Drag the map right, trying to expose the left edge. The map edge should stop at the viewport edge and refuse to go further. Same test for all four edges.

4. **Mixed-regime clamping**: Use a panoramic map (if available, or resize the window to be very wide). The map should be constrained horizontally but centered vertically (or vice versa). Panning should work on the constrained axis but the centered axis should stay centered.

5. **Elastic overscroll feel**: Zoom in. Right-click drag the map past the left edge. The map should pull past the edge with increasing resistance. Release the drag. The map should spring back to the edge smoothly (roughly 0.3 seconds).

6. **Elastic overscroll in all directions**: Repeat test 5 for right edge, top edge, and bottom edge.

7. **Spring interrupted by new drag**: Drag past a boundary and release. While the spring animation is running (within 0.3s of release), grab the map again. The spring should stop immediately and a new drag should begin.

8. **Zoom-at-cursor at zoom floor**: Position cursor at a specific map feature. Zoom out until you hit the floor. The feature should stay under the cursor as zoom decelerates. Once at the floor, further zoom-out should not cause any cursor drift.

9. **Edge-pan during token drag**: Place a token on the map. Drag it toward the right edge of the viewport. When the cursor enters the edge zone (~60px from edge), the map should start scrolling right after a brief delay (~150ms). The scroll should accelerate as the cursor moves closer to the edge.

10. **Edge-pan stops at boundary**: While edge-panning during a token drag, let the map reach the right edge. The edge-pan should stop; the map should not scroll past the boundary.

11. **Window resize with clamping**: While zoomed in and panned to a corner, resize the browser window. The camera should re-clamp to the new viewport dimensions. No black bars should appear.

12. **fitContain still works**: Press `Shift+1` (fit to contain). The entire map should be visible, potentially with background color on two sides. This is the intentional exception to the "no black bars" rule.

13. **fitCover resets correctly**: Press `Shift+0` (fit to cover). The map should fill the viewport again with no background color.

14. **Controller zoom/pan buttons**: Open the Controller. Click zoom and pan buttons. The VTT should respond, and boundary constraints should be enforced (you should not be able to pan past edges via the Controller).

15. **Keyboard pan clamping**: Use arrow keys to pan. At map edges, panning should stop. Holding the key at a boundary should not cause jitter.

---

## 12. Migration checklist

This is the ordered list of changes for Claude Code. Each item references the section above that provides the implementation.

1. **Add `rubberBand()` function** to `vtt/js/map-camera.js` as a module-level function, after the constants and before the `BoundsCache` class (Section 5). This is a pure function with no dependencies.

2. **Add `CameraAnimator` class** to `vtt/js/map-camera.js`, after `rubberBand()` and before `BoundsCache` (Section 6). It uses the module-level `SPRING_STIFFNESS`, `SPRING_MASS`, `SPRING_OMEGA`, `SETTLE_THRESHOLD_PX`, and `SETTLE_THRESHOLD_VEL` constants.

3. **Add Phase 3 properties to Camera constructor** in `vtt/js/map-camera.js` (Section 2): `this._isDragging`, `this._animator`, `this._dmCanZoomPastCover`.

4. **Add `_getMinZoom()` method** to Camera class (Section 2).

5. **Add `_clampAxis()` and `_applyHardBounds()` methods** to Camera class (Section 3).

6. **Add `_applyElasticBounds()` and `_elasticClampAxis()` methods** to Camera class (Section 5).

7. **Add `_applyConstraints()` method** to Camera class (Section 2).

8. **Add `_triggerSnapBack()` method** to Camera class (Section 5).

9. **Refactor `panBy()`** to call `_applyConstraints()` instead of `EventBus.emit('camera:changed')` (Section 2).

10. **Refactor `zoomAt()`** to pre-clamp zoom and call `_applyConstraints()` (Section 2 and Section 4).

11. **Refactor `fitCover()`** to call `_applyConstraints()` (Section 2).

12. **Refactor `fitContain()`** to bypass zoom constraints but emit `camera:changed` directly (Section 2).

13. **Refactor `setPosition()`** to call `_applyConstraints()` (Section 2).

14. **Refactor `setViewportSize()`** to call `_applyConstraints()` (Section 2).

15. **Refactor `deserialize()`** to call `_applyConstraints()` (Section 2).

16. **Update `_startPan()`** to set `_isDragging = true` and cancel animator (Section 5).

17. **Update `_commitPan()`** to set `_isDragging = true` and cancel animator (Section 5).

18. **Update `_cancelPan()`** to set `_isDragging = false` and call `_triggerSnapBack()` (Section 5).

19. **Update the mouseup handler** inside `attachTo()` to set `_isDragging = false` and call `_triggerSnapBack()` (Section 5).

20. **Update the mousemove pan handler** inside `attachTo()` to call `_applyConstraints()` instead of `EventBus.emit('camera:changed')` (Section 2).

21. **Add `this._animator = new CameraAnimator(this)` to `attachTo()`** after `this._keyboard.attach()` (Section 6).

22. **Add `camera:zoom-past-cover` EventBus handler** in `attachTo()` (Section 8).

23. **Create `vtt/js/edge-pan.js`** with the `EdgePanManager` class (Section 7). This is a new file.

24. **Update `vtt/js/token-manager.js`**: add import for `EdgePanManager`, create instance in `init()`, call `startTracking()` on drag start, `updateCursor()` on drag move, `stopTracking()` on drag end (Section 7).

25. **Update `shared/protocol.js`**: add `CAMERA_ZOOM_PAST_COVER` message type, required fields entry, and factory function (Section 8).

26. **Update `vtt/js/state.js`**: add `CAMERA_ZOOM_PAST_COVER` case in `handleSyncMessage()` switch (Section 8).

27. **Run the test suite** (Section 11): unit tests for clampAxis, rubber-band formula, and spring solver; Playwright integration tests for corner-pixel verification and snap-back; manual testing checklist.

---

## 13. What Phase 4 expects from this foundation

Phase 4 (BroadcastChannel sync) builds on Phase 3's constraint infrastructure. Specifically, it expects:

- **`deserialize()` applies constraints automatically.** Phase 4 sends camera state at 30fps across windows. Each receiving window has its own viewport dimensions and therefore its own cover zoom. The deserialized camera state is constrained to the receiver's bounds, meaning the same world-space camera position produces valid (but potentially different-extent) results on different-sized displays. Phase 3 delivers this.

- **`_applyConstraints()` is the single commit point.** Phase 4's animated camera transitions (smooth pan to a new position) will set intermediate camera states during the animation. These intermediate states route through `_applyConstraints()`, ensuring no frame of the transition violates boundary constraints.

- **`CameraAnimator` is extensible.** Phase 4 and Phase 5 will add animated zoom transitions (`flyTo`, zoom presets with smooth animation). The `CameraAnimator` pattern of self-scheduling rAF with a closed-form solver is the foundation for those features. Adding zoom animation means adding a `_springZoom` alongside `_springX` and `_springY`.

- **Edge-pan exists and works.** Phase 4 does not modify edge-pan, but the feature depends on boundary clamping working correctly. If boundaries are not enforced, edge-pan would scroll the map off-screen indefinitely.

Phase 5 (Advanced features) expects:

- **`_triggerSnapBack()` accepts initial velocity.** Phase 5 adds momentum panning (inertial drag release). The velocity at release feeds into the spring's initial velocity parameter, creating seamless continuity between drag and snap-back. The `CameraAnimator.snapBack()` method already accepts a `velocity` parameter; Phase 5 just needs to compute it from the last few mousemove events and pass it through.

- **`_dmCanZoomPastCover` is runtime-toggleable.** Phase 5 may add a persistent DM preference for this. The EventBus-driven toggle from Phase 3 is the correct interface; Phase 5 just needs to persist the preference and emit the event on load.

- **`_getMinZoom()` is overridable for per-map settings.** Some maps might have a custom zoom floor (e.g., a full-continent overview map that should allow zooming out to contain mode by default). The `_getMinZoom()` helper is the single place where this policy lives, making it easy to extend with per-map configuration in Phase 5.

The constraint system you build in Phase 3 is the guardrail layer of the camera. Every subsequent phase can move the camera freely, knowing that `_applyConstraints()` will prevent invalid states.
