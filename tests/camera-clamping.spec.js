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
