# Camera Subsystem Source Code Review

**Date:** 2026-02-25
**Reviewer:** Claude Opus 4.6 (manual audit)
**Scope:** 4 source files forming the camera dependency graph

| File | Lines | Primary exports |
|------|-------|-----------------|
| `vtt/js/map-camera.js` | 1489 | Camera, VelocityTracker, (internal: GestureStateMachine, BoundsCache, KeyboardController) |
| `vtt/js/camera-spring-loop.js` | 317 | CameraSpringLoop, SPRING_STIFFNESS |
| `vtt/js/trackpad-gesture.js` | 221 | TrackpadGestureDetector, WheelDeviceClassifier |
| `vtt/js/axis-spring.js` | 124 | AxisSpring |

**Severity key:** CRITICAL = ship-blocking, HIGH = should fix before next feature work, MEDIUM = tech debt / maintainability, LOW = suggestion / nit.

---

## 1. Architecture Assessment

### 1.1 Camera class size (1100+ lines)

The Camera class spans approximately 1100 lines (lines 389-1489). Five helper classes live in the same file: VelocityTracker (38 lines), GestureStateMachine (96 lines), BoundsCache (40 lines), KeyboardController (130 lines), plus the module-level `rubberBand()` function. The total file is 1489 lines.

**Assessment:** This is at the upper limit of what is manageable in a single file, but not yet unworkable. The helper classes are small and single-purpose. Camera itself is large because it legitimately owns panning, zooming, elastic overscroll, inertial coast, coordinate transforms, constraint application, serialization, and input wiring. These are not easily separable without introducing more cross-object communication overhead than the coupling they would eliminate.

**Recommendation (MEDIUM):** If more features are added to Camera (e.g., multi-touch gesture recognition, animation presets), consider extracting an `ElasticOverscrollController` that encapsulates `_feedElasticOverflow`, `_snapBackElastic`, `_cancelSnapBack`, `_resetElasticState`, `_rubberBandAxis`, `_updateCumulativeOverflow`, and all `elastic*`/`_cumulative*`/`_isSnappingBack` state. This would remove ~150 lines and the most intricate state management from Camera. For now, the current structure is acceptable.

### 1.2 CameraSpringLoop coupling to Camera internals

`CameraSpringLoop._tick()` reads and writes 12+ private Camera properties:

| Property | Access type |
|----------|------------|
| `cam.x`, `cam.y`, `cam.zoom` | Read + Write |
| `cam.elasticOffsetX`, `cam.elasticOffsetY` | Read + Write |
| `cam._zoomAnchor` | Read + Write (nulled) |
| `cam._isSnappingBack` | Read + Write |
| `cam._elasticSnapSignX`, `cam._elasticSnapSignY` | Read + Write |
| `cam._cumulativeOverflowX`, `cam._cumulativeOverflowY` | Write |
| `cam._isCoasting` | Read |
| `cam._coastVx`, `cam._coastVy` | Read + Write |
| `cam._gestureActive` | Write |
| `cam._el` | Read |
| `cam._gestures` | Read (conditional call) |
| `cam._applyConstraints()` | Call |
| `cam._snapBackElastic()` | Call |
| `cam.panBy()` | Call |

**Assessment (HIGH):** This is a "friend class" pattern: CameraSpringLoop is effectively a private implementation detail of Camera, not an independent module. The coupling is bidirectional and deep -- the spring loop writes Camera flags that Camera also writes, creating implicit ordering dependencies. The fact that `_tick()` calls `cam._applyConstraints()` on line 177, then mutates `cam._isSnappingBack` on line 215, then checks `cam._isCoasting` on line 227, means the order of operations within `_tick()` is load-bearing and fragile.

**Recommendation:** Accept this as an intentional architectural decision (extracting the spring loop was done for rAF consolidation, not encapsulation). However:
1. Add a comment at the top of `camera-spring-loop.js` explicitly documenting the "friend class" contract: "This module is a private implementation detail of Camera. It reads and writes Camera private properties directly. Any change to Camera's elastic/coast/snap-back state must be coordinated with _tick()."
2. Consider making the Camera properties accessed by CameraSpringLoop use a consistent naming convention or JSDoc annotation to signal "shared with spring loop."

### 1.3 GestureStateMachine reaching into Camera internals

`GestureStateMachine._cancelCurrent()` (lines 168-188) directly calls Camera methods and mutates Camera sub-objects:

```javascript
case 'INERTIA':
  this._camera._cancelInertialCoast();
  break;
case 'SNAP_BACK':
  this._camera._cancelSnapBack();
  break;
case 'ZOOM_ANIMATE': {
  const loop = this._camera._springLoop;
  if (loop) {
    loop.logZoom.setTarget(loop.logZoom.position);
    loop.logZoom.velocity = 0;
  }
  this._camera._zoomAnchor = null;
  break;
}
case 'SCROLL_PAN':
  this._camera._trackpadDetector.cancel();
  break;
```

