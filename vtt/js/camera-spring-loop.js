// ============================================================
// CameraSpringLoop — One rAF loop for all camera animation
// ============================================================
//
// Consolidates three independent rAF loops (CameraAnimator,
// elastic animator, SmoothZoomAnimator) into a single loop
// that advances all spring axes per frame.
//
// Auto-starts when any spring becomes unsettled.
// Auto-stops when ALL springs are settled.

import { AxisSpring } from './axis-spring.js';

const MAX_DT = 0.064;    // Cap dt to ~64ms (handles tab backgrounding)
const MIN_DT = 0.001;    // Floor dt to 1ms (handles performance.now quirks)

export const SPRING_STIFFNESS = {
  SNAP_BACK: 400,       // Snappy elastic return
  CAMERA_SNAP: 200,     // Camera position snap-back
  SMOOTH_ZOOM: 300,     // Zoom animation
  INERTIAL: 20,         // Very low: friction-only deceleration
};

export class CameraSpringLoop {
  /** @param {import('./map-camera.js').Camera} camera */
  constructor(camera) {
    this._camera = camera;
    this._rafId = null;
    this._lastTime = 0;
    this._running = false;

    // Five spring axes
    this.panX = new AxisSpring({ stiffness: SPRING_STIFFNESS.CAMERA_SNAP });
    this.panY = new AxisSpring({ stiffness: SPRING_STIFFNESS.CAMERA_SNAP });
    this.elasticX = new AxisSpring({ stiffness: SPRING_STIFFNESS.SNAP_BACK });
    this.elasticY = new AxisSpring({ stiffness: SPRING_STIFFNESS.SNAP_BACK });
    this.logZoom = new AxisSpring({
      stiffness: SPRING_STIFFNESS.SMOOTH_ZOOM,
      positionThreshold: 0.001,
      velocityThreshold: 0.001,
    });

    this._tick = this._tick.bind(this);
  }

  /** Ensure the loop is running. Idempotent. */
  ensureRunning() {
    if (this._running) return;
    this._running = true;
    this._lastTime = 0;
    this._rafId = requestAnimationFrame(this._tick);
  }

  /** Force-stop the loop. Normal operation uses auto-stop. */
  stop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._running = false;
  }

  /** Sync all spring positions FROM the camera state. */
  syncFromCamera() {
    const cam = this._camera;
    this.panX.position = cam.x;
    this.panX.target = cam.x;
    this.panX.velocity = 0;

    this.panY.position = cam.y;
    this.panY.target = cam.y;
    this.panY.velocity = 0;

    this.elasticX.position = cam.elasticOffsetX;
    this.elasticX.target = 0;
    this.elasticX.velocity = 0;

    this.elasticY.position = cam.elasticOffsetY;
    this.elasticY.target = 0;
    this.elasticY.velocity = 0;

    this.logZoom.position = Math.log(cam.zoom);
    this.logZoom.target = Math.log(cam.zoom);
    this.logZoom.velocity = 0;
  }

  /**
   * The consolidated tick function.
   * @param {number} timestamp  The rAF timestamp
   */
  _tick(timestamp) {
    if (this._lastTime === 0) this._lastTime = timestamp;
    const rawDt = (timestamp - this._lastTime) / 1000;
    const dt = Math.max(MIN_DT, Math.min(rawDt, MAX_DT));
    this._lastTime = timestamp;

    // Advance all springs
    const panXSettled = this.panX.advance(dt);
    const panYSettled = this.panY.advance(dt);
    const elasticXSettled = this.elasticX.advance(dt);
    const elasticYSettled = this.elasticY.advance(dt);
    const zoomSettled = this.logZoom.advance(dt);

    // Write camera state (one write per frame)
    const cam = this._camera;
    cam.x = this.panX.position;
    cam.y = this.panY.position;
    cam.elasticOffsetX = this.elasticX.position;
    cam.elasticOffsetY = this.elasticY.position;
    cam.zoom = Math.exp(this.logZoom.position);

    // C4: Sign guard — prevent elastic offset from crossing zero during snap-back.
    // Simpler than tracking full displacement; AxisSpring recomputes from current state.
    if (cam._isSnappingBack) {
      if (cam._elasticSnapSignX !== 0
          && Math.sign(cam.elasticOffsetX) !== cam._elasticSnapSignX) {
        cam.elasticOffsetX = 0;
        this.elasticX.position = 0;
        this.elasticX.velocity = 0;
      }
      if (cam._elasticSnapSignY !== 0
          && Math.sign(cam.elasticOffsetY) !== cam._elasticSnapSignY) {
        cam.elasticOffsetY = 0;
        this.elasticY.position = 0;
        this.elasticY.velocity = 0;
      }
    }

    // C1: Call _applyConstraints() which emits camera:changed.
    // Do NOT call cam._emitChanged() — it doesn't exist.
    cam._applyConstraints();

    // C2: Sync clamped values back into springs to prevent
    // the spring from fighting the constraint system.
    this.panX.position = cam.x;
    this.panY.position = cam.y;
    this.logZoom.position = Math.log(cam.zoom);

    // C4: Settlement detection for elastic snap-back
    if (elasticXSettled && elasticYSettled && cam._isSnappingBack) {
      cam.elasticOffsetX = 0;
      cam.elasticOffsetY = 0;
      cam._cumulativeOverflowX = 0;
      cam._cumulativeOverflowY = 0;
      cam._isSnappingBack = false;
      cam._elasticSnapSignX = 0;
      cam._elasticSnapSignY = 0;
      if (cam._gestures) cam._gestures.release('SNAP_BACK');
    }

    // Auto-stop when all springs are settled
    const allSettled = panXSettled && panYSettled
                    && elasticXSettled && elasticYSettled
                    && zoomSettled;

    if (allSettled) {
      this._running = false;
      this._rafId = null;
    } else {
      this._rafId = requestAnimationFrame(this._tick);
    }
  }

  /** Whether all springs are at rest. */
  get settled() {
    return this.panX.settled
        && this.panY.settled
        && this.elasticX.settled
        && this.elasticY.settled
        && this.logZoom.settled;
  }
}
