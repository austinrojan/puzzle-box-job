import { test, expect } from '@playwright/test';

test.describe('Controller container queries', () => {
  test('single column at narrow width', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 });
    await page.goto('/controller/');
    await page.evaluate(() => document.fonts.ready);
    const cols = await page.locator('.control-sections').evaluate(el =>
      getComputedStyle(el).gridTemplateColumns
    );
    // At <500px, should be single column (1fr)
    expect(cols.split(' ').length).toBe(1);
  });

  test('two columns at 500px+', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto('/controller/');
    await page.evaluate(() => document.fonts.ready);
    const cols = await page.locator('.control-sections').evaluate(el =>
      getComputedStyle(el).gridTemplateColumns
    );
    expect(cols.split(' ').length).toBe(2);
  });

  test('three columns at 800px+', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto('/controller/');
    await page.evaluate(() => document.fonts.ready);
    const cols = await page.locator('.control-sections').evaluate(el =>
      getComputedStyle(el).gridTemplateColumns
    );
    expect(cols.split(' ').length).toBe(3);
  });
});
