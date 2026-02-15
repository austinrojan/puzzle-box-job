import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode, bootDisplay, bootController } from './helpers.js';

test.describe('Center-point camera model', () => {
  test('roundtrips correctly at standard viewport', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => {
      const { localToShared, sharedToLocal } = await import('/shared/protocol.js');
      const cam = { x: 200, y: 100, zoom: 1.5 };
      const vp = { width: 1920, height: 1080 };
      const shared = localToShared(cam, vp);
      const back = sharedToLocal(shared, vp);
      return { cam, back };
    });
    expect(r.back.x).toBeCloseTo(r.cam.x, 2);
    expect(r.back.y).toBeCloseTo(r.cam.y, 2);
    expect(r.back.zoom).toBeCloseTo(r.cam.zoom, 2);
  });

  test('different viewports share the same center', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => {
      const { localToShared, sharedToLocal } = await import('/shared/protocol.js');
      const shared = localToShared({ x: 200, y: 100, zoom: 1.5 }, { width: 1920, height: 1080 });
      const cam2 = sharedToLocal(shared, { width: 3840, height: 2160 });
      const shared2 = localToShared(cam2, { width: 3840, height: 2160 });
      return { s1: shared, s2: shared2 };
    });
    expect(r.s2.centerX).toBeCloseTo(r.s1.centerX, 2);
    expect(r.s2.centerY).toBeCloseTo(r.s1.centerY, 2);
  });

  test('zoom=1 identity: center is half viewport', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => {
      const { localToShared } = await import('/shared/protocol.js');
      return localToShared({ x: 0, y: 0, zoom: 1.0 }, { width: 1920, height: 1080 });
    });
    expect(r.centerX).toBeCloseTo(960, 2);
    expect(r.centerY).toBeCloseTo(540, 2);
  });

  test('handles negative camera positions', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => {
      const { localToShared, sharedToLocal } = await import('/shared/protocol.js');
      const cam = { x: -500, y: -300, zoom: 2.0 };
      const vp = { width: 1920, height: 1080 };
      const back = sharedToLocal(localToShared(cam, vp), vp);
      return { cam, back };
    });
    expect(r.back.x).toBeCloseTo(r.cam.x, 2);
    expect(r.back.y).toBeCloseTo(r.cam.y, 2);
  });
});

test.describe('Phase 4 protocol message validation', () => {
  test('validates CAMERA_SYNC message', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => {
      const { validateMessage, createCameraSyncMsg } = await import('/shared/protocol.js');
      const msg = createCameraSyncMsg(100, 200, 1.5, 1, 'abc123');
      return validateMessage(msg);
    });
    expect(r.valid).toBe(true);
  });

  test('validates ANNOUNCE message', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => {
      const { validateMessage, createAnnounceMsg } = await import('/shared/protocol.js');
      return validateMessage(createAnnounceMsg('win1', 'controller'));
    });
    expect(r.valid).toBe(true);
  });

  test('rejects CAMERA_SYNC missing seq', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => {
      const { validateMessage, MSG, PROTOCOL_VERSION } = await import('/shared/protocol.js');
      return validateMessage({ type: MSG.CAMERA_SYNC, centerX: 1, centerY: 2, zoom: 1, senderId: 'x', _v: PROTOCOL_VERSION });
    });
    expect(r.valid).toBe(false);
  });
});

