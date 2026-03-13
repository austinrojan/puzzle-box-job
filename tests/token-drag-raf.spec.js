import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode } from './helpers.js';

test.describe('Token drag rAF coalescence', () => {

  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
  });

  test('rapid mousemove events coalesce into a single draw per frame', async ({ page }) => {
    const drawCount = await page.evaluate(() => {
      const tm = window.__vtt.tokenManager;

      tm.addToken('guard', 5, 5);

      let count = 0;
      const origDraw = tm.draw.bind(tm);
      tm.draw = () => { count++; origDraw(); };

      const cam = window.__vtt.mapRenderer.camera;
      const screen = cam.worldToScreen(5 * cam.mapW / 20 + 10, 5 * cam.mapW / 20 + 10);
      tm._dragging = tm.tokens[0];
      tm._dragScreenX = screen.x;
      tm._dragScreenY = screen.y;

      for (let i = 0; i < 10; i++) {
        tm._dragScreenX = screen.x + i * 5;
        tm._dragScreenY = screen.y + i * 3;
        tm._requestDraw();
      }

      const countBeforeFrame = count;

      return new Promise(resolve => {
        requestAnimationFrame(() => {
          resolve({ countBeforeFrame, countAfterFrame: count });
        });
      });
    });

    expect(drawCount.countBeforeFrame).toBe(0);
    expect(drawCount.countAfterFrame).toBe(1);
  });

  test('onMouseUp cancels pending rAF and calls _drawAndSync synchronously', async ({ page }) => {
    const result = await page.evaluate(() => {
      const tm = window.__vtt.tokenManager;

      tm.addToken('guard', 3, 3);

      let drawCount = 0;
      let syncCount = 0;
      const origDraw = tm.draw.bind(tm);
      const origSync = tm._drawAndSync.bind(tm);
      tm.draw = () => { drawCount++; origDraw(); };
      tm._drawAndSync = () => { syncCount++; origSync(); };

      tm._dragging = tm.tokens[0];
      tm._dragScreenX = 100;
      tm._dragScreenY = 100;

      tm._requestDraw();
      const hadPendingRaf = tm._drawRafPending;

      tm.onMouseUp({ button: 0 });

      const rafCancelled = !tm._drawRafPending && tm._drawRafId === null;

      return new Promise(resolve => {
        requestAnimationFrame(() => {
          resolve({
            hadPendingRaf,
            rafCancelled,
            drawCountAfterFrame: drawCount,
            syncCount,
          });
        });
      });
    });

    expect(result.hadPendingRaf).toBe(true);
    expect(result.rafCancelled).toBe(true);
    // _drawAndSync was called once (by mouseup)
    expect(result.syncCount).toBe(1);
    // _drawAndSync internally calls draw(), so drawCount = 1
    expect(result.drawCountAfterFrame).toBe(1);
  });

  test('map:redraw EventBus also coalesces via _requestDraw', async ({ page }) => {
    const result = await page.evaluate(() => {
      const tm = window.__vtt.tokenManager;
      const { EventBus } = window.__vtt;

      let drawCount = 0;
      const origDraw = tm.draw.bind(tm);
      tm.draw = () => { drawCount++; origDraw(); };

      for (let i = 0; i < 5; i++) {
        EventBus.emit('map:redraw');
      }

      const countBeforeFrame = drawCount;

      return new Promise(resolve => {
        requestAnimationFrame(() => {
          resolve({ countBeforeFrame, countAfterFrame: drawCount });
        });
      });
    });

    expect(result.countBeforeFrame).toBe(0);
    expect(result.countAfterFrame).toBe(1);
  });

  test('mousedown on token schedules immediate _requestDraw', async ({ page }) => {
    const result = await page.evaluate(() => {
      const tm = window.__vtt.tokenManager;
      const cam = window.__vtt.mapRenderer.camera;

      tm.addToken('guard', 5, 5);
      const token = tm.tokens[tm.tokens.length - 1];

      let drawCount = 0;
      const origDraw = tm.draw.bind(tm);
      tm.draw = () => { drawCount++; origDraw(); };

      const cp = window.__vtt.mapRenderer.cellPx;
      const worldX = token.col * cp + cp / 2;
      const worldY = token.row * cp + cp / 2;
      const screen = cam.worldToScreen(worldX, worldY);

      const container = document.getElementById('map-container');
      const rect = container.getBoundingClientRect();
      container.dispatchEvent(new MouseEvent('mousedown', {
        button: 0,
        clientX: rect.left + screen.x,
        clientY: rect.top + screen.y,
        bubbles: true,
      }));

      const dragging = tm._dragging !== null;
      const rafPending = tm._drawRafPending;
      const drawsBeforeFrame = drawCount;

      return new Promise(resolve => {
        requestAnimationFrame(() => {
          tm._dragging = null;
          container.classList.remove('dragging-token');
          tm.draw = origDraw;
          origDraw();

          resolve({
            dragging,
            rafPending,
            drawsBeforeFrame,
            drawsAfterFrame: drawCount,
          });
        });
      });
    });

    expect(result.dragging).toBe(true);
    expect(result.rafPending).toBe(true);
    expect(result.drawsBeforeFrame).toBe(0);
    expect(result.drawsAfterFrame).toBe(1);
  });

  test('during drag, label DOM is stable across multiple frames', async ({ page }) => {
    const result = await page.evaluate(() => {
      const tm = window.__vtt.tokenManager;

      tm.addToken('guard', 5, 5);
      tm.addToken('guard', 8, 8);

      // Establish baseline labels
      tm._drawAndSync();
      const labelsEl = document.getElementById('map-labels');
      const childrenBeforeDrag = labelsEl.children.length;

      // Start drag
      const token = tm.tokens[0];
      tm._dragging = token;
      tm._dragScreenX = 100;
      tm._dragScreenY = 100;
      tm.labelsEl.style.display = 'none';

      // Capture a reference to the first label child for identity check
      const firstChildBeforeDraw = labelsEl.children[0];

      // Call draw() 3 times — simulates 3 drag frames
      tm.draw();
      const childrenAfterDraw1 = labelsEl.children.length;
      const firstChildAfterDraw1 = labelsEl.children[0];

      tm.draw();
      const childrenAfterDraw2 = labelsEl.children.length;
      const firstChildAfterDraw2 = labelsEl.children[0];

      tm.draw();
      const childrenAfterDraw3 = labelsEl.children.length;
      const firstChildAfterDraw3 = labelsEl.children[0];

      const labelsHidden = tm.labelsEl.style.display === 'none';

      // DOM node identity: same object reference across all draws
      const nodeIdentityStable =
        firstChildBeforeDraw === firstChildAfterDraw1 &&
        firstChildAfterDraw1 === firstChildAfterDraw2 &&
        firstChildAfterDraw2 === firstChildAfterDraw3;

      // End drag
      tm._dragging = null;
      tm._drawAndSync();
      tm.labelsEl.style.display = '';

      const childrenAfterDrag = labelsEl.children.length;
      const labelsVisible = tm.labelsEl.style.display === '';

      return {
        childrenBeforeDrag,
        childrenAfterDraw1,
        childrenAfterDraw2,
        childrenAfterDraw3,
        labelsHidden,
        nodeIdentityStable,
        childrenAfterDrag,
        labelsVisible,
      };
    });

    // Before drag: labels exist for both tokens
    expect(result.childrenBeforeDrag).toBeGreaterThanOrEqual(2);
    // During drag: DOM children unchanged across all 3 frames
    expect(result.childrenAfterDraw1).toBe(result.childrenBeforeDrag);
    expect(result.childrenAfterDraw2).toBe(result.childrenBeforeDrag);
    expect(result.childrenAfterDraw3).toBe(result.childrenBeforeDrag);
    // Same DOM nodes (identity, not just count)
    expect(result.nodeIdentityStable).toBe(true);
    expect(result.labelsHidden).toBe(true);
    // After drag: labels rebuilt and visible
    expect(result.childrenAfterDrag).toBeGreaterThanOrEqual(2);
    expect(result.labelsVisible).toBe(true);
  });
});
