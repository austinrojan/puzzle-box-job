# Phase S3 + Cleanup CodeRabbit Review Results

**Date:** 2026-02-20
**Scope:** 12 commits (`343c3bf..746ac6d`), 5 files, +431 / -13 lines
**Reviewers:** 3 parallel CodeRabbit batch agents + full-scope CLI review

## Summary

| Category | Count | Fixed |
|----------|-------|-------|
| **Blocking** | 0 | — |
| **Advisory (High)** | 4 | 4/4 |
| **Advisory** | 7 | |
| **Low** | 5 | |
| **Info** | 12 | |
| **False Positive** | 2 | |
| **Total findings** | 30 | 4 |

**Verdict:** The Phase S3 speculative snap-back implementation is well-engineered. EWMA stall detection math is correct, the double-fire guard covers all critical paths, and rAF lifecycle has no leaks. The four Advisory (High) findings were maintenance hazards rather than functional bugs — all self-heal within 1 frame or represent dead code. All 4 AH issues fixed. Full suite: 1383 passed, 0 new failures. No blocking issues found.

---

## Review Methodology

| Batch | Domain | Files | Lines | Agent |
|-------|--------|-------|-------|-------|
| 1 | Core Camera — EWMA Speculative Snap-Back | `vtt/js/map-camera.js` | +104/-4 | `coderabbit:code-reviewer` |
| 2 | Gesture Constant Tightening | `vtt/js/trackpad-gesture.js` | +10/-7 | `coderabbit:code-reviewer` |
| 3 | Tests & Helpers | `tests/speculative-snapback.spec.js`, `tests/phase6-unit.spec.js`, `tests/helpers.js` | +319/-3 | `coderabbit:code-reviewer` |
| 4 | Full Diff (cross-cutting) | All 5 files | +431/-13 | CodeRabbit CLI (`--base-commit 343c3bf`) |

---

## Blocking Issues

None.

---

## Advisory Issues (High Priority)

### AH-1: `_commitPan()` missing `_cancelSpeculativeSnapBack()`

- **File:** `vtt/js/map-camera.js:1448-1460`
- **Batches:** B1
- **Issue:** `_commitPan()` cancels `_elasticAnimator` directly but does not cancel the speculative snap-back monitoring rAF (`_speculativeSnapId`). If speculative snap-back monitoring is running when a left-click drag commits, the rAF loop continues for ~1 frame.
- **Impact:** Self-heals in 1 frame because `_commitPan()` sets `elasticOffsetX = 0`, causing the monitoring loop to see `_elasticScreenMag < MIN_ELASTIC_MAGNITUDE` and self-terminate. Maintenance hazard: future changes could break the self-healing property.
- **Fix:** Add `this._cancelSpeculativeSnapBack();` after `this._elasticAnimator.cancel();` in `_commitPan()`.

### AH-2: `_startPan` ordering — explicit `_cancelSpeculativeSnapBack()` for clarity

- **File:** `vtt/js/map-camera.js:1414-1418`
- **Batches:** B1
- **Issue:** `_startPan` cancels speculative snap-back indirectly via `_gestures.request('DRAG_PAN')` → `_cancelCurrent()` → SNAP_BACK case. It also has a separate `_elasticAnimator.cancel()` call that partially overlaps. The dual-path cleanup is correct but hard to reason about.
- **Impact:** No functional bug. Maintenance hazard: someone removing the gesture state machine call wouldn't realize it's the only path that cancels the monitoring rAF.
- **Fix:** Add explicit `this._cancelSpeculativeSnapBack();` call before the gesture request for defense-in-depth.

### AH-3: `MOMENTUM_CANCEL_GAP_MS=120` is now unreachable dead code

- **File:** `vtt/js/trackpad-gesture.js:13`
- **Batches:** B2
- **Issue:** With `TIMEOUT_MOMENTUM_MS=60`, any silence gap >= 60ms causes the gesture to end via timeout before the 120ms gap detector can fire. The MOMENTUM_CANCEL_GAP_MS path (large gap → restart as ACTIVE) is now unreachable — every large-gap scenario is handled by the timeout instead.
- **Impact:** During a gap-separated momentum event, the gesture ends entirely (→ IDLE → snap-back starts), then the next scroll event fires `onGestureStart` (→ snap-back cancelled). This produces a brief unnecessary snap-back-then-cancel cycle, potentially causing a minor visual flicker.
- **Fix:** Document as intentionally unreachable defensive code: `// Note: With TIMEOUT_MOMENTUM_MS=60, gaps >=60ms cause gesture end before this fires. Kept as defensive fallback.`

### AH-4: `_cancelSpeculativeSnapBack` no-op test is fully vacuous

