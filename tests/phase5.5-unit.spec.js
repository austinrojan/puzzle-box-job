import { test, expect } from '@playwright/test';
import { gotoVTT } from './helpers.js';

// ============================================================
// VelocityTracker
// ============================================================
test.describe('VelocityTracker', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await page.waitForFunction(() => window.__vtt?.mapRenderer?.camera != null, { timeout: 10000 });
  });

  test('zero velocity with <2 samples', async ({ page }) => {
    const v = await page.evaluate(async () => {
      const { VelocityTracker } = await import('/vtt/js/map-camera.js');
      const vt = new VelocityTracker();
      const v0 = vt.getVelocity();
      vt.addSample(100, 100, 0);
      const v1 = vt.getVelocity();
      return { v0, v1 };
    });
    expect(v.v0.vx).toBe(0);
    expect(v.v0.vy).toBe(0);
    expect(v.v1.vx).toBe(0);
    expect(v.v1.vy).toBe(0);
  });

  test('correct velocity from 2 samples (100px in 100ms = 1000px/s)', async ({ page }) => {
    const v = await page.evaluate(async () => {
      const { VelocityTracker } = await import('/vtt/js/map-camera.js');
      const vt = new VelocityTracker();
      vt.addSample(0, 0, 0);
      vt.addSample(100, 0, 100);
      return vt.getVelocity();
    });
    expect(Math.abs(v.vx - 1000)).toBeLessThan(1);
    expect(v.vy).toBe(0);
  });

  test('ring buffer wrap: last 4 samples override first 4', async ({ page }) => {
    const v = await page.evaluate(async () => {
      const { VelocityTracker } = await import('/vtt/js/map-camera.js');
      const vt = new VelocityTracker();
      // Add 4 slow samples
      for (let i = 0; i < 4; i++) vt.addSample(i, 0, i * 100);
      // Add 4 fast samples that overwrite the ring buffer
      for (let i = 0; i < 4; i++) vt.addSample(400 + i * 100, 0, 400 + i * 16);
      return vt.getVelocity();
    });
    // 300px in 48ms = 6250 px/s (fast samples dominate)
    expect(v.vx).toBeGreaterThan(5000);
  });

  test('zero velocity when dt < 8ms', async ({ page }) => {
    const v = await page.evaluate(async () => {
      const { VelocityTracker } = await import('/vtt/js/map-camera.js');
      const vt = new VelocityTracker();
      vt.addSample(0, 0, 0);
      vt.addSample(100, 0, 5); // 5ms < 8ms threshold
      return vt.getVelocity();
    });
    expect(v.vx).toBe(0);
    expect(v.vy).toBe(0);
  });

  test('reset clears all samples', async ({ page }) => {
    const v = await page.evaluate(async () => {
      const { VelocityTracker } = await import('/vtt/js/map-camera.js');
      const vt = new VelocityTracker();
      vt.addSample(0, 0, 0);
      vt.addSample(100, 0, 100);
      vt.reset();
      return vt.getVelocity();
    });
    expect(v.vx).toBe(0);
    expect(v.vy).toBe(0);
  });

  test('diagonal velocity correctness', async ({ page }) => {
    const v = await page.evaluate(async () => {
      const { VelocityTracker } = await import('/vtt/js/map-camera.js');
      const vt = new VelocityTracker();
      vt.addSample(0, 0, 0);
      vt.addSample(100, 100, 100);
      return vt.getVelocity();
    });
    expect(Math.abs(v.vx - 1000)).toBeLessThan(1);
    expect(Math.abs(v.vy - 1000)).toBeLessThan(1);
  });
});

// ============================================================
// Momentum exponential decay (pure math)
// ============================================================
test.describe('Momentum exponential decay', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'load' });
  });

  test('velocity halves in ~87ms (friction=8)', async ({ page }) => {
    const ratio = await page.evaluate(() => {
      const FRICTION = 8;
      return Math.exp(-FRICTION * 0.087);
    });
    expect(Math.abs(ratio - 0.5)).toBeLessThan(0.01);
  });

  test('drops below 50px/s within 400ms from 1000px/s', async ({ page }) => {
    const final = await page.evaluate(() => {
      const FRICTION = 8;
      return 1000 * Math.exp(-FRICTION * 0.4);
    });
    expect(final).toBeLessThan(50);
  });

  test('4000px/s settles within 600ms', async ({ page }) => {
    const final = await page.evaluate(() => {
      const FRICTION = 8;
      return 4000 * Math.exp(-FRICTION * 0.6);
    });
    expect(final).toBeLessThan(50);
  });

  test('frame-rate independent (one big step ≈ many small steps)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const FRICTION = 8;
      const totalTime = 0.2;
      // One big step
      const bigStep = 1000 * Math.exp(-FRICTION * totalTime);
      // Many small steps (200 × 1ms)
      let v = 1000;
      const dt = 0.001;
      for (let i = 0; i < 200; i++) v *= Math.exp(-FRICTION * dt);
      return { bigStep, manySteps: v };
    });
    expect(Math.abs(result.bigStep - result.manySteps)).toBeLessThan(0.01);
  });
});

