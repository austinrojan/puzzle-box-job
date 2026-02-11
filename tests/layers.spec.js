import { test, expect } from '@playwright/test';
import { getCSSToken } from './helpers.js';

const layerTests = [
  {
    name: 'VTT: overrides layer beats components layer',
    setup: { selector: 'body', addClass: 'presentation' },
    assert: { selector: '#player-nav', property: 'display', expected: 'none' },
    cleanup: { selector: 'body', removeClass: 'presentation' },
  },
  {
    name: 'VTT: hidden-for-title disables pointer-events via @layer overrides',
    setup: { selector: '.player-nav', addClass: 'hidden-for-title' },
    assert: { selector: '.player-nav', property: 'pointerEvents', expected: 'none' },
  },
];

test.describe('@layer cascade ordering', () => {
  for (const { name, setup, assert: a, cleanup } of layerTests) {
    test(name, async ({ page }) => {
      await page.goto('/vtt/');
      await page.evaluate(
        ({ sel, cls }) => document.querySelector(sel)?.classList.add(cls),
        { sel: setup.selector, cls: setup.addClass }
      );
      const value = await page.locator(a.selector).evaluate(
        (el, prop) => getComputedStyle(el)[prop],
        a.property
      );
      expect(value).toBe(a.expected);
      if (cleanup) {
        await page.evaluate(
          ({ sel, cls }) => document.querySelector(sel)?.classList.remove(cls),
          { sel: cleanup.selector, cls: cleanup.removeClass }
        );
      }
    });
  }
});

/*
 * Layer ordering tests for DM Guide and Controller.
 * Injects styles in reversed source order (components before base) and asserts
 * the higher layer still wins — proving shared/tokens.css layer declaration is in effect.
 */
const layerOrderApps = [
  { name: 'DM Guide', url: '/' },
  { name: 'Controller', url: '/controller/' },
];

for (const app of layerOrderApps) {
  test(`${app.name}: layer order from shared tokens is in effect`, async ({ page }) => {
    await page.goto(app.url);
    // Inject conflicting styles in reversed source order
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = `
        @layer components { html { --layer-order-test: components; } }
        @layer base { html { --layer-order-test: base; } }
      `;
      document.head.appendChild(style);
    });
    // components layer is higher priority than base — should win despite source order
    expect(await getCSSToken(page, '--layer-order-test')).toBe('components');
  });
}
