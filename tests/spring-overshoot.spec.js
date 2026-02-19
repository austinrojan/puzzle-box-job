import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode, injectTestAccessors } from './helpers.js';

// ============================================================
// Velocity clamp: _clampSpringVelocity
// ============================================================
test.describe('Velocity clamp (_clampSpringVelocity)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('zero displacement returns velocity unchanged', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      return {
        pos: cam._clampSpringVelocity(5000, 0, 20),
        neg: cam._clampSpringVelocity(-5000, 0, 20),
        zero: cam._clampSpringVelocity(0, 0, 20)
      };
    });
    expect(result.pos).toBe(5000);
    expect(result.neg).toBe(-5000);
    expect(result.zero).toBe(0);
  });

  test('positive displacement: safe velocity passes through', async ({ page }) => {
    // d=50, omega=20, vCritical = -1000
    // v=-500 is safe (less negative than -1000)
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(-500, 50, 20));
    expect(v).toBe(-500);
  });

  test('positive displacement: dangerous velocity is clamped', async ({ page }) => {
    // d=50, omega=20, vCritical = -1000
    // v=-3000 would overshoot, clamp to -1000
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(-3000, 50, 20));
    expect(v).toBe(-1000);
  });

  test('positive displacement: outward velocity passes through', async ({ page }) => {
    // v=200 moving away from target, no overshoot risk
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(200, 50, 20));
    expect(v).toBe(200);
  });

  test('negative displacement: safe velocity passes through', async ({ page }) => {
    // d=-50, omega=20, vCritical = 1000
    // v=500 is safe
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(500, -50, 20));
    expect(v).toBe(500);
  });

  test('negative displacement: dangerous velocity is clamped', async ({ page }) => {
    // d=-50, omega=20, vCritical = 1000
    // v=3000 would overshoot, clamp to 1000
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(3000, -50, 20));
    expect(v).toBe(1000);
  });

  test('negative displacement: outward velocity passes through', async ({ page }) => {
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(-200, -50, 20));
    expect(v).toBe(-200);
  });

  test('exact critical velocity passes through (boundary case)', async ({ page }) => {
    // v = -omega * d = -1000. max(-1000, -1000) = -1000.
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(-1000, 50, 20));
    expect(v).toBe(-1000);
  });

  test('very small displacement: clamp is proportionally tight', async ({ page }) => {
    // d=1, omega=20, vCritical = -20. Even -25 is clamped to -20.
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(-25, 1, 20));
    expect(v).toBe(-20);
  });

  test('very large displacement: clamp is proportionally loose', async ({ page }) => {
    // d=200, omega=20, vCritical = -4000. -3000 is safe.
    const v = await page.evaluate(() => __cam()._clampSpringVelocity(-3000, 200, 20));
    expect(v).toBe(-3000);
  });
});

