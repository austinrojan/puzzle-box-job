import { test, expect } from '@playwright/test';
import { setupMapCamera } from './helpers.js';

// ============================================================
// Phase S3: Speculative snap-back tests
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

  test('nonzero-velocity call restarts even when _isSnappingBack', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.elasticOffsetX = 30;
      cam.elasticOffsetY = 0;
      cam._isSnappingBack = true;
      cam._snapBackElastic({ vx: -500, vy: 0 });
      return {
        isSnapping: cam._isSnappingBack,
        animatorActive: !cam._springLoop.elasticX.settled
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
      // Nonzero velocity bypasses the double-fire guard,
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
    await setupMapCamera(page);
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
      // Spy on spring target-setting to prove it was NOT called
      let springTargetCalled = false;
      if (cam._springLoop) {
        const orig = cam._springLoop.elasticX.setTarget.bind(cam._springLoop.elasticX);
        cam._springLoop.elasticX.setTarget = (...args) => { springTargetCalled = true; return orig(...args); };
      }
      cam._cancelSpeculativeSnapBack();
      return {
        isSnapping: cam._isSnappingBack,
        snapId: cam._speculativeSnapId,
        offsetX: cam.elasticOffsetX,
        springTargetCalled
      };
    });
    expect(result.isSnapping).toBe(false);
    expect(result.snapId).toBeNull();
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

test.describe('Speculative snap-back integration', () => {
  test.beforeEach(async ({ page }) => {
    await setupMapCamera(page);
  });

  test('elastic overscroll resolves within 500ms of last input', async ({ page }) => {
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

    const hasOffset = await page.evaluate(() => Math.abs(__cam().elasticOffsetX) > 0);
    expect(hasOffset).toBe(true);

    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && Math.abs(cam.elasticOffsetX) < 1.0;
    }, { timeout: 2000 });

    const offset = await page.evaluate(() => Math.abs(__cam().elasticOffsetX));
    expect(offset).toBeLessThan(1.0);
  });

  test('continuous scrolling at boundary is not interrupted by speculative snap-back', async ({ page }) => {
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      for (let i = 0; i < 200; i++) cam.panBy(50, 0);
    });

    for (let i = 0; i < 30; i++) {
      await page.evaluate(() => {
        const el = document.getElementById('map-container');
        const rect = el.getBoundingClientRect();
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 0, deltaX: -10, deltaMode: 0,
          ctrlKey: false, bubbles: true, cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
      });
      await page.waitForTimeout(16);
    }

    const result = await page.evaluate(() => ({
      offset: Math.abs(__cam().elasticOffsetX),
      snapping: __cam()._isSnappingBack
    }));
    expect(result.offset).toBeGreaterThan(0);
    expect(result.snapping).toBe(false);
  });

  test('mouse drag elastic overscroll works correctly after Phase S3', async ({ page }) => {
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
      return cam && Math.abs(cam.elasticOffsetX) < 1.0 && !cam._gestureActive;
    }, { timeout: 3000 });

    const result = await page.evaluate(() => ({
      offsetX: Math.abs(__cam().elasticOffsetX),
      isSnapping: __cam()._isSnappingBack
    }));
    expect(result.offsetX).toBeLessThan(1.0);
    expect(result.isSnapping).toBe(false);
  });
});
