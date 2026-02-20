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

  test('position safety net clamps sub-pixel overshoot to zero', async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise((resolve) => {
        const cam = __cam();
        // Set very small elastic offset
        cam.elasticOffsetX = 0.7;
        cam.elasticOffsetY = 0;

        // Trigger snap-back with exactly critical velocity.
        // At critical velocity, B should be exactly 0, but float rounding
        // might produce a tiny negative B → sub-pixel overshoot.
        const omega = cam._elasticAnimator._omega;
        cam._snapBackElastic({ vx: -omega * 0.7, vy: 0 });

        // Monitor: elastic offset should never go negative
        let minOffset = Infinity;
        let checks = 0;
        function check() {
          checks++;
          minOffset = Math.min(minOffset, cam.elasticOffsetX);
          if (Math.abs(cam.elasticOffsetX) < 0.01 || checks > 120) {
            resolve({ minOffset, checks });
            return;
          }
          requestAnimationFrame(check);
        }
        requestAnimationFrame(check);
      });
    });
    expect(result.minOffset).toBeGreaterThanOrEqual(-0.01);
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

  test('fast swipe at map edge does not bounce to opposite side', async ({ page }) => {
    // Setup: zoom in and pan to the right boundary.
    // panBy(dx) does x -= dx/zoom, so panBy(-50) increases camera.x (moves right).
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      for (let i = 0; i < 200; i++) cam.panBy(-50, 0);
    });

    const preSwipe = await page.evaluate(() => {
      const cam = __cam();
      return { x: cam.x };
    });

    // Fast right-click drag: mouse moves RIGHT → panBy(-dx) = panBy(-40) per step
    // → camera.x += 40/2 = +20 per step → pushes camera further RIGHT, past boundary.
    // Stay inside container to avoid mouseleave cancel.
    const box = await page.locator('#map-container').boundingBox();
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'right' });
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(startX + i * 40, startY, { steps: 1 });
    }
    await page.mouse.up({ button: 'right' });

    // Wait for coast + snap-back to fully settle
    await page.waitForFunction(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return false;
      return !cam._inertiaRafId
        && Math.abs(cam.elasticOffsetX) < 1.0
        && !cam._elasticAnimator?._rafId;
    }, { timeout: 5000 });

    const postSettle = await page.evaluate(() => {
      const cam = __cam();
      return { x: cam.x, elasticX: cam.elasticOffsetX };
    });

    // Camera should be near the right boundary, NOT on the left side.
    // Legitimate drag movement can shift x by ~60-80px; the bug would
    // send it hundreds/thousands of px to the opposite side.
    expect(Math.abs(postSettle.x - preSwipe.x)).toBeLessThan(100);
    expect(Math.abs(postSettle.elasticX)).toBeLessThan(1.0);
  });
});

// ============================================================
// Coast velocity cap
// ============================================================
test.describe('Coast velocity cap', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('extreme flick velocity is capped in _startInertialCoast', async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise((resolve) => {
        const cam = __cam();
        cam.zoom = 2.0;
        cam._applyConstraints();

        const cap = __capturePanBy(cam);
        cam._startInertialCoast({ x: 6000, y: 0 });

        requestAnimationFrame(() => {
          cam._cancelInertialCoast();
          cam._gestureActive = false;
          // At ~16ms dt, uncapped 6000: |dx| ≈ 96px. Capped to 3000: |dx| ≈ 48px.
          resolve({ wasCapped: cap.first !== null && Math.abs(cap.first.dx) < 80 });
        });
      });
    });
    expect(result.wasCapped).toBe(true);
  });

  test('moderate velocity passes through _startInertialCoast uncapped', async ({ page }) => {
    // Run two coast starts with deterministic timing (mocked rAF + performance.now)
    // and compare first-frame deltas. With identical dt, the ratio of deltas
    // equals the ratio of (possibly capped) velocities.
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();

      const origRAF = window.requestAnimationFrame;
      const origCAF = window.cancelAnimationFrame;
      const origNow = performance.now.bind(performance);
      let mockTime = origNow();
      performance.now = () => mockTime;

      try {
        // Coast 1: extreme velocity (6000 → capped to 3000)
        let tick1;
        window.requestAnimationFrame = (cb) => { tick1 = cb; return 1; };
        window.cancelAnimationFrame = () => {};
        const cap1 = __capturePanBy(cam);
        cam._startInertialCoast({ x: 6000, y: 0 });
        mockTime += 16.67;
        tick1(mockTime);  // deterministic dt = 16.67ms
        cam._cancelInertialCoast();
        cam._gestureActive = false;

        // Coast 2: moderate velocity (1500 → should NOT be capped)
        let tick2;
        window.requestAnimationFrame = (cb) => { tick2 = cb; return 2; };
        const cap2 = __capturePanBy(cam);
        cam._startInertialCoast({ x: 1500, y: 0 });
        mockTime += 16.67;
        tick2(mockTime);  // same deterministic dt = 16.67ms
        cam._cancelInertialCoast();
        cam._gestureActive = false;

        // If cap works: 3000/1500 = 2.0. If both capped: 1.0. If neither: 4.0.
        const ratio = cap1.first && cap2.first
          ? Math.abs(cap1.first.dx / cap2.first.dx)
          : null;
        return { ratio };
      } finally {
        performance.now = origNow;
        window.requestAnimationFrame = origRAF;
        window.cancelAnimationFrame = origCAF;
      }
    });
    // 6000 capped to 3000, 1500 uncapped → ratio = 2.0
    expect(result.ratio).toBeCloseTo(2.0, 1);
  });

  test('coast velocity cap preserves direction (diagonal)', async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise((resolve) => {
        const cam = __cam();
        cam.zoom = 2.0;
        cam._applyConstraints();

        const cap = __capturePanBy(cam);
        // Diagonal: {4000, 3000} → magnitude 5000, capped to 3000
        cam._startInertialCoast({ x: 4000, y: 3000 });

        requestAnimationFrame(() => {
          cam._cancelInertialCoast();
          cam._gestureActive = false;
          // panBy receives -vx*dt, -vy*dt — ratio of |dx/dy| = |vx/vy| = 4/3
          const f = cap.first;
          const ratio = f && f.dy !== 0 ? Math.abs(f.dx / f.dy) : null;
          resolve({ ratio });
        });
      });
    });
    expect(result.ratio).toBeCloseTo(4 / 3, 1);
  });
});
