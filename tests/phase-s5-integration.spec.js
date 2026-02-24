// @ts-check
import { test, expect } from '@playwright/test';
import { setupMapCamera, dispatchMouseWheelSequence } from './helpers.js';

// ============================================================
// Phase S5 Integration Tests — Unified Spring Physics
// ============================================================

test.describe('Phase S5: Unified Spring Physics', () => {
  test.beforeEach(async ({ page }) => {
    await setupMapCamera(page);
  });

  test('elastic snap-back settles within 400ms', async ({ page }) => {
    // Create elastic offset via trackpad-like wheel events at boundary
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      // Pan to right boundary
      for (let i = 0; i < 100; i++) cam.panBy(-50, 0);
    });

    // Push past boundary via panBy with gestureActive
    await page.evaluate(() => {
      const cam = __cam();
      cam._gestureActive = true;
      for (let i = 0; i < 10; i++) cam.panBy(-30, 0);
      cam._gestureActive = false;
      cam._gestures.request('SNAP_BACK');
      cam._snapBackElastic();
    });

    const hasOffset = await page.evaluate(() => Math.abs(__cam().elasticOffsetX) > 0.5);
    expect(hasOffset).toBe(true);

    // Wait for settlement — must use waitForFunction, NOT waitForTimeout
    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && Math.abs(cam.elasticOffsetX) < 0.5 && !cam._isSnappingBack;
    }, { timeout: 400 });
  });

  test('zoom during elastic snap-back does NOT freeze elastic offset', async ({ page }) => {
    // Create elastic offset and start snap-back
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      for (let i = 0; i < 100; i++) cam.panBy(-50, 0);

      cam._gestureActive = true;
      for (let i = 0; i < 10; i++) cam.panBy(-30, 0);
      cam._gestureActive = false;
      cam._gestures.request('SNAP_BACK');
      cam._snapBackElastic();
    });

    // Record elastic offset while snapping back
    const before = await page.evaluate(() => Math.abs(__cam().elasticOffsetX));
    expect(before).toBeGreaterThan(0.5);

    // Trigger zoom (this is the key test: zoom and elastic run in the SAME loop)
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoomToCenter(0.5);
    });

    // Elastic should still be resolving (not frozen)
    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && Math.abs(cam.elasticOffsetX) < 0.5;
    }, { timeout: 1000 });
  });

  test('elastic ceiling: aggressive overflow stays within 150/zoom world-space', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      for (let i = 0; i < 100; i++) cam.panBy(-50, 0);

      cam._gestureActive = true;
      // Aggressive overflow: 200 panBy calls past boundary
      for (let i = 0; i < 200; i++) cam.panBy(-50, 0);

      const maxWorld = 150 / cam.zoom;
      return {
        elasticX: Math.abs(cam.elasticOffsetX),
        ceiling: maxWorld,
        withinCeiling: Math.abs(cam.elasticOffsetX) <= maxWorld + 0.01,
      };
    });
    expect(result.withinCeiling).toBe(true);
  });

  test('scroll preference pan mode: mouse-like wheel events do not zoom', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam._scrollWheelBehavior = 'pan';
      cam.zoom = 2.0;
      cam._applyConstraints();
      const before = cam.zoom;

      if (cam._wheelClassifier) {
        cam._wheelClassifier._device = 'mouse';
        cam._wheelClassifier._lastEventTime = performance.now();
      }

      const el = document.getElementById('map-container');
      const rect = el.getBoundingClientRect();
      for (let i = 0; i < 5; i++) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -100, deltaX: 0, deltaMode: 0,
          ctrlKey: false, bubbles: true, cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
      }
      return { before, after: cam.zoom, changed: cam.zoom !== before };
    });
    expect(result.changed).toBe(false);
  });

  test('input-proportional drain: overflow drains when user scrolls back', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      // Pan to right boundary
      for (let i = 0; i < 100; i++) cam.panBy(-50, 0);

      // Build overflow by pushing past boundary
      cam._gestureActive = true;
      for (let i = 0; i < 10; i++) cam.panBy(-30, 0);
      const overflowAfterPush = cam._cumulativeOverflowX;

      // Reverse: scroll back (positive dx → camera moves left, back into bounds)
      for (let i = 0; i < 5; i++) cam.panBy(30, 0);
      const overflowAfterReverse = cam._cumulativeOverflowX;
      cam._gestureActive = false;

      return {
        overflowAfterPush,
        overflowAfterReverse,
        drained: Math.abs(overflowAfterReverse) < Math.abs(overflowAfterPush),
      };
    });
    expect(result.drained).toBe(true);
  });
});
