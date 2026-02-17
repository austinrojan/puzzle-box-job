import { test, expect } from '@playwright/test';
import { bootDisplay, bootController, waitForControllerMap } from './helpers.js';

test.describe('Phase 5 Integration', () => {
  test('authority election works via production Controller boot', async ({ context }) => {
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);

    // Election is wired into Controller boot (Task 18).
    // Single Controller should automatically become authority.
    await ctrl.waitForFunction(
      () => window.__controller?.election?.isAuthority === true,
      { timeout: 5000 }
    );
  });

  test('getDebugState reports authority status correctly', async ({ context }) => {
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);

    await ctrl.waitForFunction(
      () => window.__controller?.election?.isAuthority === true,
      { timeout: 5000 }
    );

    const debugState = await ctrl.evaluate(
      () => window.__controller.syncEngine.getDebugState()
    );

    expect(debugState.isAuthority).toBe(true);
    expect(debugState.role).toBe('controller');
    expect(debugState.status).toBe('connected');
    expect(debugState.peerCount).toBeGreaterThanOrEqual(1); // at least the Display
  });

  test('orphan overlay shows when Display boots without Controller', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    try {
      const display = await context.newPage();
      await display.goto('/vtt/');
      await display.waitForFunction(
        () => document.getElementById('loading')?.hidden === true,
        { timeout: 15000 }
      );

      // Wait for the 3-second initial-boot timer to fire
      await display.waitForFunction(() => {
        const el = document.getElementById('orphan-overlay');
        return el?.classList.contains('orphan-overlay--visible');
      }, { timeout: 6000 });

      // Boot a Controller — overlay should hide
      const ctrl = await bootController(context);
      await display.waitForFunction(() => {
        const el = document.getElementById('orphan-overlay');
        return el && !el.classList.contains('orphan-overlay--visible');
      }, { timeout: 5000 });
    } finally {
      await context.close();
    }
  });

  test('preset recall broadcasts flyTo to Display via production path', async ({ context }) => {
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);

    await ctrl.waitForFunction(
      () => window.__controller?.camera?.mapW > 0 &&
            window.__controller?.election?.isAuthority === true,
      { timeout: 10000 }
    );

    // Save a preset at coverZoom position
    await ctrl.evaluate(() => {
      const mgr = window.__controller.presetManager;
      const cam = window.__controller.camera;
      const vp = { width: cam.viewportW, height: cam.viewportH };
      mgr.save('CoverZoom', cam, vp);
    });

    // Zoom in to a different position
    await ctrl.evaluate(() => {
      const cam = window.__controller.camera;
      cam.setPosition(cam.mapW * 0.3, cam.mapH * 0.3, cam._coverZoom * 2);
      window.__controller.syncEngine.sendNow();
    });

    // Wait for Display to receive the zoomed-in state
    await display.waitForFunction(
      () => {
        const cam = window.__vtt?.mapRenderer?.camera;
        return cam && cam.zoom > cam._coverZoom * 1.2;
      },
      { timeout: 5000 }
    );

    const before = await display.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      return { zoom: cam.zoom };
    });

    // Recall the saved preset — triggers flyTo via authority-gated production path
    await ctrl.evaluate(() => {
      const mgr = window.__controller.presetManager;
      const presets = mgr.listForCurrentMap();
      if (presets.length === 0) throw new Error('Expected at least one preset after save');
      mgr.recall(presets[0].id);
    });

    // Display should animate toward coverZoom (lower zoom than current)
    await display.waitForFunction((prev) => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return false;
      // Zoom should decrease from the 2x level back toward coverZoom
      return cam.zoom < prev.zoom - 0.05;
    }, before, { timeout: 5000 });
  });

  test('prefers-reduced-motion makes flyTo jump instantly', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      reducedMotion: 'reduce',
    });
    try {
      const display = await bootDisplay(context);

      // Call flyTo directly on the animator with a long duration.
      // With reduced motion, it should jump instantly (not animate).
      const isAnimating = await display.evaluate(() => {
        const animator = window.__vtt.flyToAnimator;
        const cam = window.__vtt.mapRenderer.camera;
        const target = {
          centerX: cam.mapW * 0.3,
          centerY: cam.mapH * 0.3,
          zoom: cam._coverZoom * 1.5,
        };
        animator.flyTo(target, { duration: 5000 });
        return animator.isAnimating;
      });

      // Should NOT be animating — reduced motion triggers jumpTo
      expect(isAnimating).toBe(false);
    } finally {
      await context.close();
    }
  });

  test('semantic zoom classes appear at expected zoom levels', async ({ context }) => {
    const display = await bootDisplay(context);

    // At coverZoom, no semantic zoom classes should be present
    const atCoverZoom = await display.evaluate(() => {
      const el = document.getElementById('map-container');
      return {
        tokenNames: el?.classList.contains('sz-token-names') ?? false,
        gridLabels: el?.classList.contains('sz-grid-labels') ?? false,
      };
    });
    expect(atCoverZoom.tokenNames).toBe(false);
    expect(atCoverZoom.gridLabels).toBe(false);

    // Zoom to 1.5x coverZoom — token-names should appear (showAt: 1.2)
    await display.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam.setPosition(cam.mapW / 2, cam.mapH / 2, cam._coverZoom * 1.5);
    });
    await display.waitForFunction(() => {
      return document.getElementById('map-container')
        ?.classList.contains('sz-token-names');
    }, { timeout: 3000 });

    // Zoom to 2x coverZoom — grid-labels should also appear (showAt: 1.8)
    await display.evaluate(() => {
      const cam = window.__vtt.mapRenderer.camera;
      cam.setPosition(cam.mapW / 2, cam.mapH / 2, cam._coverZoom * 2.0);
    });
    await display.waitForFunction(() => {
      return document.getElementById('map-container')
        ?.classList.contains('sz-grid-labels');
    }, { timeout: 3000 });
  });

  test('flyTo interruption stops animation at current position', async ({ context }) => {
    const display = await bootDisplay(context);
    const ctrl = await bootController(context);

    await waitForControllerMap(ctrl);

    // Start a long flyTo
    await ctrl.evaluate(() => {
      window.__controller.syncEngine.broadcaster.sendFlyTo(
        { centerX: 0.75, centerY: 0.75, zoom: 2.5 },
        { duration: 5000 }
      );
    });

    // Wait for animation to start
    await display.waitForFunction(
      () => window.__vtt?.flyToAnimator?.isAnimating === true,
      { timeout: 5000 }
    );

    // Interrupt via programmatic interrupt (simulates user input)
    await display.evaluate(() => window.__vtt.flyToAnimator.interrupt());

    // Animation should stop
    await display.waitForFunction(
      () => window.__vtt?.flyToAnimator?.isAnimating === false,
      { timeout: 3000 }
    );
  });

  test('authority gating prevents non-authority from broadcasting flyTo', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    try {
      const display = await bootDisplay(context);
      const ctrl1 = await bootController(context);
      const ctrl2 = await bootController(context);

      // Wait for both to have elections
      await ctrl1.waitForFunction(
        () => window.__controller?.election != null,
        { timeout: 5000 }
      );
      await ctrl2.waitForFunction(
        () => window.__controller?.election != null,
        { timeout: 5000 }
      );

      // Wait for election convergence — both have determined authority status
      await Promise.all([
        ctrl1.waitForFunction(
          () => window.__controller?.election?.isAuthority !== undefined,
          { timeout: 5000 }
        ),
        ctrl2.waitForFunction(
          () => window.__controller?.election?.isAuthority !== undefined,
          { timeout: 5000 }
        ),
      ]);
      // Small buffer for claim exchange to settle
      await new Promise(r => setTimeout(r, 100));

      // Identify authority and non-authority
      const id1 = await ctrl1.evaluate(() => window.__controller.syncEngine.windowId);
      const id2 = await ctrl2.evaluate(() => window.__controller.syncEngine.windowId);
      const nonAuthority = id1 < id2 ? ctrl2 : ctrl1;

      // Verify non-authority election state
      const nonAuthIsAuthority = await nonAuthority.evaluate(
        () => window.__controller.election.isAuthority
      );
      expect(nonAuthIsAuthority).toBe(false);

      // Intercept transport.send on non-authority to capture any flyTo messages
      await nonAuthority.evaluate(() => {
        window.__flyTosSent = [];
        const transport = window.__controller.syncEngine._transport;
        const origSend = transport.send.bind(transport);
        transport.send = (msg) => {
          if (msg.type === 'camera:fly-to') window.__flyTosSent.push(msg);
          origSend(msg);
        };
      });

      // Non-authority clicks Frame Tokens — UI gating should prevent sendFlyTo
      // (ui-builders.js line 249: checks election.isAuthority before sendFlyTo)
      await nonAuthority.click('#btn-frame-tokens');
      await new Promise(r => setTimeout(r, 500));

      // Verify no CAMERA_FLY_TO was sent by non-authority
      const flyToCount = await nonAuthority.evaluate(() => window.__flyTosSent.length);
      expect(flyToCount).toBe(0);
    } finally {
      await context.close();
    }
  });
});
