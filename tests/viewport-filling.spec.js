import { test, expect } from '@playwright/test';

const MAP_VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '2560x1440', width: 2560, height: 1440 },
  { name: '1280x800',  width: 1280, height: 800 },
  { name: '960x1080',  width: 960,  height: 1080 },
];

// Switch to map mode and wait for map to be fully loaded + rendered.
async function enterMapMode(page) {
  await page.evaluate(() => {
    const vtt = window.__vtt;
    if (!vtt) return;
    vtt.EventBus.emit('mode:switch', 'map');
    if (!vtt.state.mapId) vtt.EventBus.emit('map:load', 'M01');
  });
  await page.waitForFunction(() => {
    const cam = window.__vtt?.mapRenderer?.camera;
    return cam && cam.mapW > 0;
  }, { timeout: 10000 });
}

test.describe('Viewport-filling maps', () => {
  for (const vp of MAP_VIEWPORTS) {
    test(`map fills viewport at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/vtt/');
      await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, { timeout: 15000 });
      await enterMapMode(page);

      const rect = await page.evaluate(() => {
        const el = document.getElementById('map-container');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      });

      expect(rect).not.toBeNull();
      expect(rect.left).toBeLessThanOrEqual(1);
      expect(rect.top).toBeLessThanOrEqual(1);
      expect(rect.width).toBeGreaterThanOrEqual(vp.width - 2);
      expect(rect.height).toBeGreaterThanOrEqual(vp.height - 2);
    });
  }

  test('theater mode retains CSS transform at non-16:9', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/vtt/');
    await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, { timeout: 15000 });

    const transform = await page.evaluate(() => {
      const el = document.getElementById('vtt-scale-container');
      return window.getComputedStyle(el).transform;
    });
    expect(transform).not.toBe('none');
  });

  test('mode switch: theater → map → theater preserves layout', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/vtt/');
    await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, { timeout: 15000 });

    // Theater mode — should have CSS transform
    const theaterTransform = await page.evaluate(() =>
      getComputedStyle(document.getElementById('vtt-scale-container')).transform
    );
    expect(theaterTransform).not.toBe('none');

    // Switch to map mode
    await enterMapMode(page);
    const mapTransform = await page.evaluate(() =>
      getComputedStyle(document.getElementById('vtt-scale-container')).transform
    );
    expect(mapTransform).toBe('none');

    // Switch back to theater
    await page.evaluate(() => {
      window.__vtt.EventBus.emit('mode:switch', 'theater');
    });
    await page.waitForFunction(() => {
      const el = document.getElementById('vtt-scale-container');
      return el && getComputedStyle(el).transform !== 'none';
    }, { timeout: 5000 });
    const backTransform = await page.evaluate(() =>
      getComputedStyle(document.getElementById('vtt-scale-container')).transform
    );
    expect(backTransform).not.toBe('none');
  });
});
