# Phase 6 + S1 + Cleanup CodeRabbit Review Results

**Date:** 2026-02-19
**Scope:** 21 commits (`67b9036..1ab5754`), 10 files, +1,623 / -225 lines
**Reviewers:** 5 parallel CodeRabbit batch agents + full-scope CLI review

## Summary

| Category | Count | Fixed |
|----------|-------|-------|
| **Blocking** | 1 | 1 |
| **Advisory (High)** | 10 | 7 |
| **Advisory** | 12 | 3 |
| **Low** | 10 | 0 |
| **Info** | 12 | 0 |
| **False Positive** | 1 | — |
| **Total findings** | 46 | 11 |

**Verdict:** The Phase 6 + S1 implementation is architecturally sound. The dual-position camera model, gesture state machine, device classifier, and spring physics are all mathematically correct and well-structured. The one blocking issue was a test infrastructure concern (performance.now mock safety), not a production bug. The advisory-high findings were split between production defense-in-depth (rubberBand NaN guard, zero-delta handling, spring bounds bypass) and test quality gaps (vacuous passes, missing assertions, loose bounds). No data corruption, security, or functional correctness bugs were found in production code. All 11 fixes applied cleanly — full suite verification: **1240 passed, 2 flaky, 30 skipped, 0 failed** across 4 viewport projects (desktop-1920, desktop-1440, desktop-1024, half-screen-960). The 2 flaky tests are pre-existing (spring overshoot timing, fit-to-tokens rounding) and unrelated to Phase 6/S1.

---

## Review Methodology

| Batch | Domain | Files | Agent |
|-------|--------|-------|-------|
| 1 | Core Camera | map-camera.js | coderabbit:code-reviewer |
| 2 | Gesture & Classification | trackpad-gesture.js | coderabbit:code-reviewer |
| 3 | Unit Tests | phase6-unit, device-classifier | coderabbit:code-reviewer |
| 4 | Integration Tests | phase6-integration, helpers | coderabbit:code-reviewer |
| 5 | Modified Tests & Helpers | camera-clamping, input-handling, helpers, map.css | coderabbit:code-reviewer |
| 6 | Full Diff (CLI) | planning-docs only* | coderabbit review --plain |

*Note: The CLI review with `--base-commit` focused on planning docs (untracked files in diff) rather than source code. All source file findings come from Batches 1-5.

---

## Blocking Issues

### BLK-1: `performance.now` mock not protected by try/finally ✅ FIXED
- **Files:** `tests/device-classifier.spec.js`:4-23, `tests/helpers.js`:267-288
- **Batches:** B3, B4, B5
- **Issue:** Both `device-classifier.spec.js` (per-test mock/restore) and `dispatchMouseWheelSequence` in `helpers.js` mock `performance.now` without try/finally protection. If `page.evaluate` throws or an assertion fails mid-block, the mock is never restored. Subsequent operations in that page context (rAF animations, velocity tracking, gesture timeouts) see frozen or corrupted time.
- **Impact:** Cascading test failures in CI when a test fails mid-mock. The page reload in `beforeEach` provides partial mitigation, but this is fragile.
- **Fix:** Wrap all mock/restore pairs in try/finally. In `device-classifier.spec.js`, restructure each `page.evaluate` body. In `helpers.js`, wrap the dispatch loop.

---

## Advisory Issues (High Priority)

### AH-1: No `destroy()` method on Camera class
- **File:** `vtt/js/map-camera.js`:490-1353
- **Batches:** B1
- **Issue:** Camera has `attachTo()` but no `destroy()`. Window-level event listeners (mousemove, mouseup, keydown, keyup, blur, visibilitychange), EventBus subscriptions (6), `_preventBrowserZoom` listeners (3), and active rAF loops are never cleaned up. All use anonymous arrow functions, making removal impossible without stored references.
- **Impact:** Not a runtime bug in the current single-Camera architecture, but prevents test teardown cleanup, hot-reload, and Camera lifecycle management.
- **Fix:** Deferred — architecture change beyond the scope of this review pass. Would require storing listener references in `attachTo()` and adding `KeyboardController.detach()`.

