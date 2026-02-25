import { test, expect } from '@playwright/test';
import { bootDisplay, bootController, waitForControllerMap, waitForFlyToAnimator } from './helpers.js';

test.describe('Cross-window flyTo sync', () => {
  /** @type {import('@playwright/test').BrowserContext} */
  let context;

  test.afterEach(async () => {
    if (context) {
      await context.close();
      context = null;
    }
  });

  test('Controller sends CAMERA_FLY_TO → Display animates to target', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);

    // Wait for handshake (Display has a map loaded)
    await waitForControllerMap(ctrl, 5000);

    // Wait for Display to have flyToAnimator wired
    await waitForFlyToAnimator(display);

    // Record Display camera state before
    const before = await display.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      return { x: cam.x, y: cam.y, zoom: cam.zoom };
    });

    // Controller sends flyTo to map center at higher zoom
    await ctrl.evaluate(() => {
      const cam = window.__controller.camera;
      const target = {
        centerX: cam.mapW / 2,
        centerY: cam.mapH / 2,
        zoom: cam._coverZoom * 2,
      };
      window.__controller.syncEngine._broadcaster.sendFlyTo(target, { duration: 300 });
    });

    // Wait for Display camera to change (animation in progress or complete)
    await display.waitForFunction((prev) => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return false;
      return Math.abs(cam.zoom - prev.zoom) > 0.01 ||
             Math.abs(cam.x - prev.x) > 1 ||
             Math.abs(cam.y - prev.y) > 1;
    }, before, { timeout: 5000 });

    const after = await display.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      return { x: cam.x, y: cam.y, zoom: cam.zoom };
    });

    // Camera should have moved
    const moved = Math.abs(after.x - before.x) > 0.5 ||
                  Math.abs(after.y - before.y) > 0.5 ||
                  Math.abs(after.zoom - before.zoom) > 0.01;
    expect(moved).toBe(true);
  });

  test('Controller flyTo → Display reaches correct endpoint', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);

    await waitForControllerMap(ctrl, 5000);
    await waitForFlyToAnimator(display);

    // Move Controller camera to target first, then send flyTo.
    // This ensures the CAMERA_SYNC stream reinforces (not fights) the
    // flyTo target — the Display's interpolator applies CAMERA_SYNC
    // after flyTo completes, so they must agree.
    const expected = await ctrl.evaluate(() => {
      const cam = window.__controller.camera;
      const target = {
        centerX: cam.mapW / 2,
        centerY: cam.mapH / 2,
        zoom: cam._coverZoom * 1.5,
      };

      // Move Controller camera (constraints may clamp)
      const vp = { width: cam.viewportW, height: cam.viewportH };
      const x = target.centerX - (vp.width / 2) / target.zoom;
      const y = target.centerY - (vp.height / 2) / target.zoom;
      cam.deserialize({ x, y, zoom: target.zoom });

      // Read back actual (clamped) position as the expected value
      const actual = {
        centerX: cam.x + (vp.width / 2) / cam.zoom,
        centerY: cam.y + (vp.height / 2) / cam.zoom,
        zoom: cam.zoom,
      };

      window.__controller.syncEngine._broadcaster.sendFlyTo(actual, { duration: 250 });
      window.__controller.syncEngine.sendNow();
      return actual;
    });

    // Capture camera position at the exact frame the animation ends,
    // before the interpolator (50ms half-life) pulls it toward CAMERA_SYNC.
    const finalState = await display.waitForFunction(() => {
      const a = window.__vtt?.flyToAnimator;
      if (!a || a.isAnimating) return null;
      const cam = window.__vtt.mapRenderer.camera;
      const vp = { width: cam.viewportW, height: cam.viewportH };
      return {
        centerX: cam.x + (vp.width / 2) / cam.zoom,
        centerY: cam.y + (vp.height / 2) / cam.zoom,
        zoom: cam.zoom,
      };
    }, { timeout: 5000 }).then(h => h.jsonValue());

    // Controller (headless) and Display (real viewport with scaler) share the
    // same map but may have different constraint clamping due to viewport scaler.
    const posTolerance = 50;
    expect(Math.abs(finalState.centerX - expected.centerX)).toBeLessThan(posTolerance);
    expect(Math.abs(finalState.centerY - expected.centerY)).toBeLessThan(posTolerance);
    expect(finalState.zoom).toBeCloseTo(expected.zoom, 0);
  });

  test('Display flyTo can be interrupted by user scroll', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);

    await waitForControllerMap(ctrl, 5000);
    await waitForFlyToAnimator(display);

    // Start a long flyTo
    await ctrl.evaluate(() => {
      const cam = window.__controller.camera;
      const target = {
        centerX: cam.mapW * 0.75,
        centerY: cam.mapH * 0.75,
        zoom: cam._coverZoom * 2.5,
      };
      window.__controller.syncEngine._broadcaster.sendFlyTo(target, { duration: 3000 });
    });

    // Wait for animation to start on Display
    await display.waitForFunction(() => {
      return window.__vtt?.flyToAnimator?.isAnimating === true;
    }, { timeout: 5000 });

    // Interrupt with mouse wheel on map container
    const mapContainer = display.locator('#map-container');
    await mapContainer.dispatchEvent('wheel', { deltaY: -100, bubbles: true });

    // Wait for animation to stop (interrupt should trigger)
    await display.waitForFunction(() => {
      return window.__vtt?.flyToAnimator?.isAnimating === false;
    }, { timeout: 3000 });

    const isAnimating = await display.evaluate(() =>
      window.__vtt.flyToAnimator.isAnimating
    );
    expect(isAnimating).toBe(false);
  });
});