test.describe('CameraBroadcaster', () => {
  test('sends on first tick when state exists', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const count = await page.evaluate(async () => {
      const { CameraBroadcaster } = await import('/vtt/js/camera-sync.js');
      const camera = { x: 100, y: 50, zoom: 1.5, viewportW: 1920, viewportH: 1080 };
      const sent = [];
      const ch = { postMessage: m => sent.push(structuredClone(m)) };
      const b = new CameraBroadcaster(camera, ch, 'test');
      b._sendState(0);
      return sent.length;
    });
    expect(count).toBe(1);
  });

  test('skips send when camera state unchanged (epsilon filter)', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const count = await page.evaluate(async () => {
      const { CameraBroadcaster } = await import('/vtt/js/camera-sync.js');
      const camera = { x: 100, y: 50, zoom: 1.5, viewportW: 1920, viewportH: 1080 };
      const sent = [];
      const ch = { postMessage: m => sent.push(m) };
      const b = new CameraBroadcaster(camera, ch, 'test');
      b._sendState(0);
      b._sendState(100);
      return sent.length;
    });
    expect(count).toBe(1);
  });

  test('sends when position exceeds epsilon threshold', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const count = await page.evaluate(async () => {
      const { CameraBroadcaster } = await import('/vtt/js/camera-sync.js');
      const camera = { x: 100, y: 50, zoom: 1.5, viewportW: 1920, viewportH: 1080 };
      const sent = [];
      const ch = { postMessage: m => sent.push(m) };
      const b = new CameraBroadcaster(camera, ch, 'test');
      b._sendState(0);
      camera.x = 200;
      b._sendState(100);
      return sent.length;
    });
    expect(count).toBe(2);
  });

  test('suppressBroadcast prevents send', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const count = await page.evaluate(async () => {
      const { CameraBroadcaster } = await import('/vtt/js/camera-sync.js');
      const camera = { x: 100, y: 50, zoom: 1.5, viewportW: 1920, viewportH: 1080 };
      const sent = [];
      const ch = { postMessage: m => sent.push(m) };
      const b = new CameraBroadcaster(camera, ch, 'test');
      b.suppressBroadcast = true;
      b._sendState(0);
      return sent.length;
    });
    expect(count).toBe(0);
  });

  test('sequence numbers are monotonically increasing', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const seqs = await page.evaluate(async () => {
      const { CameraBroadcaster } = await import('/vtt/js/camera-sync.js');
      const camera = { x: 100, y: 50, zoom: 1.5, viewportW: 1920, viewportH: 1080 };
      const sent = [];
      const ch = { postMessage: m => sent.push(structuredClone(m)) };
      const b = new CameraBroadcaster(camera, ch, 'test');
      b._sendState(0);
      camera.x += 10;
      b._sendState(100);
      camera.x += 10;
      b._sendState(200);
      return sent.map(m => m.seq);
    });
    expect(seqs).toEqual([1, 2, 3]);
  });
});

test.describe('CameraReceiver', () => {
  test('accepts increasing sequence numbers', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const count = await page.evaluate(async () => {
      const { CameraReceiver } = await import('/vtt/js/camera-sync.js');
      const calls = [];
      const camera = {
        viewportW: 1920, viewportH: 1080,
        deserialize: d => calls.push(d),
      };
      const r = new CameraReceiver(camera);
      r.handleMessage({ type: 'camera:sync', senderId: 'a', seq: 1, centerX: 100, centerY: 200, zoom: 1 });
      r.handleMessage({ type: 'camera:sync', senderId: 'a', seq: 2, centerX: 110, centerY: 200, zoom: 1 });
      return calls.length;
    });
    expect(count).toBe(2);
  });

  test('rejects stale sequence numbers', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const count = await page.evaluate(async () => {
      const { CameraReceiver } = await import('/vtt/js/camera-sync.js');
      const calls = [];
      const camera = {
        viewportW: 1920, viewportH: 1080,
        deserialize: d => calls.push(d),
      };
      const r = new CameraReceiver(camera);
      r.handleMessage({ type: 'camera:sync', senderId: 'a', seq: 5, centerX: 100, centerY: 200, zoom: 1 });
      r.handleMessage({ type: 'camera:sync', senderId: 'a', seq: 3, centerX: 110, centerY: 200, zoom: 1 });
      return calls.length;
    });
    expect(count).toBe(1);
  });

  test('tracks senders independently', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const count = await page.evaluate(async () => {
      const { CameraReceiver } = await import('/vtt/js/camera-sync.js');
      const calls = [];
      const camera = {
        viewportW: 1920, viewportH: 1080,
        deserialize: d => calls.push(d),
      };
      const r = new CameraReceiver(camera);
      r.handleMessage({ type: 'camera:sync', senderId: 'a', seq: 1, centerX: 100, centerY: 200, zoom: 1 });
      r.handleMessage({ type: 'camera:sync', senderId: 'b', seq: 1, centerX: 110, centerY: 200, zoom: 1 });
      return calls.length;
    });
    expect(count).toBe(2);
  });

  test('sets suppressBroadcast on broadcaster during apply', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const wasSupp = await page.evaluate(async () => {
      const { CameraReceiver } = await import('/vtt/js/camera-sync.js');
      let wasSuppressed = false;
      const camera = {
        viewportW: 1920, viewportH: 1080,
        deserialize: () => {},
      };
      const fakeBroadcaster = {
        set suppressBroadcast(v) { if (v) wasSuppressed = true; },
        get suppressBroadcast() { return false; },
      };
      const r = new CameraReceiver(camera, fakeBroadcaster);
      r.handleMessage({ type: 'camera:sync', senderId: 'a', seq: 1, centerX: 100, centerY: 200, zoom: 1 });
      return wasSuppressed;
    });
    expect(wasSupp).toBe(true);
  });

  test('CAMERA_JUMP_TO bypasses sequence check', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const count = await page.evaluate(async () => {
      const { CameraReceiver } = await import('/vtt/js/camera-sync.js');
      const calls = [];
      const camera = {
        viewportW: 1920, viewportH: 1080,
        deserialize: d => calls.push(d),
      };
      const r = new CameraReceiver(camera);
      r.handleMessage({ type: 'camera:jump-to', senderId: 'a', centerX: 500, centerY: 300, zoom: 2 });
      return calls.length;
    });
    expect(count).toBe(1);
  });
});

