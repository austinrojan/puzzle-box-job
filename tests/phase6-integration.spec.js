import { test, expect } from '@playwright/test';
import { setupMapCamera, panToBoundary, dispatchMouseWheelSequence } from './helpers.js';

// ============================================================
// Trackpad elastic overscroll
// ============================================================
test.describe('Trackpad elastic overscroll', () => {
  test.beforeEach(async ({ page }) => {
    await setupMapCamera(page);
  });

  test('trackpad scroll at boundary produces elastic offset', async ({ page }) => {
    await panToBoundary(page, 'left');

    // Dispatch trackpad-like wheel events to push past the left boundary
    await page.evaluate(() => {
      const el = document.getElementById('map-container');
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      for (let i = 0; i < 10; i++) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 0, deltaX: -15, deltaMode: 0,
          ctrlKey: false, bubbles: true, cancelable: true,
          clientX: cx, clientY: cy,
        }));
      }
    });

    const result = await page.evaluate(() => {
      const cam = __cam();
      return { elasticX: cam.elasticOffsetX, x: cam.x };
    });

    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(Math.abs(result.elasticX)).toBeGreaterThan(0);
  });

  test('elastic offset springs back to zero after gesture end', async ({ page }) => {
    await panToBoundary(page, 'left');

    await page.evaluate(() => {
      const el = document.getElementById('map-container');
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      for (let i = 0; i < 10; i++) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 0, deltaX: -15, deltaMode: 0,
          ctrlKey: false, bubbles: true, cancelable: true,
          clientX: cx, clientY: cy,
        }));
      }
    });

    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && Math.abs(cam.elasticOffsetX) < 1.0;
    }, { timeout: 2000 });

    const offset = await page.evaluate(() => __cam().elasticOffsetX);
    expect(Math.abs(offset)).toBeLessThan(1.0);
  });
});

// ============================================================
// Mouse drag elastic with dual-position model
// ============================================================
test.describe('Mouse drag elastic (dual-position)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMapCamera(page);
  });

  test('right-click drag past boundary produces elastic offset', async ({ page }) => {
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam.x = cam.mapW;
      cam._applyConstraints();
    });

    const canvas = page.locator('#map-container');
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + 50, cy, { steps: 10 });

    const duringDrag = await page.evaluate(() => {
      const cam = __cam();
      return {
        elasticX: cam.elasticOffsetX,
        gestureActive: cam._gestureActive,
        x: cam.x,
      };
    });

    expect(duringDrag.gestureActive).toBe(true);
    expect(Math.abs(duringDrag.elasticX)).toBeGreaterThan(0);
    expect(duringDrag.x).toBeGreaterThanOrEqual(0);

    await page.mouse.up({ button: 'left' });
    await page.mouse.up({ button: 'right' });

    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && Math.abs(cam.elasticOffsetX) < 1.0 && !cam._gestureActive;
    }, { timeout: 2000 });

    const afterRelease = await page.evaluate(() => Math.abs(__cam().elasticOffsetX));
    expect(afterRelease).toBeLessThan(1.0);
  });

  test('left-click drag past threshold activates _gestureActive', async ({ page }) => {
    await page.evaluate(() => { __cam().zoom = 2.0; __cam()._applyConstraints(); });
    const canvas = page.locator('#map-container');
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(cx + 50, cy, { steps: 5 });

    const active = await page.evaluate(() => __cam()._gestureActive);
    expect(active).toBe(true);

    await page.mouse.up({ button: 'left' });
    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && !cam._gestureActive && Math.abs(cam.elasticOffsetX) < 1.0;
    }, { timeout: 2000 });
  });
});

// ============================================================
// Smooth zoom via mouse wheel
// ============================================================
test.describe('Smooth zoom animation', () => {
  test.beforeEach(async ({ page }) => {
    await setupMapCamera(page);
  });

  test('mouse wheel scroll triggers smooth zoom (not pan)', async ({ page }) => {
    const beforeZoom = await page.evaluate(() => __cam().zoom);

    await dispatchMouseWheelSequence(page);

    // Wait for smooth zoom animation to settle
    await page.waitForFunction(() => {
      return window.__vtt?.mapRenderer?.camera?._springLoop?.logZoom?.settled;
    }, { timeout: 2000 });

    const afterZoom = await page.evaluate(() => __cam().zoom);
    expect(afterZoom).toBeGreaterThan(beforeZoom);
  });
});

// ============================================================
// Gesture preemption
// ============================================================
test.describe('Gesture preemption', () => {
  test.beforeEach(async ({ page }) => {
    await setupMapCamera(page);
  });

  test('mouse drag preempts scroll gesture', async ({ page }) => {
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      const el = document.getElementById('map-container');
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 3.5, deltaX: 0, deltaMode: 0,
        ctrlKey: false, bubbles: true, cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }));
    });

    const gestureBeforeDrag = await page.evaluate(() => __cam()._gestures?.current);
    expect(gestureBeforeDrag).toBe('SCROLL_PAN');

    const canvas = page.locator('#map-container');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });

    const gestureAfterDrag = await page.evaluate(() => __cam()._gestures?.current);
    expect(gestureAfterDrag).toBe('DRAG_PAN');

    await page.mouse.up({ button: 'right' });
  });
});

