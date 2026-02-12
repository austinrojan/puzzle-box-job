# Phase 1 CodeRabbit Review Results

**Date:** 2026-02-12
**Scope:** 2 commits (`98df1fa`, `9e8344a`), 14 files, +772 / -216 lines
**Reviewers:** 5 parallel CodeRabbit agents + cross-cutting synthesis

## Summary

| Category | Count |
|----------|-------|
| **Blocking** | 0 |
| **Advisory (High)** | 12 |
| **Advisory** | 12 |
| **False Positive** | 23 |
| **Total findings** | 47 |

**Verdict: Phase 1 is clear to proceed to Phase 2.** Zero blocking issues found. The core camera math (coordinate transforms, zoom algorithm, cover zoom, resize snap behavior) is correct and well-implemented. The rendering pipeline transforms are properly bracketed across all 3 renderers and 4 persistent effect types.

---

## Advisory Issues (High Priority)

### AH-1: `panBy()` ignores `viewportScale` — velocity mismatch in theater mode
- **File:** `vtt/js/map-camera.js:264-268`
- **Issue:** `panBy(dx, dy)` divides only by `zoom`, but the drag handler (line 366) divides by `zoom * viewportScale`. Wheel pan and Controller `camera:pan` deltas are in CSS pixels, so when `viewportScale != 1.0` (theater mode), panning overshoots.
- **Impact:** Invisible in map mode (`viewportScale = 1.0`). Would manifest if theater-mode map interaction is added.
- **Fix:** `this.x -= dx / (this.zoom * this.viewportScale);`

### AH-2: Window-level listeners never removed; no `detach()` or idempotency guard
- **File:** `vtt/js/map-camera.js:340-417`
- **Issue:** 5 anonymous arrow functions added to `window` in `attachTo()` with no reference stored. If `attachTo()` is called twice, listeners double up.
- **Impact:** Safe today (called once during init). Landmine for Phase 2+ refactoring.
- **Fix:** Add `if (this._attached) return;` guard at top of `attachTo()`.

### AH-3: Token drag coupling via `window.__vtt._dragging` is fragile
- **File:** `vtt/js/map-camera.js:341-345`
- **Issue:** Camera module reads `window.__vtt?.tokenManager?._dragging` — tight coupling to private property. Correctness depends on implicit listener registration order.
- **Impact:** Works today. Breaks silently if property renamed or init order changes.
- **Fix:** Replace with `EventBus.emit('token:drag-start')`/`EventBus.on(...)`.

### AH-4: `toggleFogAtCursor` uses center key `key` instead of neighbor key `k`
- **File:** `vtt/js/map-renderer.js:300-326`
- **Issue:** The toggle decision `this.fogRevealed.has(key)` tests the center cell on every iteration of the 3x3 loop, not the current neighbor `k`. Produces uniform brush behavior by accident.
- **Impact:** No visible bug (brush always reveals/hides uniformly, which is the desired UX). But reads as a bug and is fragile — a future "fix" to use `k` would create a flickering brush.
- **Fix:** Compute toggle direction once before the loop and document the uniform-brush intent.

### AH-5: Image load race on rapid `loadMap()` calls
- **File:** `vtt/js/map-renderer.js:157-168`
- **Issue:** If `loadMap('M01')` then immediately `loadMap('M02')`, M01's `img.onload` can fire after M02 has been set as current, overwriting M02's camera dimensions with M01's.
- **Impact:** Low probability (map switches are user-initiated). Could produce confusing visual glitches if maps are switched via rapid keyboard navigation.
- **Fix:** Add staleness guard: `if (this.currentMap?.id !== expectedMapId) return;` in callbacks.

### AH-6: Viewport-scaler early-return guard blocks mode transition on 1920x1080
- **File:** `vtt/js/viewport-scaler.js:38`
- **Issue:** `if (Math.abs(s - _scale) < 0.0001) return;` fires when transitioning MAP→THEATER on exactly 1920x1080 displays (both scale values are 1.0). Container retains `width: 100%` instead of `width: 1920px`.
- **Impact:** Functionally equivalent on 1920x1080 (100% of 1920px = 1920px, scale(1) = identity). Visual output is identical. Code state is technically wrong.
- **Fix:** Move the early-return guard to check mode as well, or restructure so mode transitions always apply their styles.

