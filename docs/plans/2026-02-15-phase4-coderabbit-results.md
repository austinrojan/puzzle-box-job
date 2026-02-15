# Phase 4 (Camera Sync) CodeRabbit Review Results

**Date:** 2026-02-15
**Scope:** 18 commits (`9a487c4..43aa06e`), 7 files, +1500 / -10 lines
**Reviewers:** 5 parallel CodeRabbit agents + cross-cutting synthesis

## Summary

| Category | Count | Fixed |
|----------|-------|-------|
| **Blocking** | 0 | — |
| **Advisory (High)** | 5 | — |
| **Advisory** | 10 | — |
| **False Positive** | 5 | — |
| **Total findings** | 20 | **0 fixed** |

**Verdict: Phase 4 is clear to proceed to Phase 5.** Zero blocking bugs found across all six review domains (protocol, sync engine, controller integration, display integration, test quality, cross-cutting). The center-point camera model is mathematically correct with verified roundtrip. The 5-class sync engine has proper ping-pong prevention, idempotent cleanup, and no memory leaks. The WELCOME race during the 150ms debounce window is a one-time connect artifact, not a steady-state bug. All Advisory (High) items are test quality gaps or defensive hardening — none cause incorrect behavior in production.

---

## Advisory Issues (High Priority)

### AH-1: Browser context leak on cross-window test failure
- **File:** `tests/camera-sync.spec.js:465-609`
- **Issue:** All four cross-window tests create `browser.newContext()` but call `context.close()` only at the bottom of the test body. If any assertion or `waitForFunction` throws before that line, the BrowserContext is never closed. There is no `test.afterEach` hook and no `try/finally` wrapping. With `retries: 1` in the Playwright config, a reliably-failing test creates 2 leaked contexts per run.
- **Impact:** Leaked browser processes accumulate on test failure, potentially exhausting CI memory.
- **Fix:** Add `test.afterEach` to close context, or wrap each test body in `try/finally`. Example:
```js
test.describe('Cross-window camera sync', () => {
  let context;
  test.afterEach(async () => { if (context) await context.close(); context = null; });
  test('...', async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    // ... no context.close() needed
  });
});
```

### AH-2: `waitForTimeout(200)` at lines 546 and 556 — flaky by design
- **File:** `tests/camera-sync.spec.js:546, 556`
- **Phase 2 ref:** AH-5 (carried forward through Phase 3 AH-2)
- **Issue:** Two `waitForTimeout(200)` calls survive from the Phase 4 cleanup pass (commit `43aa06e` converted all others to `waitForFunction`). Line 546 waits for zoom propagation (replaceable with condition-based poll). Line 556 is a negative assertion stability wait after `ctrl.close()` (harder to replace — could poll for GOODBYE processing via registry).
- **Impact:** Potential test flakiness under load or in CI environments.
- **Fix:** Line 546: `await display.waitForFunction(prev => cam.zoom !== prev, initialZoom, { timeout: 3000 })`. Line 556: `await display.waitForFunction(() => !window.__vtt?.syncEngine?._registry?.hasRole?.('controller'), { timeout: 3000 })`, or document why the fixed wait is necessary.

### AH-3: `sendNow()` / `sendImmediate()` path has zero test coverage
- **File:** `tests/camera-sync.spec.js` (gap), `vtt/js/camera-sync.js:135-137, 583-588`
- **Issue:** The production bug that motivated `sendImmediate()` (commit `022d6ae`) was only caught by manual testing because Playwright does not throttle rAF. Cross-window tests call `camera.zoomToCenter()` directly via `page.evaluate()`, exercising the rAF broadcast path which works in Playwright but fails in production background tabs. The `broadcastAfter()` → `sendNow()` → `sendImmediate()` chain used by real button handlers has zero test coverage.
- **Impact:** Regressions in the immediate-send path would not be caught by automated tests.
- **Fix:** Add a unit test for `sendImmediate()` that verifies it posts a message immediately without requiring rAF, and/or add a DOM-click-path integration test that clicks the actual zoom button.

### AH-4: Null guard missing on `_channel` in `CameraBroadcaster._sendState()`
- **File:** `vtt/js/camera-sync.js:147-170`
- **Issue:** During the pagehide→pageshow reconnect flow, `CameraChannelManager._onPageHide()` sets `this._channel = null`, then `CameraBroadcaster.setChannel(null)` is called. If the rAF loop fires between `_onPageHide` and `_onPageShow`, `_sendState()` calls `this._channel.postMessage()` on null, throwing `TypeError`. Browser freezing of rAF on pagehide mitigates this in practice, but it's not guaranteed.
- **Impact:** Potential uncaught TypeError during page lifecycle transitions. Would silently kill the rAF loop.
- **Fix:** Add `if (!this._channel) return;` at the top of `_sendState()`. One-line defensive addition.

