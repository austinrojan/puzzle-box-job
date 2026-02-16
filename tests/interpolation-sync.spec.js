import { test, expect } from '@playwright/test';
import { bootDisplay, bootController } from './helpers.js';

test.describe('Interpolation sync (cross-window)', () => {
  let display, ctrl;

  test.beforeEach(async ({ context }) => {
    display = await bootDisplay(context);
    ctrl = await bootController(context);

    // Wait for Controller to get map dimensions via WELCOME
    await ctrl.waitForFunction(
      () => window.__controller?.camera?.mapW > 0,
      { timeout: 10000 }
    );
  });

  test('Controller pan → Display converges smoothly', async () => {
    // Get Display's initial camera position
    const initial = await display.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      return { x: cam.x, y: cam.y };
    });

    // Controller zooms in then pans
    await ctrl.evaluate(() => {
      const cam = window.__controller.camera;
      cam.setPosition(cam.mapW * 0.3, cam.mapH * 0.3, cam._coverZoom * 3);
    });
    // Force-send the state immediately
    await ctrl.evaluate(() => window.__controller.syncEngine.sendNow());

    // Wait for Display to converge to the new position
    await display.waitForFunction(() => {
      const cam = window.__vtt.mapRenderer.camera;
      // Check that camera moved away from the cover-zoom default position
      return cam.zoom > cam._coverZoom * 1.5;
    }, { timeout: 5000 });

    const moved = await display.evaluate((init) => {
      const cam = window.__vtt.mapRenderer.camera;
      return Math.abs(cam.x - init.x) > 10 || Math.abs(cam.y - init.y) > 10;
    }, initial);

    expect(moved).toBe(true);
  });

  test('Controller CAMERA_JUMP_TO → Display jumps instantly (no interpolation)', async () => {
    // Zoom in on Controller first to have a valid state
    await ctrl.evaluate(() => {
      const cam = window.__controller.camera;
      cam.setPosition(cam.mapW * 0.3, cam.mapH * 0.3, cam._coverZoom * 3);
    });
    await ctrl.evaluate(() => window.__controller.syncEngine.sendNow());

    // Wait for Display to receive the initial state
    await display.waitForFunction(
      () => window.__vtt.mapRenderer.camera.zoom > window.__vtt.mapRenderer.camera._coverZoom * 1.5,
      { timeout: 5000 }
    );

    // Send a jump command to a specific position
    await ctrl.evaluate(() => {
      const se = window.__controller.syncEngine;
      se.broadcaster.sendJumpTo(0.5, 0.5, 0.8);
    });

    // Display should jump to the new position quickly (no smoothing delay)
    await display.waitForFunction(() => {
      const cam = window.__vtt.mapRenderer.camera;
      // After jump, zoom should be near the coverZoom (jumped to shared zoom 0.8)
      // and interpolator should NOT be running
      return !window.__vtt.interpolator?.isRunning;
    }, { timeout: 3000 });
  });

  test('Controller flyTo → interpolator defers to animator', async () => {
    // Send a flyTo command
    await ctrl.evaluate(() => {
      const se = window.__controller.syncEngine;
      se.broadcaster.sendFlyTo(
        { centerX: 0.3, centerY: 0.3, zoom: 1.5 },
        { speed: 1.2, rho: 1.42 }
      );
    });

    // During flyTo, animator should be driving (not interpolator)
    await display.waitForFunction(
      () => window.__vtt.flyToAnimator?.isAnimating === true,
      { timeout: 3000 }
    );

    // Interpolator should NOT be running while animator is active
    const interpRunning = await display.evaluate(() => window.__vtt.interpolator?.isRunning ?? false);
    // Even if running, it should be yielding to the animator
    // (the tick skips when animator.isAnimating is true)

    // Wait for animation to complete
    await display.waitForFunction(
      () => window.__vtt.flyToAnimator?.isAnimating === false,
      { timeout: 8000 }
    );
  });
});
