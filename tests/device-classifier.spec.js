import { test, expect } from '@playwright/test';

test.describe('WheelDeviceClassifier', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'load' });
  });

  test('rapid small fractional deltas classify as trackpad', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const c = new WheelDeviceClassifier();
      let mockTime = 1000;
      const orig = performance.now;
      performance.now = () => mockTime;
      const results = [];
      for (let i = 0; i < 5; i++) {
        mockTime += 12;
        results.push(c.classify({ deltaX: 0.5, deltaY: 3.5, deltaMode: 0 }));
      }
      performance.now = orig;
      return results;
    });
    for (const d of result) expect(d).toBe('trackpad');
  });

  test('large integer deltas with long gaps classify as mouse', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const c = new WheelDeviceClassifier();
      let mockTime = 1000;
      const orig = performance.now;
      performance.now = () => mockTime;
      const results = [];
      for (let i = 0; i < 3; i++) {
        mockTime += 150;
        results.push(c.classify({ deltaX: 0, deltaY: 120, deltaMode: 0 }));
      }
      performance.now = orig;
      return results;
    });
    expect(result[result.length - 1]).toBe('mouse');
  });

  test('CRITICAL: fast large-delta trackpad events stay trackpad (bug #4 fix)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const c = new WheelDeviceClassifier();
      let mockTime = 1000;
      const orig = performance.now;
      performance.now = () => mockTime;
      const results = [];
      for (let i = 0; i < 8; i++) {
        mockTime += 12; // Fast trackpad cadence
        results.push(c.classify({ deltaX: 0, deltaY: 80, deltaMode: 0 }));
      }
      performance.now = orig;
      return results;
    });
    // Despite large integer deltas, fast timing keeps it trackpad.
    // This is THE bug fix — old classifier returned 'mouse' for all of these.
    for (const d of result) expect(d).toBe('trackpad');
  });

  test('hysteresis: single ambiguous event does not flip trackpad to mouse', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const c = new WheelDeviceClassifier();
      let mockTime = 1000;
      const orig = performance.now;
      performance.now = () => mockTime;
      // Establish trackpad with 5 clear events
      for (let i = 0; i < 5; i++) {
        mockTime += 12;
        c.classify({ deltaX: 2, deltaY: 5.5, deltaMode: 0 });
      }
      const before = c.device;
      // One ambiguous event (large integer delta, but fast timing)
      mockTime += 14;
      const after = c.classify({ deltaX: 0, deltaY: 100, deltaMode: 0 });
      performance.now = orig;
      return { before, after };
    });
    expect(result.before).toBe('trackpad');
    expect(result.after).toBe('trackpad');
  });

  test('silence resets classification, allows device switch', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const c = new WheelDeviceClassifier();
      let mockTime = 1000;
      const orig = performance.now;
      performance.now = () => mockTime;
      // Establish mouse
      for (let i = 0; i < 3; i++) {
        mockTime += 150;
        c.classify({ deltaX: 0, deltaY: 120, deltaMode: 0 });
      }
      const beforeSilence = c.device;
      // 500ms silence (exceeds 400ms threshold)
      mockTime += 500;
      // Feed trackpad events
      const afterSilence = [];
      for (let i = 0; i < 3; i++) {
        mockTime += 12;
        afterSilence.push(c.classify({ deltaX: 1, deltaY: 3.5, deltaMode: 0 }));
      }
      performance.now = orig;
      return { beforeSilence, afterSilence };
    });
    expect(result.beforeSilence).toBe('mouse');
    expect(result.afterSilence[result.afterSilence.length - 1]).toBe('trackpad');
  });

  test('fractional deltas override large magnitude', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const c = new WheelDeviceClassifier();
      let mockTime = 1000;
      const orig = performance.now;
      performance.now = () => mockTime;
      const results = [];
      for (let i = 0; i < 5; i++) {
        mockTime += 14;
        results.push(c.classify({ deltaX: 0, deltaY: 75.5, deltaMode: 0 }));
      }
      performance.now = orig;
      return results;
    });
    for (const d of result) expect(d).toBe('trackpad');
  });

  test('simultaneous axes classify as trackpad despite large deltas', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const c = new WheelDeviceClassifier();
      let mockTime = 1000;
      const orig = performance.now;
      performance.now = () => mockTime;
      const results = [];
      for (let i = 0; i < 5; i++) {
        mockTime += 14;
        results.push(c.classify({ deltaX: 30, deltaY: 100, deltaMode: 0 }));
      }
      performance.now = orig;
      return results;
    });
    for (const d of result) expect(d).toBe('trackpad');
  });

  test('Firefox deltaMode LINE provides fast mouse classification', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const c = new WheelDeviceClassifier();
      let mockTime = 1000;
      const orig = performance.now;
      performance.now = () => mockTime;
      // First event after silence has gap zeroed, needs 3 events to accumulate
      mockTime += 200;
      c.classify({ deltaX: 0, deltaY: 3, deltaMode: 1 });
      mockTime += 150;
      c.classify({ deltaX: 0, deltaY: 3, deltaMode: 1 });
      mockTime += 150;
      const third = c.classify({ deltaX: 0, deltaY: 3, deltaMode: 1 });
      performance.now = orig;
      return { third };
    });
    expect(result.third).toBe('mouse');
  });

  test('reset() clears to unknown, device getter returns trackpad', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const c = new WheelDeviceClassifier();
      let mockTime = 1000;
      const orig = performance.now;
      performance.now = () => mockTime;
      for (let i = 0; i < 3; i++) {
        mockTime += 150;
        c.classify({ deltaX: 0, deltaY: 120, deltaMode: 0 });
      }
      const before = c.device;
      c.reset();
      const after = c.device;
      performance.now = orig;
      return { before, after };
    });
    expect(result.before).toBe('mouse');
    expect(result.after).toBe('trackpad');
  });

  test('device getter returns trackpad when no events processed', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      return new WheelDeviceClassifier().device;
    });
    expect(result).toBe('trackpad');
  });

  test('window slides: old mouse events forgotten after enough trackpad events', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const c = new WheelDeviceClassifier();
      let mockTime = 1000;
      const orig = performance.now;
      performance.now = () => mockTime;
      // 3 mouse events
      for (let i = 0; i < 3; i++) {
        mockTime += 120;
        c.classify({ deltaX: 0, deltaY: 100, deltaMode: 0 });
      }
      const afterMouse = c.device;
      // 8 trackpad events (pushes mouse events out of window size 6)
      for (let i = 0; i < 8; i++) {
        mockTime += 12;
        c.classify({ deltaX: 1.5, deltaY: 4.2, deltaMode: 0 });
      }
      const afterTrackpad = c.device;
      performance.now = orig;
      return { afterMouse, afterTrackpad };
    });
    expect(result.afterMouse).toBe('mouse');
    expect(result.afterTrackpad).toBe('trackpad');
  });

  test('asymmetry: mouse→trackpad switch is easier than trackpad→mouse', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const c = new WheelDeviceClassifier();
      let mockTime = 1000;
      const orig = performance.now;
      performance.now = () => mockTime;
      // Establish mouse
      for (let i = 0; i < 4; i++) {
        mockTime += 150;
        c.classify({ deltaX: 0, deltaY: 120, deltaMode: 0 });
      }
      // Count how many trackpad events needed to flip to trackpad
      let trackpadEventsToFlip = 0;
      for (let i = 0; i < 10; i++) {
        mockTime += 12;
        const d = c.classify({ deltaX: 1, deltaY: 3.5, deltaMode: 0 });
        trackpadEventsToFlip++;
        if (d === 'trackpad') break;
      }
      // Reset and establish trackpad
      c.reset();
      mockTime += 500;
      for (let i = 0; i < 4; i++) {
        mockTime += 12;
        c.classify({ deltaX: 1, deltaY: 3.5, deltaMode: 0 });
      }
      // Count how many mouse events needed to flip to mouse
      let mouseEventsToFlip = 0;
      for (let i = 0; i < 10; i++) {
        mockTime += 150;
        const d = c.classify({ deltaX: 0, deltaY: 120, deltaMode: 0 });
        mouseEventsToFlip++;
        if (d === 'mouse') break;
      }
      performance.now = orig;
      return { trackpadEventsToFlip, mouseEventsToFlip };
    });
    // Should take fewer events to escape mouse than to enter it
    expect(result.trackpadEventsToFlip).toBeLessThanOrEqual(result.mouseEventsToFlip);
  });
});
