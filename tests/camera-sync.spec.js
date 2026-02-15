import { test, expect } from '@playwright/test';

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

  test('epsilon: skips send when state unchanged', async ({ page }) => {
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

  test('epsilon: sends when position changes beyond threshold', async ({ page }) => {
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
