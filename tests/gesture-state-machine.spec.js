import { test, expect } from '@playwright/test';
import { setupMapCamera } from './helpers.js';

test.describe('logicalScreenToWorld', () => {
  test.beforeEach(async ({ page }) => {
    await setupMapCamera(page);
  });

  test('ignores elastic offset', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0; cam.x = 100; cam.y = 100;
      cam.elasticOffsetX = 30; cam.elasticOffsetY = -20;
      const logical = cam.logicalScreenToWorld(0, 0);
      return { x: logical.x, y: logical.y };
    });
    // 0/2 + 100 = 100 (NOT 0/2 + 130 = 130)
    expect(result.x).toBeCloseTo(100, 5);
    expect(result.y).toBeCloseTo(100, 5);
  });

  test('matches screenToWorld when no elastic offset', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 1.5; cam.x = 200; cam.y = 150;
      cam.elasticOffsetX = 0; cam.elasticOffsetY = 0;
      const v = cam.screenToWorld(300, 200);
      const l = cam.logicalScreenToWorld(300, 200);
      return { matchX: Math.abs(v.x - l.x) < 0.001, matchY: Math.abs(v.y - l.y) < 0.001 };
    });
    expect(result.matchX).toBe(true);
    expect(result.matchY).toBe(true);
  });

  test('at non-origin screen coords', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0; cam.x = 50; cam.y = 50;
      cam.elasticOffsetX = 10; cam.elasticOffsetY = 10;
      return cam.logicalScreenToWorld(400, 300);
    });
    expect(result.x).toBeCloseTo(250, 5);  // 400/2 + 50
    expect(result.y).toBeCloseTo(200, 5);  // 300/2 + 50
  });
});

test.describe('zoomAt coordinate decontamination', () => {
  test.beforeEach(async ({ page }) => { await setupMapCamera(page); });

  test('zoomAt does not shift camera by elastic offset amount', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0; cam.mapW = 3840; cam.mapH = 2160;
      cam._updateCoverZoom();
      cam.x = (cam.mapW - cam.viewportW / cam.zoom) / 2;
      cam.y = (cam.mapH - cam.viewportH / cam.zoom) / 2;
      cam.elasticOffsetX = 50; cam.elasticOffsetY = 30;
      const xBefore = cam.x;
      cam.zoomAt(cam.viewportW / 2, cam.viewportH / 2, 0.1);
      return Math.abs(cam.x - xBefore);
    });
    expect(result).toBeLessThan(40);
  });
});

test.describe('SmoothZoomAnimator anchor decontamination', () => {
  test.beforeEach(async ({ page }) => { await setupMapCamera(page); });

  test('onWheelZoom anchor uses logical position, not visual', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0; cam.x = 500; cam.y = 300;
      cam.elasticOffsetX = 40; cam.elasticOffsetY = 25;
      cam._smoothZoom.onWheelZoom(-1.0, 960, 540);
      return {
        wx: cam._smoothZoom._anchor.wx,
        expectedWx: 960 / cam.zoom + cam.x,
        wy: cam._smoothZoom._anchor.wy,
        expectedWy: 540 / cam.zoom + cam.y,
      };
    });
    expect(result.wx).toBeCloseTo(result.expectedWx, 3);
    expect(result.wy).toBeCloseTo(result.expectedWy, 3);
  });
});
