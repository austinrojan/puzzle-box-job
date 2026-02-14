# Phase 3 (Constraints & Elastic Overscroll) CodeRabbit Review Results

**Date:** 2026-02-14
**Scope:** 16 commits (`f5eee1f..HEAD`), 9 files, +749 / -42 lines
**Reviewers:** 4 parallel CodeRabbit agents + cross-cutting synthesis

## Summary

| Category | Count |
|----------|-------|
| **Blocking** | 0 |
| **Advisory (High)** | 2 |
| **Advisory** | 8 |
| **False Positive** | 5 |
| **Total findings** | 15 |

**Verdict: Phase 3 is clear to proceed.** Zero blocking bugs found across all four review domains (constraint math, state machine, edge-pan/protocol, test suite). The constraint pipeline is complete — every camera mutation path terminates in `_applyConstraints()` or has a documented bypass. The `_isDragging` state machine has balanced entry/exit paths. The spring solver, rubber band formula, and dual-regime clamping are mathematically correct. Test coverage is solid for core paths with known gaps for edge cases documented below.

---

## Advisory Issues (High Priority)

### AH-1: Keyboard edge-stop test starts at boundary — passes trivially if clamping broken
- **File:** `tests/camera-clamping.spec.js:335-347`
- **Issue:** The keyboard edge-stop E2E test sets `cam.x = 0; cam.y = 0` then presses ArrowLeft. It asserts `x ≈ 0`. But if clamping were completely broken and the pan went negative, the assertion would still pass *if the test checked the wrong value*. More critically, the test starts at the exact boundary — it doesn't verify that the camera *tried* to move past and was *prevented*. A test that starts at x=100, pans left 200px worth, and asserts x≥0 would be a stronger regression test.
- **Impact:** Weak regression protection. The test works today because keyboard pan does call `_applyConstraints()`, but a subtle bug in clamping logic might not be caught.
- **Fix:** Start camera at `x = 100`, press ArrowLeft for 400ms, assert `0 ≤ x ≤ 100`. This proves the pan moved (from 100) and was clamped (at 0).

### AH-2: `waitForTimeout(SNAP_SETTLE_MS)` should be poll-based `waitForFunction`
- **File:** `tests/camera-clamping.spec.js:298-310, 320-333`
- **Phase 2 ref:** AH-5 (carried forward, still using timeout approach)
- **Issue:** The snap-back and right-click drag tests use `waitForTimeout(800)` to wait for the spring animation to settle. rAF timing varies across CI runners, Docker containers, and headless Chrome. If rAF is delayed, the test can flake.
- **Impact:** Potential flaky tests on CI. The 800ms timeout is generous (spring settles ~500ms) but not CI-proof.
- **Fix:** Replace with `page.waitForFunction(() => __cam()?.x >= -1.0, { timeout: 5000 })`. Poll for the settled condition instead of sleeping a fixed duration.

---

## Advisory Issues

### A-1: `_commitPan` (left-click threshold drag) has no dedicated test
- **File:** `tests/camera-clamping.spec.js` (gap)
- **Issue:** The `_isDragging` state machine has three entry paths. Right-click drag and space+click are exercised by the E2E test, but the left-click threshold path (`_initPendingPan` → mousemove exceeds `DRAG_THRESHOLD` → `_commitPan` sets `_isDragging = true`) has no test. This is the most complex entry path with a two-step state transition.
- **Impact:** The `_commitPan` threshold promotion pattern is untested. A regression in the threshold logic or the `_isDragging` flag set would not be caught.
- **Fix:** Add E2E test: left-click → move beyond DRAG_THRESHOLD → verify elastic bounds active → mouseup → verify snap-back.

