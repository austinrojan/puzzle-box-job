// Edge Pan Manager — Auto-scroll during token drag
const HOT_ZONE_PX = 60;
const HOT_ZONE_MIN_FRAC = 0.05;
const MAX_SPEED = 1000;
const START_DELAY_MS = 150;

export class EdgePanManager {
  constructor(camera) {
    this._camera = camera;
    this._tracking = false;
    this._cursorX = 0;
    this._cursorY = 0;
    this._rafId = null;
    this._lastTimestamp = 0;
    this._activeSince = 0;
    this._inHotZone = false;
    this._tick = this._tick.bind(this);
  }

  startTracking() {
    this._tracking = true;
    this._inHotZone = false;
    this._activeSince = 0;
  }

  updateCursor(screenX, screenY) {
    if (!this._tracking) return;
    this._cursorX = screenX;
    this._cursorY = screenY;
    if (!this._rafId) {
      this._lastTimestamp = performance.now();
      this._rafId = requestAnimationFrame(this._tick);
    }
  }

  stopTracking() {
    this._tracking = false;
    this._inHotZone = false;
    this._activeSince = 0;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  _zoneWidth(vpDim) {
    return Math.max(HOT_ZONE_PX, vpDim * HOT_ZONE_MIN_FRAC);
  }

  _axisVelocity(cursor, vpDim) {
    const zone = this._zoneWidth(vpDim);
    if (cursor < zone) {
      const t = Math.min(1, (zone - cursor) / zone);
      return -MAX_SPEED * t * t;
    }
    if (cursor > vpDim - zone) {
      const t = Math.min(1, (cursor - (vpDim - zone)) / zone);
      return MAX_SPEED * t * t;
    }
    return 0;
  }

  _tick(timestamp) {
    if (!this._tracking) { this._rafId = null; return; }
    if (!this._camera.viewportW || !this._camera.viewportH) { this._rafId = null; return; }
    const dt = Math.min((timestamp - this._lastTimestamp) / 1000, 0.1);
    this._lastTimestamp = timestamp;

    const vx = this._axisVelocity(this._cursorX, this._camera.viewportW);
    const vy = this._axisVelocity(this._cursorY, this._camera.viewportH);
    const inZone = vx !== 0 || vy !== 0;

    if (!inZone) {
      this._inHotZone = false;
      this._activeSince = 0;
    } else if (!this._inHotZone) {
      this._inHotZone = true;
      this._activeSince = timestamp;
    }

    const pastDelay = this._activeSince > 0
                   && (timestamp - this._activeSince) >= START_DELAY_MS;
    if (inZone && pastDelay) {
      // Negate: positive vx = cursor near right edge = pan viewport right
      this._camera.panBy(-vx * dt, -vy * dt);
    }

    // Only keep the loop running while in a hot zone; updateCursor restarts it
    if (inZone) {
      this._rafId = requestAnimationFrame(this._tick);
    } else {
      this._rafId = null;
    }
  }
}
