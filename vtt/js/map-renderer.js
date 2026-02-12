// VTT Map Renderer — Multi-canvas layer stack

import { EventBus, state, store } from './state.js';
import { MAPS } from './data.js';
import { Camera } from './map-camera.js';

const $ = id => document.getElementById(id);

export class MapRenderer {
  constructor() {
    this.camera = new Camera();
    this.currentMap = null;
    this.bgImage = null;
    this.fogRevealed = new Set();
    this.layers = {};
    this.contexts = {};
    this.cellPx = 40;
    this.gridSizeFt = 5;
    this._mapWorldW = 0;
    this._mapWorldH = 0;
    this._canvasW = 0;
    this._canvasH = 0;
    this._el = null;
    this._rafPending = false;
    this._resizeObserver = null;
  }

  init() {
    const container = $('map-container');

    for (const id of ['map-bg', 'map-fog', 'map-grid', 'map-tokens', 'map-effects']) {
      const canvas = $(id);
      this.layers[id] = canvas;
      const ctxOptions = id === 'map-bg' ? { alpha: false } : undefined;
      this.contexts[id] = canvas.getContext('2d', ctxOptions);
    }
    this._el = container;
    this._resizeCanvases();

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

    this.camera.attachTo(container);

    this._rafPending = false;
    EventBus.on('camera:changed', () => {
      if (this._rafPending) return;
      this._rafPending = true;
      requestAnimationFrame(() => {
        this._rafPending = false;
        this.redrawAll();
      });
    });
    EventBus.on('map:load', (mapId) => this.loadMap(mapId));
    store.subscribe('gridVisible', () => this.drawGrid());
    EventBus.on('fog:toggle', () => this.toggleFogAtCursor());
    EventBus.on('fog:reveal-all', () => this.revealAllFog());
    EventBus.on('fog:hide-all', () => this.hideAllFog());
    EventBus.on('mode:changed', ({ mode }) => {
      if (mode === 'map' || mode === 'initiative') {
        requestAnimationFrame(() => {
          this._onContainerResize(
            this._el.clientWidth,
            this._el.clientHeight
          );
        });
      }
    });
    EventBus.on('camera:reset', () => {
      if (this._mapWorldW && this._mapWorldH) {
        this.camera.fitCover();
      }
    });

    this._mouseX = 0;
    this._mouseY = 0;
    container.addEventListener('mousemove', (e) => {
      const screen = this.camera.eventToScreen(e);
      this._mouseX = screen.x;
      this._mouseY = screen.y;
    });

    if (state.mapId) {
      this.loadMap(state.mapId);
    }
  }

  _onContainerResize(w, h) {
    if (w <= 0 || h <= 0) return;
    const canvasW = Math.round(w);
    const canvasH = Math.round(h);
    if (canvasW === this._canvasW && canvasH === this._canvasH) return;
    this._canvasW = canvasW;
    this._canvasH = canvasH;
    this._resizeCanvases();
    const actualW = Object.values(this.layers)[0].width;
    const actualH = Object.values(this.layers)[0].height;
    const capScale = canvasW / actualW;
    this.camera.setViewportScale(capScale);
    this.camera.setViewportSize(actualW, actualH);
    this.redrawAll();
  }

  _resizeCanvases() {
    const w = this._canvasW || window.innerWidth;
    const h = this._canvasH || window.innerHeight;
    const MAX_CANVAS_DIM = 4096;
    const scale = Math.min(1, MAX_CANVAS_DIM / w, MAX_CANVAS_DIM / h);
    const cappedW = Math.round(w * scale);
    const cappedH = Math.round(h * scale);
    for (const canvas of Object.values(this.layers)) {
      if (canvas.width !== cappedW || canvas.height !== cappedH) {
        canvas.width = cappedW;
        canvas.height = cappedH;
      }
    }
  }

  loadMap(mapId) {
    const mapDef = MAPS.find(m => m.id === mapId);
    if (!mapDef) return;

    this.currentMap = mapDef;
    state.mapId = mapId;

    this.cellPx = 1920 / mapDef.cols;
    this.gridSizeFt = mapDef.gridSize || 5;

    const worldW = mapDef.cols * this.cellPx;
    const worldH = mapDef.rows * this.cellPx;
    this._mapWorldW = worldW;
    this._mapWorldH = worldH;

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
      this.camera.fitToSize(worldW, worldH);
      this.redrawAll();
    };
    img.onerror = () => {
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

    for (let i = 0; i < 2000; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const alpha = Math.random() * 0.08;
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.fillRect(x, y, 1, 1);
    }

    ctx.fillStyle = '#8B7435';
    ctx.font = '600 24px "Cinzel", serif';
    ctx.textAlign = 'center';
    ctx.fillText(mapDef.title, w / 2, h / 2 - 10);

    ctx.fillStyle = '#6B6B78';
    ctx.font = '14px "IBM Plex Mono", monospace';
    ctx.fillText(`${mapDef.id} — ${mapDef.cols}x${mapDef.rows} grid`, w / 2, h / 2 + 20);

    const img = new Image();
    img.src = canvas.toDataURL();
    return img;
  }

  redrawAll() {
    this.drawBackground();
    this.drawFog();
    this.drawGrid();
    EventBus.emit('map:redraw', { camera: this.camera, cellPx: this.cellPx });
  }

  drawBackground() {
    const ctx = this.contexts['map-bg'];
    this.camera.resetTransform(ctx);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    if (!this.bgImage || !this.currentMap) return;

    ctx.fillStyle = '#0D0F14';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    this.camera.applyTransform(ctx);
    const w = this.currentMap.cols * this.cellPx;
    const h = this.currentMap.rows * this.cellPx;
    ctx.drawImage(this.bgImage, 0, 0, w, h);
    this.camera.resetTransform(ctx);
  }

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

  _drawGridLines(ctx, cols, rows, cp, { stroke, width, step }) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let c = 0; c <= cols; c += step) {
      ctx.moveTo(c * cp, 0);
      ctx.lineTo(c * cp, rows * cp);
    }
    for (let r = 0; r <= rows; r += step) {
      ctx.moveTo(0, r * cp);
      ctx.lineTo(cols * cp, r * cp);
    }
    ctx.stroke();
  }

  drawFog() {
    const ctx = this.contexts['map-fog'];
    this.camera.resetTransform(ctx);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    if (!this.currentMap) return;

    this.camera.applyTransform(ctx);

    const { cols, rows } = this.currentMap;
    const cp = this.cellPx;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(0, 0, cols * cp, rows * cp);

    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 1)';

    for (const key of this.fogRevealed) {
      const [col, row] = key.split(',').map(Number);
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

    this._syncFog();
  }

  revealAllFog() {
    if (!this.currentMap) return;
    const { cols, rows } = this.currentMap;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        this.fogRevealed.add(`${c},${r}`);
      }
    }
    this._syncFog();
  }

  hideAllFog() {
    if (!this.currentMap) return;
    this.fogRevealed.clear();
    this._syncFog();
  }

  _syncFog() {
    store.patch({ fog: { ...state.fog, [this.currentMap.id]: [...this.fogRevealed] } });
    this.drawFog();
  }

}