### AH-5: Cross-window viewport-independence never tested end-to-end
- **File:** `tests/camera-sync.spec.js:464-609`
- **Issue:** All four cross-window integration tests use `browser.newContext({ viewport: { width: 1920, height: 1080 } })` for both Controller and Display. The center-point camera model was specifically designed to handle different viewport sizes (Controller at 1920x1080 vs Display at arbitrary size), but this is only validated as a pure math unit test, never in an actual cross-window flow.
- **Impact:** A regression in the shared→local coordinate conversion at the integration level would not be caught.
- **Fix:** Add a cross-window test with mismatched viewports (e.g., Controller 1920x1080, Display resized to 960x540 via `page.setViewportSize()`). Note: both pages must be in the same BrowserContext for BroadcastChannel to work.

---

## Advisory Issues

### A-1: Missing `_v` (protocol version) on `_msgTemplate` in CameraBroadcaster
- **File:** `vtt/js/camera-sync.js:81-88`
- **Issue:** The pre-allocated `_msgTemplate` object lacks the `_v: PROTOCOL_VERSION` field that all factory-created messages include via `msg()`. CAMERA_SYNC messages sent through the 30fps rAF loop bypass version checking entirely. `validateMessage()` silently passes messages with `_v: undefined`.
- **Impact:** Inconsistency. If protocol version checking is ever tightened, CAMERA_SYNC messages would silently fail validation.
- **Fix:** Add `_v: 1` (or `PROTOCOL_VERSION`) to the template object.

### A-2: Division by zero unguarded in `localToShared` / `sharedToLocal`
- **File:** `shared/protocol.js:168-182`
- **Issue:** Both functions divide by `zoom`. If `zoom = 0`, they produce `Infinity`; if `zoom = NaN`, they propagate `NaN`. The Camera class prevents zoom < 0.1, but the protocol functions have no guard, and `Math.max(0.1, NaN)` returns `NaN`.
- **Impact:** Low today — no code path produces zoom=0. But a corrupt BroadcastChannel message could permanently put the camera in a NaN state.
- **Fix:** Guard with `if (!camera.zoom) return { centerX: camera.x, centerY: camera.y, zoom: 0 };` or add `Number.isFinite()` checks in the receiver.

### A-3: NaN guard missing in `CameraReceiver._applySharedState()`
- **File:** `vtt/js/camera-sync.js:223-240`
- **Issue:** A malformed message (missing `centerX`/`centerY`/`zoom` or with wrong types) flows through `sharedToLocal()` producing `NaN` values, which `camera.deserialize()` silently writes into camera state. Same-origin BroadcastChannel means this can only come from a programming bug, not an external attacker.
- **Impact:** A corrupt message from a buggy sender could put the camera in a permanently broken NaN state.
- **Fix:** Add at entry: `if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(zoom)) return;`

### A-4: Superseded message types should be marked deprecated
- **File:** `shared/protocol.js:27-30, 118-121`
- **Issue:** `CAMERA_ZOOM`, `CAMERA_PAN`, `CAMERA_RESET`, `CAMERA_STATE` and their factory functions are defined but have zero importers outside protocol.js. The DM Guide (index.html) does not use them. VTT `state.js` still has handlers but no sender exists. These are dead code.
- **Impact:** Maintenance confusion. A future developer might use them not knowing they're superseded.
- **Fix:** Add `@deprecated` JSDoc comments. Do not remove yet — validate with a cleanup pass.

### A-5: `validateMessage` imported but never called in camera-sync.js
- **File:** `vtt/js/camera-sync.js:24`
- **Issue:** `validateMessage` is imported from protocol.js but never called anywhere in the module. The control channel (`state.js`) validates every incoming message, but the camera channel trusts messages based solely on their `type` field.
- **Impact:** Dead import + robustness gap. Messages missing required fields would not be rejected.
- **Fix:** Either remove the import and add NaN guards (A-3), or call `validateMessage()` in `_handleMessage()`.

### A-6: `createCameraSyncMsg` imported but unused in camera-sync.js
- **File:** `vtt/js/camera-sync.js:24`
- **Issue:** `createCameraSyncMsg` is imported but unused. The broadcaster uses `_msgTemplate` directly (correct optimization for 30fps GC pressure). Dead import.
- **Impact:** Cosmetic. Zero runtime cost.
- **Fix:** Remove the unused import.

