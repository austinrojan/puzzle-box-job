import { test, expect } from '@playwright/test';

test.describe('Combat panel — wide viewport (inline column)', () => {
  test('combat panel position is NOT fixed at 1440px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    // Open combat panel
    await page.evaluate(() => {
      document.getElementById('app').classList.add('combat-open');
    });
    const position = await page.locator('#combat-panel').evaluate(
      (el) => getComputedStyle(el).position
    );
    expect(position).not.toBe('fixed');
  });
});

test.describe('Combat panel — narrow viewport (drawer)', () => {
  test('combat panel position is fixed at 960px', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 1080 });
    await page.goto('/');
    const position = await page.locator('#combat-panel').evaluate(
      (el) => getComputedStyle(el).position
    );
    expect(position).toBe('fixed');
  });

  test('combat panel has translateX transform when closed', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 1080 });
    await page.goto('/');
    const transform = await page.locator('#combat-panel').evaluate(
      (el) => getComputedStyle(el).transform
    );
    // translateX(100%) computes to a matrix with a positive X translation
    expect(transform).not.toBe('none');
  });

  test('backdrop element exists', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 1080 });
    await page.goto('/');
    await expect(page.locator('#combat-backdrop')).toBeAttached();
  });
});

test.describe('Combat drawer — interaction + a11y (narrow viewport)', () => {
  test('opening combat sets role=dialog and aria-modal=true on panel', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 1080 });
    await page.goto('/');
    await page.keyboard.press('b');
    const panel = page.locator('#combat-panel');
    await expect(panel).toHaveAttribute('role', 'dialog');
    await expect(panel).toHaveAttribute('aria-modal', 'true');
  });

  test('opening combat sets inert on main-content', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 1080 });
    await page.goto('/');
    await page.keyboard.press('b');
    await expect(page.locator('#main-content')).toHaveAttribute('inert', '');
  });

  test('clicking backdrop closes the combat panel', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 1080 });
    await page.goto('/');
    // Open combat
    await page.keyboard.press('b');
    await expect(page.locator('#app')).toHaveClass(/combat-open/);
    // Wait for drawer to slide in
    await page.waitForFunction(() => {
      const panel = document.getElementById('combat-panel');
      const transform = getComputedStyle(panel).transform;
      return transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)';
    }, null, { timeout: 2000 });
    // Click backdrop
    await page.locator('#combat-backdrop').click({ force: true });
    await expect(page.locator('#app')).not.toHaveClass(/combat-open/);
  });

  test('Escape closes combat drawer in overlay mode', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 1080 });
    await page.goto('/');
    await page.keyboard.press('b');
    await expect(page.locator('#app')).toHaveClass(/combat-open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#app')).not.toHaveClass(/combat-open/);
  });

  test('wide viewport: no role/aria-modal on combat panel', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.keyboard.press('b');
    const panel = page.locator('#combat-panel');
    await expect(panel).not.toHaveAttribute('role');
    await expect(panel).not.toHaveAttribute('aria-modal');
  });
});
