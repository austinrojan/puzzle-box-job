import { test, expect } from '@playwright/test';
import { setupMapCamera, panToBoundary } from './helpers.js';

// ============================================================
// Elastic snap-back guard and cancellation tests
// ============================================================

test.describe('_snapBackElastic double-fire guard', () => {
  test.beforeEach(async ({ page }) => {
    await setupMapCamera(page);
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

  test('nonzero-velocity call is also blocked when _isSnappingBack', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.elasticOffsetX = 30;
      cam.elasticOffsetY = 0;
      cam._isSnappingBack = true;
      const beforePos = cam._springLoop.elasticX.position;
      const beforeVel = cam._springLoop.elasticX.velocity;
      cam._snapBackElastic({ vx: -500, vy: 0 });
      return {
        isSnapping: cam._isSnappingBack,
        offsetX: cam.elasticOffsetX,
        posUnchanged: cam._springLoop.elasticX.position === beforePos,
        velUnchanged: cam._springLoop.elasticX.velocity === beforeVel,
      };
    });
    expect(result.isSnapping).toBe(true);
    expect(result.offsetX).toBe(30);
    expect(result.posUnchanged).toBe(true);
    expect(result.velUnchanged).toBe(true);
  });

  test('negligible offset early return zeroes offset without starting spring', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.elasticOffsetX = 0.1;
      cam.elasticOffsetY = 0;
      cam._isSnappingBack = false;
      cam._snapBackElastic({ vx: 0, vy: 0 });
      return {
        isSnapping: cam._isSnappingBack,
        offsetX: cam.elasticOffsetX
      };
    });
    expect(result.isSnapping).toBe(false);
    expect(result.offsetX).toBe(0);
  });

  test('onGestureStart is ignored during active snap-back', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.elasticOffsetX = 30;
      cam.elasticOffsetY = 0;
      cam._snapBackElastic();
      const springVelBefore = cam._springLoop.elasticX.velocity;
      // Simulate a late trackpad momentum event arriving during snap-back
      cam._trackpadDetector._callbacks.onGestureStart();
      return {
        isSnapping: cam._isSnappingBack,
        gestureActive: cam._gestureActive,
        springVelUnchanged: cam._springLoop.elasticX.velocity === springVelBefore
      };
    });
    expect(result.isSnapping).toBe(true);
    expect(result.gestureActive).toBe(false);
    expect(result.springVelUnchanged).toBe(true);
  });

  test('_feedElasticOverflow is rejected during active snap-back', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.elasticOffsetX = 30;
      cam.elasticOffsetY = 0;
      cam._snapBackElastic();
      const offsetBefore = cam.elasticOffsetX;
      cam._gestureActive = true; // normally blocked by onGestureStart guard, but test directly
      cam._feedElasticOverflow(100, 0);
      return {
        isSnapping: cam._isSnappingBack,
        offsetUnchanged: cam.elasticOffsetX === offsetBefore
      };
    });
    expect(result.isSnapping).toBe(true);
    expect(result.offsetUnchanged).toBe(true);
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

test.describe('_cancelSnapBack', () => {
  test.beforeEach(async ({ page }) => {
    await setupMapCamera(page);
  });

  test('freezes elastic springs and clears _isSnappingBack', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.elasticOffsetX = 40;
      cam.elasticOffsetY = -15;
      cam._isSnappingBack = true;
      cam._cancelSnapBack();
      return {
        isSnapping: cam._isSnappingBack,
        offsetX: cam.elasticOffsetX,
        offsetY: cam.elasticOffsetY,
        springSettled: cam._springLoop.elasticX.settled && cam._springLoop.elasticY.settled
      };
    });
    expect(result.isSnapping).toBe(false);
    expect(result.offsetX).toBe(40);
    expect(result.offsetY).toBe(-15);
  });

  test('is a no-op when _isSnappingBack is false', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.elasticOffsetX = 10;
      cam._isSnappingBack = false;
      let springTargetCalled = false;
      if (cam._springLoop) {
        const orig = cam._springLoop.elasticX.setTarget.bind(cam._springLoop.elasticX);
        cam._springLoop.elasticX.setTarget = (...args) => { springTargetCalled = true; return orig(...args); };
      }
      cam._cancelSnapBack();
      return {
        isSnapping: cam._isSnappingBack,
        offsetX: cam.elasticOffsetX,
        springTargetCalled
      };
    });
    expect(result.isSnapping).toBe(false);
    expect(result.offsetX).toBe(10);
    expect(result.springTargetCalled).toBe(false);
  });
});

test.describe('Tightened momentum detection timing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'load' });
  });

  test('tightened active timeout fires onGestureEnd within ~80ms', async ({ page }) => {
    const elapsed = await page.evaluate(async () => {
      const { TrackpadGestureDetector } = await import('/vtt/js/trackpad-gesture.js');
      return new Promise((resolve) => {
        const start = performance.now();
        const detector = new TrackpadGestureDetector({
          onGestureEnd: () => resolve(performance.now() - start)
        });
        detector.handleWheel({ deltaY: 10, deltaX: 0 });
      });
    });
    expect(elapsed).toBeGreaterThan(60);
    expect(elapsed).toBeLessThan(150);
  });
});

