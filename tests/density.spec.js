import { test, expect } from '@playwright/test';
import { getCSSToken } from './helpers.js';

test.describe('Density token system', () => {
  test('DM Guide: default --density-factor is 1', async ({ page }) => {
    await page.goto('/');
    expect(await getCSSToken(page, '--density-factor')).toBe('1');
  });

  test('DM Guide: compact --density-factor is 0.625', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => document.documentElement.dataset.density = 'compact');
    expect(await getCSSToken(page, '--density-factor')).toBe('0.625');
  });

  test('DM Guide: compact reduces nav-section-header padding', async ({ page }) => {
    // Load default → measure padding
    await page.goto('/');
    const defaultPad = await page.locator('.nav-section-header').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingTop)
    );
    // Set compact density via localStorage and reload so the blocking <head>
    // script applies data-density="compact" before first paint — matching how
    // real users experience density. Avoids Chromium's deferred custom-property
    // recalculation when toggling data attributes dynamically.
    await page.evaluate(() => localStorage.setItem('ui-density', 'compact'));
    await page.reload();
    const compactPad = await page.locator('.nav-section-header').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingTop)
    );
    expect(compactPad).toBeLessThan(defaultPad);
  });

  test('DM Guide: density toggle button exists', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#density-toggle')).toBeVisible();
  });

  test('DM Guide: clicking toggle sets compact, second click restores', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('#density-toggle');
    const html = page.locator('html');

    await expect(html).not.toHaveAttribute('data-density');
    await toggle.click();
    await expect(html).toHaveAttribute('data-density', 'compact');
    await toggle.click();
    await expect(html).not.toHaveAttribute('data-density');
  });

  test('Controller: default --density-factor is 1', async ({ page }) => {
    await page.goto('/controller/');
    expect(await getCSSToken(page, '--density-factor')).toBe('1');
  });

  test('Controller: compact --density-factor is 0.625', async ({ page }) => {
    await page.goto('/controller/');
    await page.evaluate(() => document.documentElement.dataset.density = 'compact');
    expect(await getCSSToken(page, '--density-factor')).toBe('0.625');
  });

  test('DM Guide: compact respects touch-target floor', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => document.documentElement.dataset.density = 'compact');
    const height = await page.locator('.nav-child').first().evaluate(
      (el) => el.getBoundingClientRect().height
    );
    expect(height).toBeGreaterThanOrEqual(24);
  });

  test('DM Guide: compact reduces tab horizontal padding', async ({ page }) => {
    await page.goto('/');
    const defaultPad = await page.locator('.tab').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingRight)
    );
    await page.evaluate(() => localStorage.setItem('ui-density', 'compact'));
    await page.reload();
    const compactPad = await page.locator('.tab').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingRight)
    );
    expect(compactPad).toBeLessThan(defaultPad);
  });

  test('DM Guide: compact reduces heat-bar padding', async ({ page }) => {
    await page.goto('/');
    const defaultPad = await page.locator('#heat-bar').evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingRight)
    );
    await page.evaluate(() => localStorage.setItem('ui-density', 'compact'));
    await page.reload();
    const compactPad = await page.locator('#heat-bar').evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingRight)
    );
    expect(compactPad).toBeLessThan(defaultPad);
  });

  test('DM Guide: compact reduces block-dm-note margin', async ({ page }) => {
    await page.goto('/');
    // Open Act 1 to ensure a dm-note block exists
    await page.locator('.nav-section-header').first().click();
    await page.locator('.nav-child').first().click();
    await page.waitForSelector('.block-dm-note');
    const defaultMargin = await page.locator('.block-dm-note').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).marginTop)
    );
    await page.evaluate(() => localStorage.setItem('ui-density', 'compact'));
    await page.reload();
    await page.locator('.nav-section-header').first().click();
    await page.locator('.nav-child').first().click();
    await page.waitForSelector('.block-dm-note');
    const compactMargin = await page.locator('.block-dm-note').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).marginTop)
    );
    expect(compactMargin).toBeLessThan(defaultMargin);
  });

  test('DM Guide: compact reduces nav-title padding', async ({ page }) => {
    await page.goto('/');
    const defaultPad = await page.locator('.nav-title').evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingTop)
    );
    await page.evaluate(() => localStorage.setItem('ui-density', 'compact'));
    await page.reload();
    const compactPad = await page.locator('.nav-title').evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingTop)
    );
    expect(compactPad).toBeLessThan(defaultPad);
  });

  test('DM Guide: compact reduces init-item padding', async ({ page }) => {
    await page.goto('/');
    // Open combat panel
    await page.keyboard.press('b');
    await page.waitForSelector('.init-item');
    const defaultPad = await page.locator('.init-item').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingTop)
    );
    await page.evaluate(() => localStorage.setItem('ui-density', 'compact'));
    await page.reload();
    await page.keyboard.press('b');
    await page.waitForSelector('.init-item');
    const compactPad = await page.locator('.init-item').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingTop)
    );
    expect(compactPad).toBeLessThan(defaultPad);
  });
});
