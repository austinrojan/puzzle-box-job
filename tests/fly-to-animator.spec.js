import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode, injectTestAccessors } from './helpers.js';

test.describe('FlyToAnimator', () => {

  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('flyTo changes camera position over time', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FlyToAnimator } = await import('/vtt/js/camera-animator.js');
      const cam = window.__cam();
      const animator = new FlyToAnimator(cam, { w: cam.viewportW, h: cam.viewportH });
      const startX = cam.x;
      const startY = cam.y;

      animator.flyTo({
        centerX: cam.mapW * 0.75,
        centerY: cam.mapH * 0.75,
        zoom: cam._coverZoom * 2,
      }, { duration: 300 });

      // Wait for animation to complete
      await new Promise(resolve => {
        const { EventBus } = window.__vtt;
        const handler = () => {
          EventBus.off('camera:animation-complete', handler);
          resolve();
        };
        EventBus.on('camera:animation-complete', handler);
        setTimeout(resolve, 2000); // safety timeout
      });

      animator.destroy();
      return {
        startX,
        startY,
        endX: cam.x,
        endY: cam.y,
        moved: cam.x !== startX || cam.y !== startY,
      };
    });
    expect(result.moved).toBe(true);
  });

  test('isAnimating is true during flyTo, false after completion', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FlyToAnimator } = await import('/vtt/js/camera-animator.js');
      const cam = window.__cam();
      const animator = new FlyToAnimator(cam, { w: cam.viewportW, h: cam.viewportH });

      animator.flyTo({
        centerX: cam.mapW * 0.75,
        centerY: cam.mapH * 0.75,
        zoom: cam._coverZoom * 2,
      }, { duration: 200 });
      const duringAnimation = animator.isAnimating;

      await new Promise(resolve => {
        const { EventBus } = window.__vtt;
        const handler = () => {
          EventBus.off('camera:animation-complete', handler);
          resolve();
        };
        EventBus.on('camera:animation-complete', handler);
        setTimeout(resolve, 2000);
      });

      const afterAnimation = animator.isAnimating;
      animator.destroy();
      return { duringAnimation, afterAnimation };
    });
    expect(result.duringAnimation).toBe(true);
    expect(result.afterAnimation).toBe(false);
  });

  test('interrupt stops animation at current position', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FlyToAnimator } = await import('/vtt/js/camera-animator.js');
      const cam = window.__cam();
      const animator = new FlyToAnimator(cam, { w: cam.viewportW, h: cam.viewportH });

      // Start a long animation to opposite corner
      animator.flyTo({
        centerX: cam.mapW * 0.75,
        centerY: cam.mapH * 0.75,
        zoom: cam._coverZoom * 2,
      }, { duration: 2000 });

      // Wait one frame to let it start
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const midX = cam.x;
      const midY = cam.y;
      const wasAnimating = animator.isAnimating;

      // Interrupt
      animator.interrupt();

      const afterInterruptAnimating = animator.isAnimating;
      const afterX = cam.x;
      const afterY = cam.y;

      animator.destroy();
      return {
        wasAnimating,
        afterInterruptAnimating,
        positionPreserved: afterX === midX && afterY === midY,
      };
    });
    expect(result.wasAnimating).toBe(true);
    expect(result.afterInterruptAnimating).toBe(false);
    expect(result.positionPreserved).toBe(true);
  });

  test('jumpTo applies position instantly with no animation', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FlyToAnimator } = await import('/vtt/js/camera-animator.js');
      const { localToShared } = await import('/shared/protocol.js');
      const cam = window.__cam();
      const animator = new FlyToAnimator(cam, { w: cam.viewportW, h: cam.viewportH });

      // Use map center as target — guaranteed within constraints
      const target = {
        centerX: cam.mapW / 2,
        centerY: cam.mapH / 2,
        zoom: cam._coverZoom * 1.5,
      };
      animator.jumpTo(target);

      const vp = { width: cam.viewportW, height: cam.viewportH };
      const shared = localToShared(cam, vp);
      const isAnimating = animator.isAnimating;

      animator.destroy();
      return {
        isAnimating,
        centerX: shared.centerX,
        centerY: shared.centerY,
        zoom: shared.zoom,
        targetX: target.centerX,
        targetY: target.centerY,
        targetZoom: target.zoom,
      };
    });
    expect(result.isAnimating).toBe(false);
    expect(result.centerX).toBeCloseTo(result.targetX, 0);
    expect(result.centerY).toBeCloseTo(result.targetY, 0);
    expect(result.zoom).toBeCloseTo(result.targetZoom, 2);
  });

  test('prefers-reduced-motion causes flyTo to fall back to jumpTo', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FlyToAnimator } = await import('/vtt/js/camera-animator.js');
      const { localToShared } = await import('/shared/protocol.js');
      const cam = window.__cam();
      const animator = new FlyToAnimator(cam, { w: cam.viewportW, h: cam.viewportH });

      // Mock matchMedia to report reduced motion
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = (query) => {
        if (query === '(prefers-reduced-motion: reduce)') {
          return { matches: true };
        }
        return originalMatchMedia(query);
      };

      // Use map center — guaranteed within constraints
      const target = {
        centerX: cam.mapW / 2,
        centerY: cam.mapH / 2,
        zoom: cam._coverZoom * 1.5,
      };
      animator.flyTo(target, { duration: 1000 });

      // With reduced motion, flyTo should have jumped instantly — not animating
      const isAnimating = animator.isAnimating;
      const vp = { width: cam.viewportW, height: cam.viewportH };
      const shared = localToShared(cam, vp);

      // Restore
      window.matchMedia = originalMatchMedia;
      animator.destroy();

      return {
        isAnimating,
        centerX: shared.centerX,
        centerY: shared.centerY,
        targetX: target.centerX,
        targetY: target.centerY,
      };
    });
    expect(result.isAnimating).toBe(false);
    expect(result.centerX).toBeCloseTo(result.targetX, 0);
    expect(result.centerY).toBeCloseTo(result.targetY, 0);
  });

  test('flyTo with identical start and end does not animate', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FlyToAnimator } = await import('/vtt/js/camera-animator.js');
      const { localToShared } = await import('/shared/protocol.js');
      const cam = window.__cam();
      const animator = new FlyToAnimator(cam, { w: cam.viewportW, h: cam.viewportH });

      // Get current position in shared coords and flyTo the same spot
      const vp = { width: cam.viewportW, height: cam.viewportH };
      const current = localToShared(cam, vp);
      animator.flyTo({ centerX: current.centerX, centerY: current.centerY, zoom: current.zoom });

      const isAnimating = animator.isAnimating;
      animator.destroy();
      return { isAnimating };
    });
    expect(result.isAnimating).toBe(false);
  });

  test('flyTo endpoint matches target position within tolerance', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FlyToAnimator } = await import('/vtt/js/camera-animator.js');
      const { localToShared } = await import('/shared/protocol.js');
      const cam = window.__cam();
      const animator = new FlyToAnimator(cam, { w: cam.viewportW, h: cam.viewportH });

      // Target map center at a zoomed-in level — within constraints
      const target = {
        centerX: cam.mapW / 2,
        centerY: cam.mapH / 2,
        zoom: cam._coverZoom * 1.5,
      };
      animator.flyTo(target, { duration: 250 });

      await new Promise(resolve => {
        const { EventBus } = window.__vtt;
        const handler = () => {
          EventBus.off('camera:animation-complete', handler);
          resolve();
        };
        EventBus.on('camera:animation-complete', handler);
        setTimeout(resolve, 2000);
      });

      const vp = { width: cam.viewportW, height: cam.viewportH };
      const final = localToShared(cam, vp);
      animator.destroy();

      return {
        finalX: final.centerX,
        finalY: final.centerY,
        finalZoom: final.zoom,
        targetX: target.centerX,
        targetY: target.centerY,
        targetZoom: target.zoom,
      };
    });
    // Camera constraints may adjust position, so check with reasonable tolerance
    expect(result.finalX).toBeCloseTo(result.targetX, 0);
    expect(result.finalY).toBeCloseTo(result.targetY, 0);
    expect(result.finalZoom).toBeCloseTo(result.targetZoom, 1);
  });

  test('suppressBroadcast is true during receiver-side animation', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FlyToAnimator } = await import('/vtt/js/camera-animator.js');
      const cam = window.__cam();
      const animator = new FlyToAnimator(cam, { w: cam.viewportW, h: cam.viewportH });

      const beforeFlyTo = animator.suppressBroadcast;
      animator.flyTo({
        centerX: cam.mapW * 0.75,
        centerY: cam.mapH * 0.75,
        zoom: cam._coverZoom * 2,
      }, {
        duration: 300,
        suppressBroadcast: true,
      });
      const duringFlyTo = animator.suppressBroadcast;

      await new Promise(resolve => {
        const { EventBus } = window.__vtt;
        const handler = () => {
          EventBus.off('camera:animation-complete', handler);
          resolve();
        };
        EventBus.on('camera:animation-complete', handler);
        setTimeout(resolve, 2000);
      });

      const afterFlyTo = animator.suppressBroadcast;
      animator.destroy();
      return { beforeFlyTo, duringFlyTo, afterFlyTo };
    });
    expect(result.beforeFlyTo).toBe(false);
    expect(result.duringFlyTo).toBe(true);
    expect(result.afterFlyTo).toBe(false);
  });

  test('second flyTo interrupts first and starts new animation', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { FlyToAnimator } = await import('/vtt/js/camera-animator.js');
      const { localToShared } = await import('/shared/protocol.js');
      const cam = window.__cam();
      const animator = new FlyToAnimator(cam, { w: cam.viewportW, h: cam.viewportH });

      // Start first (long) animation to one corner at zoom
      animator.flyTo({
        centerX: cam.mapW * 0.75,
        centerY: cam.mapH * 0.75,
        zoom: cam._coverZoom * 2,
      }, { duration: 5000 });

      // Wait one frame
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      // Start second animation to map center — should cancel first
      const target2 = {
        centerX: cam.mapW / 2,
        centerY: cam.mapH / 2,
        zoom: cam._coverZoom * 1.5,
      };
      animator.flyTo(target2, { duration: 200 });

      const isAnimating = animator.isAnimating;

      await new Promise(resolve => {
        const { EventBus } = window.__vtt;
        const handler = () => {
          EventBus.off('camera:animation-complete', handler);
          resolve();
        };
        EventBus.on('camera:animation-complete', handler);
        setTimeout(resolve, 2000);
      });

      const vp = { width: cam.viewportW, height: cam.viewportH };
      const final = localToShared(cam, vp);
      animator.destroy();

      return {
        isAnimating,
        finalX: final.centerX,
        finalY: final.centerY,
        targetX: target2.centerX,
        targetY: target2.centerY,
      };
    });
    expect(result.isAnimating).toBe(true);
    // Should end at second target, not first
    expect(result.finalX).toBeCloseTo(result.targetX, 0);
    expect(result.finalY).toBeCloseTo(result.targetY, 0);
  });
});
