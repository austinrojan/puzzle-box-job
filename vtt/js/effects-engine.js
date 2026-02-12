// ============================================
// VTT Effects Engine — Particles, AoE, spell VFX
// ============================================

import { EventBus } from './state.js';
import { EFFECTS } from './data.js';

const $ = id => document.getElementById(id);

// --- Particle ---
class Particle {
  constructor(x, y, vx, vy, life, color, size, opts = {}) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.maxLife = life;
    this.color = color;
    this.size = size;
    this.gravity = opts.gravity || 0;
    this.drag = opts.drag || 0.98;
    this.fadeOut = opts.fadeOut !== false;
    this.shrink = opts.shrink || false;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += this.gravity * dt;
    this.vx *= this.drag;
    this.vy *= this.drag;
    this.life -= dt;
  }

  get alpha() {
    if (!this.fadeOut) return 1;
    return Math.max(0, this.life / this.maxLife);
  }

  get currentSize() {
    if (!this.shrink) return this.size;
    return this.size * Math.max(0.1, this.life / this.maxLife);
  }

  get dead() { return this.life <= 0; }
}

// --- Emitter ---
class Emitter {
  constructor(opts) {
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.rate = opts.rate || 20;       // particles per second
    this.life = opts.life || 1;        // emitter lifetime (seconds)
    this.particleLife = opts.particleLife || 0.8;
    this.speed = opts.speed || 100;
    this.spread = opts.spread || Math.PI * 2;  // radians
    this.angle = opts.angle || 0;      // base direction
    this.color = opts.color || '#FFD700';
    this.size = opts.size || 4;
    this.gravity = opts.gravity || 0;
    this.drag = opts.drag || 0.98;
    this.fadeOut = opts.fadeOut !== false;
    this.shrink = opts.shrink || false;
    this._accum = 0;
    this.persistent = opts.persistent || false;
  }

  update(dt) {
    if (!this.persistent) this.life -= dt;
    this._accum += dt;
    const interval = 1 / this.rate;
    const particles = [];
    while (this._accum >= interval) {
      this._accum -= interval;
      const a = this.angle + (Math.random() - 0.5) * this.spread;
      const s = this.speed * (0.5 + Math.random() * 0.5);
      particles.push(new Particle(
        this.x, this.y,
        Math.cos(a) * s, Math.sin(a) * s,
        this.particleLife * (0.5 + Math.random() * 0.5),
        this.color, this.size * (0.5 + Math.random() * 0.5),
        { gravity: this.gravity, drag: this.drag, fadeOut: this.fadeOut, shrink: this.shrink }
      ));
    }
    return particles;
  }

  get dead() { return !this.persistent && this.life <= 0; }
}

// --- Effects Engine ---
export class EffectsEngine {
  constructor(mapRenderer) {
    this.map = mapRenderer;
    this.canvas = null;
    this.ctx = null;
    this.particles = [];
    this.emitters = [];
    this.persistentEffects = [];  // AoE highlights, auras
    this._running = false;
    this._lastTime = 0;
  }

  init() {
    this.canvas = $('map-effects');
    this.ctx = this.canvas.getContext('2d');

    EventBus.on('effect:trigger', (msg) => this.triggerEffect(msg));
    EventBus.on('map:redraw', () => this.drawPersistent());
    EventBus.on('menu:close', () => this.clearPersistent());  // Escape clears persistent effects
  }

  triggerEffect(msg) {
    const effectId = msg.effectId || msg.id;
    const def = EFFECTS[effectId];
    if (!def) {
      console.warn('[VTT Effects] Unknown effect:', effectId);
      return;
    }

    // If this is a persistent effect and already active, toggle it off
    if (def.persistent) {
      const existing = this.persistentEffects.find(e => e.effectId === effectId);
      if (existing) {
        this.clearPersistent();
        return;
      }
    }

    // Target position (grid coordinates or screen center)
    const targetCol = msg.col ?? Math.floor((this.map.currentMap?.cols || 12) / 2);
    const targetRow = msg.row ?? Math.floor((this.map.currentMap?.rows || 8) / 2);
    const cp = this.map.cellPx;
    const worldX = (targetCol + 0.5) * cp;
    const worldY = (targetRow + 0.5) * cp;

    // Track persistent effects count before spawning
    const prevPersistentCount = this.persistentEffects.length;

    // Build the effect based on type
    switch (def.type) {
      case 'burst': this.spawnBurst(worldX, worldY, def); break;
      case 'aoe-sphere': this.spawnAoESphere(worldX, worldY, def); break;
      case 'ripple': this.spawnRipple(worldX, worldY, def); break;
      case 'wave': this.spawnWave(worldX, worldY, def); break;
      case 'arc': this.spawnArc(worldX, worldY, def, msg); break;
      case 'aura': this.spawnAura(worldX, worldY, def); break;
      case 'cage': this.spawnCage(worldX, worldY, def); break;
      case 'haze': this.spawnHaze(worldX, worldY, def); break;
      case 'extinguish': this.spawnExtinguish(worldX, worldY, def); break;
      case 'ritual': this.spawnRitual(def); break;
      case 'reveal': this.spawnReveal(worldX, worldY, def); break;
      case 'combo': this.spawnCombo(worldX, worldY, def); break;
      case 'fade': this.spawnFade(worldX, worldY, def); break;
      case 'soundwave': this.spawnSoundwave(worldX, worldY, def); break;
      default: this.spawnBurst(worldX, worldY, def);
    }

    // Tag any new persistent effects with the effectId for toggle
    for (let i = prevPersistentCount; i < this.persistentEffects.length; i++) {
      this.persistentEffects[i].effectId = effectId;
    }

    // Screen shake
    if (def.shake) this.screenShake();

    // Screen flash
    if (def.flash) this.screenFlash(def.flash);

    this.start();
  }

