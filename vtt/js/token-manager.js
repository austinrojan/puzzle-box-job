// VTT Token Manager — Rendering, drag-drop, context menu

import { EventBus, state } from './state.js';
import { TOKENS, MAP_PRESETS, CONDITIONS, CONDITION_COLORS } from './data.js';
import { resolveCSSVar } from './utils.js';
import { EdgePanManager } from './edge-pan.js';

const $ = id => document.getElementById(id);
const TOKEN_RADIUS_FACTOR = 0.35;  // fraction of cellPx for token radius (0.42 was original)
const CLICK_TOLERANCE = 0.03;     // extra radius fraction for click detection

export class TokenManager {
  constructor(mapRenderer) {
    this.map = mapRenderer;
    this.tokens = [];
    this.canvas = null;
    this.ctx = null;
    this.labelsEl = null;
    this.menuEl = null;

    this._dragging = null;
    this._dragScreenX = 0;
    this._dragScreenY = 0;

    this._imageCache = {};
    this._tokensByMap = {};
    this._currentMapId = null;

    this._ruler = null;
    this._rulerDragging = false;
    this._trayEl = null;
    this._trayOpen = false;
    this._placing = null;
    this._placingGhostPos = null;

    this._nextId = 1;
    this._edgePan = null;

    this._drawRafPending = false;
    this._drawRafId = null;
  }

  /** Coalesce high-frequency draw requests into a single rAF frame. */
  _requestDraw() {
    if (this._drawRafPending) return;
    this._drawRafPending = true;
    this._drawRafId = requestAnimationFrame(() => {
      this._drawRafPending = false;
      this._drawRafId = null;
      this.draw();
    });
  }

