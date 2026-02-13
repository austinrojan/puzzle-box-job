# Phase 2 (Input Handling) CodeRabbit Review Results

**Date:** 2026-02-13
**Scope:** 8 commits (`c89b641..1d91d3b`), 8 files, +549 / -114 lines
**Reviewers:** 3 parallel CodeRabbit agents + cross-cutting synthesis

## Summary

| Category | Count |
|----------|-------|
| **Blocking** | 0 |
| **Advisory (High)** | 6 |
| **Advisory** | 11 |
| **False Positive** | 14 |
| **Total findings** | 31 |

**Verdict: Phase 2 Input Handling is clear to proceed to Phase 3.** Zero blocking issues found. The sign convention chain is correct across all input vectors (wheel, keyboard, mouse drag, Controller). The exponential zoom model is mathematically sound. Test coverage is solid for core paths with known gaps for edge cases.

---

## Advisory Issues (High Priority)

### AH-1: `panBy()` still ignores `viewportScale` — surface area tripled
- **File:** `vtt/js/map-camera.js:452-455`
- **Phase 1 ref:** AH-1 (carried forward, unresolved)
- **Issue:** `panBy(dx, dy)` divides only by `zoom`, but the drag handler (line 559) divides by `zoom * viewportScale`. Phase 2 added three new callers of `panBy()` (wheel pan, keyboard pan, EventBus `camera:pan`), tripling the surface area of this inconsistency.
- **Impact:** Invisible in map mode (`viewportScale = 1.0`). Would manifest as velocity mismatch if theater-mode map interaction is added.
- **Fix:** `this.x -= dx / (this.zoom * this.viewportScale);` (and same for y).
- **Deferral decision:** Fix in Phase 3 alongside `_applyConstraints()`, not before. Phase 3 centralizes all camera mutations through `_applyConstraints()`, and `panBy()` flows through it. Fixing viewportScale now would require Phase 3 to account for the interaction between viewportScale correction and boundary clamping separately. The cleaner sequence is to address both in one pass where the constraint math can be verified holistically.

### AH-2: BoundsCache has no manual invalidation after `hidden` toggle on mode transition
- **File:** `vtt/js/map-camera.js:25-63`
- **Issue:** The cleanup pass removed the public `invalidate()` method, leaving only ResizeObserver + window resize/scroll as invalidation triggers. When `#map-container` transitions from `hidden` to visible, ResizeObserver fires asynchronously. There is a theoretical sub-frame timing window where `eventToScreen()` could read stale cached bounds.
- **Impact:** Theoretical only. ResizeObserver fires before any user mouse interaction is practically possible. The map-renderer's `requestAnimationFrame` on `mode:changed` also calls `_onContainerResize`.
- **Fix:** Re-expose `invalidate()` or add a `mode:changed` listener that invalidates the BoundsCache. Defense-in-depth.

### AH-3: Zoom presets fail on non-US keyboard layouts
- **File:** `vtt/js/map-camera.js:125-134`
- **Issue:** Zoom presets use `e.key` to match `)` (Shift+0) and `!` (Shift+1). On French AZERTY, German QWERTZ, and other layouts, Shift+0 and Shift+1 produce different characters. The presets silently fail.
- **Impact:** Affects DMs using non-US keyboard layouts. Workaround: use Controller's reset button instead.
- **Fix:** Add `e.code`-based fallbacks (`e.code === 'Digit0' && e.shiftKey`) alongside the `e.key` checks, or document as US-only.

### AH-4: Token drag coupling via `window.__vtt._dragging` — carried from Phase 1
- **File:** `vtt/js/map-camera.js:536`
- **Phase 1 ref:** AH-3 (carried forward, unresolved)
- **Issue:** Camera module reads `window.__vtt?.tokenManager?._dragging` — tight coupling to a private property via a debug global. Phase 2's new `KeyboardController` demonstrates the clean decoupled pattern (method calls on camera, no global state).
- **Impact:** Works today. Breaks silently if property renamed or init order changes.
- **Fix:** Replace with `EventBus.emit('token:drag-start')`/`EventBus.on(...)` pattern.

