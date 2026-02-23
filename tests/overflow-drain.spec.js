// @ts-check
import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode, injectTestAccessors } from './helpers.js';

test.describe('Input-proportional overflow drain', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('overflow accumulates in same direction', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      // Call _updateCumulativeOverflow directly
      let cumulative = 5;
      cumulative = cam._updateCumulativeOverflow(10, 10, cumulative);
      return { cumulative };
    });
    expect(result.cumulative).toBe(15);
  });

  test('overflow resets on direction change', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      // Cumulative is +10, new overflow is -5 (opposite direction)
      let cumulative = 10;
      cumulative = cam._updateCumulativeOverflow(-5, -5, cumulative);
      return { cumulative };
    });
    expect(result.cumulative).toBe(-5);
  });

  test('reverse input drains proportionally', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      // Cumulative is +20, no overflow, reverse input -8
      let cumulative = 20;
      cumulative = cam._updateCumulativeOverflow(0, -8, cumulative);
      return { cumulative };
    });
    expect(result.cumulative).toBe(12);
  });

  test('drain never goes past zero', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      // Cumulative is +5, no overflow, large reverse input -20
      let cumulative = 5;
      cumulative = cam._updateCumulativeOverflow(0, -20, cumulative);
      return { cumulative };
    });
    expect(result.cumulative).toBe(0);
  });

  test('same-direction input without overflow holds value', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      // Cumulative is +15, no overflow, same-direction input +8
      let cumulative = 15;
      cumulative = cam._updateCumulativeOverflow(0, 8, cumulative);
      return { cumulative };
    });
    // Input is same direction as overflow — no drain
    expect(result.cumulative).toBe(15);
  });
});

test.describe('Elastic ceiling', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('aggressive overflow stays within 150/zoom world-space', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      const zoom = cam.zoom;
      cam._gestureActive = true;
      cam._momentumScrollActive = false;

      // Push hard past the boundary 200 times
      for (let i = 0; i < 200; i++) {
        cam.panBy(50, 50);
      }

      const maxWorld = 150 / zoom;
      return {
        absX: Math.abs(cam.elasticOffsetX),
        absY: Math.abs(cam.elasticOffsetY),
        maxWorld,
        withinX: Math.abs(cam.elasticOffsetX) <= maxWorld + 0.01,
        withinY: Math.abs(cam.elasticOffsetY) <= maxWorld + 0.01,
      };
    });
    expect(result.withinX).toBe(true);
    expect(result.withinY).toBe(true);
  });

  test('normal overflow is below ceiling (rubber-band preserved)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      const zoom = cam.zoom;
      cam._gestureActive = true;
      cam._momentumScrollActive = false;

      // Gentle push — 5 calls
      for (let i = 0; i < 5; i++) {
        cam.panBy(20, 20);
      }

      const maxWorld = 150 / zoom;
      const absX = Math.abs(cam.elasticOffsetX);
      return {
        absX,
        belowCeiling: absX < maxWorld,
      };
    });
    expect(result.belowCeiling).toBe(true);
  });
});
