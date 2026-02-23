/**
 * Wait for web fonts (Inter, Cinzel, Crimson Text) to finish loading.
 * domcontentloaded doesn't guarantee font rendering — this does.
 */
export async function waitForFonts(page) {
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Read a CSS custom property from :root (document.documentElement).
 * Returns the trimmed string value.
 */
export async function getCSSToken(page, tokenName) {
  return page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    tokenName
  );
}

/**
 * Count CSS grid columns on a given selector by splitting gridTemplateColumns.
 */
export async function getGridColumnCount(page, selector) {
  return page.locator(selector).evaluate(
    (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length
  );
}

/** Screenshot config shared across all visual regression tests. */
export const SCREENSHOT_CONFIG = {
  maxDiffPixelRatio: 0.02,
  animations: 'disabled',
};

/** App definitions used by multiple test files. */
export const APPS = [
  { name: 'DM Guide', url: '/' },
  { name: 'Controller', url: '/controller/' },
  { name: 'VTT', url: '/vtt/' },
];

/**
 * Assert that compact density reduces a CSS property value on a given selector.
 * Uses localStorage + reload for reliable Chromium custom-property resolution.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').expect} expect
 * @param {string} selector - CSS selector for the element to measure
 * @param {string} property - camelCase CSS property name (e.g. 'paddingRight', 'marginTop')
 * @param {(page: import('@playwright/test').Page) => Promise<void>} [setup] - optional setup before measurement (e.g. navigate to content)
 */
/**
 * Navigate to VTT and wait for the loading screen to hide.
 */
export async function gotoVTT(page) {
  await page.goto('/vtt/');
  await page.waitForFunction(
    () => document.getElementById('loading')?.hidden === true,
    { timeout: 15000 }
  );
}

/**
 * Wait for the DM Guide async boot() to complete.
 * Use after page.goto('/') or page.reload() on the DM Guide.
 */
export async function waitForDMBoot(page) {
  await page.waitForFunction(
    () => document.body.dataset.ready === 'true',
    { timeout: 15000 }
  );
}

/**
 * Navigate to the DM Guide and wait for boot to complete.
 */
export async function gotoDMGuide(page) {
  await page.goto('/');
  await waitForDMBoot(page);
}

/**
 * Switch to map mode and wait for the camera to have a loaded map.
 */
export async function enterMapMode(page) {
  await page.evaluate(() => {
    const vtt = window.__vtt;
    if (!vtt) return;
    vtt.EventBus.emit('mode:switch', 'map');
    if (!vtt.state.mapId) vtt.EventBus.emit('map:load', 'M01');
  });
  await page.waitForFunction(() => {
    const cam = window.__vtt?.mapRenderer?.camera;
    // Wait for both map dimensions AND viewport dimensions from ResizeObserver
    return cam && cam.mapW > 0 && cam.viewportW > 0 && cam.viewportH > 0;
  }, { timeout: 10000 });
}

/**
 * Inject VTT accessor shortcuts into the page's window for test convenience.
 * Call in beforeEach after gotoVTT(). Provides:
 * - __cam()            → window.__vtt.mapRenderer.camera (or null)
 * - __animator()       → camera._animator (or null)
 * - __edgePan()        → tokenManager._edgePan (or null)
 * - __flyToAnimator()  → window.__vtt.flyToAnimator (or null)
 * - __interpolator()   → window.__vtt.interpolator (or null)
 * - __semanticZoom()   → window.__vtt.semanticZoom (or null)
 * - __presetManager()  → window.__vtt.presetManager (or null)
 */
export async function injectTestAccessors(page) {
  await page.evaluate(() => {
    window.__cam = () => window.__vtt?.mapRenderer?.camera ?? null;
    window.__animator = () => window.__vtt?.mapRenderer?.camera?._animator ?? null;
    window.__edgePan = () => window.__vtt?.tokenManager?._edgePan ?? null;
    window.__flyToAnimator = () => window.__vtt?.flyToAnimator ?? null;
    window.__interpolator = () => window.__vtt?.interpolator ?? null;
    window.__semanticZoom = () => window.__vtt?.semanticZoom ?? null;
    window.__presetManager = () => window.__vtt?.presetManager ?? null;

    // Monkey-patch cam.panBy to capture the first call, then auto-restore.
    // Returns { first: { dx, dy } | null, restore() }.
    window.__capturePanBy = (cam) => {
      const orig = cam.panBy.bind(cam);
      let first = null;
      cam.panBy = (dx, dy) => {
        if (!first) { first = { dx, dy }; cam.panBy = orig; }
        return orig(dx, dy);
      };
      return { get first() { return first; }, restore() { cam.panBy = orig; } };
    };
  });
}

/**
 * Inject a style that disables all CSS transitions on the page.
 * Useful for density/layout tests that read computed styles — prevents
 * mid-transition intermediate values from causing flaky assertions.
 */
export async function disableTransitions(page) {
  await page.evaluate(() => {
    if (document.getElementById('disable-transitions')) return;
    const style = document.createElement('style');
    style.id = 'disable-transitions';
    style.textContent = '*, *::before, *::after { transition-duration: 0s !important; }';
    document.head.appendChild(style);
  });
}

export async function expectDensityReduces(page, expect, selector, property, setup) {
  await gotoDMGuide(page);
  await disableTransitions(page);
  if (setup) await setup(page);
  const defaultVal = await page.locator(selector).first().evaluate(
    (el, prop) => parseFloat(getComputedStyle(el)[prop]), property
  );
  await page.evaluate(() => localStorage.setItem('ui-density', 'compact'));
  await page.reload();
  await waitForDMBoot(page);
  await disableTransitions(page);  // Re-inject after reload
  if (setup) await setup(page);
  const compactVal = await page.locator(selector).first().evaluate(
    (el, prop) => parseFloat(getComputedStyle(el)[prop]), property
  );
  expect(compactVal).toBeLessThan(defaultVal);
}

/**
 * Boot VTT Display in map mode with a loaded map. For cross-window sync tests.
 * @param {import('@playwright/test').BrowserContext} context
 * @returns {Promise<import('@playwright/test').Page>}
 */
export async function bootDisplay(context) {
  const display = await context.newPage();
  await display.goto('/vtt/');
  await display.waitForFunction(
    () => document.getElementById('loading')?.hidden === true,
    { timeout: 15000 }
  );
  await display.evaluate(() => {
    window.__vtt.EventBus.emit('mode:switch', 'map');
    if (!window.__vtt.state.mapId) window.__vtt.EventBus.emit('map:load', 'M01');
  });
  await display.waitForFunction(() => {
    const cam = window.__vtt?.mapRenderer?.camera;
    return cam && cam.mapW > 0 && cam.viewportW > 0 && cam.viewportH > 0;
  }, { timeout: 10000 });
  return display;
}

/**
 * Boot Controller and wait for sync engine to start. For cross-window sync tests.
 * @param {import('@playwright/test').BrowserContext} context
 * @returns {Promise<import('@playwright/test').Page>}
 */
export async function bootController(context) {
  const ctrl = await context.newPage();
  await ctrl.goto('/controller/');
  await ctrl.waitForFunction(
    () => window.__controller?.camera != null,
    { timeout: 10000 }
  );
  return ctrl;
}

/**
 * Inject window.__waitForAnimComplete(timeout?) into the page.
 * Resolves when EventBus emits 'camera:animation-complete', or after
 * the safety timeout (prevents test hangs if animation never fires).
 * Call once in beforeEach; use inside page.evaluate as:
 *   await window.__waitForAnimComplete();
 */
export async function injectAnimationWaitHelper(page) {
  await page.evaluate(() => {
    window.__waitForAnimComplete = (timeout = 3000) => new Promise(resolve => {
      const { EventBus } = window.__vtt;
      let resolved = false;
      const handler = () => {
        resolved = true;
        EventBus.off('camera:animation-complete', handler);
        resolve();
      };
      EventBus.on('camera:animation-complete', handler);
      setTimeout(() => {
        if (!resolved) {
          EventBus.off('camera:animation-complete', handler);
          console.warn('[test] __waitForAnimComplete timed out after', timeout, 'ms — animation may not have completed');
          resolve();
        }
      }, timeout);
    });
  });
}

/**
 * Snapshot the Display camera's current position.
 */
export async function getDisplayCameraState(page) {
  return page.evaluate(() => {
    const cam = window.__vtt?.mapRenderer?.camera;
    return cam ? { x: cam.x, y: cam.y, zoom: cam.zoom } : null;
  });
}

/**
 * Snapshot the Controller camera's current position.
 */
export async function getControllerCameraState(page) {
  return page.evaluate(() => {
    const cam = window.__controller?.camera;
    return cam ? { x: cam.x, y: cam.y, zoom: cam.zoom } : null;
  });
}

/**
 * Wait for Controller camera to have map dimensions (arrives via WELCOME handshake).
 * Call after bootController() when test needs coordinate transforms.
 */
export async function waitForControllerMap(ctrl, timeoutMs = 10000) {
  await ctrl.waitForFunction(
    () => window.__controller?.camera?.mapW > 0,
    { timeout: timeoutMs }
  );
}

/**
 * Wait for Phase 5 modules to be wired on the Display.
 */
export async function waitForDisplayPhase5(display, timeoutMs = 5000) {
  await display.waitForFunction(
    () => window.__vtt?.flyToAnimator != null,
    { timeout: timeoutMs }
  );
}

/**
 * Dispatch wheel events with mocked performance.now() gaps.
 * Mocks time only during synchronous dispatch, then restores immediately
 * so rAF-based animations (SmoothZoomAnimator) use real time.
 */
/**
 * Full map-mode camera setup: navigate to VTT, enter map mode, inject test accessors.
 */
export async function setupMapCamera(page) {
  await gotoVTT(page);
  await enterMapMode(page);
  await injectTestAccessors(page);
}

export async function dispatchMouseWheelSequence(page, opts = {}) {
  await page.evaluate((o) => {
    const origNow = performance.now.bind(performance);
    let mockTime = origNow();
    performance.now = () => mockTime;
    const cam = window.__vtt?.mapRenderer?.camera;
    const el = document.getElementById('map-container');
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Pre-seed classifier to 'mouse' so the first event doesn't
    // misroute to trackpad/pan path (Phase S4: GSM now gates on
    // request() return, so misclassified events are actually blocked).
    // Must also set _lastEventTime to prevent silence reset in classify().
    if (cam?._wheelClassifier) {
      cam._wheelClassifier._device = 'mouse';
      cam._wheelClassifier._lastEventTime = mockTime;
    }

    try {
      for (let i = 0; i < o.count; i++) {
        mockTime += o.gapMs;
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: o.deltaY, deltaX: o.deltaX, deltaMode: 0,
          ctrlKey: o.ctrlKey, bubbles: true, cancelable: true,
          clientX: cx, clientY: cy,
        }));
      }
    } finally {
      performance.now = origNow;
    }
  }, {
    count: opts.count ?? 3,
    gapMs: opts.gapMs ?? 200,
    deltaY: opts.deltaY ?? -100,
    deltaX: opts.deltaX ?? 0,
    ctrlKey: opts.ctrlKey ?? false,
  });
}
