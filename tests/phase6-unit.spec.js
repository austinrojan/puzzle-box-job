import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode, injectTestAccessors } from './helpers.js';

// ============================================================
// TrackpadGestureDetector
// ============================================================
test.describe('TrackpadGestureDetector', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'load' });
  });

  test('first wheel event transitions from IDLE to ACTIVE', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { TrackpadGestureDetector } = await import('/vtt/js/trackpad-gesture.js');
      let started = false;
      const detector = new TrackpadGestureDetector({
        onGestureStart: () => { started = true; }
      });
      detector.handleWheel({ deltaY: 10, deltaX: 0 });
      return { state: detector.state, started };
    });
    expect(result.state).toBe('ACTIVE');
    expect(result.started).toBe(true);
  });

  test('sustained delta decay transitions to MOMENTUM', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { TrackpadGestureDetector } = await import('/vtt/js/trackpad-gesture.js');
      let momentumStarted = false;
      const detector = new TrackpadGestureDetector({
        onMomentumStart: () => { momentumStarted = true; }
      });
      // 6 active events (no decay)
      for (let i = 0; i < 6; i++) detector.handleWheel({ deltaY: 20, deltaX: 0 });
      const activeState = detector.state;
      // 3 decaying events → momentum
      detector.handleWheel({ deltaY: 18, deltaX: 0 });
      detector.handleWheel({ deltaY: 15, deltaX: 0 });
      detector.handleWheel({ deltaY: 12, deltaX: 0 });
      return { activeState, finalState: detector.state, momentumStarted };
    });
    expect(result.activeState).toBe('ACTIVE');
    expect(result.finalState).toBe('MOMENTUM');
    expect(result.momentumStarted).toBe(true);
  });

  test('delta spike during MOMENTUM restarts as ACTIVE', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { TrackpadGestureDetector } = await import('/vtt/js/trackpad-gesture.js');
      let startCount = 0;
      const detector = new TrackpadGestureDetector({
        onGestureStart: () => { startCount++; }
      });
      for (let i = 0; i < 6; i++) detector.handleWheel({ deltaY: 20, deltaX: 0 });
      detector.handleWheel({ deltaY: 18, deltaX: 0 });
      detector.handleWheel({ deltaY: 15, deltaX: 0 });
      detector.handleWheel({ deltaY: 12, deltaX: 0 });
      // Spike: new gesture
      detector.handleWheel({ deltaY: 25, deltaX: 0 });
      return { state: detector.state, startCount };
    });
    expect(result.state).toBe('ACTIVE');
    expect(result.startCount).toBe(2);
  });

  test('cancel() immediately resets to IDLE', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { TrackpadGestureDetector } = await import('/vtt/js/trackpad-gesture.js');
      let ended = false;
      const detector = new TrackpadGestureDetector({
        onGestureEnd: () => { ended = true; }
      });
      detector.handleWheel({ deltaY: 10, deltaX: 0 });
      detector.cancel();
      return { state: detector.state, ended };
    });
    expect(result.state).toBe('IDLE');
    expect(result.ended).toBe(true);
  });

  test('constant deltas do not trigger MOMENTUM (slow steady scroll)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { TrackpadGestureDetector } = await import('/vtt/js/trackpad-gesture.js');
      let momentumStarted = false;
      const detector = new TrackpadGestureDetector({
        onMomentumStart: () => { momentumStarted = true; }
      });
      for (let i = 0; i < 20; i++) detector.handleWheel({ deltaY: 5, deltaX: 0 });
      return { state: detector.state, momentumStarted };
    });
    expect(result.state).toBe('ACTIVE');
    expect(result.momentumStarted).toBe(false);
  });

  test('isGestureActive reflects ACTIVE and MOMENTUM states', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { TrackpadGestureDetector } = await import('/vtt/js/trackpad-gesture.js');
      const detector = new TrackpadGestureDetector({});
      const idle = detector.isGestureActive;
      detector.handleWheel({ deltaY: 10, deltaX: 0 });
      const active = detector.isGestureActive;
      return { idle, active };
    });
    expect(result.idle).toBe(false);
    expect(result.active).toBe(true);
  });
});

