// @ts-check
import { test, expect } from '@playwright/test';
import { gotoVTT } from './helpers.js';

test.describe('AxisSpring', () => {
  /** @param {import('@playwright/test').Page} page */
  async function loadSpring(page) {
    await gotoVTT(page);
    return page.evaluate(() => {
      // Dynamic import the module so we can test it in the browser
      return import('/vtt/js/axis-spring.js').then(mod => {
        window.__AxisSpring = mod.AxisSpring;
        return true;
      });
    });
  }

  test('critically damped spring converges to target', async ({ page }) => {
    await loadSpring(page);
    const result = await page.evaluate(() => {
      const s = new window.__AxisSpring({ stiffness: 200 });
      s.position = 100;
      s.target = 0;
      s.velocity = 0;

      const dt = 1 / 60;
      for (let i = 0; i < 300; i++) {
        if (s.advance(dt)) break;
      }
      return { position: s.position, velocity: s.velocity, settled: s.settled };
    });
    expect(result.position).toBe(0);
    expect(result.velocity).toBe(0);
    expect(result.settled).toBe(true);
  });

  test('no overshoot with zero initial velocity', async ({ page }) => {
    await loadSpring(page);
    const result = await page.evaluate(() => {
      const s = new window.__AxisSpring({ stiffness: 200 });
      s.position = 50;
      s.target = 0;
      s.velocity = 0;

      const dt = 1 / 60;
      const positions = [];
      for (let i = 0; i < 300; i++) {
        positions.push(s.position);
        if (s.advance(dt)) break;
      }
      // All positions should be >= 0 (no overshoot past target)
      const minPos = Math.min(...positions);
      return { minPos, final: s.position };
    });
    // With zero initial velocity, displacement should decay monotonically
    expect(result.minPos).toBeGreaterThanOrEqual(0);
    expect(result.final).toBe(0);
  });

  test('setTarget preserves velocity (C1-continuous)', async ({ page }) => {
    await loadSpring(page);
    const result = await page.evaluate(() => {
      const s = new window.__AxisSpring({ stiffness: 200 });
      s.position = 100;
      s.target = 0;
      s.velocity = -50;

      // Advance a few frames
      for (let i = 0; i < 10; i++) s.advance(1 / 60);
      const velBefore = s.velocity;
      const posBefore = s.position;

      // Change target — velocity should be preserved
      s.setTarget(200);
      return {
        velBefore,
        velAfter: s.velocity,
        posBefore,
        posAfter: s.position,
      };
    });
    expect(result.velAfter).toBe(result.velBefore);
    expect(result.posAfter).toBe(result.posBefore);
  });

  test('position is frame-rate independent (60fps vs 30fps within 0.01)', async ({ page }) => {
    await loadSpring(page);
    const result = await page.evaluate(() => {
      function simulate(stiffness, initialPos, fps, totalTime) {
        const s = new window.__AxisSpring({ stiffness });
        s.position = initialPos;
        s.target = 0;
        s.velocity = -30;
        const dt = 1 / fps;
        const steps = Math.floor(totalTime * fps);
        for (let i = 0; i < steps; i++) s.advance(dt);
        return s.position;
      }

      const pos60 = simulate(200, 100, 60, 0.5);
      const pos30 = simulate(200, 100, 30, 0.5);
      return { pos60, pos30, diff: Math.abs(pos60 - pos30) };
    });
    expect(result.diff).toBeLessThan(0.01);
  });

  test('settlement snaps position exactly to target', async ({ page }) => {
    await loadSpring(page);
    const result = await page.evaluate(() => {
      const s = new window.__AxisSpring({ stiffness: 200 });
      s.position = 10;
      s.target = 42;
      s.velocity = 0;

      const dt = 1 / 60;
      for (let i = 0; i < 600; i++) {
        if (s.advance(dt)) break;
      }
      // Strict equality, not approximate
      return { position: s.position, target: s.target, exact: s.position === s.target };
    });
    expect(result.exact).toBe(true);
    expect(result.position).toBe(42);
  });

  test('setStiffness preserves position and velocity', async ({ page }) => {
    await loadSpring(page);
    const result = await page.evaluate(() => {
      const s = new window.__AxisSpring({ stiffness: 200 });
      s.position = 50;
      s.velocity = -100;

      // Advance a few frames at stiffness 200
      for (let i = 0; i < 5; i++) s.advance(1 / 60);
      const posBefore = s.position;
      const velBefore = s.velocity;

      // Change stiffness
      s.setStiffness(400);

      return {
        posBefore, posAfter: s.position,
        velBefore, velAfter: s.velocity,
        omegaChanged: s._omega === Math.sqrt(400),
      };
    });
    expect(result.posAfter).toBe(result.posBefore);
    expect(result.velAfter).toBe(result.velBefore);
    expect(result.omegaChanged).toBe(true);
  });

  test('log-space zoom has uniform step feel (1x→2x same frames as 2x→4x)', async ({ page }) => {
    await loadSpring(page);
    const result = await page.evaluate(() => {
      function countFrames(startLog, targetLog) {
        const s = new window.__AxisSpring({
          stiffness: 300,
          positionThreshold: 0.001,
          velocityThreshold: 0.001,
        });
        s.position = startLog;
        s.target = targetLog;
        s.velocity = 0;

        const dt = 1 / 60;
        let frames = 0;
        for (let i = 0; i < 600; i++) {
          frames++;
          if (s.advance(dt)) break;
        }
        return frames;
      }

      // 1x → 2x in log-space: log(1)=0 → log(2)=0.693
      const frames1to2 = countFrames(Math.log(1), Math.log(2));
      // 2x → 4x in log-space: log(2)=0.693 → log(4)=1.386
      const frames2to4 = countFrames(Math.log(2), Math.log(4));

      return { frames1to2, frames2to4, equal: frames1to2 === frames2to4 };
    });
    // Same log-space distance → same number of frames
    expect(result.equal).toBe(true);
  });
});