// ============================================================
// Stateful device classification
// ============================================================
test.describe('Stateful device classification', () => {
  test.beforeEach(async ({ page }) => {
    await setupMapCamera(page);
  });

  test('fast trackpad scroll does NOT trigger zoom (bug #4 regression)', async ({ page }) => {
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
    });
    const before = await page.evaluate(() => __cam().zoom);

    // Dispatch 10 rapid wheel events mimicking fast trackpad scroll
    await page.evaluate(() => {
      const el = document.getElementById('map-container');
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      for (let i = 0; i < 10; i++) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -80, deltaX: 0, deltaMode: 0,
          ctrlKey: false, bubbles: true, cancelable: true,
          clientX: cx, clientY: cy,
        }));
      }
    });
    // Wait 2 rAF frames for any pending animation to process
    await page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));

    const after = await page.evaluate(() => __cam().zoom);
    expect(after).toBeCloseTo(before, 4);
  });

  test('ctrl+wheel from trackpad still zooms correctly', async ({ page }) => {
    const before = await page.evaluate(() => __cam().zoom);

    await page.evaluate(() => {
      const el = document.getElementById('map-container');
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      for (let i = 0; i < 5; i++) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -5, deltaX: 0, deltaMode: 0,
          ctrlKey: true, bubbles: true, cancelable: true,
          clientX: cx, clientY: cy,
        }));
      }
    });

    const after = await page.evaluate(() => __cam().zoom);
    expect(after).not.toBeCloseTo(before, 4);
  });

  test('mouse wheel without ctrl triggers zoom (via timing gaps)', async ({ page }) => {
    const before = await page.evaluate(() => __cam().zoom);

    await dispatchMouseWheelSequence(page);

    // Wait for smooth zoom animation to settle
    await page.waitForFunction(() => {
      return window.__vtt?.mapRenderer?.camera?._springLoop?.logZoom?.settled;
    }, { timeout: 2000 });

    const after = await page.evaluate(() => __cam().zoom);
    expect(after).toBeGreaterThan(before);
  });
});

// ============================================================
// Gesture coordination
// ============================================================
test.describe('Gesture coordination', () => {
  test.beforeEach(async ({ page }) => {
    await setupMapCamera(page);
  });

  test('rapid alternating scroll/pinch events do not oscillate', async ({ page }) => {
    const transitions = await page.evaluate(async () => {
      const cam = __cam();
      cam.zoom = 2.0; cam._applyConstraints();
      const el = document.getElementById('map-container');
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const modes = [];
      for (let i = 0; i < 20; i++) {
        const isCtrl = i % 2 === 0;
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: isCtrl ? -2 : 10, deltaX: isCtrl ? 0 : 3.5,
          deltaMode: 0, ctrlKey: isCtrl, bubbles: true, cancelable: true,
          clientX: cx, clientY: cy,
        }));
        modes.push(cam._gestures?.current || 'UNKNOWN');
        await new Promise(r => setTimeout(r, 8));
      }
      let count = 0;
      for (let i = 1; i < modes.length; i++) if (modes[i] !== modes[i - 1]) count++;
      return count;
    });
    expect(transitions).toBeLessThan(8);
  });

  test('mouse drag preempts scroll without dwell delay', async ({ page }) => {
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0; cam._applyConstraints();
      const el = document.getElementById('map-container');
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 5.5, deltaX: 2.1, deltaMode: 0, ctrlKey: false,
        bubbles: true, cancelable: true,
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
      }));
    });

    const before = await page.evaluate(() => __cam()._gestures?.current);
    expect(before).toBe('SCROLL_PAN');

    const canvas = page.locator('#map-container');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });

    const after = await page.evaluate(() => __cam()._gestures?.current);
    expect(after).toBe('DRAG_PAN');
    await page.mouse.up({ button: 'right' });
  });

  test('zoom during elastic overscroll uses correct anchor', async ({ page }) => {
    await panToBoundary(page, 'left');

    await page.evaluate(() => {
      const cam = __cam();
      cam._gestureActive = true; cam._cumulativeOverflowX = 0;
      for (let i = 0; i < 5; i++) cam.panBy(100, 0);
    });

    const before = await page.evaluate(() => ({
      x: __cam().x, elasticX: __cam().elasticOffsetX, zoom: __cam().zoom,
    }));
    expect(Math.abs(before.elasticX)).toBeGreaterThan(0);

    await page.evaluate(() => __cam().zoomAt(960, 540, 0.1));

    const after = await page.evaluate(() => ({ x: __cam().x, zoom: __cam().zoom }));
    expect(after.zoom).toBeGreaterThan(before.zoom);
    expect(Math.abs(after.x - before.x)).toBeLessThan(80);
  });
});