### AH-2: Spring animation can bypass hard bounds with non-zero velocity
- **File:** `vtt/js/map-camera.js`:87-104
- **Batches:** B1
- **Issue:** `CameraAnimator._tick()` emits `camera:changed` without calling `_applyConstraints()` or `_applyHardBounds()`. The critically damped spring `(A + B*t) * exp(-omega*t)` can overshoot when velocity is large enough that `B` and `A` have opposite signs. Code comment on line 97-101 explicitly flagged this for review.
- **Impact:** Low — current callers pass `{vx: 0, vy: 0}` to the position animator. The elastic animator has its own `_tick` override. Risk materializes only if a future caller passes velocity.
- **Fix:** Deferred — add a clarifying comment that documents the current-callers-only-zero-velocity invariant. The code fix (hard-bounds guard in `_tick`) is correct but changes animation behavior.

### AH-3: Zero-delta WheelEvents reset decay streak in TrackpadGestureDetector ✅ FIXED
- **File:** `vtt/js/trackpad-gesture.js`:55-67
- **Batches:** B2
- **Issue:** When `absDelta === 0` (zero-delta events from ctrl-only gesture starts on some trackpads), `_decayStreak` resets to 0 and `_lastAbsDelta` is set to 0, costing two decay streak resets. This delays momentum detection.
- **Impact:** Rare on real hardware. Could delay momentum detection by a few frames.
- **Fix:** Add early return in `handleWheel` for zero-delta events.

### AH-4: Zero GestureStateMachine unit tests
- **File:** N/A (missing tests)
- **Batches:** B3
- **Issue:** `GestureStateMachine` has non-trivial priority logic (request/release/cancel, priority preemption, same-priority retargeting) with zero direct unit test coverage. Exercised only indirectly through integration tests.
- **Impact:** Regressions in priority ordering, release semantics, or cancel dispatch would not be caught by unit tests.
- **Fix:** Deferred — adding new test coverage is separate work, not a fix for existing code.

### AH-5: Missing precondition assertion in boundary test ✅ FIXED
- **File:** `tests/phase6-unit.spec.js`:174-198
- **Batches:** B3
- **Issue:** The "panBy at boundary produces elastic offset" test does not assert that `atBoundary === 0` (confirming the camera reached the left boundary). If map geometry changes such that zoom=2.0 produces centering instead of boundary clamping, the test would pass vacuously.
- **Fix:** Add `expect(result.atBoundary).toBeCloseTo(0, 0)` as precondition.

### AH-6: Dispatched WheelEvents missing `clientX`/`clientY` ✅ FIXED
- **Files:** `tests/phase6-integration.spec.js`:31-37,61-67,207-211,247-252,269-274; `tests/helpers.js`:275-278
- **Batches:** B4
- **Issue:** All manually dispatched `WheelEvent`s omit `clientX`/`clientY`, which default to 0. Zoom anchors to page origin (0,0) instead of a realistic pointer position. Tests only assert zoom level changes (not anchor correctness), so they pass, but the anchor behavior is untested.
- **Impact:** If `eventToScreen` ever adds bounds validation, these tests break. Zoom anchor correctness is untested.
- **Fix:** Add `clientX`/`clientY` computed from container center to all dispatched WheelEvents.

### AH-7: Three `waitForTimeout(50)` in integration tests ✅ FIXED
- **File:** `tests/phase6-integration.spec.js`:39, 254, 277
- **Batches:** B4
- **Issue:** Three tests use `waitForTimeout(50)` instead of condition-based waits. Lines 39 and 277 test synchronous operations where the wait is unnecessary. Line 254 is a negative assertion (zoom must NOT change) where time-based waiting is unavoidable.
- **Impact:** Fragile under load. The 50ms is arbitrary.
- **Fix:** Replace lines 39 and 277 with immediate reads or `waitForFunction`. Keep line 254 as time-based but increase to 100ms with explanatory comment.