**Assessment (MEDIUM):** The ZOOM_ANIMATE case is the worst offender -- it reaches through Camera to SpringLoop to AxisSpring (three levels deep). The others call Camera methods, which is acceptable for a class that lives in the same file.

**Recommendation:** Extract a `_cancelZoomAnimation()` method on Camera and call that from the GSM, mirroring the pattern used for INERTIA and SNAP_BACK:

```javascript
case 'ZOOM_ANIMATE':
  this._camera._cancelZoomAnimation();
  break;
```

This would contain the spring-loop knowledge inside Camera rather than distributing it across Camera and GSM.

### 1.4 Dynamic property initialization in `attachTo()`

`_wheelClassifier`, `_trackpadDetector`, `_gestures`, and `_springLoop` are assigned in `attachTo()` (lines 1339-1347), not in the constructor. This means:

- Every method that uses these objects must guard with `if (this._gestures)`, `if (this._springLoop)`, etc.
- There is a window between construction and `attachTo()` where calling `panBy()`, `_snapBackElastic()`, etc. could silently fail or NaN.

**Current guards found:**
- `if (this._gestures)` -- lines 218, 294, 1105, 1118, 1241, 1250, 1254, 1259, 1405, 1433, 1448
- `if (this._springLoop)` -- lines 291, 299, 823, 866
- `if (this._trackpadDetector)` -- line 1404

**Assessment (MEDIUM):** The pattern works but is noisy. The guards are not consistent -- some methods guard, others don't:
- `_snapBackElastic()` (line 792) accesses `this._springLoop` without a null guard via `const loop = this._springLoop`. If called before `attachTo()`, this will throw on `loop.elasticX`.
- `_smoothZoomTo()` (line 958) also accesses `this._springLoop` without a guard.
- `_handleWheelZoom()` (line 887) accesses `this._wheelClassifier` without a guard, but this method is only reachable from the wheel listener which is attached inside `attachTo()`, so it is safe in practice.

**Recommendation:** Either:
1. **(Preferred)** Move all four into the constructor with no-op or deferred implementations, eliminating the need for null guards entirely. For example, `_springLoop` could be created in the constructor and `syncFromCamera()` called in `attachTo()`.
2. Or add explicit guards to `_snapBackElastic()` and `_smoothZoomTo()`.

---

## 2. Reliability Analysis

### 2.1 Double-fire guard in `_snapBackElastic()` -- CORRECT with one edge case

```javascript
_snapBackElastic(velocity = { vx: 0, vy: 0 }) {
  this._cumulativeOverflowX = 0;
  this._cumulativeOverflowY = 0;

  if (this._isSnappingBack) {
    return;  // Double-fire guard
  }

  if (Math.abs(this.elasticOffsetX) < SETTLE_THRESHOLD_PX
      && Math.abs(this.elasticOffsetY) < SETTLE_THRESHOLD_PX) {
    this.elasticOffsetX = 0;
    this.elasticOffsetY = 0;
    this._isSnappingBack = false;
    EventBus.emit('camera:changed');
    return;
  }
  // ... spring setup, this._isSnappingBack = true
}
```

**Sequence analysis:**

1. **Coast ends, calls `_snapBackElastic({vx, vy})`** -- sets `_isSnappingBack = true`, starts spring.
2. **Spring loop tick settles** -- sets `_isSnappingBack = false`, releases SNAP_BACK gesture.
3. **Another call to `_snapBackElastic()`** from, say, visibility change handler -- `_isSnappingBack` is false, so guard does not fire. This is correct; a new snap-back should start.

4. **Rapid double-call: coast ends AND visibility change fires within the same frame** -- first call sets `_isSnappingBack = true`. Second call hits the guard and returns. The cumulative overflow is zeroed in both calls (harmless, already zero). This is correct.

5. **Edge case: `_snapBackElastic()` called while snap-back is running but elastic offset has been partially reduced.** The guard returns early, preserving the ongoing animation. This is intentionally correct -- restarting would cause a visual discontinuity.

**Assessment (LOW -- confirmed safe):** The double-fire guard is correct for all reachable sequences. The one subtlety is that cumulative overflow is zeroed BEFORE the guard check (lines 774-775), which means even a rejected double-fire still clears overflow. This is harmless because overflow should be zero during snap-back anyway (the `_feedElasticOverflow` rejection at line 736 ensures no new overflow accumulates).

### 2.2 `_momentumPanSuppressed` flag -- CAN get stuck true (MEDIUM)

The flag is set to `true` in two places (lines 917, 930) and cleared in two places:
- `onGestureEnd` callback (line 1117)
- `_startPan` (line 1403)

