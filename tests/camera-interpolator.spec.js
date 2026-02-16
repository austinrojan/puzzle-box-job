import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode } from './helpers.js';

test.describe('CameraInterpolator', () => {
  test.describe('pure math', () => {
    test.beforeEach(async ({ page }) => {
      await gotoVTT(page);
      await enterMapMode(page);
    });

    test('frame-rate independence: many small steps ≈ one large step', async ({ page }) => {
      const result = await page.evaluate(() => {
        const halfLife = 0.05;
        const start = 100;
        const target = 0;

        // 60 steps at 1/60s each
        let value60 = start;
        for (let i = 0; i < 60; i++) {
          value60 = target + (value60 - target) * Math.pow(0.5, (1/60) / halfLife);
        }

        // 1 step at 1s
        let value1 = start;
        value1 = target + (value1 - target) * Math.pow(0.5, 1.0 / halfLife);

        return { value60, value1, diff: Math.abs(value60 - value1) };
      });

      expect(result.diff).toBeLessThan(1e-10);
    });

    test('after one half-life, gap halves', async ({ page }) => {
      const result = await page.evaluate(() => {
        const halfLife = 0.05;
        const start = 100;
        const target = 0;
        const gap = start - target;

        const after = target + (start - target) * Math.pow(0.5, halfLife / halfLife);
        const newGap = after - target;
        return { gap, newGap, ratio: newGap / gap };
      });

      expect(result.ratio).toBeCloseTo(0.5, 10);
    });
  });

  test.describe('integration', () => {
    test.beforeEach(async ({ page }) => {
      await gotoVTT(page);
      await enterMapMode(page);
      // Preload the module
      await page.evaluate(async () => {
        window.__interpolatorModule = await import('/vtt/js/camera-interpolator.js');
      });
    });

    test('setTarget starts convergence toward target', async ({ page }) => {
      // Zoom in to 3x so camera has room to pan
      // Then position camera away from center to leave pan room
      const target = await page.evaluate(() => {
        const cam = window.__vtt.mapRenderer.camera;
        cam.setPosition(cam.mapW * 0.3, cam.mapH * 0.3, cam._coverZoom * 3);
        // Compute a target that's toward center (guaranteed within bounds)
        const visW = cam.viewportW / cam.zoom;
        const visH = cam.viewportH / cam.zoom;
        const maxX = cam.mapW - visW;
        const maxY = cam.mapH - visH;
        const tx = Math.min(cam.x + 100, maxX);
        const ty = Math.min(cam.y + 80, maxY);
        return { x: tx, y: ty, zoom: cam.zoom, startX: cam.x, startY: cam.y };
      });

      await page.evaluate((t) => {
        const { CameraInterpolator } = window.__interpolatorModule;
        const cam = window.__vtt.mapRenderer.camera;
        const animator = window.__vtt.flyToAnimator;
        window.__testInterpolator = new CameraInterpolator(cam, animator, { halfLife: 0.03 });
        window.__testInterpolator.setTarget({ x: t.x, y: t.y, zoom: t.zoom });
      }, target);

      // Wait for interpolator to converge and stop
      await page.waitForFunction(() => !window.__testInterpolator.isRunning, { timeout: 2000 });

      // Verify camera reached target
      const final = await page.evaluate((t) => {
        const cam = window.__vtt.mapRenderer.camera;
        return { dx: Math.abs(cam.x - t.x), dy: Math.abs(cam.y - t.y) };
      }, target);
      expect(final.dx).toBeLessThan(1);
      expect(final.dy).toBeLessThan(1);

      await page.evaluate(() => window.__testInterpolator.destroy());
    });

    test('snapToTarget applies position instantly', async ({ page }) => {
      // Zoom in to 3x and position away from edges
      const result = await page.evaluate(() => {
        const { CameraInterpolator } = window.__interpolatorModule;
        const cam = window.__vtt.mapRenderer.camera;
        cam.setPosition(cam.mapW * 0.3, cam.mapH * 0.3, cam._coverZoom * 3);

        const animator = window.__vtt.flyToAnimator;
        const interp = new CameraInterpolator(cam, animator);

        // Compute a target within bounds (toward center)
        const visW = cam.viewportW / cam.zoom;
        const visH = cam.viewportH / cam.zoom;
        const tx = Math.min(cam.x + 80, cam.mapW - visW);
        const ty = Math.min(cam.y + 60, cam.mapH - visH);

        const target = { x: tx, y: ty, zoom: cam.zoom };
        interp.setTarget(target);
        interp.snapToTarget();

        const result = {
          dx: Math.abs(cam.x - target.x),
          dy: Math.abs(cam.y - target.y),
          isRunning: interp.isRunning,
        };
        interp.destroy();
        return result;
      });

      expect(result.dx).toBeLessThan(1);
      expect(result.dy).toBeLessThan(1);
      expect(result.isRunning).toBe(false);
    });

    test('suppressBroadcast is true while running, false when converged', async ({ page }) => {
      await page.evaluate(() => {
        const cam = window.__vtt.mapRenderer.camera;
        cam.setPosition(cam.mapW * 0.3, cam.mapH * 0.3, cam._coverZoom * 3);
      });

      const beforeTarget = await page.evaluate(() => {
        const { CameraInterpolator } = window.__interpolatorModule;
        const cam = window.__vtt.mapRenderer.camera;
        const animator = window.__vtt.flyToAnimator;
        window.__testInterpolator = new CameraInterpolator(cam, animator, { halfLife: 0.03 });
        return window.__testInterpolator.suppressBroadcast;
      });
      expect(beforeTarget).toBe(false);

      await page.evaluate(() => {
        const cam = window.__vtt.mapRenderer.camera;
        const visW = cam.viewportW / cam.zoom;
        const visH = cam.viewportH / cam.zoom;
        const tx = Math.min(cam.x + 80, cam.mapW - visW);
        const ty = Math.min(cam.y + 80, cam.mapH - visH);
        window.__testInterpolator.setTarget({ x: tx, y: ty, zoom: cam.zoom });
      });

      const duringRun = await page.evaluate(() => window.__testInterpolator.suppressBroadcast);
      expect(duringRun).toBe(true);

      await page.waitForFunction(
        () => !window.__testInterpolator.suppressBroadcast,
        { timeout: 2000 }
      );

      await page.evaluate(() => window.__testInterpolator.destroy());
    });

    test('skips interpolation while animator is animating', async ({ page }) => {
      const result = await page.evaluate(() => {
        const { CameraInterpolator } = window.__interpolatorModule;
        const cam = window.__vtt.mapRenderer.camera;
        // Mock animator with isAnimating = true
        const mockAnimator = { isAnimating: true };
        const interp = new CameraInterpolator(cam, mockAnimator, { halfLife: 0.03 });

        const beforeX = cam.x;
        const beforeY = cam.y;

        interp.setTarget({ x: cam.x + 500, y: cam.y + 500, zoom: cam.zoom });

        // After two rAF frames, camera should NOT have moved (animator blocks)
        return new Promise(resolve => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve({
                moved: cam.x !== beforeX || cam.y !== beforeY,
                isRunning: interp.isRunning,
              });
              interp.destroy();
            });
          });
        });
      });

      expect(result.moved).toBe(false);
      expect(result.isRunning).toBe(true);
    });
  });
});
