import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode } from './helpers.js';

test.describe('Pure math — clampAxis and rubberBand', () => {
  test.beforeEach(async ({ page }) => { await gotoVTT(page); });

  test('clampAxis zoomed-in: clamps to [0, mapSize - visSize]', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.mapW = 2000; cam.mapH = 2000;
      cam.viewportW = 800; cam.viewportH = 800;
      cam.zoom = 1.0;
      cam.x = -50; cam.y = -50; cam._applyHardBounds();
      const belowMin = { x: cam.x, y: cam.y };
      cam.x = 600; cam.y = 600; cam._applyHardBounds();
      const withinRange = { x: cam.x, y: cam.y };
      cam.x = 1300; cam.y = 1300; cam._applyHardBounds();
      const aboveMax = { x: cam.x, y: cam.y };
      return { belowMin, withinRange, aboveMax };
    });
    expect(result).not.toBeNull();
    expect(result.belowMin.x).toBeCloseTo(0);
    expect(result.withinRange.x).toBeCloseTo(600);
    expect(result.aboveMax.x).toBeCloseTo(1200); // 2000-800
  });

  test('clampAxis zoomed-out: centers the map', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.mapW = 800; cam.mapH = 800;
      cam.viewportW = 1200; cam.viewportH = 1200;
      cam.zoom = 1.0;
      cam.x = 500; cam.y = 500; cam._applyHardBounds();
      return { x: cam.x, y: cam.y };
    });
    expect(result).not.toBeNull();
    expect(result.x).toBeCloseTo(-200); // -(1200-800)/2
  });

  test('clampAxis crossover: both regimes agree at exact match', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.mapW = 1000; cam.mapH = 1000;
      cam.viewportW = 1000; cam.viewportH = 1000;
      cam.zoom = 1.0;
      cam.x = 100; cam.y = -100; cam._applyHardBounds();
      return { x: cam.x, y: cam.y };
    });
    expect(result).not.toBeNull();
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
  });

  test('clampAxis mixed regime: panoramic map', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.mapW = 3000; cam.mapH = 500;
      cam.viewportW = 800; cam.viewportH = 600;
      cam.zoom = 0.5;
      cam.x = 1500; cam.y = 0; cam._applyHardBounds();
      return { x: cam.x, y: cam.y };
    });
    expect(result).not.toBeNull();
    expect(result.x).toBeCloseTo(1400); // 3000-1600
    expect(result.y).toBeCloseTo(-350); // -(1200-500)/2
  });

  test('elastic: within bounds returns position unchanged', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.mapW = 2000; cam.mapH = 2000;
      cam.viewportW = 1000; cam.viewportH = 1000;
      cam.zoom = 1.0;
      return cam._elasticClampAxis(500, 1000, 2000, 1000);
    });
    expect(result).toBeCloseTo(500);
  });

  test('elastic: past boundary pulls toward boundary', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.zoom = 1.0;
      const past = cam._elasticClampAxis(-100, 1000, 2000, 1000);
      return { past };
    });
    expect(result.past).toBeLessThan(0);
    expect(result.past).toBeGreaterThan(-100);
  });

  test('elastic: diminishing returns on deeper overshoot', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.zoom = 1.0;
      const shallow = cam._elasticClampAxis(-50, 1000, 2000, 1000);
      const deep = cam._elasticClampAxis(-500, 1000, 2000, 1000);
      return {
        shallowAbs: Math.abs(shallow),
        deepAbs: Math.abs(deep),
        ratio: Math.abs(deep) / Math.abs(shallow)
      };
    });
    expect(result.deepAbs).toBeGreaterThan(result.shallowAbs);
    // 10x more overshoot should NOT produce 10x more elastic offset (diminishing)
    expect(result.ratio).toBeLessThan(10);
  });
});