### AH-7: Resize listener not debounced; redundant events per-pixel in map mode
- **File:** `vtt/js/viewport-scaler.js:26`
- **Issue:** `window.addEventListener('resize', update)` fires on every pixel during window drag-resize. In map mode, each call emits `viewport:scaled` with the same scale=1.
- **Impact:** Downstream listeners receive redundant events. The camera's rAF coalescing absorbs most of this, but it's unnecessary work.
- **Fix:** Add rAF coalesce to `update()` or skip the emit when scale hasn't changed.

### AH-8: Token line width scaling lacks clamping at zoom extremes
- **File:** `vtt/js/token-manager.js` (multiple), `vtt/js/effects-engine.js`, `vtt/js/map-renderer.js`
- **Issue:** `N / cam.zoom` pattern: at `zoom=0.1`, `3/0.1 = 30px` world-space line width (enormous). At `zoom=5.0`, `3/5 = 0.6px` (sub-pixel shimmer).
- **Impact:** Only at extreme zoom levels (safety valves, not normal operation). Practical range 0.3-2.5 produces reasonable values.
- **Fix:** Introduce clamped helper: `Math.max(0.5, Math.min(val / zoom, val * 4))`. Address before Phase 3 which tightens zoom bounds.

### AH-9: Test — No zoom boundary tests (MIN_ZOOM/MAX_ZOOM clamping)
- **File:** `tests/camera-math.spec.js`
- **Missing:** No test verifies zoom stops at 0.1 (MIN_ZOOM) or 5.0 (MAX_ZOOM).
- **Fix:** Add two boundary clamping tests.

### AH-10: Test — No cover-zoom test for portrait-oriented map
- **File:** `tests/camera-math.spec.js`
- **Missing:** All 3 cover-zoom tests use landscape 1920x1080 maps. Portrait maps (e.g., 1080x1920) produce negative y-offsets after centering — an unusual path worth testing.
- **Fix:** Add one portrait-map cover-zoom + centering test.

### AH-11: Test — Theater transform assertion too weak
- **File:** `tests/viewport-filling.spec.js:47-57`
- **Issue:** Asserts `expect(transform).not.toBe('none')` — passes even with wildly wrong scale values like `scale(0.01)`.
- **Fix:** Parse the matrix string and verify `scale ≈ Math.min(vw/1920, vh/1080)`.

### AH-12: Test — `setViewportSize` preserve-path untested
- **File:** `tests/camera-math.spec.js`
- **Missing:** No test exercises the "zoom above cover floor → resize → zoom preserved" path. Only the "zoom at cover floor → resize → re-snap" path is tested.
- **Fix:** Add test that sets zoom above cover, calls `setViewportSize`, verifies zoom and position preserved.

---

## Advisory Issues

### A-1: `_coverZoom` is a soft floor (undocumented)
- **File:** `vtt/js/map-camera.js:225-243`
- `zoomAt` clamps to MIN_ZOOM/MAX_ZOOM but does not enforce `_coverZoom` as a floor. User can zoom below cover zoom (showing black bars). Intentional but undocumented.

### A-2: Extreme map aspect ratios push `_coverZoom > MAX_ZOOM`
- **File:** `vtt/js/map-camera.js:184-198`
- A 192x1080 map → `_coverZoom = 10` → exceeds `MAX_ZOOM = 5.0`. `fitCover()` bypasses the clamp. Edge case with very unusual maps.

### A-3: `mouseleave` doesn't clear `_pendingPan`
- **File:** `vtt/js/map-camera.js:414-420`
- Only clears `_panning`, not `_pendingPan`. Safe because `mouseup` on `window` and `blur` both clear it. Completeness improvement.

### A-4: `_centerMap` divides by zoom (safe in practice)
- **File:** `vtt/js/map-camera.js:205-210`
- `this.viewportW / this.zoom` could be `Infinity` if `zoom === 0`. Cannot happen with current guards. Defensive check optional.

### A-5: ~16ms redraw delay on resize (one blank frame)
- **File:** `vtt/js/map-renderer.js:101-113`
- Resize path relies on `camera:changed` → rAF instead of synchronous redraw. Produces one blank frame. Acceptable for DM tool.