### A-2: `_dmCanZoomPastCover` toggle has no test
- **File:** `tests/camera-clamping.spec.js` (gap)
- **Issue:** The `camera:zoom-past-cover` EventBus handler (map-camera.js:782-789) toggles `_dmCanZoomPastCover` and snaps zoom to `_coverZoom` when disabled while below cover. No test covers this protocol-driven toggle.
- **Impact:** A regression in the toggle handler or the snap-to-cover logic would not be caught.
- **Fix:** Add test: set `_dmCanZoomPastCover = true`, zoom below cover, emit `camera:zoom-past-cover` with `enabled: false`, assert zoom ≥ `_coverZoom`.

### A-3: Edge-pan `START_DELAY_MS` timing boundary untested
- **File:** `tests/edge-pan.spec.js` (gap)
- **Issue:** The 150ms start delay is a key UX behavior — prevents accidental edge-pan during quick cursor passes. No test verifies that the delay is respected (i.e., no pan output before 150ms even with cursor in hot zone).
- **Fix:** Add test: start tracking, update cursor into hot zone, tick at 100ms → expect no pan; tick at 200ms → expect pan.

### A-4: Spring solver with nonzero initial velocity untested
- **File:** `tests/camera-clamping.spec.js` (gap)
- **Issue:** All spring solver tests use zero initial velocity. The `snapBack()` method always passes 0 for velocity, so nonzero velocity is currently unreachable. But the solver supports it, and if a future change passes drag release velocity, the no-overshoot guarantee should be verified.
- **Impact:** Low — the code path is currently unreachable. Future-proofing only.
- **Fix:** Add test: `_solveSpring(100, -500, t)` — verify it still converges without excessive overshoot.

### A-5: Diminishing returns ratio assertion is generous
- **File:** `tests/camera-clamping.spec.js:102-118`
- **Issue:** The elastic diminishing returns test asserts `ratio < 10` (10x overshoot → less than 10x elastic offset). With `c = 0.55`, the actual ratio for 50px vs 500px is approximately 4.5x. A tighter bound of `< 6` would catch regressions in the rubber band constant without being fragile.
- **Impact:** Very generous tolerance could mask a broken rubber band constant.
- **Fix:** Tighten to `expect(result.ratio).toBeLessThan(6)`.

### A-6: DM zoom below cover lost on map resize when `_dmCanZoomPastCover = true`
- **File:** `vtt/js/map-camera.js` — `_updateCoverZoom()` / `_onContainerResize()`
- **Issue:** When `_dmCanZoomPastCover` is enabled and the DM has zoomed below `_coverZoom`, a window resize recalculates `_coverZoom`. If the new `_coverZoom` is higher than the current zoom, `_applyConstraints()` (called from `setViewportSize`) will clamp zoom up to the new `_coverZoom` — even though the DM explicitly opted into sub-cover viewing.
- **Impact:** Low. Map resize during active DM zoom-past-cover is rare. The DM can simply zoom out again.
- **Fix:** In `_getMinZoom()`, when `_dmCanZoomPastCover` is true, return `MIN_ZOOM` instead of `_coverZoom`.

### A-7: `panBy()` still ignores `viewportScale` — carried forward from Phase 2
- **File:** `vtt/js/map-camera.js:452-455`
- **Phase 2 ref:** AH-1 (carried forward, unresolved)
- **Issue:** `panBy(dx, dy)` divides only by `zoom`, but the drag handler divides by `zoom * viewportScale`. Phase 3 added `EdgePanManager` as a new caller of `panBy()`. If `viewportScale != 1` (responsive scaling), edge-pan velocity would be off by `1/viewportScale`.
- **Impact:** Invisible in practice — map mode has `viewportScale = 1.0`. Would manifest if theater-mode map interaction is added.
- **Deferral rationale:** Same as Phase 2 — fixing in isolation risks interaction with constraint pipeline.

### A-8: Elastic Y-axis not directly tested
- **File:** `tests/camera-clamping.spec.js:279-296`
- **Issue:** The elastic overscroll test (`_isDragging=true enables elastic mode`) only tests the X axis. Y-axis elastic behavior uses the same code path (`_elasticClampAxis` called for both axes), so correctness is implied, but a separate Y assertion would catch axis-specific regressions.
- **Impact:** Low — code path is shared.
- **Fix:** Add `cam.y = -200` in the same test, assert `elasticY < 0 && elasticY > -200`.