### AH-5: `waitForTimeout(300)` timing dependency in diagonal pan test
- **File:** `tests/input-handling.spec.js:76`
- **Issue:** The diagonal pan test relies on a fixed 300ms sleep to accumulate rAF displacement. Assertions are directional-only (`toBeGreaterThan`), which is good, but rAF may be delayed on heavily loaded CI runners or Docker environments without GPU.
- **Impact:** Potential flaky test on CI. Directional-only assertion mitigates but doesn't eliminate the risk.
- **Fix:** Replace `waitForTimeout(300)` with `page.waitForFunction(() => camera.x > originalX, { timeout: 5000 })`.

### AH-6: Shift+arrow acceleration (3x speed) untested
- **File:** `tests/input-handling.spec.js` (gap)
- **Issue:** `KeyboardController._tick` (map-camera.js:193) multiplies pan speed by 3 when Shift is held. No test covers this path. The 3x multiplier is a user-facing feature.
- **Impact:** The Shift acceleration code path is not regression-protected.
- **Fix:** Add test: hold ArrowRight 300ms, measure displacement; hold Shift+ArrowRight 300ms, verify ~3x displacement.

---

## Advisory Issues

### A-1: `fitCover()` missing zero-map guard that `fitContain()` has
- **File:** `vtt/js/map-camera.js:386-390`
- **Issue:** `fitContain()` guards `mapW <= 0 || mapH <= 0`, but `fitCover()` does not. Pressing Shift+0 (fitCover preset) in theater mode before a map loads would set `zoom = 0.1` (initial `_coverZoom`) and position the camera at `(-9600, -5400)`.
- **Fix:** Add `if (this.mapW <= 0 || this.mapH <= 0) return;` to `fitCover()`.

### A-2: Zoom-at-cursor at clamp boundary — minor test gap
- **File:** `vtt/js/map-camera.js:424-431`, `tests/camera-math.spec.js`
- **Issue:** No test verifies that the cursor point stays stable when `zoomAt()` clamps at MIN/MAX_ZOOM. The algorithm is correct (computed from actual zoom after clamping), but the edge case is not regression-protected.

### A-3: BoundsCache zero-rect fallback documentation
- **File:** `vtt/js/map-camera.js:57`
- **Issue:** Returns `{left:0, top:0, width:0, height:0}` when `_el` is null (before `attachTo()`). Safe because `attachTo()` is called before any mouse events. A JSDoc comment noting the pre-init fallback would help.

### A-4: dt cap value undocumented
- **File:** `vtt/js/map-camera.js:190`
- **Issue:** The 0.1s cap is a safety valve for tab-switch scenarios. A comment explaining why 0.1s was chosen (max 60px pan at base speed, ~3% viewport width) would help future maintainers.

### A-5: No `detach()` method — add comment
- **File:** `vtt/js/map-camera.js:611`
- **Issue:** Singleton lifecycle is intentional (no cleanup needed). Adding a one-line comment above `attachTo()` would prevent future contributors from wondering.

### A-6: `_isInputFocused` doesn't check `[role="textbox"]`
- **File:** `vtt/js/map-camera.js:73-76`
- **Issue:** ARIA textbox elements (`[role="textbox"]` with `contentEditable`) would be caught by the `isContentEditable` check. But elements with `role="textbox"` that are NOT contentEditable (rare, but possible in shadow DOM) would not be caught. No such elements exist in the current VTT.

### A-7: Orphaned JSDoc fragment in helpers.js
- **File:** `tests/helpers.js:48-51`
- **Issue:** Two JSDoc comment blocks back-to-back after the `gotoVTT` insertion. A blank line between them would improve readability.

### A-8: normalizeWheel tests pay `enterMapMode` cost unnecessarily
- **File:** `tests/input-handling.spec.js:13-16`
- **Issue:** The 5 pure-function normalizeWheel tests only need the HTTP server (for module import), not map mode. Splitting into two `describe` blocks (one with only `gotoVTT`) would save ~5-15 seconds of CI time per run.

### A-9: Tolerance inconsistency across camera-math assertions
- **File:** `tests/camera-math.spec.js`
- **Phase 1 ref:** A-11 (carried forward, unresolved)
- **Issue:** Mixes `Math.abs(x - y) < 0.01`, `toBeCloseTo()`, and `toBeLessThan(1)`. All correct, but standardizing would make test intent clearer.

