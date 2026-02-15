// Camera Sync Engine (Phase 4)
//
// Cross-window camera synchronization over BroadcastChannel.
// CameraBroadcaster sends local camera state as a viewport-independent
// center-point at ~30fps. CameraReceiver applies received state through
// camera.deserialize(), which routes through _applyConstraints().
//
// Architecture:
//   Controller window: runs CameraBroadcaster (sends state)
//   Display window:    runs CameraReceiver (applies state)
//   DM Guide window:   neither (independent camera)

import { EventBus } from './state.js';
import {
  localToShared,
  sharedToLocal,
  createCameraSyncMsg,
  createCameraJumpToMsg,
  createAnnounceMsg,
  createWelcomeMsg,
  createHeartbeatMsg,
  createGoodbyeMsg,
  MSG,
  validateMessage,
} from '../../shared/protocol.js';

// --- Constants ---

const MIN_SEND_INTERVAL = 33;  // ~30fps cap (ms)
const EPSILON_POS  = 0.5;      // world pixels: sub-pixel changes are invisible
const EPSILON_ZOOM = 0.001;    // zoom delta: <0.1% change is invisible

/** Generate a unique window ID (8 random hex chars). */
function generateWindowId() {
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================
// CameraBroadcaster
// ============================================================

export class CameraBroadcaster {
  /**
   * @param {object} camera - The Camera instance from map-camera.js
   * @param {BroadcastChannel} channel - The 'vtt-camera' BroadcastChannel
   * @param {string} senderId - Unique window identifier
   */
  constructor(camera, channel, senderId) {
    this._camera = camera;
    this._channel = channel;
    this._senderId = senderId;

    this._lastSendTime = 0;
    this._rafId = null;
    this._running = false;

    // Last sent state (for epsilon comparison)
    this._lastCenterX = NaN;
    this._lastCenterY = NaN;
    this._lastZoom = NaN;

    this._seq = 0;

    // Suppress flag: set by CameraReceiver to prevent ping-pong
    this.suppressBroadcast = false;

    // Pre-allocated message template to reduce GC pressure at 30fps
    this._msgTemplate = {
      type: MSG.CAMERA_SYNC,
      centerX: 0,
      centerY: 0,
      zoom: 0,
      seq: 0,
      senderId: this._senderId,
    };

    this._tick = this._tick.bind(this);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastSendTime = 0;
    this._rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    this._running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  setChannel(channel) {
    this._channel = channel;
  }

  sendJumpTo(centerX, centerY, zoom) {
    const m = createCameraJumpToMsg(centerX, centerY, zoom, this._senderId);
    this._channel.postMessage(m);
    this._lastCenterX = centerX;
    this._lastCenterY = centerY;
    this._lastZoom = zoom;
  }

  sendImmediate() {
    this._sendState(performance.now());
  }

  _tick(now) {
    if (!this._running) return;
    if (now - this._lastSendTime >= MIN_SEND_INTERVAL) {
      this._sendState(now);
    }
    this._rafId = requestAnimationFrame(this._tick);
  }

  _sendState(now) {
    if (this.suppressBroadcast) return;

    const cam = this._camera;
    const vp = { width: cam.viewportW, height: cam.viewportH };
    if (vp.width <= 0 || vp.height <= 0) return;

    const shared = localToShared(cam, vp);

    // Epsilon check: skip if nothing meaningful changed
    if (
      Math.abs(shared.centerX - this._lastCenterX) < EPSILON_POS &&
      Math.abs(shared.centerY - this._lastCenterY) < EPSILON_POS &&
      Math.abs(shared.zoom - this._lastZoom) < EPSILON_ZOOM
    ) {
      return;
    }

    this._msgTemplate.centerX = shared.centerX;
    this._msgTemplate.centerY = shared.centerY;
    this._msgTemplate.zoom = shared.zoom;
    this._msgTemplate.seq = ++this._seq;

    this._channel.postMessage(this._msgTemplate);

    this._lastCenterX = shared.centerX;
    this._lastCenterY = shared.centerY;
    this._lastZoom = shared.zoom;
    this._lastSendTime = performance.now();
  }

  destroy() {
    this.stop();
    this._channel = null;
    this._camera = null;
  }
}
