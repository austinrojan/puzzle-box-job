import { test, expect } from '@playwright/test';

/**
 * Helper: set sidebar state and wait for the grid transition to settle.
 * Uses page.waitForFunction() to poll computed width instead of brittle waitForTimeout.
 */
async function setSidebarAndWait(page, state, { maxWidth = Infinity, minWidth = 0 } = {}) {
  await page.evaluate((s) => {
    if (s) document.getElementById('app').dataset.sidebar = s;
    else delete document.getElementById('app').dataset.sidebar;
  }, state);
  await page.waitForFunction(
    ({ min, max }) => {
      const w = document.getElementById('nav-panel').getBoundingClientRect().width;
      return w >= min && w <= max;
    },
    { min: minWidth, max: maxWidth },
    { timeout: 2000 }
  );
}

test.describe('DM Guide sidebar states', () => {
  test('expanded: nav column uses --nav-width', async ({ page }) => {
    await page.goto('/');
    const navWidth = await page.locator('#nav-panel').evaluate(
      (el) => el.getBoundingClientRect().width
    );
    expect(navWidth).toBeGreaterThan(200);
  });

  test('collapsed: nav column is ~3.5rem', async ({ page }) => {
    await page.goto('/');
    await setSidebarAndWait(page, 'collapsed', { minWidth: 40, maxWidth: 70 });
    const navWidth = await page.locator('#nav-panel').evaluate(
      (el) => el.getBoundingClientRect().width
    );
    expect(navWidth).toBeGreaterThan(40);
    expect(navWidth).toBeLessThan(70);
  });

  test('hidden: nav column is 0px', async ({ page }) => {
    await page.goto('/');
    await setSidebarAndWait(page, 'hidden', { maxWidth: 1 });
    const navWidth = await page.locator('#nav-panel').evaluate(
      (el) => el.getBoundingClientRect().width
    );
    expect(navWidth).toBe(0);
  });

  test('collapsed: text labels have opacity 0', async ({ page }) => {
    await page.goto('/');
    await setSidebarAndWait(page, 'collapsed', { minWidth: 40, maxWidth: 70 });
    const opacity = await page.locator('.nav-label').first().evaluate(
      (el) => getComputedStyle(el).opacity
    );
    expect(opacity).toBe('0');
  });

  test('grid-template-columns transition is defined', async ({ page }) => {
    await page.goto('/');
    const transition = await page.locator('#app').evaluate(
      (el) => getComputedStyle(el).transitionProperty
    );
    expect(transition).toContain('grid-template-columns');
  });
});

test.describe('DM Guide sidebar toggle', () => {
  test('toggle button exists with aria attributes', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('#sidebar-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAttribute('aria-controls', 'nav-panel');
  });

  test('clicking toggle cycles expanded > collapsed > hidden > expanded', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('#sidebar-toggle');
    const app = page.locator('#app');

    await expect(app).not.toHaveAttribute('data-sidebar');
    await toggle.click();
    await expect(app).toHaveAttribute('data-sidebar', 'collapsed');
    await toggle.click();
    await expect(app).toHaveAttribute('data-sidebar', 'hidden');
    await toggle.click();
    await expect(app).not.toHaveAttribute('data-sidebar');
  });

  test('aria-expanded reflects sidebar visibility correctly', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('#sidebar-toggle');

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('aria-label updates per sidebar state', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('#sidebar-toggle');
    const app = page.locator('#app');

    await expect(toggle).toHaveAttribute('aria-label', 'Collapse sidebar');
    await toggle.click();
    await expect(app).toHaveAttribute('data-sidebar', 'collapsed');
    await expect(toggle).toHaveAttribute('aria-label', 'Hide sidebar');
    await toggle.click();
    await expect(app).toHaveAttribute('data-sidebar', 'hidden');
    await expect(toggle).toHaveAttribute('aria-label', 'Show sidebar');
    await toggle.click();
    await expect(app).not.toHaveAttribute('data-sidebar');
    await expect(toggle).toHaveAttribute('aria-label', 'Collapse sidebar');
  });
});
