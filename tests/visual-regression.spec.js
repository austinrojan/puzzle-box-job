import { test, expect } from '@playwright/test';
import { waitForFonts, SCREENSHOT_CONFIG } from './helpers.js';

const pages = [
  { name: 'DM Guide', url: '/', file: 'dm-guide.png' },
  { name: 'VTT Display', url: '/vtt/', file: 'vtt-loading.png' },
  { name: 'Controller', url: '/controller/', file: 'controller.png' },
];

for (const { name, url, file } of pages) {
  test(`${name} renders correctly`, async ({ page }) => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await waitForFonts(page);
    await expect(page).toHaveScreenshot(file, SCREENSHOT_CONFIG);
  });
}
