// ============================================
// VTT Map Renderer — Multi-canvas layer stack
// Background, fog, grid, tokens, effects
// ============================================

import { EventBus, state } from './state.js';
import { MAPS } from './data.js';
import { Camera } from './map-camera.js';

const $ = id => document.getElementById(id);
const VTT_W = 1920;
const VTT_H = 1080;

export class MapRenderer {
  constructor() {
    this.camera = new Camera();
    this.currentMap = null;
    this.bgImage = null;
    this.gridVisible = true;
    this.fogRevealed = new Set(); // "col,row" strings

    // Canvas layers
    this.layers = {};
    this.contexts = {};

    // Grid config (pixels per cell, derived from map)
    this.cellPx = 40; // default, recalculated when map loads

    // World dimensions of current map (for fit-to-map reset)
    this._mapWorldW = 0;
    this._mapWorldH = 0;
  }

  init() {
    const container = $('map-container');

    // Initialize canvas layers
    for (const id of ['map-bg', 'map-fog', 'map-grid', 'map-tokens', 'map-effects']) {
      const canvas = $(id);
      canvas.width = VTT_W;
      canvas.height = VTT_H;
      this.layers[id] = canvas;
      this.contexts[id] = canvas.getContext('2d');
    }

    // Attach camera controls to map container
    this.camera.attachTo(container);

    // Listen for events
    EventBus.on('camera:changed', () => this.redrawAll());
    EventBus.on('map:load', (mapId) => this.loadMap(mapId));
    EventBus.on('grid:toggle', () => {
      this.gridVisible = !this.gridVisible;
      this.drawGrid();
    });
    EventBus.on('fog:toggle', () => this.toggleFogAtCursor());
    EventBus.on('fog:reveal-all', () => this.revealAllFog());
    EventBus.on('fog:hide-all', () => this.hideAllFog());
    EventBus.on('mode:changed', ({ mode }) => {
      if (mode === 'map' || mode === 'initiative') this.redrawAll();
    });
    EventBus.on('camera:reset', () => {
      if (this._mapWorldW && this._mapWorldH) {
        this.camera.fitToSize(this._mapWorldW, this._mapWorldH);
      }
    });

    // Track mouse position for fog toggle
    this._mouseX = 0;
    this._mouseY = 0;
    container.addEventListener('mousemove', (e) => {
      const rect = container.getBoundingClientRect();
      this._mouseX = e.clientX - rect.left;
      this._mouseY = e.clientY - rect.top;
    });

    // Load first map if in map mode
    if (state.mapId) {
      this.loadMap(state.mapId);
    }
  }

  loadMap(mapId) {
    const mapDef = MAPS.find(m => m.id === mapId);
    if (!mapDef) return;

    this.currentMap = mapDef;
    state.mapId = mapId;

    // Calculate cell size: map image fills the canvas, grid aligns to it
    // The cell size in pixels depends on how many cells fit in the viewport
    this.cellPx = Math.floor(VTT_W / mapDef.cols);
    this.gridSizeFt = mapDef.gridSize || 5;  // feet per cell (D&D standard)

    // World size is the full grid
    const worldW = mapDef.cols * this.cellPx;
    const worldH = mapDef.rows * this.cellPx;
    this._mapWorldW = worldW;
    this._mapWorldH = worldH;

    // Load fog state for this map (default: fully revealed so map is visible)
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

    // Load background image
    const img = new Image();
    img.onload = () => {
      this.bgImage = img;
      this.camera.fitToSize(worldW, worldH);
      this.redrawAll();
    };
    img.onerror = () => {
      // Generate placeholder map
      this.bgImage = this.generatePlaceholderMap(mapDef);
      this.camera.fitToSize(worldW, worldH);
      this.redrawAll();
    };
    img.src = mapDef.image;
  }

  generatePlaceholderMap(mapDef) {
    const w = mapDef.cols * this.cellPx;
    const h = mapDef.rows * this.cellPx;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // Dark stone floor pattern
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.6);
    grad.addColorStop(0, '#1E2233');
    grad.addColorStop(1, '#12151E');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle noise texture
    for (let i = 0; i < 2000; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const alpha = Math.random() * 0.08;
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.fillRect(x, y, 1, 1);
    }

    // Map title
    ctx.fillStyle = '#8B7435';
    ctx.font = '600 24px "Cinzel", serif';
    ctx.textAlign = 'center';
    ctx.fillText(mapDef.title, w / 2, h / 2 - 10);

    ctx.fillStyle = '#6B6B78';
    ctx.font = '14px "IBM Plex Mono", monospace';
    ctx.fillText(`${mapDef.id} — ${mapDef.cols}x${mapDef.rows} grid`, w / 2, h / 2 + 20);

