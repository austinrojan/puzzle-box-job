import { test, expect } from '@playwright/test';
import { bootDisplay, bootController } from './helpers.js';

test.describe('Fit-to-tokens E2E', () => {
  /** @type {import('@playwright/test').BrowserContext} */
  let context;

  test.afterEach(async () => {
    if (context) {
      await context.close();
      context = null;
    }
  });

  test('Frame Tokens button frames visible tokens on Display', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);

    // Wait for handshake — Controller camera has map dims
    await ctrl.waitForFunction(
      () => window.__controller?.camera?.mapW > 0,
      { timeout: 5000 }
    );

    // Load map and add tokens on Display
    await display.evaluate(() => {
      window.__vtt.EventBus.emit('map:load', 'M01');
    });
    await display.waitForFunction(
      () => window.__vtt?.mapRenderer?.currentMap?.id === 'M01',
      { timeout: 5000 }
    );

    await display.evaluate(() => {
      const tm = window.__vtt.tokenManager;
      tm.addToken('martin-storm', 5, 5);
      tm.addToken('lome', 30, 20);
      tm.addToken('oda', 15, 12);
    });

    // Wait for Controller to receive synced tokens via BroadcastChannel
    await ctrl.waitForFunction(async () => {
      const { vttState } = await import('./js/state.js');
      return (vttState.tokens?.length ?? 0) >= 3;
    }, { timeout: 5000 });

    // Record Display camera before framing
    const before = await display.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      return { x: cam.x, y: cam.y, zoom: cam.zoom };
    });

    // Click the Frame Tokens button
    await ctrl.click('#btn-frame-tokens');

    // Wait for Display camera to change (flyTo animation)
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

    const moved = Math.abs(after.x - before.x) > 0.5 ||
                  Math.abs(after.y - before.y) > 0.5 ||
                  Math.abs(after.zoom - before.zoom) > 0.01;
    expect(moved).toBe(true);
  });

  test('flyToTokens returns null for no visible tokens (no crash)', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const display = await bootDisplay(context);

    await display.waitForFunction(
      () => window.__vtt?.mapRenderer?.camera != null,
      { timeout: 5000 }
    );

    const result = await display.evaluate(async () => {
      const { flyToTokens } = await import('./js/fit-to-tokens.js');
      const animator = window.__vtt.flyToAnimator;
      return flyToTokens(animator, [], { w: 1920, h: 1080 }, 70, {}, []);
    });

    expect(result).toBeNull();
  });

  test('PC mode filters non-PC tokens', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const display = await bootDisplay(context);

    await display.waitForFunction(
      () => window.__vtt?.mapRenderer?.camera != null,
      { timeout: 5000 }
    );

    const result = await display.evaluate(async () => {
      const { computeFitToTokens } = await import('./js/fit-to-tokens.js');

      const tokens = [
        { x: 100, y: 100, size: 1, isPC: true, visible: true, inInitiative: false },
        { x: 9000, y: 9000, size: 1, isPC: false, visible: true, inInitiative: false },
      ];

      const allResult = computeFitToTokens(tokens, { w: 1920, h: 1080 }, { mode: 'all' });
      const pcResult = computeFitToTokens(tokens, { w: 1920, h: 1080 }, { mode: 'pcs' });

      return {
        allCenter: { x: allResult.centerX, y: allResult.centerY },
        pcCenter: { x: pcResult.centerX, y: pcResult.centerY },
        pcZoomHigher: pcResult.zoom > allResult.zoom,
      };
    });

    expect(result.pcZoomHigher).toBe(true);
    expect(result.pcCenter.x).toBeLessThan(500);
    expect(result.pcCenter.y).toBeLessThan(500);
  });
});