### A-6: Mixed `px` and `rem` in initiative panel CSS
- **File:** `vtt/css/initiative.css`
- `.init-portrait` uses `40px`, `.init-roll` uses `1.75rem`. Should normalize to `px` before Phase 2 scaling changes.

### A-7: Token drag coordinates stale during concurrent scroll-zoom
- **File:** `vtt/js/token-manager.js:660-687`
- If user scrolls wheel while dragging a token, stored screen coords become stale → one-frame jump. Not data-corrupting; self-corrects on next mousemove.

### A-8: `CAMERA_ZOOM` direction=0 takes wrong branch
- **File:** `shared/protocol.js` + `vtt/js/map-camera.js:410`
- `direction === 0` triggers zoom-out (false > 0). Harmless since factories only pass 1/-1.

### A-9: Test — Camera math tests run across 4 viewports needlessly
- **File:** `tests/camera-math.spec.js` + `playwright.config.js`
- 9 viewport-independent math tests × 4 projects = 36 wasted CI runs. Restrict to single project.

### A-10: Test — `enterMapMode` doesn't wait for container resize
- **File:** `tests/viewport-filling.spec.js:11-22`
- Waits for `cam.mapW > 0` but not `container.clientWidth > 0`. Future tests relying on camera viewport state would be affected.

### A-11: Test — Inconsistent tolerance style
- **File:** `tests/camera-math.spec.js`
- Mixes `Math.abs(...) < 0.01` with `toBeCloseTo()`. Standardize on `toBeCloseTo`.

### A-12: Test — `eventToScreen` with non-zero container offset untested
- **File:** `tests/camera-math.spec.js`
- Only tested implicitly. Container always at (0,0) in full-screen layout. Low risk.

---

## Cross-Cutting Findings

### Coordinate Space Consistency: PASS
All three coordinate spaces (world, screen, client) are used correctly throughout. Every conversion verified:
- `eventToScreen`: client → screen (subtracts container offset, divides by viewportScale)
- `screenToWorld`/`worldToScreen`: screen ↔ world (exact inverses verified algebraically)
- `applyTransform`: sets canvas matrix matching worldToScreen model
- Token hit-testing: event → screen → world pipeline correct
- Token label positioning: world → screen → DOM placement correct

### Camera State Flow: NO INFINITE LOOPS
- `broadcastState()` sends mode/scene/tokens/fog but **NOT** camera state
- Camera state only flows: Controller → `CAMERA_STATE` msg → `camera:set-state` EventBus → Camera methods → `camera:changed` → redraw
- No feedback path back to BroadcastChannel
- **Phase 4 warning:** If continuous camera sync is added (VTT broadcasts camera state on change), a loop guard will be needed (skip broadcast if the change originated from a received message)

### Mode Transition Completeness: PASS
- Theater→Map: scaler clears transform → container goes 100% → ResizeObserver fires → canvas resizes → camera re-centers. Event ordering correct (scaler registered before renderer).
- Map→Theater: scaler applies CSS scale → fixed 1920x1080 → `#theater` has explicit dimensions via CSS. Canvas hides with `map-container.hidden = true`.
- Map→Initiative: initiative panel overlays map. Camera does not account for reduced visible width (the initiative panel sits ON TOP of the map, not beside it — correct).

### Event Listener Cleanup: ACCEPTABLE (Advisory noted)
- `attachTo()` has no idempotency guard (AH-2)
- Window listeners are never removed
- Acceptable for singleton lifecycle; document for future refactoring

### Canvas Memory Budget: ACCEPTABLE
- 5 canvases × 4096×4096 × 4 bytes = 335MB worst case (4K+ display)
- Typical at 1920×1080: ~40MB. At 2560×1440: ~70MB
- 4096 cap specifically prevents runaway allocation
- Monitored, not actionable

### BroadcastChannel Camera Sync: CORRECT
- Camera excluded from `broadcastState()` — intentional
- Controller gets mode/scene/tokens on `STATE_REQUEST`, not camera position
- Camera sync is one-directional: Controller → VTT (not bidirectional)
- Controller and VTT can have different zoom levels by design (Controller has its own UI, VTT shows player view)

### Fog State Management: CONSISTENT
- `state.fog` is stored non-reactively in `state.fog` object
- `_syncFog()` calls `store.patch()` which triggers `subscribeAll` → persistence debounce
- `broadcastState()` does NOT include fog — fog is DM-only state
- Fog persistence works correctly via `PERSIST_KEYS` which includes `'fog'`

