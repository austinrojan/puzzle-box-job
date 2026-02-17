import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode, injectTestAccessors, injectAnimationWaitHelper } from './helpers.js';

test.describe('CameraPresetManager', () => {

  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
    await page.evaluate(() => localStorage.removeItem('vtt-camera-presets'));
    await injectAnimationWaitHelper(page);
    await page.evaluate(async () => {
      const { CameraPresetManager } = await import('/vtt/js/camera-presets.js');
      const { FlyToAnimator } = await import('/vtt/js/camera-animator.js');
      window.__CameraPresetManager = CameraPresetManager;
      window.__createTestPresetManager = (mapId = 'M01') => {
        const cam = window.__cam();
        const animator = new FlyToAnimator(cam, { w: cam.viewportW, h: cam.viewportH });
        const mgr = new CameraPresetManager(animator);
        mgr.setCurrentMap(mapId);
        return { animator, mgr, cam };
      };
    });
  });

  test('save creates a preset that appears in listForCurrentMap', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { animator, mgr, cam } = window.__createTestPresetManager();

      const vp = { width: cam.viewportW, height: cam.viewportH };
      const preset = mgr.save('Boss Arena', cam, vp);
      const list = mgr.listForCurrentMap();

      animator.destroy();
      mgr.destroy();
      return {
        presetName: preset.name,
        presetId: preset.id,
        hasCamera: preset.camera != null,
        listLength: list.length,
        listContainsPreset: list.some(p => p.id === preset.id),
        mapId: preset.mapId,
      };
    });
    expect(result.presetName).toBe('Boss Arena');
    expect(result.hasCamera).toBe(true);
    expect(result.listLength).toBe(1);
    expect(result.listContainsPreset).toBe(true);
    expect(result.mapId).toBe('M01');
  });

  test('recall triggers flyTo to saved position', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { animator, mgr, cam } = window.__createTestPresetManager();

      cam.setPosition(cam.mapW * 0.25, cam.mapH * 0.25, cam._coverZoom * 2);
      const vp = { width: cam.viewportW, height: cam.viewportH };
      const preset = mgr.save('Corner', cam, vp);

      cam.setPosition(cam.mapW * 0.5, cam.mapH * 0.5, cam._coverZoom * 1.5);
      const beforeX = cam.x;
      const beforeY = cam.y;

      const recalled = mgr.recall(preset.id);

      await window.__waitForAnimComplete();

      const moved = cam.x !== beforeX || cam.y !== beforeY;
      animator.destroy();
      mgr.destroy();
      return { recalled, moved };
    });
    expect(result.recalled).toBe(true);
    expect(result.moved).toBe(true);
  });

  test('delete removes preset from list', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { animator, mgr, cam } = window.__createTestPresetManager();

      const vp = { width: cam.viewportW, height: cam.viewportH };
      const preset = mgr.save('To Delete', cam, vp);
      const beforeLength = mgr.listForCurrentMap().length;

      mgr.delete(preset.id);
      const afterLength = mgr.listForCurrentMap().length;

      animator.destroy();
      mgr.destroy();
      return { beforeLength, afterLength };
    });
    expect(result.beforeLength).toBe(1);
    expect(result.afterLength).toBe(0);
  });

  test('update changes preset name', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { animator, mgr, cam } = window.__createTestPresetManager();

      const vp = { width: cam.viewportW, height: cam.viewportH };
      const preset = mgr.save('Original', cam, vp);
      mgr.update(preset.id, { name: 'Renamed' });

      const updated = mgr.listForCurrentMap().find(p => p.id === preset.id);
      animator.destroy();
      mgr.destroy();
      return { name: updated.name };
    });
    expect(result.name).toBe('Renamed');
  });

  test('updatePosition changes camera data', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { animator, mgr, cam } = window.__createTestPresetManager();

      const vp = { width: cam.viewportW, height: cam.viewportH };
      const preset = mgr.save('Position', cam, vp);
      const originalZoom = preset.camera.zoom;

      cam.setPosition(cam.mapW * 0.3, cam.mapH * 0.3, cam._coverZoom * 2.5);
      mgr.updatePosition(preset.id, cam, vp);

      const updated = mgr.listForCurrentMap().find(p => p.id === preset.id);
      animator.destroy();
      mgr.destroy();
      return {
        originalZoom,
        updatedZoom: updated.camera.zoom,
        changed: Math.abs(updated.camera.zoom - originalZoom) > 0.01,
      };
    });
    expect(result.changed).toBe(true);
  });

  test('recallByHotkey recalls preset with matching hotkey', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { animator, mgr, cam } = window.__createTestPresetManager();

      cam.setPosition(cam.mapW * 0.25, cam.mapH * 0.25, cam._coverZoom * 2);
      const vp = { width: cam.viewportW, height: cam.viewportH };
      const preset = mgr.save('Hotkey Test', cam, vp, { hotkey: '1' });

      cam.setPosition(cam.mapW * 0.5, cam.mapH * 0.5, cam._coverZoom * 1.5);
      const beforeX = cam.x;

      const recalled = mgr.recallByHotkey(1);

      await window.__waitForAnimComplete();

      const moved = cam.x !== beforeX;
      animator.destroy();
      mgr.destroy();
      return { recalled, moved, hotkey: preset.hotkey };
    });
    expect(result.recalled).toBe(true);
    expect(result.moved).toBe(true);
    expect(result.hotkey).toBe('1');
  });

  test('exportAll and importAll roundtrip preserves data', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { animator, mgr: mgr1, cam } = window.__createTestPresetManager();

      const vp = { width: cam.viewportW, height: cam.viewportH };
      mgr1.save('Preset A', cam, vp, { hotkey: '1' });
      cam.setPosition(cam.mapW * 0.3, cam.mapH * 0.3, cam._coverZoom * 2);
      mgr1.save('Preset B', cam, vp, { hotkey: '2' });

      const exported = mgr1.exportAll();

      // Fresh manager to import into
      localStorage.removeItem('vtt-camera-presets');
      const mgr2 = new window.__CameraPresetManager(animator);
      mgr2.setCurrentMap('M01');
      mgr2.importAll(exported);

      const list = mgr2.listForCurrentMap();
      animator.destroy();
      mgr1.destroy();
      mgr2.destroy();
      return {
        exportedCount: exported.length,
        importedCount: list.length,
        names: list.map(p => p.name),
        hotkeys: list.map(p => p.hotkey),
      };
    });
    expect(result.exportedCount).toBe(2);
    expect(result.importedCount).toBe(2);
    expect(result.names).toContain('Preset A');
    expect(result.names).toContain('Preset B');
    expect(result.hotkeys).toContain('1');
    expect(result.hotkeys).toContain('2');
  });

  test('presets filter by mapId', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { animator, mgr, cam } = window.__createTestPresetManager();

      const vp = { width: cam.viewportW, height: cam.viewportH };
      mgr.save('Map 1 Preset', cam, vp);

      mgr.setCurrentMap('M02');
      mgr.save('Map 2 Preset', cam, vp);

      const map1List = (() => { mgr.setCurrentMap('M01'); return mgr.listForCurrentMap(); })();
      const map2List = (() => { mgr.setCurrentMap('M02'); return mgr.listForCurrentMap(); })();

      animator.destroy();
      mgr.destroy();
      return {
        map1Count: map1List.length,
        map1Name: map1List[0]?.name,
        map2Count: map2List.length,
        map2Name: map2List[0]?.name,
      };
    });
    expect(result.map1Count).toBe(1);
    expect(result.map1Name).toBe('Map 1 Preset');
    expect(result.map2Count).toBe(1);
    expect(result.map2Name).toBe('Map 2 Preset');
  });

  test('localStorage persistence survives reload', async ({ page }) => {
    await page.evaluate(async () => {
      const { animator, mgr, cam } = window.__createTestPresetManager();
      const vp = { width: cam.viewportW, height: cam.viewportH };
      mgr.save('Persistent', cam, vp, { hotkey: '3' });
      animator.destroy();
      mgr.destroy();
    });

    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);

    const result = await page.evaluate(async () => {
      const { CameraPresetManager } = await import('/vtt/js/camera-presets.js');
      const { FlyToAnimator } = await import('/vtt/js/camera-animator.js');
      const cam = window.__cam();
      const animator = new FlyToAnimator(cam, { w: cam.viewportW, h: cam.viewportH });
      const mgr = new CameraPresetManager(animator);
      mgr.setCurrentMap('M01');
      const list = mgr.listForCurrentMap();
      animator.destroy();
      mgr.destroy();
      return {
        count: list.length,
        name: list[0]?.name,
        hotkey: list[0]?.hotkey,
      };
    });
    expect(result.count).toBe(1);
    expect(result.name).toBe('Persistent');
    expect(result.hotkey).toBe('3');
  });

  test('duplicate hotkey clears from previous preset', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { animator, mgr, cam } = window.__createTestPresetManager();

      const vp = { width: cam.viewportW, height: cam.viewportH };
      const presetA = mgr.save('A', cam, vp, { hotkey: '1' });
      const presetB = mgr.save('B', cam, vp);

      mgr.update(presetB.id, { hotkey: '1' });

      const list = mgr.listForCurrentMap();
      const a = list.find(p => p.id === presetA.id);
      const b = list.find(p => p.id === presetB.id);

      animator.destroy();
      mgr.destroy();
      return { aHotkey: a.hotkey, bHotkey: b.hotkey };
    });
    expect(result.aHotkey).toBeNull();
    expect(result.bHotkey).toBe('1');
  });

  test('recall returns false for nonexistent preset', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { animator, mgr } = window.__createTestPresetManager();
      const recalled = mgr.recall('nonexistent-id');
      animator.destroy();
      mgr.destroy();
      return { recalled };
    });
    expect(result.recalled).toBe(false);
  });

  test('importAll([]) does not wipe existing presets', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { animator, mgr, cam } = window.__createTestPresetManager();
      const vp = { width: cam.viewportW, height: cam.viewportH };
      mgr.save('Keep Me', cam, vp);
      const before = mgr.listForCurrentMap().length;
      mgr.importAll([]);
      const after = mgr.listForCurrentMap().length;
      animator.destroy();
      mgr.destroy();
      return { before, after };
    });
    expect(result.before).toBe(1);
    expect(result.after).toBe(1);
  });

  test('importAll(null) does not throw', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { animator, mgr } = window.__createTestPresetManager();
      try {
        mgr.importAll(null);
        mgr.importAll(undefined);
        mgr.importAll('not-an-array');
        animator.destroy();
        mgr.destroy();
        return { threw: false };
      } catch (e) {
        animator.destroy();
        mgr.destroy();
        return { threw: true, error: e.message };
      }
    });
    expect(result.threw).toBe(false);
  });

  test('importAll skips entries without id', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { animator, mgr } = window.__createTestPresetManager();
      mgr.importAll([
        { id: 'a', name: 'Valid', camera: {}, mapId: 'M01' },
        null,
        { name: 'No ID' },
        { id: 'b', name: 'Also Valid', camera: {}, mapId: 'M01' },
      ]);
      const list = mgr.listForCurrentMap();
      animator.destroy();
      mgr.destroy();
      return { count: list.length, names: list.map(p => p.name).sort() };
    });
    expect(result.count).toBe(2);
    expect(result.names).toEqual(['Also Valid', 'Valid']);
  });
});
