# Camera System Test Suite Review

**Date:** 2026-02-25
**Scope:** 13 test files + `tests/helpers.js` shared utilities
**Total tests reviewed:** ~170 across 13 spec files

---

## Summary

The camera test suite is well-structured overall, with proper use of `waitForFunction` for animation polling, good coverage of the spring physics pipeline, and thoughtful edge-case testing (e.g., sign-change detection during snap-back, velocity clamping boundary cases). The main areas for improvement are: naming hygiene (phase references), a handful of timing-dependent patterns, one confirmed flaky-test root cause, and coverage gaps in several untested source paths.

---

## Findings by Severity

### P0 -- Bug (1 finding)

#### F01. Flaky test: `_smoothZoomTo updates logZoom target within bounds`

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/phase6-unit.spec.js`, line 214

**Root cause:** The test asserts `result.after > result.before`, where `before = Math.exp(loop.logZoom.target)` captured immediately after `setupMapCamera()`. The `_smoothZoomTo(-1.0, 500, 500)` call adds a positive log-space delta (`ln(1.15) * 1 = +0.1398`), but the new target is clamped to `[minLogZoom, maxLogZoom]` (line 972 of map-camera.js). If a rAF callback fires between `setupMapCamera()` and the `page.evaluate()` that runs the test body, and that callback settles the logZoom spring at a position very close to `MAX_ZOOM` (5.0), then `newLogTarget` gets clamped to `maxLogZoom` and `before === after`.

More likely scenario: the spring loop's `syncFromCamera()` (called during `setupMapCamera` -> `enterMapMode`) sets `logZoom.target = log(coverZoom)`. If the map loaded with a zoom already at `MAX_ZOOM` (e.g., from a previously leaked state via localStorage or a rAF tick that advanced the spring), the clamped target cannot increase.

**Fix:** Either (a) explicitly set `cam.zoom` to a known mid-range value (e.g., 2.0) and call `_applyConstraints()` + `loop.syncFromCamera()` before measuring `before`, or (b) assert `after >= before` with a separate check that `after` matches the expected clamped value. Option (a) is preferable for determinism:

```javascript
test('_smoothZoomTo updates logZoom target within bounds', async ({ page }) => {
  const result = await page.evaluate(() => {
    const cam = __cam();
    cam.zoom = 2.0;
    cam._applyConstraints();
    const loop = cam._springLoop;
    loop.syncFromCamera();
    const before = Math.exp(loop.logZoom.target);
    cam._smoothZoomTo(-1.0, 500, 500);
    const after = Math.exp(loop.logZoom.target);
    return { before, after };
  });
  expect(result.after).toBeGreaterThan(result.before);
});
```

---

### P1 -- Reliability (9 findings)

#### F02. `waitForTimeout(16)` used in timing-sensitive loops

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/speculative-snapback.spec.js`, lines 244 and 307

Two tests use `await page.waitForTimeout(16)` inside loops to simulate per-frame event spacing. This introduces real-wall-clock timing dependency. On a slow CI runner, 16ms may not be long enough for a rAF to fire; on a fast machine, multiple rAFs may fire. The existing project memory explicitly warns: "use `waitForFunction` polling, NOT `waitForTimeout` -- rAF timing varies across runners."

**Impact:** Intermittent failures on CI or under load.

**Fix:** For tests that need inter-event timing, use mocked `performance.now()` (as `dispatchMouseWheelSequence` does) rather than real wall-clock delays. If the goal is "one rAF per event," use `page.evaluate` to dispatch within a single synchronous block with mocked time.

#### F03. `waitForTimeout(100)` in phase5.5-integration.spec.js

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/phase5.5-integration.spec.js`, lines 59 and 91

```javascript
await new Promise(r => setTimeout(r, 100));
```

Used after `sendNow()` to wait for BroadcastChannel propagation before setting up the listener. This is a race condition: if BroadcastChannel delivery takes longer than 100ms (e.g., under GC pressure), the listener might miss the initial sync and the test could behave unexpectedly. Although the test waits for subsequent messages after the listener is set up, the camera state on the Display may not reflect the zoom-in yet.

**Fix:** Replace with a `waitForFunction` that polls the Display camera state to confirm the zoom was received before setting up the message listener.

#### F04. `device-classifier.spec.js` -- no `afterEach` to restore `performance.now`

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/device-classifier.spec.js`

