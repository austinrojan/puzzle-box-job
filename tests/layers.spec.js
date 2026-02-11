import { test, expect } from '@playwright/test';

test.describe('@layer cascade ordering', () => {
  test('VTT: overrides layer beats components layer', async ({ page }) => {
    await page.goto('/vtt/');
    // Presentation mode: body.presentation hides #player-nav via @layer overrides
    await page.evaluate(() => document.body.classList.add('presentation'));
    const display = await page.locator('#player-nav').evaluate(el =>
      getComputedStyle(el).display
    );
    expect(display).toBe('none');
    await page.evaluate(() => document.body.classList.remove('presentation'));
  });

  test('VTT: hidden-for-title disables pointer-events via @layer overrides', async ({ page }) => {
    await page.goto('/vtt/');
    await page.evaluate(() =>
      document.querySelector('.player-nav')?.classList.add('hidden-for-title')
    );
    const pe = await page.locator('.player-nav').evaluate(el =>
      getComputedStyle(el).pointerEvents
    );
    expect(pe).toBe('none');
  });
});