### A-10: serialize/deserialize roundtrip test omits `mapW`/`mapH` verification
- **File:** `tests/camera-math.spec.js:181-196`
- **Issue:** The roundtrip test sets `mapW`/`mapH` before serializing but only verifies `x`, `y`, `zoom` after deserialization. Adding `mapW`/`mapH` assertions would strengthen the test.

### A-11: `enterMapMode` doesn't wait for paint cycle
- **File:** `tests/helpers.js:65-76`
- **Issue:** Returns as soon as `mapW > 0` is set, before the rAF-coalesced redraw completes. Acceptable for current tests (all read camera state, not canvas pixels). Would need revision if canvas pixel assertions are added.

---

## Cross-Cutting Findings

### Sign Convention Verification: PASS

All input→camera paths traced and verified correct:

| Input | Raw | Normalization | Handler call | Camera effect | Correct? |
|-------|-----|---------------|-------------|---------------|----------|
| Scroll-down | deltaY=+100 | dy=+100 | `panBy(0, -100)` | y increases → viewport DOWN | ✓ |
| Scroll-right | deltaX=+100 | dx=+100 | `panBy(-100, 0)` | x increases → viewport RIGHT | ✓ |
| Ctrl+scroll-up | deltaY=-100 | dz=-0.1 | `zoomAt(sx,sy,+0.06)` | zoom increases → ZOOM IN | ✓ |
| ArrowRight | dx=+speed\*dt | N/A | `panBy(-dx, 0)` | x increases → viewport RIGHT | ✓ |
| ArrowUp | dy=-speed\*dt | N/A | `panBy(0, +speed*dt)` | y decreases → viewport UP | ✓ |
| Middle-drag right | dxScreen>0 | N/A | `x = start - dx/(z*vs)` | x decreases → content follows mouse | ✓ |
| Controller ▲ up | `[0, 80]` | N/A | `panBy(0, 80)` | y decreases → viewport UP | ✓ |
| Controller ▼ down | `[0, -80]` | N/A | `panBy(0, -80)` | y increases → viewport DOWN | ✓ |
| Controller ◄ left | `[80, 0]` | N/A | `panBy(80, 0)` | x decreases → viewport LEFT | ✓ |
| Controller ► right | `[-80, 0]` | N/A | `panBy(-80, 0)` | x increases → viewport RIGHT | ✓ |
| Controller zoom +1 | direction=1 | N/A | `zoomToCenter(0.4)` | zoom *= 2^0.4 → ZOOM IN | ✓ |

**Critical verification:** `panBy()` still uses `this.x -= dx / this.zoom` (line 452). Controller buttons use drag convention values and pass through `camera:pan` EventBus without negation. All directions confirmed correct.

### Phase 1 Advisory Resolution

| Phase 1 ID | Status | Notes |
|------------|--------|-------|
| AH-1 | **Open** | `panBy` viewportScale — surface area tripled by Phase 2 (see AH-1 above) |
| AH-2 | **Fixed** | `if (this._el) return;` idempotency guard at line 612 |
| AH-3 | **Open** | Token drag coupling still at line 536 (see AH-4 above) |
| AH-9 | **Fixed** | MIN/MAX zoom clamping tests at camera-math.spec.js lines 121-149 |
| A-3 | **Fixed** | `_cancelPan()` now clears `_pendingPan` at line 653 |
| A-11 | **Open** | Tolerance inconsistency still present (see A-9 above) |

### Event Listener Audit

**Total listeners from `attachTo()` and sub-methods: 24**

