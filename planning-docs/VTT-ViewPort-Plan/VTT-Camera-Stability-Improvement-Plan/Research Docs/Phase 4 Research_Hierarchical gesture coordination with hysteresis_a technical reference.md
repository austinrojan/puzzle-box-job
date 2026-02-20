# Hierarchical gesture coordination with hysteresis: a technical reference

**The key to preventing gesture mode chattering lies in applying control theory patterns—Schmitt trigger hysteresis, minimum dwell time, and bumpless transfer—to a hierarchical state machine architecture.** Production canvas apps like Mapbox GL JS, tldraw, and Figma each solve this differently, but the underlying principles converge: separate entry/exit thresholds, enforce minimum time between mode transitions, and always preserve position and velocity continuity across transitions. This report synthesizes findings from production canvas applications, mobile gesture systems (Flutter and iOS), control theory, animation libraries, fighting game input systems, and browser API constraints into concrete implementation guidance for a VTT camera system.

---

## 1. How production canvas apps coordinate concurrent gestures

Production whiteboard and map applications reveal three dominant architectural patterns for gesture coordination, each with distinct tradeoffs.

**Mapbox GL JS uses a handler-manager aggregation pattern.** After a major refactor (PR #9365, April 2020), Mapbox rebuilt its gesture system around independent handler classes (`ScrollZoomHandler`, `DragPanHandler`, `TouchZoomRotateHandler`, etc.) coordinated by a centralized `HandlerManager`. Each handler independently reports whether it is active and returns `HandlerResult` objects containing `panDelta`, `zoomDelta`, `bearingDelta`, and `pitchDelta`. The manager merges results from all active handlers into a single camera update per frame, enabling simultaneous pinch-zoom + pan + rotate. Key constants from `scroll_zoom.js`:

| Constant | Value | Purpose |
|----------|-------|---------|
| `wheelZoomDelta` | **4.000244140625** | Identifies discrete mouse wheel ticks |
| Default zoom rate (trackpad) | **1/100** | Scale factor per pixel of deltaY |
| Mouse wheel zoom rate | **1/450** | Slower rate for discrete ticks |
| `maxScalePerFrame` | **2** | Upper bound prevents jarring jumps |
| Trackpad detection | `abs(timeDelta × value) < 200` | Heuristic threshold |
| Event accumulation window | **~40ms** | Debounce for consecutive wheel events |

Mapbox's trackpad-vs-wheel detection works by checking whether `Math.abs(timeDelta * value) < 200`—if true, the input is classified as trackpad; otherwise, it's a discrete mouse wheel. A **40ms debounce window** accumulates consecutive wheel events to prevent chattering between modes.

**tldraw uses a hierarchical state chart built on `StateNode` classes.** This is the most formally structured approach among open-source canvas apps. Events dispatch from the root state node downward through a parent→child hierarchy, and transitions at any level halt propagation, preventing conflicting gesture handlers from both firing. The `InputsManager` (refactored in PR #5673) uses reactive atoms for all input state. For wheel behavior, tldraw offers `'pan'`, `'zoom'`, and a proposed `'auto'` mode that detects horizontal scroll → trackpad → pan, or middle mouse button → mouse → zoom. Notable thresholds include a **snap threshold of 8 screen pixels** and a **500ms debounce** for URL updates.

**Excalidraw takes a monolithic event-driven approach** centered on `App.tsx` with a `gesture.ts` utility module. It relies on the browser's `ctrlKey` convention for pinch detection and Safari's `GestureEvent` API. In pen mode, touch-zooming is disabled entirely to prevent palm-triggered zoom—a pragmatic alternative to sophisticated disambiguation. **Miro uses explicit navigation modes** (Mouse, Trackpad, Touchscreen) rather than auto-detection, which sidesteps the disambiguation problem entirely at the cost of requiring users to select the correct mode.

**Figma's C++/WASM architecture** handles input processing in compiled code with game-engine-level performance. While their gesture internals aren't public, the architecture means their input loop runs with frame-budget awareness and avoids JavaScript overhead entirely.

The cross-cutting anti-chattering techniques across all these systems are: time-based debounce windows (Mapbox's 40ms), max delta per frame capping (Mapbox's `maxScalePerFrame = 2`), hierarchical state transitions that prevent re-entry (tldraw), explicit mode locking (Miro), and easing functions for zoom smoothing.

---

## 2. Flutter's gesture arena: competitive disambiguation

Flutter's `GestureArena` implements a **competitive evidence-accumulation model** where exactly one recognizer wins per pointer. The architecture flows: `PointerDownEvent` → hit test → each affected `GestureRecognizer` registers via `GestureArenaManager.add(pointer, member)` → recognizers subscribe to future events via `PointerRouter` → recognizers accumulate evidence and either claim victory or withdraw → arena resolves to a single winner.

The arena resolves using three rules. First, **self-elimination**: a recognizer can reject itself at any time (e.g., horizontal drag sees too much vertical movement), and if only one member remains, it wins automatically—the "last gesture standing" pattern. Second, **declaration of victory**: a recognizer can declare itself the winner when its evidence threshold is met, causing all others to lose. Third, **forced sweep**: after `PointerUpEvent`, if no winner is determined, `sweep()` gives the win to the first member added.

**Slop thresholds prevent premature gesture commitment.** These are the specific pixel values from `constants.dart`:

| Constant | Value | Purpose |
|----------|-------|---------|
| `kTouchSlop` | **18.0 logical px** | Distance before drag/scroll confirmed (not tap) |
| `kPanSlop` | **36.0 logical px** | Distance for pan confidence (2× touchSlop) |
| `kScaleSlop` | **18.0 logical px** | Distance for scale gesture confidence |
| `kDoubleTapSlop` | **100.0 logical px** | Max distance between 1st and 2nd tap positions |
| `kPrecisePointerHitSlop` | **1.0 logical px** | Slop for mice/trackpads |
| `kPrecisePointerPanSlop` | **2.0 logical px** | Pan slop for mice/trackpads |

Timing constants are equally critical: `kPressTimeout` = **100ms**, `kLongPressTimeout` = **500ms**, `kDoubleTapTimeout` = **300ms**, `kDoubleTapMinTime` = **40ms** (anti-bounce), `kMinFlingVelocity` = **50.0 logical px/sec**, `kMaxFlingVelocity` = **8000.0 logical px/sec**.

The `GestureArenaTeam` class groups recognizers to compete as a unit. Without a captain, once all unaffiliated recognizers reject, the first team member wins automatically. The `Slider` widget uses this pattern—its team contains `HorizontalDragGestureRecognizer` + `TapGestureRecognizer`, and drag wins immediately when outside competitors leave, without waiting for the slop threshold.

For a VTT camera system, the key takeaway is the **evidence accumulation model**: don't commit to a gesture type immediately. Accumulate distance and velocity data, and let recognizers compete until one crosses its confidence threshold. The slop threshold approach—requiring **18px of movement** before distinguishing drag from tap—translates directly to requiring accumulated evidence before committing to scroll vs. zoom.

---

## 3. iOS gesture recognizer coordination via delegate methods and failure chains

iOS uses a fundamentally different philosophy from Flutter: **multiple recognizers can be active simultaneously**, enabled by a delegate-based coordination model. The `UIGestureRecognizer` state machine has states: `.possible` → `.began` → `.changed` → `.ended`/`.cancelled`/`.failed`, where moving quickly to `.failed` is critical because it frees other waiting recognizers.

**`shouldRecognizeSimultaneouslyWith:`** is the core coordination mechanism. By default, only one gesture recognizer is active per view (the method returns `false`). When a recognizer transitions to `.began`, competitors are forced to `.failed`. Returning `true` allows both recognizers to be in `.began`/`.changed` states simultaneously—essential for Apple Maps-style pan+pinch+rotate. Only one side needs to return `true` for both to proceed.

**`require(toFail:)` creates dependency chains** that form a directed acyclic graph of priorities. The classic pattern: `singleTap.require(toFail: doubleTap)` means single-tap stays in `.possible` until double-tap transitions to `.failed`. This creates a priority hierarchy where higher-specificity gestures get first chance:

```
Double Tap (must fail first) → Single Tap (must fail first) → Long Press
```

**UIScrollView's internal coordination** runs pan and pinch simultaneously by default when zooming is enabled. The scroll view acts as its own gesture delegate internally and uses `delaysTouchesBegan` to buffer touches until recognition succeeds. For a VTT system, the key patterns are: use `require(toFail:)` semantics to let ZOOM_ANIMATE complete before allowing new DRAG_PAN, and allow DRAG_PAN and PINCH_ZOOM to operate simultaneously by aggregating their deltas.

Known iOS timing values: `minimumPressDuration` = **0.5s** for long press, `allowableMovement` = **10 points**, double-tap timeout ≈ **0.35s**, and swipe minimum distance ≈ **16 points**.

---

## 4. Control theory patterns that directly prevent gesture chattering

Four control theory concepts map precisely to gesture coordination problems, providing mathematical foundations for the heuristic patterns used in production systems.

### Chattering and the boundary layer approach

In sliding mode control, **chattering** is high-frequency oscillation around the switching surface (the decision boundary between control modes). It occurs because parasitic dynamics—sensor delays, computation time—prevent instantaneous switching, causing the system to overshoot, switch, overshoot again. In a VTT system, this manifests as rapidly alternating between SCROLL_PAN and PINCH_ZOOM when `deltaY` hovers near the detection threshold.

The foundational fix replaces a hard threshold with a **boundary layer**—a continuous transition zone. Instead of `u = -K·sign(s)`, use `u = -K·sat(s/Φ)` where Φ is the boundary layer thickness. For gesture systems, this means maintaining the current mode when the signal is between the entry and exit thresholds.

### Schmitt trigger hysteresis eliminates threshold oscillation

A Schmitt trigger uses **two distinct thresholds**: an upper trip point (UTP) for entering a mode and a lower trip point (LTP) for exiting. The gap between them is the hysteresis band. Once a transition occurs, the signal must travel the full hysteresis width in the opposite direction before the reverse transition fires. This creates a "committed" zone.

For gesture mode selection, the implementation pattern is:

```javascript
const ZOOM_ENTER_THRESHOLD = 5;   // px deltaY to enter zoom (upper trip)
const ZOOM_EXIT_THRESHOLD = 2;    // px deltaY to exit zoom (lower trip)
const ZOOM_EXIT_HOLD_MS = 200;    // temporal hysteresis dimension

// Entry: must exceed 5px deltaY with ctrlKey
// Exit: must fall below 2px for 200ms, OR ctrlKey released
// Between 2–5px: maintain current mode (hysteresis band)
```

The entry/exit ratio should be **2:1 to 3:1** for gesture inputs (enter at 5px, exit at 2px). Adding temporal hysteresis—requiring the exit condition to persist for a minimum duration—provides a second dimension of noise rejection.

### Minimum dwell time prevents Zeno behavior

**Dwell time** (τ_D) is the minimum interval between consecutive switching events. Without it, systems can exhibit **Zeno behavior**—infinitely many transitions in finite time—causing instability even when all individual subsystems are stable. The key theorem: a switched linear system with all stable subsystems is globally uniformly asymptotically stable if dwell time τ_D is sufficiently large.

Recommended dwell times for VTT gesture modes, calibrated against human perception research:

| Mode | Dwell Time | Rationale |
|------|-----------|-----------|
| SCROLL_PAN | **32ms** (~2 frames) | Scrolling must feel native |
| DRAG_PAN | **50ms** (~3 frames) | Panning should feel instant |
| PINCH_ZOOM | **80ms** (~5 frames) | Commitment once 2 fingers detected |
| INERTIA | **100ms** (~6 frames) | Interruptible but not flickery |
| ZOOM_ANIMATE | **150ms** (~9 frames) | Let animation establish before interrupting |
| SNAP_BACK | **200ms** (~12 frames) | Animation should be clearly committed |

Human perception thresholds supporting these values: **~6ms** minimum perceivable latency for direct touch, **~40ms** temporal window for perceived simultaneity, **70–100ms** visual response latency, and **~200ms** onset of conscious perception markers.

### Bumpless transfer maintains continuity across mode transitions

In process control, **bumpless transfer** prevents sudden discontinuities when switching between operating modes. For gesture transitions, the critical application is switching from INERTIA to DRAG_PAN: if the new mode starts from rest (v=0), the camera jerks to a stop. The solution is **"current state initialization"**—always read the current position and velocity and use them as initial conditions for the new mode:

```javascript
transitionTo(newMode, event) {
  const snapshot = {
    position: { ...this.state.position },
    velocity: { ...this.state.velocity },
    scale: this.state.scale,
    timestamp: performance.now(),
  };
  this.currentModeHandler.onExit(snapshot);
  this.currentModeHandler = this.modes[newMode];
  this.currentModeHandler.onEnter(snapshot, event);
}
```

Spring animations are the only animation type that inherently maintains both position and velocity continuity during interruption. As Apple stated in WWDC 2023: "Springs are the only type of animation that maintains continuity both for static cases and cases with an initial velocity."

---

## 5. Apple's fluid interface principles and the velocity handoff pattern

The WWDC 2018 "Designing Fluid Interfaces" talk (Session 803, presented by Chan Karunamuni, Nathan de Vries, and Marcos Alonso) established eight principles: instant response, constant redirection and interruption, spatial consistency, hint in direction of gesture, lightweight interactions with amplified output, soft boundaries (rubberbanding), smooth dynamic behavior, and behavior over animation.

**The "current value, current velocity" handoff pattern** is the core mechanism for seamless animation interruption. When a new animation target is set, the system reads the current position and current velocity and uses them as initial conditions for the new animation. Springs make this natural because they're defined by differential equations that take initial conditions, not time-based curves. You can change the target at any point and the spring equation naturally produces smooth, continuous motion. The talk demonstrated this with iPhone X gestures: launching an app, then swiping home mid-launch, then going to multitasking—each interruption reads current state and starts a new spring.

**Acceleration detection for intent recognition** is a key insight from the talk. Rather than using timers to detect pauses, iOS monitors the derivative of velocity (acceleration). A spike in deceleration indicates the user stopped abruptly: "There's a huge spike in the acceleration of your finger when you pause. And actually the faster you stop, the faster we can detect it." For endpoint prediction, iOS uses **momentum projection**: `projectedPosition = currentPosition + currentVelocity × decayConstant` to determine which snap target to animate toward.

**`UIViewPropertyAnimator`** (iOS 10+) implements these principles with scrubbing via `fractionComplete`, pausing via `pauseAnimation()`, resuming via `continueAnimation(withTimingParameters:durationFactor:)`, and reversing via `isReversed = true`. The interactive pattern is: gesture began → pause any running animation and capture `fractionComplete`; gesture changed → scrub `fractionComplete` with gesture; gesture ended → set `isReversed` if needed, then continue with spring timing parameters.

The talk explicitly warns against "fire and forget" timed animations: "Things in the real world are always in a state of dynamic motion... There's no animation curve prescribed by real life." For the VTT system, this means all animated transitions (ZOOM_ANIMATE, INERTIA, SNAP_BACK) should use spring dynamics, never easing curves, because springs are inherently interruptible.

---

## 6. Animation interruption in React Spring and Framer Motion

**React Spring** achieves bumpless interruption through its `SpringValue` class. When a spring receives a new target, it reads the current animated position and current velocity (tracked as `lastVelocity` per frame) and starts a new spring simulation from `{from: currentPosition, velocity: currentVelocity, to: newTarget}`. There is no stop/start cycle—the simulation seamlessly retargets. Default config values: `tension: 170`, `friction: 26`, `mass: 1`, `precision: 0.01`. The spring physics per frame:

```javascript
const displacement = currentPosition - toPosition;
const springForce = -tension * displacement;
const dampingForce = -friction * currentVelocity;
const acceleration = (springForce + dampingForce) / mass;
currentVelocity += acceleration * timeStep;
currentPosition += currentVelocity * timeStep;
```

A known pain point: using `immediate: true` for 1:1 gesture tracking breaks velocity calculation, making momentum after gesture release incorrect.

**Framer Motion** (now Motion) uses `MotionValue` to track state and velocity. `getVelocity()` returns velocity in units per second to normalize for frame rate variations. Wildcard keyframes (`[null, 100, 200]` where `null` means "start from current value") enable natural interruption. The `glide` easing automatically passes velocity from running animations. The `inertia` animation type handles gesture release with configurable `power` (0.8), `timeConstant` (350ms), boundary spring (`bounceStiffness: 500`, `bounceDamping: 10`), and `modifyTarget` for snap-to-grid.

For a vanilla JS Canvas implementation, the recommended spring constants by feel are: snappy UI response (stiffness ~300, damping ~30), bouncy feedback (stiffness ~200, damping ~10), heavy/weighty feel (mass ~3–5, stiffness ~100), and the critical principle: **never reset velocity on interruption**.

---

## 7. WheelEvent limitations and production workarounds

The W3C proposal for `WheelEvent.isInertialScrolling` (GitHub issues #56 and #58 on w3c/uievents) remains **open with no implementation** in any browser as of 2026. The proposal has 26+ thumbs-up reactions but no browser vendor has committed. A separate issue (#337) requesting trackpad-vs-mouse device identification is also unresolved.

The fundamental problem: all of these produce identical `WheelEvent` objects—mouse wheel scroll, trackpad two-finger scroll, trackpad pinch-to-zoom (`ctrlKey: true`), and inertial momentum scrolling. The only disambiguation signals available are delta magnitude patterns, event timing, and the `ctrlKey` flag.

**Distinguishing real Ctrl+wheel from synthetic pinch-zoom** requires tracking physical key state:

```javascript
let realCtrlDown = false;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Control') realCtrlDown = true;
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'Control') realCtrlDown = false;
});
canvas.addEventListener('wheel', (e) => {
  if (e.ctrlKey && !realCtrlDown) {
    // Trackpad pinch-to-zoom gesture
  } else if (e.ctrlKey && realCtrlDown) {
    // Physical Ctrl + scroll wheel
  } else {
    // Normal scroll
  }
});
```

**Important caveat**: this only works on macOS. On Windows, trackpad drivers send actual WM_MOUSEWHEEL with Ctrl state set at the driver level.

**Inertial scrolling detection** relies on heuristics. The Lethargy library (571+ stars) maintains a rolling buffer of recent deltaY values and checks for decreasing magnitudes. Key heuristic values used in production: time gap threshold of **80–150ms** (larger = new gesture), decreasing delta ratio **< 0.9–0.95** of previous, **3–5 consecutive** decreasing events before declaring inertial, minimum delta of **0.5–2px** (below = tail of inertia), and end gap of **40–100ms** without events.

**Cross-browser wheel normalization** is essential. Firefox with an external mouse fires `deltaY: ±1` with `deltaMode: DOM_DELTA_LINE`, while Chrome fires `deltaY: ±100` with `deltaMode: DOM_DELTA_PIXEL`. Facebook's normalize-wheel library (476K weekly downloads) uses constants: `PIXEL_STEP = 10`, `LINE_HEIGHT = 40`, `PAGE_HEIGHT = 800`.

**Safari's GestureEvent API** provides lifecycle events (`gesturestart`, `gesturechange`, `gestureend`) with cumulative `scale` and `rotation` values—far richer than Chrome's ctrl+wheel approach. However, Safari now also fires ctrl+wheel events for pinch gestures, requiring deduplication. The unified handling pattern must register both GestureEvent listeners (Safari) and wheel listeners (all browsers) with conditional dedup.

---

## 8. Coordinate contamination and the three-layer camera architecture

Coordinate contamination occurs when elastic/rubber-band visual offsets leak into zoom calculations, causing the zoom focal point to drift from the cursor position. If the elastic offset (+50px) is included in the screen-to-world coordinate transform during zoom, the cursor maps to a shifted world position.

The architectural solution is a **three-layer camera separation**:

```
┌─────────────────────────────────────┐
│  RENDERING LAYER (visual)           │
│  visual = logical + elastic +       │
│           animation offsets          │
├─────────────────────────────────────┤
│  EFFECTS LAYER (transient)          │
│  elastic offsets, animation tweens  │
│  NEVER used for coordinate math     │
├─────────────────────────────────────┤
│  LOGICAL LAYER (source of truth)    │
│  camera position, zoom, rotation    │
│  Used for: zoom-at-cursor,          │
│    hit testing, serialization       │
└─────────────────────────────────────┘
```

**Zoom-at-cursor must always use the logical camera** for screen-to-world conversion:

```javascript
function zoomAtCursor(screenX, screenY, zoomDelta) {
  // Use ONLY logical state — never visual
  const worldX = (screenX - camera.logical.x) / camera.logical.zoom;
  const worldY = (screenY - camera.logical.y) / camera.logical.zoom;
  const newZoom = clamp(camera.logical.zoom * zoomDelta, MIN_ZOOM, MAX_ZOOM);
  camera.logical.x = screenX - worldX * newZoom;
  camera.logical.y = screenY - worldY * newZoom;
  camera.logical.zoom = newZoom;
}
```

For elastic overscroll, pan constraints split overflow: logical gets clamped to bounds, elastic gets the remainder multiplied by a **resistance factor of 0.3**. Elastic offsets recover via spring with **stiffness 0.15** and **damping 0.85** per frame, snapping to zero when below **0.01px** (position) or **0.001** (zoom multiplier). The rendering layer computes the visual transform as `logical + elastic` every frame. The rules are absolute: never read back from visual into the input system, always use logical for coordinate transforms and hit testing, and let elastic effects animate back to zero independently when a gesture ends.

tldraw implements this with separate `screenPoint` and `pagePoint` coordinate spaces, with camera constraints that clamp the logical camera while layering animations on top. Mapbox GL JS uses a `Transform` class as the source of truth, with `project()`/`unproject()` operating exclusively on logical state.

---

## 9. Fighting game input buffering maps directly to gesture disambiguation

Fighting games solve a structurally identical problem: disambiguating overlapping input sequences under real-time constraints. Their solutions translate remarkably well to gesture systems.

**Buffer windows across production fighting games** center on **50–180ms**:

| Game | Buffer Type | Frames | Milliseconds |
|------|-----------|--------|-------------|
| Street Fighter 6 | Quarter-circle motion | **11f** | **~183ms** |
| Street Fighter V | Normal attack | **3f** | **~50ms** |
| Tekken 7/8 | Attack input | **8f** | **~133ms** |
| Tekken 7/8 | Sidestep | **15f** | **~250ms** |
| Guilty Gear Strive | Universal | **3f** | **~50ms** |
| Smash Bros. Ultimate | Universal | **9f** | **~150ms** |

The core algorithm **scans backwards through an input buffer** from the moment a button is pressed, checking each direction in the motion definition against a per-direction buffer window. SF6 polls inputs **3× per frame** for sub-frame precision. Street Fighter IV accepts **27 different valid input sequences** for a Dragon Punch—equivalent to ±45° tolerance on each directional input.

**Priority resolution when multiple gestures match** follows a specificity-first hierarchy. SF6's order: Taunt > OD Specials > Super Arts > Drive Impact > Throw > Drive Parry > 360 Motion > Dragon Punch > Quarter Circle > Half Circle > Command Normals > Normals. The key principles are: more complex motions take priority, resource-consuming moves are prioritized, and game state gates which moves can even be checked (grounded vs. airborne).

**Option selects**—inputs that produce different outcomes depending on state—map directly to context-dependent gestures. The same wheel event means "scroll" normally, "zoom" with Ctrl, or "rotate" with Shift. The same two-finger gesture means scroll in a document, pan on a canvas, or zoom with modifier keys.

For the VTT system, recommended buffer sizes based on fighting game evidence: **50–80ms** initial gesture classification delay (matches Guilty Gear/SFV 3-frame buffer), **80–120ms** scroll-vs-zoom disambiguation, **100–150ms** pan-vs-drag-select disambiguation, **30–50ms** scroll direction lock, and **200–300ms** gesture completion timeout. The critical principle is **commit and lock**: once a gesture is classified, don't reclassify mid-gesture, mirroring the "consumed" flag in fighting games.

---

## 10. Integrated architecture for the VTT camera system

Combining all patterns yields a gesture coordinator that layers Schmitt trigger hysteresis, minimum dwell time, and bumpless transfer within a hierarchical state machine:

```javascript
class VTTGestureCoordinator {
  processEvent(event) {
    const candidateMode = this.detectCandidateMode(event);
    
    // 1. DWELL TIME CHECK — prevent Zeno behavior
    if (!this.canTransition(candidateMode)) return;
    
    // 2. HYSTERESIS CHECK — Schmitt trigger thresholds
    if (!this.hysteresisAllows(candidateMode, event)) return;
    
    // 3. BUMPLESS TRANSFER — preserve position + velocity
    if (candidateMode !== this.currentMode) {
      const snapshot = {
        position: { ...this.state.position },
        velocity: { ...this.state.velocity },
        scale: this.state.scale,
        timestamp: performance.now(),
      };
      this.modes[this.currentMode].onExit(snapshot);
      this.currentMode = candidateMode;
      this.lastTransitionTime = performance.now();
      this.modes[candidateMode].onEnter(snapshot, event);
    }
    
    // 4. UPDATE — process event within current mode
    this.modes[this.currentMode].update(event, this.state);
  }
}
```

The gesture priority hierarchy should be: SNAP_BACK (highest, system-driven) > ZOOM_ANIMATE > PINCH_ZOOM > DRAG_PAN > SCROLL_PAN > INERTIA (lowest, can always be interrupted). All animated transitions (ZOOM_ANIMATE, INERTIA, SNAP_BACK) must use spring dynamics with the "current value, current velocity" handoff. The camera must maintain strict logical/visual separation with elastic effects applied only at the rendering layer. And WheelEvent disambiguation should use the Ctrl key state tracking pattern with Lethargy-style decreasing-delta heuristics for inertial detection, wrapped in a fighting-game-style input buffer that accumulates 50–80ms of evidence before committing to a gesture classification.

## Conclusion

The central insight across all these systems is that **gesture coordination is fundamentally a switching control problem**, and the same stability guarantees that prevent chattering in industrial control systems prevent mode oscillation in UI. The Schmitt trigger pattern (2:1 entry/exit ratio), minimum dwell time (32–200ms depending on mode), and bumpless transfer (snapshot position + velocity on every transition) form a mathematically grounded foundation. Flutter's evidence accumulation model and fighting game input buffering both converge on the same idea: accumulate 50–150ms of evidence in a rolling buffer before committing to a gesture type, then lock that classification until the gesture completes. The three-layer camera architecture (logical → effects → visual) prevents coordinate contamination, and spring-based animations ensure every transition is interruptible with velocity continuity. These aren't heuristic patches—they're applications of well-established control theory to a domain where they fit precisely.