/**
 * Wait for web fonts (Inter, Cinzel, Crimson Text) to finish loading.
 * domcontentloaded doesn't guarantee font rendering — this does.
 */
export async function waitForFonts(page) {
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Read a CSS custom property from :root (document.documentElement).
 * Returns the trimmed string value.
 */
export async function getCSSToken(page, tokenName) {
  return page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    tokenName
  );
}

/**
 * Count CSS grid columns on a given selector by splitting gridTemplateColumns.
 */
export async function getGridColumnCount(page, selector) {
  return page.locator(selector).evaluate(
    (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length
  );
}

/** Screenshot config shared across all visual regression tests. */
export const SCREENSHOT_CONFIG = {
  maxDiffPixelRatio: 0.02,
  animations: 'disabled',
};

/** App definitions used by multiple test files. */
export const APPS = [
  { name: 'DM Guide', url: '/' },
  { name: 'Controller', url: '/controller/' },
  { name: 'VTT', url: '/vtt/' },
];

/**
 * Assert that compact density reduces a CSS property value on a given selector.
 * Uses localStorage + reload for reliable Chromium custom-property resolution.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').expect} expect
 * @param {string} selector - CSS selector for the element to measure
 * @param {string} property - camelCase CSS property name (e.g. 'paddingRight', 'marginTop')
 * @param {(page: import('@playwright/test').Page) => Promise<void>} [setup] - optional setup before measurement (e.g. navigate to content)
 */
/**
 * Navigate to VTT and wait for the loading screen to hide.
 */
export async function gotoVTT(page) {
  await page.goto('/vtt/');
  await page.waitForFunction(
    () => document.getElementById('loading')?.hidden === true,
    { timeout: 15000 }
  );
}

/**
 * Switch to map mode and wait for the camera to have a loaded map.
 */
export async function enterMapMode(page) {
  await page.evaluate(() => {
    const vtt = window.__vtt;
    if (!vtt) return;
    vtt.EventBus.emit('mode:switch', 'map');
    if (!vtt.state.mapId) vtt.EventBus.emit('map:load', 'M01');
  });
  await page.waitForFunction(() => {
    const cam = window.__vtt?.mapRenderer?.camera;
    return cam && cam.mapW > 0;
  }, { timeout: 10000 });
}

export async function expectDensityReduces(page, expect, selector, property, setup) {
  await page.goto('/');
  if (setup) await setup(page);
  const defaultVal = await page.locator(selector).first().evaluate(
    (el, prop) => parseFloat(getComputedStyle(el)[prop]), property
  );
  await page.evaluate(() => localStorage.setItem('ui-density', 'compact'));
  await page.reload();
  if (setup) await setup(page);
  const compactVal = await page.locator(selector).first().evaluate(
    (el, prop) => parseFloat(getComputedStyle(el)[prop]), property
  );
  expect(compactVal).toBeLessThan(defaultVal);
}
