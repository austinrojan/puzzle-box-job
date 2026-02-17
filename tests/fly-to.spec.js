import { test, expect } from '@playwright/test';
import { gotoVTT } from './helpers.js';

test.describe('FlyTo path computation — van Wijk & Nuij', () => {

  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
  });

  test('pure zoom (no pan) produces valid path', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeFlyToPath } = await import('/vtt/js/fly-to.js');
      const start = { centerX: 500, centerY: 500, zoom: 1.0 };
      const end = { centerX: 500, centerY: 500, zoom: 2.0 };
      const path = computeFlyToPath(start, end, { screenWidth: 1920 });

      const p0 = path.at(0);
      const p1 = path.at(1);
      return { duration: path.duration, p0, p1 };
    });

    expect(result.duration).toBeGreaterThan(0);
    expect(result.p0.centerX).toBeCloseTo(500);
    expect(result.p0.centerY).toBeCloseTo(500);
    expect(result.p0.zoom).toBeCloseTo(1.0, 1);
    expect(result.p1.centerX).toBeCloseTo(500);
    expect(result.p1.centerY).toBeCloseTo(500);
    expect(result.p1.zoom).toBeCloseTo(2.0, 1);
  });

  test('general case: zoom + pan produces valid endpoints', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeFlyToPath } = await import('/vtt/js/fly-to.js');
      const start = { centerX: 100, centerY: 100, zoom: 1.0 };
      const end = { centerX: 1000, centerY: 800, zoom: 2.0 };
      const path = computeFlyToPath(start, end, { screenWidth: 1920 });

      const p0 = path.at(0);
      const p1 = path.at(1);
      return { duration: path.duration, p0, p1 };
    });

    expect(result.duration).toBeGreaterThan(200);
    expect(result.duration).toBeLessThanOrEqual(5000);
    expect(result.p0.centerX).toBeCloseTo(100, 0);
    expect(result.p0.centerY).toBeCloseTo(100, 0);
    expect(result.p1.centerX).toBeCloseTo(1000, 0);
    expect(result.p1.centerY).toBeCloseTo(800, 0);
  });

  test('identical start and end produces zero duration', async ({ page }) => {
    const duration = await page.evaluate(async () => {
      const { computeFlyToPath } = await import('/vtt/js/fly-to.js');
      const pos = { centerX: 500, centerY: 500, zoom: 1.0 };
      return computeFlyToPath(pos, pos).duration;
    });
    expect(duration).toBe(0);
  });

  test('midpoint of same-zoom path zooms OUT', async ({ page }) => {
    const midZoom = await page.evaluate(async () => {
      const { computeFlyToPath } = await import('/vtt/js/fly-to.js');
      const start = { centerX: 100, centerY: 100, zoom: 2.0 };
      const end = { centerX: 1000, centerY: 100, zoom: 2.0 };
      const path = computeFlyToPath(start, end, { screenWidth: 1920 });
      return path.at(0.5).zoom;
    });
    expect(midZoom).toBeLessThan(2.0);
  });

  test('duration respects minimum bound', async ({ page }) => {
    const duration = await page.evaluate(async () => {
      const { computeFlyToPath } = await import('/vtt/js/fly-to.js');
      return computeFlyToPath(
        { centerX: 100, centerY: 100, zoom: 1.0 },
        { centerX: 101, centerY: 100, zoom: 1.0 },
        { screenWidth: 1920 }
      ).duration;
    });
    expect(duration).toBeGreaterThanOrEqual(200);
  });

  test('duration respects maximum bound', async ({ page }) => {
    const duration = await page.evaluate(async () => {
      const { computeFlyToPath } = await import('/vtt/js/fly-to.js');
      return computeFlyToPath(
        { centerX: 0, centerY: 0, zoom: 0.1 },
        { centerX: 100000, centerY: 100000, zoom: 0.1 },
        { screenWidth: 1920, speed: 0.1 }
      ).duration;
    });
    expect(duration).toBeLessThanOrEqual(5000);
  });

  test('path continuity: no jumps > 10% of total distance', async ({ page }) => {
    const maxJumpRatio = await page.evaluate(async () => {
      const { computeFlyToPath } = await import('/vtt/js/fly-to.js');
      const start = { centerX: 100, centerY: 100, zoom: 1.0 };
      const end = { centerX: 1000, centerY: 800, zoom: 2.0 };
      const path = computeFlyToPath(start, end, { screenWidth: 1920 });

      const totalDx = end.centerX - start.centerX;
      const totalDy = end.centerY - start.centerY;
      const totalDist = Math.sqrt(totalDx * totalDx + totalDy * totalDy);

      let maxJump = 0;
      let prev = path.at(0);
      for (let i = 1; i <= 100; i++) {
        const t = i / 100;
        const cur = path.at(t);
        const dx = cur.centerX - prev.centerX;
        const dy = cur.centerY - prev.centerY;
        const jump = Math.sqrt(dx * dx + dy * dy);
        maxJump = Math.max(maxJump, jump);
        prev = cur;
      }
      return maxJump / totalDist;
    });
    expect(maxJumpRatio).toBeLessThan(0.1);
  });

  test('zoom=0 returns immediate jump to end', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { computeFlyToPath } = await import('/vtt/js/fly-to.js');
      const start = { centerX: 100, centerY: 100, zoom: 0 };
      const end = { centerX: 500, centerY: 500, zoom: 2 };
      const path = computeFlyToPath(start, end, { screenWidth: 1920 });
      return {
        duration: path.duration,
        endPoint: path.at(1),
        isFinite: Number.isFinite(path.duration),
      };
    });
    expect(r.duration).toBe(0);
    expect(r.endPoint.centerX).toBe(500);
    expect(r.endPoint.centerY).toBe(500);
    expect(r.endPoint.zoom).toBe(2);
  });

  test('negative zoom returns immediate jump to end', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { computeFlyToPath } = await import('/vtt/js/fly-to.js');
      const start = { centerX: 0, centerY: 0, zoom: 1 };
      const end = { centerX: 500, centerY: 500, zoom: -1 };
      const path = computeFlyToPath(start, end, { screenWidth: 1920 });
      return { duration: path.duration, endPoint: path.at(0.5) };
    });
    expect(r.duration).toBe(0);
    expect(r.endPoint.centerX).toBe(500);
  });

  test('center position progresses monotonically for same-zoom path', async ({ page }) => {
    const isMonotonic = await page.evaluate(async () => {
      const { computeFlyToPath } = await import('/vtt/js/fly-to.js');
      const start = { centerX: 0, centerY: 0, zoom: 1.0 };
      const end = { centerX: 1000, centerY: 0, zoom: 1.0 };
      const path = computeFlyToPath(start, end, { screenWidth: 1920 });

      let prevX = -Infinity;
      for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        const p = path.at(t);
        if (p.centerX < prevX - 0.01) return false;
        prevX = p.centerX;
      }
      return true;
    });
    expect(isMonotonic).toBe(true);
  });
});
