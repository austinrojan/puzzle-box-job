import { test, expect } from '@playwright/test';
import { bootDisplay, bootController } from './helpers.js';

test.describe('Cross-window preset sync', () => {
  /** @type {import('@playwright/test').BrowserContext} */
  let context;

  test.afterEach(async () => {
    if (context) {
      await context.close();
      context = null;
    }
  });

  test('Controller saves preset → Display receives via PRESET_SYNC', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);

    // Wait for handshake
    await ctrl.waitForFunction(
      () => window.__controller?.camera?.mapW > 0,
      { timeout: 5000 }
    );

    // Controller saves a preset
    await ctrl.evaluate(() => {
      const ctrl = window.__controller;
      const cam = ctrl.camera;
      const mgr = ctrl.presetManager;
      mgr.setCurrentMap('M01');
      const vp = { width: cam.viewportW, height: cam.viewportH };
      mgr.save('Test Preset', cam, vp, { hotkey: '1' });
      // Broadcast to Display
      ctrl.syncEngine.broadcaster.sendPresetSync(mgr.exportAll());
    });

    // Wait for Display to receive the presets
    await display.waitForFunction(() => {
      const mgr = window.__vtt?.presetManager;
      if (!mgr) return false;
      return mgr.exportAll().length > 0;
    }, { timeout: 5000 });

    const result = await display.evaluate(() => {
      const presets = window.__vtt.presetManager.exportAll();
      return {
        count: presets.length,
        name: presets[0]?.name,
        hotkey: presets[0]?.hotkey,
      };
    });

    expect(result.count).toBe(1);
    expect(result.name).toBe('Test Preset');
    expect(result.hotkey).toBe('1');
  });

  test('Controller recalls preset → Display animates via CAMERA_FLY_TO', async ({ browser }) => {
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

    // Save a preset at a zoomed-in position
    await ctrl.evaluate(() => {
      const ctrl = window.__controller;
      const cam = ctrl.camera;
      const mgr = ctrl.presetManager;
      mgr.setCurrentMap('M01');
      // Save at a specific position
      cam.setPosition(cam.mapW * 0.25, cam.mapH * 0.25, cam._coverZoom * 2);
      const vp = { width: cam.viewportW, height: cam.viewportH };
      mgr.save('Zoom In', cam, vp);
      // Reset camera
      cam.fitCover();
    });

    // Record Display camera before recall
    const before = await display.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      return { x: cam.x, y: cam.y, zoom: cam.zoom };
    });

    // Controller recalls the preset and broadcasts flyTo
    await ctrl.evaluate(() => {
      const ctrl = window.__controller;
      const mgr = ctrl.presetManager;
      const presets = mgr.listForCurrentMap();
      const preset = presets[0];
      // Send flyTo command to Display
      ctrl.syncEngine.broadcaster.sendFlyTo(preset.camera, {
        duration: 300,
        rho: preset.transition.rho,
        presetId: preset.id,
      });
    });

    // Wait for Display camera to change
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

  test('Display joins late → receives presets via WELCOME payload', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

    // Boot Controller first and save presets
    const ctrl = await bootController(context);
    // Wait for Controller to have camera ready (from initial WELCOME or self-init)
    // Controller's headless camera may not have map dims yet, but we can still save presets
    await ctrl.evaluate(() => {
      const ctrl = window.__controller;
      const mgr = ctrl.presetManager;
      mgr.setCurrentMap('M01');
      // Save with manual camera data (since controller may not have map dims yet)
      const preset = {
        id: crypto.randomUUID(),
        name: 'Pre-existing',
        camera: { centerX: 500, centerY: 400, zoom: 1.5 },
        transition: { duration: null, rho: 1.42 },
        hotkey: '2',
        icon: null,
        sortOrder: 0,
        mapId: 'M01',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      mgr.importAll([preset]);
    });

    // Now boot Display — it should receive presets from WELCOME
    const display = await bootDisplay(context);

    // Wait for WELCOME handshake to include presets
    await display.waitForFunction(() => {
      const mgr = window.__vtt?.presetManager;
      if (!mgr) return false;
      return mgr.exportAll().length > 0;
    }, { timeout: 8000 });

    const result = await display.evaluate(() => {
      const presets = window.__vtt.presetManager.exportAll();
      return {
        count: presets.length,
        name: presets[0]?.name,
        hotkey: presets[0]?.hotkey,
      };
    });

    expect(result.count).toBe(1);
    expect(result.name).toBe('Pre-existing');
    expect(result.hotkey).toBe('2');
  });

  test('Controller deletes preset → Display list updates', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);

    await ctrl.waitForFunction(
      () => window.__controller?.camera?.mapW > 0,
      { timeout: 5000 }
    );

    // Save two presets on Controller
    await ctrl.evaluate(() => {
      const ctrl = window.__controller;
      const cam = ctrl.camera;
      const mgr = ctrl.presetManager;
      mgr.setCurrentMap('M01');
      const vp = { width: cam.viewportW, height: cam.viewportH };
      mgr.save('Keep', cam, vp);
      mgr.save('Delete Me', cam, vp);
      ctrl.syncEngine.broadcaster.sendPresetSync(mgr.exportAll());
    });

    // Wait for Display to have 2 presets
    await display.waitForFunction(() => {
      return window.__vtt?.presetManager?.exportAll()?.length === 2;
    }, { timeout: 5000 });

    // Delete one preset and broadcast
    await ctrl.evaluate(() => {
      const ctrl = window.__controller;
      const mgr = ctrl.presetManager;
      const toDelete = mgr.listForCurrentMap().find(p => p.name === 'Delete Me');
      mgr.delete(toDelete.id);
      ctrl.syncEngine.broadcaster.sendPresetSync(mgr.exportAll());
    });

    // Wait for Display to reflect deletion
    await display.waitForFunction(() => {
      return window.__vtt?.presetManager?.exportAll()?.length === 1;
    }, { timeout: 5000 });

    const result = await display.evaluate(() => {
      const presets = window.__vtt.presetManager.exportAll();
      return {
        count: presets.length,
        name: presets[0]?.name,
      };
    });

    expect(result.count).toBe(1);
    expect(result.name).toBe('Keep');
  });
});
