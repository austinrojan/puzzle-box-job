import { test, expect } from '@playwright/test';
import { gotoVTT } from './helpers.js';

test.describe('Easing functions — pure math', () => {

  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
  });

  // Parametrized: boundary values (0→0, 1→1) for all easing functions
  for (const fnName of ['easeInOutCubic', 'easeOutQuint', 'easeInOutQuart', 'linear']) {
    test(`${fnName}: boundary values (0→0, 1→1)`, async ({ page }) => {
      const result = await page.evaluate(async (name) => {
        const mod = await import('/vtt/js/easing.js');
        return { at0: mod[name](0), at1: mod[name](1) };
      }, fnName);
      expect(result.at0).toBe(0);
      expect(result.at1).toBe(1);
    });
  }

  // Parametrized: monotonically increasing
  for (const fnName of ['easeInOutCubic', 'easeOutQuint', 'easeInOutQuart']) {
    test(`${fnName}: monotonically increasing`, async ({ page }) => {
      const isMonotonic = await page.evaluate(async (name) => {
        const mod = await import('/vtt/js/easing.js');
        const fn = mod[name];
        let prev = -1;
        for (let i = 0; i <= 100; i++) {
          const t = i / 100;
          const val = fn(t);
          if (val < prev - 1e-10) return false;
          prev = val;
        }
        return true;
      }, fnName);
      expect(isMonotonic).toBe(true);
    });
  }

  // InOut curves pass through midpoint 0.5→0.5
  for (const fnName of ['easeInOutCubic', 'easeInOutQuart']) {
    test(`${fnName}: midpoint 0.5→0.5`, async ({ page }) => {
      const result = await page.evaluate(async (name) => {
        const mod = await import('/vtt/js/easing.js');
        return mod[name](0.5);
      }, fnName);
      expect(result).toBe(0.5);
    });
  }

  test('easeInOutCubic: symmetric around midpoint', async ({ page }) => {
    const maxError = await page.evaluate(async () => {
      const { easeInOutCubic } = await import('/vtt/js/easing.js');
      let maxErr = 0;
      for (const d of [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5]) {
        const sum = easeInOutCubic(0.5 - d) + easeInOutCubic(0.5 + d);
        maxErr = Math.max(maxErr, Math.abs(sum - 1.0));
      }
      return maxErr;
    });
    expect(maxError).toBeLessThan(1e-10);
  });

  test('linear: t === output for all t', async ({ page }) => {
    const allEqual = await page.evaluate(async () => {
      const { linear } = await import('/vtt/js/easing.js');
      for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        if (linear(t) !== t) return false;
      }
      return true;
    });
    expect(allEqual).toBe(true);
  });
});
