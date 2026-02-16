// shared/sync/debug-overlay.js
// Fixed-position overlay showing sync status at a glance.
// Only instantiated when localStorage.getItem('debug-sync') === 'true'.
// Renders every 250ms. Zero cost when disabled.

export class SyncDebugOverlay {
  constructor(engine, tracker) {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem('debug-sync') !== 'true') return;

    this._engine = engine;
    this._tracker = tracker;
    this._timer = null;

    this._el = document.createElement('div');
    Object.assign(this._el.style, {
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
      whiteSpace: 'pre-line',
    });
    document.body.appendChild(this._el);
    this._timer = setInterval(() => this._render(), 250);
  }

  _render() {
    if (!this._el) return;

    this._tracker.updateRates();
    const state = this._engine.getDebugState();
    const latency = this._tracker.getStats();
    const rates = this._tracker.getRates();

    const lines = [
      `[${state.role}] ${state.status}`,
      `Peers: ${state.peerCount} | Authority: ${state.isAuthority ? 'yes' : '-'}`,
      `Camera: ${state.camera?.centerX?.toFixed(0) ?? '?'}, ${state.camera?.centerY?.toFixed(0) ?? '?'} z:${state.camera?.zoom?.toFixed(2) ?? '?'}`,
      `Msgs/s: sent ${rates.sent} | recv ${rates.received}`,
    ];
    if (latency) {
      lines.push(`Latency: ${latency.median?.toFixed(1)}ms (p95: ${latency.p95?.toFixed(1)}ms)`);
    }
    lines.push(`${document.visibilityState} | seq:${state.seq ?? 0}`);

    this._el.textContent = lines.join('\n');
  }

  destroy() {
    if (this._timer) clearInterval(this._timer);
    this._el?.remove();
    this._el = null;
  }
}