**Stuck-true scenario:**

1. User scrolls on trackpad, momentum is detected, elastic boundary is reached.
2. `_momentumPanSuppressed` set to `true` (line 917).
3. `_snapBackElastic()` is called.
4. User immediately starts a mouse drag (`_startPan` clears the flag at line 1403) -- this path is safe.
5. BUT: if the user scrolls again on trackpad before `onGestureEnd` fires (within the 60ms TIMEOUT_MOMENTUM_MS), the new wheel events hit the early return at line 906 (`if (this._momentumPanSuppressed) return`). The `handleWheel` call at line 901 still feeds the detector, which may or may not transition through IDLE and fire `onGestureEnd`.

**Critical path:** If `_momentumPanSuppressed` is true and the detector is in IDLE state (gesture already ended), a new scroll event calls `handleWheel` which transitions to ACTIVE and fires `onGestureStart`. But `onGestureStart` (line 1099) checks `if (this._momentumPanSuppressed) return` -- it returns early without clearing the flag and without resetting `_gestureActive`.

**Result:** The next scroll gesture is completely dead. All wheel pan events return early at line 906. The flag only gets cleared when:
- `onGestureEnd` fires (which it will, after the timeout), OR
- The user starts a mouse drag.

**Practical impact:** The user experiences a ~60-140ms window where trackpad pan is unresponsive after momentum suppression. The `onGestureEnd` timeout (60ms from last event) will fire and clear the flag. So the flag cannot get permanently stuck, but there is a brief dead zone.

**Assessment (MEDIUM):** Not a permanent stuck state, but a transient unresponsiveness window. The `onGestureStart` callback should clear `_momentumPanSuppressed` when it decides to proceed with a new gesture:

```javascript
onGestureStart: () => {
  if (this._isSnappingBack || this._isCoasting || this._momentumPanSuppressed) return;
  // ...
}
```

Should be:

```javascript
onGestureStart: () => {
  if (this._isSnappingBack || this._isCoasting) return;
  this._momentumPanSuppressed = false;  // New gesture clears momentum suppression
  // ...
}
```

### 2.3 `_feedElasticOverflow` rejection during snap-back

```javascript
_feedElasticOverflow(overflowX, overflowY) {
  if (!this._gestureActive) return;
  if (this._isSnappingBack) return;    // Reject during snap-back
  // ...
}
```

**Question:** Are late momentum events truly harmless when rejected?

**Analysis:** During snap-back, the spring loop is driving `elasticOffsetX/Y` toward zero. If a late momentum event called `panBy()`, that would:
1. Call `_applyConstraints()` (fine, already called by spring loop)
2. Compute overflow (fine)
3. Call `_feedElasticOverflow()` which returns early due to the snap-back guard (correct)

But `panBy()` also updates `this.x` and `this.y` -- the logical camera position moves. This is NOT rejected by the snap-back guard. So late momentum events during snap-back DO move the camera position, they just don't create new elastic offset.

**Is this a problem?** In practice, no. The `_momentumPanSuppressed` flag (line 906) short-circuits the entire `_handleWheelPan` method before `panBy` is reached. And `onGestureStart` returns early during snap-back (line 1102). So the combination of `_momentumPanSuppressed` + `_isSnappingBack` check in `onGestureStart` + `_feedElasticOverflow` rejection forms a three-layer defense. Late momentum events are harmless.

**Assessment (LOW -- confirmed safe):** The rejection is correct and the layered defense is sound.

### 2.4 Visibility change handler: clearing `_isSnappingBack` before `_snapBackElastic()`

```javascript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    this._cancelPan();
  } else if (Math.abs(this.elasticOffsetX) > SETTLE_THRESHOLD_PX ||
             Math.abs(this.elasticOffsetY) > SETTLE_THRESHOLD_PX) {
    this._isSnappingBack = false; // Clear so _snapBackElastic can start
    this._snapBackElastic();
  }
});
```

**Question:** Is clearing `_isSnappingBack` before calling `_snapBackElastic()` safe?

**Analysis:** When the tab returns from background, rAF was not firing, so the spring loop was effectively frozen. The elastic offset may be stranded at a non-zero value because the spring never finished. By clearing `_isSnappingBack`, we allow `_snapBackElastic()` to re-initialize the spring with fresh targets and start the loop again.

**Race condition check:** Could the spring loop tick fire between `_isSnappingBack = false` and `_snapBackElastic()`? No -- JavaScript is single-threaded. The rAF callback won't execute until the current synchronous block completes. And the spring loop may not even be running (it auto-stops when all springs settle or the tab is hidden).

**Edge case:** What if `_isSnappingBack` was already false (spring completed while tab was still visible, then tab was hidden and unhidden)? The elastic offset check (`> SETTLE_THRESHOLD_PX`) would be false if the spring completed, so this branch wouldn't execute. Safe.

