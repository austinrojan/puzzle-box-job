import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode } from './helpers.js';

async function evalNormalize(page, wheelEvent) {
  return page.evaluate(async (evt) => {
    const { normalizeWheel } = await import('/vtt/js/normalize-wheel.js');
    return normalizeWheel(evt);
  }, wheelEvent);
}

test.describe('Phase 2: Input handling', () => {

  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
  });

  // --- normalizeWheel unit tests (run via dynamic import in browser) ---

  test('normalizeWheel: Chrome mouse wheel → pan dy', async ({ page }) => {
    const result = await evalNormalize(page, {
      deltaX: 0, deltaY: 100, deltaMode: 0,
      ctrlKey: false, metaKey: false, shiftKey: false
    });
    expect(result.dz).toBe(0);
    expect(result.dy).toBe(100);
    expect(result.dx).toBe(0);
  });

  test('normalizeWheel: Firefox line mode → scaled', async ({ page }) => {
    const result = await evalNormalize(page, {
      deltaX: 0, deltaY: 3, deltaMode: 1,
      ctrlKey: false, metaKey: false, shiftKey: false
    });
    expect(result.dy).toBe(120); // 3 * LINE_HEIGHT(40)
  });

  test('normalizeWheel: pinch zoom clamped', async ({ page }) => {
    const result = await evalNormalize(page, {
      deltaX: 0, deltaY: 50, deltaMode: 0,
      ctrlKey: true, metaKey: false, shiftKey: false
    });
    expect(result.dz).toBeCloseTo(0.1); // MAX_ZOOM_STEP(10) / 100
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
  });

  test('normalizeWheel: Shift+scroll → horizontal', async ({ page }) => {
    const result = await evalNormalize(page, {
      deltaX: 0, deltaY: 100, deltaMode: 0,
      ctrlKey: false, metaKey: false, shiftKey: true
    });
    expect(result.dx).toBe(100);
    expect(result.dy).toBe(0);
    expect(result.dz).toBe(0);
  });

  test('normalizeWheel: page deltaMode', async ({ page }) => {
    const result = await evalNormalize(page, {
      deltaX: 0, deltaY: 1, deltaMode: 2,
      ctrlKey: false, metaKey: false, shiftKey: false
    });
    expect(result.dy).toBe(800); // 1 * PAGE_HEIGHT(800)
  });

  // --- Keyboard camera control E2E tests ---

  test('arrow keys produce diagonal pan', async ({ page }) => {
    const posBefore = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam ? { x: cam.x, y: cam.y } : null;
    });

    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(300);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ArrowDown');
    await page.waitForTimeout(50);

    const posAfter = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam ? { x: cam.x, y: cam.y } : null;
    });

    expect(posAfter.x).toBeGreaterThan(posBefore.x);
    expect(posAfter.y).toBeGreaterThan(posBefore.y);
  });

  test('arrow keys stop on blur', async ({ page }) => {
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(200);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(50);

    const posBefore = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam ? { x: cam.x } : null;
    });
    await page.waitForTimeout(200);
    const posAfter = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam ? { x: cam.x } : null;
    });

    expect(posAfter.x).toBe(posBefore.x);
  });

  test('plus key zooms in at center', async ({ page }) => {
    const zoomBefore = await page.evaluate(() =>
      window.__vtt?.mapRenderer?.camera?.zoom
    );
    await page.keyboard.press('Equal'); // '=' key = '+' without Shift
    await page.waitForTimeout(50);
    const zoomAfter = await page.evaluate(() =>
      window.__vtt?.mapRenderer?.camera?.zoom
    );
    expect(zoomAfter).toBeGreaterThan(zoomBefore);
  });

  test('minus key zooms out at center', async ({ page }) => {
    // First zoom in so we have room to zoom out
    await page.evaluate(() => {
      window.__vtt.mapRenderer.camera.zoomAt(960, 540, 0.5);
    });
    const zoomBefore = await page.evaluate(() =>
      window.__vtt?.mapRenderer?.camera?.zoom
    );
    await page.keyboard.press('Minus');
    await page.waitForTimeout(50);
    const zoomAfter = await page.evaluate(() =>
      window.__vtt?.mapRenderer?.camera?.zoom
    );
    expect(zoomAfter).toBeLessThan(zoomBefore);
  });

  test('camera:zoom EventBus still works (player controls)', async ({ page }) => {
    const zoomBefore = await page.evaluate(() =>
      window.__vtt?.mapRenderer?.camera?.zoom
    );
    await page.evaluate(() => {
      window.__vtt.EventBus.emit('camera:zoom', 1);
    });
    await page.waitForTimeout(50);
    const zoomAfter = await page.evaluate(() =>
      window.__vtt?.mapRenderer?.camera?.zoom
    );
    expect(zoomAfter).toBeGreaterThan(zoomBefore);
  });
});
