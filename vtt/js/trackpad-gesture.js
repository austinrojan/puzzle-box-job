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

// --- Stateful Device Classifier (Phase S1) ---
const CLASSIFIER_SILENCE_MS = 400;
const CLASSIFIER_WINDOW_SIZE = 6;
const CLASSIFIER_MOUSE_THRESHOLD = 4;
const CLASSIFIER_TRACKPAD_THRESHOLD = 2;

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
    if (absDelta === 0) return; // Ignore zero-delta events (e.g. ctrl-only gesture start)
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

// ============================================================
// Stateful Wheel Device Classifier (Phase S1)
// ============================================================
//
// Maintains a sliding window of recent WheelEvent summaries and scores
// six discriminative signals to classify the active device as mouse or
// trackpad. Asymmetric hysteresis (4 mouse to enter, 2 trackpad to
// leave) prevents rapid flip-flopping. See _scoreWindow() for signals.

export class WheelDeviceClassifier {
  constructor() {
    /** @type {'unknown' | 'mouse' | 'trackpad'} */
    this._device = 'unknown';
    this._lastEventTime = 0;
    /** @type {Array<{absX: number, absY: number, isFractional: boolean, hasBothAxes: boolean, deltaMode: number, gap: number}>} */
    this._events = [];
  }

  /**
   * Process a WheelEvent and return the current device classification.
   * Always returns 'mouse' or 'trackpad', never 'unknown'.
   * When uncertain, defaults to 'trackpad' (safe — routes to pan).
   * @param {WheelEvent} e
   * @returns {'mouse' | 'trackpad'}
   */
  classify(e) {
    const now = performance.now();
    let gap = now - this._lastEventTime;

    // Silence reset: user may have switched devices
    if (gap > CLASSIFIER_SILENCE_MS) {
      this._device = 'unknown';
      this._events = [];
      gap = 0; // First event after silence has no meaningful predecessor
    }

    // Record event summary
    this._events.push({
      absX: Math.abs(e.deltaX),
      absY: Math.abs(e.deltaY),
      isFractional: (e.deltaY % 1 !== 0) || (e.deltaX % 1 !== 0),
      hasBothAxes: e.deltaX !== 0 && e.deltaY !== 0,
      deltaMode: e.deltaMode,
      gap
    });
    if (this._events.length > CLASSIFIER_WINDOW_SIZE) {
      this._events.shift();
    }
    this._lastEventTime = now;

    // Score window
    const scores = this._scoreWindow();

    // Bayesian-style update with hysteresis
    if (this._device === 'unknown') {
      this._device = scores.mouseSignals >= 2 ? 'mouse' : 'trackpad';
    } else if (this._device === 'trackpad'
               && scores.mouseSignals >= CLASSIFIER_MOUSE_THRESHOLD) {
      this._device = 'mouse';
    } else if (this._device === 'mouse'
               && scores.trackpadSignals >= CLASSIFIER_TRACKPAD_THRESHOLD) {
      this._device = 'trackpad';
    }

    return this._device;
  }

  /**
   * Score the sliding window of event summaries across six discriminative
   * signals. Each signal independently increments mouse or trackpad counters.
   * @returns {{ mouseSignals: number, trackpadSignals: number }}
   * @private
   */
  _scoreWindow() {
    let mouseSignals = 0;
    let trackpadSignals = 0;

    for (const evt of this._events) {
      const maxDelta = Math.max(evt.absX, evt.absY);

      // Signal 1: Inter-event timing
      if (evt.gap > 0 && evt.gap < 25) trackpadSignals++;
      if (evt.gap > 80) mouseSignals++;

      // Signal 2: Fractional deltas
      if (evt.isFractional) trackpadSignals++;

      // Signal 3: Simultaneous axes
      if (evt.hasBothAxes) trackpadSignals++;

      // Signal 4: deltaMode LINE (Firefox only)
      if (evt.deltaMode === 1) mouseSignals++;

      // Signal 5: Very small deltas (pixel mode only — line-mode 3 ≠ 3px)
      if (maxDelta > 0 && maxDelta < 4 && evt.deltaMode === 0) trackpadSignals++;

      // Signal 6: Large integer vertical-only delta (only if timing is ambiguous/slow)
      if (maxDelta >= 50 && maxDelta % 1 === 0 && evt.absX === 0 && evt.gap > 40) {
        mouseSignals++;
      }
    }

    return { mouseSignals, trackpadSignals };
  }

  /** Current classification. Returns 'trackpad' when 'unknown' (safe default). */
  get device() {
    return this._device === 'unknown' ? 'trackpad' : this._device;
  }

  /** Force reset to unknown state. */
  reset() {
    this._device = 'unknown';
    this._events = [];
    this._lastEventTime = 0;
  }
}
