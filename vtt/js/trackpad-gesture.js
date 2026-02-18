// vtt/js/trackpad-gesture.js
//
// Reconstructs IDLE → ACTIVE → MOMENTUM → IDLE gesture lifecycle
// from raw WheelEvent streams. Uses delta decay detection + timeout.

const DECAY_STREAK_THRESHOLD = 3;
const MIN_EVENTS_FOR_MOMENTUM = 6;
const DECAY_RATIO = 0.97;
const TIMEOUT_ACTIVE_MS = 150;
const TIMEOUT_MOMENTUM_MS = 100;
const MOMENTUM_CANCEL_SPIKE = 1.5;
const MOMENTUM_CANCEL_GAP_MS = 120;

export class TrackpadGestureDetector {
  constructor(callbacks = {}) {
    this._callbacks = callbacks;
    this.state = 'IDLE';  // 'IDLE' | 'ACTIVE' | 'MOMENTUM'
    this._endTimer = null;
    this._lastAbsDelta = 0;
    this._decayStreak = 0;
    this._eventCount = 0;
    this._lastEventTime = 0;
  }

  handleWheel(e) {
    const now = performance.now();
    const absDelta = Math.abs(e.deltaY) + Math.abs(e.deltaX);
    const timeSinceLast = now - this._lastEventTime;
    clearTimeout(this._endTimer);

    if (this.state === 'IDLE') {
      this.state = 'ACTIVE';
      this._decayStreak = 0;
      this._eventCount = 0;
      this._callbacks.onGestureStart?.(e);
    } else if (this.state === 'MOMENTUM') {
      const isSpikeUp = absDelta > this._lastAbsDelta * MOMENTUM_CANCEL_SPIKE;
      const isLargeGap = timeSinceLast > MOMENTUM_CANCEL_GAP_MS;
      if (isSpikeUp || isLargeGap) {
        this.state = 'ACTIVE';
        this._decayStreak = 0;
        this._eventCount = 0;
        this._callbacks.onGestureStart?.(e);
      }
    }

    if (this.state === 'ACTIVE') {
      this._eventCount++;
      if (absDelta > 0 && this._lastAbsDelta > 0 && absDelta < this._lastAbsDelta * DECAY_RATIO) {
        this._decayStreak++;
      } else {
        this._decayStreak = 0;
      }
      if (this._decayStreak >= DECAY_STREAK_THRESHOLD && this._eventCount > MIN_EVENTS_FOR_MOMENTUM) {
        this.state = 'MOMENTUM';
        this._callbacks.onMomentumStart?.();
      }
    }

    this._callbacks.onGestureMove?.(e, this.state);
    this._lastAbsDelta = absDelta;
    this._lastEventTime = now;

    const timeout = this.state === 'MOMENTUM' ? TIMEOUT_MOMENTUM_MS : TIMEOUT_ACTIVE_MS;
    this._endTimer = setTimeout(() => {
      this.state = 'IDLE';
      this._decayStreak = 0;
      this._eventCount = 0;
      this._lastAbsDelta = 0;
      this._callbacks.onGestureEnd?.();
    }, timeout);
  }

  cancel() {
    clearTimeout(this._endTimer);
    if (this.state !== 'IDLE') {
      this.state = 'IDLE';
      this._decayStreak = 0;
      this._eventCount = 0;
      this._lastAbsDelta = 0;
      this._callbacks.onGestureEnd?.();
    }
  }

  get isGestureActive() {
    return this.state === 'ACTIVE' || this.state === 'MOMENTUM';
  }

  destroy() {
    clearTimeout(this._endTimer);
  }
}

/**
 * Heuristic to classify a wheel event as mouse or trackpad.
 * Mouse wheels produce large integer deltas (>=50, integer, no horizontal).
 * Trackpad produces small/fractional deltas at high frequency.
 */
export function classifyWheelDevice(e) {
  const absY = Math.abs(e.deltaY);
  const absX = Math.abs(e.deltaX);
  const maxDelta = Math.max(absY, absX);
  if (maxDelta >= 50 && maxDelta % 1 === 0 && e.deltaX === 0) {
    return 'mouse';
  }
  return 'trackpad';
}
