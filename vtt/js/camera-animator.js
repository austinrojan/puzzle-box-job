// vtt/js/camera-animator.js
// Orchestrates flyTo paths at display refresh rate (rAF).
// Uses van Wijk & Nuij path from fly-to.js and easing from easing.js.
// Separate from Phase 3's CameraAnimator in map-camera.js (spring-based snap-back).

import { computeFlyToPath } from './fly-to.js';
import { easeInOutCubic } from './easing.js';
import { localToShared, sharedToLocal } from '../../shared/protocol.js';
import { EventBus } from './state.js';

export class FlyToAnimator {
  /**
   * @param {object} camera - Camera instance from map-camera.js (has setPosition, x, y, zoom, viewportW, viewportH)
   * @param {{ w: number, h: number }} viewport - current viewport dimensions
   */
  constructor(camera, viewport) {
    this._camera = camera;
    this._viewport = viewport;

    this._status = 'idle'; // 'idle' | 'flying'
    this._path = null;
    this._startTime = 0;
    this._easingFn = easeInOutCubic;
    this._target = null;
    this._rafId = null;
    this._suppressBroadcast = false;

    this._tick = this._tick.bind(this);
  }

  /** Update viewport dimensions (called from ResizeObserver). */
  updateViewport(w, h) {
    this._viewport = { w, h };
  }

  /** Whether an animation is currently running. */
  get isAnimating() {
    return this._status !== 'idle';
  }

  /** Whether broadcast should be suppressed (true while animating on receiver side). */
  get suppressBroadcast() {
    return this._suppressBroadcast;
  }

  /**
   * Start a flyTo animation from the current camera position to a target.
   *
   * @param {{ centerX: number, centerY: number, zoom: number }} target - shared coords
   * @param {object} [opts]
   * @param {number} [opts.duration] - override computed duration (ms)
   * @param {number} [opts.rho=1.42] - curvature parameter
   * @param {number} [opts.speed=1.2] - screenfulls per second
   * @param {function} [opts.easing] - easing function
   * @param {boolean} [opts.suppressBroadcast=false] - true for receiver-side animations
   */
  flyTo(target, opts = {}) {
    // prefers-reduced-motion: skip animation entirely
    if (typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.jumpTo(target, opts);
      return;
    }

    this._cancelAnimation();

    // Current position in shared (center-point) coordinates
    const vp = { width: this._viewport.w, height: this._viewport.h };
    const current = localToShared(this._camera, vp);

    // Compute optimal path
    const path = computeFlyToPath(current, target, {
      rho: opts.rho ?? 1.42,
      speed: opts.speed ?? 1.2,
      duration: opts.duration,
      screenWidth: this._viewport.w,
    });

    if (path.duration === 0) {
      // Start and end are identical — apply directly, no animation
      this._applySharedState(target);
      return;
    }

    this._suppressBroadcast = opts.suppressBroadcast ?? false;
    this._status = 'flying';
    this._path = path;
    this._startTime = performance.now();
    this._easingFn = opts.easing ?? easeInOutCubic;
    this._target = target;

    if (this._rafId === null) {
      this._rafId = requestAnimationFrame(this._tick);
    }
  }

  /**
   * Instantly jump to a target position. No animation.
   *
   * @param {{ centerX: number, centerY: number, zoom: number }} target
   * @param {object} [opts]
   * @param {boolean} [opts.suppressBroadcast=false]
   */
  jumpTo(target, opts = {}) {
    this._cancelAnimation();
    this._suppressBroadcast = opts.suppressBroadcast ?? false;
    this._applySharedState(target);
    this._suppressBroadcast = false;
  }

  /**
   * Interrupt the current animation.
   * Camera stays at whatever position it reached when interrupted.
   */
  interrupt() {
    if (this._status === 'idle') return;
    this._cancelAnimation();
    EventBus.emit('camera:animation-interrupted');
  }

  /** The rAF animation loop. */
  _tick(now) {
    if (this._status === 'idle') return;

    const elapsed = now - this._startTime;
    const rawT = Math.min(elapsed / this._path.duration, 1.0);
    const easedT = this._easingFn(rawT);

    // Evaluate path at eased parameter
    const waypoint = this._path.at(easedT);
    this._applySharedState(waypoint);

    if (rawT >= 1.0) {
      // Animation complete — apply exact target to avoid float drift
      this._applySharedState(this._target);
      // _cancelAnimation() is safe here: the rAF that invoked _tick() has already
      // fired, so cancelAnimationFrame on its stale ID is a spec-defined no-op.
      this._cancelAnimation();
      EventBus.emit('camera:animation-complete');
      return;
    }

    this._rafId = requestAnimationFrame(this._tick);
  }

  /** Convert shared coords to local and apply to camera. */
  _applySharedState(shared) {
    const vp = { width: this._viewport.w, height: this._viewport.h };
    const local = sharedToLocal(shared, vp);
    this._camera.setPosition(local.x, local.y, local.zoom);
  }

  /** Stop the rAF loop and reset state. */
  _cancelAnimation() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._status = 'idle';
    this._path = null;
    this._startTime = 0;
    this._easingFn = easeInOutCubic;
    this._target = null;
    this._suppressBroadcast = false;
  }

  /** Clean up on window unload. */
  destroy() {
    this._cancelAnimation();
  }
}
