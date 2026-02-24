// @ts-check
import { test, expect } from '@playwright/test';
import { setupMapCamera, dispatchMouseWheelSequence } from './helpers.js';

test.describe('Scroll-wheel behavior preference', () => {
  test.beforeEach(async ({ page }) => {
    await setupMapCamera(page);
  });

  test('pan mode: mouse-like wheel events do NOT change zoom', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam._scrollWheelBehavior = 'pan';
      const zoomBefore = cam.zoom;
      const logTargetBefore = cam._springLoop.logZoom.target;

      const el = document.getElementById('map-container');
      const rect = el.getBoundingClientRect();

      if (cam._wheelClassifier) {
        cam._wheelClassifier._device = 'mouse';
        cam._wheelClassifier._lastEventTime = performance.now();
      }

      for (let i = 0; i < 5; i++) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -100, deltaX: 0, deltaMode: 0,
          ctrlKey: false, bubbles: true, cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
      }

      // In pan mode, zoom target should not change
      return {
        zoomBefore, zoomAfter: cam.zoom,
        targetChanged: cam._springLoop.logZoom.target !== logTargetBefore,
      };
    });
    expect(result.targetChanged).toBe(false);
  });

  test('zoom mode: trackpad-like wheel events DO trigger zoom target', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam._scrollWheelBehavior = 'zoom';
      const logTargetBefore = cam._springLoop.logZoom.target;

      const el = document.getElementById('map-container');
      const rect = el.getBoundingClientRect();

      if (cam._wheelClassifier) {
        cam._wheelClassifier._device = 'trackpad';
        cam._wheelClassifier._lastEventTime = performance.now();
      }

      // Use larger deltas to ensure measurable zoom change
      for (let i = 0; i < 5; i++) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -50, deltaX: 2, deltaMode: 0,
          ctrlKey: false, bubbles: true, cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
      }

      return {
        targetChanged: cam._springLoop.logZoom.target !== logTargetBefore,
      };
    });
    // In zoom mode, these events should update the zoom target
    expect(result.targetChanged).toBe(true);
  });

  test('auto mode: mouse wheel triggers zoom animation', async ({ page }) => {
    await dispatchMouseWheelSequence(page, { count: 3, deltaY: -100, gapMs: 200 });

    // Wait for spring to become unsettled (zoom animation started)
    await page.waitForFunction(() => {
      const cam = __cam();
      return !cam._springLoop.logZoom.settled;
    }, { timeout: 3000 });

    const result = await page.evaluate(() => {
      const cam = __cam();
      return {
        animating: !cam._springLoop.logZoom.settled,
        targetChanged: cam._springLoop.logZoom.target !== Math.log(cam.zoom),
      };
    });
    // Mouse in auto mode → should have triggered zoom animation
    expect(result.animating || result.targetChanged).toBe(true);
  });

  test('ctrl+wheel always zooms regardless of preference', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam._scrollWheelBehavior = 'pan'; // forced pan mode
      const zoomBefore = cam.zoom;

      const el = document.getElementById('map-container');
      const rect = el.getBoundingClientRect();

      // Ctrl+wheel goes through the dz !== 0 path, bypassing preference
      for (let i = 0; i < 3; i++) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -100, deltaX: 0, deltaMode: 0,
          ctrlKey: true, bubbles: true, cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
      }

      // Ctrl+wheel takes the dz path which calls zoomAt() directly (for trackpad)
      // or _smoothZoomTo (for mouse). Either way, zoom should change.
      return { zoomBefore, zoomAfter: cam.zoom, changed: cam.zoom !== zoomBefore };
    });
    expect(result.changed).toBe(true);
  });
});