// ============================================================
// Spring with clamped velocity: no-overshoot guarantee
// ============================================================
test.describe('Spring no-overshoot guarantee', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('clamped velocity never produces negative position (d > 0)', async ({ page }) => {
    const minPos = await page.evaluate(() => {
      const cam = __cam();
      const omega = cam._elasticAnimator._omega;
      const d = 50;
      const v = cam._clampSpringVelocity(-3000, d, omega);
      const a = cam._elasticAnimator;
      let min = Infinity;
      for (let ms = 0; ms <= 1000; ms++) {
        const { position } = a._solveSpring(d, v, ms / 1000);
        min = Math.min(min, position);
      }
      return min;
    });
    expect(minPos).toBeGreaterThanOrEqual(-0.001);
  });

  test('clamped velocity never produces positive position (d < 0)', async ({ page }) => {
    const maxPos = await page.evaluate(() => {
      const cam = __cam();
      const omega = cam._elasticAnimator._omega;
      const d = -50;
      const v = cam._clampSpringVelocity(3000, d, omega);
      const a = cam._elasticAnimator;
      let max = -Infinity;
      for (let ms = 0; ms <= 1000; ms++) {
        const { position } = a._solveSpring(d, v, ms / 1000);
        max = Math.max(max, position);
      }
      return max;
    });
    expect(maxPos).toBeLessThanOrEqual(0.001);
  });

  test('unclamped velocity DOES produce overshoot (documents Bug #2)', async ({ page }) => {
    const minPos = await page.evaluate(() => {
      const a = __cam()._elasticAnimator;
      let min = Infinity;
      for (let ms = 0; ms <= 1000; ms++) {
        const { position } = a._solveSpring(50, -3000, ms / 1000);
        min = Math.min(min, position);
      }
      return min;
    });
    expect(minPos).toBeLessThan(-1);
  });

  test('spring with zero velocity never overshoots (baseline)', async ({ page }) => {
    const minPos = await page.evaluate(() => {
      const a = __cam()._elasticAnimator;
      let min = Infinity;
      for (let ms = 0; ms <= 1000; ms++) {
        const { position } = a._solveSpring(100, 0, ms / 1000);
        min = Math.min(min, position);
      }
      return min;
    });
    expect(minPos).toBeGreaterThanOrEqual(-0.01);
  });

  test('exact critical velocity produces pure exponential decay', async ({ page }) => {
    const values = await page.evaluate(() => {
      const a = __cam()._elasticAnimator;
      const d = 50;
      const omega = a._omega;
      const v = -omega * d; // -1000 for omega=20
      const results = [];
      for (const t of [0, 0.05, 0.1, 0.2, 0.5]) {
        const { position } = a._solveSpring(d, v, t);
        const expected = d * Math.exp(-omega * t);
        results.push({ t, diff: Math.abs(position - expected) });
      }
      return results;
    });
    for (const r of values) {
      expect(r.diff).toBeLessThan(0.001);
    }
  });

  test('clamped spring settles within 300ms for typical displacement', async ({ page }) => {
    const pos = await page.evaluate(() => {
      const cam = __cam();
      const omega = cam._elasticAnimator._omega;
      const d = 50;
      const v = cam._clampSpringVelocity(-3000, d, omega);
      return Math.abs(cam._elasticAnimator._solveSpring(d, v, 0.3).position);
    });
    expect(pos).toBeLessThan(0.5);
  });
});

// ============================================================
// Integration: elastic offset sign during snap-back
// ============================================================
test.describe('Spring overshoot prevention (Bug #2)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('elastic offset never changes sign during snap-back', async ({ page }) => {
    // Create elastic offset by pushing past boundary
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      for (let i = 0; i < 200; i++) cam.panBy(50, 0);
    });

    // Push past boundary with trackpad-like events
    await page.evaluate(() => {
      const el = document.getElementById('map-container');
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      for (let i = 0; i < 15; i++) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 0, deltaX: -20, deltaMode: 0,
          ctrlKey: false, bubbles: true, cancelable: true,
          clientX: cx, clientY: cy,
        }));
      }
    });

    // Monitor elastic offset sign frame-by-frame during snap-back
    const signChanged = await page.evaluate(() => {
      return new Promise((resolve) => {
        const cam = window.__vtt?.mapRenderer?.camera;
        if (!cam) { resolve(false); return; }
        const initialSign = Math.sign(cam.elasticOffsetX);
        if (initialSign === 0) { resolve(false); return; }
        let changed = false;
        let checks = 0;
        const maxChecks = 300;
        function check() {
          checks++;
          const currentOffset = cam.elasticOffsetX;
          const currentSign = Math.sign(currentOffset);
          if (currentSign !== 0 && currentSign !== initialSign) {
            changed = true;
            resolve(true);
            return;
          }
          if (Math.abs(currentOffset) < 0.5 || checks >= maxChecks) {
            resolve(changed);
            return;
          }
          requestAnimationFrame(check);
        }
        requestAnimationFrame(check);
      });
    });

    expect(signChanged).toBe(false);
  });

  test('snap-back with zero velocity still works correctly', async ({ page }) => {
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      for (let i = 0; i < 200; i++) cam.panBy(50, 0);
    });

    await page.evaluate(() => {
      const el = document.getElementById('map-container');
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      for (let i = 0; i < 10; i++) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 0, deltaX: -15, deltaMode: 0,
          ctrlKey: false, bubbles: true, cancelable: true,
          clientX: cx, clientY: cy,
        }));
      }
    });

    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam && Math.abs(cam.elasticOffsetX) < 0.5;
    }, { timeout: 3000 });

    const offset = await page.evaluate(() => __cam().elasticOffsetX);
    expect(Math.abs(offset)).toBeLessThan(0.5);
  });
});
