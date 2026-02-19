import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode, injectTestAccessors, dispatchMouseWheelSequence } from './helpers.js';

// ============================================================
// Trackpad elastic overscroll
// ============================================================
test.describe('Trackpad elastic overscroll', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('trackpad scroll at boundary produces elastic offset', async ({ page }) => {
    // Zoom in to create room to pan
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
    });

    // Pan to the left boundary (panBy(50,0) → rawX = x - 50/zoom → camera moves left)
    await page.evaluate(() => {
      const cam = __cam();
      for (let i = 0; i < 200; i++) cam.panBy(50, 0);
    });

    // Dispatch trackpad-like wheel events to push PAST the left boundary.
    // deltaX: -15 → normalizeWheel dx: -15 → panBy(15, 0) → camera moves left
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
    // panBy + elastic offset are synchronous — no wait needed

    const result = await page.evaluate(() => {
      const cam = __cam();
      return { elasticX: cam.elasticOffsetX, x: cam.x };
    });

    // camera.x at hard boundary, elastic offset nonzero
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(Math.abs(result.elasticX)).toBeGreaterThan(0);
  });

  test('elastic offset springs back to zero after gesture end', async ({ page }) => {
    // Setup: zoom in + pan to boundary + dispatch scroll events
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      for (let i = 0; i < 200; i++) cam.panBy(50, 0);
    });

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

    // Wait for gesture end timeout (150ms) + spring animation (~250ms)
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
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('right-click drag past boundary produces elastic offset', async ({ page }) => {
    // Zoom in and position camera at the right boundary.
    // Dragging LEFT (within the container) pushes rawX past maxX → overflow.
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam.x = cam.mapW; // past right boundary — _applyConstraints clamps to maxX
      cam._applyConstraints();
    });

    const canvas = page.locator('#map-container');
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Right-click drag from center toward left edge (stays INSIDE container)
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
    // cam.x stays at hard boundary (dual-position model)
    expect(duringDrag.x).toBeGreaterThanOrEqual(0);

    // Release
    await page.mouse.up({ button: 'left' }); // wrong button first to verify only right matters
    await page.mouse.up({ button: 'right' });

    // Wait for snap-back
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
    // Move past threshold (3px)
    await page.mouse.move(cx + 50, cy, { steps: 5 });

    const active = await page.evaluate(() => __cam()._gestureActive);
    expect(active).toBe(true);

    await page.mouse.up({ button: 'left' });
    // After release: gestureActive may be true briefly (inertial coast) or false
    // Wait for everything to settle
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
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('mouse wheel scroll triggers smooth zoom (not pan)', async ({ page }) => {
    const beforeZoom = await page.evaluate(() => __cam().zoom);

    await dispatchMouseWheelSequence(page);

    // Wait for smooth zoom animation to settle
    await page.waitForFunction(() => {
      return !window.__vtt?.mapRenderer?.camera?._smoothZoom?._animating;
    }, { timeout: 2000 });

    const afterZoom = await page.evaluate(() => __cam().zoom);
    // Mouse wheel scroll up (-100 deltaY) → zoom in
    expect(afterZoom).toBeGreaterThan(beforeZoom);
  });
});

// ============================================================
// Gesture preemption
// ============================================================
test.describe('Gesture preemption', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('mouse drag preempts scroll gesture', async ({ page }) => {
    // Start a scroll gesture
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      // Simulate trackpad scroll gesture start (small fractional delta)
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

    // Now start a mouse drag (higher priority)
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
// Stateful device classification (Phase S1)
// ============================================================
test.describe('Stateful device classification', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('fast trackpad scroll does NOT trigger zoom (bug #4 regression)', async ({ page }) => {
    // Zoom in so pan has room to operate at all viewports
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
    });
    const before = await page.evaluate(() => __cam().zoom);

    // Dispatch 10 rapid wheel events mimicking fast trackpad scroll.
    // Large integer deltaY (80) with no horizontal — the OLD classifier
    // would misidentify as mouse and route to SmoothZoomAnimator.
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
    // Negative assertion: need time-based wait since we're verifying nothing happens.
    // Condition-based waiting is inappropriate for "nothing changed" assertions.
    await page.waitForTimeout(100);

    const after = await page.evaluate(() => __cam().zoom);

    // THE critical assertion: zoom must not change.
    // Fast trackpad scroll routes to panBy(), not SmoothZoomAnimator.
    // Pan may or may not move depending on viewport constraints,
    // but zoom must remain unchanged.
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
    // zoomAt is synchronous — no wait needed

    const after = await page.evaluate(() => __cam().zoom);
    expect(after).not.toBeCloseTo(before, 4);
  });

  test('mouse wheel without ctrl triggers zoom (via timing gaps)', async ({ page }) => {
    const before = await page.evaluate(() => __cam().zoom);

    await dispatchMouseWheelSequence(page);

    // Wait for smooth zoom animation to settle
    await page.waitForFunction(() => {
      return !window.__vtt?.mapRenderer?.camera?._smoothZoom?._animating;
    }, { timeout: 2000 });

    const after = await page.evaluate(() => __cam().zoom);
    expect(after).toBeGreaterThan(before);
  });
});
