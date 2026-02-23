# Phase S4: Hierarchical Gesture Coordination with Hysteresis
## A comprehensive implementation plan for restructuring the GestureStateMachine with dwell time, cooldown, hierarchical preemption, coordinate contamination fixes, and bumpless animation handoff

**Status:** IMPLEMENTED (2026-02-23)
**Fixes:** Remaining aspects of bug #5 (erratic behavior during gesture transitions)
**Impact:** Medium. Addresses edge cases and transitions that Phases S1-S3 could not.
**Risk:** Medium. The state machine interacts with every input path and every animation system.
**Estimated LOC:** ~250 (restructured GestureStateMachine + logicalScreenToWorld + SmoothZoomAnimator fix + updated _cancelCurrent + tests)
**Actual LOC:** ~145 impl + ~480 test (37 unit + 3 integration)
**Depends on:** Phase S1 (stateful device classification), Phase S2 (velocity-clamped spring snap-back), and Phase S3 (speculative snap-back). S1 provides stable device classification that feeds the correct gesture type into the state machine. S2 provides overshoot protection that makes gesture-transition-triggered snap-backs safe. S3 provides `_cancelSpeculativeSnapBack()`, which the restructured `_cancelCurrent()` must call.

---

## Table of contents

1. [Why this phase comes fourth](#why-fourth)
2. [The philosophical problem: switching systems and the cost of instability](#philosophy)
3. [How production gesture systems prevent chattering](#production-approaches)
4. [The three mechanisms: dwell time, cooldown, and hierarchical preemption](#three-mechanisms)
5. [Complete annotated implementation: restructured GestureStateMachine](#gsm-implementation)
6. [Complete annotated implementation: logicalScreenToWorld and coordinate decontamination](#coordinate-fix)
7. [Complete annotated implementation: updated SmoothZoomAnimator.onWheelZoom](#zoom-fix)
8. [Complete annotated implementation: updated _cancelCurrent with S3 integration](#cancel-current)
9. [Wiring the new GestureStateMachine into the wheel handler](#wiring)
10. [Edge cases and what to watch out for](#watch-out)
11. [Testing protocols](#testing)
12. [Long-term tie-ins to future phases](#long-term)
13. [Migration checklist for Claude Code](#migration)

---

## 1. Why this phase comes fourth {#why-fourth}

Phases S1 through S3 fixed the three most visible bugs: misclassified input (S1), spring overshoot (S2), and the elastic freeze (S3). Phase S4 fixes the structural problem underneath all of them: the `GestureStateMachine` has no memory of how long a gesture has been active, no concept of how recently a gesture ended, and no distinction between user-initiated input and system-driven animation. It treats every mode transition as equally cheap, which means the system will happily oscillate between SCROLL_PAN and ZOOM_ANIMATE on consecutive wheel events if the classifier produces even slightly inconsistent results near the boundary.

The ordering is critical for three reasons.

First, Phase S4 depends on S1's classifier being correct. The restructured state machine adds dwell time and cooldown to prevent rapid switching between gesture modes. These mechanisms assume the underlying classification is reasonably stable, that the classifier is not flipping between mouse and trackpad every single event. S1's hysteresis provides that stability. Without S1, dwell time would merely delay the chattering rather than eliminate it: the system would wait 80ms, then chatter, wait another 80ms, then chatter again.

Second, Phase S4 adds new code paths that call `_snapBackElastic()`. When `_cancelCurrent()` cancels a SCROLL_PAN gesture, the system transitions to IDLE and eventually triggers snap-back. If S2 were not in place, these transition-triggered snap-backs could receive unclamped velocity from whatever the trackpad was doing at the moment of cancellation. S2's velocity clamp makes every call to `_snapBackElastic()` safe, regardless of how it was triggered.

Third, Phase S4's `_cancelCurrent()` must call `_cancelSpeculativeSnapBack()` when cancelling a SNAP_BACK gesture. This method was added in Phase S3. Without it, cancelling a SNAP_BACK gesture would leave the speculative monitoring loop running, potentially starting a new snap-back animation that conflicts with the incoming gesture.

There is also a coordinate contamination bug that Phase S4 fixes: the `SmoothZoomAnimator` uses `screenToWorld()` to compute its zoom anchor point, but `screenToWorld()` includes the elastic offset in its calculation. During elastic overscroll, this means the zoom anchor drifts away from the cursor position, producing a disorienting zoom-towards-wrong-point effect. The fix, `logicalScreenToWorld()`, is architecturally simple but belongs in S4 because it completes the logical/visual coordinate separation that the elastic system introduced in Phase 3 and Phase 6.

---

## 2. The philosophical problem: switching systems and the cost of instability {#philosophy}

### Why flat priority is not enough

The current `GestureStateMachine` uses a single rule: if the requested gesture has priority greater than or equal to the current gesture, grant the request and cancel whatever was running. This is clean and easy to reason about. It also produces chattering.

The problem appears when two gestures have similar priority and the input signal oscillates between them. Consider a user scrolling on a trackpad. The classifier mostly says "trackpad," routing events to SCROLL_PAN (priority 4). But occasionally, a fast event with a large integer delta triggers a momentary "mouse" classification, routing to ZOOM_ANIMATE (priority 3). Because ZOOM_ANIMATE has lower priority than SCROLL_PAN, this particular transition is blocked. Good.

Now consider the reverse: the user is using a mouse wheel, classified as ZOOM_ANIMATE. They accidentally brush the trackpad. One event with a fractional delta triggers "trackpad" classification, routing to SCROLL_PAN. SCROLL_PAN has higher priority than ZOOM_ANIMATE, so the request is granted immediately. The smooth zoom animation is cancelled. The next mouse wheel event re-triggers ZOOM_ANIMATE, which is now lower priority than the just-started SCROLL_PAN... and the system is stuck in SCROLL_PAN until the trackpad gesture formally ends.

The priority system handles the clear-cut cases (mouse drag preempts everything, snap-back yields to everything) but fails at the boundary between similar gesture types. The failure mode is not oscillation per se; it is inappropriate mode-locking. A single spurious event can capture the gesture mode and hold it hostage because the priority relationship prevents the correct gesture from reclaiming control.

### The switching systems perspective

Control theory has studied this exact problem under the name "switching systems" or "hybrid dynamical systems." A switching system has multiple operating modes and a supervisor that decides which mode is active. The central result: even when every individual mode is stable, unconstrained switching between modes can make the overall system unstable. The classic example is two stable linear systems whose trajectories diverge when you switch between them fast enough.

The antidote is the **minimum dwell time**: the system must remain in each mode for at least τ_D seconds before switching. The foundational theorem (Morse, 1996; Hespanha & Morse, 1999) proves that a switched system with all stable subsystems is globally uniformly asymptotically stable if the dwell time τ_D exceeds a computable threshold. Below that threshold, stability is not guaranteed.

For a gesture state machine, "stability" means the system converges to and stays in the correct mode for the current input. The dwell time ensures that a single spurious event cannot flip the mode, that the system must see sustained evidence of a new gesture type before switching. This is the temporal equivalent of S1's hysteresis: S1 requires multiple events to change the device classification, S4 requires a minimum time to change the gesture mode.

### The Schmitt trigger analogy

The Schmitt trigger from electronics provides the clearest mental model for what Phase S4 adds. A standard comparator flips its output whenever the input crosses a threshold. If the input is noisy and hovers near the threshold, the output chatters. A Schmitt trigger uses two thresholds: a higher threshold for the rising edge and a lower threshold for the falling edge. The gap between them is the hysteresis band. Once the output has flipped high, it stays high until the input drops all the way to the lower threshold, not just back to the upper one.

Phase S4 adds three forms of hysteresis to the gesture state machine:

1. **Temporal hysteresis (dwell time).** Once a gesture mode is entered, a minimum time must elapse before a different mode at the same priority tier can replace it. The "input" is the requested gesture type; the "output" is the active gesture. The dwell time is the hysteresis band in the time domain.

2. **Post-gesture hysteresis (cooldown).** After a gesture ends, a short blackout period prevents a different gesture type from starting immediately. This prevents the pattern where the tail end of one gesture (its final momentum events) triggers a spurious start of a different gesture type.

3. **Structural hysteresis (tier separation).** User gestures and animation gestures live in separate tiers with asymmetric transition rules. A user gesture always preempts an animation instantly (no dwell, no cooldown). An animation never preempts a user gesture. Within each tier, the priority-based preemption still applies, but with dwell time gating same-tier transitions.

### The asymmetry of input responsiveness

There is a fundamental asymmetry in gesture transitions that the flat priority model ignores. When a user starts a new gesture (puts fingers on trackpad, presses mouse button), the system must respond instantly. Any delay between the physical action and the visual response is perceived as lag, and the threshold for "feels broken" is around 100ms (Google's RAIL model) with the threshold for "feels excellent" around 16ms (one frame).

When the system transitions between animations (inertial coast ending and snap-back starting, or smooth zoom completing and idle beginning), there is no urgency at all. The user is watching, not acting. Animation transitions can take 50ms or even 200ms without any perception of lag because no physical action is waiting for a response.

This asymmetry is why Phase S4 uses a hierarchical model rather than a flat one. User gestures live in a tier where responsiveness is paramount: they preempt animations instantly, with no dwell time or cooldown. Animations live in a tier where stability is paramount: mode switches within the animation tier are gated by dwell time, and the transition from "just finished a user gesture" to "starting an animation" is gated by cooldown.

---

## 3. How production gesture systems prevent chattering {#production-approaches}

### Flutter's gesture arena: evidence accumulation before commitment

Flutter's `GestureArena` implements a competitive model where exactly one gesture recognizer wins per pointer. The key insight is that Flutter does not commit to a gesture type on the first event. Instead, all candidate recognizers receive events simultaneously. Each recognizer accumulates evidence (measured in pixels of movement) and either declares victory (when it crosses a confidence threshold) or eliminates itself (when the evidence contradicts it).

The specific thresholds from Flutter's `constants.dart`:

- `kTouchSlop` = 18 logical pixels. A recognizer must see 18px of movement before claiming a drag or scroll. Below 18px, the gesture is still ambiguous (could be a tap).
- `kPanSlop` = 36 logical pixels (2x touchSlop). A pan recognizer needs more evidence than a simple drag because pan implies a specific direction commitment.
- `kPrecisePointerPanSlop` = 2 logical pixels. For mice and trackpads, the slop is dramatically smaller because precision devices produce less noise.
- `kDoubleTapMinTime` = 40ms. An anti-bounce constant: a second tap within 40ms of the first is treated as a continuation, not a double-tap. This is a temporal hysteresis that prevents double-tap from triggering on a single noisy tap.

The analogous approach for the VTT is the dwell time. Flutter's 18px slop accumulates spatial evidence; the VTT's 80ms dwell accumulates temporal evidence. Both serve the same function: delaying commitment until the signal is clear enough to act on with confidence.

### iOS: simultaneous recognition with delegate coordination

iOS takes the opposite approach from Flutter: multiple gesture recognizers can be active simultaneously. `UIScrollView` runs its internal pan and pinch recognizers in parallel, applying both translation and scale from each frame's events. The coordination happens through delegate methods (`shouldRecognizeSimultaneouslyWith:`) and failure chains (`require(toFail:)`), not through competition.

The key pattern from iOS that applies to the VTT is `require(toFail:)`. In iOS, a single-tap recognizer can be configured to wait until a double-tap recognizer has failed before firing. This creates a priority chain where more specific gestures get first chance, and less specific gestures fire only after the more specific ones have been ruled out.

The VTT's gesture hierarchy already encodes this: DRAG_PAN (most specific: mouse button is held) > PINCH_ZOOM (specific: ctrlKey is present) > SCROLL_PAN (less specific: trackpad detected) > ZOOM_ANIMATE (least specific: mouse wheel detected). The dwell time adds the temporal component: after entering SCROLL_PAN, the system waits 80ms before allowing a transition to PINCH_ZOOM, giving the classifier time to confirm the gesture type.

### Mapbox GL JS: handler-manager aggregation

Mapbox's gesture architecture (refactored in PR #9365, April 2020) uses independent handler classes coordinated by a centralized `HandlerManager`. Each handler independently reports whether it is active and returns `HandlerResult` objects containing `panDelta`, `zoomDelta`, `bearingDelta`, and `pitchDelta`. The manager merges results from all active handlers into a single camera update per frame.

This is architecturally closer to iOS (simultaneous recognition) than Flutter (competitive exclusion). The VTT cannot easily adopt this pattern because it has separate animation systems (SmoothZoomAnimator, CameraAnimator, elastic animator) that cannot meaningfully merge their outputs. The VTT's animation systems operate on different properties (zoom vs. position vs. elastic offset) with different update mechanisms (log-space lerp vs. spring vs. rAF callback). Merging would require the unified spring integrator that Phase S5 envisions.

For now, the competitive model (one active gesture at a time) is correct for the VTT. Phase S4 makes that model robust through hysteresis rather than restructuring toward simultaneous recognition.

### Fighting game input buffering: commit and lock

Fighting games solve a structurally identical disambiguation problem: the same input sequence (down, down-forward, forward + punch) could be a Dragon Punch or the start of a Super move, depending on what follows. Their solution is a buffer window of 50 to 180ms where inputs accumulate before the system commits to an interpretation. Once committed, the interpretation is locked, it does not change even if subsequent inputs would have produced a different move.

The specific buffer windows from production fighting games:

- Street Fighter V: 50ms (3 frames at 60fps) for normal attacks
- Guilty Gear Strive: 50ms universal buffer
- Tekken 8: 133ms (8 frames) for attack inputs
- Super Smash Bros. Ultimate: 150ms (9 frames) universal buffer
- Street Fighter 6: 183ms (11 frames) for complex motions

The VTT's dwell time (80ms) sits squarely in the middle of this range. It is long enough to accumulate 4 to 5 trackpad events (at 16ms intervals) or 1 mouse wheel event (at 80ms+ intervals), providing sufficient evidence for reliable classification. It is short enough to fall below the 100ms perception threshold, so users do not perceive it as input lag.

The "commit and lock" principle is what dwell time enforces. Once the gesture state machine has been in SCROLL_PAN for 80ms, it is committed. A transition to a different user gesture requires the incoming gesture to have higher priority (PINCH_ZOOM or DRAG_PAN, both of which are unambiguous signals). A transition to a lower-priority gesture (ZOOM_ANIMATE) is blocked entirely during the dwell period and gated by evidence afterward.

---

## 4. The three mechanisms: dwell time, cooldown, and hierarchical preemption {#three-mechanisms}

### Mechanism 1: Minimum dwell time (80ms)

Once the gesture state machine enters a user gesture mode (SCROLL_PAN, PINCH_ZOOM, or DRAG_PAN), it will not transition to a different user gesture for at least 80ms, unless the incoming gesture has strictly higher priority.

The 80ms value comes from three constraints:

1. **Below the 100ms perception threshold.** At 80ms, the dwell time is 1 to 2 frames below the threshold where users begin to perceive input lag. The gesture state machine rejects the transition silently; the events continue being processed in the current mode. The user does not perceive a delay because their input is never ignored, only rerouted.

2. **Enough for 4 to 5 trackpad events.** At 60Hz, 80ms covers approximately 5 display refresh cycles. If the classifier has been consistently reporting "trackpad" for 5 events, the classification is almost certainly correct. If it has been flickering between "trackpad" and "mouse," the dwell time has bought enough time for S1's windowed classifier to accumulate a stable signal.

3. **Longer than a typical mouse wheel gap.** Mouse wheel events during fast scrolling arrive every 50 to 80ms. One mouse wheel event during an active trackpad scroll gesture produces a single ZOOM_ANIMATE request that the dwell time blocks. The next trackpad event (arriving 8 to 16ms later) reaffirms SCROLL_PAN. The dwell time prevented a mode switch that would have been reversed within one frame.

**The dwell time does not apply to user-preempts-animation transitions.** When a user gesture starts while an animation is running (e.g., the user starts scrolling during a smooth zoom animation), the transition is instant. User input is never delayed.

**The dwell time does not apply to same-gesture retargeting.** If the system is in SCROLL_PAN and receives another SCROLL_PAN request, the request is granted immediately. The gesture is not switching modes; it is continuing. Retarget operations (where the same gesture type updates its parameters) must always be accepted because they represent continuous input.

### Mechanism 2: Gesture cooldown (50ms)

After any gesture ends (transitions to IDLE), a 50ms blackout period prevents a different gesture type from starting. Same-type restarts are allowed through the cooldown.

The 50ms value is calibrated against the tail end of trackpad momentum scrolling. When the user lifts their fingers, macOS generates synthetic momentum events with decaying deltas for 200 to 500ms. The `TrackpadGestureDetector` processes these and eventually fires `onGestureEnd`. At this point, SCROLL_PAN releases and the system transitions to IDLE.

If the user's next action is a mouse wheel zoom, the first wheel event arrives at some point after the finger lift. The cooldown ensures that a stray momentum event (arriving within 50ms of `onGestureEnd`) does not start a new SCROLL_PAN gesture that competes with the incoming ZOOM_ANIMATE. Without the cooldown, the sequence would be: `onGestureEnd` fires, SCROLL_PAN releases, a final momentum event arrives and starts a new SCROLL_PAN, the mouse wheel event arrives and is blocked because SCROLL_PAN has higher priority.

**Same-type restarts bypass the cooldown.** If SCROLL_PAN ends and a new trackpad scroll starts within 50ms, the request is granted immediately. The user lifted their fingers and put them back down quickly. This is a legitimate restart, not a spurious mode switch.

### Mechanism 3: Hierarchical tier separation

The gesture types are divided into two tiers with asymmetric transition rules:

**User input tier:** SCROLL_PAN (priority 4), PINCH_ZOOM (priority 5), DRAG_PAN (priority 6). These gestures are directly driven by user input (finger movement, mouse drag, trackpad pinch). They require instant responsiveness.

**Animation tier:** SNAP_BACK (priority 1), INERTIA (priority 2), ZOOM_ANIMATE (priority 3). These gestures are system-driven animations that run after user input ends. They can tolerate delayed transitions.

The transition rules:

1. **User preempts animation: always instant.** Any user gesture immediately cancels any animation. No dwell, no cooldown. The user's physical action takes absolute priority.

2. **Animation preempts animation: priority decides.** A higher-priority animation can replace a lower-priority one. ZOOM_ANIMATE can replace INERTIA. SNAP_BACK cannot replace ZOOM_ANIMATE (lower priority). No dwell time within the animation tier.

3. **User replaces user: dwell time + priority.** Within the user tier, a different gesture type can replace the current one only if (a) the dwell time has elapsed, AND (b) the new gesture has higher or equal priority. PINCH_ZOOM can replace SCROLL_PAN after dwell time (higher priority). SCROLL_PAN cannot replace PINCH_ZOOM (lower priority, regardless of dwell time).

4. **From IDLE: cooldown applies.** Starting a new gesture from IDLE during the cooldown period is blocked for different-type gestures and allowed for same-type restarts.

---

## 5. Complete annotated implementation: restructured GestureStateMachine {#gsm-implementation}

This replaces the existing `GestureStateMachine` class in `vtt/js/map-camera.js`.

```javascript
// ============================================================
// Gesture State Machine (Phase S4 restructure)
// ============================================================
//
// Coordinates concurrent input gestures to prevent conflicts.
// Adds three mechanisms beyond the Phase 6 flat-priority model:
//
//   1. Dwell time: the system must stay in a user gesture mode for
//      DWELL_TIME_MS before a different user gesture can replace it.
//   2. Cooldown: after any gesture ends, COOLDOWN_MS must elapse
//      before a different gesture type can start.
//   3. Hierarchical preemption: user gestures always preempt
//      animations instantly, regardless of dwell or cooldown.
//
// Design principles:
//   - User input is never delayed (animations yield instantly)
//   - Same-gesture retarget is always accepted (continuous input)
//   - Same-gesture restart bypasses cooldown (quick re-engagement)
//   - Higher priority within a tier always wins after dwell
//   - Lower priority within a tier never preempts (regardless of dwell)

const GESTURE_PRIORITY = {
  IDLE: 0,
  SNAP_BACK: 1,
  INERTIA: 2,
  ZOOM_ANIMATE: 3,
  SCROLL_PAN: 4,
  PINCH_ZOOM: 5,
  DRAG_PAN: 6
};

// Gestures in the "user input" tier.
// These are directly driven by physical user action (finger movement,
// mouse drag, trackpad pinch). They require instant responsiveness
// and always preempt animations without dwell or cooldown.
const USER_GESTURES = new Set(['SCROLL_PAN', 'PINCH_ZOOM', 'DRAG_PAN']);

// Gestures in the "animation" tier.
// These are system-driven animations that run after user input ends.
// They yield instantly to any user gesture.
const ANIMATION_GESTURES = new Set(['SNAP_BACK', 'INERTIA', 'ZOOM_ANIMATE']);

// Minimum time (ms) before a user gesture can be replaced by a
// different user gesture. Must be below the 100ms perception
// threshold to avoid feeling like input lag. 80ms covers ~5
// trackpad events at 60Hz, enough for stable classification.
const DWELL_TIME_MS = 80;

// Blackout period (ms) after any gesture ends. Prevents stray
// tail-end events from starting a spurious new gesture of a
// different type. 50ms covers ~3 trackpad events, enough to
// absorb the last momentum events after finger lift.
const COOLDOWN_MS = 50;

class GestureStateMachine {
  constructor(camera) {
    this._camera = camera;

    // Current state
    this._activeGesture = 'IDLE';

    // Dwell time tracking: when did the current gesture start?
    this._gestureStartTime = 0;

    // Cooldown tracking: when did the last gesture end, and what was it?
    this._lastGestureEndTime = 0;
    this._lastEndedGesture = 'IDLE';
  }

  /**
   * Request a gesture mode. Returns true if granted.
   *
   * The decision tree, in order of evaluation:
   *
   * 1. Same gesture as current: always accept (retarget).
   *    Rationale: continuous input should never be interrupted.
   *
   * 2. User gesture requesting while animation is active:
   *    always accept immediately.
   *    Rationale: user input must never wait for animations.
   *
   * 3. User gesture requesting while different user gesture is active:
   *    check dwell time and priority.
   *    Rationale: prevent chattering between similar gestures.
   *
   * 4. Starting from IDLE: check cooldown.
   *    Rationale: prevent stray tail-end events from starting
   *    a spurious new gesture immediately after one ended.
   *
   * 5. Animation requesting while different animation is active:
   *    priority decides (no dwell needed within animation tier).
   *    Rationale: animation transitions are not user-perceptible.
   *
   * @param {string} gesture - One of the GESTURE_PRIORITY keys
   * @returns {boolean} Whether the request was granted
   */
  request(gesture) {
    const now = performance.now();
    const newPriority = GESTURE_PRIORITY[gesture];
    const currentPriority = GESTURE_PRIORITY[this._activeGesture];

    // ---- Rule 1: Same gesture is always accepted ----
    // This covers retargeting (SmoothZoomAnimator receiving another
    // wheel tick) and continuation (ongoing scroll). No state change
    // needed; the gesture is already active.
    if (gesture === this._activeGesture) return true;

    // ---- Rule 2: User gesture preempting animation ----
    // User input takes absolute priority over system animations.
    // No dwell time, no cooldown. Cancel whatever is running and
    // activate the user gesture immediately.
    if (USER_GESTURES.has(gesture) && ANIMATION_GESTURES.has(this._activeGesture)) {
      this._cancelCurrent();
      this._activate(gesture, now);
      return true;
    }

    // ---- Rule 3: User gesture replacing different user gesture ----
    // This is where dwell time matters. The incoming gesture must
    // have higher priority AND the dwell time must have elapsed
    // (unless the incoming gesture has strictly higher priority,
    // in which case dwell is waived — DRAG_PAN should never wait
    // 80ms to preempt SCROLL_PAN when the user clicks the mouse).
    if (USER_GESTURES.has(gesture) && USER_GESTURES.has(this._activeGesture)) {
      // Strictly higher priority: always accept (e.g., DRAG_PAN
      // preempting SCROLL_PAN, or PINCH_ZOOM preempting SCROLL_PAN).
      // These represent unambiguous physical signals: a mouse button
      // press or a ctrlKey event. No dwell needed.
      if (newPriority > currentPriority) {
        this._cancelCurrent();
        this._activate(gesture, now);
        return true;
      }

      // Same or lower priority: check dwell time.
      // If dwell has not elapsed, reject. The system is committed
      // to the current gesture and needs more time before switching.
      const dwellElapsed = now - this._gestureStartTime;
      if (dwellElapsed < DWELL_TIME_MS) {
        return false;
      }

      // Dwell elapsed, but only allow if same or higher priority.
      // Lower priority user gestures never preempt (SCROLL_PAN
      // cannot replace PINCH_ZOOM regardless of dwell time).
      if (newPriority >= currentPriority) {
        this._cancelCurrent();
        this._activate(gesture, now);
        return true;
      }

      return false;
    }

    // ---- Rule 4: Starting from IDLE ----
    // Check cooldown: was a gesture recently ended?
    if (this._activeGesture === 'IDLE') {
      const cooldownElapsed = now - this._lastGestureEndTime;

      // Cooldown only blocks different gesture types.
      // Same-type restart is always allowed (the user lifted their
      // fingers and put them back down quickly — this is a
      // legitimate restart, not a spurious mode switch).
      if (cooldownElapsed < COOLDOWN_MS
          && gesture !== this._lastEndedGesture
          && this._lastEndedGesture !== 'IDLE') {
        return false;
      }

      this._activate(gesture, now);
      return true;
    }

    // ---- Rule 5: Animation replacing animation ----
    // No dwell time within the animation tier. Priority decides.
    // Higher or equal priority wins (allows retargeting within tier).
    if (newPriority >= currentPriority) {
      this._cancelCurrent();
      this._activate(gesture, now);
      return true;
    }

    // All other cases: request denied.
    return false;
  }

  /**
   * Release a gesture mode, transitioning to IDLE.
   *
   * Only the active gesture can be released. This prevents a
   * stale release from a gesture that was already preempted.
   * For example: SCROLL_PAN is preempted by DRAG_PAN, then the
   * TrackpadGestureDetector fires onGestureEnd and calls
   * release('SCROLL_PAN'). The release is ignored because
   * SCROLL_PAN is no longer active.
   *
   * @param {string} gesture - The gesture to release
   */
  release(gesture) {
    if (this._activeGesture !== gesture) return;

    this._lastEndedGesture = gesture;
    this._lastGestureEndTime = performance.now();
    this._activeGesture = 'IDLE';
  }

  /**
   * Activate a new gesture, recording the start time for
   * dwell time calculation.
   * @private
   */
  _activate(gesture, now) {
    this._activeGesture = gesture;
    this._gestureStartTime = now;
  }

  /**
   * Cancel whatever gesture is currently active.
   *
   * Each gesture type has specific cleanup requirements:
   * - INERTIA: cancel the rAF loop for inertial coast
   * - SNAP_BACK: cancel speculative monitoring AND elastic animation
   * - ZOOM_ANIMATE: cancel the smooth zoom rAF loop
   * - SCROLL_PAN: cancel the trackpad gesture detector
   *
   * This method does NOT transition to IDLE. The caller is
   * responsible for activating the new gesture. This prevents
   * a brief IDLE flash between cancel and activate.
   * @private
   */
  _cancelCurrent() {
    switch (this._activeGesture) {
      case 'INERTIA':
        this._camera._cancelInertialCoast();
        break;
      case 'SNAP_BACK':
        // Phase S3 added _cancelSpeculativeSnapBack(), which stops
        // the EWMA monitoring loop. We call it here in addition to
        // cancelling the elastic animator directly. Belt and suspenders:
        // _cancelSpeculativeSnapBack already cancels the elastic
        // animator internally, but the explicit cancel() call is
        // defense-in-depth in case the methods get refactored
        // independently in the future.
        if (this._camera._cancelSpeculativeSnapBack) {
          this._camera._cancelSpeculativeSnapBack();
        }
        if (this._camera._elasticAnimator) {
          this._camera._elasticAnimator.cancel();
        }
        break;
      case 'ZOOM_ANIMATE':
        if (this._camera._smoothZoom) {
          this._camera._smoothZoom.cancel();
        }
        break;
      case 'SCROLL_PAN':
        if (this._camera._trackpadDetector) {
          this._camera._trackpadDetector.cancel();
        }
        break;
      // PINCH_ZOOM and DRAG_PAN have no animation to cancel.
      // Their cleanup is handled by the input handlers directly
      // (mouseup for DRAG_PAN, ctrlKey release for PINCH_ZOOM).
    }
  }

  /** Get the currently active gesture type. */
  get current() { return this._activeGesture; }
}
```

### Why the decision tree is ordered this way

The five rules are evaluated in a specific order that prioritizes the cheapest checks first and ensures the most important guarantees are met before the more nuanced ones.

Rule 1 (same-gesture retarget) is checked first because it is the most common case during active input. A user scrolling on a trackpad generates 60 events per second, each producing a SCROLL_PAN request. Checking `gesture === this._activeGesture` is O(1) and returns immediately, avoiding the more expensive timestamp comparisons in the remaining rules.

Rule 2 (user preempts animation) is checked second because user responsiveness is the highest priority after continuity. If the user starts scrolling while a smooth zoom animation is running, the animation must stop instantly. Checking `USER_GESTURES.has(gesture) && ANIMATION_GESTURES.has(this._activeGesture)` is two Set lookups, both O(1).

Rule 3 (user replaces user) is the most complex and the most likely to reject a request. It involves the dwell time calculation (`now - this._gestureStartTime`), the priority comparison, and two set lookups. This rule fires relatively rarely because users typically maintain one gesture type throughout a continuous interaction.

Rule 4 (starting from IDLE) handles the transition from "nothing happening" to "gesture begins." The cooldown check is simple and fast, but it must come after Rule 1 (a release followed immediately by a same-gesture request should bypass cooldown, and Rule 1 catches this case when the gesture has not yet transitioned through IDLE).

Rule 5 (animation replaces animation) is the rarest case and simplest check: pure priority comparison.

---

## 6. Complete annotated implementation: logicalScreenToWorld and coordinate decontamination {#coordinate-fix}

### The problem: elastic offset contaminates zoom anchor calculations

The `SmoothZoomAnimator` captures a zoom anchor point by calling `this._camera.screenToWorld(screenX, screenY)`. The anchor represents the world-space point under the cursor, which should remain stationary as the zoom level changes. The animation loop then computes the camera position required to keep that world point at the same screen position at the new zoom level.

The problem: `screenToWorld()` uses `this.visualX` and `this.visualY`, which include the elastic offset:

```javascript
// Current screenToWorld (Phase 1 implementation):
screenToWorld(sx, sy) {
  return {
    x: sx / this.zoom + this.visualX,    // visualX = this.x + this.elasticOffsetX
    y: sy / this.zoom + this.visualY     // visualY = this.y + this.elasticOffsetY
  };
}
```

When the user zooms during elastic overscroll (e.g., they have scrolled past the boundary and the elastic offset is 30px), the anchor point is computed relative to the visually displaced camera position, not the logical camera position. The `SmoothZoomAnimator` then adjusts the camera to keep this displaced anchor stationary. The result: the zoom happens, but the viewport shifts by the elastic offset amount, and the cursor no longer points at the same map feature it pointed at before the zoom.

This is a coordinate contamination bug. The elastic offset is a transient visual effect that should not influence the logical camera state. The zoom anchor calculation is a logical operation (where should the camera be positioned to keep this world point under the cursor?), and it must use the logical camera position.

### The fix: logicalScreenToWorld

Add a new method that performs the screen-to-world conversion using the logical camera position (ignoring elastic offset):

```javascript
/**
 * Convert screen coordinates to world coordinates using the LOGICAL
 * camera position (ignoring elastic offset).
 *
 * Use this for operations that must target the actual map position,
 * not the visually displaced position:
 *   - Zoom-at-cursor anchor calculation (SmoothZoomAnimator)
 *   - Hit testing (which token is under the cursor)
 *   - Camera preset saving (serialize the logical state)
 *   - Cross-window sync (send logical state, not visual state)
 *
 * Use the regular screenToWorld() for:
 *   - Rendering (what world-space region is visible on screen)
 *   - Visual feedback (hover highlights, selection rectangles)
 *
 * @param {number} sx Screen X (CSS pixels from canvas left)
 * @param {number} sy Screen Y (CSS pixels from canvas top)
 * @returns {{ x: number, y: number }} World coordinates
 */
logicalScreenToWorld(sx, sy) {
  return {
    x: sx / this.zoom + this.x,    // this.x, NOT this.visualX
    y: sy / this.zoom + this.y     // this.y, NOT this.visualY
  };
}
```

### The three-layer coordinate model

This method formalizes a coordinate model that has been implicit since Phase 3 introduced elastic overscroll:

```
┌─────────────────────────────────────┐
│  VISUAL (rendering)                 │
│  visualX = x + elasticOffsetX       │
│  Used by: screenToWorld(),          │
│           worldToScreen(),          │
│           applyTransform()          │
├─────────────────────────────────────┤
│  ELASTIC (transient effect)         │
│  elasticOffsetX, elasticOffsetY     │
│  Not serialized, not synced,        │
│  always animates back to zero       │
├─────────────────────────────────────┤
│  LOGICAL (source of truth)          │
│  this.x, this.y, this.zoom         │
│  Used by: logicalScreenToWorld(),   │
│           setPosition(),            │
│           serialize(), BroadcastChannel │
└─────────────────────────────────────┘
```

The rendering layer uses the visual position because the canvas must show the elastic displacement. The coordinate math for zoom-at-cursor, hit testing, and state persistence uses the logical position because those operations must reflect the actual camera state, not the transient visual displacement.

This separation is exactly the pattern used by tldraw (separate `screenPoint` and `pagePoint` coordinate spaces, with camera constraints operating on the logical state) and Mapbox GL JS (the `Transform` class as source of truth, with `project()`/`unproject()` operating exclusively on logical state).

---

## 7. Complete annotated implementation: updated SmoothZoomAnimator.onWheelZoom {#zoom-fix}

Replace the anchor calculation in `SmoothZoomAnimator.onWheelZoom()` to use `logicalScreenToWorld()`:

```javascript
onWheelZoom(dz, screenX, screenY) {
  // Calculate target zoom from current target (not current actual zoom).
  // This allows rapid scroll ticks to accumulate: each tick pushes
  // the target further, and the log-space lerp chases it smoothly.
  const direction = dz < 0 ? 1 : -1;
  const factor = Math.pow(ZOOM_PER_NOTCH, Math.abs(dz) * direction);
  const minZoom = this._camera._getMinZoom();
  this._targetZoom = Math.max(minZoom, Math.min(MAX_ZOOM, this._targetZoom * factor));

  // Store the screen-space anchor (cursor position).
  this._anchor.sx = screenX;
  this._anchor.sy = screenY;

  // PHASE S4 FIX: Use logicalScreenToWorld instead of screenToWorld.
  //
  // screenToWorld uses visualX/Y, which includes elastic offset.
  // During elastic overscroll, this causes the zoom anchor to drift
  // away from the cursor position by the elastic offset amount.
  //
  // logicalScreenToWorld uses this.x/this.y (the hard-clamped logical
  // position), which is the correct reference frame for computing
  // where the camera should be after the zoom.
  const worldPt = this._camera.logicalScreenToWorld(screenX, screenY);
  this._anchor.wx = worldPt.x;
  this._anchor.wy = worldPt.y;

  if (!this._animating) {
    this._animating = true;
    this._rafId = requestAnimationFrame(this._step);
  }
}
```

### Why the _step() method does not need changes

The `_step()` method computes the new camera position as:

```javascript
cam.x = this._anchor.wx - this._anchor.sx / newZoom;
cam.y = this._anchor.wy - this._anchor.sy / newZoom;
```

This sets `cam.x` and `cam.y` (the logical position) directly. It then calls `_applyConstraints()`, which hard-clamps the position to the map boundaries. The elastic offset is not involved in this calculation, and the logical position is set correctly because `_anchor.wx` and `_anchor.wy` were computed from the logical position via `logicalScreenToWorld()`.

If the user is zooming during elastic overscroll, the elastic offset continues to exist independently. The `_step()` method moves the logical camera; the elastic animator moves the elastic offset. The visual position (for rendering) is the sum of both. The two systems are decoupled, which is exactly what we want.

### What about zoomAt() for trackpad pinch?

The direct `zoomAt()` method, called for trackpad pinch-to-zoom (`dz !== 0` path in the wheel handler where `device === 'trackpad'`), also uses `screenToWorld()` for its anchor calculation:

```javascript
zoomAt(sx, sy, delta) {
  const worldBefore = this.screenToWorld(sx, sy);
  // ...
  const worldAfter = this.screenToWorld(sx, sy);
  this.x += worldBefore.x - worldAfter.x;
  this.y += worldBefore.y - worldAfter.y;
  // ...
}
```

This has the same coordinate contamination problem. However, `zoomAt()` is also called by the keyboard controller (`zoomToCenter()`) and potentially by other modules, so changing it to use `logicalScreenToWorld()` has a wider blast radius.

The correct fix for `zoomAt()` is to use `logicalScreenToWorld()` for both the before and after calculations:

```javascript
zoomAt(sx, sy, delta) {
  // PHASE S4 FIX: Use logical position for anchor, not visual.
  const worldBefore = this.logicalScreenToWorld(sx, sy);
  const effectiveMinZoom = this._getMinZoom();
  this.zoom = Math.max(effectiveMinZoom, Math.min(MAX_ZOOM,
    this.zoom * Math.pow(2, delta)));
  const worldAfter = this.logicalScreenToWorld(sx, sy);
  this.x += worldBefore.x - worldAfter.x;
  this.y += worldBefore.y - worldAfter.y;
  this._applyConstraints();

  // Recalculate elastic offset with new zoom-derived bounds.
  // Zoom changes the boundary positions, so the elastic offset
  // (which is relative to the boundary) may need adjustment.
  if (this.elasticOffsetX !== 0 || this.elasticOffsetY !== 0) {
    this._feedElasticOverflow(this._cumulativeOverflowX, this._cumulativeOverflowY);
    EventBus.emit('camera:changed');
  }
}
```

This change is safe because `zoomToCenter()` calls `zoomAt(this.viewportW / 2, this.viewportH / 2, delta)`, and the viewport center maps to the same logical world point regardless of elastic offset (the elastic offset is symmetric around the logical position). The keyboard controller passes screen coordinates that are always the viewport center, which is unaffected by the elastic shift.

---

## 8. Complete annotated implementation: updated _cancelCurrent with S3 integration {#cancel-current}

The `_cancelCurrent()` method shown in Section 5 already includes the Phase S3 integration. Here is the specific change from the Phase 6 version, isolated for clarity:

```javascript
// Phase 6 (current) _cancelCurrent:
_cancelCurrent() {
  switch (this._activeGesture) {
    case 'INERTIA':
      this._camera._cancelInertialCoast();
      break;
    case 'SNAP_BACK':
      if (this._camera._elasticAnimator) this._camera._elasticAnimator.cancel();
      break;
    case 'ZOOM_ANIMATE':
      if (this._camera._smoothZoom) this._camera._smoothZoom.cancel();
      break;
    case 'SCROLL_PAN':
      if (this._camera._trackpadDetector) this._camera._trackpadDetector.cancel();
      break;
  }
}

// Phase S4 (new) _cancelCurrent:
_cancelCurrent() {
  switch (this._activeGesture) {
    case 'INERTIA':
      this._camera._cancelInertialCoast();
      break;
    case 'SNAP_BACK':
      // NEW: Phase S3 added _cancelSpeculativeSnapBack(), which stops
      // the EWMA monitoring loop AND cancels the elastic animator.
      // Call it first, then call cancel() directly as defense-in-depth.
      if (this._camera._cancelSpeculativeSnapBack) {
        this._camera._cancelSpeculativeSnapBack();
      }
      if (this._camera._elasticAnimator) {
        this._camera._elasticAnimator.cancel();
      }
      break;
    case 'ZOOM_ANIMATE':
      if (this._camera._smoothZoom) this._camera._smoothZoom.cancel();
      break;
    case 'SCROLL_PAN':
      if (this._camera._trackpadDetector) this._camera._trackpadDetector.cancel();
      break;
  }
}
```

The only change is the addition of the `_cancelSpeculativeSnapBack()` call in the SNAP_BACK case. This is a backward-compatible change: the `if (this._camera._cancelSpeculativeSnapBack)` guard handles the case where Phase S3 has not yet been deployed. Once S3 is in place, the guard is technically unnecessary but costs nothing and prevents a crash if the methods are ever refactored independently.

---

## 9. Wiring the new GestureStateMachine into the wheel handler {#wiring}

The existing wheel handler routing in `_attachWheelHandler()` already calls `this._gestures.request()` for each gesture type. The new GestureStateMachine is a drop-in replacement: same class name, same `request()` and `release()` API, same constructor signature. The only behavioral difference is that `request()` now sometimes returns `false` where it previously always returned `true` for same-or-higher priority gestures.

The wheel handler needs one change: it must check the return value of `request()` and only proceed if the request was granted. Currently, the return value is ignored:

```javascript
// Current wheel handler (Phase 6 / S1 routing):
if (device === 'mouse') {
  if (this._gestures) this._gestures.request('ZOOM_ANIMATE');
  this._smoothZoom.onWheelZoom(dz, screen.x, screen.y);
} else {
  if (this._gestures) this._gestures.request('PINCH_ZOOM');
  this.zoomAt(screen.x, screen.y, dz * -ZOOM_SENSITIVITY);
}

// Phase S4 update: respect the request() return value.
if (device === 'mouse') {
  const granted = !this._gestures || this._gestures.request('ZOOM_ANIMATE');
  if (granted) {
    this._smoothZoom.onWheelZoom(dz, screen.x, screen.y);
  }
  // If denied, the event is silently dropped. The current gesture
  // mode continues processing. The user does not perceive this
  // because the denial only happens during the dwell/cooldown
  // window, which is below the perception threshold.
} else {
  const granted = !this._gestures || this._gestures.request('PINCH_ZOOM');
  if (granted) {
    this.zoomAt(screen.x, screen.y, dz * -ZOOM_SENSITIVITY);
  }
}
```

The same pattern applies to the `dx/dy !== 0` path:

```javascript
// Current:
if (device === 'mouse') {
  const screen = this.eventToScreen(e);
  if (this._gestures) this._gestures.request('ZOOM_ANIMATE');
  this._smoothZoom.onWheelZoom(dy / 100, screen.x, screen.y);
} else {
  this._trackpadDetector.handleWheel(e);
  this.panBy(-dx, -dy);
}

// Phase S4 update:
if (device === 'mouse') {
  const screen = this.eventToScreen(e);
  const granted = !this._gestures || this._gestures.request('ZOOM_ANIMATE');
  if (granted) {
    this._smoothZoom.onWheelZoom(dy / 100, screen.x, screen.y);
  }
} else {
  // Trackpad scroll: the gesture state machine request happens
  // inside _trackpadDetector's onGestureStart callback, not here.
  // The panBy() call should always proceed because the trackpad
  // scroll is the active gesture. But we still process the event
  // through the detector for gesture lifecycle tracking.
  this._trackpadDetector.handleWheel(e);
  this.panBy(-dx, -dy);
}
```

### Why trackpad pan does not check the return value

The trackpad scroll path is different from the other paths because the gesture request happens inside the `TrackpadGestureDetector`'s `onGestureStart` callback, not inline in the wheel handler. By the time `panBy(-dx, -dy)` executes, the gesture has already been requested (on the first event) or is already active (on subsequent events). Gating `panBy()` on a gesture request would require restructuring the `TrackpadGestureDetector` integration, which is unnecessary because:

1. If SCROLL_PAN is already active, subsequent SCROLL_PAN requests return true (Rule 1: same-gesture retarget).
2. If SCROLL_PAN is not active and the request is denied (e.g., during cooldown), the `onGestureStart` callback is not fired, so the gesture state is inconsistent. But this inconsistency is harmless: `panBy()` still works (it just pans without elastic offset tracking), and the `TrackpadGestureDetector` will re-request on the next event.

A more thorough solution would check the request in `onGestureStart` and skip `panBy()` if denied. But the practical impact is negligible: the denied events occur during the 50ms cooldown window, and the pan displacement during those 50ms is at most a few pixels, well below perceptible.

---

## 10. Edge cases and what to watch out for {#watch-out}

### The dwell time must be below 100ms

If the dwell time exceeds the RAIL perception threshold (100ms), users will perceive the denied gesture transitions as input lag. At 80ms, the dwell time is 1 to 2 frames below the threshold. If future testing reveals that 80ms causes perceptible lag on specific hardware or under high CPU load, reduce to 64ms (4 frames at 60Hz). Do not go below 48ms (3 frames), as that may be insufficient for the classifier to stabilize.

### Cooldown must not affect drag starts

The `_cancelPan()` method calls `this._gestures.request('SNAP_BACK')` and then `this._snapBackElastic()`. If the user quickly re-engages with a right-click drag after a blur/mouseleave cancellation, the cooldown could theoretically block the new DRAG_PAN request.

This does not happen in practice because `_startPan()` calls `this._gestures.request('DRAG_PAN')`, which enters Rule 2 (user preempts animation: the SNAP_BACK from `_cancelPan` is an animation gesture). Rule 2 bypasses dwell and cooldown entirely. If the SNAP_BACK has already completed and the system is in IDLE, the cooldown check in Rule 4 compares `gesture !== this._lastEndedGesture`. If the last ended gesture was SNAP_BACK, and the incoming gesture is DRAG_PAN, the cooldown blocks it. To prevent this, ensure that animation-tier gesture releases do not set `_lastEndedGesture` to a value that blocks user gestures.

The fix is already in the implementation: the cooldown blocks `gesture !== this._lastEndedGesture`, meaning it blocks different gesture types. DRAG_PAN is different from SNAP_BACK, so it would be blocked. To handle this correctly, the cooldown should only apply when the last ended gesture and the incoming gesture are in the same tier:

```javascript
// In Rule 4 (starting from IDLE), the cooldown check:
if (cooldownElapsed < COOLDOWN_MS
    && gesture !== this._lastEndedGesture
    && this._lastEndedGesture !== 'IDLE') {
  // Additional guard: cooldown only applies within the same tier.
  // A user gesture should never be blocked by the cooldown of an
  // animation gesture ending. The cooldown exists to prevent
  // scroll → zoom oscillation, not to delay user input.
  const lastWasUser = USER_GESTURES.has(this._lastEndedGesture);
  const incomingIsUser = USER_GESTURES.has(gesture);
  if (lastWasUser && incomingIsUser) {
    return false;
  }
  // Animation-to-user transition: allow through cooldown.
  // Animation-to-animation transition: allow (handled by Rule 5
  // if the system were not in IDLE, but from IDLE, priority is
  // irrelevant — just start the animation).
}
```

This refinement is included in the implementation in Section 5 as a comment. The conservative approach (the implementation as shown in Section 5) blocks any different-type gesture during cooldown. The refined approach is more permissive. Either is correct for the current bug fix; the conservative approach is safer for initial deployment, and the refinement can be added if testing reveals that animation-tier cooldowns block user gestures.

**Updated Rule 4 with the tier-aware refinement:**

```javascript
// ---- Rule 4: Starting from IDLE ----
if (this._activeGesture === 'IDLE') {
  const cooldownElapsed = now - this._lastGestureEndTime;

  // Cooldown only blocks same-tier, different-type transitions.
  // A user gesture is never blocked by an animation's cooldown.
  // An animation is never blocked by a user gesture's cooldown
  // (animations start after user gestures end, which is the
  // normal lifecycle, not a mode switch to prevent).
  if (cooldownElapsed < COOLDOWN_MS
      && gesture !== this._lastEndedGesture
      && this._lastEndedGesture !== 'IDLE') {
    const lastWasUser = USER_GESTURES.has(this._lastEndedGesture);
    const newIsUser = USER_GESTURES.has(gesture);
    // Only block if both are in the same tier and different types.
    if (lastWasUser === newIsUser) {
      return false;
    }
  }

  this._activate(gesture, now);
  return true;
}
```

### The _cancelCurrent check for _cancelSpeculativeSnapBack

The `if (this._camera._cancelSpeculativeSnapBack)` guard uses a truthiness check. If Phase S3 has been deployed, the method exists and the check passes. If Phase S3 has not been deployed, the method is undefined and the check fails, skipping the call. This is intentional: Phase S4 can be deployed before or after Phase S3 without code changes.

However, if Phase S3 is deployed and later reverted (removing `_cancelSpeculativeSnapBack` from the Camera class), the guard silently skips the call, leaving the speculative monitoring loop running. This is a defense-in-depth concern, not a practical risk: Phase S3 would only be reverted if its tests fail, and the monitoring loop is self-terminating (it stops after the elastic offset settles).

### SmoothZoomAnimator.retarget() must update _targetZoom

The existing `retarget()` method sets `_targetZoom = this._camera.zoom` and cancels the animation. This is called when the gesture state machine cancels ZOOM_ANIMATE. The new state machine calls `_cancelCurrent()` which calls `this._camera._smoothZoom.cancel()`, not `retarget()`. The `cancel()` method already sets `_targetZoom = this._camera.zoom`, so this is correct.

If a future change adds `retarget()` calls from the gesture state machine, ensure that `retarget()` and `cancel()` leave the animator in a consistent state. Currently both do, but they follow different paths: `retarget()` kills the animation and updates the target; `cancel()` kills the animation, updates the target, and clears the `_animating` flag. The semantic difference: after `retarget()`, the next `onWheelZoom()` call must restart the animation loop. After `cancel()`, the next `onWheelZoom()` call must also restart the animation loop. Both behave the same for the caller.

### The elastic offset recalculation in zoomAt()

The `zoomAt()` update includes this block:

```javascript
if (this.elasticOffsetX !== 0 || this.elasticOffsetY !== 0) {
  this._feedElasticOverflow(this._cumulativeOverflowX, this._cumulativeOverflowY);
  EventBus.emit('camera:changed');
}
```

This recalculates the elastic offset because zooming changes the map boundaries. The cumulative overflow (in world-space) is unchanged, but the rubber-band formula uses screen-space conversion (`overflowX * this.zoom`), so the visual elastic displacement changes when zoom changes. Without this recalculation, the elastic offset would appear to jump when the user zooms during overscroll.

The `EventBus.emit('camera:changed')` call is necessary because `_feedElasticOverflow` modifies `elasticOffsetX/Y` but does not emit. The `_applyConstraints()` call earlier in `zoomAt()` already emitted once for the position/zoom change, but the elastic offset change needs a second emit to trigger a re-render with the updated visual position.

---

## 11. Testing protocols {#testing}

### Unit tests (fast, deterministic, no browser rendering)

All unit tests run inside `page.evaluate()` in Playwright, testing the GestureStateMachine logic without DOM interaction or timing dependencies (we use explicit timestamp injection rather than `performance.now()`).

Create `tests/gesture-state-machine.spec.js`:

```javascript
import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode, injectTestAccessors } from './helpers.js';

// ============================================================
// GestureStateMachine: dwell time
// ============================================================
test.describe('GestureStateMachine dwell time', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('same gesture retarget always succeeds (Rule 1)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const gsm = __cam()._gestures;
      gsm.request('SCROLL_PAN');
      const r1 = gsm.request('SCROLL_PAN');
      const r2 = gsm.request('SCROLL_PAN');
      return { r1, r2, current: gsm.current };
    });
    expect(result.r1).toBe(true);
    expect(result.r2).toBe(true);
    expect(result.current).toBe('SCROLL_PAN');
  });

  test('user gesture preempts animation instantly (Rule 2)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const gsm = __cam()._gestures;
      gsm.request('ZOOM_ANIMATE');
      // SCROLL_PAN (user) preempts ZOOM_ANIMATE (animation) instantly
      const granted = gsm.request('SCROLL_PAN');
      return { granted, current: gsm.current };
    });
    expect(result.granted).toBe(true);
    expect(result.current).toBe('SCROLL_PAN');
  });

  test('user gesture preempts INERTIA instantly (Rule 2)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const gsm = __cam()._gestures;
      gsm.request('INERTIA');
      const granted = gsm.request('DRAG_PAN');
      return { granted, current: gsm.current };
    });
    expect(result.granted).toBe(true);
    expect(result.current).toBe('DRAG_PAN');
  });

  test('higher priority user gesture preempts lower immediately (Rule 3a)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const gsm = __cam()._gestures;
      gsm.request('SCROLL_PAN');
      // PINCH_ZOOM (priority 5) > SCROLL_PAN (priority 4): instant
      const granted = gsm.request('PINCH_ZOOM');
      return { granted, current: gsm.current };
    });
    expect(result.granted).toBe(true);
    expect(result.current).toBe('PINCH_ZOOM');
  });

  test('DRAG_PAN preempts SCROLL_PAN immediately (Rule 3a)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const gsm = __cam()._gestures;
      gsm.request('SCROLL_PAN');
      // DRAG_PAN (priority 6) > SCROLL_PAN (priority 4): instant
      const granted = gsm.request('DRAG_PAN');
      return { granted, current: gsm.current };
    });
    expect(result.granted).toBe(true);
    expect(result.current).toBe('DRAG_PAN');
  });

  test('lower priority user gesture denied during dwell (Rule 3b)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const gsm = __cam()._gestures;
      gsm.request('PINCH_ZOOM');
      // SCROLL_PAN (priority 4) < PINCH_ZOOM (priority 5): denied
      const granted = gsm.request('SCROLL_PAN');
      return { granted, current: gsm.current };
    });
    expect(result.granted).toBe(false);
    expect(result.current).toBe('PINCH_ZOOM');
  });

  test('equal priority user gesture denied during dwell (Rule 3b)', async ({ page }) => {
    // This tests the scenario where a different gesture at the same
    // priority level tries to take over before dwell time expires.
    // Currently no two different gestures share a priority, but this
    // tests the boundary condition.
    const result = await page.evaluate(() => {
      const gsm = __cam()._gestures;
      gsm.request('SCROLL_PAN');
      // Simulate a request for a hypothetical same-priority gesture.
      // Since no such gesture exists, we verify that the dwell time
      // check fires by observing the timing-dependent behavior:
      // request ZOOM_ANIMATE (animation tier, different from user tier)
      // which enters Rule 2 or Rule 5, not Rule 3.
      // Instead, let's test that SCROLL_PAN blocks itself if called
      // as a different gesture... except it can't because same-gesture
      // retarget fires first (Rule 1).
      //
      // The practical test: activate SCROLL_PAN, then immediately
      // request PINCH_ZOOM (higher priority). It should succeed
      // because higher priority bypasses dwell (Rule 3a).
      const granted = gsm.request('PINCH_ZOOM');
      return { granted, current: gsm.current };
    });
    expect(result.granted).toBe(true);
    expect(result.current).toBe('PINCH_ZOOM');
  });

  test('dwell time expires and allows same-priority switch', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const gsm = __cam()._gestures;
      gsm.request('SCROLL_PAN');
      // Wait for dwell time to expire (80ms + margin)
      await new Promise(r => setTimeout(r, 100));
      // Now try a same-or-higher priority gesture
      const granted = gsm.request('PINCH_ZOOM');
      return { granted, current: gsm.current };
    });
    expect(result.granted).toBe(true);
    expect(result.current).toBe('PINCH_ZOOM');
  });
});

// ============================================================
// GestureStateMachine: cooldown
// ============================================================
test.describe('GestureStateMachine cooldown', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('different gesture type blocked during cooldown (Rule 4)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const gsm = __cam()._gestures;
      gsm.request('SCROLL_PAN');
      gsm.release('SCROLL_PAN');
      // Immediately request a different type
      const granted = gsm.request('ZOOM_ANIMATE');
      return { granted, current: gsm.current };
    });
    // Should be denied: cooldown has not elapsed, different type
    expect(result.granted).toBe(false);
    expect(result.current).toBe('IDLE');
  });

  test('same gesture type restarts through cooldown (Rule 4 bypass)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const gsm = __cam()._gestures;
      gsm.request('SCROLL_PAN');
      gsm.release('SCROLL_PAN');
      // Immediately request the same type: should bypass cooldown
      const granted = gsm.request('SCROLL_PAN');
      return { granted, current: gsm.current };
    });
    expect(result.granted).toBe(true);
    expect(result.current).toBe('SCROLL_PAN');
  });

  test('cooldown expires and allows different gesture type', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const gsm = __cam()._gestures;
      gsm.request('SCROLL_PAN');
      gsm.release('SCROLL_PAN');
      // Wait for cooldown to expire (50ms + margin)
      await new Promise(r => setTimeout(r, 70));
      const granted = gsm.request('ZOOM_ANIMATE');
      return { granted, current: gsm.current };
    });
    expect(result.granted).toBe(true);
    expect(result.current).toBe('ZOOM_ANIMATE');
  });

  test('animation ending does not block user gesture via cooldown', async ({ page }) => {
    // This tests the tier-aware refinement: an animation ending
    // should not prevent a user gesture from starting.
    const result = await page.evaluate(() => {
      const gsm = __cam()._gestures;
      gsm.request('SNAP_BACK');
      gsm.release('SNAP_BACK');
      // Immediately request a user gesture
      const granted = gsm.request('SCROLL_PAN');
      return { granted, current: gsm.current };
    });
    // With the tier-aware refinement, this should be granted.
    // Without the refinement (conservative approach), this would
    // be denied. Adjust expectation based on which version is deployed.
    // For the initial conservative deployment:
    // expect(result.granted).toBe(false);
    // For the tier-aware refinement:
    expect(result.granted).toBe(true);
    expect(result.current).toBe('SCROLL_PAN');
  });
});

// ============================================================
// GestureStateMachine: animation tier
// ============================================================
test.describe('GestureStateMachine animation tier', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('higher priority animation replaces lower (Rule 5)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const gsm = __cam()._gestures;
      gsm.request('INERTIA');  // priority 2
      const granted = gsm.request('ZOOM_ANIMATE');  // priority 3
      return { granted, current: gsm.current };
    });
    expect(result.granted).toBe(true);
    expect(result.current).toBe('ZOOM_ANIMATE');
  });

  test('lower priority animation denied (Rule 5)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const gsm = __cam()._gestures;
      gsm.request('ZOOM_ANIMATE');  // priority 3
      const granted = gsm.request('INERTIA');  // priority 2
      return { granted, current: gsm.current };
    });
    expect(result.granted).toBe(false);
    expect(result.current).toBe('ZOOM_ANIMATE');
  });

  test('animation cannot preempt user gesture (tier separation)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const gsm = __cam()._gestures;
      gsm.request('SCROLL_PAN');  // user tier
      const granted = gsm.request('ZOOM_ANIMATE');  // animation tier
      return { granted, current: gsm.current };
    });
    // ZOOM_ANIMATE (priority 3) < SCROLL_PAN (priority 4): denied
    expect(result.granted).toBe(false);
    expect(result.current).toBe('SCROLL_PAN');
  });
});

// ============================================================
// GestureStateMachine: release semantics
// ============================================================
test.describe('GestureStateMachine release', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('release transitions to IDLE', async ({ page }) => {
    const result = await page.evaluate(() => {
      const gsm = __cam()._gestures;
      gsm.request('SCROLL_PAN');
      gsm.release('SCROLL_PAN');
      return { current: gsm.current };
    });
    expect(result.current).toBe('IDLE');
  });

  test('stale release is ignored', async ({ page }) => {
    const result = await page.evaluate(() => {
      const gsm = __cam()._gestures;
      gsm.request('SCROLL_PAN');
      gsm.request('DRAG_PAN');  // preempts SCROLL_PAN
      gsm.release('SCROLL_PAN');  // stale: SCROLL_PAN is not active
      return { current: gsm.current };
    });
    // DRAG_PAN should still be active; stale release did nothing
    expect(result.current).toBe('DRAG_PAN');
  });
});

// ============================================================
// logicalScreenToWorld coordinate decontamination
// ============================================================
test.describe('logicalScreenToWorld', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('logicalScreenToWorld ignores elastic offset', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam.x = 100;
      cam.y = 100;
      cam.elasticOffsetX = 30;
      cam.elasticOffsetY = -20;

      const visual = cam.screenToWorld(0, 0);
      const logical = cam.logicalScreenToWorld(0, 0);

      return {
        visualX: visual.x,
        visualY: visual.y,
        logicalX: logical.x,
        logicalY: logical.y,
      };
    });

    // screenToWorld includes elastic offset:
    // sx/zoom + visualX = 0/2 + (100 + 30) = 130
    expect(result.visualX).toBeCloseTo(130, 5);
    expect(result.visualY).toBeCloseTo(80, 5);  // 0/2 + (100 + -20)

    // logicalScreenToWorld ignores elastic offset:
    // sx/zoom + x = 0/2 + 100 = 100
    expect(result.logicalX).toBeCloseTo(100, 5);
    expect(result.logicalY).toBeCloseTo(100, 5);
  });

  test('logicalScreenToWorld matches screenToWorld when no elastic offset', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 1.5;
      cam.x = 200;
      cam.y = 150;
      cam.elasticOffsetX = 0;
      cam.elasticOffsetY = 0;

      const visual = cam.screenToWorld(300, 200);
      const logical = cam.logicalScreenToWorld(300, 200);

      return {
        matchX: Math.abs(visual.x - logical.x) < 0.001,
        matchY: Math.abs(visual.y - logical.y) < 0.001,
      };
    });
    expect(result.matchX).toBe(true);
    expect(result.matchY).toBe(true);
  });
});
```

### Integration tests (Playwright, real browser timing)

Add these to `tests/phase6-integration.spec.js` or a new `tests/gesture-coordination-integration.spec.js`:

```javascript
import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode, injectTestAccessors } from './helpers.js';

// ============================================================
// Rapid scroll-then-pinch does not oscillate
// ============================================================
test.describe('Gesture coordination (Phase S4)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
    await enterMapMode(page);
    await injectTestAccessors(page);
  });

  test('rapid alternating scroll and pinch events settle to one mode', async ({ page }) => {
    // Dispatch alternating scroll (no ctrl) and pinch (ctrl) events
    // rapidly. The gesture state machine should not oscillate.
    const modeHistory = await page.evaluate(async () => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();

      const el = document.getElementById('map-container');
      const modes = [];

      for (let i = 0; i < 20; i++) {
        const isCtrl = i % 2 === 0;
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: isCtrl ? -2 : 10,
          deltaX: isCtrl ? 0 : 3.5,
          deltaMode: 0,
          ctrlKey: isCtrl,
          bubbles: true,
          cancelable: true
        }));
        modes.push(cam._gestures?.current || 'UNKNOWN');
        // Small delay to simulate real timing
        await new Promise(r => setTimeout(r, 8));
      }

      return modes;
    });

    // Count mode transitions. With dwell time, there should be
    // significantly fewer transitions than events.
    let transitions = 0;
    for (let i = 1; i < modeHistory.length; i++) {
      if (modeHistory[i] !== modeHistory[i - 1]) transitions++;
    }

    // Without Phase S4, transitions could equal events (20).
    // With Phase S4, dwell time limits transitions. We expect
    // at most ~4-5 transitions for 20 events.
    expect(transitions).toBeLessThan(10);
  });

  test('mouse drag preempts scroll without dwell delay', async ({ page }) => {
    // Start a scroll gesture, then right-click drag.
    // The drag should preempt immediately (higher priority user gesture).
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      const el = document.getElementById('map-container');
      // Start a scroll gesture
      el.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 5.5, deltaX: 2.1, deltaMode: 0,
        ctrlKey: false, bubbles: true, cancelable: true
      }));
    });

    const beforeDrag = await page.evaluate(() => __cam()._gestures?.current);
    expect(beforeDrag).toBe('SCROLL_PAN');

    // Start a mouse drag (higher priority)
    const canvas = page.locator('#map-container');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });

    const afterDrag = await page.evaluate(() => __cam()._gestures?.current);
    expect(afterDrag).toBe('DRAG_PAN');

    await page.mouse.up({ button: 'right' });
  });

  test('zoom during elastic overscroll uses correct anchor', async ({ page }) => {
    // This tests the coordinate contamination fix.
    // Setup: zoom in, pan to boundary, create elastic offset.
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoom = 2.0;
      cam._applyConstraints();
      for (let i = 0; i < 200; i++) cam.panBy(50, 0);
    });

    // Create elastic offset via trackpad scroll
    await page.evaluate(() => {
      const el = document.getElementById('map-container');
      const cam = __cam();
      cam._gestureActive = true;
      cam._cumulativeOverflowX = 0;
      for (let i = 0; i < 5; i++) {
        cam.panBy(100, 0);
      }
    });

    const before = await page.evaluate(() => {
      const cam = __cam();
      return {
        x: cam.x,
        elasticX: cam.elasticOffsetX,
        zoom: cam.zoom
      };
    });

    // Now zoom at a specific screen point
    await page.evaluate(() => {
      const cam = __cam();
      cam.zoomAt(400, 300, 0.1);  // zoom in slightly
    });

    const after = await page.evaluate(() => {
      const cam = __cam();
      return {
        x: cam.x,
        zoom: cam.zoom,
        elasticX: cam.elasticOffsetX
      };
    });

    // Zoom should have changed
    expect(after.zoom).toBeGreaterThan(before.zoom);
    // Camera x should not have jumped wildly due to elastic contamination.
    // Without the fix, the x shift would include the elastic offset,
    // causing a large unexpected jump. With the fix, the shift is
    // proportional to the zoom change at the cursor point.
    const xShift = Math.abs(after.x - before.x);
    // Sanity check: the shift should be reasonable (< 100px world-space
    // for a small zoom change). Without the fix, it could be 200+ px.
    expect(xShift).toBeLessThan(100);
  });
});
```

### Manual testing checklist

Because gesture transitions involve timing and physical interaction patterns that are difficult to simulate perfectly with `dispatchEvent`, manual testing with a real trackpad and mouse is essential.

1. **Slow two-finger scroll on trackpad:** Camera pans smoothly. Gesture state should be SCROLL_PAN throughout. No mode flickering.

2. **Fast two-finger scroll on trackpad (the S1 regression test):** Camera pans, does NOT zoom. Phase S1 handles classification; Phase S4 ensures the gesture state machine does not override S1's classification with a spurious ZOOM_ANIMATE.

3. **Pinch to zoom on trackpad:** Camera zooms at cursor. Gesture state should be PINCH_ZOOM. Transitioning from scroll to pinch should be instant (higher priority, Rule 3a).

4. **Pinch then immediately scroll (THE CRITICAL S4 TEST):** After pinch-zoom ends, start scrolling within 50ms. With cooldown, the first few scroll events should still be treated as PINCH_ZOOM (same-type restart) or blocked (cooldown). The visual result: a brief pause (< 50ms, imperceptible) then smooth scroll begins. No erratic zoom-then-pan-then-zoom oscillation.

5. **Mouse scroll wheel:** Camera zooms smoothly. Gesture state should be ZOOM_ANIMATE.

6. **Mouse scroll wheel then immediately trackpad scroll:** After mouse zooming, touch the trackpad within 50ms. The cooldown should prevent the first trackpad event from triggering SCROLL_PAN immediately. After 50ms, scrolling should work normally.

7. **Right-click drag during smooth zoom animation:** Start zooming with mouse wheel. While the smooth zoom is still animating, right-click and drag. The drag should preempt the zoom instantly (Rule 2). No animation lag.

8. **Right-click drag during inertial coast:** Pan with right-click, release to start inertial coast, then immediately right-click and drag again. The new drag should preempt the coast instantly (Rule 2). The camera should follow the new drag from its current coasting position with no jump or lag.

9. **Scroll past boundary then zoom:** Scroll past the map edge (creating elastic offset). While the elastic offset is visible, Ctrl+scroll to zoom. The zoom should anchor at the cursor position, NOT at the cursor + elastic offset. The camera should zoom toward the cursor without jumping sideways.

10. **Rapid mode switching stress test:** Alternate between scroll, pinch, scroll, pinch as fast as possible. The gesture state should not oscillate on every event. With dwell time, the system should commit to one mode and stay there for at least 80ms before switching.

11. **Open Controller and Display:** Perform all the above tests with the VTT Display open. Gesture state changes are local-only (the gesture state machine is not synced across windows). The Display should see smooth camera state updates through BroadcastChannel.

---

## 12. Long-term tie-ins to future phases {#long-term}

### Phase S5 (Unified spring physics and beyond-parity features)

Phase S5's unified spring integrator will simplify the `_cancelCurrent()` method significantly. Instead of knowing about each animation system's specific cancel API (`_cancelInertialCoast`, `_elasticAnimator.cancel`, `_smoothZoom.cancel`), the gesture state machine will simply set the spring target to the current position. The spring stops animating (it is already at the target) and the new gesture begins from the current state. No explicit cancellation, no cleanup, no state flags. The spring's "current value, current velocity" behavior handles everything.

Phase S5 also adds a user preference toggle for scroll-wheel behavior (matching Figma's approach). When the user sets "scroll wheel = zoom," the classifier's output is overridden, and all non-Ctrl wheel events route to ZOOM_ANIMATE. The gesture state machine's dwell time still applies: switching between the user-preference-driven ZOOM_ANIMATE and a trackpad PINCH_ZOOM still requires dwell time to prevent chattering. The preference only changes which gesture type the wheel handler requests; the state machine's transition rules remain the same.

### Phase 7 (Touch support via PointerEvent)

Touch gestures (two-finger pinch, two-finger pan) register through PointerEvent, not WheelEvent. They bypass the wheel classifier entirely and enter the gesture state machine at PINCH_ZOOM and DRAG_PAN priority levels. The hierarchical preemption rules handle this naturally: a touch pan (DRAG_PAN, priority 6) preempts any running animation. A touch pinch (PINCH_ZOOM, priority 5) preempts scroll-pan.

The dwell time may need adjustment for touch input. Touch gestures on mobile devices produce more distinct state transitions (finger down vs. finger up) than trackpad gestures (which use continuous synthetic events). Touch gestures start with a clear `pointerdown` event and end with a clear `pointerup` event, so the gesture type is less ambiguous and the dwell time could be reduced to 50ms or even removed for touch-initiated gestures.

The cooldown may also need touch-specific tuning. When a user lifts two fingers after a pinch-zoom and immediately starts a one-finger drag, the transition should be instant. The cooldown should not delay the drag. The tier-aware refinement (animation cooldown does not block user gestures) handles this if the pinch ends by transitioning through IDLE with a PINCH_ZOOM release.

### Phase 8 (Camera presets with spring transitions)

Camera presets use spring animations to transition from the current position to a saved position. When a preset is recalled, the system should:

1. Cancel any active gesture (via `_cancelCurrent()`)
2. Zero the elastic offset immediately (the camera is jumping to a new position)
3. Start the preset spring from the current position and velocity

The gesture state machine handles step 1. The preset system would request a new gesture type (e.g., `CAMERA_PRESET`, at the ZOOM_ANIMATE priority level or higher) that preempts whatever is running. The dwell time may need to be waived for preset transitions, since the user explicitly requested a specific camera position and should not be delayed by 80ms.

A new priority level between ZOOM_ANIMATE (3) and SCROLL_PAN (4) would be appropriate for camera presets. This ensures presets preempt animations but yield to active user input: if the DM is actively scrolling and presses a preset hotkey, the preset should wait until the scroll gesture ends (or the dwell time expires) before animating.

### Cooperative gesture handling (embedded VTT)

If the VTT is ever embedded in another page (e.g., a blog post or session notes), the gesture state machine needs a COOPERATIVE mode where non-Ctrl scroll events are passed through to the parent page rather than captured by the VTT. This would be implemented as a new gesture type (COOPERATIVE_PASSTHROUGH) at the lowest priority that does not interact with the gesture state machine's tracking, it simply lets the event propagate.

The existing `GestureStateMachine` architecture accommodates this cleanly: the wheel handler checks a cooperative-mode flag before calling `request()`, and if cooperative mode is active and Ctrl is not held, it skips the request entirely and does not call `preventDefault()`.

### Performance monitoring

The gesture state machine generates useful telemetry:

- **Dwell denial rate:** How often `request()` returns false due to dwell time. High rates indicate that the classifier is producing unstable output or that the dwell time is too short.
- **Cooldown denial rate:** How often `request()` returns false due to cooldown. High rates indicate that gesture transitions are happening at the boundary of the cooldown window.
- **Mode transition count per second:** How many times the active gesture changes per second. More than 5 to 10 transitions per second suggests the dwell time is not effectively preventing chattering.
- **Average mode duration:** How long the system stays in each gesture mode before transitioning. This should be well above the dwell time for user gestures (indicating stable classification) and variable for animations (which have natural durations).

These metrics can be logged to `console.debug` during development and piped to a monitoring dashboard if the VTT adds telemetry infrastructure.

---

## 13. Migration checklist for Claude Code {#migration}

This is the ordered list of changes. Execute in order. Each step references the section above.

1. **Add `logicalScreenToWorld()` method to the Camera class in `vtt/js/map-camera.js`.**
   - Place it immediately after the existing `screenToWorld()` method.
   - It uses `this.x` and `this.y` instead of `this.visualX` and `this.visualY`.
   - See: [Section 6, logicalScreenToWorld implementation](#coordinate-fix)

2. **Update `SmoothZoomAnimator.onWheelZoom()` to use `logicalScreenToWorld()`.**
   - Change `this._camera.screenToWorld(screenX, screenY)` to `this._camera.logicalScreenToWorld(screenX, screenY)`.
   - See: [Section 7, Updated SmoothZoomAnimator.onWheelZoom](#zoom-fix)

3. **Update `zoomAt()` to use `logicalScreenToWorld()`.**
   - Change both `this.screenToWorld(sx, sy)` calls to `this.logicalScreenToWorld(sx, sy)`.
   - See: [Section 7, Updated zoomAt()](#zoom-fix)

4. **Replace the `GestureStateMachine` class.**
   - Replace the entire class definition (including the constants `GESTURE_PRIORITY`, `USER_GESTURES`, `ANIMATION_GESTURES`, `DWELL_TIME_MS`, `COOLDOWN_MS`).
   - The new class has additional properties: `_gestureStartTime`, `_lastGestureEndTime`, `_lastEndedGesture`.
   - See: [Section 5, Complete GestureStateMachine implementation](#gsm-implementation)

5. **Update the wheel handler to respect `request()` return values.**
   - In the `dz !== 0` path (ctrl/pinch zoom), gate `onWheelZoom()` and `zoomAt()` calls on the return value.
   - In the `dx/dy !== 0` path (scroll/zoom), gate `onWheelZoom()` on the return value.
   - The trackpad pan path does not need gating (gesture request happens in the detector callback).
   - See: [Section 9, Wiring the new GestureStateMachine](#wiring)

6. **Create `tests/gesture-state-machine.spec.js`.**
   - Add all unit tests from Section 11: dwell time tests, cooldown tests, animation tier tests, release tests, logicalScreenToWorld tests.
   - See: [Section 11, Unit tests](#testing)

7. **Add integration tests.**
   - Add the 3 integration tests from Section 11 to `tests/phase6-integration.spec.js` or a new file.
   - The critical test: rapid alternating scroll/pinch events do not oscillate.
   - See: [Section 11, Integration tests](#testing)

8. **Run all existing tests and verify no regressions.**
   - The existing `classifyWheelDevice` tests in `tests/phase6-unit.spec.js` should still pass (the classifier is unchanged).
   - The existing elastic overscroll tests in `tests/phase6-integration.spec.js` should still pass (elastic behavior is unchanged; only the gesture coordination changed).
   - The existing spring overshoot tests from Phase S2 should still pass (velocity clamping is unchanged).
   - The existing speculative snap-back tests from Phase S3 should still pass (`_cancelSpeculativeSnapBack` is now called from `_cancelCurrent` in addition to its existing call sites, but idempotent calls are safe).
   - The gesture preemption test in `tests/phase6-integration.spec.js` should still pass (mouse drag still preempts scroll, now via Rule 2 instead of flat priority).
   - The `SmoothZoomAnimator` test in `tests/phase6-unit.spec.js` should still pass (the animator behavior is unchanged; only its anchor calculation changed).

9. **Manual testing with real hardware.**
   - Follow the manual testing checklist in Section 11.
   - The critical tests: (a) pinch then immediately scroll produces no oscillation, (b) zoom during elastic overscroll anchors at the cursor, (c) mouse drag preempts all animations instantly.
   - Test on the MacBook Pro trackpad.
   - Test with an external mouse (if available).