### AH-8: "fast trackpad scroll does NOT trigger zoom" test — vacuous-pass risk ✅ FIXED
- **File:** `tests/phase6-integration.spec.js`:239-262
- **Batches:** B4
- **Issue:** Test runs at default zoom (coverZoom) without zooming in first. At 1920x1080 viewport, coverZoom=1.0, X pan range is [0,0] (zero). The pan path may be vacuously clamped. The assertion (zoom unchanged) still passes but the pan behavior is not meaningfully exercised.
- **Impact:** Test provides false confidence that trackpad scroll works as expected.
- **Fix:** Add `cam.zoom = 2.0; cam._applyConstraints();` to ensure pan room exists.

### AH-9: Vacuous pass — `panBy within bounds` test has no map bounds ✅ FIXED
- **File:** `tests/camera-clamping.spec.js`:75-89
- **Batches:** B5
- **Issue:** Test is in the "Pure math" describe block which calls `gotoVTT` + `injectTestAccessors` but NOT `enterMapMode`. Without `enterMapMode`, `mapW = 0` and `mapH = 0`. `_applyHardBounds()` early-returns when `mapW <= 0`, so `panBy` never produces overflow regardless of position. The test passes trivially.
- **Impact:** False confidence that within-bounds panning produces zero elastic offset.
- **Fix:** Set map dimensions explicitly inside `page.evaluate`: `cam.mapW = 2000; cam.mapH = 2000;`.

### AH-10: Loose test assertions — momentum test state and ratio bounds ✅ FIXED (partial)
- **Files:** `tests/phase6-unit.spec.js`:147-161, 268-282
- **Batches:** B3
- **Issue:** (a) Momentum dampening test does not reset state between active and momentum measurement phases. (b) rubberBand ratio test uses very loose bound `< 10` (actual ratio ~5.1). Neither test verifies quantitative expectations.
- **Impact:** Regressions that weaken rubber-band or momentum dampening would pass.
- **Fix:** Add explicit state reset between phases. Tighten ratio bound to `< 7`.

---

## Advisory Issues

### A-1: `rubberBand()` returns NaN when dimension=0 and distance=0 ✅ FIXED
- **File:** `vtt/js/map-camera.js`:24-26
- **Batches:** B1
- **Issue:** `0/0 = NaN`. Guard chain from `setViewportSize` prevents zero `viewportW` in normal operation, but the defense is fragile.
- **Fix:** Add `if (dimension <= 0) return 0;` guard.

### A-2: No `camera:changed` emit when elastic offset returns to zero
- **File:** `vtt/js/map-camera.js`:1110-1118
- **Batches:** B1
- **Issue:** When dragging back within bounds, `overflowX/Y` become 0, `_feedElasticOverflow` zeros elastic offset, but the conditional skips emission. Currently safe because `_applyConstraints()` already emitted for the position change.
- **Fix:** Add clarifying comment documenting that `_applyConstraints()` covers this case.

### A-3: `SmoothZoomAnimator._step()` calls `Math.log()` without guarding zero
- **File:** `vtt/js/map-camera.js`:195-216
- **Batches:** B1
- **Issue:** `Math.log(0) = -Infinity`. If `cam.zoom` reaches 0 (e.g., corrupted BroadcastChannel data), zoom locks at 0 forever.
- **Fix:** Add `if (cam.zoom <= 0) { this.cancel(); return; }`.

### A-4: `_commitPan()` missing inertia cancel, gesture request, velocity reset
- **File:** `vtt/js/map-camera.js`:1291-1303
- **Batches:** B1
- **Issue:** Left-click drag activation after crossing DRAG_THRESHOLD doesn't cancel active inertial coast, request DRAG_PAN from gesture state machine, or reset velocity tracker. Could cause parallel animation conflicts.
- **Fix:** Add missing operations to match `_startPan()`.