test.describe('Elastic snap-back integration', () => {
  test.beforeEach(async ({ page }) => {
    await setupMapCamera(page);
  });

  test('elastic overscroll resolves within 500ms of last input', async ({ page }) => {
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

    const hasOffset = await page.evaluate(() => Math.abs(__cam().elasticOffsetX) > 0);
    expect(hasOffset).toBe(true);

    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && Math.abs(cam.elasticOffsetX) < 1.0;
    }, { timeout: 2000 });

    const offset = await page.evaluate(() => Math.abs(__cam().elasticOffsetX));
    expect(offset).toBeLessThan(1.0);
  });

  test('continuous scrolling at boundary is not interrupted by snap-back', async ({ page }) => {
    await panToBoundary(page, 'left');

    // Batch-dispatch 30 events with mocked time (16ms spacing) to avoid
    // real-wall-clock timing dependency. The detector sees 16ms gaps and
    // stays in ACTIVE state. No rAF fires during the synchronous batch,
    // so speculative snap-back monitoring cannot trigger.
    await page.evaluate(() => {
      const origNow = performance.now;
      let t = origNow.call(performance);
      try {
        performance.now = () => t;
        const el = document.getElementById('map-container');
        const rect = el.getBoundingClientRect();
        for (let i = 0; i < 30; i++) {
          t += 16;
          el.dispatchEvent(new WheelEvent('wheel', {
            deltaY: 0, deltaX: -10, deltaMode: 0,
            ctrlKey: false, bubbles: true, cancelable: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
          }));
        }
      } finally {
        performance.now = origNow;
      }
    });

    const result = await page.evaluate(() => ({
      offset: Math.abs(__cam().elasticOffsetX),
      snapping: __cam()._isSnappingBack
    }));
    expect(result.offset).toBeGreaterThan(0);
    expect(result.snapping).toBe(false);
  });

  test('momentum with saturated elastic at boundary triggers early snap-back', async ({ page }) => {
    await panToBoundary(page, 'left');

    const el = page.locator('#map-container');
    const box = await el.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Send decaying deltas to trigger momentum detection and saturate elastic cap
    const result = await page.evaluate(({ cx, cy }) => {
      const el = document.getElementById('map-container');
      for (let i = 0; i < 14; i++) {
        const delta = 80 - i * 5;
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 0, deltaX: -delta, deltaMode: 0,
          ctrlKey: false, bubbles: true, cancelable: true,
          clientX: cx, clientY: cy,
        }));
      }
      const cam = __cam();
      return {
        isSnapping: cam._isSnappingBack,
        suppressed: cam._momentumPanSuppressed,
      };
    }, { cx, cy });

    expect(result.isSnapping).toBe(true);
    expect(result.suppressed).toBe(true);
  });

  test('small momentum deltas away from boundary do NOT cancel gesture', async ({ page }) => {
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      cam.x = cam.mapW / 4;
      cam.y = cam.mapH / 4;
    });

    const box = await page.locator('#map-container').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Batch-dispatch decaying deltas + trailing small delta with mocked time
    await page.evaluate(({ cx, cy }) => {
      const origNow = performance.now;
      let t = origNow.call(performance);
      try {
        performance.now = () => t;
        const el = document.getElementById('map-container');
        for (let i = 0; i < 6; i++) {
          t += 16;
          el.dispatchEvent(new WheelEvent('wheel', {
            deltaY: 0, deltaX: -(5 - i * 0.5), deltaMode: 0,
            ctrlKey: false, bubbles: true, cancelable: true,
            clientX: cx, clientY: cy,
          }));
        }
        t += 16;
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 0, deltaX: -0.5, deltaMode: 0,
          ctrlKey: false, bubbles: true, cancelable: true,
          clientX: cx, clientY: cy,
        }));
      } finally {
        performance.now = origNow;
      }
    }, { cx, cy });

    const result = await page.evaluate(() => ({
      detectorState: __cam()._trackpadDetector.state,
      elasticX: __cam().elasticOffsetX,
    }));

    expect(result.detectorState).not.toBe('IDLE');
    expect(result.elasticX).toBe(0);
  });

  test('mouse drag elastic overscroll works correctly', async ({ page }) => {
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

    const duringDrag = await page.evaluate(() => ({
      elasticX: __cam().elasticOffsetX,
      gestureActive: __cam()._gestureActive
    }));
    expect(duringDrag.gestureActive).toBe(true);
    expect(Math.abs(duringDrag.elasticX)).toBeGreaterThan(0);

    await page.mouse.up({ button: 'right' });

    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && Math.abs(cam.elasticOffsetX) < 1.0 && !cam._gestureActive && !cam._isSnappingBack;
    }, { timeout: 3000 });

    const result = await page.evaluate(() => ({
      offsetX: Math.abs(__cam().elasticOffsetX),
      isSnapping: __cam()._isSnappingBack
    }));
    expect(result.offsetX).toBeLessThan(1.0);
    expect(result.isSnapping).toBe(false);
  });

  test('small deltas at boundary trigger snap-back even without formal momentum', async ({ page }) => {
    await panToBoundary(page, 'left');

    const box = await page.locator('#map-container').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Send 10 events with NON-decaying small deltas (prevents momentum detection).
    // All deltas are identical (2px) — no decay streak can form.
    const result = await page.evaluate(({ cx, cy }) => {
      const el = document.getElementById('map-container');
      for (let i = 0; i < 10; i++) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 0, deltaX: -2, deltaMode: 0,
          ctrlKey: false, bubbles: true, cancelable: true,
          clientX: cx, clientY: cy,
        }));
      }
      const cam = __cam();
      return {
        isSnapping: cam._isSnappingBack,
        suppressed: cam._momentumPanSuppressed,
        momentumDetected: cam._momentumScrollActive,
      };
    }, { cx, cy });

    expect(result.momentumDetected).toBe(false);
    expect(result.isSnapping).toBe(true);
    expect(result.suppressed).toBe(true);
  });
});
