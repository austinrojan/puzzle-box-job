import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode, injectTestAccessors } from './helpers.js';

test.describe('Pure math — clampAxis and rubberBand', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await injectTestAccessors(page);
  });

  test('clampAxis zoomed-in: clamps to [0, mapSize - visSize]', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
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
      const cam = __cam();
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
      const cam = __cam();
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
      const cam = __cam();
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

  test('panBy within bounds produces zero elastic offset', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      if (!cam) return null;
      cam.zoom = 2.0;
      cam._applyConstraints();
      // Pan within bounds
      cam._gestureActive = true;
      cam._cumulativeOverflowX = 0;
      cam.panBy(10, 0);
      return { offsetX: cam.elasticOffsetX, offsetY: cam.elasticOffsetY };
    });
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
  });

  test('_feedElasticOverflow: past boundary produces rubber-banded offset', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      if (!cam) return null;
      cam._gestureActive = true;
      cam._feedElasticOverflow(-100, 0);
      return { offsetX: cam.elasticOffsetX };
    });
    expect(result.offsetX).toBeLessThan(0);
    expect(Math.abs(result.offsetX)).toBeLessThan(100);
  });

  test('rubber-band: diminishing returns on deeper overshoot', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      if (!cam) return null;
      cam._gestureActive = true;
      cam._feedElasticOverflow(-50, 0);
      const shallowAbs = Math.abs(cam.elasticOffsetX);
      cam._feedElasticOverflow(-500, 0);
      const deepAbs = Math.abs(cam.elasticOffsetX);
      return {
        shallowAbs,
        deepAbs,
        ratio: deepAbs / shallowAbs
      };
    });
    expect(result.deepAbs).toBeGreaterThan(result.shallowAbs);
    // 10x more overshoot should NOT produce 10x more elastic offset (diminishing)
    expect(result.ratio).toBeLessThan(9);
  });
});

test.describe('Critically damped spring solver', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await injectTestAccessors(page);
  });

  test('returns full displacement at t=0', async ({ page }) => {
    const pos = await page.evaluate(() => {
      const a = __animator();
      return a ? a._solveSpring(100, 0, 0).position : null;
    });
    expect(pos).toBeCloseTo(100, 4);
  });

  test('converges to <1px within 0.5s', async ({ page }) => {
    const pos = await page.evaluate(() => {
      const a = __animator();
      return a ? Math.abs(a._solveSpring(100, 0, 0.5).position) : null;
    });
    expect(pos).toBeLessThan(1.0);
  });

  test('never overshoots with zero initial velocity', async ({ page }) => {
    const minPos = await page.evaluate(() => {
      const a = __animator();
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
      const a = __animator();
      return a ? Math.abs(a._solveSpring(500, 0, 0.5).position) : null;
    });
    expect(pos).toBeLessThan(5.0);
  });

  test('closed-form matches fine-grained Euler approximation', async ({ page }) => {
    const result = await page.evaluate(() => {
      const a = __animator();
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
    await injectTestAccessors(page);
  });

  test('zoom floor enforces coverZoom as minimum', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      if (!cam) return null;
      for (let i = 0; i < 50; i++) cam.zoomToCenter(-0.4); // enough reps to bottom out at cover zoom
      return { zoom: cam.zoom, coverZoom: cam._coverZoom };
    });
    expect(result.zoom).toBeGreaterThanOrEqual(result.coverZoom - 0.001);
    expect(result.zoom).toBeCloseTo(result.coverZoom, 2);
  });

  test('panBy clamps at left edge when zoomed in', async ({ page }) => {
    const x = await page.evaluate(() => {
      const cam = __cam();
      if (!cam) return null;
      cam.zoom = 2.0;
      cam.x = 0; cam.y = 0;
      for (let i = 0; i < 100; i++) cam.panBy(100, 0); // enough reps to saturate at boundary
      return cam.x;
    });
    expect(x).toBeCloseTo(0, 0);
  });

  test('panBy clamps at right edge when zoomed in', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      if (!cam) return null;
      cam.zoom = 2.0;
      cam.x = cam.mapW;
      for (let i = 0; i < 100; i++) cam.panBy(-100, 0); // enough reps to saturate at boundary
      return { x: cam.x, maxX: cam.mapW - cam.viewportW / cam.zoom };
    });
    expect(result.x).toBeCloseTo(result.maxX, 0);
  });

  test('setPosition applies constraints', async ({ page }) => {
    const x = await page.evaluate(() => {
      const cam = __cam();
      if (!cam) return null;
      cam.setPosition(-999, -999, cam._coverZoom);
      return cam.x;
    });
    expect(x).toBeGreaterThanOrEqual(-1);
  });

  test('fitContain bypasses zoom floor', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      if (!cam) return null;
      cam.fitContain();
      return { containZoom: cam.zoom, coverZoom: cam._coverZoom };
    });
    expect(result.containZoom).toBeLessThanOrEqual(result.coverZoom + 0.001);
  });

  test('deserialize constrains out-of-bounds state', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      if (!cam) return null;
      cam.deserialize({ x: -999, y: -999, zoom: 0.01 });
      return { zoom: cam.zoom, coverZoom: cam._coverZoom };
    });
    expect(result.zoom).toBeGreaterThanOrEqual(result.coverZoom - 0.001);
  });

  test('_dmCanZoomPastCover toggle snaps zoom to cover when disabled', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      if (!cam) return null;
      const { EventBus } = window.__vtt;

      // Enable DM zoom past cover
      cam._dmCanZoomPastCover = true;

      // Zoom below cover
      cam.zoom = cam._coverZoom * 0.5;
      cam._applyConstraints();
      const belowCover = cam.zoom;

      // Disable via EventBus (simulates controller message)
      EventBus.emit('camera:zoom-past-cover', false);

      return {
        belowCover,
        afterDisable: cam.zoom,
        coverZoom: cam._coverZoom,
        dmToggle: cam._dmCanZoomPastCover
      };
    });
    expect(result).not.toBeNull();
    expect(result.belowCover).toBeLessThan(result.coverZoom);       // was below cover
    expect(result.afterDisable).toBeCloseTo(result.coverZoom, 2);   // snapped to cover
    expect(result.dmToggle).toBe(false);                             // toggle updated
  });

  test('zoomAt at zoom floor produces no cursor drift', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      if (!cam) return null;
      // Explicit dimensions for deterministic coverZoom regardless of VTT state
      cam.mapW = 3840; cam.mapH = 2160;
      cam.viewportW = cam.viewportW || 960;
      cam.viewportH = cam.viewportH || 540;
      cam._updateCoverZoom();
      cam.fitCover();
      const before = cam.screenToWorld(400, 300);
      cam.zoomAt(400, 300, -1.0);
      const after = cam.screenToWorld(400, 300);
      return { dx: Math.abs(after.x - before.x), dy: Math.abs(after.y - before.y) };
    });
    expect(result).not.toBeNull();
    expect(result.dx).toBeLessThan(1);
    expect(result.dy).toBeLessThan(1);
  });
});

