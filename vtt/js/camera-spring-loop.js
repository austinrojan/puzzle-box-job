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

const COAST_FRICTION = 0.96;
const COAST_STOP_THRESHOLD = 10;   // screen px/s
const COAST_BASE_FRAME_MS = 16.67; // 60fps reference for framerate-independent friction

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

  /** Sync pan + zoom springs to current camera state (position = target, velocity = 0). */
  syncPanZoomFromCamera() {
    const cam = this._camera;
    this.panX.position = cam.x;
    this.panX.target = cam.x;
    this.panX.velocity = 0;
    this.panY.position = cam.y;
    this.panY.target = cam.y;
    this.panY.velocity = 0;
    this.logZoom.position = Math.log(cam.zoom);
    this.logZoom.target = Math.log(cam.zoom);
    this.logZoom.velocity = 0;
  }

  /** Sync elastic springs to current camera elastic offset (position = target, velocity = 0). */
  syncElasticFromCamera() {
    const cam = this._camera;
    this.elasticX.position = cam.elasticOffsetX;
    this.elasticX.target = cam.elasticOffsetX;
    this.elasticX.velocity = 0;
    this.elasticY.position = cam.elasticOffsetY;
    this.elasticY.target = cam.elasticOffsetY;
    this.elasticY.velocity = 0;
  }

  /** Sync only the zoom spring to current camera zoom. */
  syncZoomFromCamera() {
    const z = Math.log(this._camera.zoom);
    this.logZoom.position = z;
    this.logZoom.setTarget(z);
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
    cam.elasticOffsetX = this.elasticX.position;
    cam.elasticOffsetY = this.elasticY.position;
    cam.zoom = Math.exp(this.logZoom.position);

    // T9: Zoom anchor preservation — when the zoom spring is animating,
    // adjust camera position so the anchor world-point stays at the
    // same screen position. Otherwise, write pan positions from springs.
    if (!zoomSettled && cam._zoomAnchor) {
      cam.x = cam._zoomAnchor.wx - cam._zoomAnchor.sx / cam.zoom;
      cam.y = cam._zoomAnchor.wy - cam._zoomAnchor.sy / cam.zoom;
    } else {
      cam.x = this.panX.position;
      cam.y = this.panY.position;
      // Clear anchor when zoom settles
      if (zoomSettled && cam._zoomAnchor) cam._zoomAnchor = null;
    }

    // C4: Sign guard — prevent elastic offset from crossing zero during snap-back.
    if (cam._isSnappingBack) {
      if (this._clampElasticSign(this.elasticX, cam._elasticSnapSignX)) {
        cam.elasticOffsetX = 0;
      }
      if (this._clampElasticSign(this.elasticY, cam._elasticSnapSignY)) {
        cam.elasticOffsetY = 0;
      }
    }

    // C1: Call _applyConstraints() which emits camera:changed.
    // Do NOT call cam._emitChanged() — it doesn't exist.
    cam._applyConstraints();

    // T8: Inertial coast — friction-based velocity decay via panBy().
    // Must run BEFORE the C2 sync-back so that panBy()'s camera changes
    // (both position and elastic offset) are captured by the sync.
    if (cam._isCoasting) this._tickCoast(dt);

    // C2: Sync clamped values back into springs to prevent
    // the spring from fighting the constraint system.
    // Placed AFTER coast so panBy()'s camera changes are captured.
    this.panX.position = cam.x;
    this.panY.position = cam.y;
    this.logZoom.position = Math.log(cam.zoom);
    // During coast, panBy() updates elastic offset via _feedElasticOverflow(),
    // bypassing the elastic spring. Keep the spring fully passive (position =
    // target = current) so it doesn't fight the drain. After coast ends,
    // _snapBackElastic() sets the proper target (0) and starts the spring.
    if (cam._isCoasting) {
      this.elasticX.position = cam.elasticOffsetX;
      this.elasticX.target = cam.elasticOffsetX;
      this.elasticX.velocity = 0;
      this.elasticY.position = cam.elasticOffsetY;
      this.elasticY.target = cam.elasticOffsetY;
      this.elasticY.velocity = 0;
    }

    // Re-derive elastic settlement after coast — _tickCoast may have
    // called _snapBackElastic() which changes elastic spring targets.
    // The pre-coast values (lines 137-138) are stale if coast just ended.
    const elasticXNowSettled = this.elasticX.settled;
    const elasticYNowSettled = this.elasticY.settled;

    // C4: Settlement detection for elastic snap-back
    if (elasticXNowSettled && elasticYNowSettled && cam._isSnappingBack) {
      cam.elasticOffsetX = 0;
      cam.elasticOffsetY = 0;
      cam._cumulativeOverflowX = 0;
      cam._cumulativeOverflowY = 0;
      cam._isSnappingBack = false;
      cam._elasticSnapSignX = 0;
      cam._elasticSnapSignY = 0;
      if (cam._gestures) cam._gestures.release('SNAP_BACK');
    }

    // Auto-stop when all springs are settled AND no coast is active.
    // Coast uses friction-based velocity (not springs), so the loop
    // must keep running while _isCoasting to apply per-frame decay.
    const allSettled = panXSettled && panYSettled
                    && elasticXNowSettled && elasticYNowSettled
                    && zoomSettled
                    && !cam._isCoasting;

    if (allSettled) {
      this._running = false;
      this._rafId = null;
    } else {
      this._rafId = requestAnimationFrame(this._tick);
    }
  }

  /** Clamp elastic axis to zero if it crosses zero during snap-back. */
  _clampElasticSign(spring, sign) {
    if (sign !== 0 && Math.sign(spring.position) !== sign) {
      spring.position = 0;
      spring.velocity = 0;
      return true;
    }
    return false;
  }

  /**
   * Apply friction-based velocity decay for inertial coasting.
   * Uses panBy() for movement so elastic overflow feeds naturally.
   * @param {number} dt Timestep in seconds
   */
  _tickCoast(dt) {
    const cam = this._camera;
    const rawDtMs = dt * 1000;
    const frictionFactor = Math.pow(COAST_FRICTION, rawDtMs / COAST_BASE_FRAME_MS);
    cam._coastVx *= frictionFactor;
    cam._coastVy *= frictionFactor;

    const speed = Math.sqrt(cam._coastVx ** 2 + cam._coastVy ** 2);
    if (speed < COAST_STOP_THRESHOLD) {
      const residualVx = cam._coastVx / cam.zoom;
      const residualVy = cam._coastVy / cam.zoom;
      cam._isCoasting = false;
      cam._coastVx = 0;
      cam._coastVy = 0;
      cam._gestureActive = false;
      if (cam._el) cam._el.classList.remove('coasting');
      if (cam._gestures) {
        cam._gestures.release('INERTIA');
        cam._gestures.request('SNAP_BACK');
      }
      cam._snapBackElastic({ vx: residualVx, vy: residualVy });
    } else {
      cam.panBy(-cam._coastVx * dt, -cam._coastVy * dt);
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
