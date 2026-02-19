import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode, injectTestAccessors } from './helpers.js';

// ============================================================
// Velocity clamp: _clampSpringVelocity
// ============================================================
test.describe('Velocity clamp (_clampSpringVelocity)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('zero displacement returns velocity unchanged', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      return {
        pos: cam._clampSpringVelocity(5000, 0, 20),
        neg: cam._clampSpringVelocity(-5000, 0, 20),
        zero: cam._clampSpringVelocity(0, 0, 20)
      };
    });
    expect(result.pos).toBe(5000);
    expect(result.neg).toBe(-5000);
    expect(result.zero).toBe(0);
  });

  test('positive displacement: safe velocity passes through', async ({ page }) => {
    // d=50, omega=20, vCritical = -1000
    // v=-500 is safe (less negative than -1000)
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(-500, 50, 20));
    expect(v).toBe(-500);
  });

  test('positive displacement: dangerous velocity is clamped', async ({ page }) => {
    // d=50, omega=20, vCritical = -1000
    // v=-3000 would overshoot, clamp to -1000
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(-3000, 50, 20));
    expect(v).toBe(-1000);
  });

  test('positive displacement: outward velocity passes through', async ({ page }) => {
    // v=200 moving away from target, no overshoot risk
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(200, 50, 20));
    expect(v).toBe(200);
  });

  test('negative displacement: safe velocity passes through', async ({ page }) => {
    // d=-50, omega=20, vCritical = 1000
    // v=500 is safe
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(500, -50, 20));
    expect(v).toBe(500);
  });

  test('negative displacement: dangerous velocity is clamped', async ({ page }) => {
    // d=-50, omega=20, vCritical = 1000
    // v=3000 would overshoot, clamp to 1000
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(3000, -50, 20));
    expect(v).toBe(1000);
  });

  test('negative displacement: outward velocity passes through', async ({ page }) => {
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(-200, -50, 20));
    expect(v).toBe(-200);
  });

  test('exact critical velocity passes through (boundary case)', async ({ page }) => {
    // v = -omega * d = -1000. max(-1000, -1000) = -1000.
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(-1000, 50, 20));
    expect(v).toBe(-1000);
  });

  test('very small displacement: clamp is proportionally tight', async ({ page }) => {
    // d=1, omega=20, vCritical = -20. Even -25 is clamped to -20.
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(-25, 1, 20));
    expect(v).toBe(-20);
  });

  test('very large displacement: clamp is proportionally loose', async ({ page }) => {
    // d=200, omega=20, vCritical = -4000. -3000 is safe.
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(-3000, 200, 20));
    expect(v).toBe(-3000);
  });
});
