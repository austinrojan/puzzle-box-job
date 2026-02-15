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

// ============================================================
// CameraReceiver
// ============================================================

export class CameraReceiver {
  /**
   * @param {object} camera - The Camera instance from map-camera.js
   * @param {CameraBroadcaster|null} broadcaster
   *   If this window also has a broadcaster, pass it so the receiver
   *   can set suppressBroadcast during state application.
   */
  constructor(camera, broadcaster = null) {
    this._camera = camera;
    this._broadcaster = broadcaster;
    this._senderSeqs = new Map();
  }

  handleMessage(msg) {
    if (msg.type === MSG.CAMERA_SYNC) {
      this._handleSync(msg);
    } else if (msg.type === MSG.CAMERA_JUMP_TO) {
      this._handleJumpTo(msg);
    }
  }

  _handleSync(msg) {
    const { senderId, seq, centerX, centerY, zoom } = msg;
    const prevSeq = this._senderSeqs.get(senderId) ?? -1;
    if (seq <= prevSeq) return;
    this._senderSeqs.set(senderId, seq);
    this._applySharedState(centerX, centerY, zoom);
  }

  _handleJumpTo(msg) {
    const { centerX, centerY, zoom } = msg;
    this._applySharedState(centerX, centerY, zoom);
  }

  _applySharedState(centerX, centerY, zoom) {
    const cam = this._camera;
    const vp = { width: cam.viewportW, height: cam.viewportH };
    if (vp.width <= 0 || vp.height <= 0) return;

    const local = sharedToLocal({ centerX, centerY, zoom }, vp);

    if (this._broadcaster) {
      this._broadcaster.suppressBroadcast = true;
    }

    cam.deserialize({
      x: local.x,
      y: local.y,
      zoom: local.zoom,
    });

    if (this._broadcaster) {
      this._broadcaster.suppressBroadcast = false;
    }
  }

  applyWelcomeState(centerX, centerY, zoom) {
    this._applySharedState(centerX, centerY, zoom);
  }

  removeSender(senderId) {
    this._senderSeqs.delete(senderId);
  }

  destroy() {
    this._senderSeqs.clear();
    this._camera = null;
    this._broadcaster = null;
  }
}

// ============================================================
// WindowRegistry
// ============================================================

const HEARTBEAT_INTERVAL = 3000;  // ms between heartbeats
const HEARTBEAT_TIMEOUT  = 10000; // ms before a peer is considered dead

export class WindowRegistry {
  constructor(windowId, role, channel) {
    this._windowId = windowId;
    this._role = role;
    this._channel = channel;
    this._peers = new Map();
    this._heartbeatTimer = null;
    this._reapTimer = null;
    this._epoch = 0;
    this._onPeerJoin = null;
    this._onPeerLeave = null;
  }

  onPeerChange({ onJoin, onLeave }) {
    this._onPeerJoin = onJoin || null;
    this._onPeerLeave = onLeave || null;
  }

  setChannel(channel) {
    this._channel = channel;
  }

  start() {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    if (this._reapTimer) clearInterval(this._reapTimer);

    this._channel.postMessage(
      createAnnounceMsg(this._windowId, this._role)
    );

    this._heartbeatTimer = setInterval(() => {
      this._channel.postMessage(
        createHeartbeatMsg(this._windowId, this._role)
      );
    }, HEARTBEAT_INTERVAL);

    this._reapTimer = setInterval(() => this._reapDeadPeers(), HEARTBEAT_INTERVAL);
  }

  stop() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._reapTimer) {
      clearInterval(this._reapTimer);
      this._reapTimer = null;
    }
    try {
      this._channel.postMessage(createGoodbyeMsg(this._windowId));
    } catch (e) {
      // Channel may already be closed
    }
  }

  handleMessage(msg, onAnnounce) {
    switch (msg.type) {
      case MSG.ANNOUNCE:
        this._handleAnnounce(msg, onAnnounce);
        break;
      case MSG.WELCOME:
        this._handleWelcome(msg);
        break;
      case MSG.HEARTBEAT:
        this._touchPeer(msg.windowId, msg.role);
        break;
      case MSG.GOODBYE:
        this._handleGoodbye(msg);
        break;
    }
  }

  _handleAnnounce(msg, onAnnounce) {
    if (msg.windowId === this._windowId) return;
    this._touchPeer(msg.windowId, msg.role);

    if (onAnnounce) {
      const cameraState = onAnnounce(msg.windowId, msg.role);
      if (cameraState) {
        this._epoch++;
        this._channel.postMessage(
          createWelcomeMsg(
            this._windowId,
            this._role,
            msg.windowId,
            cameraState,
            this._epoch
          )
        );
      }
    }
  }

  _handleWelcome(msg) {
    if (msg.targetWindowId !== this._windowId) return;
    this._touchPeer(msg.windowId, msg.role);
    EventBus.emit('camera-sync:welcome', {
      fromWindowId: msg.windowId,
      fromRole: msg.role,
      camera: msg.camera,
      epoch: msg.epoch,
    });
  }

  _handleGoodbye(msg) {
    const peer = this._peers.get(msg.windowId);
    if (peer) {
      this._peers.delete(msg.windowId);
      if (this._onPeerLeave) {
        this._onPeerLeave(msg.windowId, peer.role);
      }
    }
  }

  _touchPeer(windowId, role) {
    if (windowId === this._windowId) return;
    const isNew = !this._peers.has(windowId);
    this._peers.set(windowId, { role, lastSeen: performance.now() });
    if (isNew && this._onPeerJoin) {
      this._onPeerJoin(windowId, role);
    }
  }

  _reapDeadPeers() {
    const now = performance.now();
    for (const [windowId, peer] of this._peers) {
      if (now - peer.lastSeen > HEARTBEAT_TIMEOUT) {
        this._peers.delete(windowId);
        if (this._onPeerLeave) {
          this._onPeerLeave(windowId, peer.role);
        }
      }
    }
  }

  countByRole(role) {
    let count = 0;
    for (const peer of this._peers.values()) {
      if (peer.role === role) count++;
    }
    return count;
  }

  hasRole(role) {
    return this.countByRole(role) > 0;
  }

  destroy() {
    this.stop();
    this._peers.clear();
    this._channel = null;
  }
}
