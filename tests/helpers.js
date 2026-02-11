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