**What if `_isSnappingBack` is true but the spring loop is stopped (auto-stop after tab backgrounding)?** Clearing the flag and calling `_snapBackElastic()` will re-initialize and restart the spring loop. This is the intended recovery path.

**Assessment (LOW -- confirmed safe):** The pattern is correct. The comment accurately explains the intent.

### 2.5 Race conditions between rAF loop and user input

The spring loop's `_tick()` runs on rAF. User input events (mousedown, mousemove, wheel) run on the main thread between rAF callbacks. There is no true concurrency, but ordering matters.

**Potential issue: Coast panBy + user input panBy in the same frame.**

1. Spring loop tick calls `cam.panBy(coastVx * dt, coastVy * dt)` (line 271).
2. Between this tick and the next, a user mousedown fires and calls `_cancelInertialCoast()`.
3. The `_isCoasting` flag is now false, but the spring loop already called `panBy()` this frame.

**Is this safe?** Yes. The mousedown calls `_cancelInertialCoast()` which sets `_isCoasting = false`, zeroes velocities, and removes the CSS class. The spring loop's next tick will see `_isCoasting === false` and skip `_tickCoast()`. The one extra `panBy()` from the current frame is a single frame of coast motion -- imperceptible.

**Potential issue: Spring loop writes `cam.x = this.panX.position` (line 156) after `_applyConstraints()` has already clamped it.**

Actually, looking at the tick order:

```
1. Advance springs (137-141)
2. Write elastic offset and zoom from springs (145-147)
3. Write x/y from springs OR zoom anchor (152-163)
4. Sign guard (167-174)
5. _applyConstraints() (177) -- may clamp x/y/zoom
6. _tickCoast() (182) -- may call panBy which also calls _applyConstraints
7. Sync clamped values BACK into springs (187-189) -- this is the key line
```

Step 7 writes the clamped `cam.x` back into `this.panX.position`, preventing the spring from fighting the constraint system. This is correct and essential.

**Assessment (LOW):** No problematic race conditions found. The single-threaded execution model and the sync-back step in the tick loop prevent state divergence.

---

## 3. Code Quality Findings

### 3.1 Dead code: `_coastSaturatedFrames` not reset on all coast exit paths (LOW)

`_coastSaturatedFrames` is reset to 0 in the coast-end block of `_tickCoast()` (line 292) and initialized in the constructor (line 49). But `_cancelInertialCoast()` (lines 874-882) does NOT reset it.

```javascript
_cancelInertialCoast() {
  if (this._isCoasting) {
    this._isCoasting = false;
    this._coastVx = 0;
    this._coastVy = 0;
    this._gestureActive = false;
    if (this._el) this._el.classList.remove('coasting');
    // Missing: this._springLoop._coastSaturatedFrames = 0; ??? (but it's on SpringLoop, not Camera)
  }
}
```

**Impact:** If coast is cancelled externally (e.g., user starts a new drag), `_coastSaturatedFrames` retains its previous value. On the next coast, the counter starts from that stale value. If it was at 1, the new coast could terminate after just 1 saturated frame instead of the intended 2.

**Practical impact:** Extremely low. The counter is on CameraSpringLoop, and coast is only cancelled between coasts, so the next `_tickCoast` call will either increment past 2 (if truly saturated) or reset to 0 (if elastic changes). But for correctness, `_cancelInertialCoast()` should reset it.

### 3.2 `_commitPan()` calls `_cancelSnapBack()` after `_resetElasticState()` (LOW)

```javascript
_commitPan() {
  this._panning = true;
  this._pendingPan = false;
  this._panButton = 0;
  if (this._gestures) this._gestures.request('DRAG_PAN');
  this._resetElasticState();        // Sets elasticOffsetX/Y = 0
  this._cancelSnapBack();           // Freezes elastic springs at current position
  if (this._springLoop) this._springLoop.syncElasticFromCamera();
  this._setPanCursor(true);
}
```

`_resetElasticState()` zeroes elastic offset. Then `_cancelSnapBack()` freezes elastic springs at their current position -- but the Camera elastic offset was just zeroed. The spring loop's elastic springs still have their old position until `syncElasticFromCamera()` is called next. The order is: reset Camera elastic to 0, cancel snap (freeze spring at old position), sync spring from Camera (now 0). The net effect is correct, but the intermediate state is confusing.

**Compare with `_startPan()`:**
```javascript
_startPan(e, button) {
  this._cancelInertialCoast();
  this._cancelSnapBack();          // Cancel FIRST
  this._momentumPanSuppressed = false;
  // ...
  this._resetElasticState();       // Reset elastic AFTER cancel
  this._velocityTracker.reset();
  this._setPanCursor(true);
}
```