// ============================================================
// Dual-position elastic model
// ============================================================
test.describe('Dual-position elastic model', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('visualX/Y include elastic offset', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.elasticOffsetX = 10;
      cam.elasticOffsetY = 20;
      return {
        visualX: cam.visualX,
        visualY: cam.visualY,
        x: cam.x,
        y: cam.y,
      };
    });
    expect(result.visualX).toBe(result.x + 10);
    expect(result.visualY).toBe(result.y + 20);
  });

  test('_feedElasticOverflow produces rubber-banded offset', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam._gestureActive = true;
      cam._feedElasticOverflow(100, 0);
      return { offsetX: cam.elasticOffsetX, offsetY: cam.elasticOffsetY };
    });
    expect(Math.abs(result.offsetX)).toBeGreaterThan(0);
    expect(Math.abs(result.offsetX)).toBeLessThan(100); // Rubber-banded
    expect(result.offsetY).toBe(0);
  });

  test('_feedElasticOverflow dampens during momentum (c=0.3 vs 0.55)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam._gestureActive = true;
      cam._momentumScrollActive = false;
      cam._feedElasticOverflow(200, 0);
      const activeOffset = cam.elasticOffsetX;
      cam._momentumScrollActive = true;
      cam._feedElasticOverflow(200, 0);
      const momentumOffset = cam.elasticOffsetX;
      return { activeOffset, momentumOffset };
    });
    // Momentum offset should be smaller (more dampened)
    expect(Math.abs(result.momentumOffset)).toBeLessThan(Math.abs(result.activeOffset));
  });

  test('_feedElasticOverflow does nothing when _gestureActive is false', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam._gestureActive = false;
      cam._feedElasticOverflow(100, 100);
      return { offsetX: cam.elasticOffsetX, offsetY: cam.elasticOffsetY };
    });
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
  });

  test('panBy at boundary produces elastic offset when gesture active', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      // Zoom in so boundaries exist
      cam.zoom = 2.0;
      cam._applyConstraints();
      // Pan to left boundary
      for (let i = 0; i < 200; i++) cam.panBy(50, 0);
      const atBoundary = cam.x;
      // Now activate gesture and push past
      cam._gestureActive = true;
      cam._cumulativeOverflowX = 0;
      cam.panBy(200, 0);
      return {
        x: cam.x,
        atBoundary,
        elasticX: cam.elasticOffsetX,
      };
    });
    // camera.x should still be at the hard boundary (NOT < 0)
    expect(result.x).toBeCloseTo(result.atBoundary, 0);
    expect(result.x).toBeGreaterThanOrEqual(0);
    // elastic offset should be nonzero
    expect(Math.abs(result.elasticX)).toBeGreaterThan(0);
  });

  test('_applyConstraints always hard-clamps (no _isDragging branch)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam.x = -500; // Way past left boundary
      cam._applyConstraints();
      return { x: cam.x };
    });
    expect(result.x).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// SmoothZoomAnimator
// ============================================================
test.describe('SmoothZoomAnimator', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('onWheelZoom updates target within bounds', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      const animator = cam._smoothZoom;
      const before = animator._targetZoom;
      animator.onWheelZoom(-1.0, 500, 500); // Zoom in
      const after = animator._targetZoom;
      return { before, after };
    });
    expect(result.after).toBeGreaterThan(result.before);
  });

  test('retarget syncs to current camera zoom', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam._smoothZoom._targetZoom = 3.0;
      cam._smoothZoom.retarget();
      return cam._smoothZoom._targetZoom;
    });
    const currentZoom = await page.evaluate(() => __cam().zoom);
    expect(result).toBeCloseTo(currentZoom, 2);
  });

  test('cancel stops animation and resets target', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam._smoothZoom.onWheelZoom(-1.0, 500, 500);
      const animating = cam._smoothZoom._animating;
      cam._smoothZoom.cancel();
      return { wasAnimating: animating, isAnimating: cam._smoothZoom._animating };
    });
    expect(result.wasAnimating).toBe(true);
    expect(result.isAnimating).toBe(false);
  });
});

// ============================================================
// rubberBand function (still exists, just verify)
// ============================================================
test.describe('rubberBand function', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('diminishing returns on deeper overshoot', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      // Use _feedElasticOverflow to test rubber-band effect
      cam._gestureActive = true;
      cam._feedElasticOverflow(50, 0);
      const small = cam.elasticOffsetX;
      cam._feedElasticOverflow(500, 0);
      const large = cam.elasticOffsetX;
      // Ratio: 500/50 = 10x input, but output ratio should be much less
      return { small, large, ratio: Math.abs(large / small) };
    });
    expect(result.ratio).toBeLessThan(10);
    expect(result.ratio).toBeGreaterThan(1);
  });
});
