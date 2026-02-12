# Phase 1: Camera system foundation for viewport-filling maps

**This guide replaces the VTT's hardcoded 1920×1080 canvas-relative camera with a true world-space camera model that fills every pixel of the browser window.** The current system draws maps inside a fixed 1920×1080 canvas coordinate space, then CSS-scales that canvas to fit the viewport. The new system introduces a `Camera = { x, y, zoom }` abstraction that operates in world-space coordinates, calculates a "cover" zoom floor dynamically via ResizeObserver, and applies its transform through `ctx.setTransform()` on each canvas layer. This single architectural change eliminates all black bars, enables maps of any aspect ratio to fill the viewport naturally, and lays the mathematical groundwork for every subsequent phase (input handling, boundary clamping, cross-window sync, and cinematic transitions).

The guide is structured as a walkthrough you can hand directly to Claude Code. Each section explains what the code does and why, provides the complete implementation, calls out interactions with existing modules, and includes testing protocols. Read it front to back before changing anything. The order matters.

---

## Table of contents

1. [What exists today and why it needs to change](#1-what-exists-today-and-why-it-needs-to-change)
2. [The camera model: a single source of truth for all viewport math](#2-the-camera-model)
3. [Replacing the current Camera class](#3-replacing-the-current-camera-class)
4. [Updating MapRenderer to use world-space drawing](#4-updating-maprenderer)
5. [Updating TokenManager coordinate conversion](#5-updating-tokenmanager)
6. [The viewport scaler and cover zoom integration](#6-viewport-scaler-and-cover-zoom)
7. [CSS changes to layout.css and map.css](#7-css-changes)
8. [BroadcastChannel protocol additions](#8-broadcastchannel-protocol)
9. [DOM overlay positioning (labels, HP bars, menus)](#9-dom-overlay-positioning)
10. [Performance considerations](#10-performance)
11. [Testing protocols](#11-testing-protocols)
12. [Migration checklist](#12-migration-checklist)
13. [What Phase 2 expects from this foundation](#13-phase-2-expectations)

---

## 1. What exists today and why it needs to change

### The current architecture

The VTT display uses a **two-layer scaling system**. The outer layer is the viewport scaler (`viewport-scaler.js`), which CSS-transforms a fixed 1920×1080 container to fit the browser window using `Math.min(vw / 1920, vh / 1080)`. The inner layer is the Camera class (`map-camera.js`), which manages zoom and pan within that 1920×1080 coordinate space using `ctx.setTransform()` on each canvas.

The camera currently stores its position as pixel offsets within the 1920×1080 space:

```javascript
// Current camera model (map-camera.js)
this.x = 0;       // offset in 1920×1080 canvas space
this.y = 0;       // offset in 1920×1080 canvas space
this.zoom = 1.0;  // scale factor applied via ctx.setTransform
```

When a map loads, `fitToSize()` calculates a zoom level that fits the map's world dimensions into the 1920×1080 canvas:

```javascript
// Current fitToSize
fitToSize(worldW, worldH) {
  const scaleX = VTT_W / worldW;   // VTT_W = 1920
  const scaleY = VTT_H / worldH;   // VTT_H = 1080
  this.zoom = Math.min(scaleX, scaleY, MAX_ZOOM);
  this.x = (VTT_W - worldW * this.zoom) / 2;
  this.y = (VTT_H - worldW * this.zoom) / 2;
}
```

This produces correct results when the viewport happens to be 16:9. At any other aspect ratio, you get black bars.

### Why the fixed canvas causes black bars

The fundamental issue is that the canvas coordinate space is always 1920×1080, regardless of the actual viewport dimensions. When you CSS-scale a 1920×1080 rectangle into a 2560×1440 viewport (16:9, no problem), everything lines up. But when you CSS-scale that same rectangle into a 1280×800 viewport (16:10), the `Math.min()` in the viewport scaler constrains on the narrower dimension, leaving unused space.

The map itself might be 2400×1600 pixels of art. The camera zooms it to fit within 1920×1080. Then the viewport scaler shrinks the whole thing to fit the browser window. At no point does the system ask, "How much of this map could I show if I used the full viewport?" It always funnels everything through the 1920×1080 bottleneck.

### What the new system does differently

The new camera model operates in **world space** (the map image's native pixel dimensions) and knows about the **actual viewport size** (the real browser window). It calculates zoom and pan relative to the map, then uses `ctx.setTransform()` to render the visible portion of the map directly onto the canvas, which is now sized to match the viewport (not hardcoded to 1920×1080).

The viewport scaler still exists, but its role changes. Instead of scaling a fixed canvas, it reports the viewport dimensions to the camera, which uses them to calculate the cover zoom floor. The canvas elements resize to fill the viewport, and the camera handles all coordinate transformation.

```
Before:  Map → Camera (1920×1080 space) → Canvas (1920×1080) → CSS Scale → Viewport
After:   Map → Camera (world space) → Canvas (viewport-sized) → Viewport
```

The CSS `transform: scale()` on `#vtt-scale-container` is removed for map mode. The container becomes a simple `width: 100%; height: 100%` wrapper, and the canvases fill it natively. Theater mode (which shows full-screen scene art, not interactive maps) retains the fixed 1920×1080 approach because it displays pre-composed artwork at a known aspect ratio.

---

## 2. The camera model

### The universal camera abstraction

Every interactive 2D application (Google Maps, Figma, Photoshop, tldraw, Leaflet, Foundry VTT, every game engine) converges on the same camera model. A camera is three numbers:

```javascript
Camera = { x, y, zoom }
```

Where `x` and `y` are the **world-space coordinates** of the viewport's top-left corner, and `zoom` is the scale factor. Everything else derives from two conversion functions:

```javascript
// World coordinates → screen pixel position
worldToScreen(wx, wy) {
  return {
    x: (wx - this.x) * this.zoom,
    y: (wy - this.y) * this.zoom
  };
}

// Screen pixel position → world coordinates
screenToWorld(sx, sy) {
  return {
    x: sx / this.zoom + this.x,
    y: sy / this.zoom + this.y
  };
}
```

These two functions are inverses of each other. Every operation the camera performs (zoom, pan, fit-to-map, fit-to-tokens, boundary clamping) is just arithmetic on `x`, `y`, and `zoom` followed by calling `worldToScreen` or `screenToWorld`.

### Why this model is correct

The current camera stores `x` and `y` as **screen-space offsets**, meaning `worldToScreen` and `screenToWorld` are slightly different:

```javascript
// Current (screen-space offset model)
screenToWorld(sx, sy) {
  return {
    x: (sx - this.x) / this.zoom,    // subtract offset, then divide by zoom
    y: (sy - this.y) / this.zoom
  };
}
```

Both models are mathematically equivalent; you can convert between them. But the world-space model has a critical advantage: **the camera position has an intuitive meaning**. `camera.x = 100, camera.y = 200` means "the top-left of the viewport is looking at world position (100, 200)." In the screen-space model, `camera.x = 100` means "the world origin is offset 100 screen pixels to the right," which requires mental gymnastics to reason about.

This intuitive meaning pays dividends when you start doing boundary clamping (Phase 3), cross-window sync (Phase 4), and saved camera presets (Phase 5). In all those cases, you want to think in terms of "what part of the map am I looking at?" not "how far has the origin shifted?"

### Cover zoom vs. contain zoom

Two zoom levels matter:

```javascript
// Cover: fills viewport, may crop map edges. No black bars ever.
coverZoom = Math.max(viewportW / mapW, viewportH / mapH);

// Contain: shows entire map, may have black bars on two sides.
containZoom = Math.min(viewportW / mapW, viewportH / mapH);
```

The **cover zoom** is the minimum zoom level that guarantees no black bars. It scales the map so that the shorter dimension (relative to the viewport aspect ratio) fills the viewport, and the longer dimension extends beyond the edges. This is identical to CSS `object-fit: cover`.

The **contain zoom** shows the entire map with possible letterboxing. This is the current `fitToSize` behavior and corresponds to CSS `object-fit: contain`.

For the VTT display, the cover zoom becomes the **zoom floor** (the minimum `camera.zoom` value). When the DM loads a map, the camera initializes at cover zoom with the map centered. The DM can zoom in to see less of the map, or zoom out past the cover level to intentionally reveal map edges (if they want to show the whole map with a background color). This zoom-floor behavior is the default; Phase 3 adds boundary clamping and elastic overscroll on top of it.

### The math for centering a map at cover zoom

When the camera is at cover zoom, we want the map centered in the viewport. Depending on the aspect ratio relationship, either the horizontal or vertical dimension is cropped:

```javascript
// Center the map at a given zoom level
centerMap(mapW, mapH, viewportW, viewportH, zoom) {
  // At this zoom, the visible world area is:
  const visibleW = viewportW / zoom;
  const visibleH = viewportH / zoom;

  // Center: place camera so the map's center aligns with the viewport's center
  return {
    x: (mapW - visibleW) / 2,
    y: (mapH - visibleH) / 2
  };
}
```

When `visibleW < mapW` (zoomed in enough that not all width is visible), `camera.x` is positive, placing the viewport's left edge somewhere inside the map. When `visibleW > mapW` (zoomed out past contain), `camera.x` is negative, meaning the viewport extends beyond the map's left edge, and the background color shows.

---

## 3. Replacing the current Camera class

### The new map-camera.js

This is the complete replacement for `vtt/js/map-camera.js`. Every line is annotated.

```javascript
// ============================================
// VTT Map Camera — World-space zoom, pan, coordinate transforms
// ============================================
//
// This camera operates in WORLD SPACE. camera.x and camera.y represent
// the world-coordinate position of the viewport's top-left corner.
// This is the universal camera model used by Figma, Leaflet, tldraw,
// Google Maps, and every game engine. It enables intuitive reasoning
// about "what part of the map am I looking at?"
//
// The previous camera used SCREEN-SPACE OFFSETS, where x/y represented
// how far the world origin was displaced on screen. Both models are
// mathematically equivalent, but world-space makes boundary clamping,
// cross-window sync, and saved presets far more natural.

import { EventBus } from './state.js';

// --- Constants ---
const MIN_ZOOM = 0.1;              // absolute floor (safety valve)
const MAX_ZOOM = 5.0;              // absolute ceiling
const ZOOM_FACTOR = 1.04;          // per-tick scroll/pinch (4%)
const ZOOM_FACTOR_KEY = 1.15;      // per-press keyboard/button (15%)
const DRAG_THRESHOLD = 3;          // px before click becomes drag

export class Camera {
  constructor() {
    // World-space camera position: top-left corner of the viewport in world coords
    this.x = 0;
    this.y = 0;
    this.zoom = 1.0;

    // Viewport dimensions in CSS pixels (set by viewport scaler or ResizeObserver)
    this.viewportW = 1920;
    this.viewportH = 1080;

    // Map dimensions in world pixels (set when a map loads)
    this.mapW = 0;
    this.mapH = 0;

    // Dynamic zoom floor: recalculated on resize and map load
    this._coverZoom = 0.1;

    // Viewport scale factor (CSS transform scale on the container, if any)
    // In the new architecture this is 1.0 for map mode, but kept for
    // backward compatibility during the transition and for theater mode.
    this.viewportScale = 1;

    // Panning state
    this._panning = false;
    this._pendingPan = false;
    this._panStartX = 0;
    this._panStartY = 0;
    this._panStartCamX = 0;
    this._panStartCamY = 0;
    this._panButton = -1;
    this._panScreenDist = 0;
    this.spaceHeld = false;
    this._el = null;
  }

  // -------------------------------------------------------------------
  // Coordinate conversion
  // -------------------------------------------------------------------

  /**
   * Convert screen coordinates (CSS pixels relative to canvas top-left)
   * to world coordinates (map pixel position).
   */
  screenToWorld(sx, sy) {
    return {
      x: sx / this.zoom + this.x,
      y: sy / this.zoom + this.y
    };
  }

  /**
   * Convert world coordinates to screen coordinates.
   */
  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom,
      y: (wy - this.y) * this.zoom
    };
  }

  /**
   * Convert a raw DOM event (MouseEvent, PointerEvent) to canvas-space
   * screen coordinates, accounting for the container's position and
   * any CSS transform scale.
   *
   * This replaces the ad-hoc coordinate conversion scattered across
   * map-camera.js and token-manager.js. All mouse/touch input goes
   * through this single method.
   */
  eventToScreen(e) {
    if (!this._el) return { x: 0, y: 0 };
    const rect = this._el.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / this.viewportScale,
      y: (e.clientY - rect.top) / this.viewportScale
    };
  }

  /**
   * Convert a raw DOM event directly to world coordinates.
   * Convenience method combining eventToScreen + screenToWorld.
   */
  eventToWorld(e) {
    const screen = this.eventToScreen(e);
    return this.screenToWorld(screen.x, screen.y);
  }

  // -------------------------------------------------------------------
  // Canvas context transforms
  // -------------------------------------------------------------------

  /**
   * Apply the camera transform to a 2D canvas context.
   *
   * setTransform(a, b, c, d, e, f) maps to the matrix:
   *   | a c e |     | zoom  0    -x*zoom |
   *   | b d f |  =  | 0     zoom -y*zoom |
   *   | 0 0 1 |     | 0     0    1       |
   *
   * This translates world-space drawing commands to screen-space output.
   * After calling this, ctx.drawImage(img, 0, 0, mapW, mapH) draws the
   * map at the correct position and scale.
   */
  applyTransform(ctx) {
    ctx.setTransform(
      this.zoom, 0,
      0, this.zoom,
      -this.x * this.zoom,
      -this.y * this.zoom
    );
  }

  /**
   * Reset context to identity transform.
   */
  resetTransform(ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // -------------------------------------------------------------------
  // Viewport and map configuration
  // -------------------------------------------------------------------

  /**
   * Update viewport dimensions. Called by ResizeObserver when the
   * browser window (or the map container) resizes.
   *
   * Recalculates the cover zoom floor and enforces it. If the camera
   * was at or below the old cover zoom, it snaps to the new one and
   * re-centers (preventing black bars from appearing during resize).
   * If zoomed in beyond cover, the position is preserved.
   *
   * Always emits camera:changed so rendering stays in sync, even if
   * setViewportSize is called from somewhere other than the
   * MapRenderer's ResizeObserver (which has its own redrawAll call).
   * Duplicate redraws within the same frame are harmless and will be
   * collapsed by the rAF coalescing pattern (see §10 Redraw frequency).
   */
  setViewportSize(w, h) {
    if (w <= 0 || h <= 0) return;

    const oldCoverZoom = this._coverZoom;

    this.viewportW = w;
    this.viewportH = h;
    this._updateCoverZoom();

    // If the camera was sitting at (or below) the old cover zoom,
    // snap to the new floor and re-center. Without this, shrinking
    // the window would leave the camera at a zoom value that no
    // longer fills the viewport, producing black bars until the
    // user zooms manually.
    if (oldCoverZoom > 0 && this.zoom <= oldCoverZoom + 0.001) {
      this.zoom = this._coverZoom;
      this._centerMap();
    }

    EventBus.emit('camera:changed');
  }

  /**
   * Set the viewport scale factor (CSS transform on container).
   * In map mode with the new architecture, this should be 1.0.
   * Kept for backward compatibility and theater mode.
   */
  setViewportScale(s) {
    this.viewportScale = s;
  }

  /**
   * Register map dimensions. Called when a new map loads.
   * Automatically fits the map to cover the viewport.
   */
  setMapSize(w, h) {
    this.mapW = w;
    this.mapH = h;
    this._updateCoverZoom();
    this.fitCover();
  }

  /**
   * Recalculate the cover zoom floor based on current viewport and map.
   * The cover zoom ensures the map fills the viewport with no black bars.
   */
  _updateCoverZoom() {
    if (this.mapW <= 0 || this.mapH <= 0) return;
    this._coverZoom = Math.max(
      this.viewportW / this.mapW,
      this.viewportH / this.mapH
    );
  }

  /**
   * Snap to cover zoom and center the map.
   * This is the "home" position: no black bars, map centered.
   */
  fitCover() {
    this.zoom = this._coverZoom;
    this._centerMap();
    EventBus.emit('camera:changed');
  }

  /**
   * Fit the entire map in view (contain mode). May show black bars.
   * This is what the current fitToSize() does.
   */
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

  /**
   * Backward-compatible fitToSize. Maps the old API to the new model.
   * Called by MapRenderer.loadMap() with world pixel dimensions.
   */
  fitToSize(worldW, worldH) {
    this.setMapSize(worldW, worldH);
    // setMapSize calls fitCover, which emits camera:changed
  }

  /**
   * Center the map in the viewport at the current zoom level.
   */
  _centerMap() {
    const visibleW = this.viewportW / this.zoom;
    const visibleH = this.viewportH / this.zoom;
    this.x = (this.mapW - visibleW) / 2;
    this.y = (this.mapH - visibleH) / 2;
  }

  // -------------------------------------------------------------------
  // Zoom operations
  // -------------------------------------------------------------------

  /**
   * Zoom centered on a screen-space point.
   *
   * The algorithm (formalized by Steve Ruiz of tldraw):
   * 1. Convert screen point to world coords at old zoom
   * 2. Update zoom
   * 3. Convert same screen point to world coords at new zoom
   * 4. Adjust camera position by the difference
   *
   * This keeps the point under the cursor fixed on screen, which is
   * the universally expected zoom behavior. Roll20's failure to do this
   * is their most common UX complaint.
   *
   * @param {number} sx - Screen-space X (CSS pixels from canvas left)
   * @param {number} sy - Screen-space Y (CSS pixels from canvas top)
   * @param {number} direction - +1 to zoom in, -1 to zoom out
   * @param {number} factor - Multiplicative zoom step
   */
  zoomAt(sx, sy, direction, factor = ZOOM_FACTOR) {
    // 1. World point under cursor before zoom
    const worldBefore = this.screenToWorld(sx, sy);

    // 2. Update zoom
    const oldZoom = this.zoom;
    const newZoom = direction > 0
      ? this.zoom * factor
      : this.zoom / factor;
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));

    // 3. World point under cursor after zoom (same screen position)
    const worldAfter = this.screenToWorld(sx, sy);

    // 4. Adjust camera so the world point stays at the same screen position
    this.x += worldBefore.x - worldAfter.x;
    this.y += worldBefore.y - worldAfter.y;

    EventBus.emit('camera:changed');
  }

  /**
   * Zoom centered on viewport midpoint (keyboard/button zoom).
   */
  zoomToCenter(direction, factor = ZOOM_FACTOR_KEY) {
    this.zoomAt(this.viewportW / 2, this.viewportH / 2, direction, factor);
  }

  // -------------------------------------------------------------------
  // Pan operations
  // -------------------------------------------------------------------

  /**
   * Pan by screen-space delta (pixels).
   *
   * Converts screen-space pixel movement to world-space displacement.
   * A rightward mouse drag (positive dx in screen space) should move
   * the camera LEFT in world space, revealing content to the right.
   * Hence the division by zoom and sign inversion on the camera position.
   *
   * Wait: the sign depends on the mental model. In the "grab and drag"
   * model (which is what users expect), dragging right means the world
   * moves right, which means camera.x DECREASES. So:
   *
   *   camera.x -= dx / zoom
   *   camera.y -= dy / zoom
   */
  panBy(dx, dy) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    EventBus.emit('camera:changed');
  }

  /**
   * Set camera position directly (world coordinates).
   * Used for cross-window sync and saved presets.
   */
  setPosition(x, y, zoom) {
    this.x = x;
    this.y = y;
    if (zoom !== undefined) this.zoom = zoom;
    EventBus.emit('camera:changed');
  }

  // -------------------------------------------------------------------
  // Input handling (attached to map container)
  // -------------------------------------------------------------------

  attachTo(el) {
    this._el = el;

    // --- Wheel: pinch/Ctrl+scroll = zoom, regular scroll = pan ---
    el.addEventListener('wheel', (e) => {
      e.preventDefault();

      // Normalize deltaY across browsers. Chrome and Edge report
      // deltaMode 0 (pixels). Firefox may report deltaMode 1 (lines),
      // where each line is roughly 16-40 CSS pixels depending on OS
      // settings. deltaMode 2 (pages) is rare but possible.
      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.deltaMode === 1) {        // DOM_DELTA_LINE
        dx *= 40;
        dy *= 40;
      } else if (e.deltaMode === 2) { // DOM_DELTA_PAGE
        dx *= 800;
        dy *= 800;
      }

      if (e.ctrlKey || e.metaKey) {
        // Pinch-to-zoom on trackpad, or Ctrl+scroll on mouse wheel.
        //
        // Important: trackpad pinch fires wheel events with ctrlKey=true
        // in Chrome, Firefox, and Edge. The deltaY values differ wildly
        // between browsers, but using a multiplicative factor (rather than
        // additive) normalizes the perceptual result. Each scroll tick
        // produces a consistent percentage change regardless of deltaY
        // magnitude.
        const screen = this.eventToScreen(e);
        const direction = dy < 0 ? 1 : -1;
        this.zoomAt(screen.x, screen.y, direction);
      } else {
        // Two-finger scroll (trackpad) or regular scroll wheel = pan.
        //
        // dx and dy are now in normalized pixel units. We convert to
        // world displacement by dividing by zoom, but panBy already
        // does that, so we pass the normalized screen deltas. The
        // negative sign on panBy's internal math means scrolling down
        // (positive deltaY) moves the camera down in world space
        // (reveals content below), which is the natural "grab and drag"
        // behavior.
        //
        // Note: we do NOT divide by viewportScale here because in the
        // new architecture, viewportScale is 1.0 for map mode. If we
        // reintroduce CSS transform scaling, this would need adjustment.
        this.panBy(-dx, -dy);
      }
    }, { passive: false });

    // --- Mouse down: start pan ---
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this._startPan(e, 1);
        return;
      }
      if (e.button === 2) {
        this._startPan(e, 2);
        return;
      }
      if (e.button === 0 && this.spaceHeld) {
        e.preventDefault();
        e.stopPropagation();
        this._startPan(e, 0);
        return;
      }
      if (e.button === 0) {
        this._pendingPan = true;
        this._panStartX = e.clientX;
        this._panStartY = e.clientY;
        this._panStartCamX = this.x;
        this._panStartCamY = this.y;
        this._panScreenDist = 0;
      }
    });

    // --- Mouse move: handle pending or active pan ---
    window.addEventListener('mousemove', (e) => {
      if (this._pendingPan) {
        if (window.__vtt?.tokenManager?._dragging) {
          this._pendingPan = false;
          return;
        }
        const dist = Math.abs(e.clientX - this._panStartX)
                   + Math.abs(e.clientY - this._panStartY);
        if (dist > DRAG_THRESHOLD) {
          this._commitPan();
        } else {
          return;
        }
      }

      if (!this._panning) return;

      // Convert screen-space delta to world-space camera movement.
      //
      // In the old model, dx was added to camera.x directly (because x was
      // a screen-space offset). In the new model, camera.x is a world-space
      // position, so moving the mouse right by 10px means the camera should
      // move LEFT by 10px / zoom in world space.
      const dxScreen = e.clientX - this._panStartX;
      const dyScreen = e.clientY - this._panStartY;

      this._panScreenDist = Math.max(
        this._panScreenDist,
        Math.abs(dxScreen) + Math.abs(dyScreen)
      );

      // New world-space position: start position minus screen delta / zoom
      //
      // The viewportScale division is a safety net, not a design choice.
      // In map mode (the only mode where this camera operates),
      // viewportScale is always 1.0 and the division is a no-op.
      // It is kept here solely so that pan-in-progress during a
      // theater-to-map mode transition does not produce a sudden
      // position jump if viewportScale has not yet reset to 1.0.
      // If this confuses future readers: in map mode, pretend the
      // division is not there.
      this.x = this._panStartCamX - dxScreen / (this.zoom * this.viewportScale);
      this.y = this._panStartCamY - dyScreen / (this.zoom * this.viewportScale);

      EventBus.emit('camera:changed');
    });

    // --- Mouse up: end pan ---
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

    // --- Context menu suppression for right-click drag ---
    el.addEventListener('contextmenu', (e) => {
      if (this._panScreenDist > DRAG_THRESHOLD) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    // --- Space key tracking ---
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat && !this.spaceHeld) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        this.spaceHeld = true;
        if (this._el) this._el.style.cursor = 'grab';
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceHeld = false;
        if (this._el && !this._panning) this._el.style.cursor = '';
      }
    });

    // --- EventBus handlers (from Controller via BroadcastChannel) ---
    EventBus.on('camera:pan', ({ dx, dy }) => this.panBy(dx, dy));
    EventBus.on('camera:zoom', (direction) => this.zoomToCenter(direction));

    // --- Focus/visibility safety ---
    window.addEventListener('blur', () => this._cancelPan());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._cancelPan();
    });
    el.addEventListener('mouseleave', () => {
      if (this._panning) this._cancelPan();
    });
  }

  // -------------------------------------------------------------------
  // Pan state management (internal)
  // -------------------------------------------------------------------

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

  _commitPan() {
    this._panning = true;
    this._pendingPan = false;
    this._panButton = 0;
    this._setPanCursor(true);
  }

  _cancelPan() {
    this._panning = false;
    this._pendingPan = false;
    this._panButton = -1;
    this._setPanCursor(false);
  }

  _setPanCursor(active) {
    if (!this._el) return;
    this._el.classList.toggle('panning', active);
    this._el.style.cursor = active ? 'grabbing' : '';
  }

  // -------------------------------------------------------------------
  // Serialization (for BroadcastChannel sync and persistence)
  // -------------------------------------------------------------------

  /**
   * Serialize camera state for cross-window sync.
   * Uses world-space coordinates, which are resolution-independent.
   */
  serialize() {
    return {
      x: this.x,
      y: this.y,
      zoom: this.zoom,
      mapW: this.mapW,
      mapH: this.mapH
    };
  }

  /**
   * Restore camera state from a serialized snapshot.
   * The receiving window applies its own viewport dimensions to
   * calculate the correct rendering, so the same world-space camera
   * position produces correct (but potentially different-extent)
   * results on different-sized displays.
   */
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
}
```

### Key differences from the old Camera

Here is a summary of every behavioral change, because Claude Code will need to understand these when updating dependent modules:

**Coordinate system flip.** In the old model, `camera.x` was a screen-space offset (positive = world shifted right). In the new model, `camera.x` is a world-space position (positive = viewport looking at a position further right in the map). This inverts the sign of pan operations.

**`panBy` semantics.** Old: `this.x += dx` (screen-space, direct pixel offset). New: `this.x -= dx / this.zoom` (screen-space delta converted to world-space displacement with inverted sign for grab-and-drag feel).

**`screenToWorld` formula.** Old: `(sx - this.x) / this.zoom`. New: `sx / this.zoom + this.x`. These produce the same result given the coordinate system flip: if old `camera.x = 100` (offset) maps to new `camera.x = -100 / zoom` (world position), the world coordinates match. But the formulas look different, so any code that constructs screenToWorld manually (rather than calling the method) must be updated.

**`applyTransform` matrix.** Old: `setTransform(zoom, 0, 0, zoom, this.x, this.y)` where x/y were screen offsets. New: `setTransform(zoom, 0, 0, zoom, -this.x * zoom, -this.y * zoom)` where x/y are world positions. The `-this.x * zoom` translates the world-space camera position into the screen-space translation component of the transform matrix.

**Viewport awareness.** The old camera hardcoded `VTT_W = 1920` and `VTT_H = 1080`. The new camera stores `viewportW` and `viewportH` which are set dynamically by a ResizeObserver. This is what enables cover-zoom calculation.

**`fitToSize` becomes `setMapSize`.** The old method calculated zoom relative to 1920×1080. The new method (`setMapSize`) stores map dimensions, recalculates cover zoom, and calls `fitCover()`, which uses the actual viewport dimensions. For backward compatibility, `fitToSize(w, h)` is kept as a thin wrapper around `setMapSize(w, h)`.

**`fitToSize` behavioral change: contain to cover.** The old `fitToSize` used `Math.min(scaleX, scaleY)` (contain-fit: entire map visible, black bars possible). The new `fitCover` uses `Math.max(viewportW/mapW, viewportH/mapH)` (cover-fit: viewport completely filled, map edges cropped). This is the core behavior we want, but it means any saved camera state that stored a zoom value near the old contain-fit level will look wrong after the migration. **All pre-existing saved camera state should be treated as invalidated by this coordinate system change.** If the VTT persists camera positions (via localStorage, BroadcastChannel snapshots, or any other mechanism), add a version flag or simply discard old camera data on first load after the migration.

**Y-centering bug fix (existing bug).** The current `fitToSize` has a bug on line 52: `this.y = (VTT_H - worldW * this.zoom) / 2` uses `worldW` instead of `worldH`. Maps that are not square are vertically off-center on load. The new `_centerMap()` method calculates both axes correctly using `this.mapW` and `this.mapH` respectively, so this migration implicitly fixes a bug. Worth knowing so that if a map's initial position looks "different" after the migration, that is the fix working, not a regression.

**`MIN_ZOOM` floor change.** The old camera used `MIN_ZOOM = 0.3`. The new camera lowers this to `MIN_ZOOM = 0.1` to accommodate large maps at small viewports where the cover zoom might fall below 0.3. Between Phase 1 and Phase 3 (which adds boundary clamping), this lower floor means users can zoom out far enough to see the map as a small rectangle surrounded by background color. This is an acceptable interim state: it does not break anything, and Phase 3's dynamic zoom floor (`_coverZoom`) will replace the static `MIN_ZOOM` as the effective lower bound.

---

## 4. Updating MapRenderer

The `MapRenderer` class needs three changes: canvas sizing, drawing coordination, and the integration point with the new camera.

### Canvas sizing: viewport-matched, not hardcoded

The canvases currently have their `width` and `height` attributes set to 1920×1080 in `init()`. They need to match the viewport instead.

```javascript
// In MapRenderer.init(), replace the fixed canvas sizing:

// OLD:
for (const id of ['map-bg', 'map-fog', 'map-grid', 'map-tokens', 'map-effects']) {
  const canvas = $(id);
  canvas.width = VTT_W;
  canvas.height = VTT_H;
  this.layers[id] = canvas;
  this.contexts[id] = canvas.getContext('2d');
}

// NEW:
for (const id of ['map-bg', 'map-fog', 'map-grid', 'map-tokens', 'map-effects']) {
  const canvas = $(id);
  this.layers[id] = canvas;
  // The background canvas is fully opaque (we fill it with a solid color
  // before drawing the map image). Passing { alpha: false } tells the
  // browser it never needs to composite this layer's alpha channel,
  // saving one blending pass per frame. All other canvases need alpha
  // for transparency (fog holes, grid lines, token sprites).
  const ctxOptions = id === 'map-bg' ? { alpha: false } : undefined;
  this.contexts[id] = canvas.getContext('2d', ctxOptions);
}
this._resizeCanvases();

// ResizeObserver on the map container (not the canvases themselves)
this._resizeObserver = new ResizeObserver((entries) => {
  const entry = entries[0];
  let w, h;
  if (entry.borderBoxSize) {
    const box = entry.borderBoxSize[0];
    w = box.inlineSize;
    h = box.blockSize;
  } else {
    w = entry.contentRect.width;
    h = entry.contentRect.height;
  }
  this._onContainerResize(w, h);
});
this._resizeObserver.observe(container);
```

The resize handler:

```javascript
_onContainerResize(w, h) {
  if (w <= 0 || h <= 0) return;
  // Round to integers: canvas width/height must be integers
  const canvasW = Math.round(w);
  const canvasH = Math.round(h);

  // Only resize if dimensions actually changed (avoids clearing canvases)
  if (canvasW === this._canvasW && canvasH === this._canvasH) return;

  this._canvasW = canvasW;
  this._canvasH = canvasH;
  this._resizeCanvases();

  // Tell the camera about the actual canvas buffer size, not the raw
  // viewport size. When the resolution cap in _resizeCanvases() kicks
  // in, the canvas is smaller than the viewport and CSS stretches it
  // to fill. The camera must use the buffer dimensions so that
  // screenToWorld/worldToScreen produce coordinates in canvas-pixel
  // space (which is what ctx.setTransform operates in).
  //
  // When capped, the CSS-to-canvas ratio becomes the viewportScale,
  // reusing the same mechanism theater mode uses. eventToScreen()
  // divides by viewportScale, mapping CSS mouse coordinates into
  // canvas-buffer coordinates. Because _resizeCanvases scales both
  // dimensions proportionally, width ratio = height ratio.
  const actualW = Object.values(this.layers)[0].width;
  const actualH = Object.values(this.layers)[0].height;
  const capScale = canvasW / actualW;  // 1.0 when no cap, >1 when capped
  this.camera.setViewportScale(capScale);
  this.camera.setViewportSize(actualW, actualH);

  // Redraw everything (canvas buffers were cleared by the resize)
  this.redrawAll();
}

_resizeCanvases() {
  const w = this._canvasW || window.innerWidth;
  const h = this._canvasH || window.innerHeight;

  // Cap canvas buffer dimensions to prevent GPU memory exhaustion.
  // Five canvases at 4K (3840x2160) consume ~158 MB of GPU memory,
  // which is within budget. Without a cap, extreme viewports (5K
  // displays, future DPR-aware rendering) could exceed safe limits.
  // Chromium silently downsizes canvases that exceed GPU texture
  // limits, with no error event to detect it.
  //
  // Scale both dimensions proportionally to preserve the viewport's
  // aspect ratio. Without this, a 5120x1000 viewport would cap to
  // 4096x1000 (different aspect ratio), causing non-uniform CSS
  // stretching that distorts the map.
  const MAX_CANVAS_DIM = 4096;
  const scale = Math.min(1, MAX_CANVAS_DIM / w, MAX_CANVAS_DIM / h);
  const cappedW = Math.round(w * scale);
  const cappedH = Math.round(h * scale);

  for (const canvas of Object.values(this.layers)) {
    // Setting canvas.width/height clears the buffer AND resets context state.
    // This is unavoidable when the viewport resizes. The redrawAll() call
    // after resize repopulates all layers.
    if (canvas.width !== cappedW || canvas.height !== cappedH) {
      canvas.width = cappedW;
      canvas.height = cappedH;
    }
  }
}
```

### Why resizing canvases is OK here (and wasn't before)

A reasonable concern: setting `canvas.width` destroys all drawn content. In the old architecture, this was catastrophic because the canvas was the permanent backing store for the entire map. In the new architecture, the canvas is just a viewport into the world, redrawn every frame (or at least on every camera change). The `redrawAll()` method already clears and redraws everything. Resize simply triggers the same path.

The cost is one extra redraw per resize event. ResizeObserver fires at most once per animation frame, so this never causes multiple redraws per frame. For typical window resize operations (dragging a window edge), the user sees smooth adaptation at 60fps.

### Drawing methods need no structural changes

This is the beautiful part. The `drawBackground()`, `drawGrid()`, and `drawFog()` methods already use `camera.applyTransform(ctx)` to set up the context, then draw in world coordinates, then call `camera.resetTransform(ctx)`. Because the new camera's `applyTransform()` produces the correct world-to-screen matrix, these methods work without changes to their drawing logic.

The only change is to `clearRect`: it must clear the entire canvas, which is now viewport-sized:

```javascript
// OLD (in drawBackground, drawGrid, drawFog):
ctx.clearRect(0, 0, VTT_W, VTT_H);

// NEW:
ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
```

Here is the updated `drawBackground` for reference:

```javascript
drawBackground() {
  const ctx = this.contexts['map-bg'];
  this.camera.resetTransform(ctx);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (!this.bgImage || !this.currentMap) return;

  // Fill the entire viewport with the background color first.
  // This handles the case where the map doesn't cover the viewport
  // (zoomed out past cover level).
  ctx.fillStyle = '#0D0F14';  // Match --bg-0
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Apply camera transform: all subsequent drawing is in world space
  this.camera.applyTransform(ctx);

  const w = this.currentMap.cols * this.cellPx;
  const h = this.currentMap.rows * this.cellPx;
  ctx.drawImage(this.bgImage, 0, 0, w, h);

  this.camera.resetTransform(ctx);
}
```

### Updated drawGrid

```javascript
drawGrid() {
  const ctx = this.contexts['map-grid'];
  this.camera.resetTransform(ctx);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (!state.gridVisible || !this.currentMap) return;

  this.camera.applyTransform(ctx);

  const { cols, rows } = this.currentMap;
  const cp = this.cellPx;

  this._drawGridLines(ctx, cols, rows, cp, {
    stroke: 'rgba(255, 255, 255, 0.1)',
    width: 0.5 / this.camera.zoom,
    step: 1,
  });
  this._drawGridLines(ctx, cols, rows, cp, {
    stroke: 'rgba(255, 255, 255, 0.2)',
    width: 1 / this.camera.zoom,
    step: 5,
  });

  this.camera.resetTransform(ctx);
}
```

No change to the grid drawing logic itself. The `width: 0.5 / this.camera.zoom` pattern for zoom-compensated line widths continues to work correctly because the camera transform handles the world-to-screen mapping.

### Updated drawFog

```javascript
drawFog() {
  const ctx = this.contexts['map-fog'];
  this.camera.resetTransform(ctx);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (!this.currentMap) return;

  this.camera.applyTransform(ctx);

  const cp = this.cellPx;
  const { cols, rows } = this.currentMap;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (!this.fogRevealed.has(`${c},${r}`)) {
        ctx.fillRect(c * cp, r * cp, cp, cp);
      }
    }
  }

  this.camera.resetTransform(ctx);
}
```

### Updated loadMap

The map loading flow changes slightly because `fitToSize` now delegates to `setMapSize`:

```javascript
loadMap(mapId) {
  const mapDef = MAPS.find(m => m.id === mapId);
  if (!mapDef) return;

  this.currentMap = mapDef;
  state.mapId = mapId;

  this.cellPx = 1920 / mapDef.cols;
  // Note: we use float division (not Math.floor) to avoid rounding gaps.
  // Math.floor(1920 / 22) = 87, producing a world width of 87 * 22 = 1914,
  // six pixels short of 1920. That gap causes grid misalignment at the
  // right edge. With float division: 1920 / 22 ≈ 87.27, and
  // 87.27 * 22 = 1920 exactly. The canvas's subpixel rendering handles
  // the fractional coordinates cleanly.
  //
  // We still use 1920 as the reference width. This determines the
  // world-space pixel size of each grid cell, which is a property of
  // the MAP, not the viewport. A 48-column map with 40px cells produces
  // a 1920px-wide world. The camera then scales this world to fit
  // whatever viewport is available.
  //
  // KNOWN CONSTRAINT: This means all maps produce world dimensions
  // anchored at exactly 1920px width regardless of their source image
  // resolution. A 4000x3000 battle map image gets stretched/compressed
  // to 1920px world width, which is fine at typical zoom levels but
  // means we are not rendering at the image's native pixel resolution.
  // If native-resolution rendering becomes important (high-detail maps
  // viewed at 1:1 zoom), cellPx should be derived from the image's
  // actual dimensions instead. That change ripples into fog cell
  // storage and grid rendering, so it belongs in a future map-data
  // format revision, not Phase 1.
  this.gridSizeFt = mapDef.gridSize || 5;

  const worldW = mapDef.cols * this.cellPx;
  const worldH = mapDef.rows * this.cellPx;
  this._mapWorldW = worldW;
  this._mapWorldH = worldH;

  // Fog state
  if (state.fog[mapId]) {
    this.fogRevealed = new Set(state.fog[mapId]);
  } else {
    this.fogRevealed = new Set();
    for (let c = 0; c < mapDef.cols; c++) {
      for (let r = 0; r < mapDef.rows; r++) {
        this.fogRevealed.add(`${c},${r}`);
      }
    }
  }

  const img = new Image();
  img.onload = () => {
    this.bgImage = img;
    this.camera.fitToSize(worldW, worldH);  // calls setMapSize -> fitCover
    this.redrawAll();
  };
  img.onerror = () => {
    this.bgImage = this.generatePlaceholderMap(mapDef);
    this.camera.fitToSize(worldW, worldH);
    this.redrawAll();
  };
  img.src = mapDef.image;
}
```

### Updated camera:reset handler

```javascript
// In init():
EventBus.on('camera:reset', () => {
  if (this._mapWorldW && this._mapWorldH) {
    this.camera.fitCover();  // was: this.camera.fitToSize(...)
  }
});
```

### Updated mousemove for fog toggle cursor position

```javascript
// In init(), the mousemove handler for tracking cursor position:
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

---

## 5. Updating TokenManager

The TokenManager has three categories of coordinate work: input handling (`_screenCoords`), hit detection (`getTokenAt`), and rendering (`draw`, `drawTokenAt`). All three use the camera's coordinate conversion, so the changes are localized.

### Updated `_screenCoords`

```javascript
// OLD:
_screenCoords(e) {
  const rect = $('map-container').getBoundingClientRect();
  const vs = this.map.camera.viewportScale;
  return {
    x: (e.clientX - rect.left) / vs,
    y: (e.clientY - rect.top) / vs
  };
}

// NEW:
_screenCoords(e) {
  return this.map.camera.eventToScreen(e);
}
```

This centralizes coordinate conversion in the camera, eliminating the duplicated rect + viewportScale logic.

### Hit detection: `getTokenAt`

The `getTokenAt` method converts screen coordinates to world coordinates, then checks distance to each token's world position. The conversion call `this.map.camera.screenToWorld(screenX, screenY)` works identically in both old and new models (the method name is the same, the semantics are the same, only the internal formula differs). No change needed.

### Rendering: the `draw()` method

The token draw method uses `camera.applyTransform(ctx)` to render tokens in world space, then `camera.resetTransform(ctx)` before positioning DOM labels. This pattern is unchanged.

The one thing to update is the `clearRect` call:

```javascript
// In the draw() method:
// OLD:
ctx.clearRect(0, 0, 1920, 1080);

// NEW:
ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
```

### DOM label positioning

Token labels and HP bars are positioned in screen-space pixels relative to the map container. The current code uses `camera.worldToScreen()` to convert world positions to screen positions, then sets `left`/`top` in pixels. This continues to work because `worldToScreen` returns screen-space coordinates in both models.

The key subtlety: in the old model, screen-space was 1920×1080 (canvas space), and CSS transform scaled it to the actual viewport. In the new model, screen-space IS the actual viewport, so label positions map directly to visible pixels with no CSS transform distortion.

This actually *improves* label sharpness: DOM text positioned in the 1920×1080 space was rasterized at that resolution and then CSS-scaled, causing slight blurriness at fractional scales. Now labels are positioned in native viewport pixels and render crisply.

### Token menu positioning

The `showMenu` method positions the context menu using `_screenCoords`:

```javascript
// In showMenu():
const { x, y } = this._screenCoords({ clientX, clientY });
menu.style.left = x + 'px';
menu.style.top = y + 'px';
```

This works correctly with the new `_screenCoords` (which now delegates to `camera.eventToScreen`). The menu is positioned in screen-space pixels relative to the map container.

### Effects engine: clearing the right rectangle

`EffectsEngine` (`vtt/js/effects-engine.js`) has its own `const VTT_W = 1920; const VTT_H = 1080;` at module scope and uses them in `clearRect` calls within both `draw()` and `tick()`. The particle physics and AoE drawing are already in world-space (they go through `camera.applyTransform(ctx)`), so no coordinate math changes are needed. The only fix is the `clearRect` dimensions:

```javascript
// In draw():
ctx.setTransform(1, 0, 0, 1, 0, 0);
ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);  // was VTT_W, VTT_H

// In tick() (final canvas clear when animation ends):
ctx.setTransform(1, 0, 0, 1, 0, 0);
ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);  // was VTT_W, VTT_H
```

Remove the `const VTT_W = 1920; const VTT_H = 1080;` declarations from the module. If any other references to `VTT_W`/`VTT_H` exist in the file, audit them for the same pattern.

---

## 6. Viewport scaler and cover zoom integration

### The split personality: map mode vs. theater mode

The critical architectural decision is that **map mode and theater mode have different scaling strategies**.

Theater mode shows pre-composed artwork at a fixed aspect ratio. The CSS `transform: scale()` approach on the 1920×1080 container remains correct for theater mode. The artwork was designed at 1920×1080, the title cards and overlays are positioned in that space, and letterboxing is acceptable (even desirable, for a cinematic look).

Map mode shows an interactive canvas that should fill the viewport. The CSS transform is removed, the canvases resize to match the viewport, and the camera handles all scaling.

This means `viewport-scaler.js` needs to be mode-aware:

```javascript
// Updated viewport-scaler.js

import { EventBus } from './state.js';

const VTT_W = 1920;
const VTT_H = 1080;

let _scale = 1;
let _initialized = false;
let _mode = 'theater';  // current display mode
let _container = null;

export function getViewportScale() { return _scale; }

export function initViewportScaler() {
  if (_initialized) return;
  _initialized = true;
  _container = document.getElementById('vtt-scale-container');
  if (!_container) return;

  // Listen for mode changes to swap scaling strategies
  EventBus.on('mode:changed', ({ mode }) => {
    _mode = mode;
    update();
  });

  window.addEventListener('resize', update);
  update();
}

function update() {
  if (!_container) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw <= 0 || vh <= 0) return;

  if (_mode === 'theater') {
    // Theater mode: CSS-scale the 1920×1080 container (contain fit)
    const s = Math.min(vw / VTT_W, vh / VTT_H);
    if (Math.abs(s - _scale) < 0.0001) return;
    _scale = s;
    _container.style.transform = `scale(${s})`;
    _container.style.width = VTT_W + 'px';
    _container.style.height = VTT_H + 'px';
    EventBus.emit('viewport:scaled', { scale: s });
  } else {
    // Map/initiative mode: container fills viewport, no CSS transform
    _scale = 1;
    _container.style.transform = '';
    _container.style.width = '100%';
    _container.style.height = '100%';
    EventBus.emit('viewport:scaled', { scale: 1 });
  }
}
```

### Why this split is the right call

You might ask: "Why not use the world-space camera for theater mode too?" Theater mode doesn't have a camera. It displays a single full-screen image with DOM overlays (title cards, overlay text) positioned in 1920×1080 space. These overlays use CSS absolute positioning with pixel values designed for 1920×1080. Converting all of that to a camera system would require repositioning every overlay element, which is a lot of work for zero user-facing benefit. Theater mode already looks correct.

Map mode is where the black bars hurt. The camera system fixes map mode. Theater mode stays as-is.

### Mode transition: cleaning up when switching

When switching from theater to map mode, the canvases need to be resized to match the viewport. When switching back, they need to return to 1920×1080. The MapRenderer handles this via its ResizeObserver: when `#vtt-scale-container` changes from `width: 1920px` to `width: 100%`, the container's content box size changes, and the ResizeObserver fires, triggering `_onContainerResize`.

To ensure a clean transition, add a mode-change handler in MapRenderer:

```javascript
// In MapRenderer.init():
EventBus.on('mode:changed', ({ mode }) => {
  if (mode === 'map' || mode === 'initiative') {
    // Give the layout a frame to settle after the viewport scaler
    // changes the container dimensions
    requestAnimationFrame(() => {
      this._onContainerResize(
        this._el.clientWidth,
        this._el.clientHeight
      );
    });
  }
});
```

Where `this._el` is the `#map-container` element.

---

## 7. CSS changes

### layout.css updates

The `#vtt-scale-container` needs to support both fixed (theater) and fluid (map) sizing:

```css
@layer layout {
  #vtt-viewport {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
    overflow: hidden;
  }

  #vtt-scale-container {
    position: relative;
    /* Default: fixed 1920×1080 for theater mode.
       JS overrides to width:100%; height:100% in map mode. */
    width: var(--vtt-width);
    height: var(--vtt-height);
    overflow: hidden;
    transform-origin: center center;
  }

  .layer {
    position: absolute;
    inset: 0;
    /* Remove fixed width/height: let layers fill their container */
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .layer[hidden] { display: none; }
}
```

The `--vtt-width` and `--vtt-height` custom properties (defined in theme.css as `1920px` and `1080px`) continue to serve as the default. JavaScript overrides `width` and `height` directly on the element style when switching to map mode.

### map.css updates

The map canvas layers need to fill their container rather than using fixed dimensions:

```css
@layer components {
  #map-container {
    z-index: var(--z-map);
    background: var(--bg-0);
    cursor: grab;
  }

  #map-container.panning { cursor: grabbing; }
  #map-container.dragging-token { cursor: none; }

  /* Canvas layers fill the container */
  .map-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    image-rendering: auto;
  }

  /* Note: canvas.width and canvas.height attributes (the actual buffer
     dimensions) are set by JavaScript. The CSS width/height here just
     ensures the element visually fills the container. The canvas will
     scale its buffer to fit the CSS box. Because we set the buffer
     to match the CSS box in JS, there's no scaling distortion. */

  #map-bg    { z-index: 0; }
  #map-fog   { z-index: 1; }
  #map-grid  { z-index: 2; }
  #map-tokens { z-index: 3; }
  #map-effects { z-index: 4; }

  /* DOM overlay fills container */
  .map-labels {
    position: absolute;
    inset: 0;
    z-index: var(--z-map-labels);
    pointer-events: none;
  }
}
```

### Theater-mode layer sizing

Theater mode layers (the `#theater` div and its children) still need fixed 1920×1080 dimensions because their content is designed for that space. Add explicit sizing for theater elements:

```css
@layer components {
  /* Theater layer retains fixed dimensions */
  #theater {
    width: var(--vtt-width);
    height: var(--vtt-height);
  }

  .theater-bg {
    width: var(--vtt-width);
    height: var(--vtt-height);
    object-fit: cover;
  }
}
```

---

## 8. BroadcastChannel protocol additions

### New message type: CAMERA_STATE

The current protocol has `CAMERA_ZOOM`, `CAMERA_PAN`, and `CAMERA_RESET` as discrete commands. For Phase 4's continuous camera sync, we need a state-based message that transmits the entire camera position. Add it now so the infrastructure is in place:

```javascript
// In shared/protocol.js, add to MSG:
CAMERA_STATE: 'camera:state',

// Add to REQUIRED_FIELDS:
[MSG.CAMERA_STATE]: ['x', 'y', 'zoom'],

// Add factory function:
export function createCameraStateMsg(x, y, zoom) {
  return msg(MSG.CAMERA_STATE, { x, y, zoom });
}
```

### Handling CAMERA_STATE in vtt/js/state.js

```javascript
// In handleSyncMessage():
case MSG.CAMERA_STATE:
  EventBus.emit('camera:set-state', {
    x: msg.x,
    y: msg.y,
    zoom: msg.zoom
  });
  break;
```

### Camera listening for state messages

```javascript
// In Camera.attachTo():
EventBus.on('camera:set-state', ({ x, y, zoom }) => {
  this.setPosition(x, y, zoom);
});
```

This enables the Controller (or a future "DM View" window) to send absolute camera positions. Phase 4 will add throttled continuous broadcasting; for now, the message type exists and is handled correctly.

---

## 9. DOM overlay positioning

### The label coordinate system shift

In the old model, DOM labels were positioned in 1920×1080 space and CSS-scaled to the viewport. In the new model, they are positioned in viewport-space pixels. This means the `worldToScreen` values can be used directly as `style.left` and `style.top`.

The current label code in TokenManager already uses `camera.worldToScreen()`:

```javascript
const screenPos = cam.worldToScreen(cx, cy);
label.style.left = screenPos.x + 'px';
label.style.top  = screenPos.y + 'px';
```

This works correctly in the new model because `worldToScreen` returns viewport-space pixels. The `.map-labels` container is positioned with `inset: 0` to fill the map container, so absolute-positioned children at `(screenPos.x, screenPos.y)` appear at the correct viewport location.

### Token menu clamping

Token context menus need viewport-boundary clamping to prevent them from overflowing off-screen. In the old model, the "screen" was always 1920×1080. In the new model, use the actual viewport:

```javascript
showMenu(token, clientX, clientY) {
  const menu = this.menuEl;
  menu.textContent = '';
  menu.hidden = false;

  const screen = this._screenCoords({ clientX, clientY });

  // Position the menu
  menu.style.left = screen.x + 'px';
  menu.style.top = screen.y + 'px';

  // Build menu items (unchanged)
  // ...

  // After rendering, clamp to viewport bounds
  requestAnimationFrame(() => {
    const menuRect = menu.getBoundingClientRect();
    const containerRect = this.map._el
      ? this.map._el.getBoundingClientRect()
      : { right: window.innerWidth, bottom: window.innerHeight };

    if (menuRect.right > containerRect.right) {
      menu.style.left = (screen.x - menuRect.width) + 'px';
    }
    if (menuRect.bottom > containerRect.bottom) {
      menu.style.top = (screen.y - menuRect.height) + 'px';
    }
  });
}
```

---

## 10. Performance considerations

### GPU memory budget

Each canvas at viewport resolution consumes `width * height * 4 bytes` of GPU memory. Five canvases at 2560x1440 total approximately **73 MB** (`2560 * 1440 * 4 * 5`). At 3840x2160 (4K), that rises to **158 MB**. The `MAX_CANVAS_DIM = 4096` cap in `_resizeCanvases()` ensures this number cannot exceed ~**167 MB** (`4096 * 4096 * 4 * 5`), even on 5K displays or when DPR-aware rendering is added later. The `{ alpha: false }` option on the background canvas eliminates one alpha-blending pass per frame.

If you observe memory pressure on lower-end hardware, the fog canvas and effects canvas can be reduced to half resolution (rendering at `width/2 * height/2` and CSS-scaling up). Fog of war and effects are semi-transparent overlays that tolerate slight blurriness. The background canvas and token canvas should remain at full resolution for visual clarity.

### Redraw frequency and rAF coalescing

The camera emits `camera:changed` on every pan/zoom update. During a drag pan, this fires on every `mousemove` event (60-120Hz on desktop, higher with gaming mice). Without coalescing, every event triggers a synchronous `redrawAll()` across five canvases. Only the last redraw before the browser composites to screen is ever visible. All others are wasted GPU work.

This is not a theoretical concern. Konva.js documents the problem explicitly and provides `batchDraw()` as the solution. Excalidraw uses a `sceneNonce` invalidation counter. PixiJS runs a continuous `Ticker` loop. Every production canvas application coalesces state changes into a single render per frame.

More importantly, adding coalescing later means hunting down scattered direct `redrawAll()` calls throughout the codebase. Building the pattern in from day one establishes the right architecture: all state changes flow through `markDirty()`, and rendering happens exactly once per frame.

The pattern is a simple dirty-flag with `requestAnimationFrame`:

```javascript
// In MapRenderer, replace direct camera:changed → redrawAll binding:

// OLD (synchronous, wasteful):
// EventBus.on('camera:changed', () => this.redrawAll());

// NEW (coalesced):
this._rafPending = false;

EventBus.on('camera:changed', () => {
  if (this._rafPending) return;
  this._rafPending = true;
  requestAnimationFrame(() => {
    this._rafPending = false;
    this.redrawAll();
  });
});
```

**One exception:** `_onContainerResize` calls `redrawAll()` directly because the canvas buffers were just cleared by the resize and must be repopulated immediately. This is correct. `setViewportSize` also emits `camera:changed`, which schedules an additional rAF-coalesced `redrawAll()` later in the same frame. This second redraw is redundant but harmless (the full redraw is idempotent, and the cost is under 2ms). Eliminating it would require either suppressing the `camera:changed` emission during resize or adding a "just rendered" guard, neither of which is worth the complexity for a sub-2ms cost on an infrequent event.

### `will-change` and compositing layers

In the old architecture, `will-change: transform` on `#vtt-scale-container` told the browser to promote it to a GPU compositing layer for smooth CSS transform animation. In the new architecture, there is no CSS transform on the container in map mode, so `will-change: transform` is unnecessary and wastes GPU memory (the browser allocates a texture for the element).

Remove `will-change: transform` from `#vtt-scale-container` in CSS, and add it conditionally for theater mode via JavaScript if needed. In practice, theater mode transitions (crossfade between scenes) use CSS transitions on opacity, not transform, so `will-change` can likely be omitted entirely.

### `devicePixelRatio` and canvas sharpness (deferred)

On high-DPI displays (your 2560x1440 external monitor, for instance, if it runs at 2x DPR), canvases sized to CSS pixel dimensions render at half the physical pixel density. Map art will look slightly soft compared to native-resolution rendering. The fix is well-understood:

```javascript
// In _resizeCanvases(), multiply canvas buffer dimensions by DPR:
const dpr = window.devicePixelRatio || 1;
canvas.width  = containerW * dpr;
canvas.height = containerH * dpr;
// CSS dimensions stay at container size (handled by CSS width/height: 100%)
// Scale the context so drawing commands remain in CSS-pixel space:
ctx.scale(dpr, dpr);
```

This change also requires that every `clearRect` and `setTransform` call accounts for DPR, and the camera's `setViewportSize` must receive CSS-pixel dimensions (not physical pixels), so the coordinate math stays clean.

**This is intentionally deferred.** It touches every drawing path, interacts with the effects engine's particle rendering, and doubles GPU memory consumption on 2x displays. It belongs in a dedicated polish pass (Phase 4 or 5), where it can be implemented and tested in isolation. Noting it here so it does not come as a surprise when you first test on a Retina display and notice the softness.

---

## 11. Testing protocols

### Unit tests for coordinate conversion

The camera's coordinate conversion functions are pure math and easy to test in isolation. Create a test file that verifies the inverse relationship:

```javascript
// test/camera-math.test.js
import { Camera } from '../vtt/js/map-camera.js';

function assertClose(actual, expected, msg, tolerance = 0.001) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}

// Test: screenToWorld and worldToScreen are inverses
const cam = new Camera();
cam.x = 100;
cam.y = 200;
cam.zoom = 1.5;
cam.viewportW = 1920;
cam.viewportH = 1080;

const world = cam.screenToWorld(500, 300);
const screen = cam.worldToScreen(world.x, world.y);
assertClose(screen.x, 500, 'roundtrip screen.x');
assertClose(screen.y, 300, 'roundtrip screen.y');

// Test: cover zoom at 16:9 viewport with 16:9 map
cam.viewportW = 1920;
cam.viewportH = 1080;
cam.setMapSize(1920, 1080);
assertClose(cam._coverZoom, 1.0, 'cover zoom 16:9 match');

// Test: cover zoom at wider viewport
cam.viewportW = 2560;
cam.viewportH = 1080;
cam.setMapSize(1920, 1080);
// cover = max(2560/1920, 1080/1080) = max(1.333, 1.0) = 1.333
assertClose(cam._coverZoom, 2560 / 1920, 'cover zoom wide viewport');

// Test: cover zoom at taller viewport
cam.viewportW = 1920;
cam.viewportH = 1440;
cam.setMapSize(1920, 1080);
// cover = max(1920/1920, 1440/1080) = max(1.0, 1.333) = 1.333
assertClose(cam._coverZoom, 1440 / 1080, 'cover zoom tall viewport');

// Test: zoom-at-point preserves the world point under cursor
cam.x = 0;
cam.y = 0;
cam.zoom = 1.0;
const cursorX = 400;
const cursorY = 300;
const worldBeforeZoom = cam.screenToWorld(cursorX, cursorY);
cam.zoomAt(cursorX, cursorY, 1, 1.5);  // zoom in by 50%
const worldAfterZoom = cam.screenToWorld(cursorX, cursorY);
assertClose(worldAfterZoom.x, worldBeforeZoom.x, 'zoom-at x preserved');
assertClose(worldAfterZoom.y, worldBeforeZoom.y, 'zoom-at y preserved');

// Test: applyTransform produces correct matrix
cam.x = 100;
cam.y = 50;
cam.zoom = 2.0;
const mockCtx = { lastTransform: null };
mockCtx.setTransform = (a, b, c, d, e, f) => {
  mockCtx.lastTransform = { a, b, c, d, e, f };
};
cam.applyTransform(mockCtx);
assertClose(mockCtx.lastTransform.a, 2.0, 'transform scale x');
assertClose(mockCtx.lastTransform.d, 2.0, 'transform scale y');
assertClose(mockCtx.lastTransform.e, -200, 'transform translate x (-100 * 2)');
assertClose(mockCtx.lastTransform.f, -100, 'transform translate y (-50 * 2)');

// Test: fitCover centers the map
cam.viewportW = 2560;
cam.viewportH = 1080;
cam.setMapSize(1920, 1080);
// At cover zoom (1.333), visible width = 2560 / 1.333 = 1920
// visible height = 1080 / 1.333 = 810
// camera.x = (1920 - 1920) / 2 = 0
// camera.y = (1080 - 810) / 2 = 135
assertClose(cam.x, 0, 'fitCover center x');
assertClose(cam.y, 135, 'fitCover center y');

console.log('All camera math tests passed.');
```

### Visual regression tests (Playwright)

Create viewport-specific screenshot tests:

```javascript
// tests/viewport-filling.spec.js
import { test, expect } from '@playwright/test';

const viewports = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '2560x1440', width: 2560, height: 1440 },
  { name: '1280x800',  width: 1280, height: 800 },
  { name: '960x1080',  width: 960,  height: 1080 },
  { name: '3440x1440', width: 3440, height: 1440 },  // ultrawide
];

for (const vp of viewports) {
  test(`map fills viewport at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('http://localhost:8765/vtt/index.html');

    // Wait for load
    await page.waitForSelector('#loading[hidden]', { timeout: 10000 });

    // Switch to map mode
    await page.evaluate(() => {
      window.__vtt?.store?.state && (window.__vtt.store.state.mode = 'map');
    });
    await page.waitForTimeout(500);

    // Verify no black bars: check that the map container fills the viewport
    const containerRect = await page.evaluate(() => {
      const el = document.getElementById('map-container');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };
    });

    expect(containerRect).not.toBeNull();
    // Container should fill the viewport (within 1px tolerance)
    expect(containerRect.left).toBeLessThanOrEqual(1);
    expect(containerRect.top).toBeLessThanOrEqual(1);
    expect(containerRect.width).toBeGreaterThanOrEqual(vp.width - 2);
    expect(containerRect.height).toBeGreaterThanOrEqual(vp.height - 2);

    // Visual screenshot for regression
    await expect(page).toHaveScreenshot(`map-${vp.name}.png`, {
      maxDiffPixelRatio: 0.01
    });
  });
}

test('theater mode retains letterboxing', async ({ page }) => {
  // Theater mode should still show letterbox bars at non-16:9 aspect ratios
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://localhost:8765/vtt/index.html');
  await page.waitForSelector('#loading[hidden]', { timeout: 10000 });

  // Should be in theater mode by default
  const containerTransform = await page.evaluate(() => {
    const el = document.getElementById('vtt-scale-container');
    return window.getComputedStyle(el).transform;
  });

  // Should have a CSS transform (not 'none')
  expect(containerTransform).not.toBe('none');
});

test('zoom-to-cursor preserves world point', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:8765/vtt/index.html');
  await page.waitForSelector('#loading[hidden]', { timeout: 10000 });

  // Switch to map mode and wait for map
  await page.evaluate(() => {
    window.__vtt?.store?.state && (window.__vtt.store.state.mode = 'map');
  });
  await page.waitForTimeout(500);

  // Get world coords at viewport center before zoom
  const worldBefore = await page.evaluate(() => {
    const cam = window.__vtt?.mapRenderer?.camera;
    if (!cam) return null;
    return cam.screenToWorld(960, 540);
  });

  // Ctrl+scroll at viewport center to zoom in
  await page.mouse.move(960, 540);
  await page.mouse.wheel(0, -100);  // scroll up = zoom in
  await page.waitForTimeout(100);

  // Get world coords at same screen point after zoom
  const worldAfter = await page.evaluate(() => {
    const cam = window.__vtt?.mapRenderer?.camera;
    if (!cam) return null;
    return cam.screenToWorld(960, 540);
  });

  // World point under cursor should be preserved (within tolerance)
  if (worldBefore && worldAfter) {
    expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(2);
    expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(2);
  }
});
```

### Manual testing checklist

Run through this by hand after the code changes are in place:

1. **Cold start at 1920×1080**: Load VTT. Theater mode should display correctly. Switch to map mode. Map should fill the entire viewport with no black bars.

2. **Resize to 1280×800**: Drag the window smaller. Map should resize and refill the viewport. No black bars at any point during the resize.

3. **Ultrawide (3440×1440 or simulate)**: The map should fill the full width, cropping the top and bottom. No pillarbox bars.

4. **Portrait-ish (960×1080)**: Half-screen on a 1080p monitor. The map should fill height, cropping left and right.

5. **Pan with right-click drag**: Grab the map and drag. Movement should feel natural (drag direction matches map movement). No jitter, no coordinate offset.

6. **Zoom with scroll wheel**: Scroll to zoom at the viewport center. Zoom in, zoom out. Smooth, no jumps.

7. **Zoom toward cursor**: Position cursor at a map feature (a specific room or landmark). Scroll to zoom. The feature should stay under the cursor throughout the zoom.

8. **Token placement**: Switch to token placing mode. Click to place a token. The token should appear at the clicked grid cell. Drag the token. It should follow the cursor.

9. **Token context menu**: Right-click a token. The menu should appear at the click position, not offset.

10. **Fog toggle**: Ctrl+click a grid cell. Fog should toggle on that cell. Verify the clicked cell matches the visual position.

11. **Mode switching**: Switch theater to map to initiative and back. Each mode should display correctly. No layout artifacts from the previous mode.

12. **Grid overlay**: Toggle the grid. Lines should be pixel-crisp (width-compensated by zoom level). Grid should align with token positions.

13. **Controller camera commands**: Open the Controller. Click the camera pan arrows. Verify the VTT responds. Click zoom buttons. Verify zoom.

14. **Ruler tool**: Shift+click and drag to measure distance. The ruler should follow the cursor accurately. Distance readout should be correct.

---

## 12. Migration checklist

This is the ordered list of changes for Claude Code. Each item references the section above that provides the implementation.

1. **Update `vtt/js/map-camera.js`** with the complete new Camera class (Section 3). This is a full file replacement. Key changes from the old Camera: world-space coordinate model, cover-zoom floor, `setViewportSize` enforcement logic, and `deltaMode` normalization in the wheel handler.

2. **Update `vtt/js/viewport-scaler.js`** to be mode-aware (Section 6). Add mode:changed listener, swap between CSS-scale (theater) and no-transform (map/initiative).

3. **Update `vtt/js/map-renderer.js`**:
   - Replace hardcoded canvas sizing with ResizeObserver (Section 4, "Canvas sizing")
   - Pass `{ alpha: false }` when creating the `map-bg` canvas context (Section 4, free compositing win)
   - Add `MAX_CANVAS_DIM = 4096` resolution cap in `_resizeCanvases` with proportional aspect-ratio scaling (Section 4, prevents GPU memory exhaustion on 5K+ displays)
   - Add `viewportScale` adjustment in `_onContainerResize` for when the resolution cap produces a smaller buffer than the CSS viewport (Section 4)
   - Use float division for `cellPx` (`1920 / cols`, not `Math.floor`) to eliminate rounding gaps at map edges (Section 7, "loadMap")
   - Wire `camera:changed` through rAF coalescing instead of synchronous `redrawAll` (Section 10, "Redraw frequency")
   - Update `clearRect` calls from `VTT_W, VTT_H` to `ctx.canvas.width, ctx.canvas.height`
   - Update `drawBackground` to fill viewport with background color before drawing map
   - Update `mousemove` handler to use `camera.eventToScreen()`
   - Update `camera:reset` handler to call `camera.fitCover()`
   - Add `mode:changed` handler for resize on mode switch

4. **Update `vtt/js/token-manager.js`**:
   - Replace `_screenCoords` with delegation to `camera.eventToScreen()`
   - Update `clearRect` calls
   - Update menu positioning for viewport-space coordinates

5. **Update `vtt/js/effects-engine.js`**:
   - Remove the module-level `const VTT_W = 1920; const VTT_H = 1080;`
   - In `draw()`: change `ctx.clearRect(0, 0, VTT_W, VTT_H)` to `ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)`
   - In `tick()` (final clear): same `clearRect` update
   - The rest of the effects engine (particle positions, AoE highlights) already operates in world-space through `camera.applyTransform(ctx)`, so no coordinate math changes are needed

6. **Update `vtt/css/layout.css`**:
   - Change `.layer` from fixed width/height to `width: 100%; height: 100%`
   - Keep `#vtt-scale-container` defaults for theater mode

7. **Update `vtt/css/map.css`**:
   - Change `.map-canvas` from `width: var(--vtt-width); height: var(--vtt-height)` to `width: 100%; height: 100%`
   - Change `.map-labels` from fixed dimensions to `inset: 0`

8. **Add theater-specific sizing** in `vtt/css/theater.css`:
   - Ensure `#theater` and `.theater-bg` retain `var(--vtt-width)` and `var(--vtt-height)`

9. **Update `shared/protocol.js`**:
   - Add `CAMERA_STATE` message type and factory function (Section 8)

10. **Update `vtt/js/state.js`**:
    - Add handler for `MSG.CAMERA_STATE` (Section 8)

11. **Update `vtt/js/main.js`**:
    - Verify `initViewportScaler()` is called before map renderer initialization
    - Expose `mapRenderer` on `window.__vtt` for testing access

12. **Invalidate any saved camera state.** If the VTT persists camera positions (localStorage, BroadcastChannel snapshots, state files), add a version check that discards pre-migration camera data. The coordinate system has flipped from screen-space to world-space, and the default zoom has changed from contain-fit to cover-fit, so old values will produce incorrect results.

13. **Run the test suite** (Section 11): unit tests for camera math, visual regression with Playwright, manual testing checklist.

---

## 13. What Phase 2 expects from this foundation

Phase 2 (Input handling) builds directly on the coordinate conversion and zoom infrastructure established here. Specifically, it expects:

- **`camera.eventToScreen(e)`** works correctly for all input events. Phase 2 adds keyboard shortcuts and trackpad gesture normalization. All of these use `eventToScreen` as their entry point. The rAF coalescing pattern from Phase 1 (§10) ensures these additional input sources don't cause redundant redraws.

- **`camera.zoomAt(sx, sy, direction, factor)`** accepts arbitrary zoom factors. Phase 2 replaces the fixed `ZOOM_FACTOR` with exponential zoom steps: `zoom *= Math.pow(2, deltaY * -0.01)`. The four-step algorithm in `zoomAt` remains unchanged; only the factor changes.

- **`camera.viewportW` and `camera.viewportH`** are always current. Phase 2 uses these for boundary detection (is the cursor near a viewport edge? apply edge-pan acceleration).

- **`camera.serialize()` and `camera.deserialize()`** produce and consume resolution-independent state. Phase 4 uses these for continuous cross-window sync at 30fps.

Phase 3 (Boundary clamping) expects:

- **`camera._coverZoom`** is always up to date. Phase 3 uses it as the zoom floor: `camera.zoom = Math.max(camera.zoom, camera._coverZoom)`. The dynamic recalculation on resize (already implemented in `_updateCoverZoom`) makes this safe.

- **`camera.x`, `camera.y`** are world-space positions. Phase 3's clamping logic (`camera.x = clamp(camera.x, 0, mapW - visibleW)`) reads naturally in world-space. In screen-space, the same clamping would require sign-inverted bounds, which is error-prone.

Phase 5 (Advanced features) expects:

- **`camera.setPosition(x, y, zoom)`** enables saved camera presets. The DM saves "Preset: Grand Hall" as `{ x: 420, y: 180, zoom: 2.5 }`, and recalling it is a single method call.

- **`camera.fitContain()`** is available for a "show entire map" button. The DM clicks "zoom extents," and the camera smoothly animates to `fitContain`. (The animation is Phase 5; the target calculation is Phase 1.)

- **`camera.serialize()`** includes `mapW` and `mapH`, enabling a receiving window to calculate its own cover zoom. This is essential for the "spectator window" feature where a fourth window shows the map at a different size.

The world-space camera model you build in Phase 1 is the mathematical spine of the entire viewport system. Every subsequent phase is arithmetic on top of `{ x, y, zoom }`.
