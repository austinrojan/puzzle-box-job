import { test, expect } from '@playwright/test';
import { gotoVTT } from './helpers.js';

test.describe('Fit-to-tokens computation — bounding box math', () => {

  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
  });

  const makeToken = (overrides = {}) => ({
    x: 500, y: 500, size: 1, isPC: false, visible: true, inInitiative: false,
    ...overrides,
  });

  test('empty array returns null', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeFitToTokens } = await import('/vtt/js/fit-to-tokens.js');
      return computeFitToTokens([], { w: 1920, h: 1080 });
    });
    expect(result).toBeNull();
  });

  test('all invisible tokens returns null', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeFitToTokens } = await import('/vtt/js/fit-to-tokens.js');
      const tokens = [
        { x: 100, y: 100, size: 1, isPC: false, visible: false, inInitiative: false },
      ];
      return computeFitToTokens(tokens, { w: 1920, h: 1080 });
    });
    expect(result).toBeNull();
  });

  test('single token produces valid framing', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeFitToTokens } = await import('/vtt/js/fit-to-tokens.js');
      const tokens = [
        { x: 500, y: 500, size: 1, isPC: false, visible: true, inInitiative: false },
      ];
      return computeFitToTokens(tokens, { w: 1920, h: 1080 });
    });
    expect(result).not.toBeNull();
    expect(result.centerX).toBe(500);
    expect(result.centerY).toBe(500);
    expect(result.zoom).toBeGreaterThan(0);
  });

  test('two distant tokens: center between them, zoom lower than single', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeFitToTokens } = await import('/vtt/js/fit-to-tokens.js');
      const viewport = { w: 1920, h: 1080 };

      const single = computeFitToTokens(
        [{ x: 100, y: 100, size: 1, isPC: false, visible: true, inInitiative: false }],
        viewport
      );
      const pair = computeFitToTokens(
        [
          { x: 100, y: 100, size: 1, isPC: false, visible: true, inInitiative: false },
          { x: 1000, y: 800, size: 1, isPC: false, visible: true, inInitiative: false },
        ],
        viewport
      );
      return { single, pair };
    });

    expect(result.pair.centerX).toBeCloseTo(550, 0);
    expect(result.pair.centerY).toBeCloseTo(450, 0);
    expect(result.pair.zoom).toBeLessThan(result.single.zoom);
  });

  test('PC mode filters non-PC tokens', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeFitToTokens } = await import('/vtt/js/fit-to-tokens.js');
      const tokens = [
        { x: 100, y: 100, size: 1, isPC: true, visible: true, inInitiative: false },
        { x: 9000, y: 9000, size: 1, isPC: false, visible: true, inInitiative: false },
      ];
      return computeFitToTokens(tokens, { w: 1920, h: 1080 }, { mode: 'pcs' });
    });
    expect(result.centerX).toBe(100);
    expect(result.centerY).toBe(100);
  });

  test('combatant mode filters non-initiative tokens', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeFitToTokens } = await import('/vtt/js/fit-to-tokens.js');
      const tokens = [
        { x: 200, y: 200, size: 1, isPC: false, visible: true, inInitiative: true },
        { x: 8000, y: 8000, size: 1, isPC: false, visible: true, inInitiative: false },
      ];
      return computeFitToTokens(tokens, { w: 1920, h: 1080 }, { mode: 'combatants' });
    });
    expect(result.centerX).toBe(200);
    expect(result.centerY).toBe(200);
  });

  test('maxZoom option clamps zoom', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeFitToTokens } = await import('/vtt/js/fit-to-tokens.js');
      const tokens = [
        { x: 500, y: 500, size: 1, isPC: false, visible: true, inInitiative: false },
      ];
      const unclamped = computeFitToTokens(tokens, { w: 1920, h: 1080 });
      const clamped = computeFitToTokens(tokens, { w: 1920, h: 1080 }, { maxZoom: 2.0 });
      return { unclampedZoom: unclamped.zoom, clampedZoom: clamped.zoom };
    });
    expect(result.clampedZoom).toBeLessThanOrEqual(2.0);
    expect(result.unclampedZoom).toBeGreaterThan(2.0);
  });

  test('single token with minPadding prevents infinite zoom', async ({ page }) => {
    const zoom = await page.evaluate(async () => {
      const { computeFitToTokens } = await import('/vtt/js/fit-to-tokens.js');
      const tokens = [
        { x: 500, y: 500, size: 1, isPC: false, visible: true, inInitiative: false },
      ];
      return computeFitToTokens(tokens, { w: 1920, h: 1080 }).zoom;
    });
    expect(zoom).toBeLessThan(20);
    expect(zoom).toBeGreaterThan(0);
  });

  test('large token (size=2) produces wider bounding box', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeFitToTokens } = await import('/vtt/js/fit-to-tokens.js');
      const viewport = { w: 1920, h: 1080 };
      const small = computeFitToTokens(
        [{ x: 500, y: 500, size: 1, isPC: false, visible: true, inInitiative: false }],
        viewport
      );
      const large = computeFitToTokens(
        [{ x: 500, y: 500, size: 2, isPC: false, visible: true, inInitiative: false }],
        viewport
      );
      return { smallZoom: small.zoom, largeZoom: large.zoom };
    });
    // Larger token should produce a lower zoom (wider view)
    expect(result.largeZoom).toBeLessThan(result.smallZoom);
  });
});