In `_startPan`, the order is cancel-then-reset. In `_commitPan`, it is reset-then-cancel. Both work because `syncElasticFromCamera()` at the end of `_commitPan` reconciles everything, but the inconsistency could confuse future maintainers.

**Recommendation:** Swap the order in `_commitPan` to match `_startPan` (cancel first, reset second).

### 3.3 DRY violation: elastic spring sync pattern (MEDIUM)

The pattern of syncing elastic springs to Camera state appears in multiple places:

1. `CameraSpringLoop.syncFromCamera()` -- lines 70-91
2. `CameraSpringLoop.syncElasticFromCamera()` -- lines 108-116
3. `CameraSpringLoop._tick()` coast branch -- lines 194-201
4. `_snapBackElastic()` -- lines 793-794 (position only)

The coast branch in `_tick()` duplicates `syncElasticFromCamera()` logic but sets `target = current` (to keep springs passive), while `syncElasticFromCamera()` also sets `target = current`. They are effectively the same. The coast branch could call `this.syncElasticFromCamera()`.

### 3.4 Confusing naming: `_gestureActive` vs `GestureStateMachine._activeGesture` (LOW)

`Camera._gestureActive` is a boolean flag meaning "some gesture is feeding elastic overflow." `GestureStateMachine._activeGesture` is a string enum identifying which gesture type is active. These are conceptually related but independently managed, which is confusing.

`_gestureActive` is managed by Camera directly (set in `_resetElasticState`, `_startInertialCoast`, `onGestureStart`; cleared in `_cancelInertialCoast`, `_handleWheelPan`, `onGestureEnd`, `_cancelPan`, mouseup handler, `_tickCoast`). The GSM does not read or write it.

**Recommendation:** Rename `Camera._gestureActive` to `_elasticFeedEnabled` or `_elasticInputActive` to make the distinction clear.

### 3.5 KeyboardController zoom: spring sync after zoomToCenter (LOW)

```javascript
if (e.key === '+' || e.key === '=') {
  e.preventDefault();
  this._camera.zoomToCenter(ZOOM_STEP_KEY);
  if (this._camera._springLoop) {
    this._camera._springLoop.syncZoomFromCamera();
  }
  return;
}
```

This pattern (zoom then sync spring) appears twice in KeyboardController (lines 290-293 and 297-301). The spring sync is necessary because `zoomToCenter` -> `zoomAt` applies zoom directly without going through the spring loop. If the spring loop happens to be running (e.g., from a concurrent mouse wheel zoom), not syncing would cause the spring to overwrite the keyboard zoom.

**Assessment:** Correct but could be encapsulated. Camera could expose a `zoomToCenterImmediate()` that handles the spring sync internally.

### 3.6 `_handleWheelPan` accesses private detector state (LOW)

```javascript
if (!this._momentumScrollActive &&
    this._trackpadDetector._eventCount > 6 &&
    Math.abs(dx) + Math.abs(dy) < 3.0 &&
    // ...
```

Line 927 reaches into `_trackpadDetector._eventCount`, which is a private property. The detector should expose this via a getter if external code needs it.

### 3.7 Long methods assessment

**`_attachMouseHandlers()`** -- 111 lines (1160-1270). Contains three anonymous event listeners (mousedown, mousemove, mouseup) plus contextmenu. The mousemove handler is 45 lines. This is at the boundary of "should extract" -- the handlers are cohesive and only used once. Extracting would create named methods that are only called from one place.

**Assessment (LOW):** Acceptable. The method is long because mouse handling is inherently complex (pending pan, drag threshold, velocity tracking, elastic overflow, inertial coast). Extracting would spread the logic without reducing complexity.

**`_attachWheelHandler()`** -- 63 lines (1096-1158). Contains detector creation with callbacks plus the wheel event listener. The wheel listener itself is 30 lines with clear branching (cooperative mode, zoom, pan with behavior preference).

**Assessment (LOW):** Acceptable length and complexity.

---

## 4. Specific Pattern Validation

### 4.1 VelocityTracker ring buffer correctness

```javascript
getVelocity() {
  const n = Math.min(this._count, VELOCITY_SAMPLE_COUNT);
  if (n < 2) return { vx: 0, vy: 0 };
  const oldestIdx = this._count < VELOCITY_SAMPLE_COUNT ? 0 : this._index;
  const newestIdx = (this._index - 1 + VELOCITY_SAMPLE_COUNT) % VELOCITY_SAMPLE_COUNT;
  // ...
}
```

**Edge case:** When `_count === VELOCITY_SAMPLE_COUNT` (buffer just filled), `oldestIdx = this._index`, which is the slot that was just overwritten. The newest is `_index - 1`. So oldest and newest are adjacent in the ring, which is correct -- oldest is the one about to be overwritten next, newest is the most recent.

