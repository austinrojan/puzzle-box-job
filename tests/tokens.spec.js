import { test, expect } from '@playwright/test';
import { getCSSToken } from './helpers.js';

const tokenTests = [
  { name: 'DM Guide resolves shared tokens',  url: '/',            token: '--bg-0',      expected: '#0D0F14' },
  { name: 'Controller resolves shared tokens', url: '/controller/', token: '--bg-0',      expected: '#0D0F14' },
  { name: 'Controller overrides --red',        url: '/controller/', token: '--red',       expected: '#E74C3C' },
  { name: 'VTT retains VTT-specific tokens',   url: '/vtt/',        token: '--vtt-width', expected: '1920px' },
  { name: 'DM Guide retains app-specific --nav-width', url: '/',    token: '--nav-width', expected: '17.5rem' },
  { name: 'DM Guide retains app-specific --combat-width', url: '/', token: '--combat-width', expected: '22.5rem' },
];

for (const { name, url, token, expected } of tokenTests) {
  test(name, async ({ page }) => {
    await page.goto(url);
    expect(await getCSSToken(page, token)).toBe(expected);
  });
}