test.describe('WindowRegistry', () => {
  test('registers peers on ANNOUNCE', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => {
      const { WindowRegistry } = await import('/vtt/js/camera-sync.js');
      const sent = [];
      const ch = { postMessage: m => sent.push(m) };
      const reg = new WindowRegistry('win-a', 'display', ch);
      let joined = null;
      reg.onPeerChange({ onJoin: (id, role) => { joined = { id, role }; } });
      reg.handleMessage(
        { type: 'window:announce', windowId: 'win-b', role: 'controller' },
        () => ({ centerX: 100, centerY: 200, zoom: 1.5 })
      );
      return { joined, sentCount: sent.length, hasRole: reg.hasRole('controller') };
    });
    expect(r.joined).toEqual({ id: 'win-b', role: 'controller' });
    expect(r.sentCount).toBe(1); // WELCOME response
    expect(r.hasRole).toBe(true);
  });

  test('ignores own ANNOUNCE', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => {
      const { WindowRegistry } = await import('/vtt/js/camera-sync.js');
      const ch = { postMessage: () => {} };
      const reg = new WindowRegistry('win-a', 'display', ch);
      let joined = false;
      reg.onPeerChange({ onJoin: () => { joined = true; } });
      reg.handleMessage(
        { type: 'window:announce', windowId: 'win-a', role: 'display' },
        () => null
      );
      return joined;
    });
    expect(r).toBe(false);
  });

  test('WELCOME only processed if targetWindowId matches', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => {
      const { WindowRegistry } = await import('/vtt/js/camera-sync.js');
      const ch = { postMessage: () => {} };
      const reg = new WindowRegistry('win-a', 'display', ch);
      let welcomeReceived = false;
      const { EventBus } = await import('/vtt/js/state.js');
      EventBus.on('camera-sync:welcome', () => { welcomeReceived = true; });
      // Not for us
      reg.handleMessage({ type: 'window:welcome', windowId: 'win-b', role: 'controller', targetWindowId: 'win-c', camera: {}, epoch: 1 });
      const notForUs = welcomeReceived;
      // For us
      reg.handleMessage({ type: 'window:welcome', windowId: 'win-b', role: 'controller', targetWindowId: 'win-a', camera: { centerX: 1, centerY: 2, zoom: 1 }, epoch: 2 });
      EventBus.off('camera-sync:welcome');
      return { notForUs, forUs: welcomeReceived };
    });
    expect(r.notForUs).toBe(false);
    expect(r.forUs).toBe(true);
  });

  test('GOODBYE removes peer and fires onLeave', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => {
      const { WindowRegistry } = await import('/vtt/js/camera-sync.js');
      const ch = { postMessage: () => {} };
      const reg = new WindowRegistry('win-a', 'display', ch);
      let left = null;
      reg.onPeerChange({
        onJoin: () => {},
        onLeave: (id, role) => { left = { id, role }; },
      });
      // Register peer first
      reg.handleMessage({ type: 'window:heartbeat', windowId: 'win-b', role: 'controller' });
      // Goodbye
      reg.handleMessage({ type: 'window:goodbye', windowId: 'win-b' });
      return { left, hasRole: reg.hasRole('controller') };
    });
    expect(r.left).toEqual({ id: 'win-b', role: 'controller' });
    expect(r.hasRole).toBe(false);
  });
});