---

## Cross-Cutting Findings

### Constraint Pipeline Completeness: PASS

Every path that mutates `camera.x`, `camera.y`, or `camera.zoom` was traced:

| Mutation Path | Ends with `_applyConstraints()`? | Notes |
|---------------|--------------------------------|-------|
| `zoomAt(sx, sy, delta)` | Yes | |
| `zoomToCenter(delta)` | Yes | |
| `panBy(dx, dy)` | Yes | |
| `setPosition(x, y, zoom)` | Yes | |
| `deserialize(data)` | Yes | |
| `fitCover()` | Yes | |
| `fitContain()` | Yes | Uses `_bypassZoomFloor` |
| Mouse drag (mousemove) | Direct `this.x =` → `_applyConstraints()` | Elastic path |
| `CameraAnimator._tick()` | `_applyHardBounds()` per frame | Intentional bypass of elastic |
| `camera:pan` EventBus | Calls `panBy()` → Yes | |
| `camera:set-state` EventBus | Calls `setPosition()` → Yes | |
| `camera:zoom-past-cover` handler | Calls `fitCover()` → Yes | |
| `setMapSize()` | `_updateCoverZoom()` → `_applyConstraints()` | |
| `_onContainerResize()` | `setViewportSize()` → `_applyConstraints()` | |

**No unconstrained mutation paths found.**

### `_isDragging` Lifecycle: PASS

| Transition | Set true | Set false | Snap-back triggered? |
|------------|----------|-----------|---------------------|
| Right-click drag | `_startPan()` | `_endPan()` | Yes |
| Left-click threshold | `_commitPan()` | `_endPan()` | Yes |
| Space+left-click | `_startPan()` | `_endPan()` | Yes |
| Window blur | — | `_cancelPan()` → `_endPan()` | Yes |
| Visibility hidden | — | `_cancelPan()` → `_endPan()` | Yes |
| Mouse leave canvas | — | `_cancelPan()` → `_endPan()` | Yes |

**All entry paths have matching exit paths. No stuck-true scenario identified.**

### Concurrent Drag Scenario: ACCEPTABLE

Token drag (edge-pan active, `_isDragging = false`) + simultaneous right-click camera drag (`_isDragging = true`):
- During overlap: edge-pan's `panBy()` routes through elastic bounds (since `_isDragging = true`). This means edge-pan could push the camera slightly past bounds with rubber banding.
- On camera mouseup: `_isDragging = false`, snap-back fires, corrects any elastic overshoot.
- On token mouseup: edge-pan stops.
- **Net effect:** Brief elastic wobble during concurrent drag, immediately corrected. Acceptable UX.

### Phase 2 Advisory Carry-Forward

| Phase 2 ID | Status | Notes |
|------------|--------|-------|
| AH-1: `panBy()` viewportScale | **Carried → A-7** | Not fixed. EdgePanManager is a new caller. Invisible at `viewportScale = 1`. |
| AH-2: BoundsCache invalidation | **Resolved** | Phase 3 constraint pipeline always applies bounds after mode transition. |
| AH-3: Zoom presets non-US keyboards | **Fixed** | Commit `7c8ecc1` — added `e.code` fallbacks. |
| AH-4: Token drag coupling via `__vtt._dragging` | **Carried** | Still present, same risk. Phase 3 added EdgePanManager with clean EventBus pattern. |
| AH-5: `waitForTimeout` timing | **Carried → AH-2** | Phase 3 tests use same pattern with `SNAP_SETTLE_MS = 800`. |
| AH-6: Shift+arrow untested | **Carried** | Still no test. Phase 3 didn't touch keyboard pan logic. |
| A-1: `fitCover()` zero-map guard | **Fixed** | Commit `fa4f054`. |
| A-9: Tolerance inconsistency | **Carried** | Phase 3 tests mix `toBeCloseTo`, `toBeLessThan(1)`, `toBeGreaterThanOrEqual(-1.0)`. Intentional per-assertion but lacks documentation. |