**Edge case:** When `_count === 1`, `n === 1`, returns `{vx:0, vy:0}`. Correct -- need at least 2 samples for velocity.

**Edge case:** `dt < 0.008` (8ms) returns zero velocity. This prevents division by near-zero when samples arrive in rapid succession.

**Assessment:** Correct implementation.

### 4.2 AxisSpring closed-form solution

```javascript
const omega = this._omega;
const A = displacement;
const B = velocity + omega * displacement;
const exp = Math.exp(-omega * dt);

this.position = this.target + (A + B * dt) * exp;
this.velocity = (B - omega * (A + B * dt)) * exp;
```

This is the standard critically damped spring (zeta = 1) closed-form solution. Verified:
- x(t) = target + (A + Bt) * e^(-omega*t) where A = x0 - target, B = v0 + omega * A
- v(t) = dx/dt = (B - omega*(A + Bt)) * e^(-omega*t)

**Assessment:** Mathematically correct. Frame-rate independent by construction.

### 4.3 WheelDeviceClassifier scoring

**Signal 5 (small deltas):**
```javascript
if (maxDelta > 0 && maxDelta < 4 && evt.deltaMode === 0) trackpadSignals++;
```

The `deltaMode === 0` guard is correct -- line-mode deltas of 3 would falsely trigger without it.

**Signal 6 (large integer vertical-only):**
```javascript
if (maxDelta >= 50 && maxDelta % 1 === 0 && evt.absX === 0 && evt.gap > 40) {
  mouseSignals++;
}
```

The `gap > 40` guard prevents fast trackpad momentum events (which can have large deltas) from being classified as mouse. Correct.

**Hysteresis:**
- Unknown -> mouse: requires `mouseSignals >= 2`
- Unknown -> trackpad: always (default)
- Trackpad -> mouse: requires `mouseSignals >= 4` (CLASSIFIER_MOUSE_THRESHOLD)
- Mouse -> trackpad: requires `trackpadSignals >= 2` (CLASSIFIER_TRACKPAD_THRESHOLD)

The asymmetry (4 to enter mouse, 2 to leave) biases toward "trackpad" (which routes to pan). This is the safe default -- incorrectly zooming when the user wants to pan is more disruptive than the reverse.

**Assessment:** Correct and well-tuned.

### 4.4 GestureStateMachine rule ordering

The five rules are evaluated in order, with early returns:

1. Same gesture retarget -- always accept
2. User preempts animation -- always accept
3. User replaces user -- priority decides
4. From IDLE -- cooldown check
5. Animation replaces animation -- priority decides (fallthrough also catches animation-during-user, which is denied if lower priority)

**Edge case: Animation requests while a user gesture is active.**

If `gesture = 'SNAP_BACK'` (animation) and `_activeGesture = 'DRAG_PAN'` (user):
- Rule 1: not same, skip
- Rule 2: SNAP_BACK is not a user gesture, skip
- Rule 3: SNAP_BACK is not a user gesture, skip
- Rule 4: _activeGesture is not IDLE, skip
- Rule 5: `newPri(1) >= curPri(6)` is false, return false

This is correct -- an animation cannot preempt a user gesture.

**Edge case: SNAP_BACK requests when already SNAP_BACK.**
- Rule 1: same gesture, return true.

This is the "retarget" case. The spring loop's settlement handler calls `cam._gestures.release('SNAP_BACK')`, and immediately after, `_cancelPan` or `_handleWheelPan` calls `request('SNAP_BACK')`. The release-then-request sequence goes through Rule 4 (from IDLE), not Rule 1. Rule 4's cooldown check: `now - lastGestureEndTime < 50ms` is true, `gesture !== lastEndedGesture` is false (both SNAP_BACK), so cooldown does not block. Correct.

**Assessment:** The rule ordering is correct and handles all tested edge cases properly.

### 4.5 Coast-to-snapback transition

In `_tickCoast()`:
```javascript
if (cam._gestures) {
  cam._gestures.release('INERTIA');
  cam._gestures.request('SNAP_BACK');
}
cam._snapBackElastic({ vx: residualVx, vy: residualVy });
```

The `release('INERTIA')` sets GSM to IDLE. Then `request('SNAP_BACK')` goes through Rule 4 (from IDLE). Cooldown check: `now - lastEndTime < 50ms` AND `SNAP_BACK !== INERTIA` AND `lastWasAnimation && newIsAnimation` (same tier) -> blocked.

**Wait -- is this a bug?** Let me re-check. INERTIA ends, SNAP_BACK is requested within the same synchronous block (effectively 0ms gap).

- `now - lastGestureEndTime < COOLDOWN_MS` -- YES (0ms < 50ms)
- `gesture !== lastEndedGesture` -- YES (SNAP_BACK !== INERTIA)
- `lastEndedGesture !== 'IDLE'` -- YES
- `lastWasUser === newIsUser` -- both are animation gestures, so `false === false` -> `true` -> BLOCKED

