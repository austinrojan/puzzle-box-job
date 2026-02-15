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
  createCameraJumpToMsg,
  createAnnounceMsg,
  createWelcomeMsg,
  createHeartbeatMsg,
  createGoodbyeMsg,
  MSG,
  PROTOCOL_VERSION,
} from '../../shared/protocol.js';

// --- Constants ---

const MIN_SEND_INTERVAL = 33;  // ~30fps cap (ms)
const EPSILON_POS  = 0.5;      // world pixels: sub-pixel changes are invisible
const EPSILON_ZOOM = 0.001;    // zoom delta: <0.1% change is invisible
const WELCOME_DEBOUNCE_MS = 150; // Wait for multiple WELCOME messages before applying best one

/** Generate a unique window ID (8 random hex chars). */
function generateWindowId() {
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

/** Build viewport-size object from a Camera instance. */
function cameraViewport(camera) {
  return { width: camera.viewportW, height: camera.viewportH };
}

/** True if viewport has positive dimensions (map is loaded). */
function viewportReady(vp) {
  return vp.width > 0 && vp.height > 0;
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
      _v: PROTOCOL_VERSION,
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
    if (!this._channel) return;
    const m = createCameraJumpToMsg(centerX, centerY, zoom, this._senderId);
    this._channel.postMessage(m);

    // Sync local camera so the continuous CAMERA_SYNC stream doesn't
    // immediately overwrite the jump-to on the receiver.
    const vp = cameraViewport(this._camera);
    if (viewportReady(vp)) {
      const local = sharedToLocal({ centerX, centerY, zoom }, vp);
      this.suppressBroadcast = true;
      try {
        this._camera.deserialize(local);
      } finally {
        this.suppressBroadcast = false;
      }
    }

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
    if (!this._channel) return;
    if (this.suppressBroadcast) return;

    const cam = this._camera;
    const vp = cameraViewport(cam);
    if (!viewportReady(vp)) return;

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
    const vp = cameraViewport(cam);
    if (!viewportReady(vp)) return;

    const local = sharedToLocal({ centerX, centerY, zoom }, vp);

    const bc = this._broadcaster;
    if (bc) {
      bc.suppressBroadcast = true;
    }
    try {
      cam.deserialize({
        x: local.x,
        y: local.y,
        zoom: local.zoom,
      });
    } finally {
      if (bc) {
        bc.suppressBroadcast = false;
      }
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

// ============================================================
// CameraChannelManager
// ============================================================

const CAMERA_CHANNEL_NAME = 'vtt-camera';
const SESSION_KEY = 'vtt-camera-state';
const SESSION_MAX_AGE = 5 * 60 * 1000; // 5 minutes

export class CameraChannelManager {
  constructor({ camera, role, onMessage }) {
    this._camera = camera;
    this._role = role;
    this._onMessage = onMessage;
    this._channel = null;
    this._windowId = generateWindowId();

    this._onPageHide = this._onPageHide.bind(this);
    this._onPageShow = this._onPageShow.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
  }

  get channel() { return this._channel; }
  get windowId() { return this._windowId; }

  start() {
    this._openChannel();
    this._attachLifecycleListeners();
    this._tryRestore();
  }

  stop() {
    this._closeChannel();
    this._detachLifecycleListeners();
  }

  _openChannel() {
    if (this._channel) return;
    this._channel = new BroadcastChannel(CAMERA_CHANNEL_NAME);
    this._channel.onmessage = (event) => {
      if (this._onMessage) {
        this._onMessage(event.data);
      }
    };
  }

  _closeChannel() {
    if (!this._channel) return;
    this._channel.close();
    this._channel = null;
  }

  _attachLifecycleListeners() {
    window.addEventListener('pagehide', this._onPageHide);
    window.addEventListener('pageshow', this._onPageShow);
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  _detachLifecycleListeners() {
    window.removeEventListener('pagehide', this._onPageHide);
    window.removeEventListener('pageshow', this._onPageShow);
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
  }

  _onPageHide() {
    this._persistToSessionStorage();
    this._closeChannel();
  }

  _onPageShow(event) {
    if (!this._channel) {
      this._openChannel();
      if (event.persisted) {
        this._tryRestore();
        EventBus.emit('camera-sync:reconnect');
      }
    }
  }

  _onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      this._persistToSessionStorage();
    }
  }

  _persistToSessionStorage() {
    try {
      const cam = this._camera;
      const vp = cameraViewport(cam);
      const shared = localToShared(cam, vp);
      const data = {
        centerX: shared.centerX,
        centerY: shared.centerY,
        zoom: shared.zoom,
        windowId: this._windowId,
        role: this._role,
        timestamp: Date.now(),
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch (e) {
      // sessionStorage may be unavailable
    }
  }

  _tryRestore() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;

      const data = JSON.parse(raw);

      if (Date.now() - data.timestamp > SESSION_MAX_AGE) {
        sessionStorage.removeItem(SESSION_KEY);
        return;
      }

      const cam = this._camera;
      const vp = cameraViewport(cam);
      if (!viewportReady(vp)) return;

      const local = sharedToLocal(data, vp);
      cam.deserialize({
        x: local.x,
        y: local.y,
        zoom: local.zoom,
      });
    } catch (e) {
      // Parse errors, missing keys: ignore silently
    }
  }

  destroy() {
    this.stop();
    this._camera = null;
    this._onMessage = null;
  }
}

// ============================================================
// CameraSyncEngine
// ============================================================

export class CameraSyncEngine {
  constructor({ camera, role }) {
    this._camera = camera;
    this._role = role;
    this._started = false;

    this._channelManager = null;
    this._registry = null;
    this._broadcaster = null;
    this._receiver = null;

    this._bestWelcome = null;
    this._welcomeTimer = null;

    this._onWelcomeEvent = (data) => this._handleWelcomeState(data);
    this._onReconnectEvent = () => this._reconnect();
  }

  start() {
    if (this._started) return;
    this._started = true;

    this._channelManager = new CameraChannelManager({
      camera: this._camera,
      role: this._role,
      onMessage: (msg) => this._handleMessage(msg),
    });
    this._channelManager.start();

    const channel = this._channelManager.channel;
    const windowId = this._channelManager.windowId;

    if (this._role === 'controller') {
      this._broadcaster = new CameraBroadcaster(this._camera, channel, windowId);
      this._receiver = new CameraReceiver(this._camera, this._broadcaster);
      this._broadcaster.start();
    } else if (this._role === 'display') {
      this._receiver = new CameraReceiver(this._camera, null);
    }
    // dm-guide: no broadcaster, no receiver

    this._registry = new WindowRegistry(windowId, this._role, channel);

    this._registry.onPeerChange({
      onJoin: (peerId, peerRole) => {
        EventBus.emit('camera-sync:peer-join', { peerId, peerRole });
      },
      onLeave: (peerId, peerRole) => {
        EventBus.emit('camera-sync:peer-leave', { peerId, peerRole });
        if (this._receiver) {
          this._receiver.removeSender(peerId);
        }
      },
    });

    EventBus.on('camera-sync:welcome', this._onWelcomeEvent);
    EventBus.on('camera-sync:reconnect', this._onReconnectEvent);

    this._registry.start();
  }

  _handleMessage(msg) {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case MSG.CAMERA_SYNC:
      case MSG.CAMERA_JUMP_TO:
        if (this._receiver) {
          this._receiver.handleMessage(msg);
        }
        break;

      case MSG.ANNOUNCE:
      case MSG.WELCOME:
      case MSG.HEARTBEAT:
      case MSG.GOODBYE:
        this._registry.handleMessage(msg, (announcerId, announcerRole) => {
          return this._onAnnounce(announcerId, announcerRole);
        });
        break;
    }
  }

  _onAnnounce(announcerId, announcerRole) {
    const cam = this._camera;
    const vp = cameraViewport(cam);
    if (!viewportReady(vp)) return null;

    const shared = localToShared(cam, vp);
    // Include map dimensions for headless Camera bootstrapping
    shared.mapW = cam.mapW;
    shared.mapH = cam.mapH;
    return shared;
  }

  _handleWelcomeState(data) {
    if (!this._bestWelcome || data.epoch > this._bestWelcome.epoch) {
      this._bestWelcome = data;
    }
    if (this._welcomeTimer) clearTimeout(this._welcomeTimer);
    this._welcomeTimer = setTimeout(() => {
      this._applyWelcome();
    }, WELCOME_DEBOUNCE_MS);
  }

  _applyWelcome() {
    if (!this._bestWelcome) return;

    const { camera } = this._bestWelcome;
    if (camera && this._receiver) {
      // Bootstrap map dimensions for headless Camera (Controller)
      if (camera.mapW > 0 && camera.mapH > 0 && this._camera.mapW <= 0) {
        this._camera.setMapSize(camera.mapW, camera.mapH);
      }
      this._receiver.applyWelcomeState(camera.centerX, camera.centerY, camera.zoom);
    }

    this._bestWelcome = null;
    this._welcomeTimer = null;
  }

  _reconnect() {
    const channel = this._channelManager.channel;
    if (!channel) return;

    if (this._broadcaster) {
      this._broadcaster.setChannel(channel);
    }
    this._registry.setChannel(channel);
    this._registry.start();

    if (this._broadcaster) {
      this._broadcaster.start();
    }
  }

  stop() {
    if (this._broadcaster) this._broadcaster.stop();
    if (this._registry) this._registry.stop();
    if (this._channelManager) this._channelManager.stop();
    if (this._welcomeTimer) clearTimeout(this._welcomeTimer);
    this._started = false;
  }

  destroy() {
    this.stop();
    EventBus.off('camera-sync:welcome', this._onWelcomeEvent);
    EventBus.off('camera-sync:reconnect', this._onReconnectEvent);
    if (this._broadcaster) this._broadcaster.destroy();
    if (this._receiver) this._receiver.destroy();
    if (this._registry) this._registry.destroy();
    if (this._channelManager) this._channelManager.destroy();
  }

  /** Immediately broadcast current camera state, bypassing rAF polling. */
  sendNow() {
    if (this._broadcaster) {
      this._broadcaster.sendImmediate();
    }
  }

  get broadcaster() { return this._broadcaster; }
}
