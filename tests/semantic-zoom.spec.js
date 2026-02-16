import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode } from './helpers.js';

test.describe('Semantic zoom', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
  });

  test('no semantic zoom classes at cover zoom', async ({ page }) => {
    // Ensure camera is at cover zoom
    await page.evaluate(() => {
      window.__vtt.mapRenderer.camera.fitCover();
    });

    const classes = await page.evaluate(() => {
      const container = document.getElementById('map-container');
      return {
        gridLabels: container.classList.contains('sz-grid-labels'),
        tokenNames: container.classList.contains('sz-token-names'),
        conditionIcons: container.classList.contains('sz-condition-icons'),
        hpBars: container.classList.contains('sz-hp-bars'),
        tokenDetail: container.classList.contains('sz-token-detail'),
      };
    });

    expect(classes.gridLabels).toBe(false);
    expect(classes.tokenNames).toBe(false);
    expect(classes.conditionIcons).toBe(false);
    expect(classes.hpBars).toBe(false);
    expect(classes.tokenDetail).toBe(false);
  });

  test('zoom to 1.2x coverZoom adds sz-token-names', async ({ page }) => {
    await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      const targetZoom = cam._coverZoom * 1.25;
      cam.setPosition(cam.mapW / 2, cam.mapH / 2, targetZoom);
    });

    const hasClass = await page.evaluate(() =>
      document.getElementById('map-container').classList.contains('sz-token-names')
    );
    expect(hasClass).toBe(true);
  });

  test('zoom to 1.8x coverZoom adds sz-grid-labels', async ({ page }) => {
    await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      const targetZoom = cam._coverZoom * 1.85;
      cam.setPosition(cam.mapW / 2, cam.mapH / 2, targetZoom);
    });

    const hasClass = await page.evaluate(() =>
      document.getElementById('map-container').classList.contains('sz-grid-labels')
    );
    expect(hasClass).toBe(true);
  });

  test('zoom back to cover removes classes with hideAt > 1.0', async ({ page }) => {
    // Zoom in first to activate classes
    await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam.setPosition(cam.mapW / 2, cam.mapH / 2, cam._coverZoom * 2.5);
    });

    // Verify classes are present
    const before = await page.evaluate(() => {
      const container = document.getElementById('map-container');
      return container.classList.contains('sz-token-names') &&
             container.classList.contains('sz-grid-labels');
    });
    expect(before).toBe(true);

    // Zoom back to cover
    await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam.fitCover();
    });

    const after = await page.evaluate(() => {
      const container = document.getElementById('map-container');
      return {
        tokenNames: container.classList.contains('sz-token-names'),
        gridLabels: container.classList.contains('sz-grid-labels'),
      };
    });

    // At coverZoom (ratio = 1.0):
    // - sz-token-names (hideAt: 1.0): ratio is NOT < 1.0, so class persists (in dead zone)
    // - sz-grid-labels (hideAt: 1.5): ratio 1.0 < 1.5, so class is removed
    expect(after.tokenNames).toBe(true);
    expect(after.gridLabels).toBe(false);
  });

  test('hysteresis: class persists in dead zone between hideAt and showAt', async ({ page }) => {
    // Zoom to 1.25x to activate sz-token-names (showAt: 1.2)
    await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam.setPosition(cam.mapW / 2, cam.mapH / 2, cam._coverZoom * 1.25);
    });

    const activated = await page.evaluate(() =>
      document.getElementById('map-container').classList.contains('sz-token-names')
    );
    expect(activated).toBe(true);

    // Zoom back to 1.1x (in dead zone: above hideAt 1.0, below showAt 1.2)
    await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam.setPosition(cam.mapW / 2, cam.mapH / 2, cam._coverZoom * 1.1);
    });

    const stillActive = await page.evaluate(() =>
      document.getElementById('map-container').classList.contains('sz-token-names')
    );
    expect(stillActive).toBe(true);
  });

  test('zoom below hideAt removes class (DM mode)', async ({ page }) => {
    // Enable DM zoom-past-cover to go below coverZoom
    await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam._dmCanZoomPastCover = true;
    });

    // Activate sz-token-names
    await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam.setPosition(cam.mapW / 2, cam.mapH / 2, cam._coverZoom * 1.25);
    });

    const activated = await page.evaluate(() =>
      document.getElementById('map-container').classList.contains('sz-token-names')
    );
    expect(activated).toBe(true);

    // Zoom below hideAt (0.9x < 1.0 hideAt)
    await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam.setPosition(cam.mapW / 2, cam.mapH / 2, cam._coverZoom * 0.9);
    });

    const removed = await page.evaluate(() =>
      document.getElementById('map-container').classList.contains('sz-token-names')
    );
    expect(removed).toBe(false);
  });

  test('reset() clears all classes', async ({ page }) => {
    // Activate all classes
    await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam.setPosition(cam.mapW / 2, cam.mapH / 2, cam._coverZoom * 2.5);
    });

    const beforeReset = await page.evaluate(() => {
      const container = document.getElementById('map-container');
      return container.classList.contains('sz-token-names') &&
             container.classList.contains('sz-grid-labels') &&
             container.classList.contains('sz-token-detail');
    });
    expect(beforeReset).toBe(true);

    await page.evaluate(() => {
      window.__vtt.semanticZoom.reset();
    });

    const afterReset = await page.evaluate(() => {
      const container = document.getElementById('map-container');
      return {
        tokenNames: container.classList.contains('sz-token-names'),
        gridLabels: container.classList.contains('sz-grid-labels'),
        tokenDetail: container.classList.contains('sz-token-detail'),
      };
    });

    expect(afterReset.tokenNames).toBe(false);
    expect(afterReset.gridLabels).toBe(false);
    expect(afterReset.tokenDetail).toBe(false);
  });
});
