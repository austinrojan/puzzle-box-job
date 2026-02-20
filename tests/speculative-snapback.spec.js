import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode, injectTestAccessors } from './helpers.js';

// ============================================================
// Phase S3: Speculative snap-back tests
// ============================================================

test.describe('_snapBackElastic double-fire guard', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('zero-velocity call is a no-op when _isSnappingBack is true', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.elasticOffsetX = 30;
      cam.elasticOffsetY = 0;
      cam._isSnappingBack = true;
      cam._snapBackElastic({ vx: 0, vy: 0 });
      return {
        isSnapping: cam._isSnappingBack,
        offsetX: cam.elasticOffsetX
      };
    });
    expect(result.isSnapping).toBe(true);
    expect(result.offsetX).toBe(30);
  });

  test('nonzero-velocity call restarts even when _isSnappingBack', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.elasticOffsetX = 30;
      cam.elasticOffsetY = 0;
      cam._isSnappingBack = true;
      cam._snapBackElastic({ vx: -500, vy: 0 });
      return {
        isSnapping: cam._isSnappingBack,
        animatorActive: cam._elasticAnimator?._rafId != null
      };
    });
    expect(result.isSnapping).toBe(true);
    expect(result.animatorActive).toBe(true);
  });

  test('negligible offset early return clears _isSnappingBack', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.elasticOffsetX = 0.1;
      cam.elasticOffsetY = 0;
      cam._isSnappingBack = true;
      // Nonzero velocity bypasses the Layer 1 double-fire guard,
      // letting us test the negligible-offset early return path.
      cam._snapBackElastic({ vx: 1, vy: 0 });
      return {
        isSnapping: cam._isSnappingBack,
        offsetX: cam.elasticOffsetX
      };
    });
    expect(result.isSnapping).toBe(false);
    expect(result.offsetX).toBe(0);
  });

  test('elastic animator settlement clears _isSnappingBack', async ({ page }) => {
    await page.evaluate(() => {
      const cam = __cam();
      cam.elasticOffsetX = 2;
      cam.elasticOffsetY = 0;
      if (cam._gestures) cam._gestures.request('SNAP_BACK');
      cam._snapBackElastic();
    });

    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && !cam._isSnappingBack && Math.abs(cam.elasticOffsetX) < 0.5;
    }, { timeout: 2000 });

    const result = await page.evaluate(() => ({
      isSnapping: __cam()._isSnappingBack,
      offsetX: __cam().elasticOffsetX
    }));
    expect(result.isSnapping).toBe(false);
    expect(result.offsetX).toBe(0);
  });
});