test.describe('CameraChannelManager', () => {
  test('restores camera position from sessionStorage after page reload', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => {
      const { CameraChannelManager } = await import('/vtt/js/camera-sync.js');
      const { sharedToLocal } = await import('/shared/protocol.js');

      const KEY = 'vtt-camera-state';
      const saved = {
        centerX: 500, centerY: 300, zoom: 1.8,
        windowId: 'test-win', role: 'display',
        timestamp: Date.now(),
      };
      sessionStorage.setItem(KEY, JSON.stringify(saved));

      const applied = [];
      const camera = {
        viewportW: 1920, viewportH: 1080, mapW: 0, mapH: 0,
        deserialize: d => applied.push(structuredClone(d)),
      };

      const mgr = new CameraChannelManager({ camera, role: 'display', onMessage: () => {} });
      mgr._tryRestore();

      if (applied.length === 0) return { restored: false };
      const expected = sharedToLocal(saved, { width: 1920, height: 1080 });
      return {
        restored: true,
        x: applied[0].x,
        y: applied[0].y,
        zoom: applied[0].zoom,
        expectedX: expected.x,
        expectedY: expected.y,
        expectedZoom: expected.zoom,
      };
    });
    expect(r.restored).toBe(true);
    expect(r.x).toBeCloseTo(r.expectedX, 2);
    expect(r.y).toBeCloseTo(r.expectedY, 2);
    expect(r.zoom).toBeCloseTo(r.expectedZoom, 2);
  });

  test('rejects stale sessionStorage (> 5 min old)', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    const restored = await page.evaluate(async () => {
      const { CameraChannelManager } = await import('/vtt/js/camera-sync.js');
      const KEY = 'vtt-camera-state';
      sessionStorage.setItem(KEY, JSON.stringify({
        centerX: 500, centerY: 300, zoom: 1.8,
        windowId: 'test-win', role: 'display',
        timestamp: Date.now() - 6 * 60 * 1000,
      }));
      const applied = [];
      const camera = {
        viewportW: 1920, viewportH: 1080, mapW: 0, mapH: 0,
        deserialize: d => applied.push(d),
      };
      const mgr = new CameraChannelManager({ camera, role: 'display', onMessage: () => {} });
      mgr._tryRestore();
      return applied.length > 0;
    });
    expect(restored).toBe(false);
  });
});

test.describe('VTT Display sync engine', () => {
  test('syncEngine is initialized with role display', async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    const r = await page.evaluate(() => {
      const se = window.__vtt?.syncEngine;
      return se ? { role: se._role, started: se._started } : null;
    });
    expect(r).not.toBeNull();
    expect(r.role).toBe('display');
    expect(r.started).toBe(true);
  });

  test('syncEngine has no broadcaster (display is receiver-only)', async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    const hasBroadcaster = await page.evaluate(() => {
      return window.__vtt?.syncEngine?._broadcaster != null;
    });
    expect(hasBroadcaster).toBe(false);
  });

  test('syncEngine has a receiver', async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    const hasReceiver = await page.evaluate(() => {
      return window.__vtt?.syncEngine?._receiver != null;
    });
    expect(hasReceiver).toBe(true);
  });
});

test.describe('Controller sync engine', () => {
  test('Controller has camera and syncEngine', async ({ page }) => {
    await page.goto('/controller/');
    await page.waitForFunction(() => window.__controller?.syncEngine?._started === true, { timeout: 10000 });
    const r = await page.evaluate(() => {
      const c = window.__controller;
      return c ? {
        hasCamera: c.camera != null,
        hasSyncEngine: c.syncEngine != null,
        role: c.syncEngine?._role,
        started: c.syncEngine?._started,
      } : null;
    });
    expect(r).not.toBeNull();
    expect(r.hasCamera).toBe(true);
    expect(r.hasSyncEngine).toBe(true);
    expect(r.role).toBe('controller');
    expect(r.started).toBe(true);
  });

  test('Controller syncEngine has a broadcaster', async ({ page }) => {
    await page.goto('/controller/');
    await page.waitForFunction(() => window.__controller?.syncEngine?._started === true, { timeout: 10000 });
    const has = await page.evaluate(() => {
      return window.__controller?.syncEngine?._broadcaster != null;
    });
    expect(has).toBe(true);
  });
});

