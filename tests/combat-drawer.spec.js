import { test, expect } from '@playwright/test';

test.describe('Combat panel — wide viewport (inline column)', () => {
  test('combat panel position is NOT fixed at 1440px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    // Open combat panel
    await page.evaluate(() => {
      document.getElementById('app').classList.add('combat-open');
    });
    const position = await page.locator('#combat-panel').evaluate(
      (el) => getComputedStyle(el).position
    );
    expect(position).not.toBe('fixed');
  });
});

test.describe('Combat panel — narrow viewport (drawer)', () => {
  test('combat panel position is fixed at 960px', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 1080 });
    await page.goto('/');
    const position = await page.locator('#combat-panel').evaluate(
      (el) => getComputedStyle(el).position
    );
    expect(position).toBe('fixed');
  });

  test('combat panel has translateX transform when closed', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 1080 });
    await page.goto('/');
    const transform = await page.locator('#combat-panel').evaluate(
      (el) => getComputedStyle(el).transform
    );
    // translateX(100%) computes to a matrix with a positive X translation
    expect(transform).not.toBe('none');
  });

  test('backdrop element exists', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 1080 });
    await page.goto('/');
    await expect(page.locator('#combat-backdrop')).toBeAttached();
  });
});