    // Convert to Image
    const img = new Image();
    img.src = canvas.toDataURL();
    return img;
  }

  redrawAll() {
    this.drawBackground();
    this.drawFog();
    this.drawGrid();
    // Token drawing is handled by token-manager
    EventBus.emit('map:redraw', { camera: this.camera, cellPx: this.cellPx });
  }

  drawBackground() {
    const ctx = this.contexts['map-bg'];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, VTT_W, VTT_H);

    if (!this.bgImage || !this.currentMap) return;

    this.camera.applyTransform(ctx);
    const w = this.currentMap.cols * this.cellPx;
    const h = this.currentMap.rows * this.cellPx;
    ctx.drawImage(this.bgImage, 0, 0, w, h);
    this.camera.resetTransform(ctx);
  }

  drawGrid() {
    const ctx = this.contexts['map-grid'];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, VTT_W, VTT_H);

    if (!this.gridVisible || !this.currentMap) return;

    this.camera.applyTransform(ctx);

    const { cols, rows } = this.currentMap;
    const cp = this.cellPx;

    // Fine grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 0.5 / this.camera.zoom;

    ctx.beginPath();
    for (let c = 0; c <= cols; c++) {
      ctx.moveTo(c * cp, 0);
      ctx.lineTo(c * cp, rows * cp);
    }
    for (let r = 0; r <= rows; r++) {
      ctx.moveTo(0, r * cp);
      ctx.lineTo(cols * cp, r * cp);
    }
    ctx.stroke();

    // Bold lines every 5 cells (25ft)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1 / this.camera.zoom;

    ctx.beginPath();
    for (let c = 0; c <= cols; c += 5) {
      ctx.moveTo(c * cp, 0);
      ctx.lineTo(c * cp, rows * cp);
    }
    for (let r = 0; r <= rows; r += 5) {
      ctx.moveTo(0, r * cp);
      ctx.lineTo(cols * cp, r * cp);
    }
    ctx.stroke();

    this.camera.resetTransform(ctx);
  }

  drawFog() {
    const ctx = this.contexts['map-fog'];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, VTT_W, VTT_H);

    if (!this.currentMap) return;

    this.camera.applyTransform(ctx);

    const { cols, rows } = this.currentMap;
    const cp = this.cellPx;

    // Fill entire map with fog
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(0, 0, cols * cp, rows * cp);

    // Cut out revealed cells
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 1)';

    for (const key of this.fogRevealed) {
      const [col, row] = key.split(',').map(Number);
      // Slightly larger cutout for smooth edges
      ctx.fillRect(col * cp - 1, row * cp - 1, cp + 2, cp + 2);
    }

    ctx.globalCompositeOperation = 'source-over';
    this.camera.resetTransform(ctx);
  }

  toggleFogAtCursor() {
    if (!this.currentMap) return;

    const world = this.camera.screenToWorld(this._mouseX, this._mouseY);
    const col = Math.floor(world.x / this.cellPx);
    const row = Math.floor(world.y / this.cellPx);

    if (col < 0 || col >= this.currentMap.cols || row < 0 || row >= this.currentMap.rows) return;

    const key = `${col},${row}`;

    // Toggle a 3x3 area around cursor for faster reveal
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || c >= this.currentMap.cols || r < 0 || r >= this.currentMap.rows) continue;
        const k = `${c},${r}`;
        if (this.fogRevealed.has(key)) {
          this.fogRevealed.delete(k);
        } else {
          this.fogRevealed.add(k);
        }
      }
    }

    // Persist fog state
    state.fog[this.currentMap.id] = [...this.fogRevealed];
    this.drawFog();
  }

  // Reveal all fog cells for current map (remote command from DM Guide)
  revealAllFog() {
    if (!this.currentMap) return;
    const { cols, rows } = this.currentMap;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        this.fogRevealed.add(`${c},${r}`);
      }
    }
    state.fog[this.currentMap.id] = [...this.fogRevealed];
    this.drawFog();
  }

  // Hide all fog cells for current map (remote command from DM Guide)
  hideAllFog() {
    if (!this.currentMap) return;
    this.fogRevealed.clear();
    state.fog[this.currentMap.id] = [];
    this.drawFog();
  }

  // Reveal all fog (for exploration maps)
  revealAll() {
    if (!this.currentMap) return;
    const { cols, rows } = this.currentMap;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        this.fogRevealed.add(`${c},${r}`);
      }
    }
    state.fog[this.currentMap.id] = [...this.fogRevealed];
    this.drawFog();
  }

  // Get grid cell from screen coordinates
  screenToCell(sx, sy) {
    const world = this.camera.screenToWorld(sx, sy);
    return {
      col: Math.floor(world.x / this.cellPx),
      row: Math.floor(world.y / this.cellPx)
    };
  }

  // Get screen center of a grid cell
  cellToScreen(col, row) {
    const worldX = (col + 0.5) * this.cellPx;
    const worldY = (row + 0.5) * this.cellPx;
    return this.camera.worldToScreen(worldX, worldY);
  }
}
