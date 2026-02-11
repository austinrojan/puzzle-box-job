import { test, expect } from '@playwright/test';

test.describe('Shared token resolution', () => {
  for (const [app, url] of [['DM Guide', '/'], ['Controller', '/controller/']]) {
    test(`${app} resolves shared tokens from shared/tokens.css`, async ({ page }) => {
      await page.goto(url);
      const bg0 = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--bg-0').trim()
      );
      expect(bg0).toBe('#0D0F14');
    });
  }

  test('Controller overrides --red to brighter value', async ({ page }) => {
    await page.goto('/controller/');
    const red = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--red').trim()
    );
    expect(red).toBe('#E74C3C');
  });

  test('VTT retains VTT-specific tokens', async ({ page }) => {
    await page.goto('/vtt/');
    const vttWidth = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--vtt-width').trim()
    );
    expect(vttWidth).toBe('1920px');
  });
});