test.describe('Critically damped spring solver', () => {
  test.beforeEach(async ({ page }) => { await gotoVTT(page); });

  test('returns full displacement at t=0', async ({ page }) => {
    const pos = await page.evaluate(() => {
      const a = window.__vtt?.mapRenderer?.camera?._animator;
      return a ? a._solveSpring(100, 0, 0).position : null;
    });
    expect(pos).toBeCloseTo(100, 4);
  });

  test('converges to <1px within 0.5s', async ({ page }) => {
    const pos = await page.evaluate(() => {
      const a = window.__vtt?.mapRenderer?.camera?._animator;
      return a ? Math.abs(a._solveSpring(100, 0, 0.5).position) : null;
    });
    expect(pos).toBeLessThan(1.0);
  });

  test('never overshoots with zero initial velocity', async ({ page }) => {
    const minPos = await page.evaluate(() => {
      const a = window.__vtt?.mapRenderer?.camera?._animator;
      if (!a) return null;
      let min = Infinity;
      for (let ms = 0; ms <= 1000; ms++) {
        min = Math.min(min, a._solveSpring(100, 0, ms / 1000).position);
      }
      return min;
    });
    expect(minPos).toBeGreaterThanOrEqual(-0.01);
  });

  test('settles large displacement (500px) within 0.5s', async ({ page }) => {
    const pos = await page.evaluate(() => {
      const a = window.__vtt?.mapRenderer?.camera?._animator;
      return a ? Math.abs(a._solveSpring(500, 0, 0.5).position) : null;
    });
    expect(pos).toBeLessThan(5.0);
  });

  test('closed-form matches fine-grained Euler approximation', async ({ page }) => {
    const result = await page.evaluate(() => {
      const a = window.__vtt?.mapRenderer?.camera?._animator;
      if (!a) return null;
      const STIFFNESS = 200;
      const OMEGA = Math.sqrt(STIFFNESS);
      const displacement = 100, velocity = 0;
      const analytical = a._solveSpring(displacement, velocity, 0.1);
      let pos = displacement, vel = velocity;
      const steps = 1000, dt = 0.1 / steps;
      for (let i = 0; i < steps; i++) {
        const accel = -STIFFNESS * pos - 2 * OMEGA * vel;
        vel += accel * dt;
        pos += vel * dt;
      }
      return { analytical: analytical.position, euler: pos };
    });
    expect(result.analytical).toBeCloseTo(result.euler, 1);
  });
});

test.describe('Constraint integration — zoom floor and pan clamping', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
  });

  test('zoom floor enforces coverZoom as minimum', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      for (let i = 0; i < 50; i++) cam.zoomToCenter(-0.4);
      return { zoom: cam.zoom, coverZoom: cam._coverZoom };
    });
    expect(result.zoom).toBeGreaterThanOrEqual(result.coverZoom - 0.001);
    expect(result.zoom).toBeCloseTo(result.coverZoom, 2);
  });

  test('panBy clamps at left edge when zoomed in', async ({ page }) => {
    const x = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.zoom = 2.0;
      cam.x = 0; cam.y = 0;
      for (let i = 0; i < 100; i++) cam.panBy(100, 0);
      return cam.x;
    });
    expect(x).toBeCloseTo(0, 0);
  });

  test('panBy clamps at right edge when zoomed in', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.zoom = 2.0;
      cam.x = cam.mapW;
      for (let i = 0; i < 100; i++) cam.panBy(-100, 0);
      return { x: cam.x, maxX: cam.mapW - cam.viewportW / cam.zoom };
    });
    expect(result.x).toBeCloseTo(result.maxX, 0);
  });

  test('setPosition applies constraints', async ({ page }) => {
    const x = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.setPosition(-999, -999, cam._coverZoom);
      return cam.x;
    });
    expect(x).toBeGreaterThanOrEqual(-1);
  });

  test('fitContain bypasses zoom floor', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.fitContain();
      return { containZoom: cam.zoom, coverZoom: cam._coverZoom };
    });
    expect(result.containZoom).toBeLessThanOrEqual(result.coverZoom + 0.001);
  });

  test('deserialize constrains out-of-bounds state', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.deserialize({ x: -999, y: -999, zoom: 0.01 });
      return { zoom: cam.zoom, coverZoom: cam._coverZoom };
    });
    expect(result.zoom).toBeGreaterThanOrEqual(result.coverZoom - 0.001);
  });

  test('zoomAt at zoom floor produces no cursor drift', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.fitCover();
      const before = cam.screenToWorld(400, 300);
      cam.zoomAt(400, 300, -1.0);
      const after = cam.screenToWorld(400, 300);
      return { dx: Math.abs(after.x - before.x), dy: Math.abs(after.y - before.y) };
    });
    expect(result.dx).toBeLessThan(1);
    expect(result.dy).toBeLessThan(1);
  });
});

test.describe('Elastic overscroll + snap-back', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
  });

  test('_isDragging=true enables elastic mode (not hard clamp)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.zoom = 2.0;
      cam._isDragging = true;
      cam.x = -200;
      cam._applyConstraints();
      const elasticX = cam.x;
      cam._isDragging = false;
      cam._applyConstraints();
      const hardX = cam.x;
      return { elasticX, hardX };
    });
    expect(result.elasticX).toBeLessThan(0);
    expect(result.elasticX).toBeGreaterThan(-200);
    expect(result.hardX).toBeCloseTo(0, 0);
  });

  test('_triggerSnapBack settles within bounds after ~600ms', async ({ page }) => {
    await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return;
      cam.zoom = 2.0;
      cam.x = -50;
      cam._isDragging = false;
      cam._triggerSnapBack();
    });
    await page.waitForTimeout(600);
    const x = await page.evaluate(() => window.__vtt?.mapRenderer?.camera?.x);
    expect(x).toBeGreaterThanOrEqual(-0.5);
  });
});
