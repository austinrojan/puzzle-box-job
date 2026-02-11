import { test, expect } from '@playwright/test';
import { getCSSToken, expectDensityReduces } from './helpers.js';

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
    await expectDensityReduces(page, expect, '.nav-section-header', 'paddingTop');
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
    await expectDensityReduces(page, expect, '.tab', 'paddingRight');
  });

  test('DM Guide: compact reduces heat-bar padding', async ({ page }) => {
    await expectDensityReduces(page, expect, '#heat-bar', 'paddingRight');
  });

  test('DM Guide: compact reduces block-dm-note margin', async ({ page }) => {
    const openAct1 = async (p) => {
      await p.locator('.nav-section-header').first().click();
      await p.locator('.nav-child').first().click();
      await p.waitForSelector('.block-dm-note');
    };
    await expectDensityReduces(page, expect, '.block-dm-note', 'marginTop', openAct1);
  });

  test('DM Guide: compact reduces nav-title padding', async ({ page }) => {
    await expectDensityReduces(page, expect, '.nav-title', 'paddingTop');
  });

  test('DM Guide: compact reduces init-item padding', async ({ page }) => {
    const openCombat = async (p) => {
      await p.keyboard.press('b');
      await p.waitForSelector('.init-item');
    };
    await expectDensityReduces(page, expect, '.init-item', 'paddingTop', openCombat);
  });
});
