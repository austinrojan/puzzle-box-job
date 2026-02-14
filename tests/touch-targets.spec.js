import { test, expect } from '@playwright/test';
import { gotoDMGuide } from './helpers.js';

test.describe('Touch-target floors — DM Guide', () => {
  test('nav-child elements meet 24px minimum height', async ({ page }) => {
    await gotoDMGuide(page);
    const heights = await page.locator('.nav-child').evaluateAll(
      (els) => els.map((el) => el.getBoundingClientRect().height)
    );
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) {
      expect(h).toBeGreaterThanOrEqual(24);
    }
  });

  test('nav-section-header elements meet 24px minimum height', async ({ page }) => {
    await gotoDMGuide(page);
    const heights = await page.locator('.nav-section-header').evaluateAll(
      (els) => els.map((el) => el.getBoundingClientRect().height)
    );
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) {
      expect(h).toBeGreaterThanOrEqual(24);
    }
  });

  test('sidebar-toggle meets 24px minimum dimensions', async ({ page }) => {
    await page.goto('/');
    const rect = await page.locator('#sidebar-toggle').evaluate(
      (el) => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height };
      }
    );
    expect(rect.width).toBeGreaterThanOrEqual(24);
    expect(rect.height).toBeGreaterThanOrEqual(24);
  });
});

test.describe('Touch-target floors — Controller', () => {
  test('visible controller buttons meet 24px minimum height', async ({ page }) => {
    await page.goto('/controller/');
    const heights = await page.locator('button:visible').evaluateAll(
      (els) => els.map((el) => el.getBoundingClientRect().height)
    );
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) {
      expect(h).toBeGreaterThanOrEqual(24);
    }
  });
});
