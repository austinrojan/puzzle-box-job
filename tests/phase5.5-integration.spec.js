import { test, expect } from '@playwright/test';
import { bootDisplay, bootController, waitForControllerMap, waitForDisplayPhase5 } from './helpers.js';

// Skip non-desktop-1920 projects — cross-window tests need full viewport
test.beforeEach(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop-1920') test.skip();
});

// ============================================================
// sendNow() DOM click fidelity
// ============================================================
test.describe('sendNow() DOM click fidelity', () => {
  /** @type {import('@playwright/test').BrowserContext} */
  let context;

  test.afterEach(async () => {
    if (context) { await context.close(); context = null; }
  });

  test('#zoom-in click → CAMERA_SYNC received on Display', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);
    await waitForControllerMap(ctrl, 5000);

    // Set up BroadcastChannel listener on Display
    await display.evaluate(() => {
      window.__testMsgs = [];
      const ch = new BroadcastChannel('vtt-camera');
      ch.onmessage = (e) => {
        if (e.data?.type === 'camera:sync') window.__testMsgs.push(e.data);
      };
    });

    // Click zoom-in on Controller
    await ctrl.click('#zoom-in');

    // Wait for at least one CAMERA_SYNC to arrive
    await display.waitForFunction(
      () => (window.__testMsgs?.length || 0) > 0,
      { timeout: 3000 }
    );

    const count = await display.evaluate(() => window.__testMsgs.length);
    expect(count).toBeGreaterThan(0);
  });

  test('[data-cam="right"] click → CAMERA_SYNC received', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);
    await waitForControllerMap(ctrl, 5000);

    // Zoom in so there's room to pan (at cover zoom the map fills the viewport)
    const initialZoom = await display.evaluate(() =>
      window.__vtt?.mapRenderer?.camera?.zoom ?? 1
    );
    await ctrl.evaluate(() => {
      window.__controller.camera.zoomToCenter(0.5);
      window.__controller.syncEngine.sendNow();
    });
    // Poll until Display receives the zoom sync (replaces setTimeout(100))
    await display.waitForFunction(
      (prev) => {
        const cam = window.__vtt?.mapRenderer?.camera;
        return cam && Math.abs(cam.zoom - prev) > 0.001;
      },
      initialZoom,
      { timeout: 3000 }
    );

    await display.evaluate(() => {
      window.__testMsgs = [];
      const ch = new BroadcastChannel('vtt-camera');
      ch.onmessage = (e) => {
        if (e.data?.type === 'camera:sync') window.__testMsgs.push(e.data);
      };
    });

    await ctrl.click('[data-cam="right"]');

    await display.waitForFunction(
      () => (window.__testMsgs?.length || 0) > 0,
      { timeout: 3000 }
    );

    const count = await display.evaluate(() => window.__testMsgs.length);
    expect(count).toBeGreaterThan(0);
  });

  test('#zoom-out click → CAMERA_SYNC received', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);
    await waitForControllerMap(ctrl, 5000);

    // Zoom in first so zoom-out has room
    const initialZoom2 = await display.evaluate(() =>
      window.__vtt?.mapRenderer?.camera?.zoom ?? 1
    );
    await ctrl.evaluate(() => {
      window.__controller.camera.zoomToCenter(0.5);
      window.__controller.syncEngine.sendNow();
    });
    // Poll until Display receives the zoom sync (replaces setTimeout(100))
    await display.waitForFunction(
      (prev) => {
        const cam = window.__vtt?.mapRenderer?.camera;
        return cam && Math.abs(cam.zoom - prev) > 0.001;
      },
      initialZoom2,
      { timeout: 3000 }
    );

    await display.evaluate(() => {
      window.__testMsgs = [];
      const ch = new BroadcastChannel('vtt-camera');
      ch.onmessage = (e) => {
        if (e.data?.type === 'camera:sync') window.__testMsgs.push(e.data);
      };
    });

    await ctrl.click('#zoom-out');

    await display.waitForFunction(
      () => (window.__testMsgs?.length || 0) > 0,
      { timeout: 3000 }
    );

    const count = await display.evaluate(() => window.__testMsgs.length);
    expect(count).toBeGreaterThan(0);
  });
});

// ============================================================
// VIEWPORT_REPORT cross-window
// ============================================================
test.describe('VIEWPORT_REPORT cross-window', () => {
  /** @type {import('@playwright/test').BrowserContext} */
  let context;

  test.afterEach(async () => {
    if (context) { await context.close(); context = null; }
  });

  test('Display sends VIEWPORT_REPORT on connect', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

    // Set up a BroadcastChannel listener BEFORE Display boots
    const listener = await context.newPage();
    await listener.goto('/vtt/');
    await listener.evaluate(() => {
      window.__vpReports = [];
      const ch = new BroadcastChannel('vtt-camera');
      ch.onmessage = (e) => {
        if (e.data?.type === 'camera:viewport-report') {
          window.__vpReports.push(e.data);
        }
      };
    });

    // Boot Display (which sends VIEWPORT_REPORT after 200ms)
    const display = await bootDisplay(context);

    // Wait for VIEWPORT_REPORT on the listener channel
    await listener.waitForFunction(
      () => (window.__vpReports?.length || 0) > 0,
      { timeout: 5000 }
    );

    const report = await listener.evaluate(() => window.__vpReports[0]);
    expect(report.viewportW).toBeGreaterThan(0);
    expect(report.viewportH).toBeGreaterThan(0);
    expect(report.coverZoom).toBeGreaterThan(0);
  });

  test('Controller stores displayViewport after receiving report', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);
    await waitForControllerMap(ctrl, 5000);

    // VIEWPORT_REPORT is now sent on ANNOUNCE (peer join), so Controller
    // should receive it automatically after the handshake completes.
    await ctrl.waitForFunction(
      () => window.__controller?.syncEngine?.displayViewport != null,
      { timeout: 5000 }
    );

    const vp = await ctrl.evaluate(() => window.__controller.syncEngine.displayViewport);
    expect(vp.width).toBeGreaterThan(0);
    expect(vp.height).toBeGreaterThan(0);
    expect(vp.coverZoom).toBeGreaterThan(0);
  });
});

// ============================================================
// sendFlyTo public API
// ============================================================
test.describe('sendFlyTo public API', () => {
  /** @type {import('@playwright/test').BrowserContext} */
  let context;

  test.afterEach(async () => {
    if (context) { await context.close(); context = null; }
  });

  test('sendFlyTo on Controller → Display camera moves', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);
    await waitForControllerMap(ctrl, 5000);
    await waitForDisplayPhase5(display);

    const before = await display.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      return { x: cam.x, y: cam.y, zoom: cam.zoom };
    });

    // Use the PUBLIC API (not _broadcaster.sendFlyTo)
    await ctrl.evaluate(() => {
      const cam = window.__controller.camera;
      window.__controller.syncEngine.sendFlyTo(
        { centerX: cam.mapW / 2, centerY: cam.mapH / 2, zoom: cam._coverZoom * 2 },
        { duration: 300 }
      );
    });

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
});
