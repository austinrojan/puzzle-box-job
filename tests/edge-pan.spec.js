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

  test('no pan output before START_DELAY_MS (150ms)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const mgr = __edgePan();
      const cam = __cam();
      if (!mgr || !cam) return null;

      // Record initial position
      cam.zoom = 2.0; cam.x = 500; cam.y = 500;
      cam._applyConstraints();
      const xBefore = cam.x;

      // Start tracking and place cursor in hot zone (near right edge)
      mgr.startTracking();
      mgr.updateCursor(1910, 540);

      // First _tick: enters hot zone, sets _activeSince = earlyTimestamp
      const earlyTimestamp = performance.now() + 100;
      mgr._tick(earlyTimestamp);
      const xAfterEarly = cam.x;

      // Second _tick: 200ms after _activeSince → past 150ms delay → pan fires
      const lateTimestamp = earlyTimestamp + 200;
      mgr._tick(lateTimestamp);
      const xAfterLate = cam.x;

      mgr.stopTracking();

      return { xBefore, xAfterEarly, xAfterLate };
    });
    expect(result).not.toBeNull();
    expect(result.xAfterEarly).toBe(result.xBefore);           // no pan before delay
    expect(result.xAfterLate).not.toBe(result.xAfterEarly);    // pan after delay
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