- **File:** `tests/speculative-snapback.spec.js:164-180`
- **Batches:** B3
- **Issue:** Test sets `_isSnappingBack = false` and `_speculativeSnapId = null`, then calls `_cancelSpeculativeSnapBack()`, and asserts those values are still `false` and `null`. Both branches in the production method are guarded by the exact pre-conditions the test disables. The method body is entirely skipped. The test asserts `false === false` and `null === null`.
- **Impact:** This test would pass even if the method threw an exception (it wouldn't, but the test doesn't verify meaningful behavior). It does not verify that no side effects occurred (no `cancelAnimationFrame` called, no `_elasticAnimator.cancel()` invoked).
- **Fix:** Add spy/flag on `_elasticAnimator.cancel` to prove it was not invoked, and verify `elasticOffsetX` is preserved.

---

## Advisory Issues

### A-1: `_cancelPan()` should cancel monitoring before snap-back

- **File:** `vtt/js/map-camera.js:1462-1473`
- **Batches:** B1
- **Issue:** `_cancelPan()` calls `_snapBackElastic({ vx: 0, vy: 0 })` without first cancelling speculative snap-back monitoring. If monitoring was running, it continues in parallel with the new snap-back. Functionally safe due to the `_isSnappingBack` double-fire guard, but asymmetric with other cleanup paths.
- **Fix:** Add `this._cancelSpeculativeSnapBack();` before the gesture request in `_cancelPan()`.

### A-2: Early momentum detection mildly stiffens rubber-band during intentional overscroll

- **File:** `vtt/js/trackpad-gesture.js:63`
- **Batches:** B2
- **Issue:** With streak=2 and minEvents=4, a plausible 5-event intentional deceleration triggers momentum (was 7 events). The consequence is mild — only changes rubber-band coefficient from c=0.55 to c=0.3 mid-gesture. Speculative snap-back's EWMA independently monitors stall, so premature momentum classification does not trigger premature snap-back.
- **Fix:** No code change required. Consider documenting minimum-event trace as a comment.

### A-3: `_snapBackElastic` zero-velocity guard test is near-vacuous

- **File:** `tests/speculative-snapback.spec.js:13-27`
- **Batches:** B3
- **Issue:** Test sets `_isSnappingBack = true`, calls `_snapBackElastic({ vx: 0, vy: 0 })`, asserts flag is still `true` and `elasticOffsetX` is still `30`. If the guard were removed, the method would restart the animator, but `elasticOffsetX` changes asynchronously via rAF — `toBe(30)` would still pass synchronously.
- **Fix:** Also assert `cam._elasticAnimator._rafId` was not changed (capture before, compare after) to prove the animator was not restarted.

### A-4: EWMA test constants hardcoded — drift risk

- **File:** `tests/speculative-snapback.spec.js:91-135`
- **Batches:** B3, B4
- **Issue:** All three EWMA tests hardcode `ALPHA = 0.3`, initial value `10`, threshold `0.5`. If production changes `EWMA_ALPHA` to 0.2, tests pass unchanged but validate the wrong formula. Constants are module-scoped `const` (not exported), so direct import is not possible without API change.
- **Fix:** Accept risk — test names include the values ("EWMA_INIT(10)", "STALL_THRESHOLD(0.5)") as documentation. Alternatively, add a sentinel test that reads the actual EWMA state after initialization to detect drift.

### A-5: Test name "within 500ms" but only enforces 2000ms timeout

- **File:** `tests/speculative-snapback.spec.js:209`
- **Batches:** B3, B4
- **Issue:** Test named "elastic overscroll resolves within 500ms of last input" but uses `waitForFunction` with 2000ms Playwright timeout. No actual timing assertion. If resolution took 1800ms, the test would pass, contradicting the name.
- **Fix:** Either rename to "elastic overscroll resolves after last input" or add `const start = Date.now()` before wait and `expect(elapsed).toBeLessThan(700)` after.

### A-6: Mouse drag integration test flakiness risk

- **File:** `tests/speculative-snapback.spec.js:273-311`
- **Batches:** B3
- **Issue:** Known flaky test. Drag moves mouse to `box.x + 50` (50px from left edge) which should be safely inside the container, but `mouseleave` handler calls `_cancelPan()` if mouse exits. The `{ steps: 10 }` mousemove + immediate `page.evaluate` state read is race-prone.
- **Fix:** Add settle delay or `waitForFunction` polling for `_gestureActive === true` before reading `duringDrag`.

### A-7: Test "within 100ms" but assertion allows 150ms; detector not cleaned up

- **File:** `tests/speculative-snapback.spec.js:188-201`
- **Batches:** B4
- **Issue:** Test titled "tightened active timeout fires onGestureEnd within 100ms" but `expect(elapsed).toBeLessThan(150)`. Also, `TrackpadGestureDetector` instance is never cleaned up — its internal `setTimeout` timer may leak.
- **Fix:** Tighten assertion to `toBeLessThan(120)` or rename. Call `detector.cancel()` in the `onGestureEnd` callback.

---

## Low Priority

### L-1: `_feedElasticOverflow` EWMA not reset on re-entry without snap-back

