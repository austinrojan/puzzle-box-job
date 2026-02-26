import { test, expect } from '@playwright/test';
import { waitForFonts, getGridColumnCount } from './helpers.js';

const breakpoints = [
  { width: 520, columns: 1, label: 'single column at popup width' },
  { width: 700, columns: 2, label: 'two columns at 600px+' },
  { width: 1100, columns: 3, label: 'three columns at 1000px+' },
];

for (const { width, columns, label } of breakpoints) {
  test(`Controller: ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/controller/');
    await waitForFonts(page);
    expect(await getGridColumnCount(page, '.control-sections')).toBe(columns);
  });
}
