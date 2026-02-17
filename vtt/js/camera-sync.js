// Camera Sync Engine (Phase 4 + Phase 5 transport abstraction)
//
// Cross-window camera synchronization over ISyncTransport.
// CameraBroadcaster sends local camera state as a viewport-independent
// center-point at ~30fps. CameraReceiver applies received state through
// camera.deserialize(), which routes through _applyConstraints().
//
// Phase 5 additions:
//   - ISyncTransport abstraction (replaces direct BroadcastChannel)
//   - setAnimator/setInterpolator delegation for flyTo + smoothing
//   - CAMERA_FLY_TO message handling in CameraReceiver

import { EventBus } from './state.js';
import { BroadcastChannelTransport } from '../../shared/sync/BroadcastChannelTransport.js';
import {
  localToShared,
  sharedToLocal,
  createCameraJumpToMsg,
  createCameraFlyToMsg,
  createPresetSyncMsg,
  createAnnounceMsg,
  createWelcomeMsg,
  createHeartbeatMsg,
  createGoodbyeMsg,
  MSG,
  PROTOCOL_VERSION,
  validateMessage,
} from '../../shared/protocol.js';

// --- Constants ---

const MIN_SEND_INTERVAL = 33;  // ~30fps cap (ms)
const EPSILON_POS  = 0.5;      // world pixels: sub-pixel changes are invisible
const EPSILON_ZOOM = 0.001;    // zoom delta: <0.1% change is invisible
const WELCOME_DEBOUNCE_MS = 150; // Wait for multiple WELCOME messages before applying best one
const CAMERA_CHANNEL_NAME = 'vtt-camera';
const SESSION_KEY = 'vtt-camera-state';
const SESSION_MAX_AGE = 5 * 60 * 1000; // 5 minutes

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
   * @param {ISyncTransport} transport - The sync transport
   * @param {string} senderId - Unique window identifier
   */
  constructor(camera, transport, senderId) {
    this._camera = camera;
    this._transport = transport;
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

    // Phase 5: animator/interpolator suppress sources
    this._animator = null;
    this._interpolator = null;

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

  setAnimator(animator) { this._animator = animator; }
  setInterpolator(interpolator) { this._interpolator = interpolator; }

  sendJumpTo(centerX, centerY, zoom) {
    const m = createCameraJumpToMsg(centerX, centerY, zoom, this._senderId);
    this._transport.send(m);

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

  /** Broadcast a flyTo command to all receiving windows. */
  sendFlyTo(target, opts = {}) {
    const msg = createCameraFlyToMsg(this._senderId, ++this._seq, target, {
      duration: opts.duration ?? null,
      rho: opts.rho ?? 1.42,
      speed: opts.speed ?? 1.2,
      presetId: opts.presetId ?? null,
    });
    this._transport.send(msg);
  }

  /** Broadcast all presets to receiving windows. */
  sendPresetSync(presets) {
    const msg = createPresetSyncMsg(this._senderId, ++this._seq, presets);
    this._transport.send(msg);
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

  /** True if any system (receiver, animator, interpolator) is suppressing broadcasts. */
  _isBroadcastSuppressed() {
    return this.suppressBroadcast ||
           this._animator?.suppressBroadcast ||
           this._interpolator?.suppressBroadcast;
  }

  _sendState(now) {
    if (this._isBroadcastSuppressed()) return;

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

    this._transport.send({ ...this._msgTemplate });

    this._lastCenterX = shared.centerX;
    this._lastCenterY = shared.centerY;
    this._lastZoom = shared.zoom;
    this._lastSendTime = performance.now();
  }

  destroy() {
    this.stop();
    this._transport = null;
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

    // Phase 5
    this._animator = null;
    this._interpolator = null;
    this._presetManager = null;
    this._lastFlyToSeq = -1;
  }

  setAnimator(animator) { this._animator = animator; }
  setInterpolator(interpolator) { this._interpolator = interpolator; }
  setPresetManager(pm) { this._presetManager = pm; }

  handleMessage(msg) {
    if (msg.type === MSG.CAMERA_SYNC) {
      this._handleSync(msg);
    } else if (msg.type === MSG.CAMERA_JUMP_TO) {
      this._handleJumpTo(msg);
    } else if (msg.type === MSG.CAMERA_FLY_TO) {
      this._handleFlyTo(msg);
    } else if (msg.type === MSG.PRESET_SYNC) {
      this._handlePresetSync(msg);
    }
  }

  _handleSync(msg) {
    const { senderId, seq, centerX, centerY, zoom } = msg;
    const prevSeq = this._senderSeqs.get(senderId) ?? -1;
    if (seq <= prevSeq) return;
    this._senderSeqs.set(senderId, seq);

    // Phase 5: route through interpolator if available
    if (this._interpolator) {
      const cam = this._camera;
      const vp = cameraViewport(cam);
      if (!viewportReady(vp)) return;
      const local = sharedToLocal({ centerX, centerY, zoom }, vp);
      this._interpolator.setTarget(local);
    } else {
      this._applySharedState(centerX, centerY, zoom);
    }
  }

  _handleJumpTo(msg) {
    const { centerX, centerY, zoom } = msg;
    this._applySharedState(centerX, centerY, zoom);

    // Reset interpolator so it doesn't smoothly converge from old position
    if (this._interpolator) {
      const cam = this._camera;
      const vp = cameraViewport(cam);
      if (viewportReady(vp)) {
        const local = sharedToLocal({ centerX, centerY, zoom }, vp);
        this._interpolator.setTarget(local);
        this._interpolator.snapToTarget();
      }
    }
  }

  _handleFlyTo(msg) {
    if (msg.seq <= this._lastFlyToSeq) return;
    this._lastFlyToSeq = msg.seq;

    if (!this._animator) return;

    const { target, duration, rho, speed } = msg;
    this._animator.flyTo(target, {
      duration,
      rho,
      speed,
      suppressBroadcast: true,
    });
  }

  _handlePresetSync(msg) {
    if (this._presetManager && Array.isArray(msg.presets)) {
      this._presetManager.importAll(msg.presets);
    }
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

    // Sync interpolator to prevent snap-back from stale _current
    if (this._interpolator) {
      const cam = this._camera;
      const vp = cameraViewport(cam);
      if (viewportReady(vp)) {
        const local = sharedToLocal({ centerX, centerY, zoom }, vp);
        this._interpolator.setTarget(local);
        this._interpolator.snapToTarget();
      }
    }
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
  constructor(windowId, role, transport) {
    this._windowId = windowId;
    this._role = role;
    this._transport = transport;
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

  start() {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    if (this._reapTimer) clearInterval(this._reapTimer);

    this._transport.send(
      createAnnounceMsg(this._windowId, this._role)
    );

    this._heartbeatTimer = setInterval(() => {
      this._transport.send(
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
    this._transport.send(createGoodbyeMsg(this._windowId));
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
        this._transport.send(
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
    this._transport = null;
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

    this._transport = null;
    this._registry = null;
    this._broadcaster = null;
    this._receiver = null;
    this._windowId = generateWindowId();

    this._bestWelcome = null;
    this._welcomeTimer = null;

    this._onPageHide = this._onPageHide.bind(this);
    this._onPageShow = this._onPageShow.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
    this._onWelcomeEvent = (data) => this._handleWelcomeState(data);
    this._onReconnectEvent = () => this._reconnect();
  }

  start() {
    if (this._started) return;
    this._started = true;

    // Create and connect transport
    this._transport = new BroadcastChannelTransport(CAMERA_CHANNEL_NAME);
    this._transport.onMessage((msg) => this._handleMessage(msg));
    this._transport.connect();

    // Restore from sessionStorage
    this._tryRestore();

    // Attach page lifecycle listeners
    this._attachLifecycleListeners();

    const windowId = this._windowId;

    if (this._role === 'controller') {
      this._broadcaster = new CameraBroadcaster(this._camera, this._transport, windowId);
      this._receiver = new CameraReceiver(this._camera, this._broadcaster);
      this._broadcaster.start();
    } else if (this._role === 'display') {
      this._receiver = new CameraReceiver(this._camera, null);
    }
    // dm-guide: no broadcaster, no receiver

    this._registry = new WindowRegistry(windowId, this._role, this._transport);

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

  // --- Phase 5: Animator/Interpolator delegation ---

  setAnimator(animator) {
    if (this._receiver) this._receiver.setAnimator(animator);
    if (this._broadcaster) this._broadcaster.setAnimator(animator);
  }

  setInterpolator(interpolator) {
    if (this._receiver) this._receiver.setInterpolator(interpolator);
    if (this._broadcaster) this._broadcaster.setInterpolator(interpolator);
  }

  setPresetManager(pm) {
    this._presetManager = pm;
    if (this._receiver) this._receiver.setPresetManager(pm);
  }

  setElection(election) {
    this._election = election;
  }

  // --- Message routing ---

  _handleMessage(msg) {
    if (!msg || !msg.type) return;
    const { valid } = validateMessage(msg);
    if (!valid) return;

    switch (msg.type) {
      case MSG.CAMERA_SYNC:
      case MSG.CAMERA_JUMP_TO:
      case MSG.CAMERA_FLY_TO:
      case MSG.PRESET_SYNC:
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
    // Phase 5: include presets for late-joining windows
    if (this._presetManager) {
      shared.presets = this._presetManager.exportAll();
    }
    return shared;
  }

  // --- WELCOME debounce ---

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

      // Phase 5: import presets from WELCOME payload
      if (camera.presets && this._presetManager) {
        this._presetManager.importAll(camera.presets);
      }
    }

    this._bestWelcome = null;
    this._welcomeTimer = null;
  }

  // --- Page Lifecycle ---

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
    if (this._registry) this._registry.stop();
    if (this._broadcaster) this._broadcaster.stop();
    if (this._transport) this._transport.disconnect();
  }

  _onPageShow(event) {
    if (!this._transport || !this._transport.connected) {
      this._transport.connect();
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
      if (!viewportReady(vp)) return;
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

  _reconnect() {
    if (!this._transport?.connected) return;
    this._registry.start();
    if (this._broadcaster) {
      this._broadcaster.start();
    }
  }

  // --- Lifecycle ---

  stop() {
    if (this._broadcaster) this._broadcaster.stop();
    if (this._registry) this._registry.stop();
    if (this._transport) this._transport.disconnect();
    if (this._welcomeTimer) clearTimeout(this._welcomeTimer);
    this._started = false;
  }

  destroy() {
    this.stop();
    this._detachLifecycleListeners();
    EventBus.off('camera-sync:welcome', this._onWelcomeEvent);
    EventBus.off('camera-sync:reconnect', this._onReconnectEvent);
    if (this._broadcaster) this._broadcaster.destroy();
    if (this._receiver) this._receiver.destroy();
    if (this._registry) this._registry.destroy();
    if (this._transport) this._transport.destroy();
  }

  /** Immediately broadcast current camera state, bypassing rAF polling. */
  sendNow() {
    if (this._broadcaster) {
      this._broadcaster.sendImmediate();
    }
  }

  // --- Debug ---

  getDebugState() {
    const cam = this._camera;
    const vp = cameraViewport(cam);
    const shared = viewportReady(vp) ? localToShared(cam, vp) : null;
    return {
      role: this._role,
      status: this._transport?.connected ? 'connected' : 'disconnected',
      peerCount: this._registry ? this._registry.countByRole('controller') + this._registry.countByRole('display') : 0,
      isAuthority: this._election?.isAuthority ?? false,
      camera: shared,
      seq: this._broadcaster?._seq ?? 0,
    };
  }

  // --- Getters ---

  get broadcaster() { return this._broadcaster; }
  get registry() { return this._registry; }
  get transport() { return this._transport; }
  get windowId() { return this._windowId; }
}