### Protocol Consistency: PASS

`CAMERA_ZOOM_PAST_COVER` follows established patterns:
- Constant naming: `MSG.CAMERA_ZOOM_PAST_COVER` (matches `CAMERA_PAN`, `CAMERA_ZOOM`, `CAMERA_STATE`)
- Required fields: `['enabled']` (consistent format)
- Factory: `createCameraZoomPastCoverMsg(enabled)` (consistent naming)
- EventBus event: `camera:zoom-past-cover` (consistent namespace)

### Test Coverage Matrix

| Feature | Unit | Integration | E2E | Gap? |
|---------|:----:|:-----------:|:---:|------|
| `_clampAxis` dual-regime | ✓ (4 tests) | — | — | — |
| `rubberBand` | ✓ (3 tests) | — | — | — |
| `CameraAnimator` spring | ✓ (5 tests) | — | — | Nonzero velocity (A-4) |
| `_applyConstraints` dispatch | — | ✓ (elastic toggle) | — | — |
| `_isDragging` state machine | — | ✓ (right-click) | ✓ | Left-click threshold (A-1) |
| Zoom floor enforcement | — | ✓ (2 tests) | — | — |
| `_dmCanZoomPastCover` toggle | — | — | — | **No test (A-2)** |
| `_bypassZoomFloor` | — | ✓ (fitContain) | — | — |
| `_triggerSnapBack` | — | ✓ (settle test) | ✓ | — |
| `_commitPan` threshold | — | — | — | **No test (A-1)** |
| EdgePanManager velocity | ✓ (4 tests) | — | — | — |
| Edge-pan lifecycle | ✓ (1 test) | — | — | START_DELAY (A-3) |
| Edge-pan E2E | — | — | — | **No test** |
| Protocol `CAMERA_ZOOM_PAST_COVER` | — | — | — | **No test (A-2)** |

---

## False Positives (Documented)

| # | Concern | Why Intentional |
|---|---------|----------------|
| FP-1 | `rubberBand(0, 0)` returns NaN | Unreachable — callers guard `dim > 0` (map always has nonzero dimensions when constraint pipeline runs) |
| FP-2 | `_applyHardBounds` division by zero when `zoom = 0` | Protected by `_getMinZoom()` enforcing `zoom ≥ coverZoom > 0` before bounds are computed |
| FP-3 | Spring overshoot with nonzero initial velocity | `snapBack()` always passes `velocity = 0`. Solver handles it correctly regardless, but the path is unreachable. |
| FP-4 | Direct field mutations in tests (`cam.zoom = 2.0`) | Intentional for unit isolation — tests specific math functions, not the full mutation pipeline |
| FP-5 | `page.evaluate()` + `window.__cam()` pattern | Intentional Playwright browser-context bridge for accessing ES module internals in E2E tests |

---

## Recommended Fix Priority

### Must fix before Phase 4
1. **AH-1** — Strengthen keyboard edge-stop test (start at x=100, not x=0)
2. **AH-2** — Replace `waitForTimeout` with poll-based assertions in snap-back tests

### Should fix (low risk to defer)
3. **A-1** — Add `_commitPan` threshold E2E test
4. **A-2** — Add `_dmCanZoomPastCover` toggle test
5. **A-3** — Add `START_DELAY_MS` timing test
6. **A-5** — Tighten diminishing returns ratio assertion to `< 6`

### Future candidates (carry-forward)
7. **A-7 (AH-1 from Phase 2)** — `panBy()` viewportScale — fix when responsive scaling matters
8. **AH-4 from Phase 2** — Token drag coupling via `__vtt._dragging` — refactor to EventBus
9. **AH-6 from Phase 2** — Shift+arrow acceleration test
10. **A-4** — Spring nonzero velocity test (unreachable today)
11. **A-6** — DM zoom lost on resize with `_dmCanZoomPastCover = true`
12. **A-8** — Elastic Y-axis assertion