// ============================================================
// Cover zoom gap
// ============================================================
test.describe('Cover zoom gap', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await page.waitForFunction(() => window.__vtt?.mapRenderer?.camera != null, { timeout: 10000 });
  });

  test('Controller floor (1.0) > Display floor (0.667) for 1920x1440 map', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      // Display: 1920x1080 viewport, 1920x1440 map
      cam.viewportW = 1920; cam.viewportH = 1080;
      cam.mapW = 1920; cam.mapH = 1440;
      cam._updateCoverZoom();
      const displayFloor = cam._coverZoom;
      // Controller: 1920x1080 viewport (headless), same map → same floor
      // But if controller had smaller viewport: 1280x720
      cam.viewportW = 1280; cam.viewportH = 720;
      cam._updateCoverZoom();
      const smallerFloor = cam._coverZoom;
      // Restore
      cam.viewportW = 1920; cam.viewportH = 1080;
      cam._updateCoverZoom();
      return { displayFloor, smallerFloor };
    });
    // 1920/1920 = 1.0, 1080/1440 = 0.75 → max = 1.0
    expect(Math.abs(result.displayFloor - 1.0)).toBeLessThan(0.01);
    // 1280/1920 = 0.667, 720/1440 = 0.5 → max = 0.667
    expect(Math.abs(result.smallerFloor - 0.667)).toBeLessThan(0.01);
  });

  test('zoom 0.8 clamped by _applyConstraints when coverZoom is 0.9', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam.viewportW = 1920; cam.viewportH = 1080;
      cam.mapW = 2133; cam.mapH = 1200; // cover zoom ≈ 0.9
      cam._updateCoverZoom();
      cam.zoom = 0.8;
      cam._applyConstraints();
      return { zoom: cam.zoom, coverZoom: cam._coverZoom };
    });
    expect(result.zoom).toBeGreaterThanOrEqual(result.coverZoom - 0.001);
  });

  test('zoom 0.8 preserved when coverZoom is 0.667', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam.viewportW = 1920; cam.viewportH = 1080;
      cam.mapW = 2880; cam.mapH = 1620; // cover zoom ≈ 0.667
      cam._updateCoverZoom();
      cam.zoom = 0.8;
      cam._isDragging = false;
      cam._applyConstraints();
      return { zoom: cam.zoom, coverZoom: cam._coverZoom };
    });
    expect(Math.abs(result.zoom - 0.8)).toBeLessThan(0.01);
  });

  test('DM zoom-past-cover allows zoom below coverZoom', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam.viewportW = 1920; cam.viewportH = 1080;
      cam.mapW = 1920; cam.mapH = 1080;
      cam._updateCoverZoom();
      cam._dmCanZoomPastCover = true;
      cam.zoom = 0.5;
      cam._applyConstraints();
      const zoomWithFlag = cam.zoom;
      cam._dmCanZoomPastCover = false;
      cam.zoom = 0.5;
      cam._applyConstraints();
      const zoomWithoutFlag = cam.zoom;
      return { zoomWithFlag, zoomWithoutFlag, coverZoom: cam._coverZoom };
    });
    expect(result.zoomWithFlag).toBeCloseTo(0.5, 1);
    expect(result.zoomWithoutFlag).toBeGreaterThanOrEqual(result.coverZoom - 0.001);
  });
});

// ============================================================
// VIEWPORT_REPORT protocol
// ============================================================
test.describe('VIEWPORT_REPORT protocol', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'load' });
  });

  test('createViewportReportMsg creates valid message', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { createViewportReportMsg, validateMessage } = await import('/shared/protocol.js');
      const msg = createViewportReportMsg(1920, 1080, 1.0, 'win1');
      return {
        valid: validateMessage(msg),
        hasFields: msg.viewportW === 1920 && msg.viewportH === 1080 && msg.coverZoom === 1.0,
      };
    });
    expect(r.valid.valid).toBe(true);
    expect(r.hasFields).toBe(true);
  });

  test('missing coverZoom field → validation fails', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { MSG, PROTOCOL_VERSION, validateMessage } = await import('/shared/protocol.js');
      const msg = {
        type: MSG.VIEWPORT_REPORT,
        _v: PROTOCOL_VERSION,
        viewportW: 1920,
        viewportH: 1080,
        // coverZoom intentionally missing
      };
      return validateMessage(msg);
    });
    expect(r.valid).toBe(false);
    expect(r.error).toContain('coverZoom');
  });
});
