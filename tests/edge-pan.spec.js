import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode, injectTestAccessors } from './helpers.js';

test.describe('EdgePanManager', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('_axisVelocity returns 0 outside hot zone', async ({ page }) => {
    const v = await page.evaluate(() =>
      __edgePan()?._axisVelocity(500, 1920));
    expect(v).toBe(0);
  });

  test('_axisVelocity returns negative near left edge', async ({ page }) => {
    const v = await page.evaluate(() =>
      __edgePan()?._axisVelocity(10, 1920));
    expect(v).toBeLessThan(0);
  });

  test('_axisVelocity returns positive near right edge', async ({ page }) => {
    const v = await page.evaluate(() =>
      __edgePan()?._axisVelocity(1910, 1920));
    expect(v).toBeGreaterThan(0);
  });

  test('deeper penetration = faster (quadratic)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const mgr = __edgePan();
      if (!mgr) return null;
      return {
        shallow: Math.abs(mgr._axisVelocity(50, 1920)),
        deep: Math.abs(mgr._axisVelocity(5, 1920))
      };
    });
    expect(result.deep).toBeGreaterThan(result.shallow);
  });

  test('startTracking/stopTracking lifecycle', async ({ page }) => {
    const result = await page.evaluate(() => {
      const mgr = __edgePan();
      if (!mgr) return null;
      mgr.startTracking();
      const on = mgr._tracking;
      mgr.stopTracking();
      return { on, off: mgr._tracking };
    });
    expect(result.on).toBe(true);
    expect(result.off).toBe(false);
  });
});