Each test manually calls `h.restore()` at the end, but there is no `afterEach` safety net. If a test throws before reaching `h.restore()`, `performance.now` remains monkey-patched with the stale mock for all subsequent operations on that page (including Playwright's own timing). The `beforeEach` navigates to a fresh page, so cross-test contamination is mitigated by page reload, but within a failing test's cleanup, Playwright internals could misbehave.

**Fix:** Add an `afterEach` that defensively restores `performance.now` if it was patched:

```javascript
test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    if (window.__origPerfNow) {
      performance.now = window.__origPerfNow;
      delete window.__origPerfNow;
    }
  });
});
```

And have `__newClassifier` stash the original: `window.__origPerfNow = performance.now;`.

#### F05. `gesture-state-machine.spec.js` -- `performance.now` mock in try/finally without afterEach

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/gesture-state-machine.spec.js`, lines 164-175 and 257-268

Two tests mock `performance.now` inside `page.evaluate` with try/finally. This is reasonably safe because the finally block runs synchronously within `evaluate`. However, if Playwright's `evaluate` itself throws (e.g., page crash), the mock leaks. Same mitigation as F04 would help.

**Impact:** Low (try/finally is already present), but defense-in-depth is warranted.

#### F06. `dispatchMouseWheelSequence` monkey-patches `performance.now` -- unsafe on test failure

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/helpers.js`, lines 306-344

The helper wraps the mock in try/finally, which is correct for synchronous failures. However, if the `page.evaluate` call is interrupted (browser crash, context destruction), the finally block never executes. This is an edge case, but worth documenting. The current implementation is the best available pattern for in-page mocking.

**Impact:** Very low. Documenting as P1 because it is a recurring pattern across 3+ files.

**Recommendation:** Add a JSDoc comment to `dispatchMouseWheelSequence` noting the try/finally restoration pattern and that page reload is the ultimate safety net.

#### F07. `speculative-snapback.spec.js` line 243 -- real-time event spacing creates non-determinism

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/speculative-snapback.spec.js`, line 230-253

The test "continuous scrolling at boundary is not interrupted by snap-back" dispatches 30 wheel events with `waitForTimeout(16)` between each. The total wall time is ~480ms. During this time, real rAF callbacks are firing the spring loop, which may or may not trigger snap-back depending on rAF scheduling jitter. The assertion (`result.snapping === false`) depends on the snap-back NOT having fired, which requires that the continuous input kept the gesture alive. A slow CI runner where events arrive more slowly could allow the gesture timeout (80ms) to expire between events.

**Impact:** Potential flakiness on slow runners.

**Fix:** Either mock time to ensure deterministic inter-event gaps, or increase the event rate (e.g., `waitForTimeout(8)`) to stay well within the 80ms timeout.

#### F08. `phase6-integration.spec.js` line 229 -- `waitForTimeout(100)` for zoom propagation

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/phase6-integration.spec.js`, line 229

```javascript
await page.waitForTimeout(100);
```

Used after dispatching 10 rapid wheel events to wait for device classification to settle. Should use `waitForFunction` polling on the classifier's device state instead.

#### F09. `speculative-snapback.spec.js` -- tightened timing test has wide tolerance band

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/speculative-snapback.spec.js`, lines 180-194

The test "tightened active timeout fires onGestureEnd within ~80ms" asserts `elapsed > 60 && elapsed < 150`. The tolerance band (60-150ms for an expected 80ms timeout) is nearly 2x wide. While this prevents flakiness, it means a regression that doubles the timeout (160ms) would still pass. The test adds value as a smoke check but not as a precision regression guard.

**Impact:** Low; the test catches gross regressions but not subtle timing drift.

#### F10. `panToBoundary` helper uses a fixed 200-iteration loop

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/helpers.js`, lines 294-303

The helper calls `panBy(dx, 0)` 200 times to reach a boundary. If the map/viewport ratio changes or zoom level changes, 200 iterations may not be enough (test silently operates at a non-boundary position) or may be excessive (wasted computation). The helper does not verify that the boundary was actually reached.

**Fix:** Add a post-loop assertion or return a `reachedBoundary` flag:

```javascript
const atBoundary = (dir === 'right')
  ? cam.x <= 0.01                     // right boundary reached
  : cam.x >= cam.mapW - cam.viewportW / cam.zoom - 0.01;
return { x: cam.x, y: cam.y, atBoundary };
```

---

### P2 -- Maintainability (12 findings)

#### F11. Phase-reference filenames (6 files)

The following files use "phase" in their filenames, which references internal project phases rather than describing behavior:

| File | Suggested Rename |
|------|-----------------|
| `tests/phase6-unit.spec.js` | `tests/camera-elastic-model.spec.js` |
| `tests/phase6-integration.spec.js` | `tests/camera-integration.spec.js` |
| `tests/phase-s5-integration.spec.js` | `tests/spring-physics-integration.spec.js` |
| `tests/phase5.5-integration.spec.js` | `tests/cross-window-sync.spec.js` |
| `tests/phase5.5-unit.spec.js` | `tests/velocity-tracker-unit.spec.js` |
| (N/A -- outside scope) `tests/phase5-integration.spec.js` | `tests/fly-to-integration.spec.js` |

#### F12. Phase-reference describe blocks (4 occurrences)

| File | Line | Current | Suggested |
|------|------|---------|-----------|
| `phase-s5-integration.spec.js` | 9 | `'Phase S5: Unified Spring Physics'` | `'Unified spring physics'` |
| `phase5.5-integration.spec.js` | 12 | `'sendNow() DOM click fidelity'` | OK (no phase ref) |
| `phase5.5-unit.spec.js` | 57 | `'Phase 4 protocol...'` (in camera-sync.spec.js, not in scope) | N/A |
| Comment at `phase-s5-integration.spec.js` line 6 | -- | `// Phase S5 Integration Tests` | Remove comment |

#### F13. Helper function `waitForDisplayPhase5`

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/helpers.js`, line 266

The name `waitForDisplayPhase5` leaks implementation phase naming into the public helper API. It waits for `flyToAnimator != null`.

**Fix:** Rename to `waitForDisplayFlyTo` or `waitForFlyToAnimator`.

#### F14. `injectAnimationWaitHelper` is defined but unused in reviewed files

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/helpers.js`, lines 210-230

The `injectAnimationWaitHelper` function is defined and exported but not used in any of the 13 reviewed test files. It is used in `fly-to-animator.spec.js` and `camera-presets.spec.js` (outside scope), so it is not dead code globally, but it could benefit from a JSDoc note about which tests use it.

#### F15. Duplicate test: elastic ceiling tested in two files

**Files:**
- `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/overflow-drain.spec.js`, lines 67-118 ("Elastic ceiling" describe)
- `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/phase-s5-integration.spec.js`, lines 76-95 ("elastic ceiling: aggressive overflow stays within 150/zoom world-space")

The `overflow-drain.spec.js` version is more thorough (also tests "normal overflow is below ceiling"). The `phase-s5-integration.spec.js` version is a near-duplicate.

**Fix:** Remove the duplicate from `phase-s5-integration.spec.js` or reference `overflow-drain.spec.js` as the canonical location.

#### F16. Duplicate test: scroll preference "pan mode" tested in two files

**Files:**
- `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/scroll-preference.spec.js`, lines 10-41
- `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/phase-s5-integration.spec.js`, lines 97-123

Both test that mouse-like wheel events in `'pan'` mode do not change zoom. The `scroll-preference.spec.js` version is more thorough (also checks `logZoom.target` unchanged). The `phase-s5-integration.spec.js` version is a subset.

**Fix:** Remove the duplicate from `phase-s5-integration.spec.js`.

#### F17. `phase6-unit.spec.js` -- `rubberBand function` describe is misleadingly named

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/phase6-unit.spec.js`, line 261

The describe block says "rubberBand function" but the test actually calls `_feedElasticOverflow`, which internally uses `rubberBand`. This tests the integration of `rubberBand` through `_feedElasticOverflow`, not the `rubberBand` function directly.

**Fix:** Rename to `'Elastic overflow diminishing returns'` or test `rubberBand()` directly by importing it.

#### F18. `__capturePanBy` helper is defined but unused in the 13 reviewed files

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/helpers.js`, lines 120-128

`window.__capturePanBy` is injected by `injectTestAccessors` but not used in any of the 13 reviewed test files. Either it is used outside the review scope (check other test files) or it is dead code.

#### F19. `SCREENSHOT_CONFIG` exported but unused in reviewed camera tests

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/helpers.js`, lines 29-33

Likely used by visual regression tests outside scope. Not a problem, but the helpers file is becoming a catch-all. Consider splitting into `helpers-visual.js` and `helpers-camera.js` if the file grows further.

#### F20. Missing JSDoc on `panToBoundary` parameters

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/helpers.js`, lines 288-303

The docstring says `@param {'left'|'right'} direction` but the implementation only pans along X. For tests that need vertical boundary testing, this helper would need extension. The current name/docs do not mention the X-only limitation.

#### F21. `spring-overshoot.spec.js` -- `solveSpring` duplicated 5 times

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/spring-overshoot.spec.js`

The closed-form spring solver `function solveSpring(disp, vel, t)` is copy-pasted in 5 separate `page.evaluate` blocks. This could be extracted into an in-page helper injected once in `beforeEach`.

#### F22. `phase5.5-unit.spec.js` -- momentum decay tests are pure math, not Playwright tests

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/phase5.5-unit.spec.js`, lines 95-138

The "Momentum exponential decay" tests compute `Math.exp(-FRICTION * time)` inside `page.evaluate` and assert the results. These are pure arithmetic tests that do not exercise any application code. They verify the developer's understanding of the decay formula, not the implementation.

**Impact:** These tests add CI time without testing production code. They would be more appropriate as comments or as a unit test file that runs in Node.js without Playwright.

---

### P3 -- Nit (7 findings)

#### F23. `expectDensityReduces` has an orphaned JSDoc fragment

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/helpers.js`, lines 48-50

The JSDoc block for `expectDensityReduces` (lines 43-50) is followed by a separate JSDoc block for `gotoVTT` (lines 51-53), making it look like `expectDensityReduces` has two doc blocks. The actual function definition is on line 147. Lines 43-50 are an orphaned JSDoc that was left behind when the function was moved.

**Fix:** Remove lines 43-50 (the orphaned JSDoc) since the function at line 147 is self-documenting.

#### F24. `gesture-state-machine.spec.js` -- semicolon-separated assertions on single lines

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/gesture-state-machine.spec.js`, e.g., lines 96, 105, 139, 148

```javascript
expect(r.r1).toBe(true); expect(r.r2).toBe(true); expect(r.c).toBe('SCROLL_PAN');
```

Multiple assertions packed on one line reduces readability and makes it harder to identify which assertion failed in CI output.

**Fix:** One assertion per line.

#### F25. `phase5.5-unit.spec.js` -- VelocityTracker tests wait for `camera != null`

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/phase5.5-unit.spec.js`, lines 9-11

The `beforeEach` waits for `mapRenderer.camera` even though the tests only import `VelocityTracker` from `map-camera.js`. The VelocityTracker is a standalone class; the camera wait is unnecessary overhead. The tests could use a lighter boot (just `gotoVTT` + dynamic import).

#### F26. `axis-spring.spec.js` -- test names use parenthetical formatting inconsistently

Some tests use parenthetical notation (`(C1-continuous)`, `(60fps vs 30fps within 0.01)`) while others don't. Minor style inconsistency.

#### F27. `overflow-drain.spec.js` -- tests call `_updateCumulativeOverflow` directly

The tests at lines 11-65 test the `_updateCumulativeOverflow` method in isolation by calling it as a pure function with a cumulative parameter. This is clean unit testing but the method signature (`cam._updateCumulativeOverflow(overflow, input, cumulative)`) is an internal API that may change. A brief comment noting this is intentional white-box testing would help future maintainers.

#### F28. `camera-spring-loop.spec.js` -- mock camera `_applyConstraints` is overly simple

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/camera-spring-loop.spec.js`, lines 25-33

The mock camera's `_applyConstraints` does simple clamping but does not emit `camera:changed` like the real implementation. This is fine for the current tests (which only check position convergence) but could mask bugs if future tests check event emission during spring ticks.

#### F29. `scroll-preference.spec.js` -- "auto mode" test assertion is disjunctive

**File:** `/Users/austinrojan/Projects/puzzle-box-job/.worktrees/camera-coderabbit-review/tests/scroll-preference.spec.js`, line 92

```javascript
expect(result.animating || result.targetChanged).toBe(true);
```

Disjunctive assertions (`A || B`) weaken the test -- it passes if either condition holds, making it harder to detect regressions where one path breaks but the other compensates. Split into two tests or assert the specific expected condition.

---

## Coverage Gaps

The following source-code paths have **no test coverage** in the 13 reviewed files:

| Source Path | Risk | Recommendation |
|-------------|------|----------------|
| `_cancelPan()` (map-camera.js:1440) | Medium -- called by blur, mouseleave, visibilitychange. Resets gesture, cancels coast, triggers zero-velocity snap-back. | Add test: blur during active drag cancels pan and triggers snap-back |
| `fitContain()` (map-camera.js:622) | Low -- called by Shift+1 keyboard shortcut. Intentionally bypasses `_applyConstraints`. | Add test: `fitContain` sets zoom below coverZoom and centers map |
| `deserialize()` (map-camera.js:1477) | Medium -- used by BroadcastChannel sync to restore camera state. Calls `_applyConstraints` after restoring. | Add test: `deserialize` with partial data, with out-of-bounds values |
| `_showCooperativeOverlay()` (map-camera.js:1289) | Low -- cosmetic overlay for iframe embedding | Optional: visual test or skip |
| Visibility-change snap-back (map-camera.js:1323-1332) | Medium -- if tab is backgrounded with stranded elastic offset, snap-back fires on return. rAF does not fire in hidden tabs, making this important for real usage | Add test: set elastic offset, simulate `visibilitychange` hidden then visible, verify snap-back |
| `KeyboardController` zoom keys (+/-/Shift+0/Shift+1) (map-camera.js:287-314) | Medium -- discrete zoom and preset keys that bypass the spring-based smooth zoom | Add tests: `+` key zooms in, `-` key zooms out, `Shift+0` calls fitCover, `Shift+1` calls fitContain |
| `_startInertialCoast` with zero velocity (below threshold) | Low -- `INERTIA_THRESHOLD` check at line ~853 should skip coast | Covered indirectly by `_cancelPan` testing zero-velocity path |

---

## Vacuous Pass Analysis

The review checked all assertions of the form `before === after` or `changed === false`:

| Test | Pattern | Vacuous? |
|------|---------|----------|
| `mouse wheel zoom denied during SCROLL_PAN does not change zoom` (GSM, line 378) | `cam.zoom !== before` should be false | **Not vacuous** -- the test explicitly establishes `SCROLL_PAN` state first, and the assertion verifies the denied request had no effect. The precondition (SCROLL_PAN active) enables the behavior. |
| `pan mode: mouse-like wheel events do NOT change zoom` (scroll-preference, line 10) | `targetChanged === false` | **Not vacuous** -- classifier is pre-seeded to 'mouse', preference set to 'pan'. Without the preference, these events would zoom. |
| `fast trackpad scroll does NOT trigger zoom` (phase6-integration, line 207) | `after === before` | **Not vacuous** -- this is a regression test for bug #4 where fast trackpad was misclassified as mouse. The precondition (rapid timing) is what makes it a trackpad. |
| `_feedElasticOverflow does nothing when _gestureActive is false` (phase6-unit, line 161) | `offsetX === 0, offsetY === 0` | **Borderline** -- the test verifies the guard, but only because `_gestureActive` starts as `false` by default. An explicit setup step `cam._gestureActive = false;` is already present, so this is intentional. |
| `small deltas at boundary...` (speculative-snapback, line 285) | `elasticX === 0` | **Not vacuous** -- the test verifies that mid-field deltas (away from boundary) do NOT trigger elastic offset. Camera is positioned mid-map. |

**Conclusion:** No vacuous passes detected. All `before === after` assertions have meaningful preconditions.

---

## `dispatchMouseWheelSequence` Safety Assessment

The helper (helpers.js:305-344) monkey-patches `performance.now` within a synchronous try/finally block inside `page.evaluate`. Analysis:

1. **Normal execution:** `performance.now` is restored in the `finally` block. Safe.
2. **Exception during dispatch:** The `finally` block still executes. Safe.
3. **Page crash during evaluate:** The `finally` block does NOT execute (the page context is destroyed). However, the page is also destroyed, so the leaked mock has no effect. Safe.
4. **Playwright timeout during evaluate:** Playwright kills the evaluate and the page may be in an inconsistent state, but subsequent test navigation (`beforeEach` -> `gotoVTT`) reloads the page. Safe in practice.

**Verdict:** The pattern is as safe as it can be within the Playwright execution model. No changes needed, but the existing comment (lines 274-276) could be expanded to note the page-reload safety net.

---

## Recommendations (prioritized)

1. **Fix F01** -- Pin zoom to mid-range in the flaky `_smoothZoomTo` test. This is the only confirmed P0 and can be fixed in one line.

2. **Replace `waitForTimeout` calls** (F02, F03, F07, F08) -- Four instances of real-wall-clock delays that should use `waitForFunction` or mocked time.

3. **Add `afterEach` restore** for `performance.now` mocks (F04, F05) -- Defense-in-depth against leaked mocks.

4. **Add coverage for `_cancelPan`, `deserialize`, visibility-change snap-back, and keyboard zoom keys** (coverage gaps table) -- These are medium-risk untested paths.

5. **Rename phase-reference files and describe blocks** (F11, F12, F13) -- Batch rename for naming hygiene.

6. **Remove duplicate tests** (F15, F16) -- `phase-s5-integration.spec.js` contains redundant copies of tests that exist in more thorough form elsewhere.

7. **Extract `solveSpring` helper** (F21) and **split disjunctive assertion** (F29) -- Minor improvements to test clarity.

---

## Files Reviewed

| # | File | Tests | Lines | Verdict |
|---|------|-------|-------|---------|
| 1 | `tests/speculative-snapback.spec.js` | 13 | 397 | Good coverage; 2 `waitForTimeout` instances (F02, F07) |
| 2 | `tests/gesture-state-machine.spec.js` | 37 | 426 | Excellent coverage of GSM rules; performance.now mock safety (F05) |
| 3 | `tests/phase6-unit.spec.js` | 16 | 279 | Flaky test (F01); rubberBand naming (F17) |
| 4 | `tests/phase6-integration.spec.js` | 7 | 350 | Solid; 1 `waitForTimeout` (F08) |
| 5 | `tests/camera-spring-loop.spec.js` | 6 | 172 | Clean; mock camera simplification noted (F28) |
| 6 | `tests/axis-spring.spec.js` | 7 | 184 | Excellent physics tests; frame-rate independence well tested |
| 7 | `tests/device-classifier.spec.js` | 12 | 242 | Strong; missing afterEach (F04) |
| 8 | `tests/overflow-drain.spec.js` | 7 | 118 | Clean unit tests |
| 9 | `tests/spring-overshoot.spec.js` | 10 | 463 | Thorough; `solveSpring` duplication (F21) |
| 10 | `tests/phase-s5-integration.spec.js` | 5 | 151 | 2 duplicate tests (F15, F16) |
| 11 | `tests/scroll-preference.spec.js` | 4 | 120 | Clean; disjunctive assertion (F29) |
| 12 | `tests/phase5.5-integration.spec.js` | 6 | 225 | Good cross-window tests; 2 `setTimeout` delays (F03) |
| 13 | `tests/phase5.5-unit.spec.js` | 12 | 257 | Pure math tests (F22); unnecessary camera wait (F25) |
| 14 | `tests/helpers.js` | -- | 344 | Orphaned JSDoc (F23); phase naming (F13) |

**Total findings:** 29 (1 P0, 9 P1, 12 P2, 7 P3)
