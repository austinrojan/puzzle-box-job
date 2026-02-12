import { test, expect } from '@playwright/test';

test.describe('Camera math — world-space model', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/vtt/');
    await page.waitForFunction(
      () => document.getElementById('loading')?.hidden === true,
      { timeout: 15000 }
    );
  });

  test('screenToWorld and worldToScreen are inverses', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      // Set a known state
      cam.x = 100; cam.y = 200; cam.zoom = 1.5;
      const world = cam.screenToWorld(500, 300);
      const screen = cam.worldToScreen(world.x, world.y);
      return { screenX: screen.x, screenY: screen.y };
    });
    expect(result).not.toBeNull();
    expect(Math.abs(result.screenX - 500)).toBeLessThan(0.01);
    expect(Math.abs(result.screenY - 300)).toBeLessThan(0.01);
  });

  test('cover zoom: 16:9 viewport + 16:9 map → zoom ≈ 1.0', async ({ page }) => {
    const coverZoom = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.viewportW = 1920; cam.viewportH = 1080;
      cam.setMapSize(1920, 1080);
      return cam._coverZoom;
    });
    expect(coverZoom).not.toBeNull();
    expect(Math.abs(coverZoom - 1.0)).toBeLessThan(0.01);
  });

  test('cover zoom: wider viewport → zoom > 1', async ({ page }) => {
    const coverZoom = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.viewportW = 2560; cam.viewportH = 1080;
      cam.setMapSize(1920, 1080);
      return cam._coverZoom;
    });
    expect(coverZoom).not.toBeNull();
    expect(Math.abs(coverZoom - 2560 / 1920)).toBeLessThan(0.01);
  });

  test('cover zoom: taller viewport → zoom > 1', async ({ page }) => {
    const coverZoom = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.viewportW = 1920; cam.viewportH = 1440;
      cam.setMapSize(1920, 1080);
      return cam._coverZoom;
    });
    expect(coverZoom).not.toBeNull();
    expect(Math.abs(coverZoom - 1440 / 1080)).toBeLessThan(0.01);
  });

  test('zoomAt preserves world point under cursor', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.x = 0; cam.y = 0; cam.zoom = 1.0;
      cam.viewportW = 1920; cam.viewportH = 1080;
      const before = cam.screenToWorld(400, 300);
      cam.zoomAt(400, 300, 1, 1.5);
      const after = cam.screenToWorld(400, 300);
      return { dx: Math.abs(after.x - before.x), dy: Math.abs(after.y - before.y) };
    });
    expect(result).not.toBeNull();
    expect(result.dx).toBeLessThan(0.01);
    expect(result.dy).toBeLessThan(0.01);
  });

  test('applyTransform produces correct matrix', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.x = 100; cam.y = 50; cam.zoom = 2.0;
      let captured = null;
      const mockCtx = { setTransform: (a, b, c, d, e, f) => { captured = { a, b, c, d, e, f }; } };
      cam.applyTransform(mockCtx);
      return captured;
    });
    expect(result).not.toBeNull();
    expect(result.a).toBeCloseTo(2.0);
    expect(result.d).toBeCloseTo(2.0);
    expect(result.e).toBeCloseTo(-200); // -100 * 2
    expect(result.f).toBeCloseTo(-100); // -50 * 2
  });

  test('fitCover centers the map', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.viewportW = 2560; cam.viewportH = 1080;
      cam.setMapSize(1920, 1080);
      return { x: cam.x, y: cam.y };
    });
    expect(result).not.toBeNull();
    expect(Math.abs(result.x - 0)).toBeLessThan(1);
    // At cover zoom (2560/1920 ≈ 1.333), visible height = 1080/1.333 ≈ 810px.
    // Centering: y = (1080 - 810) / 2 = 135
    expect(Math.abs(result.y - 135)).toBeLessThan(1);
  });

  test('panBy converts screen delta to world displacement', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.x = 0; cam.y = 0; cam.zoom = 2.0;
      cam.panBy(100, 0);
      return cam.x; // should be -50 (= -100/2)
    });
    expect(result).not.toBeNull();
    expect(Math.abs(result - (-50))).toBeLessThan(0.01);
  });

  test('zoomAt clamps at MAX_ZOOM (5.0)', async ({ page }) => {
    const zoom = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.x = 0; cam.y = 0; cam.zoom = 4.5;
      cam.viewportW = 1920; cam.viewportH = 1080;
      // Zoom in repeatedly — should not exceed 5.0
      for (let i = 0; i < 50; i++) cam.zoomAt(960, 540, 1, 1.15);
      return cam.zoom;
    });
    expect(zoom).not.toBeNull();
    expect(zoom).toBeLessThanOrEqual(5.0);
    expect(zoom).toBeCloseTo(5.0);
  });

  test('zoomAt clamps at MIN_ZOOM (0.1)', async ({ page }) => {
    const zoom = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.x = 0; cam.y = 0; cam.zoom = 0.2;
      cam.viewportW = 1920; cam.viewportH = 1080;
      // Zoom out repeatedly — should not drop below 0.1
      for (let i = 0; i < 50; i++) cam.zoomAt(960, 540, -1, 1.15);
      return cam.zoom;
    });
    expect(zoom).not.toBeNull();
    expect(zoom).toBeGreaterThanOrEqual(0.1);
    expect(zoom).toBeCloseTo(0.1);
  });

  test('serialize/deserialize roundtrip', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      cam.x = 42; cam.y = 99; cam.zoom = 1.7;
      cam.mapW = 1920; cam.mapH = 1440;
      const snap = cam.serialize();
      cam.x = 0; cam.y = 0; cam.zoom = 1;
      cam.deserialize(snap);
      return { x: cam.x, y: cam.y, zoom: cam.zoom };
    });
    expect(result).not.toBeNull();
    expect(result.x).toBeCloseTo(42);
    expect(result.y).toBeCloseTo(99);
    expect(result.zoom).toBeCloseTo(1.7);
  });
});
