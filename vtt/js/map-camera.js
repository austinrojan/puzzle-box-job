// ============================================
// VTT Map Camera — Zoom, pan, coordinate transforms
// ============================================

import { EventBus } from './state.js';

const VTT_W = 1920;
const VTT_H = 1080;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 4.0;
const ZOOM_FACTOR = 1.04;          // Fine step for scroll/pinch (4% per tick)
const ZOOM_FACTOR_KEY = 1.15;      // Larger step for keyboard/button zoom
const DRAG_THRESHOLD = 3;          // px before a click becomes a drag

export class Camera {
  constructor() {
    this.x = 0;       // world offset X (pixels)
    this.y = 0;       // world offset Y (pixels)
    this.zoom = 1.0;
    this._panning = false;
    this._pendingPan = false;       // left-click: waiting to see if drag or token click
    this._panStartX = 0;
    this._panStartY = 0;
    this._panStartCamX = 0;
    this._panStartCamY = 0;
    this._panButton = -1;
    this._panDist = 0;
    this.spaceHeld = false;
    this.viewportScale = 1;
    this._el = null;
  }

  setViewportScale(s) { this.viewportScale = s; }

  // Convert screen coordinates to world coordinates
  screenToWorld(sx, sy) {
    return {
      x: (sx - this.x) / this.zoom,
      y: (sy - this.y) / this.zoom
    };
  }

  // Convert world coordinates to screen coordinates
  worldToScreen(wx, wy) {
    return {
      x: wx * this.zoom + this.x,
      y: wy * this.zoom + this.y
    };
  }

  // Apply camera transform to a canvas context
  applyTransform(ctx) {
    ctx.setTransform(this.zoom, 0, 0, this.zoom, this.x, this.y);
  }

  // Reset transform to identity
  resetTransform(ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // Zoom centered on a screen point (direction: +1 in, -1 out)
  zoomAt(sx, sy, direction, factor = ZOOM_FACTOR) {
    const oldZoom = this.zoom;
    const newZoom = direction > 0
      ? this.zoom * factor
      : this.zoom / factor;
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));

    // Adjust offset so the point under cursor stays fixed
    const ratio = this.zoom / oldZoom;
    this.x = sx - (sx - this.x) * ratio;
    this.y = sy - (sy - this.y) * ratio;

    EventBus.emit('camera:changed');
  }

  // Zoom centered on viewport midpoint (for keyboard/button zoom)
  zoomToCenter(direction, factor = ZOOM_FACTOR_KEY) {
    this.zoomAt(VTT_W / 2, VTT_H / 2, direction, factor);
  }

  // Pan by screen-space delta
  panBy(dx, dy) {
    this.x += dx;
    this.y += dy;
    EventBus.emit('camera:changed');
  }

  // Reset to fit a given world size in the viewport
  fitToSize(worldW, worldH) {
    const scaleX = VTT_W / worldW;
    const scaleY = VTT_H / worldH;
    this.zoom = Math.min(scaleX, scaleY, MAX_ZOOM);
    this.x = (VTT_W - worldW * this.zoom) / 2;
    this.y = (VTT_H - worldH * this.zoom) / 2;
    EventBus.emit('camera:changed');
  }

  // Start a confirmed pan operation
  _startPan(e, button) {
    this._panning = true;
    this._pendingPan = false;
    this._panButton = button;
    this._panStartX = e.clientX;
    this._panStartY = e.clientY;
    this._panStartCamX = this.x;
    this._panStartCamY = this.y;
    this._panDist = 0;
    this._setPanCursor(true);
  }

  // Commit a pending left-click pan (after threshold exceeded)
  _commitPan() {
    this._panning = true;
    this._pendingPan = false;
    this._panButton = 0;
    this._setPanCursor(true);
  }

  // Cancel any active or pending pan (safety net for lost focus/mouse)
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

  // Attach mouse handlers to an element
  attachTo(el) {
    this._el = el;

    // --- Wheel: pinch/Ctrl+scroll = zoom, two-finger/regular scroll = pan ---
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Pinch-to-zoom (trackpad) or Ctrl+scroll (mouse)
        const rect = el.getBoundingClientRect();
        const sx = (e.clientX - rect.left) / this.viewportScale;
        const sy = (e.clientY - rect.top) / this.viewportScale;
        const direction = e.deltaY < 0 ? 1 : -1;
        this.zoomAt(sx, sy, direction);
      } else {
        // Two-finger scroll (trackpad) or plain scroll (mouse) → pan
        this.panBy(-e.deltaX / this.viewportScale, -e.deltaY / this.viewportScale);
      }
    }, { passive: false });

    // --- Mouse down ---
    el.addEventListener('mousedown', (e) => {
      // Middle-click pan
      if (e.button === 1) {
        e.preventDefault();
        this._startPan(e, 1);
        return;
      }
      // Right-click pan
      if (e.button === 2) {
        this._startPan(e, 2);
        return;
      }
      // Space + left-click pan (immediate, no threshold)
      if (e.button === 0 && this.spaceHeld) {
        e.preventDefault();
        e.stopPropagation();
        this._startPan(e, 0);
        return;
      }
      // Left-click: start pending pan (deferred until drag threshold)
      // Token manager may claim this click; we check in mousemove.
      if (e.button === 0) {
        this._pendingPan = true;
        this._panStartX = e.clientX;
        this._panStartY = e.clientY;
        this._panStartCamX = this.x;
        this._panStartCamY = this.y;
        this._panDist = 0;
      }
    });

    // --- Mouse move: handle pending or active pan ---
    window.addEventListener('mousemove', (e) => {
      // Check pending left-click pan
      if (this._pendingPan) {
        // If token manager grabbed this click, cancel pending pan
        if (window.__vtt?.tokenManager?._dragging) {
          this._pendingPan = false;
          return;
        }
        const dist = Math.abs(e.clientX - this._panStartX) + Math.abs(e.clientY - this._panStartY);
        if (dist > DRAG_THRESHOLD) {
          this._commitPan();
          // Fall through to pan logic below
        } else {
          return;
        }
      }

      if (!this._panning) return;
      // Convert screen-space delta to internal-space delta
      const dx = (e.clientX - this._panStartX) / this.viewportScale;
      const dy = (e.clientY - this._panStartY) / this.viewportScale;
      // Track distance in screen space for drag threshold comparison
      this._panDist = Math.max(this._panDist, Math.abs(e.clientX - this._panStartX) + Math.abs(e.clientY - this._panStartY));
      this.x = this._panStartCamX + dx;
      this.y = this._panStartCamY + dy;
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
      if (this._panDist > DRAG_THRESHOLD) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    // --- Space key tracking for space+drag pan ---
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

    // --- EventBus handlers ---
    EventBus.on('camera:pan', ({ dx, dy }) => this.panBy(dx, dy));
    EventBus.on('camera:zoom', (direction) => this.zoomToCenter(direction));

    // Cancel pan if window loses focus or mouse leaves the map
    window.addEventListener('blur', () => this._cancelPan());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._cancelPan();
    });
    el.addEventListener('mouseleave', () => {
      if (this._panning) this._cancelPan();
    });
  }
}
