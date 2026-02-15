import { test, expect } from '@playwright/test';
import { gotoVTT } from './helpers.js';

test.describe('Easing functions — pure math', () => {

  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
  });

  test('easeInOutCubic: boundary values 0, 0.5, 1', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { easeInOutCubic } = await import('/vtt/js/easing.js');
      return {
        at0: easeInOutCubic(0),
        at05: easeInOutCubic(0.5),
        at1: easeInOutCubic(1),
      };
    });
    expect(result.at0).toBe(0);
    expect(result.at05).toBe(0.5);
    expect(result.at1).toBe(1);
  });

  test('easeInOutCubic: monotonically increasing', async ({ page }) => {
    const isMonotonic = await page.evaluate(async () => {
      const { easeInOutCubic } = await import('/vtt/js/easing.js');
      let prev = -1;
      for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        const val = easeInOutCubic(t);
        if (val < prev - 1e-10) return false;
        prev = val;
      }
      return true;
    });
    expect(isMonotonic).toBe(true);
  });

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

  test('easeOutQuint: boundary values 0 and 1', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { easeOutQuint } = await import('/vtt/js/easing.js');
      return { at0: easeOutQuint(0), at1: easeOutQuint(1) };
    });
    expect(result.at0).toBe(0);
    expect(result.at1).toBe(1);
  });

  test('easeOutQuint: monotonically increasing', async ({ page }) => {
    const isMonotonic = await page.evaluate(async () => {
      const { easeOutQuint } = await import('/vtt/js/easing.js');
      let prev = -1;
      for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        const val = easeOutQuint(t);
        if (val < prev - 1e-10) return false;
        prev = val;
      }
      return true;
    });
    expect(isMonotonic).toBe(true);
  });

  test('easeInOutQuart: boundary values and midpoint', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { easeInOutQuart } = await import('/vtt/js/easing.js');
      return {
        at0: easeInOutQuart(0),
        at05: easeInOutQuart(0.5),
        at1: easeInOutQuart(1),
      };
    });
    expect(result.at0).toBe(0);
    expect(result.at05).toBe(0.5);
    expect(result.at1).toBe(1);
  });

  test('easeInOutQuart: monotonically increasing', async ({ page }) => {
    const isMonotonic = await page.evaluate(async () => {
      const { easeInOutQuart } = await import('/vtt/js/easing.js');
      let prev = -1;
      for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        const val = easeInOutQuart(t);
        if (val < prev - 1e-10) return false;
        prev = val;
      }
      return true;
    });
    expect(isMonotonic).toBe(true);
  });
});
