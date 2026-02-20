# Phase 5: Advanced features for cinematic camera control

**This guide adds the marquee features that transform the VTT from a functional viewport into a cinematic presentation tool: animated flyTo transitions along mathematically optimal paths, a DM preset system with hotkey recall, automatic content framing that tracks the action, semantic zoom that reveals detail progressively, and the receiver-side interpolation that smooths 30fps camera sync into 60fps rendering.** These features share a common dependency on Phase 4's center-point camera model and BroadcastChannel sync infrastructure. Each feature is designed as an independent module that plugs into the existing `CameraSyncEngine`, so you can implement them in any order and ship incrementally.

The document also covers the three infrastructure upgrades that Phase 4 explicitly deferred: the `ISyncTransport` abstraction that prepares the system for WebSocket migration, the deterministic authority election protocol for multi-Controller coordination, and the debug overlay that makes the sync engine's behavior visible during development.

The guide is structured as a walkthrough you can hand directly to Claude Code. Each section explains what the code does and why, provides the complete implementation, calls out interactions with existing modules, and includes testing protocols. Read it front to back before changing anything. The order matters.

---

## Table of contents

1. [What Phase 4 established and what Phase 5 changes](#1-what-phase-4-established-and-what-phase-5-changes)
2. [The flyTo animation engine: van Wijk & Nuij optimal paths](#2-the-flyto-animation-engine)
3. [Camera presets: save, recall, and sync named positions](#3-camera-presets)
4. [Fit-to-tokens: automatic content framing](#4-fit-to-tokens)
5. [Semantic zoom: progressive detail by zoom level](#5-semantic-zoom)
6. [Receiver-side exponential decay interpolation](#6-receiver-side-interpolation)
7. [ISyncTransport abstraction and CompositeTransport](#7-isynctransport-abstraction)
8. [Deterministic authority election](#8-authority-election)
9. [Debug overlay and performance instrumentation](#9-debug-overlay)
10. [Protocol additions to shared/protocol.js](#10-protocol-additions)
11. [Wiring it all together: boot sequence updates](#11-wiring-it-together)
12. [CSS changes](#12-css-changes)
13. [Testing protocols](#13-testing-protocols)
14. [Migration checklist](#14-migration-checklist)
15. [What Phase 6 expects from this foundation](#15-phase-6-expectations)
16. [What is explicitly deferred and why](#16-deferred-features)

---

## 1. What Phase 4 established and what Phase 5 changes

### The Phase 4 foundation

Phase 4 delivered continuous camera sync over BroadcastChannel using a center-point model. The infrastructure that Phase 5 builds on:

```javascript
// Center-point conversion (shared/protocol.js)
localToShared(camera, viewport)   // → { centerX, centerY, zoom }
sharedToLocal(shared, viewport)   // → { x, y, zoom }

// Camera state (vtt/js/map-camera.js)
camera.serialize()                // → { x, y, zoom, mapW, mapH, viewportW, viewportH }
camera.deserialize(data)          // applies state, routes through _applyConstraints()
camera.setPosition(x, y, zoom)   // direct state set, routes through _applyConstraints()
camera._applyConstraints()        // single commit point: enforces zoom/pan bounds
camera._coverZoom                 // dynamic zoom floor
camera.viewportW / viewportH     // current viewport dimensions
camera.mapW / mapH               // current map dimensions

// Sync engine (vtt/js/camera-sync.js)
CameraBroadcaster                 // rAF-aligned 30fps state streaming
CameraReceiver                    // sequence-numbered message handling
WindowRegistry                    // peer tracking with heartbeat liveness
CameraChannelManager              // BroadcastChannel lifecycle + Page Lifecycle
CameraSyncEngine                  // orchestrator: role-based initialization

// Messages (shared/protocol.js)
MSG.CAMERA_SYNC                   // continuous 30fps state stream
MSG.CAMERA_JUMP_TO                // instant teleport
MSG.ANNOUNCE / MSG.WELCOME        // handshake protocol
MSG.HEARTBEAT / MSG.GOODBYE       // liveness
```

Phase 4's key architectural properties:

1. `deserialize()` routes through `_applyConstraints()`, so received state always respects local boundary constraints.
2. The `suppressBroadcast` flag prevents the receiver from re-broadcasting state it just received.
3. Sequence numbers are per-sender and monotonic, enabling stale message rejection.
4. The WELCOME handshake includes camera state for late-joining windows.
5. The DM Guide operates independently from the Controller/Display sync.

### What Phase 5 changes

Phase 5 adds nine features organized into three tiers:

**Tier 1: Cinematic camera (Sections 2-4).** The flyTo algorithm computes mathematically optimal zoom-pan-zoom paths between two camera positions. The preset system gives the DM named camera bookmarks with `Shift+1..9` recall. Fit-to-tokens automatically frames the action by computing a bounding box around active combatants.

**Tier 2: Visual polish (Sections 5-6).** Semantic zoom progressively shows and hides detail layers (grid labels, token names, condition indicators, HP bars) based on the current zoom level. Receiver-side interpolation smooths the 30fps sync stream into 60fps rendering on the Display window.

**Tier 3: Infrastructure (Sections 7-9).** The `ISyncTransport` abstraction wraps BroadcastChannel behind an interface that WebSocket can also implement. Deterministic authority election replaces the "Controller always sends" assumption with a protocol that handles multiple Controllers. The debug overlay makes sync behavior visible during development.

---

## 2. The flyTo animation engine

### Why this matters for your VTT

Every commercial VTT teleports the camera instantly when switching locations. The DM clicks "Boss Room" and the map jumps. This works, but it destroys spatial context. Players lose their sense of where they are on the map because they never see the space between locations. The van Wijk & Nuij flyTo algorithm solves this by computing a path that zooms out to reveal the journey, pans across the map, then zooms back in at the destination. The effect is cinematic: players watch the camera soar over the dungeon, maintaining spatial awareness while the DM transitions between encounter areas.

This is the single most impactful visual feature in Phase 5, and no VTT currently does it well.

### The mathematical foundation

The 2003 paper "Smooth and efficient zooming and panning" by Jarke J. van Wijk and Wim A.A. Nuij defines a metric for perceived velocity during simultaneous zoom and pan. A camera view is represented as `(u, w)` where `u` is the position along a straight line between start and end points, and `w` is the visible width of the viewport in world units (inversely related to zoom: `w = screenWidth / zoom`).

The perceived velocity metric is:

```
V_perceived = sqrt((du/ds)^2 + (dw/ds)^2) * (rho^2 / w)
```

The parameter `rho` (ρ) controls how much the camera zooms out during the transition relative to how much it pans. The original paper's user studies found ρ ≈ 1.42 produces the most natural-feeling motion. This value means the camera zooms out just enough to reveal both the start and end points before panning. Lower values (ρ < 1) produce flatter, more linear paths. Higher values (ρ > 2) produce dramatic zoom-outs that soar high above the map.

The optimal path follows a geodesic in the metric space defined by this perceived velocity. The geodesic turns out to be a segment of an ellipse in `(u, w)` space, which is why the camera traces that characteristic zoom-out-pan-zoom-in arc.

D3.js, Mapbox GL JS, and MapLibre GL JS all implement this algorithm. D3's `d3.interpolateZoom` represents views as `[cx, cy, width]` arrays and returns an interpolator with a `.duration` property. MapLibre's `flyTo()` adds practical improvements: it respects `prefers-reduced-motion`, clamps to `maxZoom`, and handles edge cases like pure-zoom (no pan) and pure-pan (no zoom) separately.

### The implementation

Create `vtt/js/fly-to.js`. This module is pure math with no DOM dependencies, making it testable in isolation.

```javascript
// vtt/js/fly-to.js
// Van Wijk & Nuij optimal camera path computation.
// Reference: "Smooth and efficient zooming and panning" (InfoVis 2003)
// Also informed by MapLibre GL JS camera.ts and D3's d3-interpolate-zoom.

const cosh = (x) => (Math.exp(x) + Math.exp(-x)) / 2;
const sinh = (x) => (Math.exp(x) - Math.exp(-x)) / 2;
const tanh = (x) => sinh(x) / cosh(x);

/**
 * The rho parameter from van Wijk & Nuij user studies.
 * Controls the zoom-to-pan tradeoff in the optimal path.
 *
 * - rho = 1.42: the paper's recommended default. Balanced arc.
 * - rho < 1.0:  flatter paths, less zoom-out. Good for short distances.
 * - rho > 2.0:  dramatic zoom-out. Cinematic for long distances.
 * - rho = 0:    degenerate case, produces a linear pan with no zoom change.
 *
 * MapLibre uses 1.42 as the default. D3 uses sqrt(2) (~1.414).
 * The difference is imperceptible. We use 1.42 to match the paper.
 */
const DEFAULT_RHO = 1.42;

/**
 * Speed in "screenfulls per second." A screenfull is the map's visible
 * span at the current zoom level. MapLibre's default is 1.2.
 * Higher values = faster transitions. Lower = more cinematic.
 */
const DEFAULT_SPEED = 1.2;

/**
 * Minimum transition duration in ms. Prevents jarring snaps
 * for very short distances.
 */
const MIN_DURATION_MS = 200;

/**
 * Maximum transition duration in ms. Prevents tediously long
 * animations for cross-map transitions.
 */
const MAX_DURATION_MS = 5000;

/**
 * Distance threshold below which we skip the full van Wijk & Nuij
 * computation and fall back to a simple ease. Prevents numerical
 * instability when start and end are nearly identical.
 */
const EPSILON_DISTANCE = 1e-6;

/**
 * Compute a van Wijk & Nuij optimal camera path between two positions.
 *
 * @param {SharedCameraState} start  - { centerX, centerY, zoom }
 * @param {SharedCameraState} end    - { centerX, centerY, zoom }
 * @param {Object} [opts]
 * @param {number} [opts.rho=1.42]       - curvature parameter
 * @param {number} [opts.speed=1.2]      - screenfulls per second
 * @param {number} [opts.screenWidth]    - viewport width for w<->zoom conversion
 * @param {number} [opts.duration]       - override computed duration (ms)
 * @returns {FlyToPath}
 *
 * @typedef {Object} FlyToPath
 * @property {number} duration           - animation duration in ms
 * @property {function(number): SharedCameraState} at
 *   Given t in [0, 1], returns the camera state at that point along the path.
 *   t=0 is the start, t=1 is the end.
 */
export function computeFlyToPath(start, end, opts = {}) {
  const rho = opts.rho ?? DEFAULT_RHO;
  const V = opts.speed ?? DEFAULT_SPEED;
  const screenW = opts.screenWidth ?? 1920;

  // Convert zoom to visible width: w = screenWidth / zoom
  // This is the key insight: the algorithm operates on "visible width"
  // because perceived velocity depends on what fraction of the view is
  // changing, not absolute pixel counts.
  const w0 = screenW / start.zoom;
  const w1 = screenW / end.zoom;

  // Distance between centers in world space
  const dx = end.centerX - start.centerX;
  const dy = end.centerY - start.centerY;
  const u1 = Math.sqrt(dx * dx + dy * dy);

  // Pre-compute rho powers
  const rho2 = rho * rho;
  const rho4 = rho2 * rho2;

  let S, uFn, wFn;

  if (u1 < EPSILON_DISTANCE) {
    // ------ PURE ZOOM (no pan) ------
    // The general formula divides by u1, so we need a special case.
    // When there is no pan, the optimal path is a simple exponential
    // zoom from w0 to w1.
    if (Math.abs(w0 - w1) < EPSILON_DISTANCE) {
      // Start and end are identical. Return a no-op path.
      return {
        duration: 0,
        at: () => ({ centerX: start.centerX, centerY: start.centerY, zoom: start.zoom }),
      };
    }

    const k = w1 < w0 ? -1 : 1;
    S = Math.abs(Math.log(w1 / w0)) / rho;
    uFn = () => 0;
    wFn = (s) => w0 * Math.exp(k * rho * s);
  } else {
    // ------ GENERAL CASE: combined zoom + pan ------
    // From the van Wijk & Nuij paper equations (9) and (10):
    //
    //   b0 = (w1^2 - w0^2 + rho^4 * u1^2) / (2 * w0 * rho^2 * u1)
    //   b1 = (w1^2 - w0^2 - rho^4 * u1^2) / (2 * w1 * rho^2 * u1)
    //
    //   r(b) = ln(-b + sqrt(b^2 + 1))    (this is arcsinh(-b))
    //
    //   r0 = r(b0),  r1 = r(b1)
    //   S  = (r1 - r0) / rho              (total path length)
    //
    //   u(s) = (w0/rho^2) * cosh(r0) * tanh(rho*s + r0) - (w0/rho^2) * sinh(r0)
    //   w(s) = w0 * cosh(r0) / cosh(rho*s + r0)
    //
    const b0 = (w1 * w1 - w0 * w0 + rho4 * u1 * u1) / (2 * w0 * rho2 * u1);
    const b1 = (w1 * w1 - w0 * w0 - rho4 * u1 * u1) / (2 * w1 * rho2 * u1);

    const r = (b) => Math.log(-b + Math.sqrt(b * b + 1)); // arcsinh(-b)
    const r0 = r(b0);
    const r1 = r(b1);

    S = (r1 - r0) / rho;

    const a = w0 / rho2;
    const coshr0 = cosh(r0);
    const sinhr0 = sinh(r0);

    uFn = (s) => a * coshr0 * tanh(rho * s + r0) - a * sinhr0;
    wFn = (s) => w0 * coshr0 / cosh(rho * s + r0);
  }

  // Duration: path length / speed, converted to ms.
  // S is measured in "screenfulls." V is screenfulls/second.
  const computedDuration = 1000 * S / V;
  const duration = opts.duration ?? Math.min(Math.max(computedDuration, MIN_DURATION_MS), MAX_DURATION_MS);

  return {
    duration,

    /**
     * Evaluate the path at parameter t in [0, 1].
     * Returns a SharedCameraState { centerX, centerY, zoom }.
     *
     * IMPORTANT: t should be pre-eased by the caller. This function
     * computes the geometric path; easing controls the *timing* of
     * traversal along that path.
     */
    at(t) {
      // s is the arc-length parameter along the geodesic
      const s = t * S;

      // u(s) is how far along the start-to-end line we've traveled
      const uNorm = u1 > EPSILON_DISTANCE ? uFn(s) / u1 : 0;

      // w(s) is the visible width at this point
      const w = wFn(s);

      return {
        centerX: start.centerX + dx * uNorm,
        centerY: start.centerY + dy * uNorm,
        zoom: screenW / w,
      };
    },
  };
}
```

### Easing functions

The flyTo path defines *where* the camera goes. Easing defines *when* it gets there. The path parameter `t` in `[0, 1]` is passed through an easing function before feeding to `path.at()`.

For camera transitions, `easeInOutCubic` produces the best feel: the camera accelerates smoothly from rest, reaches peak speed at the midpoint, and decelerates smoothly into the destination. MapLibre uses this by default. tldraw offers a menu of easings but defaults to `easeInOutCubic` for camera moves.

```javascript
// vtt/js/easing.js
// Standard easing functions for animation.
// These are pure functions: easing(t) -> t' where both are in [0, 1].

/**
 * Ease-in-out cubic. The workhorse for camera transitions.
 * Smooth acceleration and deceleration. Feels natural and unhurried.
 */
export function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Ease-out quint. Fast start, gentle landing.
 * Good for "snap to" motions where you want the destination
 * to feel settled, like recalling a camera preset.
 */
export function easeOutQuint(t) {
  return 1 - Math.pow(1 - t, 5);
}

/**
 * Ease-in-out quart. Slightly snappier than cubic.
 * Good for shorter transitions where cubic feels sluggish.
 */
export function easeInOutQuart(t) {
  return t < 0.5
    ? 8 * t * t * t * t
    : 1 - Math.pow(-2 * t + 2, 4) / 2;
}

/**
 * Linear. No easing. Useful for debugging and for
 * progress indicators, but never for camera motion.
 */
export function linear(t) {
  return t;
}
```

### The CameraAnimator: integrating flyTo with the spring system

The flyTo algorithm produces a parametric path. Phase 3's critically-damped spring system handles interactive, interruptible animation. The integration uses a layered approach: flyTo computes waypoints as the spring's moving target each frame. The spring provides natural smoothing and handles interruptions when the user grabs the camera mid-flight.

This is the same pattern MapLibre uses internally: the flyTo path feeds into a camera update loop that can be interrupted at any frame by user input.

```javascript
// vtt/js/camera-animator.js
// Orchestrates flyTo paths, spring-based interpolation, and interruption handling.
// This extends the animation infrastructure from Phase 3.

import { computeFlyToPath } from './fly-to.js';
import { easeInOutCubic } from './easing.js';
import { localToShared, sharedToLocal } from '../../shared/protocol.js';
import { EventBus } from './event-bus.js';

/**
 * @typedef {Object} AnimationState
 * @property {'idle'|'flying'|'settling'} status
 * @property {FlyToPath|null} path       - active flyTo path
 * @property {number} startTime          - performance.now() when animation began
 * @property {function} easingFn         - easing function for the current animation
 * @property {SharedCameraState|null} target  - final destination in shared coords
 */

export class CameraAnimator {
  /** @type {import('./map-camera.js').Camera} */
  #camera;

  /** @type {{ w: number, h: number }} */
  #viewport;

  /** @type {AnimationState} */
  #state = { status: 'idle', path: null, startTime: 0, easingFn: easeInOutCubic, target: null };

  /** @type {number|null} */
  #rafId = null;

  /**
   * When true, camera changes from the animator should NOT be
   * re-broadcast by the CameraBroadcaster. This prevents the
   * receiver's animated transitions from being sent back to the
   * authority as "new" state.
   */
  #suppressBroadcast = false;

  /**
   * @param {Camera} camera       - Phase 1 Camera instance
   * @param {{ w: number, h: number }} viewport - current viewport dimensions
   */
  constructor(camera, viewport) {
    this.#camera = camera;
    this.#viewport = viewport;
  }

  /** Update viewport dimensions (called from ResizeObserver) */
  updateViewport(w, h) {
    this.#viewport = { w, h };
  }

  /** @returns {boolean} Whether an animation is currently running */
  get isAnimating() {
    return this.#state.status !== 'idle';
  }

  /** @returns {boolean} Whether broadcast should be suppressed */
  get suppressBroadcast() {
    return this.#suppressBroadcast;
  }

  /**
   * Start a flyTo animation from the current camera position to a target.
   *
   * @param {SharedCameraState} target - { centerX, centerY, zoom } in shared coords
   * @param {Object} [opts]
   * @param {number} [opts.duration]     - override computed duration (ms)
   * @param {number} [opts.rho=1.42]     - curvature parameter
   * @param {number} [opts.speed=1.2]    - screenfulls per second
   * @param {function} [opts.easing]     - easing function
   * @param {boolean} [opts.suppressBroadcast=false] - true for receiver-side animations
   */
  flyTo(target, opts = {}) {
    // Cancel any in-progress animation
    this.#cancelAnimation();

    // Compute current position in shared coordinates
    const current = localToShared(this.#camera, this.#viewport);

    // Compute the optimal path
    const path = computeFlyToPath(current, target, {
      rho: opts.rho ?? 1.42,
      speed: opts.speed ?? 1.2,
      duration: opts.duration,
      screenWidth: this.#viewport.w,
    });

    if (path.duration === 0) {
      // Start and end are identical; apply directly and skip animation
      this.#applySharedState(target);
      return;
    }

    this.#suppressBroadcast = opts.suppressBroadcast ?? false;

    this.#state = {
      status: 'flying',
      path,
      startTime: performance.now(),
      easingFn: opts.easing ?? easeInOutCubic,
      target,
    };

    this.#startAnimationLoop();
  }

  /**
   * Instantly jump to a target position. No animation.
   * Used as a fallback when flyTo is not appropriate (e.g., map change).
   *
   * @param {SharedCameraState} target
   * @param {Object} [opts]
   * @param {boolean} [opts.suppressBroadcast=false]
   */
  jumpTo(target, opts = {}) {
    this.#cancelAnimation();
    this.#suppressBroadcast = opts.suppressBroadcast ?? false;
    this.#applySharedState(target);
    this.#suppressBroadcast = false;
  }

  /**
   * Interrupt the current animation. Called when the user grabs the camera
   * (mouse down, wheel, keyboard) during a flyTo.
   *
   * The camera stays at whatever position it reached when interrupted.
   * No snap-back, no settling. The user now has full control.
   */
  interrupt() {
    if (this.#state.status === 'idle') return;
    this.#cancelAnimation();
    EventBus.emit('camera:animation-interrupted');
  }

  /**
   * The animation loop. Runs at display refresh rate (typically 60fps)
   * via requestAnimationFrame.
   *
   * On each frame:
   *   1. Compute elapsed time and progress t in [0, 1]
   *   2. Apply easing to t
   *   3. Evaluate the flyTo path at the eased t
   *   4. Convert from shared coords to local coords
   *   5. Apply to the camera
   *   6. If t >= 1, animation is complete
   */
  #tick = (now) => {
    if (this.#state.status === 'idle') return;

    const elapsed = now - this.#state.startTime;
    const rawT = Math.min(elapsed / this.#state.path.duration, 1.0);
    const easedT = this.#state.easingFn(rawT);

    // Evaluate the path at the eased parameter
    const waypoint = this.#state.path.at(easedT);

    // Apply to camera (this routes through _applyConstraints)
    this.#applySharedState(waypoint);

    if (rawT >= 1.0) {
      // Animation complete. Apply the exact target to avoid floating-point drift.
      this.#applySharedState(this.#state.target);
      this.#state = { status: 'idle', path: null, startTime: 0, easingFn: easeInOutCubic, target: null };
      this.#suppressBroadcast = false;
      this.#rafId = null;
      EventBus.emit('camera:animation-complete');
      return;
    }

    // Request next frame
    this.#rafId = requestAnimationFrame(this.#tick);
  };

  /** Convert shared coords to local and apply to camera */
  #applySharedState(shared) {
    const local = sharedToLocal(shared, this.#viewport);
    this.#camera.setPosition(local.x, local.y, local.zoom);
  }

  /** Start the rAF loop if not already running */
  #startAnimationLoop() {
    if (this.#rafId !== null) return;
    this.#rafId = requestAnimationFrame(this.#tick);
  }

  /** Stop the rAF loop and reset state */
  #cancelAnimation() {
    if (this.#rafId !== null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
    this.#state = { status: 'idle', path: null, startTime: 0, easingFn: easeInOutCubic, target: null };
    this.#suppressBroadcast = false;
  }

  /** Clean up on window unload */
  destroy() {
    this.#cancelAnimation();
  }
}
```

### How flyTo broadcasts work across windows

When the DM triggers a flyTo (via preset recall, fit-to-tokens, or a direct "fly to location" command), the Controller broadcasts a single `CAMERA_FLY_TO` message. Each receiving window independently executes the van Wijk & Nuij animation at its own display refresh rate. This produces perfectly smooth animation on every window regardless of sync latency.

The alternative would be broadcasting every intermediate position at 30fps and having receivers interpolate. That approach produces inferior results: 30fps waypoints through a curved path produce visible stepping artifacts, and the animation is constrained to look good at the sender's frame rate rather than the receiver's.

```javascript
// In CameraBroadcaster (camera-sync.js), add this method:

/**
 * Broadcast a flyTo command to all receiving windows.
 * Each receiver will independently animate to the target.
 *
 * @param {SharedCameraState} target
 * @param {Object} opts - { duration, rho, speed, presetId }
 */
sendFlyTo(target, opts = {}) {
  const msg = createCameraFlyToMsg(this.#windowId, ++this.#seq, {
    target,
    duration: opts.duration ?? null,    // null = let receiver compute
    rho: opts.rho ?? 1.42,
    speed: opts.speed ?? 1.2,
    presetId: opts.presetId ?? null,    // which preset triggered this, if any
  });
  this.#channel.postMessage(msg);
}
```

```javascript
// In CameraReceiver (camera-sync.js), handle the new message:

#handleMessage = (event) => {
  const msg = event.data;
  if (!msg || msg.sender === this.#windowId) return;

  switch (msg.type) {
    case MSG.CAMERA_SYNC:
      // ... existing 30fps state handling ...
      break;

    case MSG.CAMERA_FLY_TO:
      this.#handleFlyTo(msg);
      break;

    case MSG.CAMERA_JUMP_TO:
      // ... existing instant teleport handling ...
      break;
  }
};

#handleFlyTo(msg) {
  // Reject stale flyTo commands.
  // Initialized to -1 (not 0) because sequence numbers start at 1
  // after a ++this.#seq increment. Using -1 ensures the very first
  // flyTo message is never accidentally rejected.
  // Class field declaration: #lastFlyToSeq = -1;
  if (msg.seq <= this.#lastFlyToSeq) return;
  this.#lastFlyToSeq = msg.seq;

  const { target, duration, rho, speed } = msg.payload;

  // Suppress continuous state broadcast during flyTo.
  // The receiver is independently animating, not echoing the sender.
  this.#animator.flyTo(target, {
    duration,
    rho,
    speed,
    suppressBroadcast: true,
  });
}
```

### Accessibility: respecting prefers-reduced-motion

MapLibre does this well. When the user has `prefers-reduced-motion: reduce` enabled in their OS settings, `flyTo()` falls back to `jumpTo()`. The VTT should do the same:

```javascript
// In CameraAnimator.flyTo(), add this check at the top:

flyTo(target, opts = {}) {
  // Respect user's motion preferences. This is the same pattern MapLibre uses.
  // The DM may not have reduced motion enabled, but the Display window might
  // be on a machine that does (e.g., a player's laptop used as a second screen).
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    this.jumpTo(target, opts);
    return;
  }

  // ... rest of flyTo implementation ...
}
```

### Edge cases the implementation handles

**Pure zoom, no pan.** When start and end have the same center but different zoom levels, `u1` is zero. Dividing by zero would break the general formula, so we detect this case and use a simple exponential zoom path instead.

**Pure pan, no zoom.** When `w0 === w1`, the formula still works. The camera pans along a straight line without changing zoom. The path degenerates to a linear interpolation, which is the correct behavior.

**Very short distances.** For transitions shorter than `EPSILON_DISTANCE` world units, we skip the full computation and do a direct jump. This prevents numerical instability and unnecessary animation for what amounts to a no-op.

**Very long distances.** The `MAX_DURATION_MS` cap prevents cross-map transitions from taking 10+ seconds, which feels tedious. At the cap, the camera moves faster than the "optimal perceived velocity" suggests, but users prefer speed over mathematical optimality for long journeys.

**Interruption.** If the user scrolls, pans, or presses a key during a flyTo, the animation stops immediately at whatever frame it reached. No snap-back, no settling. The user has full control. This is critical for game sessions: the DM might trigger a flyTo then immediately need to adjust the framing.

---

## 3. Camera presets

### Why presets matter for game sessions

A DM running a dungeon crawl might have five key locations: the entrance, the throne room, the treasure vault, the boss arena, and the escape route. Without presets, the DM pans manually to each location every time. With presets, the DM hits `Shift+1` and the camera flies to the entrance. `Shift+2` flies to the throne room. The transitions are smooth (via flyTo), the positions are exact (no fumbling with pan/zoom), and the pacing is cinematic.

Tabletop Simulator supports this pattern (`Ctrl+1..9` to save, `Shift+1..9` to recall). Foundry VTT has scene default views but no mid-scene bookmarks. OBS Studio's scene presets with configurable transitions are the closest analogy to what we're building.

### The preset data model

Presets are stored in the center-point format (`{ centerX, centerY, zoom }`) from Phase 4. This means a preset saved on the Controller's 1366x768 viewport produces the correct framing when recalled on the Display's 1920x1080 viewport. The `localToShared()` function handles the conversion automatically.

```javascript
// vtt/js/camera-presets.js

import { localToShared, sharedToLocal } from '../../shared/protocol.js';
import { EventBus } from './event-bus.js';

/**
 * @typedef {Object} CameraPreset
 * @property {string} id              - crypto.randomUUID()
 * @property {string} name            - human-readable label (e.g., "Boss Arena")
 * @property {SharedCameraState} camera - { centerX, centerY, zoom }
 * @property {Object} transition      - animation parameters
 * @property {number} transition.duration - ms (null = auto-compute from distance)
 * @property {number} transition.rho  - curvature parameter
 * @property {string|null} hotkey     - '1'..'9' or null
 * @property {string} icon            - emoji identifier for the Controller UI
 * @property {number} sortOrder       - display order in the Controller preset list
 * @property {string} mapId           - which map this preset belongs to
 * @property {number} createdAt       - Date.now() when created
 * @property {number} updatedAt       - Date.now() when last modified
 */

/**
 * The preset storage key in localStorage. Presets persist across
 * browser sessions because they represent DM preparation, not
 * ephemeral session state. Using localStorage (not sessionStorage)
 * means presets survive tab closes and browser restarts.
 */
const STORAGE_KEY = 'vtt-camera-presets';

export class CameraPresetManager {
  /** @type {Map<string, CameraPreset>} */
  #presets = new Map();

  /** @type {CameraAnimator} */
  #animator;

  /** @type {string|null} current map ID for filtering */
  #currentMapId = null;

  constructor(animator) {
    this.#animator = animator;
    this.#loadFromStorage();
  }

  /**
   * Save the current camera position as a preset.
   *
   * @param {string} name
   * @param {Camera} camera
   * @param {{ w: number, h: number }} viewport
   * @param {Object} [opts]
   * @returns {CameraPreset}
   */
  save(name, camera, viewport, opts = {}) {
    const shared = localToShared(camera, viewport);
    const preset = {
      id: crypto.randomUUID(),
      name,
      camera: shared,
      transition: {
        duration: opts.duration ?? null,
        rho: opts.rho ?? 1.42,
      },
      hotkey: opts.hotkey ?? null,
      icon: opts.icon ?? '📍',
      sortOrder: this.#presetsForCurrentMap().length,
      mapId: this.#currentMapId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.#presets.set(preset.id, preset);
    this.#saveToStorage();
    EventBus.emit('presets:changed', { presets: this.listForCurrentMap() });
    return preset;
  }

  /**
   * Recall a preset: animate the camera to the saved position.
   *
   * @param {string} presetId
   * @returns {boolean} true if preset found and recalled
   */
  recall(presetId) {
    const preset = this.#presets.get(presetId);
    if (!preset) return false;

    this.#animator.flyTo(preset.camera, {
      duration: preset.transition.duration,
      rho: preset.transition.rho,
    });

    EventBus.emit('presets:recalled', { preset });
    return true;
  }

  /**
   * Recall a preset by its hotkey number (1-9).
   *
   * @param {number} num - 1 through 9
   * @returns {boolean}
   */
  recallByHotkey(num) {
    const preset = this.#presetsForCurrentMap().find(p => p.hotkey === String(num));
    if (!preset) return false;
    return this.recall(preset.id);
  }

  /**
   * Update a preset's properties.
   *
   * @param {string} presetId
   * @param {Partial<CameraPreset>} changes
   */
  update(presetId, changes) {
    const preset = this.#presets.get(presetId);
    if (!preset) return;

    // If reassigning a hotkey, clear it from any other preset on this map
    if (changes.hotkey) {
      for (const p of this.#presetsForCurrentMap()) {
        if (p.hotkey === changes.hotkey && p.id !== presetId) {
          p.hotkey = null;
        }
      }
    }

    Object.assign(preset, changes, { updatedAt: Date.now() });
    this.#saveToStorage();
    EventBus.emit('presets:changed', { presets: this.listForCurrentMap() });
  }

  /**
   * Update a preset's camera position to the current view.
   * ("Re-save" the preset at the new position.)
   *
   * @param {string} presetId
   * @param {Camera} camera
   * @param {{ w: number, h: number }} viewport
   */
  updatePosition(presetId, camera, viewport) {
    const preset = this.#presets.get(presetId);
    if (!preset) return;

    preset.camera = localToShared(camera, viewport);
    preset.updatedAt = Date.now();
    this.#saveToStorage();
    EventBus.emit('presets:changed', { presets: this.listForCurrentMap() });
  }

  /**
   * Delete a preset.
   *
   * @param {string} presetId
   */
  delete(presetId) {
    this.#presets.delete(presetId);
    this.#saveToStorage();
    EventBus.emit('presets:changed', { presets: this.listForCurrentMap() });
  }

  /**
   * Get all presets for the current map, sorted by sortOrder.
   *
   * @returns {CameraPreset[]}
   */
  listForCurrentMap() {
    return this.#presetsForCurrentMap().sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * Set the current map ID. Called when the map changes.
   * Presets are per-map, so switching maps changes the active preset list.
   *
   * @param {string} mapId
   */
  setCurrentMap(mapId) {
    this.#currentMapId = mapId;
    EventBus.emit('presets:changed', { presets: this.listForCurrentMap() });
  }

  /**
   * Export all presets as a serializable array.
   * Used for BroadcastChannel PRESET_SYNC messages and for
   * including in WELCOME payloads.
   *
   * @returns {CameraPreset[]}
   */
  exportAll() {
    return [...this.#presets.values()];
  }

  /**
   * Import presets from an external source (PRESET_SYNC message
   * or WELCOME payload). Replaces the entire preset collection.
   *
   * @param {CameraPreset[]} presets
   */
  importAll(presets) {
    this.#presets.clear();
    for (const p of presets) {
      this.#presets.set(p.id, p);
    }
    this.#saveToStorage();
    EventBus.emit('presets:changed', { presets: this.listForCurrentMap() });
  }

  /**
   * Bind keyboard shortcuts. Shift+1..9 recalls presets.
   * Should be called once during initialization on the Controller.
   */
  bindHotkeys() {
    document.addEventListener('keydown', this.#hotkeyHandler);
  }

  /** Remove keyboard shortcut listener */
  unbindHotkeys() {
    document.removeEventListener('keydown', this.#hotkeyHandler);
  }

  #hotkeyHandler = (e) => {
    // Shift + number key, with no other modifiers
    if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;

    const num = parseInt(e.key);
    if (isNaN(num) || num < 1 || num > 9) return;

    // Don't capture if user is typing in an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    e.preventDefault();
    this.recallByHotkey(num);
  };

  // --- Private helpers ---

  #presetsForCurrentMap() {
    if (!this.#currentMapId) return [...this.#presets.values()];
    return [...this.#presets.values()].filter(p => p.mapId === this.#currentMapId);
  }

  #saveToStorage() {
    try {
      const data = JSON.stringify([...this.#presets.values()]);
      localStorage.setItem(STORAGE_KEY, data);
    } catch (e) {
      console.warn('[CameraPresetManager] Failed to save presets to localStorage:', e);
    }
  }

  #loadFromStorage() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return;
      const presets = JSON.parse(data);
      for (const p of presets) {
        this.#presets.set(p.id, p);
      }
    } catch (e) {
      console.warn('[CameraPresetManager] Failed to load presets from localStorage:', e);
    }
  }

  destroy() {
    this.unbindHotkeys();
  }
}
```

### Syncing presets across windows

Presets are created and managed on the Controller, then synced to other windows via a `PRESET_SYNC` message. This is an infrequent broadcast (only on CRUD operations), so sending the full preset list is simpler and more reliable than delta patching.

```javascript
// In the Controller's CameraSyncEngine, after preset CRUD operations:

#syncPresets() {
  const msg = createPresetSyncMsg(this.#windowId, ++this.#seq, {
    presets: this.#presetManager.exportAll(),
  });
  this.#channel.postMessage(msg);
}

// On the receiver side, in handleMessage:
case MSG.PRESET_SYNC:
  this.#presetManager.importAll(msg.payload.presets);
  break;
```

The WELCOME handshake from Phase 4 is extended to include presets:

```javascript
// In the WELCOME payload:
{
  type: MSG.WELCOME,
  // ... existing fields ...
  payload: {
    camera: { centerX, centerY, zoom },
    presets: presetManager.exportAll(),   // Phase 5 addition
    // authority state will go here in Section 8
  },
}
```

---

## 4. Fit-to-tokens: automatic content framing

### The concept

"Fit-to-tokens" computes the bounding box of all visible tokens on the map and animates the camera to frame them with comfortable padding. This is Figma's "Zoom to Selection" adapted for tabletop RPGs. The DM clicks one button and the camera smoothly frames the action, whether the party is clustered in a 10-foot room or spread across a 200-foot battlefield.

Foundry VTT has no equivalent. Roll20 has no equivalent. This is a genuine differentiator.

### The algorithm

The fit-to-tokens calculation has four steps:

1. Collect world-space bounding boxes of all eligible tokens
2. Compute the union bounding box
3. Add padding (in world-space units)
4. Compute the zoom level that fits this padded box into the viewport

```javascript
// vtt/js/fit-to-tokens.js
// Automatic content framing for the camera.

import { EventBus } from './event-bus.js';

/**
 * Which tokens to include in the framing calculation.
 * The DM can toggle between these modes.
 *
 * 'all'        - every visible token on the map
 * 'pcs'        - only player character tokens
 * 'combatants' - only tokens in the current initiative order
 * 'selected'   - only tokens the DM has selected (future feature)
 */
const FRAME_MODES = ['all', 'pcs', 'combatants'];

/**
 * Padding around the token bounding box, as a fraction of the
 * bounding box dimensions. 0.15 means 15% padding on each side,
 * so the tokens occupy roughly 70% of the viewport.
 *
 * This value was chosen by testing. Too little padding makes tokens
 * feel cramped against the viewport edge. Too much wastes screen space.
 * 15% matches Figma's "Zoom to Selection" padding ratio.
 */
const DEFAULT_PADDING_RATIO = 0.15;

/**
 * Minimum padding in world-space pixels. Prevents the padding from
 * collapsing to nothing when tokens are very close together.
 * A single grid cell (typically 70px in world space) is a good minimum.
 */
const MIN_PADDING_PX = 70;

/**
 * Compute a camera target that frames a set of tokens.
 *
 * @param {TokenData[]} tokens - array of token objects with world-space positions
 * @param {{ w: number, h: number }} viewport - viewport dimensions in pixels
 * @param {Object} [opts]
 * @param {string} [opts.mode='all']           - which tokens to include
 * @param {number} [opts.paddingRatio=0.15]    - padding as fraction of bounds
 * @param {number} [opts.minPadding=70]        - minimum padding in world px
 * @param {number} [opts.maxZoom]              - don't zoom closer than this
 * @param {number} [opts.gridSize=70]          - grid cell size in world px
 * @returns {SharedCameraState|null} target camera state, or null if no tokens
 *
 * @typedef {Object} TokenData
 * @property {number} x       - world-space X of token center
 * @property {number} y       - world-space Y of token center
 * @property {number} size    - token size in grid cells (1 = medium, 2 = large)
 * @property {boolean} isPC   - is this a player character?
 * @property {boolean} visible - is this token visible on the map?
 * @property {boolean} inInitiative - is this token in the initiative order?
 */
export function computeFitToTokens(tokens, viewport, opts = {}) {
  const mode = opts.mode ?? 'all';
  const paddingRatio = opts.paddingRatio ?? DEFAULT_PADDING_RATIO;
  const minPadding = opts.minPadding ?? MIN_PADDING_PX;
  const gridSize = opts.gridSize ?? 70;

  // Step 1: Filter tokens by mode
  let eligible = tokens.filter(t => t.visible);
  switch (mode) {
    case 'pcs':
      eligible = eligible.filter(t => t.isPC);
      break;
    case 'combatants':
      eligible = eligible.filter(t => t.inInitiative);
      break;
    // 'all' uses the full visible set
  }

  if (eligible.length === 0) return null;

  // Step 2: Compute the union bounding box in world space.
  // Token positions are center points. Expand by half the token's
  // world-space size to get the actual bounding box.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const token of eligible) {
    const halfSize = (token.size * gridSize) / 2;
    minX = Math.min(minX, token.x - halfSize);
    minY = Math.min(minY, token.y - halfSize);
    maxX = Math.max(maxX, token.x + halfSize);
    maxY = Math.max(maxY, token.y + halfSize);
  }

  const boundsW = maxX - minX;
  const boundsH = maxY - minY;

  // Step 3: Add padding
  const padX = Math.max(boundsW * paddingRatio, minPadding);
  const padY = Math.max(boundsH * paddingRatio, minPadding);

  const paddedW = boundsW + padX * 2;
  const paddedH = boundsH + padY * 2;

  // Step 4: Compute the zoom level that fits the padded box.
  // This is the "contain" calculation: the zoom where the box
  // fits entirely within the viewport.
  const fitZoom = Math.min(
    viewport.w / paddedW,
    viewport.h / paddedH
  );

  // Optionally clamp to a maximum zoom (don't zoom in too close
  // to a single token; it's disorienting)
  const zoom = opts.maxZoom ? Math.min(fitZoom, opts.maxZoom) : fitZoom;

  // The center point is the center of the bounding box
  const centerX = minX + boundsW / 2;
  const centerY = minY + boundsH / 2;

  return { centerX, centerY, zoom };
}

/**
 * A higher-level function that computes fit-to-tokens and triggers a flyTo.
 * This is the function the Controller calls when the DM clicks "Frame Action."
 *
 * @param {CameraAnimator} animator
 * @param {TokenManager} tokenManager
 * @param {{ w: number, h: number }} viewport
 * @param {Object} [opts]
 */
export function flyToTokens(animator, tokenManager, viewport, opts = {}) {
  // Gather token data from the TokenManager.
  // The TokenManager from Phase 1 tracks all tokens on the current map.
  const tokenData = tokenManager.getAll().map(t => ({
    x: t.worldX,
    y: t.worldY,
    size: t.size ?? 1,
    isPC: t.isPC ?? false,
    visible: t.visible !== false,
    inInitiative: t.inInitiative ?? false,
  }));

  const target = computeFitToTokens(tokenData, viewport, opts);

  if (!target) {
    console.warn('[fitToTokens] No eligible tokens to frame.');
    return null;
  }

  const flyOpts = {
    rho: 1.2,   // slightly less dramatic arc for short-range framing
    speed: 1.5, // slightly faster since framing is a utility, not cinematic
    ...opts,
  };

  animator.flyTo(target, flyOpts);

  // Return the target and resolved options so callers can broadcast
  // a matching CAMERA_FLY_TO to other windows.
  return { target, flyOpts };
}
```

### Single-token edge case

When there is exactly one token, the bounding box has zero width and height. The `minPadding` ensures the padding is at least one grid cell, so the camera frames a reasonable area around the token rather than zooming to infinity. The `maxZoom` parameter provides an additional safety net.

---

## 5. Semantic zoom: progressive detail by zoom level

### The philosophy

Ben Shneiderman's information-seeking mantra is "overview first, zoom and filter, then details on demand." Semantic zoom applies this principle to the map: when zoomed out, you see the big picture (tokens as colored dots, no labels). When zoomed in, you see the details (token names, condition icons, HP bars, grid coordinates).

Google Maps is the canonical example. At zoom level 3, you see country names. At zoom level 8, you see city names. At zoom level 15, you see street names. Each zoom level adds a layer of detail appropriate to the scale.

For the VTT, the relevant detail layers are: grid coordinate labels, token name labels, condition indicator icons, HP bars, and token size detail (border decorations vs. simple circles).

### Implementation

Semantic zoom is implemented as a visibility controller that listens for `camera:changed` events and updates CSS classes on the map container. The actual show/hide logic is in CSS, driven by classes that the JavaScript sets.

The key design decision is **hysteresis**: using different zoom thresholds for showing and hiding elements. Without hysteresis, a label that appears at zoom 1.5 and disappears at zoom 1.5 flickers rapidly as the user zooms near that boundary. With hysteresis, the label appears at zoom 1.5 but doesn't disappear until zoom drops below 1.3. The 0.2 "dead zone" prevents flickering.

```javascript
// vtt/js/semantic-zoom.js
// Progressive detail visibility based on camera zoom level.

import { EventBus } from './event-bus.js';

/**
 * Semantic zoom thresholds. Each entry defines:
 * - cssClass: the class toggled on the map container
 * - showAt:   zoom level at which the detail appears
 * - hideAt:   zoom level at which the detail disappears (must be < showAt)
 *
 * The gap between showAt and hideAt is the hysteresis band.
 * This prevents flickering when the zoom oscillates near a threshold.
 *
 * These values are expressed as ratios relative to the cover zoom.
 * A value of 1.0 means "at cover zoom" (the default zoom that fills the viewport).
 * A value of 2.0 means "zoomed in 2x from cover."
 *
 * Expressing thresholds relative to cover zoom means they adapt automatically
 * to different map sizes and viewport aspect ratios.
 */
const ZOOM_THRESHOLDS = [
  {
    cssClass: 'sz-grid-labels',
    showAt: 1.8,
    hideAt: 1.5,
    description: 'Grid coordinate labels (A1, B2, etc.)',
  },
  {
    cssClass: 'sz-token-names',
    showAt: 1.2,
    hideAt: 1.0,
    description: 'Token name labels below each token',
  },
  {
    cssClass: 'sz-condition-icons',
    showAt: 1.4,
    hideAt: 1.1,
    description: 'Condition status icons on tokens',
  },
  {
    cssClass: 'sz-hp-bars',
    showAt: 1.6,
    hideAt: 1.3,
    description: 'HP bars above/below tokens',
  },
  {
    cssClass: 'sz-token-detail',
    showAt: 2.0,
    hideAt: 1.7,
    description: 'Detailed token borders, size indicators',
  },
];

export class SemanticZoomController {
  /** @type {HTMLElement} the map container element */
  #container;

  /** @type {number} the current cover zoom, updated on resize and map load */
  #coverZoom = 1;

  /** @type {Set<string>} currently active CSS classes */
  #activeClasses = new Set();

  /** @type {Object[]} the threshold configuration (can be customized) */
  #thresholds;

  /**
   * @param {HTMLElement} container - the element to toggle classes on
   * @param {Object[]} [thresholds] - override the default thresholds
   */
  constructor(container, thresholds) {
    this.#container = container;
    this.#thresholds = thresholds ?? ZOOM_THRESHOLDS;

    // Listen for camera changes
    EventBus.on('camera:changed', this.#onCameraChanged);
    EventBus.on('camera:cover-zoom-changed', this.#onCoverZoomChanged);
  }

  /**
   * Update the cover zoom baseline. Called when the viewport resizes
   * or a new map loads.
   */
  #onCoverZoomChanged = ({ coverZoom }) => {
    this.#coverZoom = coverZoom;
  };

  /**
   * Evaluate all thresholds against the current zoom level.
   * Toggle CSS classes as needed.
   */
  #onCameraChanged = ({ zoom }) => {
    if (this.#coverZoom <= 0) return;

    // Normalize zoom to a ratio of cover zoom.
    // At cover zoom, ratio = 1.0.
    // Zoomed in 2x, ratio = 2.0.
    const zoomRatio = zoom / this.#coverZoom;

    for (const threshold of this.#thresholds) {
      const isActive = this.#activeClasses.has(threshold.cssClass);

      if (!isActive && zoomRatio >= threshold.showAt) {
        // Cross the "show" threshold: add the class
        this.#container.classList.add(threshold.cssClass);
        this.#activeClasses.add(threshold.cssClass);
      } else if (isActive && zoomRatio < threshold.hideAt) {
        // Cross the "hide" threshold: remove the class
        this.#container.classList.remove(threshold.cssClass);
        this.#activeClasses.delete(threshold.cssClass);
      }
      // If we're in the hysteresis band (between hideAt and showAt),
      // don't change anything. This prevents flickering.
    }
  };

  /** Reset all semantic zoom classes (e.g., on map change) */
  reset() {
    for (const cls of this.#activeClasses) {
      this.#container.classList.remove(cls);
    }
    this.#activeClasses.clear();
  }

  destroy() {
    EventBus.off('camera:changed', this.#onCameraChanged);
    EventBus.off('camera:cover-zoom-changed', this.#onCoverZoomChanged);
    this.reset();
  }
}
```

### The CSS rules

The semantic zoom classes control visibility via CSS transitions. Elements fade in/out over 200ms for a polished feel rather than snapping on/off.

```css
/* vtt/css/semantic-zoom.css */

/*
 * Semantic zoom: progressive detail visibility.
 *
 * Each .sz-* class is toggled by SemanticZoomController based on
 * the current zoom ratio. Elements in each category start hidden
 * (opacity: 0, pointer-events: none) and transition to visible
 * when their class is active on the container.
 *
 * The 200ms transition prevents jarring pop-in/pop-out during
 * continuous zoom. Elements fade smoothly as the user scrolls.
 */

/* --- Default: everything hidden --- */

.token-label,
.grid-label,
.condition-icon,
.hp-bar,
.token-detail-border {
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease-out;
}

/* --- Grid coordinate labels --- */
.sz-grid-labels .grid-label {
  opacity: 0.6;
  pointer-events: auto;
}

/* --- Token name labels --- */
.sz-token-names .token-label {
  opacity: 1;
  pointer-events: auto;
}

/* --- Condition status icons --- */
.sz-condition-icons .condition-icon {
  opacity: 1;
  pointer-events: auto;
}

/* --- HP bars --- */
.sz-hp-bars .hp-bar {
  opacity: 1;
  pointer-events: auto;
}

/* --- Detailed token borders --- */
.sz-token-detail .token-detail-border {
  opacity: 1;
}
```

### Why opacity instead of display: none

Using `opacity` with CSS transitions produces a smooth visual fade. Using `display: none` or `visibility: hidden` snaps instantly and cannot be animated. The `pointer-events: none` ensures hidden elements don't interfere with click/hover events on tokens underneath.

The 200ms transition duration is a deliberate choice. Faster transitions (100ms) feel jittery during continuous zoom. Slower transitions (400ms) create a "ghosting" effect where labels linger after the user has zoomed past the threshold. 200ms is the sweet spot that Google Maps and Mapbox use for their zoom-dependent label transitions.

---

## 6. Receiver-side exponential decay interpolation

### The problem

Phase 4 streams camera state at 30fps from the Controller to the Display. On a 60Hz display, this means every other frame shows the same camera position. During fast panning, this creates a subtle stutter: the map jumps 33ms worth of movement, holds for one frame, jumps again, holds for one frame. The stutter is visible to anyone paying attention, though most users won't consciously identify the cause.

### The solution

Exponential decay interpolation smooths the 30fps updates into 60fps rendering by treating each received camera state as a target and smoothly converging toward it. The formula is:

```
value = target + (current - target) * Math.pow(0.5, dt / halfLife)
```

This is frame-rate-independent. Running it 60 times at 1/60s delta produces the same result as running it 30 times at 1/30s delta, or once at 1s delta. This property comes from the exponential function's self-similar nature, as Freya Holmer and Rory Driscoll have explained in widely-cited analyses of the "lerp smoothing is broken" problem in game development.

The `halfLife` parameter controls how fast the camera converges on the target. A half-life of 50ms means the camera closes half the remaining gap every 50ms. At 60fps, that means convergence to within 1 pixel after about 5 frames (83ms). Short enough to feel responsive, long enough to smooth the stepping.

```javascript
// vtt/js/camera-interpolator.js
// Smooths 30fps camera sync updates into 60fps rendering on the Display.

import { EventBus } from './event-bus.js';

/**
 * Half-life in seconds for exponential decay interpolation.
 *
 * 0.05 (50ms): fast convergence. Camera tracks authority tightly.
 *   Good for responsive following during DM panning.
 *
 * 0.1 (100ms): softer convergence. Slight "floatiness."
 *   Good for cinematic smoothness.
 *
 * 0.02 (20ms): very fast. Nearly eliminates smoothing.
 *   Good for low-latency scenarios.
 *
 * We default to 50ms. This is the same value tldraw uses for their
 * multiplayer cursor smoothing.
 */
const DEFAULT_HALF_LIFE = 0.05;

/**
 * Epsilon threshold for considering the interpolation "converged."
 * When the difference between current and target is below this on
 * all axes, we stop the render loop to save CPU.
 *
 * 0.01 pixels is well below the visible threshold.
 */
const CONVERGENCE_EPSILON = 0.01;

/**
 * The exponential decay function. Frame-rate-independent by design.
 *
 * @param {number} current  - current value
 * @param {number} target   - target value
 * @param {number} halfLife - seconds for half the gap to close
 * @param {number} dt       - seconds since last frame
 * @returns {number} new value
 */
function expDecay(current, target, halfLife, dt) {
  // The formula: target + (current - target) * 2^(-dt/halfLife)
  // When dt = halfLife, the gap halves. When dt = 2*halfLife, it quarters.
  // This is mathematically equivalent to:
  //   lerp(current, target, 1 - exp(-lambda * dt))
  // where lambda = ln(2) / halfLife.
  //
  // Using Math.pow(0.5, ...) is slightly more intuitive because the
  // halfLife parameter directly maps to "how many seconds to halve the gap."
  return target + (current - target) * Math.pow(0.5, dt / halfLife);
}

export class CameraInterpolator {
  /** @type {import('./map-camera.js').Camera} */
  #camera;

  /** Target camera state (from the most recent CAMERA_SYNC message) */
  #target = { x: 0, y: 0, zoom: 1 };

  /** Current interpolated state */
  #current = { x: 0, y: 0, zoom: 1 };

  /** Whether we have a target to interpolate toward */
  #hasTarget = false;

  /** Timestamp of the last frame */
  #lastFrameTime = 0;

  /** rAF handle */
  #rafId = null;

  /** Half-life parameter */
  #halfLife;

  /**
   * When true, the interpolation loop is actively running.
   * We stop it when converged to avoid burning CPU.
   */
  #isRunning = false;

  /**
   * Reference to the CameraAnimator. When a flyTo is active,
   * we don't interpolate (the animator is driving the camera).
   */
  #animator;

  /**
   * @param {Camera} camera
   * @param {CameraAnimator} animator
   * @param {Object} [opts]
   * @param {number} [opts.halfLife=0.05]
   */
  constructor(camera, animator, opts = {}) {
    this.#camera = camera;
    this.#animator = animator;
    this.#halfLife = opts.halfLife ?? DEFAULT_HALF_LIFE;

    // Initialize current state from camera
    this.#current = { x: camera.x, y: camera.y, zoom: camera.zoom };
  }

  /**
   * Called when a new CAMERA_SYNC message arrives from the authority.
   * Sets the target and starts the interpolation loop if needed.
   *
   * @param {{ x: number, y: number, zoom: number }} localState
   *   The received state already converted to local coordinates.
   */
  setTarget(localState) {
    this.#target = { ...localState };
    this.#hasTarget = true;

    if (!this.#isRunning) {
      this.#lastFrameTime = performance.now();
      this.#startLoop();
    }
  }

  /**
   * The render loop. Runs at display refresh rate.
   * On each frame, interpolates the current camera position toward
   * the target using exponential decay.
   */
  #tick = (now) => {
    if (!this.#hasTarget) {
      this.#stopLoop();
      return;
    }

    // Don't interpolate while a flyTo animation is running.
    // The animator is driving the camera in that case.
    if (this.#animator.isAnimating) {
      this.#rafId = requestAnimationFrame(this.#tick);
      return;
    }

    const dt = (now - this.#lastFrameTime) / 1000; // convert to seconds
    this.#lastFrameTime = now;

    // Clamp dt to prevent huge jumps after tab visibility changes
    const clampedDt = Math.min(dt, 0.1); // max 100ms

    // Apply exponential decay to each axis
    this.#current.x = expDecay(this.#current.x, this.#target.x, this.#halfLife, clampedDt);
    this.#current.y = expDecay(this.#current.y, this.#target.y, this.#halfLife, clampedDt);
    this.#current.zoom = expDecay(this.#current.zoom, this.#target.zoom, this.#halfLife, clampedDt);

    // Check for convergence
    const dx = Math.abs(this.#current.x - this.#target.x);
    const dy = Math.abs(this.#current.y - this.#target.y);
    const dz = Math.abs(this.#current.zoom - this.#target.zoom);

    if (dx < CONVERGENCE_EPSILON && dy < CONVERGENCE_EPSILON && dz < CONVERGENCE_EPSILON) {
      // Snap to exact target and stop the loop
      this.#camera.setPosition(this.#target.x, this.#target.y, this.#target.zoom);
      this.#current = { ...this.#target };
      this.#stopLoop();
      return;
    }

    // Apply the interpolated state to the camera.
    // This runs inside a rAF callback, outside the receiver's synchronous
    // suppress window. The broadcaster must check interpolator.suppressBroadcast
    // (which returns true while #isRunning) to avoid echoing these frames.
    this.#camera.setPosition(this.#current.x, this.#current.y, this.#current.zoom);

    // Request next frame
    this.#rafId = requestAnimationFrame(this.#tick);
  };

  #startLoop() {
    if (this.#isRunning) return;
    this.#isRunning = true;
    this.#rafId = requestAnimationFrame(this.#tick);
  }

  #stopLoop() {
    this.#isRunning = false;
    if (this.#rafId !== null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
  }

  /** @returns {boolean} */
  get isRunning() {
    return this.#isRunning;
  }

  /**
   * Returns true whenever the interpolation loop is active.
   * The broadcaster must check this flag before sending, because
   * the interpolator's rAF-driven setPosition() calls happen
   * outside the receiver's synchronous suppress window.
   * @returns {boolean}
   */
  get suppressBroadcast() {
    return this.#isRunning;
  }

  destroy() {
    this.#stopLoop();
    this.#hasTarget = false;
  }
}
```

### Integration with the CameraReceiver

The interpolator sits between the receiver and the camera. Instead of the receiver applying state directly to the camera, it feeds the interpolator:

```javascript
// In CameraReceiver, modify the CAMERA_SYNC handler:

#handleCameraSync(msg) {
  // ... existing sequence number check, stale rejection, etc. ...

  const localState = sharedToLocal(msg.payload, this.#viewport);

  if (this.#interpolator) {
    // Phase 5: feed through interpolator for smooth 60fps rendering
    this.#interpolator.setTarget(localState);
  } else {
    // Fallback: apply directly (Phase 4 behavior)
    this.#camera.deserialize({ ...localState, mapW: this.#camera.mapW, mapH: this.#camera.mapH });
  }
}
```

### When NOT to interpolate

Interpolation should be skipped in two scenarios:

1. **During flyTo animations.** The animator is driving the camera at 60fps already. Interpolating on top of interpolation produces a sluggish, laggy feel. The `#tick` method checks `this.#animator.isAnimating` and skips when true.

2. **For CAMERA_JUMP_TO messages.** An instant teleport should be instant. The receiver should apply the jump directly to the camera, bypassing the interpolator, and also reset the interpolator's current state so it doesn't try to smoothly converge from the old position.

```javascript
// In CameraReceiver, for CAMERA_JUMP_TO:
#handleJumpTo(msg) {
  const localState = sharedToLocal(msg.payload, this.#viewport);
  this.#camera.setPosition(localState.x, localState.y, localState.zoom);

  // Reset interpolator to prevent smooth convergence from old position
  if (this.#interpolator) {
    this.#interpolator.setTarget(localState);
    // Force current = target immediately
    this.#interpolator.snapToTarget();
  }
}
```

Add this method to CameraInterpolator:

```javascript
/** Instantly set current = target. Used after CAMERA_JUMP_TO. */
snapToTarget() {
  this.#current = { ...this.#target };
  this.#stopLoop();
}
```

### Broadcaster send guard: checking all suppress sources

Phase 4's `CameraBroadcaster` checks a single `#suppressBroadcast` flag set synchronously by the receiver. Phase 5 introduces two additional sources of camera motion that must not be echoed back: the `CameraAnimator` (for receiver-side flyTo playback) and the `CameraInterpolator` (for 60fps smoothing). Both expose a `suppressBroadcast` getter that returns `true` while they are driving the camera.

The broadcaster's `#tick` method must check all three flags before sending:

```javascript
// In CameraBroadcaster's #tick (the rAF-aligned send loop):
#tick = () => {
  // ... existing timing / throttle logic ...

  // Do not broadcast state that originated from received messages,
  // from a receiver-side flyTo animation, or from interpolation smoothing.
  if (this.#suppressBroadcast) return;
  if (this.#animator?.suppressBroadcast) return;
  if (this.#interpolator?.suppressBroadcast) return;

  // ... existing serialize + postMessage logic ...
};
```

The `CameraBroadcaster` needs references to these objects. Add them during construction or through setters:

```javascript
// In CameraBroadcaster:
#animator = null;
#interpolator = null;

setAnimator(animator) { this.#animator = animator; }
setInterpolator(interpolator) { this.#interpolator = interpolator; }
```

---

## 7. ISyncTransport abstraction and CompositeTransport

### Why now

Phase 4 deferred this because wrapping BroadcastChannel behind an interface before a second transport exists is premature abstraction. Phase 5 introduces it because:

1. The authority election protocol (Section 8) needs to reason about transport state (connected/disconnected) without caring which transport is active.
2. The debug overlay (Section 9) needs to measure latency and throughput for whichever transport is in use.
3. The eventual WebSocket migration (Phase 6+) will be a transport swap rather than a protocol rewrite if the interface is already in place.

The interface is deliberately minimal. BroadcastChannel and WebSocket have very different connection semantics, so the abstraction captures only what the camera sync protocol actually needs.

```javascript
// shared/sync/ISyncTransport.js
// Interface for camera sync transports.
// BroadcastChannel and (future) WebSocket both implement this.

/**
 * @typedef {Object} SyncMessage
 * @property {string} type     - message type (from MSG constants)
 * @property {string} id       - crypto.randomUUID() per message
 * @property {string} sender   - window/client ID
 * @property {number} seq      - per-sender monotonic counter
 * @property {number} ts       - absolute timestamp (performance.timeOrigin + performance.now())
 * @property {*} payload       - message-specific data
 */

/**
 * Base class for sync transports. Uses the "abstract base class"
 * pattern since vanilla JS doesn't have interfaces.
 *
 * Concrete implementations must override: connected, type, send,
 * onMessage, onConnectionChange, connect, disconnect, destroy.
 */
export class ISyncTransport {
  /** @returns {boolean} Whether the transport is currently connected */
  get connected() {
    throw new Error('ISyncTransport.connected not implemented');
  }

  /** @returns {string} Transport type identifier ('broadcast-channel' or 'websocket') */
  get type() {
    throw new Error('ISyncTransport.type not implemented');
  }

  /**
   * Send a message to all connected peers.
   * @param {SyncMessage} msg
   */
  send(msg) {
    throw new Error('ISyncTransport.send not implemented');
  }

  /**
   * Register a handler for incoming messages.
   * @param {(msg: SyncMessage) => void} handler
   */
  onMessage(handler) {
    throw new Error('ISyncTransport.onMessage not implemented');
  }

  /**
   * Register a handler for connection state changes.
   * @param {(connected: boolean) => void} handler
   */
  onConnectionChange(handler) {
    throw new Error('ISyncTransport.onConnectionChange not implemented');
  }

  /**
   * Open the transport connection.
   * @returns {Promise<void>}
   */
  async connect() {
    throw new Error('ISyncTransport.connect not implemented');
  }

  /** Close the transport connection. */
  disconnect() {
    throw new Error('ISyncTransport.disconnect not implemented');
  }

  /** Clean up all resources. */
  destroy() {
    throw new Error('ISyncTransport.destroy not implemented');
  }
}
```

### BroadcastChannel transport

This wraps the existing BroadcastChannel usage from Phase 4 behind the interface.

```javascript
// shared/sync/BroadcastChannelTransport.js

import { ISyncTransport } from './ISyncTransport.js';

export class BroadcastChannelTransport extends ISyncTransport {
  #channel = null;
  #channelName;
  #messageHandlers = [];
  #connectionHandlers = [];

  /**
   * @param {string} channelName - BroadcastChannel name (e.g., 'vtt-camera')
   */
  constructor(channelName) {
    super();
    this.#channelName = channelName;
  }

  get connected() { return this.#channel !== null; }
  get type() { return 'broadcast-channel'; }

  send(msg) {
    if (!this.#channel) {
      console.warn('[BCTransport] Cannot send: channel not connected');
      return;
    }
    this.#channel.postMessage(msg);
  }

  onMessage(handler) {
    this.#messageHandlers.push(handler);
  }

  onConnectionChange(handler) {
    this.#connectionHandlers.push(handler);
  }

  async connect() {
    if (this.#channel) return; // already connected

    this.#channel = new BroadcastChannel(this.#channelName);
    this.#channel.onmessage = (event) => {
      for (const handler of this.#messageHandlers) {
        handler(event.data);
      }
    };

    // BroadcastChannel is "connected" immediately upon creation
    for (const handler of this.#connectionHandlers) {
      handler(true);
    }
  }

  disconnect() {
    if (!this.#channel) return;
    this.#channel.close();
    this.#channel = null;

    for (const handler of this.#connectionHandlers) {
      handler(false);
    }
  }

  destroy() {
    this.disconnect();
    this.#messageHandlers = [];
    this.#connectionHandlers = [];
  }
}
```

### Migrating existing code

The migration from direct BroadcastChannel usage to the transport abstraction is mechanical. In `CameraBroadcaster`, replace:

```javascript
// OLD (Phase 4):
this.#channel.postMessage(msg);

// NEW (Phase 5):
this.#transport.send(msg);
```

In `CameraReceiver`, replace:

```javascript
// OLD (Phase 4):
this.#channel.onmessage = (event) => { this.#handleMessage(event); };

// NEW (Phase 5):
this.#transport.onMessage((msg) => { this.#handleMessage({ data: msg }); });
```

The `CameraChannelManager` from Phase 4 becomes a thin wrapper that creates a `BroadcastChannelTransport` and manages its lifecycle. The Page Lifecycle integration (close on `pagehide`, recreate on `pageshow`) calls `transport.disconnect()` and `transport.connect()` instead of directly manipulating the BroadcastChannel.

---

## 8. Deterministic authority election

### The problem Phase 4 left unsolved

Phase 4's simple model assumes one Controller and one Display. The Controller always sends, the Display always receives. But what happens when:

1. Two DMs open Controller tabs simultaneously?
2. The active Controller crashes and a backup Controller should take over?
3. The DM wants to hand control to a co-DM?

Deterministic authority election answers these questions with a simple protocol: the Controller with the lowest `windowId` is the authority. All other Controllers observe silently. When the authority disconnects, the next-lowest Controller automatically becomes authority.

### The election protocol

```javascript
// vtt/js/authority-election.js
// Deterministic authority election for multi-Controller coordination.

import { EventBus } from './event-bus.js';

/**
 * Authority election using the "lowest ID wins" rule.
 *
 * The protocol:
 *
 * 1. When a Controller connects, it broadcasts AUTHORITY_CLAIM with its windowId.
 * 2. If another Controller is already authority and has a lower ID, it responds
 *    with its own AUTHORITY_CLAIM. The new Controller sees the lower ID and
 *    defers (becomes a passive observer).
 * 3. If the new Controller has a lower ID than the current authority, the current
 *    authority sees the claim, compares IDs, and yields.
 * 4. When the authority disconnects (GOODBYE or heartbeat timeout), the remaining
 *    Controller with the lowest ID claims authority.
 *
 * This is a simplified version of the Bully election algorithm,
 * adapted for the case where all participants can communicate directly
 * (BroadcastChannel, unlike a network, guarantees delivery to all peers
 * in the same origin).
 *
 * Display windows never participate in election. They enter "orphan mode"
 * (showing a "Waiting for DM..." overlay) when no Controllers are present.
 */
export class AuthorityElection {
  /** @type {string} this window's ID */
  #windowId;

  /** @type {string} role: 'controller' | 'display' | 'dm-guide' */
  #role;

  /** @type {boolean} whether this window is currently the authority */
  #isAuthority = false;

  /** @type {WindowRegistry} peer tracking from Phase 4 */
  #registry;

  /** @type {ISyncTransport} */
  #transport;

  /**
   * @param {string} windowId
   * @param {string} role
   * @param {WindowRegistry} registry
   * @param {ISyncTransport} transport
   */
  constructor(windowId, role, registry, transport) {
    this.#windowId = windowId;
    this.#role = role;
    this.#registry = registry;
    this.#transport = transport;

    // Only Controllers participate in election
    if (role === 'controller') {
      this.#transport.onMessage(this.#handleMessage);
      this.#registry.onPeerChange(this.#onPeerChange);
    }
  }

  /** @returns {boolean} */
  get isAuthority() {
    return this.#isAuthority;
  }

  /**
   * Initiate an election. Called when:
   * - This Controller first connects
   * - The current authority disconnects
   */
  elect() {
    if (this.#role !== 'controller') return;

    // Get all connected Controllers from the registry
    const controllers = this.#registry.getPeersByRole('controller');
    const allControllerIds = [...controllers.map(p => p.windowId), this.#windowId].sort();

    // Lowest ID wins
    const shouldBeAuthority = allControllerIds[0] === this.#windowId;

    if (shouldBeAuthority && !this.#isAuthority) {
      this.#isAuthority = true;
      this.#broadcastClaim();
      EventBus.emit('authority:claimed', { windowId: this.#windowId });
    } else if (!shouldBeAuthority && this.#isAuthority) {
      this.#isAuthority = false;
      EventBus.emit('authority:yielded', { windowId: this.#windowId, newAuthority: allControllerIds[0] });
    }
  }

  #broadcastClaim() {
    this.#transport.send({
      type: 'AUTHORITY_CLAIM',
      id: crypto.randomUUID(),
      sender: this.#windowId,
      seq: 0,
      ts: performance.timeOrigin + performance.now(),
      payload: { windowId: this.#windowId, role: this.#role },
    });
  }

  #handleMessage = (msg) => {
    if (msg.type === 'AUTHORITY_CLAIM' && msg.sender !== this.#windowId) {
      // Another Controller is claiming authority.
      // If their ID is lower, we yield. If ours is lower, we re-claim.
      if (msg.payload.windowId < this.#windowId) {
        if (this.#isAuthority) {
          this.#isAuthority = false;
          EventBus.emit('authority:yielded', { windowId: this.#windowId, newAuthority: msg.payload.windowId });
        }
      } else {
        // Our ID is lower. Re-broadcast our claim.
        if (this.#isAuthority) {
          this.#broadcastClaim();
        }
      }
    }
  };

  #onPeerChange = ({ event, peer }) => {
    if (event === 'left' && peer.role === 'controller') {
      // A Controller left. If we're not already authority, check if we should be.
      this.elect();
    }
  };

  destroy() {
    this.#isAuthority = false;
  }
}
```

### Orphan mode for the Display

When no Controllers are connected, the Display shows a subtle overlay indicating it's waiting for a DM to connect. This prevents the Display from appearing broken when the Controller tab is closed.

```javascript
// In the Display's CameraSyncEngine, track controller count:

#updateOrphanMode() {
  const controllers = this.#registry.getPeersByRole('controller');
  const isOrphan = controllers.length === 0;
  const overlay = document.getElementById('orphan-overlay');

  if (isOrphan && overlay) {
    overlay.classList.add('orphan-overlay--visible');
  } else if (overlay) {
    overlay.classList.remove('orphan-overlay--visible');
  }
}
```

```css
/* vtt/css/orphan-overlay.css */

.orphan-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  opacity: 0;
  pointer-events: none;
  transition: opacity 500ms ease-out;
  z-index: 1000;
}

.orphan-overlay--visible {
  opacity: 1;
}

.orphan-overlay__message {
  color: white;
  font-size: 1.25rem;
  padding: 1rem 2rem;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 8px;
}
```

---

## 9. Debug overlay and performance instrumentation

### Console debug wrapper

The first layer of observability is color-coded console logging that wraps the transport. This is toggled via `localStorage.setItem('debug-sync', 'true')` and adds zero overhead when disabled.

```javascript
// shared/sync/debug-transport.js
// Wraps an ISyncTransport with color-coded console logging.

import { ISyncTransport } from './ISyncTransport.js';

/**
 * Creates a debug-instrumented transport that logs all sent and
 * received messages with color-coded output.
 *
 * @param {ISyncTransport} transport - the real transport to wrap
 * @param {string} label - label for log messages (e.g., 'Controller', 'Display')
 * @returns {ISyncTransport} instrumented transport (or original if debug disabled)
 */
export function wrapWithDebugLogging(transport, label) {
  if (typeof localStorage === 'undefined') return transport;
  if (localStorage.getItem('debug-sync') !== 'true') return transport;

  const originalSend = transport.send.bind(transport);
  transport.send = (msg) => {
    console.log(
      `%c[${label}] >> ${msg.type}`,
      'color: #4CAF50; font-weight: bold',
      msg.payload
    );
    originalSend(msg);
  };

  const originalOnMessage = transport.onMessage.bind(transport);
  transport.onMessage = (handler) => {
    originalOnMessage((msg) => {
      console.log(
        `%c[${label}] << ${msg.type} from ${msg.sender.slice(0, 6)}`,
        'color: #2196F3; font-weight: bold',
        msg.payload
      );
      handler(msg);
    });
  };

  return transport;
}
```

### Performance tracking with the Performance API

```javascript
// shared/sync/latency-tracker.js
// Measures cross-window latency using high-resolution timestamps.

export class SyncLatencyTracker {
  /** @type {number[]} rolling window of latency measurements */
  #measurements = [];

  /** @type {number} maximum measurements to keep */
  #maxSamples;

  /** @type {{ sent: number, received: number }} message count per second */
  #rates = { sent: 0, received: 0 };
  #rateWindow = { sent: 0, received: 0, lastReset: performance.now() };

  constructor(maxSamples = 300) {
    this.#maxSamples = maxSamples;
  }

  trackSend() {
    this.#rateWindow.sent++;
  }

  trackReceive(senderTimestamp) {
    this.#rateWindow.received++;

    // Cross-window latency. Both windows use performance.timeOrigin + performance.now()
    // for timestamps, which gives absolute time. The difference is the transit latency.
    // Note: this assumes both windows are in the same origin (same machine),
    // so clock skew is not an issue for BroadcastChannel.
    const latency = (performance.timeOrigin + performance.now()) - senderTimestamp;
    this.#measurements.push(latency);

    if (this.#measurements.length > this.#maxSamples) {
      this.#measurements.shift();
    }
  }

  /**
   * Update rate counters. Call this periodically (e.g., every 250ms).
   */
  updateRates() {
    const now = performance.now();
    const elapsed = (now - this.#rateWindow.lastReset) / 1000;
    if (elapsed > 0) {
      this.#rates.sent = Math.round(this.#rateWindow.sent / elapsed);
      this.#rates.received = Math.round(this.#rateWindow.received / elapsed);
    }
    this.#rateWindow = { sent: 0, received: 0, lastReset: now };
  }

  getStats() {
    if (this.#measurements.length === 0) return null;
    const sorted = [...this.#measurements].sort((a, b) => a - b);
    return {
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: sorted[sorted.length - 1],
      count: sorted.length,
    };
  }

  getRates() {
    return { ...this.#rates };
  }
}
```

### The visual debug overlay

A fixed-position overlay that shows sync status at a glance. Toggled via `localStorage.setItem('debug-sync', 'true')` and rendered every 250ms.

```javascript
// shared/sync/debug-overlay.js

export class SyncDebugOverlay {
  #el;
  #engine;
  #tracker;
  #timer;

  /**
   * @param {CameraSyncEngine} engine
   * @param {SyncLatencyTracker} tracker
   */
  constructor(engine, tracker) {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem('debug-sync') !== 'true') return;

    this.#engine = engine;
    this.#tracker = tracker;

    this.#el = document.createElement('div');
    Object.assign(this.#el.style, {
      position: 'fixed',
      top: '8px',
      right: '8px',
      zIndex: '99999',
      background: 'rgba(0, 0, 0, 0.85)',
      color: '#fff',
      padding: '12px',
      borderRadius: '8px',
      fontFamily: 'monospace',
      fontSize: '11px',
      minWidth: '220px',
      pointerEvents: 'none',
      lineHeight: '1.6',
    });
    document.body.appendChild(this.#el);
    this.#timer = setInterval(() => this.#render(), 250);
  }

  #render() {
    if (!this.#el) return;

    this.#tracker.updateRates();
    const state = this.#engine.getDebugState();
    const latency = this.#tracker.getStats();
    const rates = this.#tracker.getRates();

    const statusColors = {
      connected: '#4CAF50',
      syncing: '#FFC107',
      frozen: '#9E9E9E',
      disconnected: '#F44336',
    };

    const statusDot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColors[state.status] ?? '#fff'};margin-right:6px;vertical-align:middle"></span>`;

    this.#el.innerHTML = [
      `${statusDot}<strong>${state.role}</strong> | ${state.status}`,
      `Peers: ${state.peerCount} | Authority: ${state.isAuthority ? '✓' : '-'}`,
      `Camera: ${state.camera?.centerX?.toFixed(0) ?? '?'}, ${state.camera?.centerY?.toFixed(0) ?? '?'} z:${state.camera?.zoom?.toFixed(2) ?? '?'}`,
      `Msgs/s: sent ${rates.sent} | recv ${rates.received}`,
      latency ? `Latency: ${latency.median?.toFixed(1)}ms (p95: ${latency.p95?.toFixed(1)}ms)` : '',
      `<span style="font-size:9px;opacity:0.6">${document.visibilityState} | seq:${state.seq ?? 0}</span>`,
    ].filter(Boolean).join('<br>');
  }

  destroy() {
    if (this.#timer) clearInterval(this.#timer);
    this.#el?.remove();
    this.#el = null;
  }
}
```

---

## 10. Protocol additions to shared/protocol.js

Phase 5 adds these message types to the existing protocol:

```javascript
// shared/protocol.js — Phase 5 additions to MSG object

// Animated camera transitions
CAMERA_FLY_TO:     'CAMERA_FLY_TO',       // start a flyTo animation on receivers

// Presets
PRESET_SYNC:       'PRESET_SYNC',          // full preset list broadcast (on CRUD)

// Authority
AUTHORITY_CLAIM:   'AUTHORITY_CLAIM',       // Controller claiming authority
// AUTHORITY_RELEASE is intentionally deferred. The current election
// relies on peer-leave detection via heartbeat timeout. A voluntary
// release message would only be needed for co-DM handoff, which is
// a Phase 6+ feature. Adding unused message types invites confusion.
```

Add corresponding factory functions:

```javascript
export function createCameraFlyToMsg(sender, seq, payload) {
  return {
    type: MSG.CAMERA_FLY_TO,
    id: crypto.randomUUID(),
    sender,
    seq,
    ts: performance.timeOrigin + performance.now(),
    payload, // { target: SharedCameraState, duration, rho, speed, presetId }
  };
}

export function createPresetSyncMsg(sender, seq, payload) {
  return {
    type: MSG.PRESET_SYNC,
    id: crypto.randomUUID(),
    sender,
    seq,
    ts: performance.timeOrigin + performance.now(),
    payload, // { presets: CameraPreset[] }
  };
}

export function createAuthorityClaim(sender, payload) {
  return {
    type: MSG.AUTHORITY_CLAIM,
    id: crypto.randomUUID(),
    sender,
    seq: 0,
    ts: performance.timeOrigin + performance.now(),
    payload, // { windowId, role }
  };
}
```

Add REQUIRED_FIELDS entries:

```javascript
REQUIRED_FIELDS[MSG.CAMERA_FLY_TO] = ['target'];
REQUIRED_FIELDS[MSG.PRESET_SYNC] = ['presets'];
REQUIRED_FIELDS[MSG.AUTHORITY_CLAIM] = ['windowId', 'role'];
```

---

## 11. Wiring it all together: boot sequence updates

### Display window initialization

Phase 5 adds `setInterpolator()` and `setAnimator()` to `CameraSyncEngine`. These forward the references to the receiver (so it can route state through the interpolator and trigger flyTo animations) and to the broadcaster (so it can check suppress flags before sending):

```javascript
// In CameraSyncEngine (camera-sync.js) — Phase 5 additions:

/**
 * Wire the interpolator into the receiver and broadcaster.
 * Called during Display initialization after the sync engine is created.
 * @param {CameraInterpolator} interpolator
 */
setInterpolator(interpolator) {
  if (this.#receiver) this.#receiver.setInterpolator(interpolator);
  if (this.#broadcaster) this.#broadcaster.setInterpolator(interpolator);
}

/**
 * Wire the animator into the receiver and broadcaster.
 * The receiver uses the animator for CAMERA_FLY_TO playback.
 * The broadcaster checks animator.suppressBroadcast before sending.
 * @param {CameraAnimator} animator
 */
setAnimator(animator) {
  if (this.#receiver) this.#receiver.setAnimator(animator);
  if (this.#broadcaster) this.#broadcaster.setAnimator(animator);
}
```

These delegation methods keep the boot sequence clean: initialization code calls `syncEngine.setAnimator(animator)` without needing to know whether the engine created a receiver, a broadcaster, or both.

```javascript
// vtt/js/main.js — Phase 5 additions to Display boot sequence

import { CameraAnimator } from './camera-animator.js';
import { CameraInterpolator } from './camera-interpolator.js';
import { SemanticZoomController } from './semantic-zoom.js';
import { CameraPresetManager } from './camera-presets.js';

// After camera and map are initialized (existing Phase 4 code):

// 1. Create the animator
const animator = new CameraAnimator(camera, { w: camera.viewportW, h: camera.viewportH });

// 2. Create the interpolator (Display only)
const interpolator = new CameraInterpolator(camera, animator, { halfLife: 0.05 });

// 3. Create the semantic zoom controller
const semanticZoom = new SemanticZoomController(
  document.getElementById('map-container')
);

// 4. Create the preset manager (read-only on Display, receives via sync)
const presetManager = new CameraPresetManager(animator);

// 5. Wire the interpolator into the CameraReceiver
// (modify CameraSyncEngine to accept the interpolator)
syncEngine.setInterpolator(interpolator);

// 6. Wire the animator into the CameraReceiver for flyTo handling
syncEngine.setAnimator(animator);

// 7. Expose for testing
window.__vtt.animator = animator;
window.__vtt.interpolator = interpolator;
window.__vtt.semanticZoom = semanticZoom;
window.__vtt.presetManager = presetManager;
```

### Controller window initialization

```javascript
// controller/controller.js — Phase 5 additions

import { CameraAnimator } from '../vtt/js/camera-animator.js';
import { CameraPresetManager } from '../vtt/js/camera-presets.js';
import { AuthorityElection } from '../vtt/js/authority-election.js';
import { flyToTokens } from '../vtt/js/fit-to-tokens.js';

// After camera and sync engine are initialized:

// 1. Create the animator (Controller animates locally too)
const animator = new CameraAnimator(camera, { w: camera.viewportW, h: camera.viewportH });

// 2. Create the preset manager (full CRUD on Controller)
const presetManager = new CameraPresetManager(animator);
presetManager.setCurrentMap(currentMapId);
presetManager.bindHotkeys();

// 3. Create authority election
const election = new AuthorityElection(
  syncEngine.windowId,
  'controller',
  syncEngine.registry,
  syncEngine.transport
);
election.elect();

// 4. Wire up UI buttons
document.getElementById('btn-frame-action')?.addEventListener('click', () => {
  const result = flyToTokens(animator, tokenManager, { w: camera.viewportW, h: camera.viewportH });
  if (result && election.isAuthority) {
    syncEngine.broadcaster.sendFlyTo(result.target, result.flyOpts);
  }
});

// 5. When recalling a preset, also broadcast the flyTo
EventBus.on('presets:recalled', ({ preset }) => {
  if (election.isAuthority) {
    syncEngine.broadcaster.sendFlyTo(preset.camera, {
      duration: preset.transition.duration,
      rho: preset.transition.rho,
      presetId: preset.id,
    });
  }
});

// 6. Expose for testing
window.__controller.animator = animator;
window.__controller.presetManager = presetManager;
window.__controller.election = election;
```

---

## 12. CSS changes

Add the semantic zoom stylesheet:

```html
<!-- In vtt/index.html, add after existing CSS links -->
<link rel="stylesheet" href="css/semantic-zoom.css">
```

Add the orphan overlay HTML:

```html
<!-- In vtt/index.html, inside #vtt-viewport -->
<div id="orphan-overlay" class="orphan-overlay">
  <div class="orphan-overlay__message">Waiting for DM to connect...</div>
</div>
```

---

## 13. Testing protocols

### Unit tests for flyTo path computation

```javascript
// tests/fly-to.test.js
import { computeFlyToPath } from '../vtt/js/fly-to.js';

describe('computeFlyToPath', () => {
  test('pure zoom (no pan) produces valid path', () => {
    const start = { centerX: 500, centerY: 500, zoom: 1.0 };
    const end = { centerX: 500, centerY: 500, zoom: 2.0 };
    const path = computeFlyToPath(start, end, { screenWidth: 1920 });

    expect(path.duration).toBeGreaterThan(0);

    // Path at t=0 should be the start
    const p0 = path.at(0);
    expect(p0.centerX).toBeCloseTo(500);
    expect(p0.centerY).toBeCloseTo(500);
    expect(p0.zoom).toBeCloseTo(1.0, 1);

    // Path at t=1 should be the end
    const p1 = path.at(1);
    expect(p1.centerX).toBeCloseTo(500);
    expect(p1.centerY).toBeCloseTo(500);
    expect(p1.zoom).toBeCloseTo(2.0, 1);
  });

  test('general case: zoom + pan produces valid endpoints', () => {
    const start = { centerX: 100, centerY: 100, zoom: 1.0 };
    const end = { centerX: 1000, centerY: 800, zoom: 2.0 };
    const path = computeFlyToPath(start, end, { screenWidth: 1920 });

    expect(path.duration).toBeGreaterThan(200);
    expect(path.duration).toBeLessThanOrEqual(5000);

    const p0 = path.at(0);
    expect(p0.centerX).toBeCloseTo(100, 0);
    expect(p0.centerY).toBeCloseTo(100, 0);

    const p1 = path.at(1);
    expect(p1.centerX).toBeCloseTo(1000, 0);
    expect(p1.centerY).toBeCloseTo(800, 0);
  });

  test('identical start and end produces zero duration', () => {
    const pos = { centerX: 500, centerY: 500, zoom: 1.0 };
    const path = computeFlyToPath(pos, pos);
    expect(path.duration).toBe(0);
  });

  test('midpoint of general path zooms OUT (visible width increases)', () => {
    const start = { centerX: 100, centerY: 100, zoom: 2.0 };
    const end = { centerX: 1000, centerY: 100, zoom: 2.0 };
    const path = computeFlyToPath(start, end, { screenWidth: 1920 });

    // At the midpoint, the camera should have zoomed out
    const mid = path.at(0.5);
    expect(mid.zoom).toBeLessThan(2.0);
  });

  test('duration respects min/max bounds', () => {
    // Very short distance
    const short = computeFlyToPath(
      { centerX: 100, centerY: 100, zoom: 1.0 },
      { centerX: 101, centerY: 100, zoom: 1.0 },
      { screenWidth: 1920 }
    );
    expect(short.duration).toBeGreaterThanOrEqual(200);

    // Very long distance with explicit speed
    const long = computeFlyToPath(
      { centerX: 0, centerY: 0, zoom: 0.1 },
      { centerX: 100000, centerY: 100000, zoom: 0.1 },
      { screenWidth: 1920, speed: 0.1 }
    );
    expect(long.duration).toBeLessThanOrEqual(5000);
  });
});
```

### Unit tests for fit-to-tokens

```javascript
// tests/fit-to-tokens.test.js
import { computeFitToTokens } from '../vtt/js/fit-to-tokens.js';

describe('computeFitToTokens', () => {
  const viewport = { w: 1920, h: 1080 };

  test('returns null for empty token array', () => {
    expect(computeFitToTokens([], viewport)).toBeNull();
  });

  test('returns null when all tokens are invisible', () => {
    const tokens = [{ x: 100, y: 100, size: 1, visible: false, isPC: false, inInitiative: false }];
    expect(computeFitToTokens(tokens, viewport)).toBeNull();
  });

  test('single token produces valid framing', () => {
    const tokens = [{ x: 500, y: 500, size: 1, visible: true, isPC: true, inInitiative: false }];
    const result = computeFitToTokens(tokens, viewport);

    expect(result).not.toBeNull();
    expect(result.centerX).toBeCloseTo(500);
    expect(result.centerY).toBeCloseTo(500);
    expect(result.zoom).toBeGreaterThan(0);
  });

  test('PC mode filters non-PC tokens', () => {
    const tokens = [
      { x: 100, y: 100, size: 1, visible: true, isPC: true, inInitiative: false },
      { x: 900, y: 900, size: 1, visible: true, isPC: false, inInitiative: false },
    ];
    const result = computeFitToTokens(tokens, viewport, { mode: 'pcs' });

    // Should only frame the PC at (100, 100), not the NPC at (900, 900)
    expect(result.centerX).toBeCloseTo(100);
    expect(result.centerY).toBeCloseTo(100);
  });
});
```

### Unit tests for exponential decay

```javascript
// tests/camera-interpolator.test.js

describe('expDecay', () => {
  // Import or inline the function for testing
  function expDecay(current, target, halfLife, dt) {
    return target + (current - target) * Math.pow(0.5, dt / halfLife);
  }

  test('frame-rate independence: 60x at 1/60s equals 1x at 1s', () => {
    let value60 = 0;
    const target = 100;
    const halfLife = 0.05;

    // Simulate 60 frames at 1/60s
    for (let i = 0; i < 60; i++) {
      value60 = expDecay(value60, target, halfLife, 1 / 60);
    }

    // Single step of 1 second
    const value1 = expDecay(0, target, halfLife, 1.0);

    // Should be nearly identical
    expect(Math.abs(value60 - value1)).toBeLessThan(0.001);
  });

  test('converges toward target', () => {
    let value = 0;
    const target = 100;
    const halfLife = 0.05;

    value = expDecay(value, target, halfLife, 0.05);
    expect(value).toBeCloseTo(50, 0); // Half the gap after one half-life

    value = expDecay(value, target, halfLife, 0.05);
    expect(value).toBeCloseTo(75, 0); // Half of remaining gap
  });
});
```

### Manual testing checklist

1. **FlyTo basic.** On the Controller, save two presets at opposite corners of the map. Recall them alternately. The Display should show a smooth zoom-out-pan-zoom-in arc between the two positions. No jerking, no stuttering.

2. **FlyTo interruption.** Start a flyTo, then immediately scroll on the Controller. The animation should stop at whatever frame it reached. No snap-back.

3. **Preset save/recall round-trip.** Save a preset on the Controller (`Shift+1`). Close and reopen the Controller. The preset should persist (localStorage). Press `Shift+1`. The camera should fly to the saved position.

4. **Preset sync to Display.** Save a preset on the Controller. The Display should receive the preset via PRESET_SYNC. Recall the preset on the Controller. The Display should animate to the same position.

5. **Fit-to-tokens.** Place 4 tokens in different quadrants of the map. Click "Frame Action" on the Controller. The camera should smoothly zoom to frame all 4 tokens with comfortable padding.

6. **Fit-to-tokens with PC filter.** Set 2 tokens as PCs and 2 as NPCs. Use the PC-only mode. The camera should frame only the 2 PCs.

7. **Semantic zoom.** Zoom from cover zoom to maximum zoom on the Display. Token labels should fade in around 1.2x cover zoom. Grid labels should fade in around 1.8x. HP bars at 1.6x. Zoom back out and verify they fade out at the lower (hysteresis) thresholds.

8. **Interpolation smoothness.** Enable the debug overlay. Pan quickly on the Controller. Watch the Display. With interpolation enabled, panning should be smooth at 60fps. Disable interpolation (by not creating the CameraInterpolator) and repeat. You should see subtle stepping.

9. **Authority election.** Open two Controller tabs and one Display. The Controller with the lower windowId should be authority (check debug overlay). Close the authority Controller. The other should claim authority within the heartbeat timeout.

10. **Orphan mode.** Close all Controller tabs while the Display is open. The "Waiting for DM..." overlay should appear. Open a new Controller. The overlay should disappear.

11. **prefers-reduced-motion.** Enable "Reduce motion" in OS settings. Trigger a flyTo. It should jump instantly instead of animating.

12. **Console error check.** Open DevTools on all windows. Perform all tests above. No errors or warnings related to Phase 5 features.

---

## 14. Migration checklist

This is the ordered list of changes for Claude Code. Each item references the section above.

1. **Create `vtt/js/easing.js`** with easing functions (Section 2).

2. **Create `vtt/js/fly-to.js`** with `computeFlyToPath()` (Section 2).

3. **Create `vtt/js/camera-animator.js`** with `CameraAnimator` class (Section 2).

4. **Create `vtt/js/camera-presets.js`** with `CameraPresetManager` class (Section 3).

5. **Create `vtt/js/fit-to-tokens.js`** with `computeFitToTokens()` and `flyToTokens()` (Section 4).

6. **Create `vtt/js/semantic-zoom.js`** with `SemanticZoomController` class (Section 5).

7. **Create `vtt/css/semantic-zoom.css`** with zoom-dependent visibility rules (Section 5).

8. **Create `vtt/js/camera-interpolator.js`** with `CameraInterpolator` class (Section 6).

9. **Create `shared/sync/ISyncTransport.js`** with the abstract base class (Section 7).

10. **Create `shared/sync/BroadcastChannelTransport.js`** implementing ISyncTransport (Section 7).

11. **Migrate `camera-sync.js`** to use `ISyncTransport` instead of direct BroadcastChannel calls. Also add `CameraSyncEngine.setInterpolator()` and `CameraSyncEngine.setAnimator()` delegation methods. Add `CameraBroadcaster.setAnimator()` and `CameraBroadcaster.setInterpolator()`, and update the broadcaster's `#tick` send guard to check `animator.suppressBroadcast` and `interpolator.suppressBroadcast` (Sections 6, 7).

12. **Create `vtt/js/authority-election.js`** with `AuthorityElection` class (Section 8).

13. **Create `shared/sync/debug-transport.js`** with `wrapWithDebugLogging()` (Section 9).

14. **Create `shared/sync/latency-tracker.js`** with `SyncLatencyTracker` class (Section 9).

15. **Create `shared/sync/debug-overlay.js`** with `SyncDebugOverlay` class (Section 9).

16. **Add Phase 5 message types** to `shared/protocol.js`: `CAMERA_FLY_TO`, `PRESET_SYNC`, `AUTHORITY_CLAIM` (Section 10).

17. **Add factory functions** to `shared/protocol.js` for the new message types (Section 10).

18. **Update `vtt/js/main.js`** to wire Phase 5 modules into the Display boot sequence (Section 11).

19. **Update `controller/controller.js`** to wire Phase 5 modules into the Controller (Section 11).

20. **Add semantic zoom CSS link** to `vtt/index.html` (Section 12).

21. **Add orphan overlay HTML** to `vtt/index.html` (Section 12).

22. **Run the test suite** (Section 13).

---

## 15. What Phase 6 expects from this foundation

Phase 5 establishes the advanced camera control layer. Future phases build on it:

- **The `ISyncTransport` interface** is ready for a WebSocket implementation. Phase 6 creates `WebSocketTransport` that implements the same interface and plugs into `CameraSyncEngine` without protocol changes.

- **The `CameraAnimator`** is the single entry point for all camera motion. Any future feature that moves the camera (cinematic scene transitions, DM spotlight following a token, smooth camera lock during combat) goes through the animator.

- **The `CameraPresetManager`** stores presets in localStorage. Phase 6 may migrate to a server-side store (Supabase) for multi-device access, but the data model and API remain identical.

- **The `AuthorityElection`** protocol scales to remote multi-user scenarios. The "lowest ID wins" rule works over WebSocket exactly as it does over BroadcastChannel.

- **The semantic zoom thresholds** are configurable. Future DM settings UI can let users adjust when labels, HP bars, and conditions appear.

---

## 16. What is explicitly deferred and why

**Tiled rendering for maps exceeding 4K resolution (deferred to Phase 6+).** The CSS transform approach performs well for maps up to 4K resolution (33MB GPU memory). Maps larger than 4K require tile-based rendering (Leaflet-style tile pyramids or Owlbear Rodeo's Warp Core pattern). This is a rendering architecture change that should be evaluated alongside the React/PixiJS migration, not bolted onto the current vanilla Canvas 2D system.

**"Follow token" auto-camera mode (deferred to Phase 6).** An automatic camera mode that tracks a specific token as it moves across the map (useful for theater-of-the-mind narration). This requires token movement events that the current token system doesn't emit reliably. Build it after the token system has proper movement event infrastructure.

**Cinematic camera paths with multiple waypoints (deferred to Phase 6+).** The flyTo algorithm handles point-to-point transitions. A future feature could chain multiple flyTo segments into a camera "rail" for intro cinematics. This requires a sequencing system that doesn't exist yet.

**DM "spotlight" mode (deferred to Phase 6).** A mode where the Display camera automatically follows whichever token the DM is hovering over in the DM Guide. This requires DM Guide integration with the camera sync system, which Phase 4 deliberately kept independent.

**WebSocket transport implementation (deferred to Phase 6).** The ISyncTransport interface is ready, but the actual WebSocket server and client are out of scope for Phase 5. Phase 5 establishes the interface; Phase 6 fills in the implementation.