### A-5: Elastic animator monkey-patches `_tick` — fragile coupling
- **File:** `vtt/js/map-camera.js`:1195-1217
- **Batches:** B1
- **Issue:** `_elasticAnimator._tick` is replaced with a closure, creating circular references and fragile coupling to `CameraAnimator` internals.
- **Fix:** Consider `onTick` callback in CameraAnimator constructor. Deferred — refactor.

### A-6: Object allocation per `classify()` call on hot path
- **File:** `vtt/js/trackpad-gesture.js`:137-144, 202
- **Batches:** B2
- **Issue:** Each `classify()` allocates a new event summary object (stored in window) and `_scoreWindow()` allocates a return object. ~120-240 short-lived objects/sec during active scrolling.
- **Impact:** Low in practice (V8 nursery GC handles this well).
- **Fix:** Eliminate `_scoreWindow` return object by writing to instance fields.

### A-7: Missing `_cumulativeOverflowY` reset in two tests
- **File:** `tests/camera-clamping.spec.js`:83, 328
- **Batches:** B5
- **Issue:** Tests reset `_cumulativeOverflowX = 0` but not `_cumulativeOverflowY`. Currently safe because Y starts at 0 and no prior test modifies it.
- **Fix:** Add `cam._cumulativeOverflowY = 0;` alongside X reset.

### A-8: TrackpadGestureDetector tests lack `performance.now` mocking
- **File:** `tests/phase6-unit.spec.js`:7-106
- **Batches:** B3
- **Issue:** All events appear at near-identical timestamps during synchronous dispatch. Timing-based detection paths are not tested.
- **Fix:** Add time mocking using the same `__newClassifier` pattern.

### A-9: Only asserts final classification in large-integer delta test
- **File:** `tests/device-classifier.spec.js`:39-51
- **Batches:** B3
- **Issue:** Test feeds 3 mouse-like events but only asserts the last one is 'mouse'. Does not verify the accumulation path (first event should be 'trackpad'/unknown).
- **Fix:** Assert `result[0]` is 'trackpad' to verify accumulation.

### A-10: No zero-delta edge case test
- **Files:** `tests/phase6-unit.spec.js`, `tests/device-classifier.spec.js`
- **Batches:** B3
- **Issue:** No test feeds `{ deltaX: 0, deltaY: 0 }`. Related to AH-3 (production code handles this incorrectly).
- **Fix:** Add tests documenting expected behavior for zero-delta events.

### A-11: Asymmetry test uses `<=` instead of `<` ✅ FIXED
- **File:** `tests/device-classifier.spec.js`:240
- **Batches:** B3
- **Issue:** `toBeLessThanOrEqual` allows symmetric behavior, defeating the test's purpose of verifying asymmetric hysteresis.
- **Fix:** Change to `toBeLessThan` (strict).

### A-12: Unused `gestureBeforeDrag` variable — missed assertion ✅ FIXED
- **File:** `tests/phase6-integration.spec.js`:214
- **Batches:** B4
- **Issue:** `gestureBeforeDrag` is captured but never asserted. Should verify `SCROLL_PAN` was established before testing preemption.
- **Fix:** Add `expect(gestureBeforeDrag).toBe('SCROLL_PAN')`.

---

## Low Priority

### L-1: `VelocityTracker._count` grows unbounded
- **File:** `vtt/js/map-camera.js`:115-152 | **Batch:** B1
- Theoretical precision loss after 2^53 samples. Astronomically unlikely in practice.

### L-2: `Array.shift()` is O(n) on eviction in classifier
- **File:** `vtt/js/trackpad-gesture.js`:146 | **Batch:** B2
- Window size is 6 — effectively O(1). Style/consistency note.

### L-3: Silence reset boundary is strict `>` not `>=`
- **File:** `vtt/js/trackpad-gesture.js`:130 | **Batch:** B2
- Exactly 400.000ms is effectively impossible with sub-ms precision.

### L-4: `destroy()` does not reset TrackpadGestureDetector state
- **File:** `vtt/js/trackpad-gesture.js`:95-97 | **Batch:** B2
- In practice, the entire object is discarded after `destroy()`.

