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
   */
  setViewportSize(w, h) {
    if (w <= 0 || h <= 0) return;

    const oldCoverZoom = this._coverZoom;

    this.viewportW = w;
    this.viewportH = h;
    this._updateCoverZoom();

    // If the camera was sitting at (or below) the old cover zoom,
    // snap to the new floor and re-center.
    if (oldCoverZoom > 0 && this.zoom <= oldCoverZoom + 0.001) {
      this.zoom = this._coverZoom;
      this._centerMap();
    }

    EventBus.emit('camera:changed');
  }

  /**
   * Set the viewport scale factor (CSS transform on container).
   * In map mode with the new architecture, this should be 1.0.
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
   */
  fitToSize(worldW, worldH) {
    this.setMapSize(worldW, worldH);
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
   */
  zoomAt(sx, sy, direction, factor = ZOOM_FACTOR) {
    // 1. World point under cursor before zoom
    const worldBefore = this.screenToWorld(sx, sy);

    // 2. Update zoom
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
   * A rightward mouse drag (positive dx) should move the camera LEFT
   * in world space, revealing content to the right. Hence the sign
   * inversion and division by zoom.
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

      // Normalize deltaY across browsers
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
        const screen = this.eventToScreen(e);
        const direction = dy < 0 ? 1 : -1;
        this.zoomAt(screen.x, screen.y, direction);
      } else {
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

      const dxScreen = e.clientX - this._panStartX;
      const dyScreen = e.clientY - this._panStartY;

      this._panScreenDist = Math.max(
        this._panScreenDist,
        Math.abs(dxScreen) + Math.abs(dyScreen)
      );

      // World-space position: start position minus screen delta / zoom
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
    EventBus.on('camera:set-state', ({ x, y, zoom }) => this.setPosition(x, y, zoom));

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