  init() {
    this.canvas = $('map-tokens');
    this.ctx = this.canvas.getContext('2d');
    this.labelsEl = $('map-labels');
    this.menuEl = $('token-menu');

    const container = $('map-container');

    container.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));

    container.addEventListener('contextmenu', (e) => {
      const { x: sx, y: sy } = this._screenCoords(e);
      const token = this.getTokenAt(sx, sy);
      if (token) {
        e.preventDefault();
        this.showMenu(token, e.clientX, e.clientY);
      }
    });

    document.addEventListener('click', () => this.closeMenu());
    EventBus.on('menu:close', () => {
      this.closeMenu();
      if (this._ruler) { this._ruler = null; this._requestDraw(); }
    });

    EventBus.on('map:redraw', () => this._requestDraw());

    EventBus.on('brazier:toggle', ({ index, lit }) => {
      const braziers = this.getBrazierTokens();
      if (index < braziers.length) {
        const token = braziers[index];
        const wasLit = token.tokenId === 'brazier-lit';
        const newId = lit ? 'brazier-lit' : 'brazier-dead';
        this.swapToken(token.id, newId);
        // Auto-fire extinguish effect when a brazier goes from lit → dead
        if (wasLit && !lit) {
          EventBus.emit('effect:trigger', { effectId: 'brazier-extinguish', col: token.col, row: token.row });
        }
      }
    });

    EventBus.on('brazier:toggle-all', () => this.toggleAllBraziers());
    EventBus.on('map:load', (mapId) => this._onMapSwitch(mapId));

    EventBus.on('token:add', ({ tokenId, x, y, label }) => { this.addToken(tokenId, x, y, { label }); });
    EventBus.on('token:remove-all', () => { this.tokens = []; this._drawAndSync(); });
    EventBus.on('token:load-preset', (presetId) => { this.loadPreset(presetId); });

    EventBus.on('token:update-condition', ({ instanceId, condition, enabled }) => {
      const token = this.tokens.find(t => t.id === instanceId);
      if (!token) return;
      if (enabled && !token.conditions.includes(condition)) {
        token.conditions.push(condition);
      } else if (!enabled) {
        token.conditions = token.conditions.filter(c => c !== condition);
      }
      this._drawAndSync();
    });

    EventBus.on('token:remove-one', (instanceId) => {
      this.removeToken(instanceId);
    });

    EventBus.on('token:visibility', ({ instanceId, visible }) => {
      const token = this.tokens.find(t => t.id === instanceId);
      if (token) { token.visible = visible; this._drawAndSync(); }
    });

    EventBus.on('token-tray:toggle', () => this.toggleTray());
    EventBus.on('token-tray:cancel-placing', () => this.cancelPlacing());
    this.initTray();

    for (const tokenId of Object.keys(TOKENS)) {
      this.loadTokenImage(tokenId);
    }

    this._edgePan = new EdgePanManager(this.map.camera);
  }

  _buildToken(tokenId, col, row, def, opts = {}) {
    return {
      id: 't' + (this._nextId++),
      tokenId,
      col,
      row,
      label: opts.label || def.displayName || def.name,
      visible: opts.visible !== false,
      conditions: Array.isArray(opts.conditions) ? [...opts.conditions] : [],
      hp: opts.hp ?? null,
      maxHp: opts.maxHp ?? null,
      size: def.size || 1,
    };
  }

  addToken(tokenId, col, row, opts = {}) {
    const def = TOKENS[tokenId];
    if (!def) return null;

    const token = this._buildToken(tokenId, col, row, def, opts);
    this.tokens.push(token);
    this.loadTokenImage(tokenId);
    this._drawAndSync();
    return token;
  }

  removeToken(id) {
    this.tokens = this.tokens.filter(t => t.id !== id);
    this._drawAndSync();
  }

  _emitTokensChanged() {
    state.tokens = this.tokens.map(t => ({
      id: t.id, tokenId: t.tokenId, label: t.label,
      col: t.col, row: t.row, visible: t.visible,
      conditions: [...t.conditions]
    }));
    // Store subscribeAll auto-broadcasts to controller
  }

  _screenCoords(e) {
    return this.map.camera.eventToScreen(e);
  }

  _drawAndSync() {
    this.draw();
    this._emitTokensChanged();
  }

  swapToken(id, newTokenId) {
    const token = this.tokens.find(t => t.id === id);
    const def = TOKENS[newTokenId];
    if (!token || !def) return;
    token.tokenId = newTokenId;
    token.label = def.displayName || def.name;
    token.size = def.size || 1;
    this.loadTokenImage(newTokenId);
    this._drawAndSync();
  }

  getBrazierTokens() {
    return this.tokens
      .filter(t => t.tokenId === 'brazier-lit' || t.tokenId === 'brazier-dead')
      .sort((a, b) => a.row - b.row || a.col - b.col);
  }

  toggleBrazier(id) {
    const token = this.tokens.find(t => t.id === id);
    if (!token) return;
    const newId = token.tokenId === 'brazier-lit' ? 'brazier-dead' : 'brazier-lit';
    this.swapToken(id, newId);
  }

  toggleAllBraziers() {
    for (const t of this.getBrazierTokens()) {
      this.toggleBrazier(t.id);
    }
  }

  _saveCurrentMapTokens() {
    if (this._currentMapId) {
      this._tokensByMap[this._currentMapId] = this.tokens.slice();
    }
  }

  _onMapSwitch(mapId) {
    this._saveCurrentMapTokens();
    this._currentMapId = mapId;
    this.tokens = this._tokensByMap[mapId] ? this._tokensByMap[mapId].slice() : [];
    this._drawAndSync();
  }

  // Restore tokens from a serialized snapshot (e.g. from persistence).
  restoreTokens(serialized) {
    if (!Array.isArray(serialized) || serialized.length === 0) return;

    this.tokens = [];
    this._nextId = 1;

    for (const t of serialized) {
      const def = TOKENS[t.tokenId];
      if (!def) continue;
      this.tokens.push(this._buildToken(t.tokenId, t.col, t.row, def, t));
    }

    this._saveCurrentMapTokens();

    this._drawAndSync();
  }

  loadPreset(presetId) {
    const preset = MAP_PRESETS[presetId];
    if (!preset) return;

    this.tokens = [];
    for (const t of preset.tokens) {
      const def = TOKENS[t.tokenId];
      if (!def) continue;
      this.tokens.push(this._buildToken(t.tokenId, t.x, t.y, def, { label: t.label }));
      this.loadTokenImage(t.tokenId);
    }
    this._saveCurrentMapTokens();
    this._drawAndSync();
  }

  initTray() {
    const trayEl = $('token-tray');
    const closeBtn = trayEl.querySelector('.token-tray__close');
    const sectionsEl = trayEl.querySelector('.token-tray__sections');
    this._trayEl = trayEl;

    closeBtn.addEventListener('click', () => this.closeTray());

    const groups = { 'Player Characters': [], 'NPCs': [], 'Objects': [] };
    for (const [id, def] of Object.entries(TOKENS)) {
      if (def.isPC) groups['Player Characters'].push({ id, def });
      else if (def.isObject) groups['Objects'].push({ id, def });
      else groups['NPCs'].push({ id, def });
    }

    for (const [label, items] of Object.entries(groups)) {
      if (items.length === 0) continue;
      const sectionLabel = document.createElement('div');
      sectionLabel.className = 'token-tray__section-label';
      sectionLabel.textContent = label;
      sectionsEl.appendChild(sectionLabel);

      for (const { id, def } of items) {
        const item = document.createElement('div');
        item.className = 'token-tray__item';
        item.dataset.tokenId = id;

        const thumb = document.createElement('img');
        thumb.className = 'token-tray__thumb';
        thumb.src = def.image;
        thumb.alt = def.name;
        thumb.style.borderColor = resolveCSSVar(def.border);
        thumb.onerror = () => { thumb.style.display = 'none'; };

        const name = document.createElement('span');
        name.className = 'token-tray__name';
        name.textContent = def.displayName || def.name;

        item.appendChild(thumb);
        item.appendChild(name);
        item.addEventListener('click', () => this.startPlacing(id));
        sectionsEl.appendChild(item);
      }
    }
  }

  toggleTray() {
    this._trayOpen ? this.closeTray() : this.openTray();
  }

  openTray() {
    this._trayEl.hidden = false;
    this._trayOpen = true;
  }

  closeTray() {
    this._trayEl.hidden = true;
    this._trayOpen = false;
    this.cancelPlacing();
  }

  startPlacing(tokenId) {
    this._placing = tokenId;
    this._placingGhostPos = null;
    $('map-container').classList.add('placing-token');
    for (const item of this._trayEl.querySelectorAll('.token-tray__item')) {
      item.classList.toggle('token-tray__item--active', item.dataset.tokenId === tokenId);
    }
  }

  cancelPlacing() {
    this._placing = null;
    this._placingGhostPos = null;
    $('map-container').classList.remove('placing-token');
    if (this._trayEl) {
      for (const item of this._trayEl.querySelectorAll('.token-tray__item')) {
        item.classList.remove('token-tray__item--active');
      }
    }
    this._requestDraw();
  }

  loadTokenImage(tokenId) {
    if (this._imageCache[tokenId]) return;

    const def = TOKENS[tokenId];
    if (!def) return;

    const img = new Image();
    img.onload = () => {
      this._imageCache[tokenId] = img;
      this._requestDraw();
    };
    img.onerror = () => {
      this._imageCache[tokenId] = this.generatePlaceholderToken(def);
      this._requestDraw();
    };
    img.src = def.image;
  }

  generatePlaceholderToken(def) {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.fillStyle = '#1A1F2B';
    ctx.fill();

    const initials = def.name.split(' ').map(w => w[0]).join('').substring(0, 2);
    ctx.fillStyle = '#E8C55A';
    ctx.font = 'bold 48px "Cinzel", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, size / 2, size / 2);

    return canvas;
  }

  draw() {
    const ctx = this.ctx;
    const cam = this.map.camera;
    const cp = this.map.cellPx;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const updateLabels = !this._dragging;
    if (updateLabels) this.labelsEl.textContent = '';

    cam.applyTransform(ctx);

    for (const token of this.tokens) {
      if (!token.visible) continue;

      const def = TOKENS[token.tokenId];
      if (!def) continue;

      const img = this._imageCache[token.tokenId];
      const tokenSize = (token.size || 1) * cp;
      const x = token.col * cp;
      const y = token.row * cp;
      const cx = x + tokenSize / 2;
      const cy = y + tokenSize / 2;
      const radius = tokenSize * TOKEN_RADIUS_FACTOR;

      if (this._dragging && this._dragging.id === token.id) {
        this.drawTokenAt(ctx, token, def, img, this._dragScreenX, this._dragScreenY, radius, cp);
        continue;
      }

      this._drawTokenCircle(ctx, cx, cy, radius, def, img, cam.zoom);

      if (token.conditions.length > 0) {
        this.drawConditionDots(ctx, cx, cy, radius, token.conditions, cam.zoom);
      }

      if (updateLabels) {
        const screenPos = cam.worldToScreen(cx, y + tokenSize + 4);
        const displayLabel = token.label || def.displayName || def.name;
        this.addLabel(displayLabel, screenPos.x, screenPos.y);

        if (token.hp !== null && token.maxHp) {
          const hpScreen = cam.worldToScreen(cx, y + tokenSize + 18);
          this.addHPBar(token.hp, token.maxHp, hpScreen.x, hpScreen.y);
        }
      }
    }

    this.drawRuler(ctx, cam, cp);
    this._drawPlacementGhost(ctx, cam, cp);

    cam.resetTransform(ctx);
  }

  _drawPlacementGhost(ctx, cam, cp) {
    if (!this._placing || !this._placingGhostPos) return;
    const def = TOKENS[this._placing];
    if (!def) return;

    const img = this._imageCache[this._placing];
    const world = cam.screenToWorld(this._placingGhostPos.x, this._placingGhostPos.y);
    const gx = (Math.floor(world.x / cp) + 0.5) * cp;
    const gy = (Math.floor(world.y / cp) + 0.5) * cp;
    const radius = cp * TOKEN_RADIUS_FACTOR;

    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(gx, gy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = resolveCSSVar(def.border);
    ctx.lineWidth = 2 / cam.zoom;
    ctx.setLineDash([4 / cam.zoom, 4 / cam.zoom]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(gx, gy, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, gx - radius, gy - radius, radius * 2, radius * 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1.0;
  }

  drawRuler(ctx, cam, cp) {
    if (!this._ruler) return;
    const { startCol, startRow, endCol, endRow } = this._ruler;
    const gridFt = this.map.gridSizeFt || 5;

    // Cell centers in world coords
    const x1 = (startCol + 0.5) * cp;
    const y1 = (startRow + 0.5) * cp;
    const x2 = (endCol + 0.5) * cp;
    const y2 = (endRow + 0.5) * cp;

    const dx = Math.abs(endCol - startCol);
    const dy = Math.abs(endRow - startRow);
    const cells = Math.max(dx, dy);
    const feet = cells * gridFt;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = '#E8C55A';
    ctx.lineWidth = 3 / cam.zoom;
    ctx.setLineDash([6 / cam.zoom, 4 / cam.zoom]);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const [px, py] of [[x1, y1], [x2, y2]]) {
      ctx.beginPath();
      ctx.arc(px, py, 5 / cam.zoom, 0, Math.PI * 2);
      ctx.fillStyle = '#E8C55A';
      ctx.fill();
    }

    if (cells > 0) {
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const screenMid = cam.worldToScreen(midX, midY);

      const label = document.createElement('div');
      label.className = 'token-label';
      label.style.left = screenMid.x + 'px';
      label.style.top = (screenMid.y - 14) + 'px';
      label.style.color = '#E8C55A';
      label.style.fontSize = '13px';
      label.style.fontWeight = '700';
      label.textContent = `${feet} ft`;
      this.labelsEl.appendChild(label);

      if (cells > 1) {
        const subLabel = document.createElement('div');
        subLabel.className = 'token-label';
        subLabel.style.left = screenMid.x + 'px';
        subLabel.style.top = (screenMid.y + 2) + 'px';
        subLabel.style.color = '#A0A0A8';
        subLabel.style.fontSize = '10px';
        subLabel.textContent = `(${cells} cells)`;
        this.labelsEl.appendChild(subLabel);
      }
    }
  }

  _drawTokenCircle(ctx, cx, cy, radius, def, img, zoom) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 2 / zoom, 0, Math.PI * 2);
    ctx.strokeStyle = resolveCSSVar(def.border);
    ctx.lineWidth = 3 / zoom;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    if (img) {
      ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
    } else {
      ctx.fillStyle = '#1A1F2B';
      ctx.fill();
    }
    ctx.restore();
  }

  drawTokenAt(ctx, token, def, img, screenX, screenY, radius, cp) {
    const cam = this.map.camera;
    cam.resetTransform(ctx);

    const world = cam.screenToWorld(screenX, screenY);
    cam.applyTransform(ctx);

    const cx = world.x;
    const cy = world.y;

    ctx.globalAlpha = 0.7;

    this._drawTokenCircle(ctx, cx, cy, radius, def, img, cam.zoom);

    ctx.globalAlpha = 1.0;

    const snapCol = Math.floor(world.x / cp);
    const snapRow = Math.floor(world.y / cp);
    const snapX = (snapCol + 0.5) * cp;
    const snapY = (snapRow + 0.5) * cp;

    ctx.beginPath();
    ctx.arc(snapX, snapY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(232, 197, 90, 0.3)';
    ctx.lineWidth = 2 / cam.zoom;
    ctx.setLineDash([4 / cam.zoom, 4 / cam.zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawConditionDots(ctx, cx, cy, radius, conditions, zoom) {
    const dotRadius = 4 / zoom;

    for (const [i, cond] of conditions.entries()) {
      const angle = (Math.PI * 2 * i) / Math.max(conditions.length, 6) - Math.PI / 2;
      const dx = Math.cos(angle) * (radius + 6 / zoom);
      const dy = Math.sin(angle) * (radius + 6 / zoom);

      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = CONDITION_COLORS[cond] || '#A0A0A8';
      ctx.fill();
    }
  }

  addLabel(text, x, y) {
    const el = document.createElement('div');
    el.className = 'token-label';
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    this.labelsEl.appendChild(el);
  }

  addHPBar(hp, maxHp, x, y) {
    const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
    const wrapper = document.createElement('div');
    wrapper.className = 'token-hp';
    wrapper.style.left = x + 'px';
    wrapper.style.top = y + 'px';

    const fill = document.createElement('div');
    let colorClass = 'token-hp__fill--healthy';
    if (pct <= 25) colorClass = 'token-hp__fill--critical';
    else if (pct <= 50) colorClass = 'token-hp__fill--wounded';
    fill.className = 'token-hp__fill ' + colorClass;
    fill.style.width = pct + '%';

    wrapper.appendChild(fill);
    this.labelsEl.appendChild(wrapper);
  }

  getTokenAt(screenX, screenY) {
    const world = this.map.camera.screenToWorld(screenX, screenY);
    const cp = this.map.cellPx;

    for (let i = this.tokens.length - 1; i >= 0; i--) {
      const token = this.tokens[i];
      if (!token.visible) continue;
      const size = (token.size || 1) * cp;
      const tx = token.col * cp + size / 2;
      const ty = token.row * cp + size / 2;
      const dist = Math.hypot(world.x - tx, world.y - ty);
      if (dist <= size * (TOKEN_RADIUS_FACTOR + CLICK_TOLERANCE)) return token;
    }
    return null;
  }

  onMouseDown(e) {
    if (e.button !== 0) return;
    if (this.map.camera.spaceHeld) return;

    const { x: sx, y: sy } = this._screenCoords(e);

    if (e.shiftKey) {
      const world = this.map.camera.screenToWorld(sx, sy);
      const col = Math.floor(world.x / this.map.cellPx);
      const row = Math.floor(world.y / this.map.cellPx);
      this._ruler = { startCol: col, startRow: row, endCol: col, endRow: row };
      this._rulerDragging = true;
      e.stopPropagation();
      this._requestDraw();
      return;
    }

    if (this._ruler) {
      this._ruler = null;
      this._requestDraw();
    }

    if (this._placing) {
      const world = this.map.camera.screenToWorld(sx, sy);
      const col = Math.floor(world.x / this.map.cellPx);
      const row = Math.floor(world.y / this.map.cellPx);
      this.addToken(this._placing, col, row);
      e.stopPropagation();
      return;
    }

    const token = this.getTokenAt(sx, sy);
    if (!token) return;

    e.stopPropagation();
    this._dragging = token;
    this._dragScreenX = sx;
    this._dragScreenY = sy;
    $('map-container').classList.add('dragging-token');
    this.labelsEl.style.display = 'none';
    if (this._edgePan) this._edgePan.startTracking();
    this._requestDraw();
  }

  onMouseMove(e) {
    if (this._rulerDragging) {
      const { x, y } = this._screenCoords(e);
      const world = this.map.camera.screenToWorld(x, y);
      this._ruler.endCol = Math.floor(world.x / this.map.cellPx);
      this._ruler.endRow = Math.floor(world.y / this.map.cellPx);
      this._requestDraw();
      return;
    }

    if (this._placing) {
      this._placingGhostPos = this._screenCoords(e);
      this._requestDraw();
      return;
    }

    if (!this._dragging) return;
    const { x, y } = this._screenCoords(e);
    this._dragScreenX = x;
    this._dragScreenY = y;
    if (this._edgePan) this._edgePan.updateCursor(x, y);
    this._requestDraw();
  }

  onMouseUp(e) {
    if (this._rulerDragging) {
      this._rulerDragging = false;
      return;
    }

    if (!this._dragging) return;
    if (this._edgePan) this._edgePan.stopTracking();

    // Cancel any pending rAF so _drawAndSync() below is the authoritative final frame
    if (this._drawRafId) {
      cancelAnimationFrame(this._drawRafId);
      this._drawRafId = null;
      this._drawRafPending = false;
    }

    const world = this.map.camera.screenToWorld(this._dragScreenX, this._dragScreenY);
    this._dragging.col = Math.floor(world.x / this.map.cellPx);
    this._dragging.row = Math.floor(world.y / this.map.cellPx);

    this._dragging = null;
    $('map-container').classList.remove('dragging-token');
    this._drawAndSync();
    this.labelsEl.style.display = '';
  }

  _menuItem(menu, label, onClick, modifier) {
    const el = document.createElement('div');
    el.className = 'token-menu__item' + (modifier ? ' ' + modifier : '');
    el.textContent = label;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
      this.closeMenu();
    });
    menu.appendChild(el);
  }

  _menuDivider(menu) {
    const el = document.createElement('div');
    el.className = 'token-menu__divider';
    menu.appendChild(el);
  }

  showMenu(token, clientX, clientY) {
    const menu = this.menuEl;
    menu.textContent = '';
    menu.hidden = false;
    // Convert to internal space — menu is inside the scale container
    const { x, y } = this._screenCoords({ clientX, clientY });
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const label = document.createElement('div');
    label.className = 'token-menu__label';
    label.textContent = token.label;
    menu.appendChild(label);

    this._menuDivider(menu);

    if (token.tokenId === 'brazier-lit' || token.tokenId === 'brazier-dead') {
      const isLit = token.tokenId === 'brazier-lit';
      this._menuItem(menu, isLit ? 'Extinguish' : 'Relight', () => {
        this.toggleBrazier(token.id);
      });
      this._menuDivider(menu);
    }

    for (const { id: cond } of CONDITIONS) {
      const has = token.conditions.includes(cond);
      const text = (has ? '\u2713 ' : '') + cond.charAt(0).toUpperCase() + cond.slice(1);
      this._menuItem(menu, text, () => {
        if (has) {
          token.conditions = token.conditions.filter(c => c !== cond);
        } else {
          token.conditions.push(cond);
        }
        this._drawAndSync();
      });
    }

    this._menuDivider(menu);

    this._menuItem(menu, token.visible ? 'Hide Token' : 'Show Token', () => {
      token.visible = !token.visible;
      this._drawAndSync();
    });

    this._menuItem(menu, 'Remove', () => {
      this.removeToken(token.id);
    }, 'token-menu__item--danger');
  }

  closeMenu() {
    this.menuEl.hidden = true;
    this.menuEl.textContent = '';
  }
}