test.describe('Cross-window camera sync', () => {
  test.beforeEach(({}, testInfo) => {
    if (testInfo.project.name !== 'desktop-1920') test.skip();
  });

  let context;
  test.afterEach(async () => {
    if (context) {
      await context.close();
      context = null;
    }
  });

  test('Controller camera change propagates to Display', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);
    // Wait for ANNOUNCE/WELCOME handshake
    await ctrl.waitForFunction(
      () => window.__controller?.camera?.mapW > 0,
      { timeout: 5000 }
    );

    // Record Display camera before
    const before = await display.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      return { zoom: cam.zoom };
    });

    // Zoom in on Controller
    await ctrl.evaluate(() => {
      window.__controller.camera.zoomToCenter(0.4);
    });

    // Wait for sync
    await display.waitForFunction((prevZoom) => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && Math.abs(cam.zoom - prevZoom) > 0.01;
    }, before.zoom, { timeout: 3000 });

    const after = await display.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      return { zoom: cam.zoom };
    });

    expect(after.zoom).not.toBeCloseTo(before.zoom, 1);
  });

  test('CAMERA_JUMP_TO produces instant camera update', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);
    await ctrl.waitForFunction(
      () => window.__controller?.camera?.mapW > 0,
      { timeout: 5000 }
    );

    // Send jump-to
    await ctrl.evaluate(() => {
      const engine = window.__controller.syncEngine;
      if (engine.broadcaster) {
        engine.broadcaster.sendJumpTo(500, 300, 2.0);
      }
    });

    // Wait for Display to apply
    await display.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return false;
      return cam.zoom >= 1.5;
    }, { timeout: 3000 });

    const cam = await display.evaluate(() => {
      const c = window.__vtt.mapRenderer.camera;
      return { zoom: c.zoom };
    });
    expect(cam.zoom).toBeCloseTo(2.0, 1);
  });

  test('Display retains camera state when Controller disconnects', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);
    await ctrl.waitForFunction(
      () => window.__controller?.camera?.mapW > 0,
      { timeout: 5000 }
    );

    // Zoom in
    await ctrl.evaluate(() => {
      window.__controller.camera.zoomToCenter(0.5);
    });
    await display.waitForTimeout(200);

    // Record state
    const before = await display.evaluate(() => {
      const c = window.__vtt.mapRenderer.camera;
      return { x: c.x, y: c.y, zoom: c.zoom };
    });

    // Close Controller
    await ctrl.close();
    await display.waitForTimeout(200);

    // Display should retain state
    const after = await display.evaluate(() => {
      const c = window.__vtt.mapRenderer.camera;
      return { x: c.x, y: c.y, zoom: c.zoom };
    });

    expect(after.x).toBeCloseTo(before.x, 2);
    expect(after.y).toBeCloseTo(before.y, 2);
    expect(after.zoom).toBeCloseTo(before.zoom, 2);
  });

  test('WELCOME hydrates Controller with Display camera on connect', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    // Open Display first, manipulate camera
    const display = await bootDisplay(context);

    // Get Display camera state
    const displayCam = await display.evaluate(() => {
      const c = window.__vtt.mapRenderer.camera;
      return {
        centerX: c.x + (c.viewportW / 2) / c.zoom,
        centerY: c.y + (c.viewportH / 2) / c.zoom,
        zoom: c.zoom,
        mapW: c.mapW,
        mapH: c.mapH,
      };
    });

    // Open Controller — should receive WELCOME with Display's camera
    const ctrl = await bootController(context);
    await ctrl.waitForFunction(
      () => window.__controller?.camera?.mapW > 0,
      { timeout: 5000 }
    );

    const ctrlCam = await ctrl.evaluate(() => {
      const c = window.__controller?.camera;
      if (!c || c.mapW <= 0) return null;
      return {
        centerX: c.x + (c.viewportW / 2) / c.zoom,
        centerY: c.y + (c.viewportH / 2) / c.zoom,
        zoom: c.zoom,
      };
    });

    // Controller must have received map dimensions via WELCOME
    expect(ctrlCam).not.toBeNull();
    expect(ctrlCam.centerX).toBeCloseTo(displayCam.centerX, 0);
    expect(ctrlCam.centerY).toBeCloseTo(displayCam.centerY, 0);
  });
});
