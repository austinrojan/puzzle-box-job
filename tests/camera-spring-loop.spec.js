// @ts-check
import { test, expect } from '@playwright/test';
import { gotoVTT } from './helpers.js';

test.describe('CameraSpringLoop', () => {
  async function loadModules(page) {
    await gotoVTT(page);
    await page.evaluate(() => {
      return Promise.all([
        import('/vtt/js/axis-spring.js'),
        import('/vtt/js/camera-spring-loop.js'),
      ]).then(([axisMod, loopMod]) => {
        window.__AxisSpring = axisMod.AxisSpring;
        window.__CameraSpringLoop = loopMod.CameraSpringLoop;
        window.__SPRING_STIFFNESS = loopMod.SPRING_STIFFNESS;
      });
    });
  }

  function makeMockCamera(page) {
    return page.evaluate(() => {
      window.__mockCam = {
        x: 100, y: 200, zoom: 1.5,
        elasticOffsetX: 0, elasticOffsetY: 0,
        _applyConstraints() {
          // Simple mock: clamp x to [0, 500], y to [0, 500], zoom to [0.5, 3]
          this.x = Math.max(0, Math.min(500, this.x));
          this.y = Math.max(0, Math.min(500, this.y));
          this.zoom = Math.max(0.5, Math.min(3, this.zoom));
        },
      };
    });
  }

  test('ensureRunning() starts the rAF loop', async ({ page }) => {
    await loadModules(page);
    await makeMockCamera(page);
    const result = await page.evaluate(() => {
      const loop = new window.__CameraSpringLoop(window.__mockCam);
      loop.syncFromCamera();
      const wasBefore = loop._running;
      loop.ensureRunning();
      const wasAfter = loop._running;
      loop.stop();
      return { wasBefore, wasAfter };
    });
    expect(result.wasBefore).toBe(false);
    expect(result.wasAfter).toBe(true);
  });

  test('loop auto-stops when all springs are settled', async ({ page }) => {
    await loadModules(page);
    await makeMockCamera(page);
    await page.evaluate(() => {
      const cam = window.__mockCam;
      const loop = new window.__CameraSpringLoop(cam);
      loop.syncFromCamera();
      loop.panX.position = cam.x + 0.1;
      loop.panX.target = cam.x;
      loop.ensureRunning();
      window.__testLoop = loop;
    });
    await page.waitForFunction(() => {
      return window.__testLoop && !window.__testLoop._running;
    }, { timeout: 2000 });
    const result = await page.evaluate(() => ({
      running: window.__testLoop._running,
      settled: window.__testLoop.settled,
    }));
    expect(result.running).toBe(false);
    expect(result.settled).toBe(true);
  });

  test('syncFromCamera() copies camera state into all five springs', async ({ page }) => {
    await loadModules(page);
    await makeMockCamera(page);
    const result = await page.evaluate(() => {
      const cam = window.__mockCam;
      cam.x = 150; cam.y = 250; cam.zoom = 2.0;
      cam.elasticOffsetX = 5; cam.elasticOffsetY = -3;

      const loop = new window.__CameraSpringLoop(cam);
      loop.syncFromCamera();

      return {
        panX: loop.panX.position, panXTarget: loop.panX.target,
        panY: loop.panY.position, panYTarget: loop.panY.target,
        elasticX: loop.elasticX.position, elasticXTarget: loop.elasticX.target,
        elasticY: loop.elasticY.position, elasticYTarget: loop.elasticY.target,
        logZoom: loop.logZoom.position, logZoomTarget: loop.logZoom.target,
        expectedLogZoom: Math.log(2.0),
      };
    });
    expect(result.panX).toBe(150);
    expect(result.panXTarget).toBe(150);
    expect(result.panY).toBe(250);
    expect(result.panYTarget).toBe(250);
    expect(result.elasticX).toBe(5);
    expect(result.elasticXTarget).toBe(0);
    expect(result.elasticY).toBe(-3);
    expect(result.elasticYTarget).toBe(0);
    expect(result.logZoom).toBeCloseTo(result.expectedLogZoom, 10);
    expect(result.logZoomTarget).toBeCloseTo(result.expectedLogZoom, 10);
  });

  test('settled getter reflects all-axis status', async ({ page }) => {
    await loadModules(page);
    await makeMockCamera(page);
    const result = await page.evaluate(() => {
      const cam = window.__mockCam;
      const loop = new window.__CameraSpringLoop(cam);
      loop.syncFromCamera();

      const allSettled = loop.settled;

      // Unsettle one spring
      loop.panX.position = cam.x + 100;
      const oneUnsettled = loop.settled;

      return { allSettled, oneUnsettled };
    });
    expect(result.allSettled).toBe(true);
    expect(result.oneUnsettled).toBe(false);
  });

  test('pan spring writes correct camera x/y after advance', async ({ page }) => {
    await loadModules(page);
    await makeMockCamera(page);
    await page.evaluate(() => {
      const cam = window.__mockCam;
      cam.x = 100; cam.y = 200;
      const loop = new window.__CameraSpringLoop(cam);
      loop.syncFromCamera();
      loop.panX.setTarget(250);
      loop.panY.setTarget(350);
      loop.ensureRunning();
      window.__testLoop = loop;
    });
    await page.waitForFunction(() => {
      return window.__testLoop && window.__testLoop.settled;
    }, { timeout: 5000 });
    const result = await page.evaluate(() => {
      window.__testLoop.stop();
      return { x: window.__mockCam.x, y: window.__mockCam.y };
    });
    // Should have converged toward target (clamped to [0, 500])
    expect(result.x).toBeCloseTo(250, 0);
    expect(result.y).toBeCloseTo(350, 0);
  });

  test('zoom spring writes correct exp(logZoom) to cam.zoom', async ({ page }) => {
    await loadModules(page);
    await makeMockCamera(page);
    await page.evaluate(() => {
      const cam = window.__mockCam;
      cam.zoom = 1.0;
      const loop = new window.__CameraSpringLoop(cam);
      loop.syncFromCamera();
      loop.logZoom.setTarget(Math.log(2.0));
      loop.ensureRunning();
      window.__testLoop = loop;
    });
    await page.waitForFunction(() => {
      return window.__testLoop && window.__testLoop.logZoom.settled;
    }, { timeout: 5000 });
    const result = await page.evaluate(() => {
      window.__testLoop.stop();
      return { zoom: window.__mockCam.zoom };
    });
    expect(result.zoom).toBeCloseTo(2.0, 1);
  });
});
