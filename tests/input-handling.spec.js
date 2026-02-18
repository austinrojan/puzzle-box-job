import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode, injectTestAccessors } from './helpers.js';

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
    // Zoom in so both axes have room to pan (at cover zoom, clamping prevents pan)
    await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (cam) { cam.zoom = 2.0; cam.x = 200; cam.y = 200; cam._applyConstraints(); }
    });
    const posBefore = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam ? { x: cam.x, y: cam.y } : null;
    });

    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowDown');
    await page.waitForFunction((prev) => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && cam.x > prev.x && cam.y > prev.y;
    }, posBefore, { timeout: 3000 });
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ArrowDown');

    const posAfter = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam ? { x: cam.x, y: cam.y } : null;
    });

    expect(posAfter.x).toBeGreaterThan(posBefore.x);
    expect(posAfter.y).toBeGreaterThan(posBefore.y);
  });

  test('arrow keys stop on blur', async ({ page }) => {
    // Zoom in so panning is possible (at cover zoom, clamping prevents pan)
    await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (cam) { cam.zoom = 2.0; cam.x = 200; cam.y = 200; cam._applyConstraints(); }
    });
    const initX = await page.evaluate(() => window.__vtt?.mapRenderer?.camera?.x);
    await page.keyboard.down('ArrowRight');
    // Wait for pan to start (x increases)
    await page.waitForFunction((prev) => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && cam.x > prev;
    }, initX, { timeout: 3000 });
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));

    const posBefore = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam ? { x: cam.x } : null;
    });
    // Wait 3 rAF frames — if blur stopped panning, x won't change
    await page.waitForFunction(() => {
      return new Promise(r => {
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(true))));
      });
    }, { timeout: 3000 });
    const posAfter = await page.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam ? { x: cam.x } : null;
    });

    expect(posAfter.x).toBe(posBefore.x);
  });

  test('plus key zooms in at center', async ({ page }) => {
    // Normalize zoom to cover and read in one evaluate — prevents stale value
    // from ResizeObserver settling between separate evaluate calls
    const zoomBefore = await page.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam.fitCover();
      return cam.zoom;
    });
    await page.keyboard.press('Equal'); // '=' key = '+' without Shift
    await page.waitForFunction((prev) => {
      const z = window.__vtt?.mapRenderer?.camera?.zoom;
      return z != null && z > prev;
    }, zoomBefore, { timeout: 3000 });
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
    await page.waitForFunction((prev) => {
      const z = window.__vtt?.mapRenderer?.camera?.zoom;
      return z != null && z < prev;
    }, zoomBefore, { timeout: 3000 });
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
    await page.waitForFunction((prev) => {
      const z = window.__vtt?.mapRenderer?.camera?.zoom;
      return z != null && z > prev;
    }, zoomBefore, { timeout: 3000 });
    const zoomAfter = await page.evaluate(() =>
      window.__vtt?.mapRenderer?.camera?.zoom
    );
    expect(zoomAfter).toBeGreaterThan(zoomBefore);
  });

  test('left-click drag past threshold activates elastic bounds', async ({ page }) => {
    await injectTestAccessors(page);
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0; cam.x = 500; cam.y = 500;
      cam._applyConstraints();
    });

    const box = await page.locator('#map-container').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Left-click and drag beyond DRAG_THRESHOLD (3px)
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(cx + 50, cy, { steps: 5 });

    const isGestureActive = await page.evaluate(() => __cam()?._gestureActive);
    expect(isGestureActive).toBe(true);

    // Release — should trigger snap-back and clear _gestureActive
    await page.mouse.up({ button: 'left' });
    // Wait for inertial coast / snap-back to settle
    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && !cam._gestureActive;
    }, { timeout: 3000 });
    const isGestureActiveAfter = await page.evaluate(() => __cam()?._gestureActive);
    expect(isGestureActiveAfter).toBe(false);
  });
});
