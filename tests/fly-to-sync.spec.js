import { test, expect } from '@playwright/test';
import { bootDisplay, bootController } from './helpers.js';

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
    await ctrl.waitForFunction(
      () => window.__controller?.camera?.mapW > 0,
      { timeout: 5000 }
    );

    // Wait for Display to have flyToAnimator wired
    await display.waitForFunction(
      () => window.__vtt?.flyToAnimator != null,
      { timeout: 5000 }
    );

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

    await ctrl.waitForFunction(
      () => window.__controller?.camera?.mapW > 0,
      { timeout: 5000 }
    );
    await display.waitForFunction(
      () => window.__vtt?.flyToAnimator != null,
      { timeout: 5000 }
    );

    // Controller sends flyTo with a short duration
    const target = await ctrl.evaluate(() => {
      const cam = window.__controller.camera;
      const t = {
        centerX: cam.mapW / 2,
        centerY: cam.mapH / 2,
        zoom: cam._coverZoom * 1.5,
      };
      window.__controller.syncEngine._broadcaster.sendFlyTo(t, { duration: 250 });
      return t;
    });

    // Wait for animation to complete on Display
    await display.waitForFunction(() => {
      const a = window.__vtt?.flyToAnimator;
      return a && !a.isAnimating;
    }, { timeout: 5000 });

    // Small delay for final frame to apply
    await display.waitForFunction((tgt) => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return false;
      // Check zoom is close to target (constraints may clamp slightly)
      return Math.abs(cam.zoom - tgt.zoom) < 0.1;
    }, target, { timeout: 3000 });

    const finalState = await display.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      const { localToShared } = window.__vtt; // not available, compute manually
      const vp = { width: cam.viewportW, height: cam.viewportH };
      return {
        centerX: cam.x + (vp.width / 2) / cam.zoom,
        centerY: cam.y + (vp.height / 2) / cam.zoom,
        zoom: cam.zoom,
      };
    });

    expect(finalState.centerX).toBeCloseTo(target.centerX, 0);
    expect(finalState.centerY).toBeCloseTo(target.centerY, 0);
    expect(finalState.zoom).toBeCloseTo(target.zoom, 1);
  });

  test('Display flyTo can be interrupted by user scroll', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);

    await ctrl.waitForFunction(
      () => window.__controller?.camera?.mapW > 0,
      { timeout: 5000 }
    );
    await display.waitForFunction(
      () => window.__vtt?.flyToAnimator != null,
      { timeout: 5000 }
    );

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
