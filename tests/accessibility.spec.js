import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Pre-existing violations excluded (not Phase 3 regressions):
// - color-contrast: dark theme design decision (--text-muted 3.38:1 ratio)
// - select-name: Controller <select> elements without labels
// - scrollable-region-focusable: DM Guide scrollable panels
const KNOWN_PRE_EXISTING = ['color-contrast', 'select-name', 'scrollable-region-focusable'];

for (const [app, url] of [['DM Guide', '/'], ['Controller', '/controller/'], ['VTT', '/vtt/']]) {
  test(`${app} has no new WCAG 2.1 AA violations`, async ({ page }) => {
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(KNOWN_PRE_EXISTING)
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