### A-7: `bootController` JSDoc mismatches actual wait condition
- **File:** `tests/helpers.js:151-164`
- **Issue:** JSDoc says "wait for sync engine to start" but the helper only waits for `window.__controller?.camera != null`, not `syncEngine._started === true`. Cross-window tests compensate with a secondary `mapW > 0` check, but a future test might omit this.
- **Impact:** Potential race if a new test relies solely on `bootController` for sync engine readiness.
- **Fix:** Either strengthen to `syncEngine?._started === true`, or update JSDoc to accurately describe the weaker condition.

### A-8: JUMP_TO cross-window assertion weaker than wait condition
- **File:** `tests/camera-sync.spec.js:529`
- **Issue:** Test sends `zoom: 2.0`, waits for `zoom >= 1.5`, then asserts `zoom > 1.0`. The final assertion would pass even if the jump was never applied. The `waitForFunction` is the real assertion.
- **Impact:** Weak regression protection.
- **Fix:** Tighten to `expect(cam.zoom).toBeCloseTo(2.0, 1)`.

### A-9: WELCOME hydration test duplicates center formula instead of using `localToShared`
- **File:** `tests/camera-sync.spec.js:576-601`
- **Issue:** The center-point formula `c.x + (c.viewportW / 2) / c.zoom` is hand-coded in the test rather than importing `localToShared` from protocol.js. If the formula changes, the test would not break as expected.
- **Impact:** Test/production formula drift risk.
- **Fix:** Use `import('/shared/protocol.js').then(m => m.localToShared(...))` in `page.evaluate()`.

### A-10: Cross-window tests run 4x across viewport projects with no effect
- **File:** `playwright.config.js:14-19`, `tests/camera-sync.spec.js:464-609`
- **Issue:** The four Playwright viewport projects (960, 1024, 1440, 1920) run all test files. Cross-window tests create their own contexts with hardcoded 1920x1080, so the config viewport has no effect. These 4 tests execute identically 4 times.
- **Impact:** Wasted CI time (16 tests instead of 4 with no additional coverage).
- **Fix:** Tag cross-window tests and filter to run only in the 1920 project, or use `test.describe.configure()`.

---

## False Positives

### FP-1: Missing `broadcastAfter()` after `setMapSize()` in controller
- **File:** `controller/js/ui-builders.js:186-189`
- **Rationale:** Both Controller and Display independently receive `map:load` on the control channel and run their own `fitCover()` with their respective viewport dimensions. Broadcasting the Controller's 1920x1080-based cover state would override the Display's correct viewport-relative position. Independent convergence is the correct design.

### FP-2: Direct field mutations in tests (`camera.x = 200`)
- **File:** `tests/camera-sync.spec.js` (multiple locations)
- **Rationale:** Intentional for unit isolation. Tests construct lightweight mock objects with direct field access to test individual class behavior without bootstrapping the full Camera class.

### FP-3: `page.evaluate()` + `window.__vtt` pattern
- **File:** `tests/camera-sync.spec.js` (multiple locations)
- **Rationale:** Standard Playwright convention for accessing in-page state. The `__vtt` and `__controller` debug objects are intentionally exposed for testing.

### FP-4: `_msgTemplate` mutation before `postMessage`
- **File:** `vtt/js/camera-sync.js:165-170`
- **Rationale:** Safe per structured clone specification. `BroadcastChannel.postMessage()` deep-copies the message synchronously before returning. Subsequent mutations to `_msgTemplate` cannot affect already-posted messages.

### FP-5: Private property access in tests (`_started`, `_broadcaster`)
- **File:** `tests/camera-sync.spec.js` (multiple locations)
- **Rationale:** Intentional white-box testing. The test suite verifies internal wiring (role-based component creation) which cannot be observed through public APIs alone.

---

## Test Coverage Matrix

