import { test, expect } from '@playwright/test';

// Helper: wait for web fonts (Inter, Cinzel, Crimson Text) to finish rendering.
// networkidle does NOT guarantee font loading — screenshots with fallback system
// fonts produce false failures.
async function waitForFonts(page) {
  await page.evaluate(() => document.fonts.ready);
}

test.describe('DM Guide', () => {
  test('homepage renders correctly', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForFonts(page);
    await expect(page).toHaveScreenshot('dm-guide.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});

test.describe('VTT Display', () => {
  test('loading screen renders', async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'domcontentloaded' });
    await waitForFonts(page);
    await expect(page).toHaveScreenshot('vtt-loading.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});

test.describe('Controller', () => {
  test('dashboard renders correctly', async ({ page }) => {
    await page.goto('/controller/', { waitUntil: 'domcontentloaded' });
    await waitForFonts(page);
    await expect(page).toHaveScreenshot('controller.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});
