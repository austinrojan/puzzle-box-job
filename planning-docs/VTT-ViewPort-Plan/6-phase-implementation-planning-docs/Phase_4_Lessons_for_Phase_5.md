# Phase 4 Lessons Learned — Carry Forward to Phase 5

> Generated from Phase 4 manual testing (10-item browser automation checklist).
> These are validated findings, not speculation.

---

## 1. Bug Found: rAF Background Tab Throttling (FIXED)

**Commit:** `022d6ae` — `fix(phase4): call sendImmediate() after Controller camera button presses`

**Problem:** `requestAnimationFrame` doesn't fire in background/inactive Chrome tabs. The Controller's camera button handlers (zoom-in, zoom-out, pan, reset) relied on the rAF render loop to broadcast CAMERA_SYNC messages. When the Controller tab was in the background (which it always is during a session — the DM looks at the DM Guide, not the Controller), button clicks updated local state but never sent sync messages.

**Why tests missed it:** Playwright doesn't throttle rAF the same way real Chrome does. All 592 automated tests passed while the Controller's camera buttons were completely non-functional in production.

**Fix:** Added `sendImmediate()` calls after each button click handler, bypassing rAF entirely for user-initiated actions.

**Phase 5 relevance:** Any new Controller UI that triggers camera changes (presets, flyTo, fit-to-tokens) must also call `sendImmediate()` rather than relying on rAF.

---

## 2. Expose `syncEngine.sendNow()` Public API

**Current state:** Button handlers in `controller/js/ui-builders.js` reach into `syncEngine._broadcaster` (private property) to call `sendImmediate()`. There's a TODO in the code marking this for cleanup.

**Recommendation:** Phase 5 should expose a public `syncEngine.sendNow()` method that delegates to the broadcaster. This eliminates the private property chain and provides a clean API for all new features that need immediate sync (presets, flyTo endpoints, fit-to-tokens results).

**File:** `vtt/js/camera-sync.js` — `CameraSyncEngine` class

---

## 3. Cover Zoom Gap: 0.664 to 1.0

**Finding:** The Controller's headless Camera viewport (1920×1080) computes `coverZoom = max(1920/1920, 1080/1440) = 1.0` for the 1920×1440 map. The Display's actual Chrome viewport computes `coverZoom ≈ 0.664`. The Controller can never send a zoom below 1.0 (its own floor), so the Display's floor (0.664) is never exercised through Controller zoom-out.

**Current risk:** None — the two-tier clamping is safe because the Controller's floor is always higher.

**Phase 5 risk:** If Phase 5 adds **direct zoom-to-value input** (slider, numeric entry, or programmatic zoom), values in the 0.664–1.0 range would be accepted by the Display without clamping but are below what the Controller's zoom-out can reach. This zone needs explicit validation if direct input is added.

**Files:**
- `vtt/js/map-camera.js` — `_coverZoom` computation, `_applyConstraints()`
- `controller/js/main.js` — headless `Camera(1920, 1080)` initialization

---

## 4. "Fit to Display Viewport" Needs Real Dimensions

**Finding:** The Controller's "reset" command sends its own `coverZoom` (1.0), computed from its headless 1920×1080 viewport. The Display accepts this because 1.0 > 0.664. But the resulting framing differs from what the Display would compute natively.

**Phase 5 relevance:** If a **"fit to Display viewport"** command is added (one that should respect the Display's actual dimensions rather than the Controller's nominal ones), it must query the Display's real `viewportW`/`viewportH` via the WELCOME handshake or a dedicated query message. The Controller cannot compute this locally.

**Possible approach:** Add a `VIEWPORT_QUERY` / `VIEWPORT_RESPONSE` message pair to the camera channel protocol, or include viewport dimensions in the existing `state:sync` payload.

---

## 5. Test Fidelity Gap: Playwright Cross-Window Tests

**Finding:** The Playwright integration tests from Phase 4 Task 9 verify cross-window sync by programmatically calling `camera.zoomToCenter()` on the Controller side. They don't call `sendImmediate()` afterward because Playwright's test contexts don't throttle rAF — the render loop fires immediately and broadcasts the sync message.

**Problem:** These tests pass for the wrong reason. They don't exercise the `sendImmediate()` path that real button handlers use.

**Recommendation:** Either:
1. Add a dedicated test that verifies `sendImmediate()` triggers a sync message on the camera channel, OR
2. Refactor the button handler tests to go through the actual DOM click path (`document.getElementById('zoom-in').click()`) so the `sendImmediate()` call is exercised

Not blocking, but it's a gap in test fidelity that could mask future regressions.

**File:** `tests/` — Phase 4 cross-window integration tests

---

## 6. BroadcastChannel Module Cache Gotcha

**For manual testing:** After any code changes to ES modules, a normal page refresh (`Cmd+R` / `navigate()`) does NOT bust the module cache. You must hard-refresh (`Cmd+Shift+R`) to pick up changes. This applies to VTT, Controller, and any ES module-based page.

---

## 7. WELCOME Handshake Timing

**Finding:** If the Display sends ANNOUNCE before the Controller's message listener is ready on a refreshed BroadcastChannel, the WELCOME response can be missed. This is benign because continuous CAMERA_SYNC messages flow regardless — the Display picks up state on the next broadcast.

**The one scenario where it matters:** If the Controller has state (like map dimensions) that the Display needs to bootstrap and can't get any other way. In Phase 4 this doesn't happen because the Display always has its own map loaded.

**Phase 5 relevance:** If new handshake data is added to WELCOME (e.g., preset lists, animation state), ensure there's a fallback path for missed WELCOMEs — either periodic re-ANNOUNCE or including the data in regular CAMERA_SYNC messages.