| Feature | Unit | Integration | E2E | Gap? |
|---------|:----:|:-----------:|:---:|------|
| localToShared/sharedToLocal roundtrip | 4 | — | — | — |
| Protocol validation (Phase 4 types) | 3 | — | — | Shallow (A-8 scope) |
| Broadcaster epsilon filter | 3 | — | — | — |
| Broadcaster suppressBroadcast | 1 | — | — | — |
| Broadcaster sequence numbers | 1 | — | — | — |
| Receiver seq tracking | 3 | — | — | — |
| Receiver JUMP_TO | 1 | — | — | — |
| WindowRegistry ANNOUNCE/WELCOME/GOODBYE | 4 | — | — | — |
| WindowRegistry heartbeat/reap | — | — | — | **No test** |
| ChannelManager restore | 2 | — | — | — |
| ChannelManager pagehide/pageshow | — | — | — | **No test** |
| SyncEngine role wiring | — | 5 | — | — |
| SyncEngine WELCOME debounce | — | — | — | **No test** |
| SyncEngine reconnect | — | — | — | **No test** |
| SyncEngine destroy cleanup | — | — | — | **No test** |
| Cross-window zoom sync | — | — | 1 | — |
| Cross-window JUMP_TO | — | — | 1 | Weak assertion (A-8) |
| Cross-window disconnect | — | — | 1 | — |
| Cross-window WELCOME hydration | — | — | 1 | — |
| sendNow() / sendImmediate() path | — | — | — | **No test** (AH-3) |
| viewportReady guard (no map) | — | — | — | **No test** |
| Viewport-independence E2E | — | — | — | **No test** (AH-5) |

---

## Phase 3 Carry-Forward Status

| ID | Issue | Phase 3 Status | Phase 4 Status |
|----|-------|----------------|----------------|
| AH-5→AH-2 | `waitForTimeout` flaky waits | Carried forward | **Still present** (2 instances at lines 546/556) — now AH-2 |
| A-7 | `panBy()` ignores `viewportScale` | Deferred | **Still deferred**. Controller calls `panBy()` but has no viewport scale. Display receives via `deserialize()` not `panBy()`. Would manifest only if theater-mode map interaction added. |
| AH-4 | Token drag coupling | Not relevant to Phase 4 | **Not relevant** — no token changes in Phase 4 |

---

## Phase 5 Carry-Forward Items

### From Phase 4 Review

| ID | Issue | Priority | Source |
|----|-------|----------|--------|
| CF-1 | `sendNow()` / `sendImmediate()` needs test coverage | High | AH-3 |
| CF-2 | Null guard on `_channel` in `_sendState()` | High | AH-4 |
| CF-3 | Cross-window tests need `afterEach` cleanup | High | AH-1 |
| CF-4 | Replace `waitForTimeout(200)` with condition-based waits | Medium | AH-2 |
| CF-5 | Add viewport-independence E2E test | Medium | AH-5 |
| CF-6 | Add NaN guard in receiver | Medium | A-3 |
| CF-7 | Add `_v` to `_msgTemplate` | Low | A-1 |
| CF-8 | Mark superseded camera messages `@deprecated` | Low | A-4 |
| CF-9 | Remove unused imports (`createCameraSyncMsg`, `validateMessage`) | Low | A-5, A-6 |

### From Phase 4 Lessons Document (Pre-Existing)

| Item | Status |
|------|--------|
| Expose `sendNow()` public API | **DONE** (commit `e563597`) |
| Cover zoom gap 0.664–1.0 | Validate if Phase 5 adds direct zoom input |
| "Fit to Display viewport" needs real dimensions | Needs VIEWPORT_QUERY protocol extension |
| WELCOME handshake timing fallback | Ensure fallback for any new handshake data |
| `panBy()` viewportScale (Phase 2 A-7) | Still deferred |

---

## Architectural Notes (Informational)

### WELCOME Race During 150ms Debounce
During the WELCOME debounce window, a CAMERA_SYNC message could arrive, get applied by the receiver, and then 150ms later the WELCOME overwrites it. This causes a one-time visual jump during initial connection (not steady-state). The displacement is small (~5 frames of camera movement at 30fps). Acceptable as a connect artifact. Fix only if users report the visual jump.

### Dual Channel Architecture
Phase 4 adds `'vtt-camera'` (30fps continuous sync) alongside `'puzzlebox-vtt'` (discrete control commands). The channels are browser-isolated by name. No cross-contamination risk. Old camera messages on the control channel (`CAMERA_ZOOM`, `CAMERA_PAN`, `CAMERA_RESET`) are now dead code — all camera synchronization flows through the dedicated camera channel.

### Controller Camera Before WELCOME
The Controller's rAF loop starts immediately with `viewportReady()` returning true (1920x1080 set at construction). If a button is pressed before the WELCOME handshake provides map dimensions, the Display would receive camera state computed without map constraints. Mitigated: rAF is throttled in background tabs, and `sendNow()` only fires on explicit button presses. Not a practical concern.

### Cross-App Import Coupling
Controller imports directly from `../../vtt/js/map-camera.js` and `../../vtt/js/camera-sync.js`. Pragmatic for a zero-build-step project. Creates a coupling to VTT's `EventBus` singleton via transitive imports. Safe today since `state.js` exports only `EventBus` and a reactive state object with no DOM dependencies.
