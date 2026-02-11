import { test, expect } from '@playwright/test';

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
