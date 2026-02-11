import { test, expect } from '@playwright/test';

/**
 * Fluid typography: verify root font-size follows the clamp() formula at each viewport.
 *
 * DM Guide:   clamp(0.875rem, 0.7321rem + 0.2232vw, 1rem)  → 14px@1024 … 16px@1920
 * Controller:  clamp(0.8125rem, 0.6696rem + 0.2232vw, 1rem) → 13px@1024 … 15px@1920
 *
 * --ui-scale defaults to 1, so computed font-size should match the clamp output directly.
 */

const BROWSER_REM = 16; // browser default root font-size in px

const fluidApps = [
  {
    name: 'DM Guide',
    url: '/',
    min: 0.875,   // rem
    preferred: { slope: 0.2232, intercept: 0.7321 }, // rem + vw coefficients
    max: 1,       // rem
  },
  {
    name: 'Controller',
    url: '/controller/',
    min: 0.8125,
    preferred: { slope: 0.2232, intercept: 0.6696 },
    max: 0.9375,
  },
];

function expectedFontSize(app, viewportWidth) {
  const preferred = app.preferred.intercept * BROWSER_REM + (app.preferred.slope / 100) * viewportWidth;
  const min = app.min * BROWSER_REM;
  const max = app.max * BROWSER_REM;
  return Math.min(Math.max(preferred, min), max);
}

for (const app of fluidApps) {
  test(`${app.name}: fluid root font-size matches clamp() at viewport width`, async ({ page }) => {
    await page.goto(app.url);
    const viewportWidth = page.viewportSize().width;
    const computed = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).fontSize)
    );
    const expected = expectedFontSize(app, viewportWidth);
    expect(computed).toBeCloseTo(expected, 0); // within 0.5px
  });
}
