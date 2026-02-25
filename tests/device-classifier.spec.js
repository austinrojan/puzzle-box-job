import { test, expect } from '@playwright/test';

test.describe('WheelDeviceClassifier', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'load' });
    await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      window.__origPerfNow = performance.now;
      window.__newClassifier = () => {
        const c = new WheelDeviceClassifier();
        let mockTime = 1000;
        performance.now = () => mockTime;
        return {
          c,
          advance(ms) { mockTime += ms; },
          classify(evt) { return c.classify(evt); },
          get device() { return c.device; },
          reset() { c.reset(); },
          restore() { performance.now = window.__origPerfNow; },
        };
      };
    });
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      if (window.__origPerfNow) {
        performance.now = window.__origPerfNow;
        delete window.__origPerfNow;
      }
    }).catch(() => {});
  });

  test('rapid small fractional deltas classify as trackpad', async ({ page }) => {
    const result = await page.evaluate(() => {
      const h = __newClassifier();
      const results = [];
      for (let i = 0; i < 5; i++) {
        h.advance(12);
        results.push(h.classify({ deltaX: 0.5, deltaY: 3.5, deltaMode: 0 }));
      }
      h.restore();
      return results;
    });
    for (const d of result) expect(d).toBe('trackpad');
  });

  test('large integer deltas with long gaps classify as mouse', async ({ page }) => {
    const result = await page.evaluate(() => {
      const h = __newClassifier();
      const results = [];
      for (let i = 0; i < 3; i++) {
        h.advance(150);
        results.push(h.classify({ deltaX: 0, deltaY: 120, deltaMode: 0 }));
      }
      h.restore();
      return results;
    });
    expect(result[result.length - 1]).toBe('mouse');
  });

  test('CRITICAL: fast large-delta trackpad events stay trackpad (bug #4 fix)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const h = __newClassifier();
      const results = [];
      for (let i = 0; i < 8; i++) {
        h.advance(12); // Fast trackpad cadence
        results.push(h.classify({ deltaX: 0, deltaY: 80, deltaMode: 0 }));
      }
      h.restore();
      return results;
    });
    // Despite large integer deltas, fast timing keeps it trackpad.
    // This is THE bug fix — old classifier returned 'mouse' for all of these.
    for (const d of result) expect(d).toBe('trackpad');
  });

  test('hysteresis: single ambiguous event does not flip trackpad to mouse', async ({ page }) => {
    const result = await page.evaluate(() => {
      const h = __newClassifier();
      // Establish trackpad with 5 clear events
      for (let i = 0; i < 5; i++) {
        h.advance(12);
        h.classify({ deltaX: 2, deltaY: 5.5, deltaMode: 0 });
      }
      const before = h.device;
      // One ambiguous event (large integer delta, but fast timing)
      h.advance(14);
      const after = h.classify({ deltaX: 0, deltaY: 100, deltaMode: 0 });
      h.restore();
      return { before, after };
    });
    expect(result.before).toBe('trackpad');
    expect(result.after).toBe('trackpad');
  });

  test('silence resets classification, allows device switch', async ({ page }) => {
    const result = await page.evaluate(() => {
      const h = __newClassifier();
      // Establish mouse
      for (let i = 0; i < 3; i++) {
        h.advance(150);
        h.classify({ deltaX: 0, deltaY: 120, deltaMode: 0 });
      }
      const beforeSilence = h.device;
      // 500ms silence (exceeds 400ms threshold)
      h.advance(500);
      // Feed trackpad events
      const afterSilence = [];
      for (let i = 0; i < 3; i++) {
        h.advance(12);
        afterSilence.push(h.classify({ deltaX: 1, deltaY: 3.5, deltaMode: 0 }));
      }
      h.restore();
      return { beforeSilence, afterSilence };
    });
    expect(result.beforeSilence).toBe('mouse');
    expect(result.afterSilence[result.afterSilence.length - 1]).toBe('trackpad');
  });

  test('fractional deltas override large magnitude', async ({ page }) => {
    const result = await page.evaluate(() => {
      const h = __newClassifier();
      const results = [];
      for (let i = 0; i < 5; i++) {
        h.advance(14);
        results.push(h.classify({ deltaX: 0, deltaY: 75.5, deltaMode: 0 }));
      }
      h.restore();
      return results;
    });
    for (const d of result) expect(d).toBe('trackpad');
  });

  test('simultaneous axes classify as trackpad despite large deltas', async ({ page }) => {
    const result = await page.evaluate(() => {
      const h = __newClassifier();
      const results = [];
      for (let i = 0; i < 5; i++) {
        h.advance(14);
        results.push(h.classify({ deltaX: 30, deltaY: 100, deltaMode: 0 }));
      }
      h.restore();
      return results;
    });
    for (const d of result) expect(d).toBe('trackpad');
  });

  test('Firefox deltaMode LINE provides fast mouse classification', async ({ page }) => {
    const result = await page.evaluate(() => {
      const h = __newClassifier();
      // First event after silence has gap zeroed, needs 3 events to accumulate
      h.advance(200);
      h.classify({ deltaX: 0, deltaY: 3, deltaMode: 1 });
      h.advance(150);
      h.classify({ deltaX: 0, deltaY: 3, deltaMode: 1 });
      h.advance(150);
      const third = h.classify({ deltaX: 0, deltaY: 3, deltaMode: 1 });
      h.restore();
      return { third };
    });
    expect(result.third).toBe('mouse');
  });

  test('reset() clears to unknown, device getter returns trackpad', async ({ page }) => {
    const result = await page.evaluate(() => {
      const h = __newClassifier();
      for (let i = 0; i < 3; i++) {
        h.advance(150);
        h.classify({ deltaX: 0, deltaY: 120, deltaMode: 0 });
      }
      const before = h.device;
      h.reset();
      const after = h.device;
      h.restore();
      return { before, after };
    });
    expect(result.before).toBe('mouse');
    expect(result.after).toBe('trackpad');
  });

  test('device getter returns trackpad when no events processed', async ({ page }) => {
    const result = await page.evaluate(() => {
      const h = __newClassifier();
      const device = h.device;
      h.restore();
      return device;
    });
    expect(result).toBe('trackpad');
  });

  test('window slides: old mouse events forgotten after enough trackpad events', async ({ page }) => {
    const result = await page.evaluate(() => {
      const h = __newClassifier();
      // 3 mouse events
      for (let i = 0; i < 3; i++) {
        h.advance(120);
        h.classify({ deltaX: 0, deltaY: 100, deltaMode: 0 });
      }
      const afterMouse = h.device;
      // 8 trackpad events (pushes mouse events out of window size 6)
      for (let i = 0; i < 8; i++) {
        h.advance(12);
        h.classify({ deltaX: 1.5, deltaY: 4.2, deltaMode: 0 });
      }
      const afterTrackpad = h.device;
      h.restore();
      return { afterMouse, afterTrackpad };
    });
    expect(result.afterMouse).toBe('mouse');
    expect(result.afterTrackpad).toBe('trackpad');
  });

  test('asymmetry: mouse→trackpad switch is easier than trackpad→mouse', async ({ page }) => {
    const result = await page.evaluate(() => {
      const h = __newClassifier();
      // Establish mouse
      for (let i = 0; i < 4; i++) {
        h.advance(150);
        h.classify({ deltaX: 0, deltaY: 120, deltaMode: 0 });
      }
      // Count how many trackpad events needed to flip to trackpad
      let trackpadEventsToFlip = 0;
      for (let i = 0; i < 10; i++) {
        h.advance(12);
        const d = h.classify({ deltaX: 1, deltaY: 3.5, deltaMode: 0 });
        trackpadEventsToFlip++;
        if (d === 'trackpad') break;
      }
      // Reset and establish trackpad
      h.reset();
      h.advance(500);
      for (let i = 0; i < 4; i++) {
        h.advance(12);
        h.classify({ deltaX: 1, deltaY: 3.5, deltaMode: 0 });
      }
      // Count how many mouse events needed to flip to mouse
      let mouseEventsToFlip = 0;
      for (let i = 0; i < 10; i++) {
        h.advance(150);
        const d = h.classify({ deltaX: 0, deltaY: 120, deltaMode: 0 });
        mouseEventsToFlip++;
        if (d === 'mouse') break;
      }
      h.restore();
      return { trackpadEventsToFlip, mouseEventsToFlip };
    });
    // Should take fewer events to escape mouse than to enter it
    expect(result.trackpadEventsToFlip).toBeLessThan(result.mouseEventsToFlip);
  });
});
