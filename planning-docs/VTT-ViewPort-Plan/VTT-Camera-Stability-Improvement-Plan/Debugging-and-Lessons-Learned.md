# Camera System Debugging Guide: Lessons Learned

**A complete reference for the bugs, mistakes, fixes, and hard-won insights from building the VTT's elastic overscroll camera system across Phases 6, S1–S5, and the post-merge snap-back debug cycle.**

Use this document when building any interactive viewport, camera, or scroll system. Every section exists because we made the mistake it describes.

---

## Table of contents

1. [The five original bugs](#the-five-original-bugs)
2. [Root causes: two architectural mistakes](#root-causes)
3. [What we tried that didn't work](#what-didnt-work)
4. [What finally worked (phase by phase)](#what-finally-worked)
5. [The post-merge snap-back delay crisis](#post-merge-crisis)
6. [Critical bugs found during implementation](#implementation-bugs)
7. [Testing lessons (the hard way)](#testing-lessons)
8. [Patterns to reuse](#patterns-to-reuse)
9. [Anti-patterns to avoid](#anti-patterns)
10. [Quick-reference troubleshooting](#troubleshooting)

---

## The five original bugs {#the-five-original-bugs}

These were the user-visible symptoms that launched the entire stabilization effort. All five traced back to just two root causes.

| Bug | Symptom | Severity |
|-----|---------|----------|
| **#1: Elastic freeze** | After a fast trackpad scroll past the map boundary, the elastic overscroll freezes visually for 1–2 seconds before snapping back | High — feels broken |
| **#2: Spring overshoot** | When snap-back finally fires, the viewport flings to the opposite side of the map | High — disorienting |
| **#3: Zoom after pinch** | Immediately after a pinch-zoom ends, the next scroll gesture gets misclassified as zoom | Medium — unexpected zoom |
| **#4: Fast scroll triggers zoom** | Fast two-finger trackpad scrolls (deltas 50–150px) are routed to zoom instead of pan | Medium — unexpected zoom |
| **#5: Erratic behavior** | Rapid alternation between pan and zoom modes during continuous input | Medium — feels glitchy |

---

## Root causes: two architectural mistakes {#root-causes}

Every bug traced to one of these two decisions made during the original Phase 6 implementation.

### Root cause 1: Per-event device classification

**The mistake:** `classifyWheelDevice()` was a stateless function that made a binary decision on every single WheelEvent: `if (maxDelta >= 50 && integer && no deltaX) → 'mouse'`. It discarded all history from prior events.

**Why it failed:** Fast two-finger trackpad scrolls on macOS routinely produce integer deltas of 50–150px. The function misclassified these as mouse wheel events, routing them to `SmoothZoomAnimator.onWheelZoom()` instead of `panBy()`. This caused bugs #3, #4, and #5.

**The lesson:** Device identity is a session-level property that changes rarely (when the user physically switches devices), but individual WheelEvents are noisy and ambiguous. You cannot reliably classify a device from a single event. You need a stateful classifier that maintains a belief and requires strong evidence to change it.

### Root cause 2: Timeout-gated gesture end detection

**The mistake:** `TrackpadGestureDetector` required 3 consecutive decaying deltas (after 6+ events) to transition ACTIVE→MOMENTUM, then waited for a 100ms timeout silence to fire `onGestureEnd` and trigger `_snapBackElastic()`.

**Why it failed:** During this entire detection window, the elastic offset was held visible but not animating — the overscroll was frozen on screen. For fast gestures with few momentum events, this window stretched to 1–2 seconds. When snap-back finally fired, the accumulated momentum velocity was passed unclamped to the spring, causing overshoot (bug #2).

**The lesson:** Never make the user wait for certainty when you can act on a best guess and correct later. The cost of a wrong animation that gets cancelled after 16ms is imperceptible. The cost of a 1.5-second freeze is glaring. This is the "speculative execution" principle from CPU design applied to UI animation.

---

## What we tried that didn't work {#what-didnt-work}

### Failed approach 1: Tighter timeout thresholds

**What we tried:** Reducing `TIMEOUT_ACTIVE_MS` from 150ms to 80ms and `TIMEOUT_MOMENTUM_MS` from 100ms to 60ms (Phase S3).

**Why it failed:** It helped but didn't solve the problem. macOS sends 60+ inertial scroll events over 1–2 seconds after the user lifts their fingers. Even with tighter timeouts, the stream of momentum events keeps resetting the timeout, preventing gesture end from firing until the last event arrives. The fundamental issue was waiting for silence that doesn't come.

**Lesson:** When the input stream itself prevents your timeout from firing, making the timeout shorter doesn't help. You need a different detection strategy.

### Failed approach 2: Fixed-rate elastic decay

**What we tried:** A per-frame `overflow *= 0.8` decay to drain elastic offset gradually.

**Why it failed:** Frame-rate dependent. At 60fps, `0.8^60 ≈ 0.0001` (drains in ~1s). At 30fps, `0.8^30 ≈ 0.001` (drains in ~0.5s). Different monitors, background tabs, and system load produced different drain rates and different "feel." Also, `0.8` per frame doesn't map to any physical quantity — it's a magic number with no clear relationship to gesture speed or viewport size.

**Lesson:** Never use per-frame multiplicative decay without frame-rate normalization. Use either `friction^(dt/baseDt)` with a reference frame time, or use a spring with a closed-form analytical solution that takes dt as a parameter.

### Failed approach 3: Change-detection optimization in `_applyConstraints`

**What we tried:** Adding `if (prevX === this.x && prevY === this.y && prevZoom === this.zoom) return;` at the top of `_applyConstraints` to skip redundant work.

**Why it failed spectacularly:** `setPosition()` sets `this.x` and `this.y` *before* calling `_applyConstraints()`. So when `_applyConstraints` runs, `prevX` always equals `this.x` when the position is within bounds. The optimization skipped the `camera:changed` event emission, breaking semantic zoom, BroadcastChannel sync, and any listener that depended on position updates.

**Lesson:** Never add "optimization" guards to methods that have side effects (like event emission) without verifying every call site. Methods that always emit events should be treated as contracts, not optimization candidates. If you need to reduce work, cache the computed bounds instead of skipping the entire method.

### Failed approach 4: Separate rAF loops for each animation

**What we tried:** Before Phase S5, we had three independent animation systems: `CameraAnimator` (elastic snap-back), `SmoothZoomAnimator` (mouse wheel zoom), and inertial coast (custom rAF). Each ran its own `requestAnimationFrame` loop.

**Why it failed:** Timing desynchronization. When elastic snap-back and zoom were both animating, they wrote to camera state on different frames, causing 1-frame position jumps. The zoom animator would set the camera position, then on the next frame the elastic animator would overwrite it with a position that didn't account for the zoom change. Also, three separate rAF registrations meant three DOM reads per frame.

**Lesson:** A camera should have exactly one animation loop that advances all spring axes in a single tick and writes to camera state once. This eliminates timing skew by construction.

---

## What finally worked (phase by phase) {#what-finally-worked}

### Phase S1: Stateful device classification

**Solution:** Replace the per-event `classifyWheelDevice()` with `WheelDeviceClassifier` — a sliding-window Bayesian classifier that maintains a device belief across events.

**Key design decisions:**
- **6-event sliding window** — enough history for accurate classification, small enough to react to device switches
- **6 discriminative signals** — inter-event timing, fractional deltas, simultaneous axes, deltaMode (Firefox), very small deltas, large vertical-only
- **Asymmetric hysteresis** — 4 mouse signals to enter mouse classification, but only 2 trackpad signals to leave it. "Default to pan when uncertain."
- **Silence reset** — 400ms gap resets to `unknown`. The user may have switched devices.

**Three scoring corrections found during testing:**
1. Signal 5 (very small deltas) had to be restricted to `deltaMode === 0`. Firefox line-mode deltas of 3 don't mean 3 pixels — they mean 3 lines.
2. Signal 6 (large vertical-only) needed a `gap > 40ms` guard. Fast large deltas during trackpad momentum are trackpad, not mouse.
3. After silence reset, the gap was zeroed to prevent the next event from getting an artificial >400ms gap score (which looks like a mouse signal).

### Phase S2: Velocity-clamped spring snap-back

**Solution:** Clamp the initial velocity passed to the spring so it can never cause overshoot.

**The math:** For a critically damped spring with natural frequency `omega`, displacement `d` from target, and initial velocity `v`: overshoot occurs when `v < -omega * d` (for positive d). The clamp is:
```
v_critical = -omega * d
v_clamped = max(v, v_critical)  // for d > 0
v_clamped = min(v, v_critical)  // for d < 0
```

**Defense in depth (three layers):**
1. **Velocity clamp** in `_snapBackElastic()` — prevents overshoot
2. **Position safety net** in spring tick — clamps elastic offset to never cross zero during snap-back
3. **Coast speed cap** — `MAX_COAST_SPEED = 3000 px/s` prevents unreasonable velocities from ever reaching the spring

### Phase S3: Speculative snap-back

**Solution:** Don't wait for formal gesture-end detection. On every frame where the camera is overscrolled, monitor the elastic offset change rate via EWMA. When the change rate stalls (< 0.5 screen px/frame), start a zero-velocity snap-back. If more active input arrives, cancel it.

**Key design decisions:**
- **EWMA (alpha=0.3, initial=10)** — exponential weighted moving average smooths noise in the change rate. Alpha=0.3 means recent frames dominate.
- **Stall threshold = 0.5 screen px/frame** — below this, the elastic offset is effectively frozen. Start snapping.
- **Double-fire guard** — `_isSnappingBack` flag prevents speculative snap-back from creating a second spring animation when the formal gesture-end triggers its own snap-back.
- **`_cancelSpeculativeSnapBack()`** — kills the monitoring rAF and elastic animator but preserves the elastic offset value. Called when new active input arrives.

**Tightened gesture detector constants (from S3):**
```
DECAY_STREAK_THRESHOLD: 3 → 2
MIN_EVENTS_FOR_MOMENTUM: 6 → 4
TIMEOUT_ACTIVE_MS: 150 → 80
TIMEOUT_MOMENTUM_MS: 100 → 60
```

### Phase S4: Hierarchical gesture coordination

**Solution:** Replace the flat priority-based gesture state machine with 5 ordered decision rules:

1. **Same gesture retarget** — always accept (e.g., continued scrolling)
2. **User preempts animation** — always instant (user always wins)
3. **User replaces user** — higher priority wins, equal requires dwell time
4. **IDLE cooldown** — 50ms same-tier cooldown absorbs stray events after gesture end
5. **Animation replaces animation** — priority decides

**Key design decisions:**
- **Tier separation** — user gestures (SCROLL_PAN, PINCH_ZOOM, DRAG_PAN) and animation gestures (SNAP_BACK, INERTIA, ZOOM_ANIMATE) are distinct tiers. Cooldown only blocks same-tier switches.
- **Dwell time = 80ms** — prevents oscillation between gesture types (e.g., rapid alternation between scroll-pan and pinch-zoom from noisy trackpad input).
- **Zoom anchor decontamination** — `logicalScreenToWorld()` uses logical (hard-clamped) position instead of visual position for zoom anchor calculation. Elastic offset was contaminating the world-space anchor, causing the viewport to jump when zooming while overscrolled.

### Phase S5: Unified spring physics

**Solution:** Replace all separate animation systems with a single `CameraSpringLoop` containing five spring axes (panX, panY, elasticX, elasticY, logZoom). One rAF loop, one write per frame.

**Key design decisions:**
- **Closed-form analytical springs** — `x(t) = (A + B*t) * e^(-omega*t)` — frame-rate independent, no numerical integration error
- **Log-space zoom** — zoom is animated in log space (`log(zoom)`) to preserve multiplicative stepping. Each mouse wheel notch is a constant multiplier regardless of current zoom level.
- **Zoom anchor preservation** — during zoom animation, camera position is adjusted each frame so the anchor point (under the cursor) stays fixed on screen
- **Coast as spring** — inertial coast uses a very low stiffness spring (stiffness=20, omega≈4.47) with friction, not a separate velocity decay system
- **Auto start/stop** — `ensureRunning()` is idempotent. Loop stops automatically when all springs settle and coast is done.
- **Elastic sign clamping** — during snap-back, elastic offset is prevented from crossing zero (prevents oscillation ringing)

---

## The post-merge snap-back delay crisis {#post-merge-crisis}

After merging the Phase S5 feature branch into main, a new category of bug appeared: **snap-back delays at boundaries.** This was a multi-commit emergency debug session (PR #3) that revealed how interconnected the subsystems are.

### Symptom

After scrolling to a boundary and stopping, the elastic overscroll would freeze for 200–500ms before snapping back. The speculative snap-back system from Phase S3 wasn't triggering.

### Root cause chain (three separate bugs)

**Bug A: Competing speculative and formal animations.** When the speculative snap-back detected a stall and started an elastic spring animation, the formal `onGestureEnd` callback (from TrackpadGestureDetector's timeout) would fire shortly after and start a *second* snap-back animation. The second animation overrode the first, resetting the spring to the beginning with zero velocity, causing a visible jitter and delay.

**Fix:** `_isSnappingBack` guard in `_snapBackElastic()` — if already snapping, ignore subsequent calls unless they carry nonzero velocity (which means a deliberate restart, e.g., from drag release).

**Bug B: Coast preventing snap-back at boundaries.** When the user scrolled into a boundary with enough velocity, inertial coast started. The coast would push against the boundary, each frame's `panBy()` returning clamped overflow to `_feedElasticOverflow()`. But coast's friction decay was slow enough that the coast continued for hundreds of milliseconds, and the speculative snap-back couldn't start because coast held the gesture active.

**Fix:** Boundary-aware coast bypass. In `_tickCoast()`, count frames where elastic offset is unchanged (meaning coast is pushing against a hard wall). After 2 consecutive "saturated" frames, terminate coast immediately and trigger snap-back. This ensures coast ends quickly at boundaries instead of slowly decaying to zero.

**Bug C: macOS momentum events suppressing snap-back.** After the user lifts their fingers from the trackpad, macOS sends 60+ inertial scroll events over 1–2 seconds. Each event reached `panBy()`, which fed `_feedElasticOverflow()`, which kept the elastic offset "alive" and prevented the speculative snap-back from detecting a stall.

**Fix:** Momentum pan suppression. When `TrackpadGestureDetector` enters MOMENTUM state and elastic offset is nonzero, set `_momentumPanSuppressed = true`. While suppressed, momentum events are still fed to the detector (for timeout tracking) but `panBy()` is skipped. This lets the speculative snap-back's EWMA detect the stall and trigger snap-back while the momentum events drain harmlessly.

### Lesson from the crisis

These three bugs only appeared together on real trackpad hardware with macOS momentum events. They were invisible in unit tests (which don't generate real momentum streams) and in mouse-only testing. **The interaction between subsystems created emergent behavior that no single subsystem's tests could catch.**

This is why integration tests that simulate realistic gesture sequences (start → scroll → boundary hit → coast → momentum → snap-back) are essential. Unit testing each piece in isolation gave false confidence.

---

## Critical bugs found during implementation {#implementation-bugs}

These were bugs discovered and fixed during the phased implementation, not the original five.

### `_applyConstraints` must always emit `camera:changed`

**What happened:** Added a change-detection optimization (`if prevX === this.x, skip`). Broke everything.

**Root cause:** `setPosition()` sets `x/y` *before* calling `_applyConstraints()`, so `prev` always equals `current` when within bounds. The skip prevented event emission, breaking BroadcastChannel sync, semantic zoom, and render updates.

**Fix:** Remove the optimization. `_applyConstraints` unconditionally emits `camera:changed`. If you need to reduce listener work, throttle the listeners, not the emitter.

### Elastic offset contaminated zoom anchors

**What happened (Phase S4):** `screenToWorld()` uses `visualX/Y` (which includes elastic offset). When zooming while overscrolled, the zoom anchor was calculated in "contaminated" coordinates. After snap-back zeroed the elastic offset, the viewport jumped because the anchor point had been calculated relative to a position that no longer existed.

**Fix:** Added `logicalScreenToWorld()` which uses `this.x/y` (hard-clamped logical position) instead of `this.visualX/Y`. All zoom anchor calculations use this method.

**Lesson:** Any coordinate transform used for persistent state (zoom anchors, saved positions, BroadcastChannel sync) must use the logical position, never the visual position. Visual position includes transient elastic displacement that will be zeroed.

### Wheel classifier pre-seeding in tests

**What happened (Phase S4):** Integration tests using `dispatchMouseWheelSequence()` helper were being classified as trackpad events, causing zoom gestures to be routed to pan.

**Root cause:** `WheelDeviceClassifier` has a 400ms silence reset. The test helper dispatches events with >400ms gaps between sequences. After silence reset, the first events of a new sequence were classified as "unknown" (defaulting to trackpad) instead of "mouse."

**Fix:** Pre-seed the classifier in the helper: set `_device = 'mouse'` and `_lastEventTime = Date.now()` before dispatching events. This simulates the classifier having already seen mouse events in the current session.

**Lesson:** Stateful classifiers need their state set up correctly in tests. Testing with a fresh classifier doesn't match real-world usage where the classifier has been running for the entire session.

### `mouseleave` cancels drag mid-gesture

**What happened:** Integration tests that dragged the mouse to the edge of the map container would suddenly cancel the pan gesture.

**Root cause:** `#map-container` has a `mouseleave` handler that calls `_cancelPan()`. When the mouse cursor exits the container element, the drag is cancelled even though the mouse button is still down.

**Fix:** Keep mouse within container bounds in tests. For tests that need to test drag release, test only the final state after release (which fires `mouseup` before `mouseleave`).

**Lesson:** DOM event boundaries are real. If your drag handler is on a container, mouse events that leave the container will not fire `mousemove` on that container. Either listen on `window` for move/up events after mousedown, or ensure tests keep the cursor within bounds.

### rAF doesn't fire in background tabs

**What happened:** Controller UI (in a popup window) would send BroadcastChannel commands to the VTT, but camera animations wouldn't start because the VTT tab was in the background and `requestAnimationFrame` wasn't firing.

**Fix:** Added `sendImmediate()` method that applies camera state synchronously without depending on the rAF loop. Any BroadcastChannel command that changes camera state calls `sendImmediate()` instead of relying on the render loop to pick it up.

**Lesson:** Never depend on rAF for processing external commands. rAF is for animation frames, not for event processing. External messages (BroadcastChannel, WebSocket, etc.) should be processed synchronously on arrival, with rAF used only for smooth visual interpolation.

### `SETTLE_THRESHOLD_PX` removed by cleanup

**What happened:** A CodeRabbit review cleanup in Phase S5 removed the `SETTLE_THRESHOLD_PX = 0.5` constant, causing snap-back animations to never settle (the threshold became `undefined`, which is falsy, causing the settlement check to always pass trivially).

**Fix:** Re-added the constant immediately after discovery.

**Lesson:** Constants that appear in inequality comparisons (`value < THRESHOLD`) must never be removed without checking all comparison sites. If `THRESHOLD` becomes `undefined`, then `value < undefined` is always `false`, which silently changes behavior without any error.

---

## Testing lessons (the hard way) {#testing-lessons}

### Don't use `waitForTimeout` — use `waitForFunction`

**Problem:** `await page.waitForTimeout(500)` assumes the animation completes within 500ms. rAF timing varies across runners, CI environments, and system load. Tests become flaky.

**Solution:** Poll for the expected state:
```javascript
await page.waitForFunction(() => {
  const cam = window.__vtt?.mapRenderer?.camera;
  return cam && Math.abs(cam.elasticOffsetX) < 0.5;
}, { timeout: 3000 });
```

### Vacuous pass danger

**Problem:** Tests that assert `before === after` can pass when the action under test does nothing.

**Example:** "Verify that blur stops pan" — test panned at cover zoom (which is clamped, so pan did nothing), then triggered blur, then asserted position unchanged. The test passed because pan never moved the camera in the first place.

**Solution:** Always verify the precondition enables the behavior being tested. If testing "blur stops pan," first zoom in so pan can actually occur, verify the camera moved, *then* trigger blur and verify it stopped.

### Camera not ready after `gotoVTT()`

**Problem:** `gotoVTT()` waits for the loading screen to hide, but `mapRenderer.camera` may not exist yet (it's created asynchronously after map mode is entered).

**Solution:** After `gotoVTT()`, wait for camera existence:
```javascript
await page.waitForFunction(() => window.__vtt?.mapRenderer?.camera != null);
```
Similarly, `enterMapMode()` must wait for `viewportW > 0 && viewportH > 0` (ResizeObserver fires asynchronously).

### Stale server across worktrees

**Problem:** Playwright config has `reuseExistingServer: true`. A server started from `main` continues serving old files when tests run from a worktree branch.

**Solution:** Always kill the server before running tests in a different worktree: `lsof -ti:8765 | xargs kill -9`

### Wheel event direction signs

**Problem:** Tests dispatching wheel events got the wrong direction because the sign chain is unintuitive.

**The chain:** `deltaX: 15` → `normalizeWheel` extracts `dx = 15` → `panBy(-dx, -dy)` → camera moves right (positive world X). So `deltaX: 15` pushes the viewport *right*, which means content scrolls *left*.

To push past the LEFT boundary: use `deltaX: -15` (negative delta → `panBy(+15, 0)` → camera moves left).

**Lesson:** Always trace the full sign chain from input event to camera mutation before writing test assertions.

### `--list` vs runtime test count discrepancy

**Problem:** `npx playwright test --list` and the runtime reporter show different test counts. The `--list` count is always higher (by ~6 on main, ~40 on feature branches).

**Cause:** Playwright's `--reporter=line` format doesn't count skipped tests the same way as `--list`. This is an artifact of the reporter, not missing tests.

**Solution:** Use `--list` deltas between branches to verify test inventory changes: `npx playwright test --list 2>&1 | grep "^Total:"` on both branches, compare.

### Never use `tail` on test output

**Problem:** `npx playwright test | tail -10` can truncate the `N failed` summary line because `--reporter=line` puts `failed` ABOVE `flaky` in the output, and `tail -10` may not reach far enough.

**Solution:** Use `grep -E '^\s+\d+ (passed|failed|flaky|skipped)'` to extract the summary line reliably.

---

## Patterns to reuse {#patterns-to-reuse}

### Pattern 1: Dual-position model

**When to use:** Any scrollable/pannable view with elastic overscroll.

**Structure:**
- `logical.x/y` — always hard-clamped to bounds, used for serialization and coordinate transforms that persist
- `elastic.offsetX/Y` — visual-only displacement beyond bounds, zeroed by snap-back
- `visual.x/y` = `logical.x + elastic.offsetX` — used only for rendering

**Why it works:** Separating "where the camera really is" from "where it looks like it is" means elastic overscroll never corrupts saved state, BroadcastChannel sync, or zoom anchor calculations.

### Pattern 2: Stateful Bayesian classifier with hysteresis

**When to use:** Any input disambiguation problem (mouse vs trackpad, swipe vs scroll, tap vs long-press).

**Structure:**
- Sliding window of N recent event summaries
- Multiple weak discriminative signals scored per event
- Asymmetric thresholds: require more evidence to switch classification than to stay
- Silence reset: after a gap, reset to "unknown" (user may have switched input devices)

**Key principle:** Default to the safer interpretation when uncertain. For mouse/trackpad: default to pan (trackpad). For tap/long-press: default to tap. A wrong safe classification is easily corrected by the user; a wrong unsafe classification is disorienting.

### Pattern 3: Speculative execution with cancellation

**When to use:** Any situation where waiting for certainty causes visible delay.

**Structure:**
1. Monitor the system state each frame (e.g., EWMA of change rate)
2. When the monitored value crosses a threshold, start the likely-needed action
3. If new input arrives that contradicts the action, cancel immediately
4. The cancel must preserve current state (don't reset to initial conditions)

**Key principle:** The cost of a wrong guess is one cancelled frame (imperceptible). The cost of waiting for certainty is a multi-second freeze (glaring).

### Pattern 4: Unified spring loop

**When to use:** Any system with multiple concurrent animations (position + zoom + elastic offset + ...).

**Structure:**
- One `requestAnimationFrame` loop
- Multiple `AxisSpring` instances, each with independent stiffness and damping
- All springs advance by the same `dt` each frame
- All results written to state once per frame
- Hard constraints applied after spring writes (springs are suggestive, constraints are authoritative)
- Loop auto-starts on first spring activation, auto-stops when all springs settle

**Why it works:** Eliminates timing desync between animations. The camera state is internally consistent on every frame.

### Pattern 5: Velocity clamping at known thresholds

**When to use:** Any spring animation that could receive unbounded initial velocity.

**Formula:**
```
v_critical = -omega * displacement
v_clamped = clamp(v, v_critical, +infinity)  // for positive displacement
```

**Why it works:** The critically damped spring equation `x(t) = (A + B*t) * e^(-omega*t)` overshoots when `B > 0` (which happens when `v < -omega * d`). Clamping `v` to be no more negative than `-omega * d` ensures `B ≤ 0`, which guarantees monotonic decay to target.

### Pattern 6: Frame-rate independent friction

**When to use:** Any velocity decay (inertial coast, momentum scrolling).

**Formula:**
```
friction_factor = base_friction ^ (dt_ms / reference_frame_ms)
velocity *= friction_factor
```

**Example:** `0.96 ^ (dt / 16.67)` — gives the same physical behavior at 30fps, 60fps, 120fps, and variable frame rates.

### Pattern 7: Input-proportional overflow drain

**When to use:** Elastic overscroll that needs to "drain" when the user reverses direction.

**Structure:**
- Track cumulative overflow in each axis
- When input direction reverses, drain proportional to reverse input (1:1 feel)
- When input is in the same direction as overflow, accumulate
- On full direction reversal, hard-reset to the new overflow value

**Why it works:** Creates a 1:1 mapping between gesture distance and elastic return distance, matching iOS behavior. Per-frame multiplicative decay (0.8/frame) doesn't have this property.

---

## Anti-patterns to avoid {#anti-patterns}

### Anti-pattern 1: Per-event classification

Never classify input devices from a single event. A single WheelEvent with `deltaY: 80, integer, no deltaX` could be mouse OR fast trackpad. Use a sliding window of events.

### Anti-pattern 2: Waiting for silence to detect gesture end

Never require N ms of no-events to know a gesture ended. macOS momentum events keep arriving for 1–2 seconds after finger lift. Use change-rate monitoring (EWMA) or explicit phase detection instead.

### Anti-pattern 3: Separate rAF loops for related animations

Never run independent rAF loops for animations that affect the same visual state. They will desync, causing 1-frame jumps. Use one loop that advances all animations per tick.

### Anti-pattern 4: Using visual position for persistent coordinates

Never use elastic-offset-contaminated coordinates for zoom anchors, saved positions, or cross-window sync. These coordinates include transient displacement that will be zeroed, causing jumps when the elastic offset resets.

### Anti-pattern 5: Magic-number per-frame decay

Never use `value *= 0.8` without frame-rate normalization. Use `value *= friction^(dt/baseDt)` or a proper spring solver. Uncompensated decay produces different physical behavior at different frame rates.

### Anti-pattern 6: Optimization guards on side-effect methods

Never add `if (nothing changed) return` to methods that emit events. Callers depend on the event. If you need to optimize, cache internal computations but always emit.

### Anti-pattern 7: Testing stateful systems with fresh state

Never test a stateful classifier/detector with default initial state if real usage starts with accumulated state. Pre-seed the state in your test setup, or your tests will exercise code paths that never happen in production.

### Anti-pattern 8: Asserting `before === after` without precondition verification

Never assert that "action X stopped behavior Y" without first verifying that behavior Y was actually occurring. The test passes vacuously if Y was never happening.

---

## Quick-reference troubleshooting {#troubleshooting}

### Elastic overscroll freezes (doesn't snap back)

**Check in this order:**
1. Is `_isSnappingBack` true? If so, a snap-back is running but may be fighting something. Check for competing animations.
2. Is `_momentumPanSuppressed` being set? If not, macOS momentum events may be feeding `_feedElasticOverflow()` and keeping the offset "alive."
3. Is the speculative snap-back's EWMA monitoring running? (`_speculativeSnapId` should be nonzero when overscrolled.)
4. Is `_gestureActive` true? If the gesture is still considered active, snap-back won't trigger.
5. Is the `TrackpadGestureDetector` stuck in ACTIVE state? Check if decay detection constants are too strict.

### Viewport jumps/teleports

**Check in this order:**
1. Are zoom anchors using `logicalScreenToWorld()` or `screenToWorld()`? The latter includes elastic offset and will cause jumps.
2. Is BroadcastChannel sending `visualX/Y` or `x/y`? Only logical position should be serialized.
3. Are two animation systems writing to the same camera properties? Check `_springLoop._running` and any legacy animators.
4. Did `_applyConstraints` get an optimization guard that skips event emission?

### Zoom triggers when scrolling (or vice versa)

**Check in this order:**
1. What does `_wheelClassifier._device` say? Is it correct for the current input device?
2. Is the 400ms silence reset firing unexpectedly? (e.g., slow scrolling with gaps > 400ms)
3. Check `_wheelClassifier._events` window — what signals are being scored?
4. Is the gesture state machine's cooldown blocking the correct gesture type? Check `_lastEndedGesture` and `_lastGestureEndTime`.

### Spring overshoots (viewport flings past target)

**Check in this order:**
1. Is `_clampSpringVelocity()` being called before starting the spring? Check the velocity passed to `_snapBackElastic()`.
2. Is the sign clamp active? (`_elasticSnapSignX/Y` should be set at snap-back start.)
3. Is `MAX_COAST_SPEED` being enforced? Check the velocity from `VelocityTracker` at drag release.

### Tests pass but feature doesn't work

**Check in this order:**
1. Is the test actually exercising the behavior? Look for vacuous pass (asserting `before === after` when the action is a no-op).
2. Is the test server serving stale files? (`lsof -ti:8765` — is it running from the right directory?)
3. Is `camera` null? Tests may need `waitForFunction(() => camera != null)` after page navigation.
4. Are stateful classifiers properly pre-seeded? Fresh classifier defaults may not match production behavior.
5. Is the mouse cursor within the container bounds? `mouseleave` will cancel drags.

---

## Constants reference

All tuned constants in one place, with their rationale.

| Constant | Value | File | Rationale |
|----------|-------|------|-----------|
| `CLASSIFIER_WINDOW_SIZE` | 6 | trackpad-gesture.js | Enough for accuracy, small enough for device-switch responsiveness |
| `CLASSIFIER_MOUSE_THRESHOLD` | 4 | trackpad-gesture.js | High bar to classify as mouse (default to trackpad/pan) |
| `CLASSIFIER_TRACKPAD_THRESHOLD` | 2 | trackpad-gesture.js | Low bar to classify as trackpad (easy to return to safe default) |
| `CLASSIFIER_SILENCE_MS` | 400 | trackpad-gesture.js | Gap before resetting classifier (user may have switched devices) |
| `DECAY_STREAK_THRESHOLD` | 2 | trackpad-gesture.js | Consecutive shrinking deltas before momentum detection |
| `MIN_EVENTS_FOR_MOMENTUM` | 4 | trackpad-gesture.js | Minimum events before allowing momentum transition |
| `TIMEOUT_ACTIVE_MS` | 80 | trackpad-gesture.js | Active→IDLE timeout (tightened from 150ms in S3) |
| `TIMEOUT_MOMENTUM_MS` | 60 | trackpad-gesture.js | Momentum→IDLE timeout (tightened from 100ms in S3) |
| `COOLDOWN_MS` | 50 | map-camera.js | Gesture state machine same-tier cooldown |
| `DWELL_TIME_MS` | 80 | map-camera.js | Minimum time before equal-priority gesture switch |
| `MAX_ELASTIC_SCREEN_PX` | 150 | map-camera.js | Elastic overscroll cap (~10% of 1440px viewport) |
| `SETTLE_THRESHOLD_PX` | 0.5 | map-camera.js | Spring settlement threshold (world pixels) |
| `MAX_COAST_SPEED` | 3000 | map-camera.js | Inertial coast speed cap (Leaflet reference) |
| `INERTIA_THRESHOLD` | 100 | map-camera.js | Minimum release velocity for inertial coast (px/s) |
| `ZOOM_PER_NOTCH` | 1.15 | map-camera.js | 15% zoom per mouse wheel notch |
| `DRAG_THRESHOLD` | 3 | map-camera.js | Pixels before click becomes drag |
| `SNAP_BACK stiffness` | 400 | camera-spring-loop.js | Elastic offset spring (omega ≈ 20, ~0.31s settle) |
| `CAMERA_SNAP stiffness` | 200 | camera-spring-loop.js | Camera position spring (omega ≈ 14.1, ~0.44s settle) |
| `SMOOTH_ZOOM stiffness` | 300 | camera-spring-loop.js | Zoom spring (omega ≈ 17.3, ~0.37s settle) |
| `COAST_FRICTION` | 0.96 | camera-spring-loop.js | Per-frame friction at 60fps reference |
| `COAST_STOP_THRESHOLD` | 10 | camera-spring-loop.js | Coast stop speed in open space (px/s) |
| `COAST_BOUNDARY_STOP` | 60 | camera-spring-loop.js | Coast stop speed at boundary (px/s) |

---

*Last updated: 2026-02-25. Covers Phases 6, S1–S5, and PR #3 (elastic snap-back delays).*