test.describe('Elastic overscroll + snap-back', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('_gestureActive=true + panBy past boundary produces elastic offset (cam.x stays clamped)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      if (!cam) return null;
      cam.zoom = 2.0;
      cam._applyConstraints();
      // Pan to boundary first
      for (let i = 0; i < 200; i++) cam.panBy(50, 0);
      // Now activate gesture and push past
      cam._gestureActive = true;
      cam._cumulativeOverflowX = 0;
      cam.panBy(200, 0);
      const elasticX = cam.elasticOffsetX;
      const hardX = cam.x;
      // Deactivate and verify hard clamp persists
      cam._gestureActive = false;
      cam._applyConstraints();
      const afterX = cam.x;
      return { elasticX, hardX, afterX };
    });
    // Elastic offset is nonzero (visual displacement exists)
    expect(Math.abs(result.elasticX)).toBeGreaterThan(0);
    // Logical camera.x stays at hard boundary (>= 0)
    expect(result.hardX).toBeGreaterThanOrEqual(0);
    // After deactivation, still clamped
    expect(result.afterX).toBeGreaterThanOrEqual(0);
  });

  test('_snapBackElastic settles elastic offset to zero', async ({ page }) => {
    await page.evaluate(() => {
      const cam = __cam();
      if (!cam) return;
      cam.elasticOffsetX = 50;
      cam.elasticOffsetY = 30;
      cam._snapBackElastic();
    });
    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && Math.abs(cam.elasticOffsetX) < 1.0 && Math.abs(cam.elasticOffsetY) < 1.0;
    }, { timeout: 3000 });
    const result = await page.evaluate(() => ({
      x: __cam().elasticOffsetX,
      y: __cam().elasticOffsetY
    }));
    expect(Math.abs(result.x)).toBeLessThan(1.0);
    expect(Math.abs(result.y)).toBeLessThan(1.0);
  });
});

test.describe('E2E — mouse-driven boundary interactions', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('right-click drag past boundary snaps back', async ({ page }) => {
    await page.evaluate(() => {
      const cam = __cam();
      for (let i = 0; i < 5; i++) cam.zoomToCenter(0.4); // 5 zoom-in steps to get well above cover zoom
    });
    const box = await page.locator('#map-container').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + box.width + 200, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up({ button: 'right' });
    // Wait for elastic offset to settle (snap-back animation)
    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && Math.abs(cam.elasticOffsetX) < 1.0 && !cam._gestureActive;
    }, { timeout: 3000 });
    const result = await page.evaluate(() => ({
      x: __cam().x,
      elasticX: __cam().elasticOffsetX
    }));
    expect(result.x).toBeGreaterThanOrEqual(-1.0);
    expect(Math.abs(result.elasticX)).toBeLessThan(1.0);
  });

  test('keyboard pan stops at map edges', async ({ page }) => {
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0; cam.x = 100; cam.y = 100;
      cam._applyConstraints();
    });
    await page.keyboard.down('ArrowLeft');
    // Wait for pan to move left (x decreases)
    await page.waitForFunction(() => {
      const x = __cam()?.x;
      return x != null && x < 100;
    }, { timeout: 3000 });
    await page.keyboard.up('ArrowLeft');
    const x = await page.evaluate(() => __cam()?.x);
    expect(x).toBeGreaterThanOrEqual(-1);  // clamped at boundary
    expect(x).toBeLessThan(100);           // proves the pan actually moved
  });
});