**This means the SNAP_BACK request is denied after INERTIA ends!**

However, `_snapBackElastic()` is called unconditionally on the next line regardless of whether the GSM granted the request. The snap-back animation will run. But the GSM thinks no gesture is active (IDLE), so any subsequent user gesture will not need to preempt SNAP_BACK -- it just starts directly from IDLE.

**Impact:** The snap-back runs without GSM tracking. If a user gesture starts during snap-back:
- Without GSM tracking, there is no `_cancelCurrent(SNAP_BACK)` call.
- The user gesture calls `_startPan` which calls `_cancelSnapBack()` directly, so the snap-back IS properly cancelled.

**Assessment (MEDIUM):** The cooldown blocks the SNAP_BACK request after INERTIA, causing the snap-back to run untracked by the GSM. This works in practice because `_startPan` and `onGestureStart` independently cancel snap-backs. But it means the GSM's model of reality is inaccurate during post-coast snap-back. The 50ms cooldown is too aggressive for this animation-to-animation transition.

**Recommendation:** Either:
1. Skip cooldown for animation-to-animation transitions (since the purpose of cooldown is to absorb stray user events after gesture end).
2. Or request SNAP_BACK before releasing INERTIA (using Rule 5: animation replaces animation, SNAP_BACK(1) < INERTIA(2) so it would be denied -- that's worse).
3. Or use a dedicated `_gestures.transition('INERTIA', 'SNAP_BACK')` method that bypasses cooldown.

### 4.6 `panBy()` during coast -- elastic spring passive mode

In `_tick()`, after coast:
```javascript
if (cam._isCoasting) {
  this.elasticX.position = cam.elasticOffsetX;
  this.elasticX.target = cam.elasticOffsetX;
  this.elasticX.velocity = 0;
  this.elasticY.position = cam.elasticOffsetY;
  this.elasticY.target = cam.elasticOffsetY;
  this.elasticY.velocity = 0;
}
```

This keeps elastic springs fully passive during coast: position = target = current offset, velocity = 0. The springs are "settled" by this sync, so they don't contribute to the loop's active/settled calculation. Coast uses `panBy()` -> `_feedElasticOverflow()` to manage elastic offset directly.

**Assessment:** Correct. The springs are effectively parked during coast.

---

## 5. BoundsCache Analysis

```javascript
class BoundsCache {
  observe(el) {
    this.disconnect();
    this._el = el;
    this._valid = false;
    this._resizeObserver = new ResizeObserver(this._invalidate);
    this._resizeObserver.observe(el);
    window.addEventListener('resize', this._invalidate);
    window.addEventListener('scroll', this._invalidate);
  }
}
```

**Missing invalidation triggers (LOW):**
- `scroll` is only listened on `window`. If the map container is inside a scrollable parent (not just `window`), the cache goes stale.
- CSS transforms on parent elements would invalidate `getBoundingClientRect()` but are not detected.

**Assessment:** For this VTT (fixed 1920x1080 layout, no scrollable parents), this is fine. The cache correctly covers the real use case.

**Missing `disconnect()` call:** `BoundsCache` has a `disconnect()` method, but Camera never calls it. If `attachTo()` is called on a different element, `observe()` internally calls `disconnect()` first. But if Camera is destroyed, the ResizeObserver and window listeners leak.

**Assessment (LOW):** Camera is a singleton in this application, created once and never destroyed. No practical leak.

---

## 6. TrackpadGestureDetector Analysis

### 6.1 Timeout-based gesture end

```javascript
const timeout = this.state === 'MOMENTUM' ? TIMEOUT_MOMENTUM_MS : TIMEOUT_ACTIVE_MS;
this._endTimer = setTimeout(() => {
  this.state = 'IDLE';
  // ...
  this._callbacks.onGestureEnd?.();
}, timeout);
```

With `TIMEOUT_ACTIVE_MS = 80` and `TIMEOUT_MOMENTUM_MS = 60`, the gesture ends 60-80ms after the last wheel event. macOS trackpad events typically arrive at 8-16ms intervals during active scrolling. This is correctly calibrated for fast detection.

### 6.2 Decay detection for momentum

```javascript
if (absDelta > 0 && this._lastAbsDelta > 0 && absDelta < this._lastAbsDelta * DECAY_RATIO) {
  this._decayStreak++;
} else {
  this._decayStreak = 0;
}
if (this._decayStreak >= DECAY_STREAK_THRESHOLD && this._eventCount > MIN_EVENTS_FOR_MOMENTUM) {
  this.state = 'MOMENTUM';
}
```

With `DECAY_RATIO = 0.97` and `DECAY_STREAK_THRESHOLD = 2`, two consecutive events where delta decreases by even 3% triggers momentum detection. `MIN_EVENTS_FOR_MOMENTUM = 4` prevents false positives from the first few events of a gesture.

**Assessment:** Tuned for fast detection at the cost of occasional false positives (a slow deliberate scroll that naturally decreases). The false positive impact is limited -- it sets `_momentumScrollActive = true` which reduces rubber-band coefficient from 0.55 to 0.3. A minor visual difference.

---

## 7. Summary of Findings

### By severity

**CRITICAL:** None.

**HIGH (1):**
- 1.2: CameraSpringLoop reads/writes 12+ Camera private properties. Not a bug, but the deepest coupling in the system. Needs documentation and freeze on further expansion.

**MEDIUM (5):**
- 1.1: Camera class at ~1100 lines. Consider ElasticOverscrollController extraction if scope grows.
- 1.4: Dynamic property initialization in `attachTo()` -- `_snapBackElastic()` and `_smoothZoomTo()` access `_springLoop` without null guards. Would throw if called before `attachTo()`.
- 2.2: `_momentumPanSuppressed` can create a transient ~60-140ms dead zone for trackpad input after momentum suppression. `onGestureStart` should clear the flag rather than returning early.
- 3.3: Elastic spring sync pattern duplicated in 4 places in CameraSpringLoop.
- 4.5: Coast-to-snapback transition blocked by same-tier cooldown in GSM. Snap-back runs untracked. Works in practice due to independent cancellation in `_startPan`/`onGestureStart`, but GSM state model is inaccurate.

**LOW (8):**
- 1.3: GSM ZOOM_ANIMATE cancel reaches three levels deep (GSM -> Camera -> SpringLoop -> AxisSpring). Extract `_cancelZoomAnimation()` on Camera.
- 2.1: Double-fire guard confirmed correct.
- 2.3: `_feedElasticOverflow` rejection during snap-back confirmed safe.
- 2.4: Visibility change handler confirmed safe.
- 3.1: `_coastSaturatedFrames` not reset in `_cancelInertialCoast()`.
- 3.2: `_commitPan` cancel/reset order inconsistent with `_startPan`.
- 3.4: `_gestureActive` naming confusion with `GestureStateMachine._activeGesture`.
- 3.6: `_handleWheelPan` accesses `_trackpadDetector._eventCount` private property.

### What is working well

1. **AxisSpring**: Mathematically correct closed-form critically damped solution. Frame-rate independent. Clean API. The best-factored module in the subsystem.

2. **WheelDeviceClassifier**: Thoughtful signal design with three corrections applied. Asymmetric hysteresis is the right approach. Silence reset prevents stale classifications.

3. **Elastic overscroll**: The rubber-band formula with screen-space conversion, MAX_ELASTIC_SCREEN_PX cap, and input-proportional drain is a robust implementation that correctly handles mouse drag, trackpad scroll, and inertial coast.

4. **GestureStateMachine**: The five-rule hierarchy with tier separation and cooldown is a sound architecture for preventing oscillation. The one issue (4.5) is a tuning problem, not a design problem.

5. **VelocityTracker**: Clean ring buffer implementation with proper edge cases (< 2 samples, tiny dt).

6. **Spring loop auto-start/auto-stop**: Eliminates wasted rAF frames when no animation is active. The settlement detection across 5 spring axes plus coast status is correct.

7. **Comment quality**: Critical invariants are documented (e.g., "Sync clamped values back into springs to prevent the spring from fighting the constraint system", "Coast uses friction-based velocity (not springs)", "Input delta in world-space (matches overflow sign convention)"). The code is well-commented for the complexity level.

---

## 8. Recommended Action Items

### Immediate (before next feature)

1. Add null guard to `_snapBackElastic()` and `_smoothZoomTo()` for `_springLoop` access, or move `_springLoop` creation to the constructor.
2. Fix `_momentumPanSuppressed` handling in `onGestureStart` -- clear the flag instead of returning early.

### Soon (next refactoring pass)

3. Add "friend class" documentation header to `camera-spring-loop.js`.
4. Extract `_cancelZoomAnimation()` on Camera to eliminate three-level reach-through in GSM.
5. Review cooldown behavior for animation-to-animation transitions in GSM (coast -> snap-back blocked by same-tier cooldown).
6. Reset `_coastSaturatedFrames` in `_cancelInertialCoast()`.
7. Make `_commitPan()` cancel/reset order consistent with `_startPan()`.
8. Expose `_eventCount` via a getter on TrackpadGestureDetector.

### Deferred (when scope grows)

9. Extract `ElasticOverscrollController` if Camera exceeds ~1300 lines.
10. Rename `_gestureActive` to `_elasticFeedEnabled` for clarity.
11. Consolidate elastic spring sync into a single reusable pattern.
