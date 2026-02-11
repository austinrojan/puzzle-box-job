import { test, expect } from '@playwright/test';
import { waitForFonts, getGridColumnCount } from './helpers.js';

const breakpoints = [
  { width: 480, columns: 1, label: 'single column at narrow width' },
  { width: 600, columns: 2, label: 'two columns at 500px+' },
  { width: 900, columns: 3, label: 'three columns at 800px+' },
];

for (const { width, columns, label } of breakpoints) {
  test(`Controller: ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/controller/');
    await waitForFonts(page);
    expect(await getGridColumnCount(page, '.control-sections')).toBe(columns);
  });
}
