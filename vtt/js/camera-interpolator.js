// vtt/js/camera-interpolator.js
// Smooths 30fps camera sync updates into 60fps rendering on the Display.
// Uses exponential decay interpolation — frame-rate-independent by design.

/**
 * Half-life in seconds for exponential decay.
 * 0.05 (50ms): fast convergence, camera tracks authority tightly.
 */
const DEFAULT_HALF_LIFE = 0.05;

/**
 * When difference between current and target is below this on all axes,
 * stop the loop to save CPU. 0.01 pixels is sub-visible.
 */
const CONVERGENCE_EPSILON = 0.01;

/**
 * Exponential decay: frame-rate-independent smoothing.
 * Running 60× at 1/60s produces the same result as 1× at 1s.
 */
function expDecay(current, target, halfLife, dt) {
  return target + (current - target) * Math.pow(0.5, dt / halfLife);
}

export class CameraInterpolator {
  /**
   * @param {object} camera - Camera instance (has setPosition, x, y, zoom)
   * @param {object} animator - FlyToAnimator (checked for isAnimating)
   * @param {object} [opts]
   * @param {number} [opts.halfLife=0.05]
   */
  constructor(camera, animator, opts = {}) {
    this._camera = camera;
    this._animator = animator;
    this._halfLife = opts.halfLife ?? DEFAULT_HALF_LIFE;

    this._target = { x: camera.x, y: camera.y, zoom: camera.zoom };
    this._current = { x: camera.x, y: camera.y, zoom: camera.zoom };
    this._hasTarget = false;
    this._lastFrameTime = 0;
    this._rafId = null;
    this._isRunning = false;

    this._tick = this._tick.bind(this);
  }

  /**
   * Called when a new CAMERA_SYNC arrives (already in local coords).
   * Sets target and starts interpolation loop if not already running.
   */
  setTarget(localState) {
    this._target = { x: localState.x, y: localState.y, zoom: localState.zoom };
    this._hasTarget = true;

    if (!this._isRunning) {
      this._lastFrameTime = performance.now();
      this._startLoop();
    }
  }

  /**
   * Snap instantly to target. Used for CAMERA_JUMP_TO to avoid
   * smooth convergence from a distant position.
   */
  snapToTarget() {
    this._current = { ...this._target };
    this._camera.setPosition(this._current.x, this._current.y, this._current.zoom);
    this._stopLoop();
  }

  _tick(now) {
    if (!this._hasTarget) {
      this._stopLoop();
      return;
    }

    // Don't interpolate while flyTo animation is running — animator drives camera
    if (this._animator && this._animator.isAnimating) {
      this._rafId = requestAnimationFrame(this._tick);
      return;
    }

    const dt = (now - this._lastFrameTime) / 1000;
    this._lastFrameTime = now;

    // Clamp dt to prevent huge jumps after tab visibility changes
    const clampedDt = Math.min(dt, 0.1);

    this._current.x = expDecay(this._current.x, this._target.x, this._halfLife, clampedDt);
    this._current.y = expDecay(this._current.y, this._target.y, this._halfLife, clampedDt);
    this._current.zoom = expDecay(this._current.zoom, this._target.zoom, this._halfLife, clampedDt);

    const dx = Math.abs(this._current.x - this._target.x);
    const dy = Math.abs(this._current.y - this._target.y);
    const dz = Math.abs(this._current.zoom - this._target.zoom);

    if (dx < CONVERGENCE_EPSILON && dy < CONVERGENCE_EPSILON && dz < CONVERGENCE_EPSILON) {
      // Snap to exact target and stop
      this._camera.setPosition(this._target.x, this._target.y, this._target.zoom);
      this._current = { ...this._target };
      this._stopLoop();
      return;
    }

    this._camera.setPosition(this._current.x, this._current.y, this._current.zoom);
    this._rafId = requestAnimationFrame(this._tick);
  }

  _startLoop() {
    if (this._isRunning) return;
    this._isRunning = true;
    this._rafId = requestAnimationFrame(this._tick);
  }

  _stopLoop() {
    this._isRunning = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  get isRunning() { return this._isRunning; }

  /**
   * True while interpolation loop is active.
   * Broadcaster checks this to avoid echoing interpolated frames.
   */
  get suppressBroadcast() { return this._isRunning; }

  destroy() {
    this._stopLoop();
    this._hasTarget = false;
  }
}
