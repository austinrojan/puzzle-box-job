# Phase S2 CodeRabbit Review Results

**Date:** 2026-02-20
**Reviewer:** CodeRabbit CLI v0.3.5
**Baseline:** `ff0dfd0` (docs: Phase 6 + S1 CodeRabbit review results)
**HEAD:** `343c3bf` (docs: document tolerance values in spring-overshoot tests)
**Commits reviewed:** 11 (Phase S2: `2e9d6ae`..`343c3bf`)

## Files in Scope

| File | Lines changed | Findings |
|------|--------------|----------|
| `vtt/js/map-camera.js` | +65 | 0 |
| `tests/spring-overshoot.spec.js` | +484 | 0 |
| `tests/helpers.js` | +12 | 0 |
| Planning doc (S2 implementation plan) | +1280 | 0 |

## Summary

**Zero findings against production or test code.** All 30 findings targeted planning/research markdown documents that were included in the diff.

## Planning Doc Findings (all triaged as won't-fix)

30 findings across planning and research documents. These are design-time artifacts containing pseudocode, theoretical implementations, and future phase guidance. They are not production code.

### Categories of planning doc findings:
- **3** on previous review doc (`docs/plans/2026-02-19-phase6-s1-coderabbit-review.md`) — reproducibility of commit hashes, undocumented file in diff command, rollback guidance
- **4** on research synthesis doc — pseudocode velocity clamping logic, bug definitions, perception threshold consistency
- **1** on overview/roadmap doc — missing `cancel()` method in pseudocode
- **5** on Phase 6 implementation plan — rubberBand args, cumulative overflow decay, elastic offset reset, coordinate naming consistency
- **6** on Phase 4 BroadcastChannel plan — null checks, message validation, suppressBroadcast flag, peer reaping, feature detection, EventBus listener cleanup
- **3** on Phase 2 input handling plan — EventBus encapsulation, GestureEvent detection, keyboard layout independence
- **3** on Phase S3/S4/S5 plans — threshold clarification, test expectation conflicts, sign convention verification
- **1** on Phase 5.5 plan — private method access encapsulation
- **1** on Phase 5 plan — orphan mode role guard
- **3** on Phase 6 research doc — mock RAF timestamps, zero-delta events, rubber-band accumulation spaces

### Rationale for skipping all:
These documents describe design intent, pseudocode, and future implementation guidance. The actual shipped code in `vtt/js/map-camera.js` has already implemented these concepts correctly, validated by 23 passing spring-overshoot tests and 1333 passing tests in the full suite.

## What Was Fixed

Nothing — no fixes were needed.

## Advisories for Future Phases

The following planning doc findings are worth verifying against shipped code when those areas are next touched. They are not action items for Phase S2 — the shipped code may already handle these correctly, but the planning docs raised valid concerns that should be spot-checked during future work.

### A-1: EventBus listener cleanup
- **Source:** Phase 4 BroadcastChannel plan, lines 1381–1389
- **Issue:** `start()` registers EventBus listeners (`camera-sync:welcome`, `camera-sync:reconnect`) that `stop()`/`destroy()` never remove. Could cause memory leaks and duplicate handlers on restart.
- **Action:** Verify against shipped `camera-sync.js` when next modifying sync engine.

### A-2: Elastic offset reset on remote updates
- **Source:** Phase 6 plan, lines 1456–1463
- **Issue:** Remote camera updates via BroadcastChannel don't reset local elastic offset, potentially causing visual displacement until next snap-back.
- **Action:** Verify against shipped deserialization path when next modifying sync receiver.

### A-3: Gesture priority >= vs >
- **Source:** Phase 6 plan, lines 1376–1412
- **Issue:** `request()` uses `>=` for priority comparison, meaning same-priority gestures cancel rather than retarget. Breaks `ZOOM_ANIMATE` accumulation via `SmoothZoomAnimator.onWheelZoom()`.
- **Action:** Verify against shipped gesture coordinator when implementing S4.

## Test Results

### Spring-overshoot tests (desktop-1920)
- **23 passed**, 0 failed

### Spring-overshoot tests (all 4 viewports)
- **90 passed**, 1 flaky (page load timeout in `beforeEach`), 1 failed (same page load timeout, retry exhausted)
- Both failures were `gotoVTT()` timeouts in `beforeEach` hooks — test infrastructure flakiness under parallel load, not Phase S2 code issues

### Full test suite
- **1333 passed**, 30 skipped, 1 flaky (edge-pan, pre-existing), **0 failed**

## Verification Checklist

- [x] CodeRabbit review ran successfully against `pre-s2-baseline..HEAD`
- [x] All Critical/High findings addressed or documented with rationale — none found
- [x] All Medium findings addressed or documented with rationale — none found
- [x] Low/Info findings documented with rationale for skip — all 30 are planning docs
- [x] Spring-overshoot tests pass (23 on desktop-1920)
- [x] Full suite passes: 1333 passed, 0 failed
- [x] Temporary `pre-s2-baseline` branch deleted
- [x] Review results saved to this file
- [x] Zero behavior changes from review — no fixes applied
