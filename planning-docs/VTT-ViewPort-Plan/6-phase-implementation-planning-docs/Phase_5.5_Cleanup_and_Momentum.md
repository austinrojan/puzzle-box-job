# Phase 5.5: Cleanup, momentum panning, and cross-window fidelity fixes

**This guide closes the loose ends left open between Phases 2 through 5: it exposes a public `syncEngine.sendNow()` API that eliminates private property access from Controller button handlers, adds inertial momentum panning by feeding drag-release velocity into the Phase 3 spring system, fixes the test fidelity gap where Playwright cross-window tests pass without exercising the `sendImmediate()` code path that real users depend on, validates the cover zoom gap that exists between the Controller's headless viewport floor (1.0) and the Display's actual floor (~0.664), and adds a `VIEWPORT_REPORT` message that lets the Controller learn the Display's real dimensions for a true "fit to Display viewport" command.** Each of these items was identified during Phase 4 manual testing or flagged as a forward reference in earlier phase documents. None of them were picked up by Phase 5 because they are not new features; they are infrastructure hygiene, test hardening, and the completion of work that earlier phases explicitly deferred.

The architectural centerpiece is the **velocity tracker**: a lightweight ring buffer that samples the last N mousemove events during a pan drag, computes a release velocity on mouseup, and feeds it into the `CameraAnimator.snapBack()` velocity parameter that Phase 3 stubbed at `{ vx: 0, vy: 0 }`. The velocity tracker is five lines of state and one formula, but it transforms how map panning feels. Every mapping application (Google Maps, Apple Maps, Figma, tldraw) has inertial panning. Its absence in the VTT is the single most noticeable tactile gap between the camera system and the tools DMs are accustomed to.

The guide is structured as a walkthrough you can hand directly to Claude Code. Each section explains what the code does and why, provides the complete implementation, calls out interactions with existing modules, and includes testing protocols. Read it front to back before changing anything. The order matters.

---

## Table of contents