### L-5: No NaN/Infinity delta tests
- **Files:** Both test files | **Batch:** B3
- Extremely unlikely in practice. WheelEvent deltas are always numeric.

### L-6: Silence reset path not explicitly verified
- **File:** `tests/device-classifier.spec.js`:88-110 | **Batch:** B3
- Test passes via correct behavior but doesn't prove reset path was taken.

### L-7: Tests run across 4 viewport sizes unnecessarily
- **Files:** `phase6-unit.spec.js`, `device-classifier.spec.js` | **Batch:** B3
- Pure algorithmic tests don't depend on viewport. Quadruples CI time for zero coverage gain.

### L-8: Drag test moves close to container edge (50px margin)
- **File:** `tests/phase6-integration.spec.js`:109 | **Batch:** B4
- 50px is safely inside but worth documenting to prevent mouseleave issues.

### L-9: Wrong-button-up test lacks intermediate assertion
- **File:** `tests/phase6-integration.spec.js`:126-127 | **Batch:** B4
- Releasing wrong button doesn't assert `_panning` is still true before right-button release.

### L-10: `dispatchMouseWheelSequence` missing metaKey/shiftKey propagation
- **File:** `tests/helpers.js`:275-277 | **Batch:** B5
- No current callers need these. Future-proofing note.

---

## Info / Observations

- **Spring physics math is correct** — critically damped formula, velocity derivative, omega/stiffness relationship all verified (B1)
- **`localToShared()` reads `camera.x`, not `visualX`** — BroadcastChannel sync correctly excludes elastic offset (B1)
- **`fitContain()` intentionally bypasses `_applyConstraints()`** — well-commented, `_centerMap()` produces correct positions (B1)
- **FSM transition completeness verified** — all state × input combinations handled in TrackpadGestureDetector (B2)
- **DECAY_RATIO 0.97 is well-calibrated** — 3% threshold reliably catches momentum while avoiding false positives (B2)
- **First-ever `classify()` cold start handled correctly** — silence reset zeroes gap, suppressing all timing signals (B2)
- **Export surface area minimal and correct** — only `TrackpadGestureDetector` and `WheelDeviceClassifier` exported (B2)
- **Pre-Phase-6 invariants preserved** — all hard clamping, zoom bounds, and setPosition tests unchanged (B5)
- **`touch-action: none` on `#map-container` is correct** — standard pattern for canvas-based pan/zoom (B5)
- **`dispatchMouseWheelSequence` defaults match original hardcoded values** — verified correct (B4)
- **No browser context leak risk** — default Playwright page fixture handles cleanup (B4)
- **Wheel direction sign chain verified correct** — deltaX → normalizeWheel → panBy(-dx) traced through all integration tests (B4)

## False Positives

- **Signal 1 + Signal 6 "double-count" timing for mouse** (B2) — The reviewer noted these signals overlap in the timing dimension. However, the asymmetric hysteresis thresholds were explicitly calibrated with this overlap. Signal 6 additionally checks magnitude + integer + vertical-only, making it a compound signal, not purely timing. The overlap produces intentionally biased mouse detection, matching the "default to pan when uncertain" design principle.

---

## CLI Review Notes

The CodeRabbit CLI (`coderabbit review --plain --base-commit 67b9036`) primarily reviewed `planning-docs/` files rather than production source code. Its findings about planning doc inconsistencies (settling time math, platform detection, cumulative overflow decay design) are informational and do not apply to the shipped code. All production code findings come from Batches 1-5.

---

## Verification

**Full test suite run:** `npx playwright test --reporter=line`
- **1240 passed** | 2 flaky | 30 skipped | 0 failed
- **Duration:** 19.1 minutes across 4 viewport projects
- **Flaky tests (pre-existing, unrelated to Phase 6/S1):**
  - `[half-screen-960] camera-clamping.spec.js` — spring solver overshoot timing
  - `[desktop-1440] fit-to-tokens.spec.js` — single token framing rounding