  // --- Effect Spawners ---

  spawnBurst(x, y, def) {
    const count = 40;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
      const speed = 80 + Math.random() * 200;
      this.particles.push(new Particle(
        x, y,
        Math.cos(angle) * speed, Math.sin(angle) * speed,
        0.4 + Math.random() * 0.4,
        def.color, 3 + Math.random() * 4,
        { gravity: 40, drag: 0.96, shrink: true }
      ));
    }
  }

  spawnAoESphere(x, y, def) {
    const cp = this.map.cellPx;
    const radius = (def.radius || 4) * cp;

    // Ring of particles expanding outward
    this.emitters.push(new Emitter({
      x, y, rate: 100, life: 0.6,
      speed: radius * 2, spread: Math.PI * 2,
      color: def.color, size: 6, particleLife: 0.5,
      drag: 0.94, shrink: true
    }));

    // AoE circle highlight (temporary)
    this.addTemporaryAoE(x, y, radius, def.color, def.duration || 800);
  }

  spawnRipple(x, y, def) {
    // Expanding ring effect (via persistent draw for duration)
    const startTime = performance.now();
    const duration = def.duration || 500;
    const cp = this.map.cellPx;
    const maxRadius = (def.radius || 2) * cp;

    this.persistentEffects.push({
      type: 'ripple', x, y, color: def.color,
      startTime, duration, maxRadius,
      draw: (ctx, cam, now) => {
        const t = (now - startTime) / duration;
        if (t > 1) return true; // done
        const r = maxRadius * t;
        const alpha = 1 - t;
        cam.applyTransform(ctx);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = def.color;
        ctx.lineWidth = (4 + (1 - t) * 4) / cam.zoom;
        ctx.globalAlpha = alpha * 0.8;
        ctx.stroke();
        ctx.globalAlpha = 1;
        cam.resetTransform(ctx);
        return false;
      }
    });
  }

  spawnWave(x, y, def) {
    // Blue-white expanding wave
    const count = 60;
    const cp = this.map.cellPx;
    const radius = (def.radius || 3) * cp;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      this.particles.push(new Particle(
        x, y,
        Math.cos(angle) * radius * 1.5, Math.sin(angle) * radius * 1.5,
        0.5 + Math.random() * 0.3,
        def.color, 3 + Math.random() * 3,
        { drag: 0.92, shrink: true }
      ));
    }
  }

  spawnArc(x, y, def, msg) {
    // Healing arc from source to target
    const srcX = msg.srcCol != null ? (msg.srcCol + 0.5) * this.map.cellPx : x - 100;
    const srcY = msg.srcRow != null ? (msg.srcRow + 0.5) * this.map.cellPx : y;

    for (let i = 0; i < 20; i++) {
      const t = i / 20;
      const px = srcX + (x - srcX) * t;
      const py = srcY + (y - srcY) * t - Math.sin(t * Math.PI) * 60;
      setTimeout(() => {
        this.particles.push(new Particle(
          px, py, (Math.random() - 0.5) * 20, -20 - Math.random() * 30,
          0.5, def.color, 3, { drag: 0.95, shrink: true }
        ));
        if (!this._running) this.start();
      }, t * 300);
    }
  }

  spawnAura(x, y, def) {
    const cp = this.map.cellPx;
    const radius = (def.radius || 3) * cp;

    // Persistent orbiting particles
    const emitter = new Emitter({
      x, y, rate: 15, life: Infinity, persistent: true,
      speed: 30, spread: Math.PI * 2,
      color: def.color, size: 3, particleLife: 2,
      drag: 0.99, fadeOut: true
    });
    this.emitters.push(emitter);

    // AoE ring
    this.persistentEffects.push({
      type: 'aura', emitter, x, y, radius, color: def.color,
      draw: (ctx, cam) => {
        cam.applyTransform(ctx);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = def.color;
        ctx.lineWidth = 2 / cam.zoom;
        ctx.globalAlpha = 0.3;
        ctx.setLineDash([6 / cam.zoom, 6 / cam.zoom]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        cam.resetTransform(ctx);
        return false;
      }
    });
  }

  spawnCage(x, y, def) {
    // Golden paralysis chains effect
    for (let i = 0; i < 30; i++) {
      const angle = (Math.PI * 2 * i) / 30;
      const r = 20 + Math.random() * 10;
      this.particles.push(new Particle(
        x + Math.cos(angle) * r, y + Math.sin(angle) * r,
        0, -15 - Math.random() * 20,
        1 + Math.random(), def.color, 2,
        { drag: 0.99, fadeOut: true }
      ));
    }
  }

  spawnHaze(x, y, def) {
    // Purple-red domination haze
    this.emitters.push(new Emitter({
      x, y, rate: 25, life: 2, persistent: false,
      speed: 20, spread: Math.PI * 2,
      color: def.color, size: 8, particleLife: 1.5,
      drag: 0.97, fadeOut: true, gravity: -10
    }));
  }

  spawnExtinguish(x, y, def) {
    // Flame gutters out + smoke wisp + energy pulse
    // Flame particles shooting up
    for (let i = 0; i < 30; i++) {
      this.particles.push(new Particle(
        x + (Math.random() - 0.5) * 10, y,
        (Math.random() - 0.5) * 40, -80 - Math.random() * 120,
        0.4 + Math.random() * 0.4,
        def.color, 3 + Math.random() * 3,
        { gravity: 30, drag: 0.95, shrink: true }
      ));
    }
    // Smoke particles
    setTimeout(() => {
      for (let i = 0; i < 15; i++) {
        this.particles.push(new Particle(
          x + (Math.random() - 0.5) * 10, y,
          (Math.random() - 0.5) * 15, -20 - Math.random() * 30,
          1 + Math.random(),
          '#666666', 5 + Math.random() * 5,
          { gravity: -5, drag: 0.98, fadeOut: true }
        ));
      }
      if (!this._running) this.start();
    }, 400);
    // Energy pulse
    this.spawnRipple(x, y, { color: def.color, radius: 2, duration: 600 });
  }

  spawnRitual(def) {
    // Blood-circle flare across entire map
    const cp = this.map.cellPx;
    const mapW = (this.map.currentMap?.cols || 12) * cp;
    const mapH = (this.map.currentMap?.rows || 8) * cp;
    const cx = mapW / 2;
    const cy = mapH / 2;

    // Pulsing red ring expanding outward
    for (let ring = 0; ring < 3; ring++) {
      setTimeout(() => {
        this.spawnRipple(cx, cy, {
          color: def.color, radius: 6 + ring * 2, duration: 1000
        });
        if (!this._running) this.start();
      }, ring * 500);
    }

    // Floor particles
    this.emitters.push(new Emitter({
      x: cx, y: cy, rate: 60, life: 2,
      speed: 100, spread: Math.PI * 2,
      color: '#8B0000', size: 4, particleLife: 1,
      drag: 0.95, shrink: true
    }));
  }

  spawnReveal(x, y, def) {
    // Mask cracking + token swap effect
    // Shatter particles
    for (let i = 0; i < 50; i++) {
      const angle = (Math.PI * 2 * i) / 50;
      const speed = 60 + Math.random() * 140;
      this.particles.push(new Particle(
        x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 20,
        Math.cos(angle) * speed, Math.sin(angle) * speed,
        0.6 + Math.random() * 0.6,
        i % 3 === 0 ? '#F5E6D3' : def.color, // porcelain shards + red
        2 + Math.random() * 4,
        { gravity: 100, drag: 0.96 }
      ));
    }
    // Dark energy burst
    setTimeout(() => {
      this.spawnBurst(x, y, { color: '#5C1A1A' });
      if (!this._running) this.start();
    }, 300);
  }

  spawnCombo(x, y, def) {
    // Path to the Grave: purple vulnerability mark
    const startTime = performance.now();
    this.persistentEffects.push({
      type: 'combo-mark',
      draw: (ctx, cam, now) => {
        const t = (now - startTime) / 800;
        if (t > 1) return true;
        cam.applyTransform(ctx);
        // Pulsing purple mark
        ctx.beginPath();
        ctx.arc(x, y, 25 + Math.sin(t * Math.PI * 4) * 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#7E57C2';
        ctx.lineWidth = 3 / cam.zoom;
        ctx.globalAlpha = 1 - t * 0.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
        cam.resetTransform(ctx);
        return false;
      }
    });

    // Then: massive gold explosion after 800ms
    setTimeout(() => {
      for (let i = 0; i < 80; i++) {
        const angle = (Math.PI * 2 * i) / 80 + Math.random() * 0.1;
        const speed = 100 + Math.random() * 300;
        this.particles.push(new Particle(
          x, y,
          Math.cos(angle) * speed, Math.sin(angle) * speed,
          0.5 + Math.random() * 0.5,
          i % 2 === 0 ? '#FFD700' : '#FFFFFF',
          3 + Math.random() * 6,
          { gravity: 60, drag: 0.94, shrink: true }
        ));
      }
      this.screenShake(0.6);
      this.screenFlash('#FFD700');
      if (!this._running) this.start();
    }, 800);
  }

  spawnFade(x, y, def) {
    // Invisibility: shimmer particles fading out
    for (let i = 0; i < 25; i++) {
      this.particles.push(new Particle(
        x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30,
        (Math.random() - 0.5) * 15, -10 - Math.random() * 20,
        0.8 + Math.random() * 0.5,
        def.color, 2 + Math.random() * 2,
        { drag: 0.98, fadeOut: true }
      ));
    }
  }

  spawnSoundwave(x, y, def) {
    // Visible sound disruption
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        this.spawnRipple(x, y, {
          color: def.color, radius: 1.5, duration: 300
        });
        if (!this._running) this.start();
      }, i * 100);
    }
  }

  // --- AoE Highlight ---
  addTemporaryAoE(x, y, radius, color, duration) {
    const startTime = performance.now();
    this.persistentEffects.push({
      type: 'aoe',
      draw: (ctx, cam, now) => {
        const elapsed = now - startTime;
        if (elapsed > duration) return true;
        const alpha = elapsed < duration * 0.8 ? 0.15 : 0.15 * (1 - (elapsed - duration * 0.8) / (duration * 0.2));
        cam.applyTransform(ctx);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 / cam.zoom;
        ctx.globalAlpha = alpha * 3;
        ctx.stroke();
        ctx.globalAlpha = 1;
        cam.resetTransform(ctx);
        return false;
      }
    });
  }

  // --- Utilities ---

  screenShake(duration = 0.4) {
    const viewport = document.getElementById('vtt-viewport');
    if (!viewport) return;
    viewport.classList.add('shaking');
    viewport.style.animationDuration = duration + 's';
    setTimeout(() => {
      viewport.classList.remove('shaking');
    }, duration * 1000);
  }

  screenFlash(color) {
    const flash = $('screen-flash');
    flash.style.background = color;
    flash.classList.add('active');
    setTimeout(() => flash.classList.remove('active'), 300);
  }

  clearPersistent() {
    this.persistentEffects = this.persistentEffects.filter(e => {
      if (e.emitter) {
        e.emitter.persistent = false;
        e.emitter.life = 0;
      }
      return false;
    });
  }

  // --- Render Loop ---

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    this.tick();
  }

  tick() {
    if (!this._running) return;

    const now = performance.now();
    const dt = Math.min((now - this._lastTime) / 1000, 0.05); // cap at 50ms
    this._lastTime = now;

    // Update emitters
    for (const emitter of this.emitters) {
      const newParticles = emitter.update(dt);
      this.particles.push(...newParticles);
    }
    this.emitters = this.emitters.filter(e => !e.dead);

    // Update particles
    for (const p of this.particles) p.update(dt);
    this.particles = this.particles.filter(p => !p.dead);

    // Draw
    this.draw(now);

    // Continue or stop
    if (this.particles.length > 0 || this.emitters.length > 0 || this.persistentEffects.length > 0) {
      requestAnimationFrame(() => this.tick());
    } else {
      this._running = false;
      // Clear the canvas one final time
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  }

  draw(now) {
    const ctx = this.ctx;
    const cam = this.map.camera;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Draw persistent effects (AoE highlights, auras, ripples)
    this.persistentEffects = this.persistentEffects.filter(e => {
      const done = e.draw(ctx, cam, now);
      return !done;
    });

    // Draw particles with additive blending
    cam.applyTransform(ctx);
    ctx.globalCompositeOperation = 'lighter';

    for (const p of this.particles) {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.currentSize, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    cam.resetTransform(ctx);
  }

  drawPersistent() {
    if (this.persistentEffects.length > 0 && !this._running) {
      this.start();
    }
  }
}
