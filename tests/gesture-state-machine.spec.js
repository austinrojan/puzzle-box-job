import { test, expect } from '@playwright/test';
import { setupMapCamera } from './helpers.js';

test.describe('Gesture coordination', () => {
  test.beforeEach(async ({ page }) => {
    await setupMapCamera(page);
  });

  test.describe('logicalScreenToWorld', () => {
    test('ignores elastic offset', async ({ page }) => {
      const result = await page.evaluate(() => {
        const cam = __cam();
        cam.zoom = 2.0; cam.x = 100; cam.y = 100;
        cam.elasticOffsetX = 30; cam.elasticOffsetY = -20;
        const logical = cam.logicalScreenToWorld(0, 0);
        return { x: logical.x, y: logical.y };
      });
      // 0/2 + 100 = 100 (NOT 0/2 + 130 = 130)
      expect(result.x).toBeCloseTo(100, 5);
      expect(result.y).toBeCloseTo(100, 5);
    });

    test('matches screenToWorld when no elastic offset', async ({ page }) => {
      const result = await page.evaluate(() => {
        const cam = __cam();
        cam.zoom = 1.5; cam.x = 200; cam.y = 150;
        cam.elasticOffsetX = 0; cam.elasticOffsetY = 0;
        const v = cam.screenToWorld(300, 200);
        const l = cam.logicalScreenToWorld(300, 200);
        return { matchX: Math.abs(v.x - l.x) < 0.001, matchY: Math.abs(v.y - l.y) < 0.001 };
      });
      expect(result.matchX).toBe(true);
      expect(result.matchY).toBe(true);
    });

    test('at non-origin screen coords', async ({ page }) => {
      const result = await page.evaluate(() => {
        const cam = __cam();
        cam.zoom = 2.0; cam.x = 50; cam.y = 50;
        cam.elasticOffsetX = 10; cam.elasticOffsetY = 10;
        return cam.logicalScreenToWorld(400, 300);
      });
      expect(result.x).toBeCloseTo(250, 5);  // 400/2 + 50
      expect(result.y).toBeCloseTo(200, 5);  // 300/2 + 50
    });
  });

  test.describe('zoomAt coordinate decontamination', () => {
    test('zoomAt does not shift camera by elastic offset amount', async ({ page }) => {
      const result = await page.evaluate(() => {
        const cam = __cam();
        cam.zoom = 2.0; cam.mapW = 3840; cam.mapH = 2160;
        cam._updateCoverZoom();
        cam.x = (cam.mapW - cam.viewportW / cam.zoom) / 2;
        cam.y = (cam.mapH - cam.viewportH / cam.zoom) / 2;
        cam.elasticOffsetX = 50; cam.elasticOffsetY = 30;
        const xBefore = cam.x;
        cam.zoomAt(cam.viewportW / 2, cam.viewportH / 2, 0.1);
        return Math.abs(cam.x - xBefore);
      });
      expect(result).toBeLessThan(40);
    });
  });

  test.describe('Smooth zoom anchor decontamination', () => {
    test('_smoothZoomTo anchor uses logical position, not visual', async ({ page }) => {
      const result = await page.evaluate(() => {
        const cam = __cam();
        cam.zoom = 2.0; cam.x = 500; cam.y = 300;
        cam.elasticOffsetX = 40; cam.elasticOffsetY = 25;
        cam._smoothZoomTo(-1.0, 960, 540);
        return {
          wx: cam._zoomAnchor.wx,
          expectedWx: 960 / cam.zoom + cam.x,
          wy: cam._zoomAnchor.wy,
          expectedWy: 540 / cam.zoom + cam.y,
        };
      });
      expect(result.wx).toBeCloseTo(result.expectedWx, 3);
      expect(result.wy).toBeCloseTo(result.expectedWy, 3);
    });
  });

  // ============================================================
  // GestureStateMachine Rules
  // ============================================================

  // --- Rule 1: Same gesture retarget ---
  test.describe('GSM Rule 1: same gesture retarget', () => {
    test('same gesture retarget always succeeds', async ({ page }) => {
      const r = await page.evaluate(() => {
        const g = __cam()._gestures;
        g.request('SCROLL_PAN');
        return { r1: g.request('SCROLL_PAN'), r2: g.request('SCROLL_PAN'), c: g.current };
      });
      expect(r.r1).toBe(true); expect(r.r2).toBe(true); expect(r.c).toBe('SCROLL_PAN');
    });

    test('same animation retarget always succeeds', async ({ page }) => {
      const r = await page.evaluate(() => {
        const g = __cam()._gestures;
        g.request('ZOOM_ANIMATE');
        return { r: g.request('ZOOM_ANIMATE'), c: g.current };
      });
      expect(r.r).toBe(true); expect(r.c).toBe('ZOOM_ANIMATE');
    });
  });

  // --- Rule 2: User preempts animation ---
  test.describe('GSM Rule 2: user preempts animation', () => {
    const rule2Cases = [
      ['ZOOM_ANIMATE', 'SCROLL_PAN'],
      ['INERTIA', 'DRAG_PAN'],
      ['SNAP_BACK', 'PINCH_ZOOM'],
      ['INERTIA', 'SCROLL_PAN'],
    ];

    for (const [animation, user] of rule2Cases) {
      test(`${user} preempts ${animation}`, async ({ page }) => {
        const r = await page.evaluate(([anim, usr]) => {
          const g = __cam()._gestures;
          g.request(anim);
          return { granted: g.request(usr), current: g.current };
        }, [animation, user]);
        expect(r.granted).toBe(true);
        expect(r.current).toBe(user);
      });
    }
  });

  // --- Rule 3: User replaces user (dwell time) ---
  test.describe('GSM Rule 3: dwell time', () => {
    test('higher priority user gesture preempts immediately (no dwell)', async ({ page }) => {
      const r = await page.evaluate(() => {
        const g = __cam()._gestures;
        g.request('SCROLL_PAN');
        return { granted: g.request('PINCH_ZOOM'), c: g.current };
      });
      expect(r.granted).toBe(true); expect(r.c).toBe('PINCH_ZOOM');
    });

    test('DRAG_PAN preempts SCROLL_PAN immediately', async ({ page }) => {
      const r = await page.evaluate(() => {
        const g = __cam()._gestures;
        g.request('SCROLL_PAN');
        return { granted: g.request('DRAG_PAN'), c: g.current };
      });
      expect(r.granted).toBe(true); expect(r.c).toBe('DRAG_PAN');
    });

    test('lower priority user gesture denied regardless of dwell', async ({ page }) => {
      const r = await page.evaluate(async () => {
        const g = __cam()._gestures;
        g.request('PINCH_ZOOM');
        await new Promise(r => setTimeout(r, 120));
        return { granted: g.request('SCROLL_PAN'), c: g.current };
      });
      expect(r.granted).toBe(false); expect(r.c).toBe('PINCH_ZOOM');
    });

    test('lower priority denied during dwell, higher still accepted', async ({ page }) => {
      const r = await page.evaluate(() => {
        const g = __cam()._gestures;
        const orig = performance.now.bind(performance);
        let t = orig();
        performance.now = () => t;
        try {
          g.request('PINCH_ZOOM');
          t += 30;
          const higher = g.request('DRAG_PAN');   // 6 > 5: instant
          g.request('DRAG_PAN');
          t += 30;
          const lower = g.request('SCROLL_PAN');  // 4 < 6: denied
          return { higher, lower };
        } finally { performance.now = orig; }
      });
      expect(r.higher).toBe(true);
      expect(r.lower).toBe(false);
    });

    test('animation cannot preempt user gesture', async ({ page }) => {
      const r = await page.evaluate(() => {
        const g = __cam()._gestures;
        g.request('SCROLL_PAN');
        return { granted: g.request('ZOOM_ANIMATE'), c: g.current };
      });
      expect(r.granted).toBe(false); expect(r.c).toBe('SCROLL_PAN');
    });
  });

  // --- Rule 4: Cooldown ---
  test.describe('GSM Rule 4: cooldown', () => {
    test('different user gesture blocked during cooldown', async ({ page }) => {
      const r = await page.evaluate(() => {
        const g = __cam()._gestures;
        g.request('SCROLL_PAN');
        g.release('SCROLL_PAN');
        return { granted: g.request('PINCH_ZOOM'), c: g.current };
      });
      expect(r.granted).toBe(false); expect(r.c).toBe('IDLE');
    });

    test('same gesture type restarts through cooldown', async ({ page }) => {
      const r = await page.evaluate(() => {
        const g = __cam()._gestures;
        g.request('SCROLL_PAN');
        g.release('SCROLL_PAN');
        return { granted: g.request('SCROLL_PAN'), c: g.current };
      });
      expect(r.granted).toBe(true); expect(r.c).toBe('SCROLL_PAN');
    });

    test('cooldown expires and allows different type', async ({ page }) => {
      const r = await page.evaluate(async () => {
        const g = __cam()._gestures;
        g.request('SCROLL_PAN');
        g.release('SCROLL_PAN');
        await new Promise(r => setTimeout(r, 70));
        return { granted: g.request('ZOOM_ANIMATE'), c: g.current };
      });
      expect(r.granted).toBe(true); expect(r.c).toBe('ZOOM_ANIMATE');
    });

    test('animation ending does NOT block user gesture (tier-aware)', async ({ page }) => {
      const r = await page.evaluate(() => {
        const g = __cam()._gestures;
        g.request('SNAP_BACK');
        g.release('SNAP_BACK');
        return { granted: g.request('SCROLL_PAN'), c: g.current };
      });
      expect(r.granted).toBe(true); expect(r.c).toBe('SCROLL_PAN');
    });

    test('user ending does NOT block animation (tier-aware)', async ({ page }) => {
      const r = await page.evaluate(() => {
        const g = __cam()._gestures;
        g.request('SCROLL_PAN');
        g.release('SCROLL_PAN');
        return { granted: g.request('SNAP_BACK'), c: g.current };
      });
      expect(r.granted).toBe(true); expect(r.c).toBe('SNAP_BACK');
    });

    test('different animation blocked during animation cooldown', async ({ page }) => {
      const r = await page.evaluate(() => {
        const g = __cam()._gestures;
        g.request('INERTIA');
        g.release('INERTIA');
        return { granted: g.request('ZOOM_ANIMATE'), c: g.current };
      });
      expect(r.granted).toBe(false); expect(r.c).toBe('IDLE');
    });

    test('exact 50ms boundary via mocked time', async ({ page }) => {
      const r = await page.evaluate(() => {
        const g = __cam()._gestures;
        const orig = performance.now.bind(performance);
        let t = orig();
        performance.now = () => t;
        try {
          g.request('SCROLL_PAN');
          g.release('SCROLL_PAN');
          t += 49;
          const at49 = g.request('PINCH_ZOOM');
          t += 2;
          const at51 = g.request('PINCH_ZOOM');
          return { at49, at51 };
        } finally { performance.now = orig; }
      });
      expect(r.at49).toBe(false);
      expect(r.at51).toBe(true);
    });
  });

  // --- Rule 5: Animation tier ---
  test.describe('GSM Rule 5: animation tier', () => {
    const rule5Cases = [
      ['INERTIA', 'ZOOM_ANIMATE', true],
      ['ZOOM_ANIMATE', 'INERTIA', false],
      ['ZOOM_ANIMATE', 'SNAP_BACK', false],
      ['SNAP_BACK', 'ZOOM_ANIMATE', true],
    ];

    for (const [current, incoming, shouldGrant] of rule5Cases) {
      const label = shouldGrant
        ? `${incoming} replaces ${current}`
        : `${incoming} denied while ${current} active`;
      test(label, async ({ page }) => {
        const r = await page.evaluate(([cur, inc]) => {
          const g = __cam()._gestures;
          g.request(cur);
          return { granted: g.request(inc), current: g.current };
        }, [current, incoming]);
        expect(r.granted).toBe(shouldGrant);
        expect(r.current).toBe(shouldGrant ? incoming : current);
      });
    }
  });

  // --- Release semantics ---
  test.describe('GSM release semantics', () => {
    test('release transitions to IDLE', async ({ page }) => {
      const c = await page.evaluate(() => {
        const g = __cam()._gestures;
        g.request('SCROLL_PAN');
        g.release('SCROLL_PAN');
        return g.current;
      });
      expect(c).toBe('IDLE');
    });

    test('stale release is ignored', async ({ page }) => {
      const c = await page.evaluate(() => {
        const g = __cam()._gestures;
        g.request('SCROLL_PAN');
        g.request('DRAG_PAN');
        g.release('SCROLL_PAN');
        return g.current;
      });
      expect(c).toBe('DRAG_PAN');
    });

    test('release records last ended gesture', async ({ page }) => {
      const r = await page.evaluate(() => {
        const g = __cam()._gestures;
        g.request('SCROLL_PAN');
        g.release('SCROLL_PAN');
        return { last: g._lastEndedGesture, hasTime: g._lastGestureEndTime > 0 };
      });
      expect(r.last).toBe('SCROLL_PAN');
      expect(r.hasTime).toBe(true);
    });
  });

  test.describe('GSM _cancelCurrent integration', () => {
    test('cancelling SNAP_BACK calls _cancelSnapBack', async ({ page }) => {
      const r = await page.evaluate(() => {
        const cam = __cam();
        let called = false;
        const orig = cam._cancelSnapBack.bind(cam);
        cam._cancelSnapBack = () => { called = true; orig(); };
        cam._gestures.request('SNAP_BACK');
        cam._gestures.request('SCROLL_PAN');
        return called;
      });
      expect(r).toBe(true);
    });

    test('cancelling ZOOM_ANIMATE settles the logZoom spring', async ({ page }) => {
      const r = await page.evaluate(() => {
        const cam = __cam();
        cam._smoothZoomTo(-1.0, 500, 500); // Start zoom animation
        cam._gestures.request('ZOOM_ANIMATE');
        const wasUnsettled = !cam._springLoop.logZoom.settled;
        cam._gestures.request('DRAG_PAN'); // Preempts, should cancel zoom
        const isSettled = cam._springLoop.logZoom.settled;
        return { wasUnsettled, isSettled };
      });
      expect(r.wasUnsettled).toBe(true);
      expect(r.isSettled).toBe(true);
    });

    test('cancelling INERTIA calls _cancelInertialCoast', async ({ page }) => {
      const r = await page.evaluate(() => {
        const cam = __cam();
        let called = false;
        const orig = cam._cancelInertialCoast.bind(cam);
        cam._cancelInertialCoast = () => { called = true; orig(); };
        cam._gestures.request('INERTIA');
        cam._gestures.request('SCROLL_PAN');
        return called;
      });
      expect(r).toBe(true);
    });
  });

  test.describe('Wheel handler request gating', () => {
    test('mouse wheel zoom denied during SCROLL_PAN does not change zoom', async ({ page }) => {
      const r = await page.evaluate(() => {
        const cam = __cam();
        cam.zoom = 2.0; cam._applyConstraints();
        const before = cam.zoom;
        cam._gestures.request('SCROLL_PAN');

        const orig = cam._wheelClassifier.classify.bind(cam._wheelClassifier);
        cam._wheelClassifier.classify = () => 'mouse';
        const el = document.getElementById('map-container');
        const rect = el.getBoundingClientRect();
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -100, deltaX: 0, deltaMode: 0, ctrlKey: false,
          bubbles: true, cancelable: true,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
        }));
        cam._wheelClassifier.classify = orig;

        return { changed: cam.zoom !== before, animating: !cam._springLoop.logZoom.settled };
      });
      expect(r.changed).toBe(false);
      expect(r.animating).toBe(false);
    });

    test('trackpad pinch during SCROLL_PAN is accepted (higher priority)', async ({ page }) => {
      const r = await page.evaluate(() => {
        const cam = __cam();
        cam.zoom = 2.0; cam._applyConstraints();
        const before = cam.zoom;
        cam._gestures.request('SCROLL_PAN');

        const orig = cam._wheelClassifier.classify.bind(cam._wheelClassifier);
        cam._wheelClassifier.classify = () => 'trackpad';
        const el = document.getElementById('map-container');
        const rect = el.getBoundingClientRect();
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -5, deltaX: 0, deltaMode: 0, ctrlKey: true,
          bubbles: true, cancelable: true,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
        }));
        cam._wheelClassifier.classify = orig;

        return { changed: Math.abs(cam.zoom - before) > 0.001, gesture: cam._gestures.current };
      });
      expect(r.changed).toBe(true);
      expect(r.gesture).toBe('PINCH_ZOOM');
    });
  });
});
