import { test, expect } from '@playwright/test';
import { getCSSToken } from './helpers.js';

test.describe('Density token system', () => {
  test('DM Guide: default --density-factor is 1', async ({ page }) => {
    await page.goto('/');
    expect(await getCSSToken(page, '--density-factor')).toBe('1');
  });

  test('DM Guide: compact --density-factor is 0.625', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => document.documentElement.dataset.density = 'compact');
    expect(await getCSSToken(page, '--density-factor')).toBe('0.625');
  });

  test('DM Guide: compact reduces nav-section-header padding', async ({ page }) => {
    // Load default → measure padding
    await page.goto('/');
    const defaultPad = await page.locator('.nav-section-header').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingTop)
    );
    // Set compact density via localStorage and reload so the blocking <head>
    // script applies data-density="compact" before first paint — matching how
    // real users experience density. Avoids Chromium's deferred custom-property
    // recalculation when toggling data attributes dynamically.
    await page.evaluate(() => localStorage.setItem('ui-density', 'compact'));
    await page.reload();
    const compactPad = await page.locator('.nav-section-header').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingTop)
    );
    expect(compactPad).toBeLessThan(defaultPad);
  });

  test('DM Guide: compact respects touch-target floor', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => document.documentElement.dataset.density = 'compact');
    const height = await page.locator('.nav-child').first().evaluate(
      (el) => el.getBoundingClientRect().height
    );
    expect(height).toBeGreaterThanOrEqual(24);
  });
});
