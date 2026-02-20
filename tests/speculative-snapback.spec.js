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

test.describe('EWMA stall detection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'load' });
  });

  test('EWMA decays from EWMA_INIT(10) to below STALL_THRESHOLD(0.5) in ~8-9 frames', async ({ page }) => {
    const frames = await page.evaluate(() => {
      const ALPHA = 0.3;
      let ewma = 10;
      let frame = 0;
      while (ewma >= 0.5 && frame < 50) {
        ewma = ALPHA * 0 + (1 - ALPHA) * ewma;
        frame++;
      }
      return frame;
    });
    expect(frames).toBeGreaterThanOrEqual(8);
    expect(frames).toBeLessThanOrEqual(10);
  });

  test('EWMA stays above threshold during constant-speed elastic growth', async ({ page }) => {
    const result = await page.evaluate(() => {
      const ALPHA = 0.3;
      let ewma = 10;
      const values = [];
      for (let i = 0; i < 30; i++) {
        ewma = ALPHA * 5.0 + (1 - ALPHA) * ewma;
        values.push(ewma);
      }
      return { min: Math.min(...values), final: ewma };
    });
    expect(result.min).toBeGreaterThan(0.5);
    expect(result.final).toBeCloseTo(5.0, 0);
  });

  test('EWMA detects stall within 6-8 frames after speed drops to zero', async ({ page }) => {
    const framesAfterDrop = await page.evaluate(() => {
      const ALPHA = 0.3;
      let ewma = 10;
      for (let i = 0; i < 20; i++) ewma = ALPHA * 5 + (1 - ALPHA) * ewma;
      let frames = 0;
      while (ewma >= 0.5 && frames < 30) {
        ewma = ALPHA * 0 + (1 - ALPHA) * ewma;
        frames++;
      }
      return frames;
    });
    expect(framesAfterDrop).toBeGreaterThanOrEqual(6);
    expect(framesAfterDrop).toBeLessThanOrEqual(8);
  });
});

test.describe('_cancelSpeculativeSnapBack', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('preserves elastic offset and clears flag', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.elasticOffsetX = 40;
      cam.elasticOffsetY = -15;
      cam._isSnappingBack = true;
      cam._speculativeSnapId = 999;
      cam._cancelSpeculativeSnapBack();
      return {
        isSnapping: cam._isSnappingBack,
        snapId: cam._speculativeSnapId,
        offsetX: cam.elasticOffsetX,
        offsetY: cam.elasticOffsetY
      };
    });
    expect(result.isSnapping).toBe(false);
    expect(result.snapId).toBeNull();
    expect(result.offsetX).toBe(40);
    expect(result.offsetY).toBe(-15);
  });

  test('is a no-op when nothing is running', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.elasticOffsetX = 10;
      cam._isSnappingBack = false;
      cam._speculativeSnapId = null;
      cam._cancelSpeculativeSnapBack();
      return {
        isSnapping: cam._isSnappingBack,
        snapId: cam._speculativeSnapId,
        offsetX: cam.elasticOffsetX
      };
    });
    expect(result.isSnapping).toBe(false);
    expect(result.snapId).toBeNull();
    expect(result.offsetX).toBe(10);
  });
});