1. [What Phase 5 established and what Phase 5.5 changes](#1-what-phase-5-established-and-what-phase-55-changes)
2. [The sendNow() public API: eliminating private property access](#2-the-sendnow-public-api)
3. [Momentum panning: velocity tracking and inertial release](#3-momentum-panning)
4. [Cover zoom gap validation for presets and flyTo targets](#4-cover-zoom-gap-validation)
5. [VIEWPORT_REPORT: sharing Display dimensions with the Controller](#5-viewport-report)
6. [Protocol additions to shared/protocol.js](#6-protocol-additions)
7. [CSS changes](#7-css-changes)
8. [Testing protocols](#8-testing-protocols)
9. [Migration checklist](#9-migration-checklist)
10. [What Phase 6 expects from this foundation](#10-phase-6-expectations)

---

## 1. What Phase 5 established and what Phase 5.5 changes

### The Phase 5 foundation

Phase 5 delivered cinematic camera features and infrastructure upgrades on top of Phase 4's continuous sync. The methods and infrastructure that Phase 5.5 depends on:

```javascript
// Camera sync engine (vtt/js/camera-sync.js)
CameraSyncEngine                  // orchestrator: role-based initialization
CameraBroadcaster                 // rAF-aligned 30fps state streaming
  .sendImmediate()                // force a sync message bypassing rAF throttle
  .sendJumpTo(cx, cy, zoom)      // instant teleport command
  .sendFlyTo(target, opts)       // cinematic flyTo command
CameraReceiver                    // sequence-numbered message handling

// Camera animator (vtt/js/camera-animator.js)
CameraAnimator                    // flyTo + interrupt handling
  .flyTo(target, opts)
  .cancel()

// Camera presets (vtt/js/camera-presets.js)
CameraPresetManager               // save/recall named positions
  .save(slot, sharedState)
  .recall(slot)                   // triggers flyTo to preset position

// Spring snap-back (vtt/js/map-camera.js)
CameraAnimator (Phase 3)          // critically damped spring
  .snapBack(current, target, velocity = { vx: 0, vy: 0 })

// Center-point conversion (shared/protocol.js)
localToShared(camera, viewport)   // → { centerX, centerY, zoom }
sharedToLocal(shared, viewport)   // → { x, y, zoom }
```

Phase 5's key architectural properties:

1. The `CameraSyncEngine` exposes a `get broadcaster()` getter, and Controller button handlers call `syncEngine.broadcaster.sendImmediate()` (reaching into the private `_broadcaster` property).
2. The Phase 3 `CameraAnimator.snapBack()` accepts a `velocity` parameter but all callers pass `{ vx: 0, vy: 0 }` (the default).
3. Preset recall and flyTo send zoom values computed from the Controller's headless 1920×1080 viewport. The Display accepts these values because they are above its own coverZoom floor.
4. The Controller has no knowledge of the Display's actual viewport dimensions.
5. Playwright tests for cross-window sync call `camera.zoomToCenter()` directly rather than clicking DOM buttons, so they never exercise `sendImmediate()`.

### What Phase 5.5 changes

Phase 5.5 makes five targeted fixes to this foundation:

1. **Exposes `syncEngine.sendNow()` as a public API.** A one-line delegation method on `CameraSyncEngine` that calls `this._broadcaster.sendImmediate()`. Controller button handlers switch from `syncEngine._broadcaster.sendImmediate()` to `syncEngine.sendNow()`. This eliminates the private property chain and provides the clean API that the Phase 4 lessons document called for.

2. **Adds momentum panning with a velocity tracker.** A `VelocityTracker` class in `vtt/js/map-camera.js` samples the last 4 mousemove events during a pan drag, computes the average velocity at release, and passes it to `CameraAnimator.snapBack()`. Inside map boundaries, the velocity feeds into a free-form momentum animation that decelerates via exponential decay. At boundaries, the velocity feeds into the existing spring, producing seamless continuity between momentum and snap-back.

3. **Fixes the test fidelity gap for `sendImmediate()`.** Adds dedicated Playwright tests that click actual Controller DOM buttons and verify that sync messages arrive on the camera channel. This exercises the real `sendImmediate()` code path instead of relying on Playwright's non-throttled rAF.

4. **Validates the cover zoom gap (0.664 to 1.0 range).** Adds a validation guard in the Display's `CameraReceiver` and in `camera.deserialize()` that ensures incoming zoom values are clamped to the local `_coverZoom` floor. Also adds unit tests that explicitly verify the gap is handled for preset recall and flyTo targets.

5. **Adds a `VIEWPORT_REPORT` message.** The Display periodically reports its actual `viewportW` and `viewportH` to the Controller (on connect and on resize). The Controller stores these dimensions so that a future "fit to Display viewport" command can compute the Display's real coverZoom rather than using the Controller's headless 1920×1080 values.

Phase 5.5 does **not** modify the flyTo algorithm, the preset storage system, the ISyncTransport abstraction, the authority election protocol, or the semantic zoom controller. Those all remain as Phase 5 left them. The changes are surgical: a public API method, a velocity tracker, a message type, test hardening, and a validation guard.

---

## 2. The sendNow() public API

### Why this matters

Phase 4 manual testing (Lesson #1) revealed that `requestAnimationFrame` does not fire in background Chrome tabs. The Controller tab is always in the background during a session because the DM looks at the DM Guide, not the Controller. Button handlers that relied on the rAF render loop to broadcast `CAMERA_SYNC` messages were completely non-functional in production.

The fix (commit `022d6ae`) added `sendImmediate()` calls after each button click handler. But the integration was done through a private property chain:

```javascript
// Current pattern in controller/js/ui-builders.js (Phase 4 fix)
zoomInBtn.addEventListener('click', () => {
  camera.zoomToCenter(ZOOM_STEP_KEY);
  syncEngine._broadcaster.sendImmediate();  // private property access
});
```

The `_broadcaster` property is prefixed with an underscore precisely because it is not part of the public API. Phase 5 added `setAnimator()`, `setInterpolator()`, and other delegation methods to `CameraSyncEngine`, but `sendNow()` was missed. Every new Controller UI element that triggers a camera change (preset buttons, flyTo triggers, fit-to-tokens) copies the same private property access pattern. This is the definition of a missing public API.

### The implementation

Add a single method to `CameraSyncEngine` in `vtt/js/camera-sync.js`:

```javascript
/**
 * Force an immediate camera state broadcast, bypassing the rAF
 * throttle. Use this after any user-initiated action that changes
 * camera state and needs immediate sync (button clicks, preset
 * recall, fit-to-tokens).
 *
 * This exists because rAF does not fire in background tabs, and the
 * Controller tab is always in the background during a session. Without
 * an immediate send, button clicks update local state but never
 * broadcast the change.
 *
 * Safe to call when no broadcaster exists (e.g., Display role). The
 * method is a no-op in that case.
 */
sendNow() {
  if (this._broadcaster) {
    this._broadcaster.sendImmediate();
  }
}
```

### Updating all callers

Every call site in `controller/js/ui-builders.js` (and any other Controller-side code) that currently reaches into `syncEngine._broadcaster` must switch to the public API:

```javascript
// BEFORE (private property chain):
syncEngine._broadcaster.sendImmediate();

// AFTER (public API):
syncEngine.sendNow();
```

Search the codebase for `_broadcaster.sendImmediate` and `_broadcaster.send` to find all call sites. The expected locations are:

- **`controller/js/ui-builders.js`**: zoom-in, zoom-out, pan-up, pan-down, pan-left, pan-right, and reset button handlers
- **`controller/js/main.js`** (if any): initialization-time sync calls
- **Any Phase 5 Controller UI**: preset recall buttons, fit-to-tokens trigger, flyTo trigger

Each button handler follows the same pattern:

```javascript
// Zoom in button (representative example; all buttons are identical in structure)
zoomInBtn.addEventListener('click', () => {
  camera.zoomToCenter(ZOOM_STEP_KEY);
  syncEngine.sendNow();  // immediate broadcast, bypasses rAF
});
```

```javascript
// Reset button (slightly different: also sends a jump-to for instant Display response)
resetBtn.addEventListener('click', () => {
  camera.fitCover();
  const vp = { width: camera.viewportW, height: camera.viewportH };
  const shared = localToShared(camera, vp);
  syncEngine.broadcaster.sendJumpTo(shared.centerX, shared.centerY, shared.zoom);
  // sendNow() is not needed here because sendJumpTo() already sends immediately
});
```

### Removing the TODO

Phase 4 left a TODO comment in the codebase marking the private property access for cleanup. Remove it. The TODO is resolved by this change.

---

## 3. Momentum panning

### Why this matters for the VTT

Phase 2 explicitly deferred inertial momentum panning to Phase 5, with this rationale (Phase 2, Section 14):

> Exponential decay momentum after drag release is standard in mapping apps and mobile interfaces. For a DM-controlled presentation display, it introduces a risk: the DM releases a drag and the map glides past the intended position, potentially revealing areas they did not want players to see. This is a "nice to have" polish feature, not a core input improvement.

Phase 3 prepared the infrastructure by building the `CameraAnimator.snapBack()` method with a velocity parameter stubbed at zero and noting (Phase 3, Section 13):

> `_triggerSnapBack()` accepts initial velocity. Phase 5 adds momentum panning (inertial drag release). The velocity at release feeds into the spring's initial velocity parameter, creating seamless continuity between drag and snap-back. The `CameraAnimator.snapBack()` method already accepts a `velocity` parameter; Phase 5 just needs to compute it from the last few mousemove events and pass it through.

Phase 5 never picked this up because it focused on cinematic features (flyTo, presets, semantic zoom) and infrastructure (ISyncTransport, authority election, debug overlay). The momentum panning work belongs here.

The risk that Phase 2 flagged (map gliding past intended position) is now mitigated by Phase 3's boundary clamping. The camera cannot reveal areas past the map edges regardless of momentum, and the elastic overscroll with spring snap-back provides natural deceleration at boundaries. The remaining question is whether momentum within boundaries feels good for a DM presentation tool. The answer, validated by every mapping application in existence, is yes. Controlled, short-duration momentum (decaying to zero within 300-500ms) gives the DM a sense of physical connection to the map surface. Without it, releasing a drag feels like the map is stuck in molasses.

### The VelocityTracker class

The velocity tracker is a ring buffer of recent mouse positions and timestamps. On mouseup, it computes the average velocity over the last few samples. This is the same pattern used by iOS's UIScrollView, Android's VelocityTracker, and tldraw's `TLPointerInfo`.

Add this class to `vtt/js/map-camera.js`, after the existing `CameraAnimator` class and before the `BoundsCache` class:

```javascript
// ============================================
// Velocity Tracker — Ring Buffer for Drag Velocity
// ============================================
//
// Samples the last SAMPLE_COUNT mousemove events during a pan drag,
// computes average velocity on release. The result feeds into
// CameraAnimator.snapBack() for inertial momentum or directly into
// a free-form momentum animation within map boundaries.
//
// Why a ring buffer instead of a running average:
// - Mice can pause mid-drag. A running average would incorporate
//   the paused samples, producing near-zero velocity even if the
//   user resumed dragging quickly before release.
// - By keeping only the last 4 samples, the tracker captures the
//   velocity at the moment of release, not the average over the
//   entire drag.
//
// Why 4 samples:
// - At 60fps, 4 samples span ~66ms, roughly matching the perceptual
//   threshold for "instantaneous" velocity.
// - Fewer samples (2-3) are noisy; more samples (6+) lag behind
//   direction changes.

const VELOCITY_SAMPLE_COUNT = 4;

class VelocityTracker {
  constructor() {
    this._samples = [];  // { x, y, t }[] — ring buffer
    this._index = 0;
    this._count = 0;
  }

  /** Reset the tracker. Call on drag start. */
  reset() {
    this._samples.length = 0;
    this._index = 0;
    this._count = 0;
  }

  /**
   * Record a position sample during drag.
   * Call on every mousemove while panning.
   *
   * @param {number} x - Screen-space X position
   * @param {number} y - Screen-space Y position
   * @param {number} t - Timestamp from performance.now()
   */
  addSample(x, y, t) {
    if (this._samples.length < VELOCITY_SAMPLE_COUNT) {
      this._samples.push({ x, y, t });
    } else {
      this._samples[this._index] = { x, y, t };
    }
    this._index = (this._index + 1) % VELOCITY_SAMPLE_COUNT;
    this._count++;
  }

  /**
   * Compute the average velocity from the recorded samples.
   * Returns { vx, vy } in screen pixels per second.
   *
   * The velocity is computed from the oldest sample in the buffer
   * to the newest. This gives a stable average over the sample
   * window rather than a noisy instantaneous derivative.
   *
   * Returns { vx: 0, vy: 0 } if fewer than 2 samples exist or
   * if the time span is too short (< 8ms, protecting against
   * division by near-zero).
   */
  getVelocity() {
    const n = Math.min(this._count, VELOCITY_SAMPLE_COUNT);
    if (n < 2) return { vx: 0, vy: 0 };

    // Find oldest and newest samples in the ring buffer.
    // If the buffer is not full yet, oldest is index 0.
    // If the buffer has wrapped, oldest is this._index (the next
    // slot to be overwritten, which holds the oldest entry).
    const oldestIdx = this._count < VELOCITY_SAMPLE_COUNT
      ? 0
      : this._index;  // next overwrite position = oldest entry
    const newestIdx = (this._index - 1 + VELOCITY_SAMPLE_COUNT) % VELOCITY_SAMPLE_COUNT;

    const oldest = this._samples[oldestIdx];
    const newest = this._samples[newestIdx];

    const dt = (newest.t - oldest.t) / 1000;  // seconds
    if (dt < 0.008) return { vx: 0, vy: 0 };  // < 8ms: unreliable

    return {
      vx: (newest.x - oldest.x) / dt,
      vy: (newest.y - oldest.y) / dt,
    };
  }
}
```

### Integrating the velocity tracker into the Camera class

The Camera class needs three changes to its existing pan drag handling:

**1. Add a VelocityTracker instance and momentum constants to the constructor:**

```javascript
// In Camera constructor, alongside existing Phase 3 properties:
this._velocityTracker = new VelocityTracker();

// Momentum constants
this._momentumEnabled = true;  // DM can toggle this
```

Add module-level constants after the existing spring constants:

```javascript
// Momentum panning constants
const MOMENTUM_FRICTION = 8;         // Exponential decay rate (higher = shorter glide)
const MOMENTUM_MIN_VELOCITY = 50;    // Screen px/s: below this, no momentum applied
const MOMENTUM_MAX_VELOCITY = 4000;  // Screen px/s: cap to prevent wild flings
```

**2. Record samples during mousemove in the pan handler:**

In the `attachTo()` method, inside the existing mousemove handler that performs pan dragging, add a `VelocityTracker.addSample()` call. The existing code looks like this (from Phase 1/2):

```javascript
// Existing mousemove pan handler (inside attachTo):
window.addEventListener('mousemove', (e) => {
  if (!this._panning) return;
  const dx = e.clientX - this._lastPanX;
  const dy = e.clientY - this._lastPanY;
  this._lastPanX = e.clientX;
  this._lastPanY = e.clientY;
  this.panBy(dx, dy);
});
```

Add the velocity sample after updating `_lastPanX`/`_lastPanY`:

```javascript
// Updated mousemove pan handler:
window.addEventListener('mousemove', (e) => {
  if (!this._panning) return;
  const dx = e.clientX - this._lastPanX;
  const dy = e.clientY - this._lastPanY;
  this._lastPanX = e.clientX;
  this._lastPanY = e.clientY;

  // Record sample for momentum calculation on release
  this._velocityTracker.addSample(e.clientX, e.clientY, performance.now());

  this.panBy(dx, dy);
});
```

**3. Reset the tracker on drag start:**

In `_startPan()` (or wherever `_panning = true` is first set), add:

```javascript
_startPan(e) {
  // ... existing Phase 3 code: cancel animator, set _isDragging ...
  this._velocityTracker.reset();
  // ... rest of _startPan ...
}
```

### The momentum animation: extending CameraAnimator

The existing `CameraAnimator` handles spring snap-back for elastic overscroll. Momentum panning requires a second animation mode: free-form deceleration within map boundaries. The two modes are distinct:

- **Snap-back** (Phase 3): The camera is past a boundary. The spring pulls it back to the nearest valid position. Velocity is the drag-release velocity at the boundary.
- **Momentum** (Phase 5.5): The camera is within boundaries. The camera glides with exponential decay until velocity falls below the threshold or a boundary is reached. If a boundary is reached, the momentum transitions seamlessly into a snap-back with the remaining velocity.

Add a new method to the `CameraAnimator` class:

```javascript
/**
 * Start a momentum animation from the current camera position.
 * The camera decelerates via exponential decay. If it reaches a
 * map boundary during the glide, the momentum transitions into
 * a spring snap-back with the remaining velocity.
 *
 * @param {{ vx: number, vy: number }} velocity - Release velocity
 *   in screen pixels per second.
 */
momentum(velocity) {
  // Convert screen velocity to world velocity.
  // Screen px/s ÷ zoom = world px/s (because panBy divides by zoom).
  const zoom = this._camera.zoom;
  const worldVx = -velocity.vx / zoom;  // negative: screen drag right = camera moves left
  const worldVy = -velocity.vy / zoom;

  this._momentumVx = worldVx;
  this._momentumVy = worldVy;
  this._momentumMode = true;
  this._momentumStartTime = null;

  // Cancel any existing spring animation
  this.cancel();

  // Start the rAF loop
  if (!this._rafId) {
    this._rafId = requestAnimationFrame(this._tickMomentum);
  }
}

/** @private Momentum tick: exponential decay with boundary transition */
_tickMomentum = (now) => {
  if (!this._momentumMode) return;

  if (this._momentumStartTime === null) {
    this._momentumStartTime = now;
    this._momentumLastTime = now;
    this._rafId = requestAnimationFrame(this._tickMomentum);
    return;
  }

  const dt = (now - this._momentumLastTime) / 1000;  // seconds
  this._momentumLastTime = now;

  // Guard against huge dt after tab switch
  if (dt > 0.1) {
    this._stopMomentum();
    return;
  }

  // Apply exponential decay to velocity
  const decay = Math.exp(-MOMENTUM_FRICTION * dt);
  this._momentumVx *= decay;
  this._momentumVy *= decay;

  // Check if velocity has dropped below threshold
  const speed = Math.sqrt(
    this._momentumVx * this._momentumVx +
    this._momentumVy * this._momentumVy
  );
  if (speed < MOMENTUM_MIN_VELOCITY / this._camera.zoom) {
    this._stopMomentum();
    return;
  }

  // Apply position delta
  const dx = this._momentumVx * dt;
  const dy = this._momentumVy * dt;

  // Store pre-clamp position to detect boundary collision
  const prevX = this._camera.x;
  const prevY = this._camera.y;

  this._camera.x += dx;
  this._camera.y += dy;
  this._camera._applyConstraints();

  // Detect if clamping stopped movement on either axis.
  // If so, kill velocity on that axis (the boundary absorbed it).
  const clampedX = Math.abs(this._camera.x - (prevX + dx)) > 0.1;
  const clampedY = Math.abs(this._camera.y - (prevY + dy)) > 0.1;

  if (clampedX) this._momentumVx = 0;
  if (clampedY) this._momentumVy = 0;

  // If both axes are clamped, momentum is done
  if (clampedX && clampedY) {
    this._stopMomentum();
    return;
  }

  this._rafId = requestAnimationFrame(this._tickMomentum);
};

/** @private Stop the momentum animation loop */
_stopMomentum() {
  this._momentumMode = false;
  this._momentumVx = 0;
  this._momentumVy = 0;
  if (this._rafId) {
    cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }
}
```

Update the `cancel()` method to also stop momentum:

```javascript
cancel() {
  // Existing spring cancellation:
  if (this._rafId) {
    cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }
  this._springX = null;
  this._springY = null;

  // New: also stop momentum
  this._momentumMode = false;
  this._momentumVx = 0;
  this._momentumVy = 0;
}
```

Add the momentum state properties to the `CameraAnimator` constructor:

```javascript
constructor(camera) {
  // ... existing Phase 3 properties ...

  // Momentum state (Phase 5.5)
  this._momentumMode = false;
  this._momentumVx = 0;
  this._momentumVy = 0;
  this._momentumStartTime = null;
  this._momentumLastTime = null;

  this._tickMomentum = this._tickMomentum.bind(this);
}
```

### Wiring momentum into the mouseup handler

The existing mouseup handler in `attachTo()` calls `_triggerSnapBack()`. Phase 5.5 intercepts this to decide between momentum and snap-back:

```javascript
// BEFORE (Phase 3):
window.addEventListener('mouseup', (e) => {
  this._pendingPan = false;
  if (!this._panning || e.button !== this._panButton) return;
  this._panning = false;
  this._panButton = -1;
  this._isDragging = false;
  if (this._el) {
    this._el.classList.remove('panning');
    this._el.style.cursor = this.spaceHeld ? 'grab' : '';
  }
  this._triggerSnapBack();
});

// AFTER (Phase 5.5):
window.addEventListener('mouseup', (e) => {
  this._pendingPan = false;
  if (!this._panning || e.button !== this._panButton) return;
  this._panning = false;
  this._panButton = -1;
  this._isDragging = false;
  if (this._el) {
    this._el.classList.remove('panning');
    this._el.style.cursor = this.spaceHeld ? 'grab' : '';
  }
  this._handleDragRelease();
});
```

### The `_handleDragRelease()` method

This method decides between three outcomes: momentum (within bounds), snap-back with velocity (past bounds), or nothing (stationary release).

```javascript
/**
 * Handle the end of a pan drag. Three possible outcomes:
 *
 * 1. Camera is past boundaries (elastic overscroll was active):
 *    → Spring snap-back with release velocity for seamless continuity.
 *
 * 2. Camera is within boundaries and has release velocity:
 *    → Free-form momentum animation (exponential decay).
 *
 * 3. Camera is within boundaries and has no velocity:
 *    → No animation. The camera stays put.
 */
_handleDragRelease() {
  const velocity = this._velocityTracker.getVelocity();

  // Clamp velocity magnitude to prevent wild flings
  const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy);
  if (speed > MOMENTUM_MAX_VELOCITY) {
    const scale = MOMENTUM_MAX_VELOCITY / speed;
    velocity.vx *= scale;
    velocity.vy *= scale;
  }

  // Check if the camera is currently past hard boundaries
  // (elastic overscroll was active during the drag).
  const pastBounds = this._isPastBounds();

  if (pastBounds) {
    // Outcome 1: snap-back with velocity.
    // The velocity feeds into the spring's initial velocity parameter,
    // creating seamless continuity between drag and snap-back.
    this._triggerSnapBackWithVelocity(velocity);
  } else if (this._momentumEnabled && speed > MOMENTUM_MIN_VELOCITY) {
    // Outcome 2: free-form momentum within boundaries.
    this._animator.momentum(velocity);
  }
  // Outcome 3: no animation (implicit, nothing happens).
}

/**
 * Check if the camera is currently past hard map boundaries on any axis.
 * This is the same check that _triggerSnapBack() uses to decide whether
 * to start a spring animation.
 */
_isPastBounds() {
  if (this.mapW <= 0 || this.mapH <= 0) return false;

  const visW = this.viewportW / this.zoom;
  const visH = this.viewportH / this.zoom;

  const clampedX = this._clampAxis(this.x, visW, this.mapW);
  const clampedY = this._clampAxis(this.y, visH, this.mapH);

  return Math.abs(this.x - clampedX) > 0.5 || Math.abs(this.y - clampedY) > 0.5;
}

/**
 * Trigger a spring snap-back with the drag-release velocity.
 * This is the upgraded version of _triggerSnapBack() that passes
 * velocity through to CameraAnimator.snapBack().
 */
_triggerSnapBackWithVelocity(velocity) {
  if (this.mapW <= 0 || this.mapH <= 0) return;
  if (!this._animator) return;

  const visW = this.viewportW / this.zoom;
  const visH = this.viewportH / this.zoom;

  const targetX = this._clampAxis(this.x, visW, this.mapW);
  const targetY = this._clampAxis(this.y, visH, this.mapH);

  const dx = Math.abs(this.x - targetX);
  const dy = Math.abs(this.y - targetY);

  if (dx < 0.5 && dy < 0.5) return;

  // Convert screen velocity to world velocity for the spring.
  // The spring operates in world space, so divide by zoom.
  // Negative: screen drag direction is opposite to camera direction.
  const worldVelocity = {
    vx: -velocity.vx / this.zoom,
    vy: -velocity.vy / this.zoom,
  };

  this._animator.snapBack(
    { x: this.x, y: this.y },
    { x: targetX, y: targetY },
    worldVelocity
  );
}
```

### The existing `_triggerSnapBack()` stays

The original `_triggerSnapBack()` method (Phase 3) is still called from other places in the codebase, such as the `camera:zoom-past-cover` toggle handler. It remains unchanged as the zero-velocity snap-back entry point. The new `_handleDragRelease()` method is the only path that injects velocity.

### DM toggle for momentum

Phase 2 flagged the risk of the map gliding past the intended position. While boundary clamping mitigates the worst case, some DMs may prefer the map to stop exactly where they release it. Add an EventBus toggle, following the same pattern as Phase 3's `camera:zoom-past-cover`:

```javascript
// In attachTo(), alongside the existing camera:zoom-past-cover handler:
EventBus.on('camera:momentum-toggle', (enabled) => {
  this._momentumEnabled = enabled;
});
```

This is wired to a Controller UI toggle in a future pass. For now, momentum is enabled by default. The toggle exists so it can be disabled without a code change if DM feedback warrants it.

### Interaction with BroadcastChannel sync

Momentum runs on the Controller. Each frame of the momentum animation updates `camera.x` and `camera.y` through `_applyConstraints()`, which emits `camera:changed`. The `CameraBroadcaster` picks up these changes at 30fps via its existing rAF-aligned tick. The Display receives the updates through the normal `CameraReceiver` pipeline.

Because momentum produces smooth, continuous position changes (similar to a manual drag), the existing sync infrastructure handles it without modification. The 30fps sample rate is sufficient because the Display's Phase 5 exponential decay interpolation smooths the 30fps updates into 60fps rendering.

If the user starts a new drag while momentum is running, `_startPan()` calls `this._animator.cancel()`, which stops the momentum loop. This is the same interrupt pattern used for spring snap-back.

---

## 4. Cover zoom gap validation

### The problem

Phase 4 manual testing (Lesson #3) identified a gap between the Controller's cover zoom floor and the Display's cover zoom floor:

- The Controller creates a headless `Camera(1920, 1080)` for the 1920×1440 map. Its coverZoom = `max(1920/1920, 1080/1440) = 1.0`.
- The Display's actual Chrome viewport (for example, 2560×1440 with UI chrome) computes coverZoom ≈ `max(2560/1920, 1440/1440) ≈ 1.333`. For a narrower viewport like 1280×960, it could be `max(1280/1920, 960/1440) ≈ 0.667`.

The Controller's zoom-out button cannot send a zoom below 1.0 (its own floor). So the gap between 0.667 and 1.0 is normally unreachable. But Phase 5 added preset recall and flyTo, which can target arbitrary zoom values. If a preset stores a zoom of 0.8 (valid on a larger Display viewport), and the Controller recalls it, the Controller sends 0.8 to the Display. The Display's `_applyConstraints()` clamps it to its own coverZoom, which may or may not be 0.8 depending on the Display's viewport.

### Current safety net

Phase 3's `_applyConstraints()` already clamps zoom to `_getMinZoom()`, which returns `this._coverZoom` (unless the DM has enabled zoom-past-cover). So the Display never renders a zoom below its own floor. The safety net works.

### What needs validation

The concern is not that an invalid zoom reaches the screen. It is that the **intent** of a preset or flyTo could be silently altered. If the DM saves a preset at zoom 0.8 on a wide Display, then recalls it when the Display has been resized to a narrow window (coverZoom 1.1), the preset silently snaps to 1.1 instead of 0.8. The DM sees a different framing than they saved.

The fix is twofold:

**1. Add a diagnostic log when coverZoom clamping overrides a received zoom.** This is not an error, but it is information the DM should be able to discover if framing looks wrong. Add to `_applyConstraints()`:

```javascript
// In _applyConstraints(), after the zoom floor enforcement:
const minZoom = this._getMinZoom();
if (this.zoom < minZoom) {
  if (this._lastClampedZoom !== this.zoom) {
    console.debug(
      `[Camera] Zoom ${this.zoom.toFixed(4)} clamped to coverZoom ` +
      `${minZoom.toFixed(4)} (viewport ${this.viewportW}×${this.viewportH}, ` +
      `map ${this.mapW}×${this.mapH})`
    );
    this._lastClampedZoom = this.zoom;
  }
  this.zoom = minZoom;
}
```

Add `this._lastClampedZoom = NaN` to the Camera constructor to prevent log spam (the guard ensures the message fires once per unique clamped value, not on every frame of a continuous sync).

**2. Add unit tests that explicitly cover the gap.** These tests verify that:
- A preset with zoom 0.8 is clamped to coverZoom when the Display's floor is above 0.8
- A preset with zoom 0.8 is preserved when the Display's floor is below 0.8
- A flyTo target with zoom in the gap range is clamped correctly

The tests are in Section 8 (Testing protocols).

### Direct zoom-to-value input

Phase 4 Lesson #3 flagged that a future slider or numeric zoom input could produce values in the gap range. Phase 5.5 does not add such inputs. If a future phase adds direct zoom-to-value input on the Controller, the input widget should clamp to `camera._coverZoom` on the Controller side (so the Controller never sends a value below its own floor) and the Display's `_applyConstraints()` provides the second-layer safety net. No additional work is needed now.

---

## 5. VIEWPORT_REPORT: sharing Display dimensions with the Controller

### The problem

Phase 4 manual testing (Lesson #4) identified that the Controller's "reset" command sends its own coverZoom (1.0), computed from its headless 1920×1080 viewport. The Display accepts this because 1.0 is above the Display's floor. But the resulting framing differs from what the Display would compute natively for its own viewport.

If a "fit to Display viewport" command is added (one that should respect the Display's actual dimensions rather than the Controller's nominal ones), the Controller needs to know the Display's real `viewportW` and `viewportH`. Currently, it has no way to learn them.

### The VIEWPORT_REPORT message

The Display sends a `VIEWPORT_REPORT` message to the Controller in two situations:

1. **On connect.** When the Display sends its ANNOUNCE message, it includes viewport dimensions. The Controller's WELCOME handler stores them.
2. **On resize.** When the Display's ResizeObserver fires, it sends an updated VIEWPORT_REPORT.

The message is lightweight (two numbers) and infrequent (only on connect and resize, not 30fps).

### Protocol addition

In `shared/protocol.js`:

```javascript
// In the MSG object, add:
VIEWPORT_REPORT: 'camera:viewport-report',

// In REQUIRED_FIELDS, add:
[MSG.VIEWPORT_REPORT]: ['viewportW', 'viewportH', 'coverZoom'],

// Add factory function:
export const createViewportReportMsg = (viewportW, viewportH, coverZoom, senderId) =>
  msg(MSG.VIEWPORT_REPORT, { viewportW, viewportH, coverZoom, senderId });
```

### Display-side: sending the report

In the Display's boot sequence (the `CameraSyncEngine` initialization for role `'display'`), hook into the ResizeObserver callback and the ANNOUNCE handler:

```javascript
// In CameraSyncEngine, for role === 'display':

// Send viewport report whenever the camera's viewport size changes.
// The camera's setViewportSize() is called by the ResizeObserver in
// MapRenderer. Hook into the existing camera:changed event, but only
// send when dimensions actually changed.
this._lastReportedVpW = 0;
this._lastReportedVpH = 0;

EventBus.on('camera:changed', () => {
  const cam = this._camera;
  if (cam.viewportW !== this._lastReportedVpW ||
      cam.viewportH !== this._lastReportedVpH) {
    this._lastReportedVpW = cam.viewportW;
    this._lastReportedVpH = cam.viewportH;
    this._sendViewportReport();
  }
});

// Also send on initial ANNOUNCE (the Display's first message to the Controller)
// This is added to the existing ANNOUNCE handler.
```

```javascript
/** Send the Display's current viewport dimensions to the Controller. */
_sendViewportReport() {
  if (!this._channelManager || !this._channelManager.channel) return;

  const cam = this._camera;
  const msg = createViewportReportMsg(
    cam.viewportW,
    cam.viewportH,
    cam._coverZoom,
    this._channelManager.windowId
  );
  this._channelManager.channel.postMessage(msg);
}
```

### Controller-side: receiving and storing the report

In the Controller's `CameraSyncEngine` (role `'controller'`), add a handler for `VIEWPORT_REPORT`:

```javascript
// In the _handleMessage switch statement, add:
case MSG.VIEWPORT_REPORT:
  this._displayViewport = {
    width: msg.viewportW,
    height: msg.viewportH,
    coverZoom: msg.coverZoom,
    senderId: msg.senderId,
    timestamp: performance.now(),
  };
  EventBus.emit('display:viewport-updated', this._displayViewport);
  break;
```

Initialize `this._displayViewport = null` in the `CameraSyncEngine` constructor.

### Public API for reading Display viewport

Add a getter to `CameraSyncEngine`:

```javascript
/**
 * Returns the Display's most recently reported viewport dimensions,
 * or null if no Display has connected yet.
 *
 * @returns {{ width: number, height: number, coverZoom: number } | null}
 */
get displayViewport() {
  return this._displayViewport
    ? { width: this._displayViewport.width,
        height: this._displayViewport.height,
        coverZoom: this._displayViewport.coverZoom }
    : null;
}
```

### Usage: true "fit to Display viewport"

With the Display's real dimensions available, the Controller can compute a reset command that matches the Display's native framing:

```javascript
// Example: "Fit to Display viewport" button on the Controller
fitToDisplayBtn.addEventListener('click', () => {
  const dvp = syncEngine.displayViewport;
  if (!dvp) {
    // No Display connected. Fall back to Controller's own reset.
    camera.fitCover();
    syncEngine.sendNow();
    return;
  }

  // Compute the Display's cover zoom for the current map
  const displayCoverZoom = Math.max(
    dvp.width / camera.mapW,
    dvp.height / camera.mapH
  );

  // Center the map at the Display's cover zoom
  const visW = dvp.width / displayCoverZoom;
  const visH = dvp.height / displayCoverZoom;
  const targetX = (camera.mapW - visW) / 2;
  const targetY = (camera.mapH - visH) / 2;

  // Set the Controller's local camera (this will be clamped to the
  // Controller's own constraints, but the sync message carries the
  // center-point, which the Display converts using its own dimensions)
  const shared = {
    centerX: camera.mapW / 2,
    centerY: camera.mapH / 2,
    zoom: displayCoverZoom,
  };
  syncEngine.broadcaster.sendJumpTo(shared.centerX, shared.centerY, shared.zoom);
});
```

This button is not wired into the Controller UI in Phase 5.5. The infrastructure (message, storage, getter) is built here. A future Controller UI pass can add the button with a single event listener.

---

## 6. Protocol additions to shared/protocol.js

### New message types

Phase 5.5 adds one new message type:

```javascript
// In the MSG object:
VIEWPORT_REPORT: 'camera:viewport-report',
```

### New REQUIRED_FIELDS entries

```javascript
// In REQUIRED_FIELDS:
[MSG.VIEWPORT_REPORT]: ['viewportW', 'viewportH', 'coverZoom'],
```

### New factory function

```javascript
/**
 * Create a VIEWPORT_REPORT message. Sent by the Display to inform
 * the Controller of the Display's actual viewport dimensions and
 * computed cover zoom floor.
 *
 * @param {number} viewportW - Display's viewport width in CSS pixels
 * @param {number} viewportH - Display's viewport height in CSS pixels
 * @param {number} coverZoom - Display's computed cover zoom floor
 * @param {string} senderId  - Display's window ID
 * @returns {SyncMessage}
 */
export const createViewportReportMsg = (viewportW, viewportH, coverZoom, senderId) =>
  msg(MSG.VIEWPORT_REPORT, { viewportW, viewportH, coverZoom, senderId });
```

### No new EventBus toggle messages

The momentum toggle (`camera:momentum-toggle`) uses the existing EventBus pattern established by Phase 3's `camera:zoom-past-cover`. It does not go through the BroadcastChannel protocol because it is a local Controller preference, not a cross-window command.

---

## 7. CSS changes

Phase 5.5 requires no CSS changes.

Momentum panning is applied via JavaScript `camera.x`/`camera.y` mutations that flow through the existing `_applyConstraints()` and `camera:changed` pipeline. The velocity tracker and momentum animation are pure math. The VIEWPORT_REPORT message is data-only. The `sendNow()` API is a JavaScript method with no visual component.

The existing `cursor: grab/grabbing` styles from Phase 1 continue to handle visual feedback for pan dragging. No additional cursor changes are needed for momentum (the cursor returns to `grab` on mouseup, before momentum begins, which matches the behavior of Google Maps and Figma).

---

## 8. Testing protocols

### Unit tests: VelocityTracker

Create or add to `tests/velocity-tracker.test.js`:

```javascript
import { describe, it, expect } from 'vitest';

// VelocityTracker is a class within map-camera.js. Either export it
// for testing or extract the test-relevant logic into a standalone
// function. For direct testing, replicate the class here:

const VELOCITY_SAMPLE_COUNT = 4;

class VelocityTracker {
  constructor() { this._samples = []; this._index = 0; this._count = 0; }
  reset() { this._samples.length = 0; this._index = 0; this._count = 0; }
  addSample(x, y, t) {
    if (this._samples.length < VELOCITY_SAMPLE_COUNT) {
      this._samples.push({ x, y, t });
    } else {
      this._samples[this._index] = { x, y, t };
    }
    this._index = (this._index + 1) % VELOCITY_SAMPLE_COUNT;
    this._count++;
  }
  getVelocity() {
    const n = Math.min(this._count, VELOCITY_SAMPLE_COUNT);
    if (n < 2) return { vx: 0, vy: 0 };
    const oldestIdx = this._count < VELOCITY_SAMPLE_COUNT ? 0 : this._index;
    const newestIdx = (this._index - 1 + VELOCITY_SAMPLE_COUNT) % VELOCITY_SAMPLE_COUNT;
    const oldest = this._samples[oldestIdx];
    const newest = this._samples[newestIdx];
    const dt = (newest.t - oldest.t) / 1000;
    if (dt < 0.008) return { vx: 0, vy: 0 };
    return { vx: (newest.x - oldest.x) / dt, vy: (newest.y - oldest.y) / dt };
  }
}

describe('VelocityTracker', () => {
  it('returns zero velocity with fewer than 2 samples', () => {
    const t = new VelocityTracker();
    expect(t.getVelocity()).toEqual({ vx: 0, vy: 0 });

    t.addSample(100, 200, 0);
    expect(t.getVelocity()).toEqual({ vx: 0, vy: 0 });
  });

  it('computes correct velocity from 2 samples', () => {
    const t = new VelocityTracker();
    t.addSample(100, 200, 0);
    t.addSample(200, 200, 100);  // 100px in 100ms = 1000 px/s
    const v = t.getVelocity();
    expect(v.vx).toBeCloseTo(1000, 0);
    expect(v.vy).toBeCloseTo(0, 0);
  });

  it('uses only the last SAMPLE_COUNT samples', () => {
    const t = new VelocityTracker();
    // First 4 samples: moving right at 500 px/s
    t.addSample(0, 0, 0);
    t.addSample(50, 0, 100);
    t.addSample(100, 0, 200);
    t.addSample(150, 0, 300);

    // Next 4 samples: moving left at 1000 px/s (overwrites ring buffer)
    t.addSample(150, 0, 400);
    t.addSample(50, 0, 500);
    t.addSample(-50, 0, 600);
    t.addSample(-150, 0, 700);

    // Velocity should reflect the last 4 samples, not the first 4
    const v = t.getVelocity();
    expect(v.vx).toBeCloseTo(-1000, 0);
  });

  it('returns zero velocity when time span is too short', () => {
    const t = new VelocityTracker();
    t.addSample(0, 0, 0);
    t.addSample(100, 0, 5);  // 5ms < 8ms threshold
    expect(t.getVelocity()).toEqual({ vx: 0, vy: 0 });
  });

  it('reset clears all samples', () => {
    const t = new VelocityTracker();
    t.addSample(0, 0, 0);
    t.addSample(100, 0, 100);
    t.reset();
    expect(t.getVelocity()).toEqual({ vx: 0, vy: 0 });
  });

  it('computes diagonal velocity correctly', () => {
    const t = new VelocityTracker();
    t.addSample(0, 0, 0);
    t.addSample(100, 100, 100);
    const v = t.getVelocity();
    expect(v.vx).toBeCloseTo(1000, 0);
    expect(v.vy).toBeCloseTo(1000, 0);
  });
});
```

### Unit tests: cover zoom gap clamping

Create or add to `tests/camera-cover-zoom-gap.test.js`:

```javascript
import { describe, it, expect } from 'vitest';

describe('cover zoom gap handling', () => {
  // Simulate a Camera with the relevant properties for constraint testing
  function createCamera(viewportW, viewportH, mapW, mapH) {
    const coverZoom = Math.max(viewportW / mapW, viewportH / mapH);
    return {
      x: 0, y: 0, zoom: coverZoom,
      viewportW, viewportH, mapW, mapH,
      _coverZoom: coverZoom,
      _dmCanZoomPastCover: false,
      _getMinZoom() { return this._dmCanZoomPastCover ? 0 : this._coverZoom; },
      applyZoomFloor(targetZoom) {
        const min = this._getMinZoom();
        return Math.max(targetZoom, min);
      }
    };
  }

  it('Controller floor (1.0) is above Display floor (0.667)', () => {
    const controller = createCamera(1920, 1080, 1920, 1440);
    const display = createCamera(1280, 960, 1920, 1440);

    expect(controller._coverZoom).toBeCloseTo(1.0, 3);
    expect(display._coverZoom).toBeCloseTo(0.667, 2);
    expect(controller._coverZoom).toBeGreaterThan(display._coverZoom);
  });

  it('preset zoom 0.8 is clamped to coverZoom on Display with floor 0.9', () => {
    const display = createCamera(1728, 1296, 1920, 1440);
    // coverZoom = max(1728/1920, 1296/1440) = 0.9
    expect(display._coverZoom).toBeCloseTo(0.9, 3);
    expect(display.applyZoomFloor(0.8)).toBeCloseTo(0.9, 3);
  });

  it('preset zoom 0.8 is preserved on Display with floor 0.667', () => {
    const display = createCamera(1280, 960, 1920, 1440);
    expect(display._coverZoom).toBeCloseTo(0.667, 2);
    expect(display.applyZoomFloor(0.8)).toBeCloseTo(0.8, 3);
  });

  it('preset zoom exactly at coverZoom is not clamped', () => {
    const display = createCamera(1280, 960, 1920, 1440);
    const atFloor = display._coverZoom;
    expect(display.applyZoomFloor(atFloor)).toBeCloseTo(atFloor, 6);
  });

  it('zoom below coverZoom is clamped when DM override is off', () => {
    const display = createCamera(1280, 960, 1920, 1440);
    display._dmCanZoomPastCover = false;
    expect(display.applyZoomFloor(0.5)).toBeCloseTo(display._coverZoom, 3);
  });

  it('zoom below coverZoom is allowed when DM override is on', () => {
    const display = createCamera(1280, 960, 1920, 1440);
    display._dmCanZoomPastCover = true;
    expect(display.applyZoomFloor(0.5)).toBeCloseTo(0.5, 3);
  });
});
```

### Playwright integration tests: sendNow() fidelity

These tests verify that clicking actual Controller DOM buttons produces sync messages on the camera channel. This is the test fidelity fix flagged in Phase 4 Lesson #5.

Create or add to `tests/integration/camera-sendnow.spec.js`:

```javascript
import { test, expect } from '@playwright/test';

test.describe('sendNow() produces sync messages from DOM clicks', () => {
  let controllerPage;
  let displayPage;

  test.beforeEach(async ({ browser }) => {
    // Open Controller and Display in the same browser context
    // (required for BroadcastChannel to work between tabs)
    const context = await browser.newContext();
    controllerPage = await context.newPage();
    displayPage = await context.newPage();

    // Navigate both pages
    await displayPage.goto('/vtt/index.html');
    await controllerPage.goto('/controller/index.html');

    // Wait for sync engine initialization
    await displayPage.waitForFunction(
      () => window.__vtt?.syncEngine?._started
    );
    await controllerPage.waitForFunction(
      () => window.__vtt?.syncEngine?._started
    );
  });

  test('zoom-in button click triggers CAMERA_SYNC on the channel', async () => {
    // Set up a message listener on the Display side that captures
    // the next CAMERA_SYNC message from the camera channel.
    const syncReceived = displayPage.evaluate(() => {
      return new Promise((resolve) => {
        const ch = new BroadcastChannel('vtt-camera');
        const handler = (event) => {
          if (event.data?.type === 'camera:sync') {
            ch.removeEventListener('message', handler);
            ch.close();
            resolve(event.data);
          }
        };
        ch.addEventListener('message', handler);

        // Timeout after 2 seconds (the message should arrive < 100ms)
        setTimeout(() => {
          ch.removeEventListener('message', handler);
          ch.close();
          resolve(null);
        }, 2000);
      });
    });

    // Click the actual zoom-in button on the Controller
    await controllerPage.click('#zoom-in');

    const msg = await syncReceived;
    expect(msg).not.toBeNull();
    expect(msg.type).toBe('camera:sync');
    expect(msg.zoom).toBeGreaterThan(0);
  });

  test('pan button click triggers CAMERA_SYNC on the channel', async () => {
    const syncReceived = displayPage.evaluate(() => {
      return new Promise((resolve) => {
        const ch = new BroadcastChannel('vtt-camera');
        const handler = (event) => {
          if (event.data?.type === 'camera:sync') {
            ch.removeEventListener('message', handler);
            ch.close();
            resolve(event.data);
          }
        };
        ch.addEventListener('message', handler);
        setTimeout(() => {
          ch.removeEventListener('message', handler);
          ch.close();
          resolve(null);
        }, 2000);
      });
    });

    await controllerPage.click('#pan-right');

    const msg = await syncReceived;
    expect(msg).not.toBeNull();
    expect(msg.type).toBe('camera:sync');
  });

  test('reset button click triggers CAMERA_JUMP_TO on the channel', async () => {
    // Reset sends a jump-to, not a regular sync
    const jumpReceived = displayPage.evaluate(() => {
      return new Promise((resolve) => {
        const ch = new BroadcastChannel('vtt-camera');
        const handler = (event) => {
          if (event.data?.type === 'camera:jump-to') {
            ch.removeEventListener('message', handler);
            ch.close();
            resolve(event.data);
          }
        };
        ch.addEventListener('message', handler);
        setTimeout(() => {
          ch.removeEventListener('message', handler);
          ch.close();
          resolve(null);
        }, 2000);
      });
    });

    await controllerPage.click('#camera-reset');

    const msg = await jumpReceived;
    expect(msg).not.toBeNull();
    expect(msg.type).toBe('camera:jump-to');
  });
});
```

**Why these tests close the fidelity gap:** The existing Phase 4 tests call `camera.zoomToCenter()` programmatically on the Controller page. In Playwright's test context, rAF fires immediately, so the broadcaster picks up the change on the next tick and sends it. This means the tests pass even if `sendImmediate()` were removed entirely. The new tests click actual DOM elements, which go through the button handler that calls `syncEngine.sendNow()`. If `sendNow()` is broken or missing, the sync message never arrives within the timeout and the test fails.

### Playwright integration tests: VIEWPORT_REPORT

```javascript
test.describe('VIEWPORT_REPORT message', () => {
  test('Display sends viewport dimensions on connect', async ({ browser }) => {
    const context = await browser.newContext();
    const controllerPage = await context.newPage();
    const displayPage = await context.newPage();

    // Navigate Controller first, then Display
    await controllerPage.goto('/controller/index.html');
    await controllerPage.waitForFunction(
      () => window.__vtt?.syncEngine?._started
    );

    // Set up listener for VIEWPORT_REPORT on the Controller
    const reportReceived = controllerPage.evaluate(() => {
      return new Promise((resolve) => {
        const ch = new BroadcastChannel('vtt-camera');
        const handler = (event) => {
          if (event.data?.type === 'camera:viewport-report') {
            ch.removeEventListener('message', handler);
            ch.close();
            resolve(event.data);
          }
        };
        ch.addEventListener('message', handler);
        setTimeout(() => {
          ch.removeEventListener('message', handler);
          ch.close();
          resolve(null);
        }, 5000);
      });
    });

    // Now open the Display (triggers ANNOUNCE and VIEWPORT_REPORT)
    await displayPage.goto('/vtt/index.html');
    await displayPage.waitForFunction(
      () => window.__vtt?.syncEngine?._started
    );

    const msg = await reportReceived;
    expect(msg).not.toBeNull();
    expect(msg.viewportW).toBeGreaterThan(0);
    expect(msg.viewportH).toBeGreaterThan(0);
    expect(msg.coverZoom).toBeGreaterThan(0);
  });
});
```

### Unit tests: momentum deceleration

Create or add to `tests/momentum.test.js`:

```javascript
import { describe, it, expect } from 'vitest';

const MOMENTUM_FRICTION = 8;

describe('momentum exponential decay', () => {
  function decayVelocity(v0, dt) {
    return v0 * Math.exp(-MOMENTUM_FRICTION * dt);
  }

  it('velocity halves in roughly 87ms', () => {
    // Math.exp(-8 * 0.087) ≈ 0.499
    const v = decayVelocity(1000, 0.087);
    expect(v).toBeCloseTo(500, -1);  // within 10 px/s
  });

  it('velocity drops below 50 px/s within 400ms', () => {
    // Math.exp(-8 * 0.4) ≈ 0.041, so 1000 * 0.041 ≈ 41
    const v = decayVelocity(1000, 0.4);
    expect(v).toBeLessThan(50);
  });

  it('high initial velocity (4000 px/s) settles within 600ms', () => {
    const v = decayVelocity(4000, 0.6);
    expect(v).toBeLessThan(50);
  });

  it('velocity is frame-rate independent', () => {
    // Verify that applying decay in one step matches multiple small steps
    const v0 = 1000;
    const totalTime = 0.1;  // 100ms

    // One big step
    const vOnce = decayVelocity(v0, totalTime);

    // Six small steps (~60fps for 100ms)
    let vMulti = v0;
    const smallDt = totalTime / 6;
    for (let i = 0; i < 6; i++) {
      vMulti = decayVelocity(vMulti, smallDt);
    }

    // Should be identical (exponential decay is multiplicative)
    expect(vMulti).toBeCloseTo(vOnce, 2);
  });
});
```

### Manual testing checklist

Run through this by hand after the code changes are in place:

1. **sendNow() works from background tab.** Open the Controller, DM Guide, and Display. Focus the DM Guide (Controller is now a background tab). Click the Controller's zoom-in button. The Display should zoom in immediately. Repeat for zoom-out, all four pan buttons, and reset.

2. **Momentum panning, gentle release.** Focus the Display (or Controller in a test harness). Right-click drag the map slowly, then release mid-drag. The map should glide smoothly in the drag direction for 200-400ms, then stop. The deceleration should feel natural, not abrupt.

3. **Momentum panning, fast release.** Drag the map quickly and release. The map should glide farther than the gentle release. Total glide duration should not exceed approximately 500ms.

4. **Momentum stops at boundary.** Drag the map toward the right edge and release with momentum. The map should glide, then stop at the boundary. It should not bounce or oscillate.

5. **Momentum transitions to snap-back.** Drag the map past the left edge (elastic overscroll active) and release with velocity. The spring snap-back should incorporate the release velocity, producing a smooth transition from drag to snap-back without a stutter at the moment of release.

6. **Momentum interrupted by new drag.** Drag and release to start momentum. While the map is still gliding, grab it again (right-click drag). The momentum should stop instantly and a new drag should begin.

7. **Momentum interrupted by zoom.** Drag and release to start momentum. While gliding, scroll to zoom. The momentum should stop and the zoom should apply.

8. **No momentum on stationary release.** Drag the map, pause for 500ms without moving, then release. No momentum should occur (the velocity tracker's samples are all at the same position).

9. **Preset recall clamps correctly on narrow Display.** Resize the Display to a narrow window (e.g., 800×600). On the Controller, recall a preset that was saved at a zoom below the Display's coverZoom. The Display should clamp to its coverZoom, not show black bars. Check the browser console for the debug log message.

10. **VIEWPORT_REPORT arrives on connect.** Open the Controller's developer console. Open the Display in another tab. The Controller should receive a `VIEWPORT_REPORT` message (visible in the debug overlay if enabled, or via `syncEngine.displayViewport` in the console).

11. **VIEWPORT_REPORT updates on resize.** With both Controller and Display open, resize the Display window. The Controller's `syncEngine.displayViewport` should update to reflect the new dimensions.

12. **Console error check.** Open DevTools on all windows. Perform all tests above. No errors or warnings related to Phase 5.5 features.

---

## 9. Migration checklist

This is the ordered list of changes for Claude Code. Each item references the section above that provides the implementation.

1. **Add `sendNow()` method** to `CameraSyncEngine` in `vtt/js/camera-sync.js` (Section 2).

2. **Update all Controller button handlers** in `controller/js/ui-builders.js` to call `syncEngine.sendNow()` instead of `syncEngine._broadcaster.sendImmediate()` (Section 2). Search the codebase for `_broadcaster.sendImmediate` to find all call sites.

3. **Remove the TODO comment** about private property access in the Controller button handlers (Section 2).

4. **Add momentum constants** (`MOMENTUM_FRICTION`, `MOMENTUM_MIN_VELOCITY`, `MOMENTUM_MAX_VELOCITY`) as module-level constants in `vtt/js/map-camera.js` (Section 3).

5. **Add `VelocityTracker` class** to `vtt/js/map-camera.js`, after the existing `CameraAnimator` class and before the `BoundsCache` class (Section 3).

6. **Add `_velocityTracker` and `_momentumEnabled`** to Camera constructor (Section 3).

7. **Add `VelocityTracker.addSample()` call** to the mousemove pan handler in `attachTo()` (Section 3).

8. **Add `VelocityTracker.reset()` call** to `_startPan()` (Section 3).

9. **Add momentum state properties** (`_momentumMode`, `_momentumVx`, `_momentumVy`, `_momentumStartTime`, `_momentumLastTime`) to `CameraAnimator` constructor (Section 3).

10. **Add `momentum()` method** to `CameraAnimator` (Section 3).

11. **Add `_tickMomentum()` method** to `CameraAnimator` (Section 3).

12. **Add `_stopMomentum()` method** to `CameraAnimator` (Section 3).

13. **Update `CameraAnimator.cancel()`** to also stop momentum (Section 3).

14. **Add `_handleDragRelease()` method** to Camera class (Section 3).

15. **Add `_isPastBounds()` method** to Camera class (Section 3).

16. **Add `_triggerSnapBackWithVelocity()` method** to Camera class (Section 3).

17. **Update the mouseup handler** in `attachTo()` to call `_handleDragRelease()` instead of `_triggerSnapBack()` (Section 3).

18. **Add `camera:momentum-toggle` EventBus handler** in `attachTo()` (Section 3).

19. **Add `this._lastClampedZoom = NaN`** to Camera constructor (Section 4).

20. **Add diagnostic console.debug log** to `_applyConstraints()` when zoom is clamped to coverZoom (Section 4).

21. **Add `VIEWPORT_REPORT`** message type, REQUIRED_FIELDS entry, and factory function to `shared/protocol.js` (Section 6).

22. **Add `_sendViewportReport()` method** to `CameraSyncEngine` for Display role (Section 5).

23. **Add `camera:changed` listener** in `CameraSyncEngine` (Display role) that sends VIEWPORT_REPORT on viewport dimension changes (Section 5).

24. **Add `VIEWPORT_REPORT` case** in `CameraSyncEngine._handleMessage()` for Controller role (Section 5).

25. **Add `this._displayViewport = null`** to `CameraSyncEngine` constructor (Section 5).

26. **Add `get displayViewport()` getter** to `CameraSyncEngine` (Section 5).

27. **Run the test suite** (Section 8): unit tests for VelocityTracker, cover zoom gap clamping, and momentum deceleration; Playwright integration tests for sendNow() DOM click fidelity and VIEWPORT_REPORT; manual testing checklist.

---

## 10. What Phase 6 expects from this foundation

Phase 5.5 closes the loose ends from the viewport overhaul. Future phases build on the completed infrastructure:

- **`syncEngine.sendNow()`** is the canonical API for all immediate camera broadcasts. Phase 6 features that trigger camera changes from the Controller (follow-token, spotlight mode, camera rails) use this method instead of reaching into the broadcaster directly.

- **The `VelocityTracker`** is reusable for any drag-based interaction. If Phase 6 adds token drag momentum (tokens slide slightly after release), the same ring-buffer-and-average-velocity pattern applies. The tracker could be extracted into a shared utility if multiple modules need it.

- **The `CameraAnimator.momentum()` method** provides the framework for any exponential-decay animation on the camera. Phase 6's "follow token" mode, which needs to smoothly track a moving token, can use a similar approach with a different friction constant.

- **`syncEngine.displayViewport`** gives the Controller access to the Display's real dimensions. Phase 6's "fit to Display viewport" button, spectator window layout calculations, and stream overlay positioning all depend on knowing the Display's actual size rather than the Controller's nominal 1920×1080.

- **The VIEWPORT_REPORT message** flows over the camera BroadcastChannel. When Phase 6 adds WebSocket transport via ISyncTransport, VIEWPORT_REPORT works identically over WebSocket. No protocol changes needed.

- **The cover zoom gap diagnostic log** helps debug framing mismatches in multi-monitor setups. If DMs report that presets look different on the Display than what they saved, the console log immediately identifies whether coverZoom clamping is the cause.

The viewport overhaul is now complete. Every item in the original roadmap has been implemented, every deferred item has been either completed or explicitly pushed to Phase 6 with documented prerequisites, and the infrastructure is ready for the next generation of features: WebSocket transport, follow-token auto-camera, multi-waypoint camera rails, and DM spotlight mode.