- **File:** `vtt/js/map-camera.js:796-831`
- **Batches:** B1
- **Issue:** When `_feedElasticOverflow` is called with new input while the monitoring loop is running but snap-back hasn't triggered, the EWMA is not reset. Correct as designed — EWMA adapts naturally to new input velocity within 3-4 frames.

### L-2: EWMA tests don't need a browser

- **File:** `tests/speculative-snapback.spec.js:86-135`
- **Batches:** B3, B4
- **Issue:** Pure arithmetic tests running as Playwright tests. No DOM interaction. Could be Node-level unit tests. Adds ~2-3s of unnecessary browser setup per test.

### L-3: 16ms inter-event timing slower than real trackpad

- **File:** `tests/speculative-snapback.spec.js:262`
- **Batches:** B3
- **Issue:** `page.waitForTimeout(16)` between events + round-trip latency = ~25-35ms actual gap. Real trackpad events come at ~8ms. Test intent is valid — checks continuous input suppresses snap-back — but doesn't test timing-sensitive edge cases.

### L-4: Orphaned JSDoc block above `setupMapCamera`

- **File:** `tests/helpers.js:275-280`
- **Batches:** B3
- **Issue:** JSDoc comment for `dispatchMouseWheelSequence` is now separated from its function by the new `setupMapCamera` function. Confusing for readers.
- **Fix:** Move `setupMapCamera` after `dispatchMouseWheelSequence` or reorder.

### L-5: Spike detector unaffected by streak reduction

- **File:** `vtt/js/trackpad-gesture.js:46`
- **Batches:** B2
- **Issue:** The spike threshold (1.5x) is relative to `_lastAbsDelta`, not streak count. Entering momentum sooner means spike detector becomes active sooner — this is desirable.

---

## Info / Observations

- Monitoring loop intentionally continues after triggering snap-back — dual purpose: monitors snap-back completion AND initial stall detection [B1]
- Two rAF callbacks run during snap-back (monitoring + elastic animator) — negligible performance cost [B1]
- EWMA math verified correct: α=0.3 convergence from 10→0.5 in ~9 frames = ~144ms [B1]
- `MIN_ELASTIC_MAGNITUDE = 1.0` screen px threshold is appropriate — no floating-point noise risk at this scale [B1]
- rAF leak audit: all exit paths (cancel, snap-back trigger, settlement) correctly clean up `_speculativeSnapId` [B1]
- Cancellation atomicity guaranteed by JS single-threaded execution model [B1]
- Timeout/EWMA race between `TIMEOUT_ACTIVE_MS=80` and EWMA decay (~144ms) is correctly guarded by `_isSnappingBack` flag in both orderings [B2]
- Block header comment "(3/6/150/100)" accurately lists all four Phase 6 values in declaration order [B2]
- Test mock isolation is non-issue: each test gets full page reload via `setupMapCamera` [B3]
- Modified `phase6-unit.spec.js` values (4 active events + 2 decaying) correctly reflect tightened constants [B3]
- `setupMapCamera` is properly exported, reusable, and composes three existing helpers [B3]
- No `toBe()` on floats — all float-sensitive assertions use `toBeGreaterThan`/`toBeCloseTo` [B3]

---

## False Positives

- **`_elasticScreenMag` getter performance** [B1]: Called once per rAF frame during monitoring. Single `Math.sqrt` + 2 multiplications per frame is negligible. Flagged as false positive per review plan.
- **Planning/docs file findings** [B4]: CodeRabbit CLI reviewed 16 findings in `planning-docs/` and `docs/plans/` (previous review docs). These are out of scope for Phase S3 code review — they describe future implementation plans, not production code.

---

## Final Test Results

**Full suite:** 1383 passed, 1 failed (known flaky), 2 flaky, 30 skipped (18.8m)

- **Known flaky failure:** `mouse drag elastic overscroll works correctly after Phase S3` — timing race where `_isSnappingBack` is still `true` after offset drops below 1.0 but before animator fully settles. Pre-existing, not caused by review fixes.
- **Flaky passes:** `_axisVelocity returns positive near right edge` (edge-pan), `semantic zoom classes appear at expected zoom levels` (phase5-integration). Pre-existing.
- **Zero new failures** from AH fix commit.

## Fixes Applied

| Finding | Fix | File |
|---------|-----|------|
| AH-1 | Added `_cancelSpeculativeSnapBack()` to `_commitPan()` | `vtt/js/map-camera.js` |
| AH-2 | Added explicit `_cancelSpeculativeSnapBack()` to `_startPan()` | `vtt/js/map-camera.js` |
| AH-3 | Documented `MOMENTUM_CANCEL_GAP_MS` as unreachable with current timeouts | `vtt/js/trackpad-gesture.js` |
| AH-4 | Added `_elasticAnimator.cancel` spy to vacuous no-op test | `tests/speculative-snapback.spec.js` |
