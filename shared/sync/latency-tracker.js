// shared/sync/latency-tracker.js
// Measures cross-window latency using high-resolution timestamps.
// Both windows use performance.timeOrigin + performance.now() for
// absolute time, so clock skew is not an issue for same-origin
// BroadcastChannel communication.

export class SyncLatencyTracker {
  constructor(maxSamples = 300) {
    this._maxSamples = maxSamples;
    this._measurements = [];
    this._rates = { sent: 0, received: 0 };
    this._rateWindow = { sent: 0, received: 0, lastReset: performance.now() };
  }

  trackSend() {
    this._rateWindow.sent++;
  }

  trackReceive(senderTimestamp) {
    this._rateWindow.received++;

    const latency = (performance.timeOrigin + performance.now()) - senderTimestamp;
    this._measurements.push(latency);

    if (this._measurements.length > this._maxSamples) {
      this._measurements.shift();
    }
  }

  /**
   * Update rate counters. Call periodically (e.g., every 250ms).
   */
  updateRates() {
    const now = performance.now();
    const elapsed = (now - this._rateWindow.lastReset) / 1000;
    if (elapsed > 0) {
      this._rates.sent = Math.round(this._rateWindow.sent / elapsed);
      this._rates.received = Math.round(this._rateWindow.received / elapsed);
    }
    this._rateWindow = { sent: 0, received: 0, lastReset: now };
  }

  getStats() {
    if (this._measurements.length === 0) return null;
    const sorted = [...this._measurements].sort((a, b) => a - b);
    return {
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: sorted[sorted.length - 1],
      count: sorted.length,
    };
  }

  getRates() {
    return { ...this._rates };
  }
}