| Target | Event | Handler | Source |
|--------|-------|---------|--------|
| `document` | wheel | prevent browser zoom (Ctrl) | `_preventBrowserZoom` |
| `document` | keydown | prevent browser zoom (Ctrl+/-/=/0) | `_preventBrowserZoom` |
| `document` | gesturestart | prevent Safari gesture (conditional) | `_preventBrowserZoom` |
| `document` | gesturechange | prevent Safari gesture (conditional) | `_preventBrowserZoom` |
| `window` | keydown | KeyboardController arrow/zoom keys | `_keyboard.attach` |
| `window` | keyup | KeyboardController key release | `_keyboard.attach` |
| `window` | blur | KeyboardController._clearKeys | `_keyboard.attach` |
| `document` | visibilitychange | KeyboardController clear on hidden | `_keyboard.attach` |
| `el` | wheel | map zoom/pan (passive: false) | `_attachWheelHandler` |
| `el` | mousedown | initiate pan | `_attachMouseHandlers` |
| `window` | mousemove | continue pan | `_attachMouseHandlers` |
| `window` | mouseup | end pan | `_attachMouseHandlers` |
| `el` | contextmenu | suppress after drag (capture) | `_attachMouseHandlers` |
| `window` | keydown | Space+drag mode | `_attachSpaceKey` |
| `window` | keyup | Space release | `_attachSpaceKey` |
| `window` | blur | cancel pan | `_attachSafetyGuards` |
| `document` | visibilitychange | cancel pan on hidden | `_attachSafetyGuards` |
| `el` | mouseleave | cancel pan | `_attachSafetyGuards` |
| EventBus | camera:pan | Controller pan | `attachTo` inline |
| EventBus | camera:zoom | Controller zoom | `attachTo` inline |
| EventBus | camera:set-state | Controller state sync | `attachTo` inline |
| ResizeObserver | (observe) | BoundsCache invalidation | `_boundsCache.observe` |
| `window` | resize | BoundsCache invalidation | `_boundsCache.observe` |
| `window` | scroll | BoundsCache invalidation | `_boundsCache.observe` |

**Duplicate handler pairs (different handlers, correct):**
- `window:keydown` — KeyboardController + SpaceKey (different concerns)
- `window:blur` — KeyboardController._clearKeys + SafetyGuards._cancelPan (different concerns)
- `document:visibilitychange` — KeyboardController + SafetyGuards (different concerns)

**No `stopPropagation` conflicts** between handlers. `stopPropagation` used only in contextmenu (capture phase, after drag) and Space+left-click mousedown (prevents token click during space-pan). Both are intentional.

### `_isInputFocused` DOM Coverage

**Question:** Are there any `<input>`, `<textarea>`, `<select>`, or `contentEditable` elements in the VTT DOM in auto-presentation mode?

**Answer: No.** A grep of the entire `vtt/` directory for `<input`, `<textarea`, `<select`, `contentEditable`, and `contenteditable` returns zero matches. The VTT party-facing display has no editable elements.

**Implication:** `_isInputFocused()` is effectively dead code in the VTT Display today. It guards against a scenario that cannot occur in the current DOM. However, it is correct to keep it:
1. The initiative panel could gain editable name fields in a future phase.
2. The DM Controller (which runs in the same browser) could interact via focus changes.
3. The guard costs nothing (one `tagName` comparison per keydown) and prevents a class of bugs proactively.

For Phase 3 context: the `_isInputFocused` test coverage gap (listed below) is low priority precisely because no triggering elements exist. It becomes relevant only if editable elements are added to the VTT DOM.

### Test Coverage Matrix

| Feature | Tested | Gap? |
|---------|--------|------|
| normalizeWheel: deltaMode 0/1/2 | ✓ | — |
| normalizeWheel: Shift+scroll horizontal swap | ✓ | — |
| normalizeWheel: ctrlKey pinch detection | ✓ | — |
| normalizeWheel: clamping extreme deltas | ✓ | — |
| normalizeWheel: metaKey (Cmd+scroll) | ✗ | Low risk (OR condition) |
| Exponential zoom uniformity | ✓ | — |
| MIN/MAX zoom clamping | ✓ | — |
| Zoom-at-cursor world point stability | ✓ | Clamp boundary untested |
| Arrow key pan + diagonal | ✓ | — |
| Shift+arrow acceleration (3x) | ✗ | **AH-6** |
| Arrow key stop on blur | ✓ | — |
| +/- zoom at center | ✓ | — |
| camera:zoom EventBus compat | ✓ | — |
| Shift+0/1 zoom presets | ✗ | Gap |
| Space+click pan | ✗ | Gap |
| BoundsCache invalidation | ✗ | Gap |
| Browser zoom prevention | ✗ | Hard to test in headless |
| `_isInputFocused` guard | ✗ | Gap |
| fitContain letterboxing | ✓ | — |
| fitCover | ✓ (implicit via map load) | — |
| Mode switch CSS transform | ✓ | — |
| serialize/deserialize roundtrip | ✓ | mapW/mapH not verified |