---

## False Positives (Documented)

| # | Concern | Why It's Intentional |
|---|---------|---------------------|
| 1 | `screenToWorld`/`worldToScreen` not inverses | They ARE exact inverses (verified algebraically) |
| 2 | `applyTransform` matrix wrong | Matrix correctly matches `worldToScreen` |
| 3 | `_pendingPan` stuck on mouseup before threshold | `mouseup` always clears `_pendingPan` |
| 4 | Context menu suppression broken | `_panScreenDist` reset in `_startPan`, persists through `mouseup` → `contextmenu` |
| 5 | Wheel pan sign convention wrong | Correct: positive deltaX → camera x increases → content scrolls right |
| 6 | Serialization incomplete | `deserialize()` calls `_updateCoverZoom()`, handles partial data, excludes viewport dims intentionally |
| 7 | Canvas cap math wrong | Proportional clamping via `Math.min(1, MAX/w, MAX/h)` is correct |
| 8 | Viewport scale relay wrong | `capScale = canvasW / actualW` correct: identity when uncapped, >1 when capped |
| 9 | Fog composite leaks `destination-out` | `clearRect` ignores composite mode; each draw starts with reset |
| 10 | Fog serialization performance concern | 1200-element array per toggle is negligible for mouse-driven operations |
| 11 | ResizeObserver `borderBoxSize` fallback ordering | Correct: `borderBoxSize` preferred, `contentRect` fallback for Safari <15.4 |
| 12 | Grid lines at extreme zoom sub-pixel | Lines are zoom-invariant by design: always ~0.5px and ~1px on screen |
| 13 | New maps start fully revealed | Intentional: DM sees full map, selectively fogs before screensharing |
| 14 | Transform bracket correctness | All 3 renderers + 4 persistent effect types verified correct |
| 15 | `getViewportScale()` returns 1 before init | Safe: all consumers run after init |
| 16 | `#theater` explicit dimensions overflow | Correctly hidden + overflow clipped during map mode |
| 17 | Canvas z-index conflicts | z-index 0-4 + labels at 10: no conflicts |
| 18 | Theater-to-map FOUC | Batched in single paint cycle, correct event ordering |
| 19 | Camera state not persisted | Intentional: camera resets to cover zoom on refresh (correct for screenshare) |
| 20 | `getBoundingClientRect()` perf on mousemove | Modern browsers cache layout results; same pattern used throughout |
| 21 | Test: `panBy` negative deltas untested | Linear math, no branching — negative inputs provide zero additional coverage |
| 22 | Test: No `afterEach` cleanup needed | Playwright per-test isolation sufficient |
| 23 | `effects-engine.js` unused `state` import removed in cleanup pass | Confirmed unused via grep; removal in `9e8344a` is correct housekeeping, not a behavioral change |

---

## Recommended Fix Priority

### Should fix before Phase 2 (low risk to defer, but clean-up opportunity)
1. **AH-2:** Add idempotency guard to `attachTo()` (1 line)
2. **AH-4:** Document uniform-brush intent in `toggleFogAtCursor` (comment + extract toggle decision)
3. **AH-5:** Add staleness guard to `loadMap()` image callbacks (3 lines)
4. **AH-6:** Fix viewport-scaler early-return to not block mode transitions (restructure guard)

### Should fix before Phase 2 (input handling adds keyboard zoom)
5. **AH-9:** Zoom boundary tests (MIN_ZOOM/MAX_ZOOM clamping) — Phase 2 adds keyboard zoom controls; boundary tests catch wrong-direction bugs immediately

### Should fix before Phase 3 (boundary clamping)
6. **AH-8:** Token/effects line width clamping helper
7. **AH-10-12:** Remaining test coverage gaps (portrait map, theater transform value, viewport preserve)

### Phase 2+ candidates (no action now)
7. **AH-1:** `panBy()` viewportScale — only matters if theater-mode map interaction is added
8. **AH-3:** Token drag EventBus decoupling — worth doing during Phase 2 input refactor
9. **AH-7:** Viewport resize debouncing — rAF coalescing absorbs it; nice-to-have
10. **A-1 through A-12:** All advisory items — quality-of-life, no urgency
