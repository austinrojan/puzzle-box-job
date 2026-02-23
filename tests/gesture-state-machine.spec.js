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
