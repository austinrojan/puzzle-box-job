import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForFonts, APPS } from './helpers.js';

// Pre-existing violations excluded:
// - color-contrast: dark theme design decision (--text-muted 3.38:1 ratio)
// - select-name: Controller <select> elements without labels
// - scrollable-region-focusable: DM Guide scrollable panels
const KNOWN_PRE_EXISTING = ['color-contrast', 'select-name', 'scrollable-region-focusable'];
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('Accessibility', () => {
  for (const { name, url } of APPS) {
    test(`${name} has no new WCAG 2.1 AA violations`, async ({ page }) => {
      await page.goto(url);
      await waitForFonts(page);
      const { violations } = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .disableRules(KNOWN_PRE_EXISTING)
        .analyze();
      expect(violations).toEqual([]);
    });
  }
});
