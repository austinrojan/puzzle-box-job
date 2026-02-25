# CodeRabbit Triage — Camera System Review

**Date:** 2026-02-25
**Source review findings:** 14 (1 HIGH, 5 MEDIUM, 8 LOW)
**Test review findings:** 29 (1 P0, 9 P1, 12 P2, 7 P3)
**Baseline:** 405 passed, 1 flaky, 10 skipped, 0 failed

---

## P0 — Bugs (fix immediately)

None found in source code. No logic errors, race conditions, or resource leaks.

The test review's F01 (flaky `_smoothZoomTo` test) is a **test defect**, not a production bug. Promoted to P1 for this cycle.

---

## P1 — Reliability (fix this cycle)

### Source (4 issues)

| # | Issue | File | Pre-known? |
|---|-------|------|------------|
| S1 | `_snapBackElastic()` and `_smoothZoomTo()` access `_springLoop` without null guard — would throw if called before `attachTo()` | map-camera.js:792, 958 | #3 (partial) |
| S2 | `_momentumPanSuppressed` creates ~60-140ms dead zone — `onGestureStart` returns early instead of clearing flag | map-camera.js:1099 | New |
| S3 | Coast-to-snapback GSM cooldown blocks SNAP_BACK after INERTIA — snap-back runs untracked. Works via independent cancellation in `_startPan`/`onGestureStart`. | map-camera.js (tickCoast + GSM Rule 4) | New |
| S4 | `_coastSaturatedFrames` not reset in `_cancelInertialCoast()` — stale counter on next coast | camera-spring-loop.js:49, map-camera.js:874 | New |

### Tests (6 issues)

| # | Issue | File | Pre-known? |
|---|-------|------|------------|
| T1 | Flaky `_smoothZoomTo` test — zoom not pinned to mid-range before assertion | phase6-unit.spec.js:214 | #9 |
| T2 | `waitForTimeout(16)` in timing loops (2 instances) | speculative-snapback.spec.js:244, 307 | New |
| T3 | `setTimeout(100)` race for BroadcastChannel propagation | phase5.5-integration.spec.js:59, 91 | New |
| T4 | No `afterEach` to restore `performance.now` mocks (2 files) | device-classifier.spec.js, gesture-state-machine.spec.js | New |
| T5 | `waitForTimeout(100)` for device classification settle | phase6-integration.spec.js:229 | New |
| T6 | `panToBoundary` helper doesn't verify boundary was reached | helpers.js:294-303 | New |

---

## P2 — Maintainability (fix this cycle)

### Source (5 issues)

| # | Issue | File | Pre-known? |
|---|-------|------|------------|
| M1 | CameraSpringLoop reads/writes 12+ Camera privates — needs "friend class" doc | camera-spring-loop.js | #5 |
| M2 | GSM ZOOM_ANIMATE cancel reaches 3 levels deep — extract `_cancelZoomAnimation()` | map-camera.js:168-172 | #4 |
| M3 | `_commitPan()` cancel/reset order inconsistent with `_startPan()` | map-camera.js | New |
| M4 | `_trackpadDetector._eventCount` private access — expose via getter | map-camera.js:927, trackpad-gesture.js | #10 |
| M5 | Elastic spring sync pattern duplicated in 4 places | camera-spring-loop.js | New |

### Tests (6 issues)

| # | Issue | File | Pre-known? |
|---|-------|------|------------|
| M6 | 6 files with "phase" in filenames | tests/ | #6 |
| M7 | 4 describe blocks + comments with "Phase N" references | tests/ | #7 |
| M8 | `waitForDisplayPhase5` helper naming | helpers.js:266 | #8 |
| M9 | Duplicate tests in phase-s5-integration.spec.js (elastic ceiling + scroll preference) | phase-s5-integration.spec.js | New |
| M10 | `solveSpring` copy-pasted 5 times in spring-overshoot | spring-overshoot.spec.js | New |
| M11 | rubberBand describe block misleadingly named | phase6-unit.spec.js:261 | New |

---

## P3 — Nits (skip)

| # | Issue | Source |
|---|-------|--------|
| N1 | `_gestureActive` naming confusion with `GestureStateMachine._activeGesture` | Source review 3.4 |
| N2 | Camera class ~1100 lines — acceptable for now | Source review 1.1 |
| N3 | `_attachMouseHandlers()` 111 lines — reviewed, acceptable | Pre-known #1 |
| N4 | `_attachWheelHandler()` 63 lines — reviewed, acceptable | Pre-known #2 |
| N5 | Orphaned JSDoc fragment in helpers.js | Test F23 |
| N6 | Semicolon-separated assertions in GSM tests | Test F24 |
| N7 | Unnecessary camera wait in VelocityTracker tests | Test F25 |
| N8 | Parenthetical formatting inconsistency in axis-spring tests | Test F26 |
| N9 | `_updateCumulativeOverflow` white-box testing undocumented | Test F27 |
| N10 | Mock camera `_applyConstraints` too simple | Test F28 |
| N11 | Disjunctive assertion in scroll-preference | Test F29 |
| N12 | Wide timing tolerance in snapback timing test | Test F09 |
| N13 | Pure math momentum decay tests not exercising prod code | Test F22 |
| N14 | `dispatchMouseWheelSequence` safety — already best-available pattern | Test F06 |

---

## Fix Plan

### Task 5 (P0): No P0 bugs — skip

### Task 6 (P1 — source, batch by file):
- **map-camera.js batch:** S1 (null guards), S2 (momentumPanSuppressed), S3 (GSM cooldown exemption)
- **camera-spring-loop.js + map-camera.js:** S4 (coastSaturatedFrames reset)

### Task 6 (P1 — tests, batch by file):
- **phase6-unit.spec.js:** T1 (pin zoom)
- **speculative-snapback.spec.js:** T2 (replace waitForTimeout)
- **phase5.5-integration.spec.js:** T3 (replace setTimeout)
- **device-classifier.spec.js + gesture-state-machine.spec.js:** T4 (afterEach restore)
- **phase6-integration.spec.js:** T5 (replace waitForTimeout)
- **helpers.js:** T6 (panToBoundary verification)

### Task 7 (P2 — source):
- M1 (friend-class doc), M2 (extract _cancelZoomAnimation), M3 (commitPan order), M4 (eventCount getter), M5 (sync DRY)

### Task 8 (P2 — test renames):
- M6-M8 (phase references), M9 (duplicate removal), M10-M11 (naming)

---

## Pre-Known Issues Cross-Reference

| # | Pre-known Issue | Status |
|---|----------------|--------|
| 1 | `_attachMouseHandlers()` 111 lines | Reviewed — acceptable (N3) |
| 2 | `_attachWheelHandler()` 63 lines | Reviewed — acceptable (N4) |
| 3 | Dynamic property init in `attachTo()` | Confirmed — fix null guards (S1) |
| 4 | GSM `_cancelCurrent()` Camera coupling | Confirmed — extract method (M2) |
| 5 | `CameraSpringLoop._tick()` 12+ private reads | Confirmed — add docs (M1) |
| 6 | 6 test files with "phase" filenames | Confirmed — rename (M6) |
| 7 | 4 describe blocks with "Phase N" | Confirmed — rename (M7) |
| 8 | `waitForDisplayPhase5` helper naming | Confirmed — rename (M8) |
| 9 | Flaky `_smoothZoomTo` test | Root cause found — fix (T1) |
| 10 | `_trackpadDetector._eventCount` private access | Confirmed — expose getter (M4) |