---

## False Positives (Documented)

| # | Concern | Why It's Intentional / Correct |
|---|---------|-------------------------------|
| 1 | normalizeWheel Shift+scroll swap when dx=0 | Guard `dx === 0` prevents clobbering real horizontal delta; `dy=0` produces no-op, not NaN |
| 2 | Exponential zoom sign chain | Traced: scroll-up → negative dz → `dz * -0.6` = positive delta → zoom in. Correct. |
| 3 | Controller pan sign convention | Drag-convention values pass through `camera:pan` → `panBy()` without negation. All 4 directions correct. |
| 4 | Sign convention across all 4 input vectors | See cross-cutting table above. All paths verified. |
| 5 | rAF loop double guard (cancelAnimationFrame + _active) | Belt-and-suspenders. `cancelAnimationFrame` is primary; `_active` check is defensive. Cost: one boolean per frame. |
| 6 | `_clearKeys()` uses object replacement vs spec's mutation | Produces identical behavior. New object is cleaner than iterating properties. |
| 7 | `_onKeyUp` checks only CAMERA_KEYS (not Shift) | Improvement over spec. Shift alone doesn't keep loop running — avoids wasting CPU on no-op `_tick`. |
| 8 | `touch-action: none` on `#map-container` | Zero cost on desktop. Proactive for future touch support. Per spec. |
| 9 | `_cancelPan()` Phase 1 A-3 fix | Confirmed: `_pendingPan = false` at line 653. All three safety guards go through `_cancelPan()`. |
| 10 | Synthetic blur in test equivalent to real | `window.dispatchEvent(new Event('blur'))` triggers `window` blur listener identically to real blur. No `relatedTarget` or `bubbles` difference on `window`. |
| 11 | fitContain test bypasses `setMapSize` | Intentional isolation: tests `fitContain()` without `setMapSize`'s `fitCover` cascade. `_coverZoom` not referenced by `fitContain`. |
| 12 | Mode switch assertion checks presence not equality | `not.toBe('none')` is the correct specificity — exact matrix values depend on viewport dimensions and would be brittle. |
| 13 | `_preventBrowserZoom` misses Ctrl+Shift+= | Already handled: `e.key` resolves to `'+'` for Ctrl+Shift+= on US QWERTY. |
| 14 | Dynamic import in normalizeWheel tests fragile | Module has 0 imports (44 lines, self-contained). `gotoVTT` warms the server. Acceptable risk; would only break if module gains imports. |

---

## Recommended Fix Priority

### Must fix before Phase 3
1. **A-1:** Add zero-map guard to `fitCover()` (1 line) — prevents disorienting state from keyboard shortcut

### Should fix before Phase 3 (low risk to defer)
2. **AH-3:** Add `e.code`-based fallbacks for zoom presets (3 lines) — non-US layout support, embarrassing to ship without
3. **AH-2:** Re-expose `invalidate()` on BoundsCache or add `mode:changed` listener — defense-in-depth
4. **AH-5:** Replace `waitForTimeout(300)` with poll-based assertion — prevents flaky CI

### Fix in Phase 3 (alongside constraint refactor)
5. **AH-1:** Fix `panBy()` to include `viewportScale` — deferred to Phase 3 where `_applyConstraints()` centralizes camera mutations; fixing now would require Phase 3 to re-verify the viewportScale×clamping interaction separately

### Phase 3+ candidates
6. **AH-4:** Replace `window.__vtt._dragging` with EventBus pattern — architectural cleanup
7. **AH-6:** Add Shift+arrow acceleration test — coverage gap
8. **A-8:** Split normalizeWheel tests into separate `describe` without `enterMapMode` — CI speed
9. **A-9:** Standardize test tolerance patterns — consistency
10. Remaining coverage gaps (Shift+0/1 presets, Space+click, BoundsCache invalidation, `_isInputFocused` guard)
