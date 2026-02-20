# Phase 4: BroadcastChannel camera sync across windows

**This guide replaces the VTT's discrete camera command messages (CAMERA_ZOOM, CAMERA_PAN, CAMERA_RESET) with a continuous 30fps state stream that synchronizes the world-space camera across windows in real time.** The Controller manipulates its local camera, and a CameraBroadcaster sends the camera's center-point state at 30fps over a dedicated BroadcastChannel. The Display's CameraReceiver applies received state through `camera.deserialize()`, which routes through `_applyConstraints()` from Phase 3, ensuring each window's local boundary constraints are respected. A WindowRegistry tracks connected peers via an announce-on-connect handshake with heartbeat-based liveness detection, and Page Lifecycle integration ensures camera state survives tab freezes, bfcache navigation, and tab discards.

The architectural centerpiece is the **center-point camera model**: a viewport-independent shared state `{ centerX, centerY, zoom }` that represents the world-space point at the center of the viewport. Each window converts between its local `Camera = { x, y, zoom }` (where x/y is the top-left corner in world space) and the shared center-point representation using its own viewport dimensions. This means two windows with different viewport sizes, looking at the same world-space center point at the same zoom level, see correctly framed views without either window's coordinate system leaking into the other.

The guide is structured as a walkthrough you can hand directly to Claude Code. Each section explains what the code does and why, provides the complete implementation, calls out interactions with existing modules, and includes testing protocols. Read it front to back before changing anything. The order matters.

---

## Table of contents

1. [What Phase 3 established and what Phase 4 changes](#1-what-phase-3-established-and-what-phase-4-changes)
2. [The center-point camera model: viewport-independent shared state](#2-the-center-point-camera-model)
3. [Protocol additions to shared/protocol.js](#3-protocol-additions)
4. [Dedicated camera channel vs. extending the control channel](#4-channel-architecture)
5. [CameraBroadcaster: rAF-aligned 30fps state streaming](#5-camerabroadcaster)
6. [CameraReceiver: sequence numbers and stale message rejection](#6-camerareceiver)
7. [WindowRegistry and the announce-on-connect handshake](#7-windowregistry-and-announce-on-connect)
8. [Simple authority model: Controller sends, Display receives](#8-simple-authority-model)
9. [Page Lifecycle integration](#9-page-lifecycle-integration)
10. [CAMERA_JUMP_TO: instant camera teleport](#10-camera-jump-to)
11. [Replacing discrete commands with continuous state](#11-replacing-discrete-commands)
12. [Wiring it all together: boot sequence and initialization](#12-wiring-it-together)
13. [CSS changes](#13-css-changes)
14. [Testing protocols](#14-testing-protocols)
15. [Migration checklist](#15-migration-checklist)
16. [What Phase 5 expects from this foundation](#16-phase-5-expectations)
17. [What is explicitly deferred and why](#17-deferred-features)

---

## 1. What Phase 3 established and what Phase 4 changes

### The Phase 3 foundation

Phase 3 delivered boundary clamping, elastic overscroll, and the clamp-on-commit architecture. The methods and infrastructure that Phase 4 depends on:

```javascript
camera.serialize()              // → { x, y, zoom, mapW, mapH, viewportW, viewportH }
camera.deserialize(data)        // applies state, routes through _applyConstraints()
camera.setPosition(x, y, zoom)  // direct state set, routes through _applyConstraints()
camera._applyConstraints()      // single commit point: enforces zoom/pan bounds, emits camera:changed
camera._coverZoom               // dynamic zoom floor (recalculated on resize + map load)
camera.viewportW / viewportH    // current viewport dimensions
camera.mapW / mapH              // current map dimensions in world pixels
camera.x / camera.y             // world-space top-left corner of the viewport
camera.zoom                     // current zoom level
```

Phase 3's key architectural property is that `deserialize()` routes through `_applyConstraints()`. A camera state valid for one window's viewport may violate another window's constraints. Because each receiver applies its own boundary clamping on deserialize, the same shared camera state produces valid (but potentially different-extent) results on different-sized displays. Phase 4 builds directly on this guarantee.

The existing BroadcastChannel protocol in `shared/protocol.js` defines MSG constants, a `REQUIRED_FIELDS` validation map, factory functions (`createXMsg()`), and a `validateMessage()` function. The `vtt/js/state.js` module has a `handleSyncMessage()` switch statement that dispatches incoming messages to EventBus events. Phase 1 added `CAMERA_STATE` as a forward-looking message type; Phase 3 added `CAMERA_ZOOM_PAST_COVER`. The existing channel name is `'vtt-control'`.

### What Phase 4 changes

Phase 4 makes six additions to this foundation:

1. **Introduces the center-point camera model.** Two pure functions, `localToShared()` and `sharedToLocal()`, convert between the local `Camera = { x, y, zoom }` (top-left corner in world space) and a viewport-independent `{ centerX, centerY, zoom }`. All camera state that crosses a BroadcastChannel uses the center-point representation, so windows with different viewport sizes synchronize correctly.

2. **Adds a dedicated `'vtt-camera'` BroadcastChannel** for high-frequency camera state (30fps continuous stream), separate from the existing `'vtt-control'` channel used for discrete commands. This prevents camera state from flooding the control channel's `handleSyncMessage()` switch and allows the camera channel to be independently opened/closed for Page Lifecycle management.

3. **Adds `CameraBroadcaster`**: a class that runs an rAF-aligned loop capped at 30fps, detects epsilon-level changes to avoid sending duplicate state, and suppresses broadcasts while applying received state to prevent ping-pong loops. New file: `vtt/js/camera-sync.js`.

4. **Adds `CameraReceiver`**: a class that tracks per-sender sequence numbers and rejects stale messages (out-of-order delivery from BroadcastChannel is rare but possible during tab freeze/resume). Applies received state through `camera.deserialize()`. Same file as the broadcaster.

5. **Adds `WindowRegistry` and announce-on-connect handshake**: ANNOUNCE/WELCOME/HEARTBEAT/GOODBYE messages enable windows to discover each other, hydrate initial camera state on connect, and detect peer death via heartbeat timeout. The Display responds to a Controller's ANNOUNCE with a WELCOME containing the current camera state.

6. **Replaces discrete camera commands** (`CAMERA_ZOOM`, `CAMERA_PAN`, `CAMERA_RESET`) with the continuous state stream. The Controller's zoom/pan buttons now modify the Controller's local camera state, which the CameraBroadcaster sends automatically. The Display receives via CameraReceiver. A new `CAMERA_JUMP_TO` message provides instant teleport for preset buttons.

Phase 4 does **not** add animated transitions (flyTo), camera presets, transport abstractions, authority election, debug overlays, or interpolation smoothing. Those belong to Phase 5. The sync engine built here is intentionally simple: one authority (the Controller), one follower (the Display), fire-and-forget state streaming, last-writer-wins conflict resolution.

---

## 2. The center-point camera model

### Why local coordinates do not work for cross-window sync

The Phase 1 camera stores `{ x, y, zoom }` where `x` and `y` are the world-space coordinates of the viewport's **top-left corner**. Consider two windows looking at the same map:

- Controller: 1920x1080 viewport, `camera = { x: 200, y: 100, zoom: 1.5 }`
- Display: 3840x2160 viewport

If the Display applies `{ x: 200, y: 100, zoom: 1.5 }` directly, the center of its viewport shows a different part of the map than the Controller's center. The Controller's center is at world point `(200 + 1920/2/1.5, 100 + 1080/2/1.5) = (840, 460)`. The Display's center would be at `(200 + 3840/2/1.5, 100 + 2160/2/1.5) = (1480, 820)`. Same top-left corner, completely different viewing experience.

Google Maps, Mapbox GL JS, and Leaflet all solve this by syncing the **center point** of the viewport rather than the top-left corner. The center point is viewport-independent: "the camera is looking at world point (840, 460) at zoom 1.5" means the same thing regardless of screen size.

### The conversion functions

Add these to `shared/protocol.js` as exported pure functions:

```javascript
// ============================================================
// Center-point camera model (Phase 4)
// ============================================================
//
// The local camera uses top-left origin: Camera = { x, y, zoom }
// where (x, y) is the world-space position of the viewport's
// top-left corner.
//
// The shared camera uses center-point origin:
//   SharedCameraState = { centerX, centerY, zoom }
// where (centerX, centerY) is the world-space position of the
// viewport's center.
//
// Derivation:
//   The viewport center in screen space is (vw/2, vh/2).
//   screenToWorld gives: worldX = screenX / zoom + camera.x
//   So: centerX = (vw/2) / zoom + camera.x
//       centerY = (vh/2) / zoom + camera.y
//
//   Inverse: camera.x = centerX - (vw/2) / zoom
//            camera.y = centerY - (vh/2) / zoom

/**
 * Convert local camera state to viewport-independent shared state.
 *
 * @param {{ x: number, y: number, zoom: number }} camera
 *   Local camera (top-left world-space origin)
 * @param {{ width: number, height: number }} viewport
 *   Viewport dimensions in pixels
 * @returns {{ centerX: number, centerY: number, zoom: number }}
 */
export function localToShared(camera, viewport) {
  return {
    centerX: camera.x + (viewport.width / 2) / camera.zoom,
    centerY: camera.y + (viewport.height / 2) / camera.zoom,
    zoom: camera.zoom,
  };
}

/**
 * Convert viewport-independent shared state to local camera state.
 *
 * @param {{ centerX: number, centerY: number, zoom: number }} shared
 *   Shared camera (center-point world-space origin)
 * @param {{ width: number, height: number }} viewport
 *   Viewport dimensions in pixels
 * @returns {{ x: number, y: number, zoom: number }}
 */
export function sharedToLocal(shared, viewport) {
  return {
    x: shared.centerX - (viewport.width / 2) / shared.zoom,
    y: shared.centerY - (viewport.height / 2) / shared.zoom,
    zoom: shared.zoom,
  };
}
```

### Placement

Add these after the existing factory functions in `shared/protocol.js`, before the `validateMessage()` export.

### The math in action

Controller (1920x1080, camera at `{ x: 200, y: 100, zoom: 1.5 }`):
```
centerX = 200 + (960 / 1.5) = 200 + 640 = 840
centerY = 100 + (540 / 1.5) = 100 + 360 = 460
shared = { centerX: 840, centerY: 460, zoom: 1.5 }
```

Display (3840x2160) receives `{ centerX: 840, centerY: 460, zoom: 1.5 }`:
```
x = 840 - (1920 / 1.5) = 840 - 1280 = -440
y = 460 - (1080 / 1.5) = 460 - 720  = -260
local = { x: -440, y: -260, zoom: 1.5 }
```

Both windows now show world point (840, 460) at their viewport center. The Display sees a larger extent of the map because its viewport is bigger, but the framing is centered on the same spot. The Display's `deserialize()` passes through `_applyConstraints()`, which clamps the position if it violates the Display's local boundary constraints.

### Why zoom is shared directly

You might ask: "Should zoom be adapted per viewport, like the position is?" No. Zoom represents magnification: how many world pixels per screen pixel. If the Controller is at zoom 1.5, the Display at zoom 1.5 shows the same level of detail per pixel, just more of it because the viewport is larger. This matches the behavior of every production mapping and design tool. The alternative (adapting zoom to produce the same visible world extent) would force the Display to show a lower zoom level, which loses detail and feels wrong to the DM who is controlling the camera.

The one place zoom does differ per viewport is the **cover zoom floor**: the minimum zoom that fills the viewport without black bars. The Controller's cover zoom for a 1600x900 map is `max(1920/1600, 1080/900) = 1.2`. The Display's cover zoom might be `max(3840/1600, 2160/900) = 2.4`. If the Controller sends zoom 1.2 (its floor), the Display's `_applyConstraints()` clamps it up to 2.4. This is correct: the Display should never show black bars just because the Controller is at a lower zoom floor.

---

## 3. Protocol additions

### New message types

Add these to the `MSG` object in `shared/protocol.js`:

```javascript
// In the MSG object, add these entries:

// Phase 4: Camera sync
CAMERA_SYNC:    'camera:sync',     // continuous 30fps state stream
CAMERA_JUMP_TO: 'camera:jump-to',  // instant teleport to position

// Phase 4: Window lifecycle
ANNOUNCE:  'window:announce',   // new window joins
WELCOME:   'window:welcome',    // existing window responds with state
HEARTBEAT: 'window:heartbeat',  // periodic liveness signal
GOODBYE:   'window:goodbye',    // window is closing
```

### Required fields

Add these to the `REQUIRED_FIELDS` map:

```javascript
// Phase 4: Camera sync
[MSG.CAMERA_SYNC]:    ['centerX', 'centerY', 'zoom', 'seq', 'senderId'],
[MSG.CAMERA_JUMP_TO]: ['centerX', 'centerY', 'zoom', 'senderId'],

// Phase 4: Window lifecycle
[MSG.ANNOUNCE]:  ['windowId', 'role'],
[MSG.WELCOME]:   ['windowId', 'role', 'targetWindowId', 'camera', 'epoch'],
[MSG.HEARTBEAT]: ['windowId', 'role'],
[MSG.GOODBYE]:   ['windowId'],
```

### Factory functions

Add these after the existing factory functions:

```javascript
// ============================================================
// Phase 4: Camera sync factory functions
// ============================================================

export function createCameraSyncMsg(centerX, centerY, zoom, seq, senderId) {
  return msg(MSG.CAMERA_SYNC, { centerX, centerY, zoom, seq, senderId });
}

export function createCameraJumpToMsg(centerX, centerY, zoom, senderId) {
  return msg(MSG.CAMERA_JUMP_TO, { centerX, centerY, zoom, senderId });
}

export function createAnnounceMsg(windowId, role) {
  return msg(MSG.ANNOUNCE, { windowId, role });
}

export function createWelcomeMsg(windowId, role, targetWindowId, camera, epoch) {
  return msg(MSG.WELCOME, { windowId, role, targetWindowId, camera, epoch });
}

export function createHeartbeatMsg(windowId, role) {
  return msg(MSG.HEARTBEAT, { windowId, role });
}

export function createGoodbyeMsg(windowId) {
  return msg(MSG.GOODBYE, { windowId });
}
```

### Keeping the existing CAMERA_STATE message

Phase 1 added `MSG.CAMERA_STATE` with `createCameraStateMsg(x, y, zoom)` for one-shot state pushes. Phase 4 introduces `MSG.CAMERA_SYNC` for the continuous 30fps stream, which uses the center-point model and includes sequence numbers. The existing `CAMERA_STATE` can remain for backward compatibility (it still works for one-shot commands that go through the control channel), but the continuous sync uses `CAMERA_SYNC` exclusively.

### Removing discrete camera commands

Phase 4 removes the need for `CAMERA_ZOOM`, `CAMERA_PAN`, and `CAMERA_RESET` messages. These were discrete commands ("zoom in one step", "pan by this delta", "reset to cover") sent from the Controller and executed by the Display. The new model is state-based: the Controller modifies its own camera, and the continuous sync stream propagates the result. Section 11 covers the migration in detail.

The MSG constants and factory functions for `CAMERA_ZOOM`, `CAMERA_PAN`, and `CAMERA_RESET` are **not deleted** in Phase 4. They remain in the protocol for backward compatibility. The Controller simply stops sending them, and the Display's handlers become dead code. A cleanup pass can remove them in Phase 5 if desired.

---

## 4. Dedicated camera channel vs. extending the control channel

### The problem with a single channel

The existing `'vtt-control'` BroadcastChannel carries discrete commands: scene changes, token moves, fog toggles, combat updates. These arrive at a few per second at most. A 30fps camera stream adds 30 messages per second of continuous traffic. Mixing these on one channel creates two problems:

1. **Handler overhead.** Every message hits the `handleSyncMessage()` switch statement. At 30fps, the switch runs 30 times per second checking message type against ~20 cases before hitting the camera sync case. This is not a performance crisis (the overhead is microseconds), but it is architecturally wrong: the camera stream should not flow through the same dispatch path as one-shot commands.

2. **Page Lifecycle interference.** Section 9 explains that BroadcastChannel must be closed on `pagehide` to preserve bfcache eligibility. If the camera channel and control channel are the same object, closing it for bfcache also kills control message delivery. A separate channel lets the camera channel close independently without disrupting control messages.

### The solution: a dedicated `'vtt-camera'` channel

Phase 4 creates a second BroadcastChannel named `'vtt-camera'`. This channel carries:

- `CAMERA_SYNC` (continuous 30fps state stream)
- `CAMERA_JUMP_TO` (instant teleport)
- `ANNOUNCE` / `WELCOME` / `HEARTBEAT` / `GOODBYE` (window lifecycle)

The existing `'vtt-control'` channel continues to carry all non-camera messages. The separation is clean: the camera channel is managed by the `CameraBroadcaster` and `CameraReceiver` classes in `vtt/js/camera-sync.js`, and the control channel is managed by `vtt/js/state.js` as before.

### Why not an abstraction layer

The Phase 4 research document describes an `ISyncTransport` interface and `CompositeTransport` class that abstract over BroadcastChannel and future WebSocket connections. This is deferred to Phase 5. For now, the camera sync classes use `BroadcastChannel` directly. The API surface is small (send, onmessage, close), and wrapping it in an abstraction before there is a second transport implementation would be premature. Phase 5 adds the abstraction when WebSocket support becomes real.

---

## 5. CameraBroadcaster

### What it does

The `CameraBroadcaster` is responsible for one thing: reading the local camera state, converting it to the center-point model, and sending it over the camera BroadcastChannel at a steady 30fps, but only when the state has actually changed.

### The rAF-aligned throttle

The broadcaster runs a `requestAnimationFrame` loop. On each frame, it checks whether at least 33ms (approximately 30fps) have elapsed since the last send. If yes, it reads the camera, checks whether the state has changed beyond epsilon thresholds, and sends if it has.

Why rAF instead of `setInterval`? Three reasons. First, rAF pauses when the tab is backgrounded, which is correct: a hidden tab should not broadcast camera state. Second, rAF aligns with the browser's display refresh, so the sampled camera state corresponds to what the user actually sees. Third, rAF callbacks are batched with other rendering work, so the send happens at a natural point in the frame lifecycle rather than interrupting it.

### The epsilon check

Cameras produce a lot of sub-pixel noise during drags and zoom gestures. Without epsilon filtering, the broadcaster sends 30 identical messages per second when the camera is stationary (a mouse drag that pauses but has not released still runs rAF). The epsilon thresholds filter out imperceptible changes:

- Position: 0.5 world pixels. At zoom 1.0, this is half a screen pixel. Invisible.
- Zoom: 0.001. At zoom 1.0, this changes the rendered size of a 1000px-wide map by 1 pixel. Invisible.

### The suppress-on-receive flag

When the CameraReceiver applies incoming state (Section 6), it sets `camera.x`, `camera.y`, and `camera.zoom` via `deserialize()`, which triggers `camera:changed`. If the CameraBroadcaster is running in the same window (because it is a Controller that is also receiving state from another Controller), it would detect the change and re-broadcast it. The other Controller receives the re-broadcast, re-applies it, and you have a ping-pong loop at 30fps.

The fix is a flag: `_suppressBroadcast`. The CameraReceiver sets it to `true` before applying state and clears it after. The CameraBroadcaster checks it and skips the send. This is the same pattern tldraw uses for its collaboration sync.

### The complete CameraBroadcaster class

Create a new file `vtt/js/camera-sync.js`:

```javascript
// ============================================================
// Camera Sync Engine (Phase 4)
// ============================================================
//
// This module provides cross-window camera synchronization over
// BroadcastChannel. The CameraBroadcaster sends the local camera
// state as a viewport-independent center-point at ~30fps. The
// CameraReceiver applies received state through camera.deserialize(),
// which routes through _applyConstraints() for local boundary
// enforcement.
//
// Architecture:
//   Controller window: runs CameraBroadcaster (sends state)
//   Display window:    runs CameraReceiver (applies state)
//   DM Guide window:   neither (independent camera, not synced)
//
// The broadcaster and receiver share a suppress flag to prevent
// ping-pong: when applying received state, broadcasts are suppressed
// so the receiver does not re-broadcast what it just received.

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

    // Throttle state
    this._lastSendTime = 0;
    this._rafId = null;
    this._running = false;

    // Last sent state (for epsilon comparison)
    this._lastCenterX = NaN;
    this._lastCenterY = NaN;
    this._lastZoom = NaN;

    // Monotonic sequence counter
    this._seq = 0;

    // Suppress flag: set by CameraReceiver to prevent ping-pong.
    // Exposed as a property so CameraReceiver can toggle it directly.
    this.suppressBroadcast = false;

    // Pre-allocated message template to reduce GC pressure at 30fps.
    // V8's young-generation scavenge handles small short-lived objects
    // efficiently, but reusing the template avoids 30 allocations/sec.
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

  /** Start the broadcast loop. */
  start() {
    if (this._running) return;
    this._running = true;
    this._lastSendTime = 0;
    this._rafId = requestAnimationFrame(this._tick);
  }

  /** Stop the broadcast loop. */
  stop() {
    this._running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /** Replace the BroadcastChannel (used after bfcache restore). */
  setChannel(channel) {
    this._channel = channel;
  }

  /**
   * Send a CAMERA_JUMP_TO message for instant teleport.
   * Bypasses the throttle and epsilon check.
   */
  sendJumpTo(centerX, centerY, zoom) {
    const msg = createCameraJumpToMsg(centerX, centerY, zoom, this._senderId);
    this._channel.postMessage(msg);

    // Update last-sent state so the next tick does not re-send
    // the same position as a regular CAMERA_SYNC
    this._lastCenterX = centerX;
    this._lastCenterY = centerY;
    this._lastZoom = zoom;
  }

  /** Force an immediate send (used for WELCOME responses). */
  sendImmediate() {
    this._sendState(performance.now());
  }

  /** @private rAF loop tick */
  _tick(now) {
    if (!this._running) return;

    if (now - this._lastSendTime >= MIN_SEND_INTERVAL) {
      this._sendState(now);
    }

    this._rafId = requestAnimationFrame(this._tick);
  }

  /** @private Read camera, check epsilon, send if changed. */
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

    // Update template in place (avoids allocation)
    this._msgTemplate.centerX = shared.centerX;
    this._msgTemplate.centerY = shared.centerY;
    this._msgTemplate.zoom = shared.zoom;
    this._msgTemplate.seq = ++this._seq;

    // BroadcastChannel uses structured clone, so the template object
    // is copied on send. Mutating it after postMessage is safe.
    this._channel.postMessage(this._msgTemplate);

    this._lastCenterX = shared.centerX;
    this._lastCenterY = shared.centerY;
    this._lastZoom = shared.zoom;
    this._lastSendTime = performance.now();
  }

  /** Clean up. */
  destroy() {
    this.stop();
    this._channel = null;
    this._camera = null;
  }
}
```

### Why structured clone is fine at 30fps

BroadcastChannel uses the structured clone algorithm to serialize messages. For a flat object with six numeric properties (type, centerX, centerY, zoom, seq, senderId), structured clone runs in approximately 1.3 microseconds on modern V8. At 30fps, that is 39 microseconds per second of serialization overhead. This is negligible. The Phase 4 research confirmed this by benchmarking against `JSON.stringify` (slower, 3.2 microseconds) and manual `ArrayBuffer` packing (faster at 0.8 microseconds, but not worth the complexity). Structured clone is the default, correct choice.

---

## 6. CameraReceiver

### What it does

The `CameraReceiver` listens for `CAMERA_SYNC` and `CAMERA_JUMP_TO` messages on the camera channel, validates sequence numbers to reject stale messages, and applies received state through the camera's `deserialize()` method.

### Per-sender sequence numbers

BroadcastChannel delivers messages in order within a single sender. Across tab freeze/resume cycles, delivery order is not formally guaranteed by the spec. To guard against this, the receiver tracks the last-seen sequence number per sender and drops any message whose `seq` is not greater than the previous one.

Why per-sender tracking? In Phase 4's simple authority model, there is typically one Controller sending. But the protocol supports multiple Controllers (all send, latest-sequence-number-wins). Each Controller has its own monotonic sequence counter, so their streams do not interfere with each other. The receiver tracks them independently.

### Why timestamps are not used for ordering

The research phase considered using `performance.timeOrigin + performance.now()` for message ordering. This was rejected for two reasons. First, `performance.timeOrigin` can differ across tabs by the time it takes to open them (typically milliseconds, but occasionally more during heavy load). Second, NTP clock adjustments can shift `Date.now()` mid-session. Monotonic sequence numbers are immune to both problems and are simpler to reason about. Timestamps are included in the research design for latency measurement only, which Phase 4 defers.

### The complete CameraReceiver class

Add this to `vtt/js/camera-sync.js`, after the `CameraBroadcaster` class:

```javascript
// ============================================================
// CameraReceiver
// ============================================================

export class CameraReceiver {
  /**
   * @param {object} camera - The Camera instance from map-camera.js
   * @param {CameraBroadcaster|null} broadcaster
   *   If this window also has a broadcaster (e.g., a Controller that
   *   receives from other Controllers), pass it so the receiver can
   *   set the suppressBroadcast flag during state application.
   */
  constructor(camera, broadcaster = null) {
    this._camera = camera;
    this._broadcaster = broadcaster;

    // Per-sender sequence tracking: Map<senderId, lastSeq>
    this._senderSeqs = new Map();
  }

  /**
   * Handle an incoming camera sync message.
   * Called by the channel's onmessage handler.
   *
   * @param {object} msg - The raw message from BroadcastChannel
   */
  handleMessage(msg) {
    if (msg.type === MSG.CAMERA_SYNC) {
      this._handleSync(msg);
    } else if (msg.type === MSG.CAMERA_JUMP_TO) {
      this._handleJumpTo(msg);
    }
  }

  /** @private Handle continuous state stream message. */
  _handleSync(msg) {
    const { senderId, seq, centerX, centerY, zoom } = msg;

    // Sequence check: reject stale messages
    const prevSeq = this._senderSeqs.get(senderId) ?? -1;
    if (seq <= prevSeq) return;
    this._senderSeqs.set(senderId, seq);

    this._applySharedState(centerX, centerY, zoom);
  }

  /** @private Handle instant teleport message. */
  _handleJumpTo(msg) {
    const { centerX, centerY, zoom } = msg;
    this._applySharedState(centerX, centerY, zoom);
  }

  /**
   * @private Convert shared state to local and apply via deserialize.
   * Suppresses the broadcaster (if present) to prevent ping-pong.
   */
  _applySharedState(centerX, centerY, zoom) {
    const cam = this._camera;
    const vp = { width: cam.viewportW, height: cam.viewportH };
    if (vp.width <= 0 || vp.height <= 0) return;

    const local = sharedToLocal({ centerX, centerY, zoom }, vp);

    // Suppress broadcasts while applying received state
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

  /** Remove a sender's sequence tracking (when they disconnect). */
  removeSender(senderId) {
    this._senderSeqs.delete(senderId);
  }

  /**
   * Apply camera state from a WELCOME message.
   * Public entry point for CameraSyncEngine to use during handshake
   * hydration, without reaching into the private _applySharedState.
   */
  applyWelcomeState(centerX, centerY, zoom) {
    this._applySharedState(centerX, centerY, zoom);
  }

  /** Clean up. */
  destroy() {
    this._senderSeqs.clear();
    this._camera = null;
    this._broadcaster = null;
  }
}
```

### The three rules for preventing clamping ping-pong

The research identified three rules that, together, eliminate all ping-pong scenarios:

1. **Never re-broadcast received state.** The `suppressBroadcast` flag in `_applySharedState()` ensures this.

2. **Share unclamped canonical state.** The CameraBroadcaster reads the camera state before `_applyConstraints()` modifies it. Wait, that is not right. The broadcaster reads the camera's current `{ x, y, zoom }` which has already been through `_applyConstraints()`. But the shared state it sends is the center-point conversion of that clamped state. This is correct because the sender's clamped state is the sender's ground truth. The receiver re-clamps to its own constraints. No information is lost.

3. **Epsilon-based change detection.** When the receiver applies state and `_applyConstraints()` adjusts it slightly (e.g., clamping pan by 0.3 pixels), the broadcaster's next tick sees a change below epsilon and does not send. Without epsilon, this sub-pixel adjustment would trigger a broadcast, the other window would re-apply and re-clamp, and the cycle repeats until floating-point noise balances.

---

## 7. WindowRegistry and the announce-on-connect handshake

### The problem

When a new window opens (the Controller starts after the Display is already showing the map), it needs the current camera state. Without a handshake, the new window has no state and defaults to its initial camera position. The DM opens the Controller and sees a different view than what the players are seeing on the Display.

### The handshake protocol

The protocol uses four message types that travel on the `'vtt-camera'` channel:

1. **ANNOUNCE**: A window has just opened. Contains `{ windowId, role }`. Sent once on boot.

2. **WELCOME**: A response to ANNOUNCE. Contains `{ windowId, role, targetWindowId, camera, epoch }`. The `camera` field is the sender's current camera state in center-point format. The `epoch` is a monotonic counter that indicates how "fresh" the state is. The `targetWindowId` ensures only the requesting window processes the WELCOME.

3. **HEARTBEAT**: Periodic liveness signal. Contains `{ windowId, role }`. Sent every 3 seconds.

4. **GOODBYE**: A window is closing (sent on `pagehide`). Contains `{ windowId }`.

The flow:

```
Window B opens (Controller):
  1. B sends ANNOUNCE { windowId: 'b', role: 'controller' }

Window A (Display) receives ANNOUNCE:
  2. A sends WELCOME {
       windowId: 'a',
       role: 'display',
       targetWindowId: 'b',
       camera: { centerX: 840, centerY: 460, zoom: 1.5 },
       epoch: 42
     }

Window B receives WELCOME:
  3. B applies the camera state (so it starts at the same view as A)
  4. B starts its CameraBroadcaster (now it is the authority)
  5. B begins sending HEARTBEAT every 3 seconds

Window A begins sending HEARTBEAT every 3 seconds.
```

### Handling multiple WELCOMEs

If three windows are open when a new one sends ANNOUNCE, all three respond with WELCOME. The new window might receive three WELCOMEs within milliseconds. The correct behavior is to apply the one with the highest `epoch` value, since it represents the most recent state.

In practice, with the simple authority model (Section 8), only the Controller's state matters. But the protocol does not encode authority in the WELCOME; instead, it uses epoch as a generic freshness indicator. This keeps the handshake protocol authority-agnostic, which Phase 5's authority election system needs.

### The WindowRegistry class

Add this to `vtt/js/camera-sync.js`, after the `CameraReceiver` class:

```javascript
// ============================================================
// WindowRegistry
// ============================================================
//
// Tracks connected peer windows via ANNOUNCE/HEARTBEAT/GOODBYE.
// Reaps dead peers after HEARTBEAT_TIMEOUT.

const HEARTBEAT_INTERVAL = 3000;  // ms between heartbeats
const HEARTBEAT_TIMEOUT  = 10000; // ms before a peer is considered dead

export class WindowRegistry {
  /**
   * @param {string} windowId - This window's unique ID
   * @param {string} role - This window's role ('controller', 'display', 'dm-guide')
   * @param {BroadcastChannel} channel - The 'vtt-camera' channel
   */
  constructor(windowId, role, channel) {
    this._windowId = windowId;
    this._role = role;
    this._channel = channel;

    // Map<windowId, { role, lastSeen: number }>
    this._peers = new Map();

    // Heartbeat interval handle
    this._heartbeatTimer = null;

    // Reap interval handle
    this._reapTimer = null;

    // Epoch counter for WELCOME freshness
    this._epoch = 0;

    // Callback for peer events
    this._onPeerJoin = null;
    this._onPeerLeave = null;
  }

  /**
   * Register callbacks for peer events.
   *
   * @param {{ onJoin: function, onLeave: function }} handlers
   *   onJoin(windowId, role): called when a new peer is discovered
   *   onLeave(windowId, role): called when a peer is reaped or says goodbye
   */
  onPeerChange({ onJoin, onLeave }) {
    this._onPeerJoin = onJoin || null;
    this._onPeerLeave = onLeave || null;
  }

  /** Replace the BroadcastChannel (used after bfcache restore). */
  setChannel(channel) {
    this._channel = channel;
  }

  /** Start sending heartbeats and reaping dead peers. Idempotent. */
  start() {
    // Clear any existing timers (safe to call on first start,
    // prevents duplicate intervals on bfcache reconnect)
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    if (this._reapTimer) clearInterval(this._reapTimer);

    // Send initial ANNOUNCE
    this._channel.postMessage(
      createAnnounceMsg(this._windowId, this._role)
    );

    // Start heartbeat
    this._heartbeatTimer = setInterval(() => {
      this._channel.postMessage(
        createHeartbeatMsg(this._windowId, this._role)
      );
    }, HEARTBEAT_INTERVAL);

    // Start reaper
    this._reapTimer = setInterval(() => this._reapDeadPeers(), HEARTBEAT_INTERVAL);
  }

  /** Stop heartbeats and send GOODBYE. */
  stop() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._reapTimer) {
      clearInterval(this._reapTimer);
      this._reapTimer = null;
    }

    // Send GOODBYE (best-effort; may not arrive if tab is killed)
    try {
      this._channel.postMessage(createGoodbyeMsg(this._windowId));
    } catch (e) {
      // Channel may already be closed (Page Lifecycle)
    }
  }

  /**
   * Handle an incoming lifecycle message.
   * Called by the channel's onmessage handler.
   *
   * @param {object} msg - The raw message
   * @param {function} onAnnounce
   *   Callback invoked when an ANNOUNCE is received.
   *   Should return the camera state to include in the WELCOME response,
   *   or null to skip the WELCOME.
   *   Signature: (windowId, role) => { centerX, centerY, zoom } | null
   */
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

  /** @private */
  _handleAnnounce(msg, onAnnounce) {
    if (msg.windowId === this._windowId) return; // ignore self

    this._touchPeer(msg.windowId, msg.role);

    // Respond with WELCOME if the callback provides camera state
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

  /** @private */
  _handleWelcome(msg) {
    if (msg.targetWindowId !== this._windowId) return; // not for us

    this._touchPeer(msg.windowId, msg.role);

    // Emit event so the sync engine can apply the camera state
    EventBus.emit('camera-sync:welcome', {
      fromWindowId: msg.windowId,
      fromRole: msg.role,
      camera: msg.camera,
      epoch: msg.epoch,
    });
  }

  /** @private */
  _handleGoodbye(msg) {
    const peer = this._peers.get(msg.windowId);
    if (peer) {
      this._peers.delete(msg.windowId);
      if (this._onPeerLeave) {
        this._onPeerLeave(msg.windowId, peer.role);
      }
    }
  }

  /** @private Update or register a peer. */
  _touchPeer(windowId, role) {
    if (windowId === this._windowId) return; // ignore self

    const isNew = !this._peers.has(windowId);
    this._peers.set(windowId, { role, lastSeen: performance.now() });

    if (isNew && this._onPeerJoin) {
      this._onPeerJoin(windowId, role);
    }
  }

  /** @private Remove peers that have not sent a heartbeat recently. */
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

  /** Get the number of connected peers with a given role. */
  countByRole(role) {
    let count = 0;
    for (const peer of this._peers.values()) {
      if (peer.role === role) count++;
    }
    return count;
  }

  /** Check if any peer with a given role is connected. */
  hasRole(role) {
    return this.countByRole(role) > 0;
  }

  /** Clean up. */
  destroy() {
    this.stop();
    this._peers.clear();
    this._channel = null;
  }
}
```

### Generating window IDs

Each window needs a unique ID. A simple approach that avoids crypto overhead:

```javascript
// At module scope in camera-sync.js:
function generateWindowId() {
  // 8 random hex chars. Collision probability across 3-4 windows is negligible.
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}
```

The window ID is generated once at module load and passed to the WindowRegistry and CameraBroadcaster constructors.

---

## 8. Simple authority model

### The rules

Phase 4 uses the simplest possible authority model:

- **Controller** is the authority. It runs a CameraBroadcaster. When the DM manipulates the camera (zoom buttons, pan arrows, mouse drag on the Controller's map preview), the local camera state changes and the broadcaster sends it.

- **Display** is the follower. It runs a CameraReceiver. It applies received state via `camera.deserialize()` and does **not** run a CameraBroadcaster. The Display's camera is slave to the Controller.

- **DM Guide** has an independent camera. It neither sends nor receives camera sync. The DM Guide shows the same map but the DM navigates independently (scrolling through notes, checking room descriptions). The DM Guide's camera is fully local.

### Multiple Controllers

If two browser tabs have the Controller open, both run CameraBroadcasters with independent sequence counters. The Display receives from both. Because the CameraReceiver tracks sequences per sender, both streams are accepted. The Display ends up applying whichever Controller's message arrives last within each frame. This is "last-writer-wins" and matches the behavior of Google Docs (last keystroke wins) and tldraw (last pointer position wins). It is correct for the use case: the DM has two Controller tabs open by accident, and the one they are actively using naturally sends the most recent state.

Phase 5 adds deterministic authority election (lowest window ID among controllers claims authority) for cleaner multi-controller handling. Phase 4 does not need it because the typical case is one Controller.

### When the Controller connects after the Display

This is the announce-on-connect flow from Section 7. The Display sends a WELCOME with its current camera state. The Controller applies it and starts broadcasting. Result: the Controller sees what the Display was showing, then takes over as authority.

### When the Display connects after the Controller

The Controller sends a WELCOME with its current camera state. The Display applies it. Then the Controller's continuous broadcast takes over. Result: the Display immediately shows what the Controller is showing.

### No authority handoff needed

In Phase 4, there is no scenario where authority transfers. The Controller is always the authority. If the Controller closes, the Display keeps showing the last received state. If a new Controller opens, it picks up from the Display's state via WELCOME and starts broadcasting. No claim/release protocol is needed.

---

## 9. Page Lifecycle integration

### The problem

Modern browsers aggressively manage tab resources. A backgrounded tab may be frozen (Chromium's Tab Freeze), its BroadcastChannel closed (bfcache on navigation), or its tab discarded (memory pressure). Without handling these events, the camera sync breaks silently: the broadcaster stops sending, the receiver stops receiving, and the WindowRegistry's heartbeat reaper removes the "dead" peer.

### BroadcastChannel and bfcache

The critical constraint: **an open BroadcastChannel prevents bfcache eligibility**. If the user navigates away from the VTT tab and comes back with the browser back button, bfcache can restore the page instantly instead of reloading. But only if there are no open BroadcastChannels at the time of `pagehide`.

The solution: close the camera channel on `pagehide`, and recreate it on `pageshow`. The control channel (`'vtt-control'`) follows the same pattern, but that is outside Phase 4's scope. The camera channel management is encapsulated in a `CameraChannelManager` class.

### State persistence on freeze

When a tab is frozen (or hidden, which is the cross-browser proxy for "about to be frozen"), the camera state must be persisted to sessionStorage. When the tab resumes (or becomes visible again), the state is restored and the window re-announces itself to reconnect with peers.

### The CameraChannelManager

Add this to `vtt/js/camera-sync.js`, after the `WindowRegistry` class:

```javascript
// ============================================================
// CameraChannelManager
// ============================================================
//
// Manages the 'vtt-camera' BroadcastChannel lifecycle in
// coordination with the Page Lifecycle API. Closes the channel
// on pagehide to preserve bfcache eligibility, recreates it on
// pageshow.

const CAMERA_CHANNEL_NAME = 'vtt-camera';
const SESSION_KEY = 'vtt-camera-state';
const SESSION_MAX_AGE = 5 * 60 * 1000; // 5 minutes

export class CameraChannelManager {
  /**
   * @param {object} config
   * @param {object} config.camera - Camera instance
   * @param {string} config.role - Window role
   * @param {function} config.onMessage - Message handler callback
   */
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

  /** Get the current BroadcastChannel (may be null if page is hidden). */
  get channel() { return this._channel; }

  /** Get this window's unique ID. */
  get windowId() { return this._windowId; }

  /** Open the channel and attach lifecycle listeners. */
  start() {
    this._openChannel();
    this._attachLifecycleListeners();
    this._restoreFromSessionStorage();
  }

  /** Close the channel and detach listeners. */
  stop() {
    this._closeChannel();
    this._detachLifecycleListeners();
  }

  /** @private */
  _openChannel() {
    if (this._channel) return;
    this._channel = new BroadcastChannel(CAMERA_CHANNEL_NAME);
    this._channel.onmessage = (event) => {
      if (this._onMessage) {
        this._onMessage(event.data);
      }
    };
  }

  /** @private */
  _closeChannel() {
    if (!this._channel) return;
    this._channel.close();
    this._channel = null;
  }

  /** @private */
  _attachLifecycleListeners() {
    window.addEventListener('pagehide', this._onPageHide);
    window.addEventListener('pageshow', this._onPageShow);
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  /** @private */
  _detachLifecycleListeners() {
    window.removeEventListener('pagehide', this._onPageHide);
    window.removeEventListener('pageshow', this._onPageShow);
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
  }

  /** @private Persist state and close channel for bfcache. */
  _onPageHide() {
    this._persistToSessionStorage();
    this._closeChannel();
  }

  /**
   * @private Restore from bfcache or discard: recreate channel.
   * pageshow fires both on initial load and on bfcache restore.
   * We only need to recreate the channel if it was closed.
   */
  _onPageShow(event) {
    if (!this._channel) {
      this._openChannel();

      // If restoring from bfcache, restore state and re-announce
      if (event.persisted) {
        this._restoreFromSessionStorage();
        EventBus.emit('camera-sync:reconnect');
      }
    }
  }

  /** @private Persist on visibility hidden (cross-browser freeze proxy). */
  _onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      this._persistToSessionStorage();
    }
  }

  /** @private Save camera state to sessionStorage. */
  _persistToSessionStorage() {
    try {
      const cam = this._camera;
      const vp = { width: cam.viewportW, height: cam.viewportH };
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
      // sessionStorage may be unavailable (private browsing, quota)
    }
  }

  /** @private Restore camera state from sessionStorage if fresh. */
  _restoreFromSessionStorage() {
    // Covers both normal pageshow from bfcache and document.wasDiscarded
    // (Chromium tab kill/restore). In both cases the correct action is
    // the same: read sessionStorage and apply if fresh.
    this._tryRestore();
  }

  /** @private */
  _tryRestore() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;

      const data = JSON.parse(raw);

      // Reject stale data (older than 5 minutes)
      if (Date.now() - data.timestamp > SESSION_MAX_AGE) {
        sessionStorage.removeItem(SESSION_KEY);
        return;
      }

      // Apply the saved camera state
      const cam = this._camera;
      const vp = { width: cam.viewportW, height: cam.viewportH };
      if (vp.width <= 0 || vp.height <= 0) return;

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

  /** Clean up. */
  destroy() {
    this.stop();
    this._camera = null;
    this._onMessage = null;
  }
}
```

### Testing Page Lifecycle

Chromium provides `chrome://discards` where you can manually freeze and discard tabs. The testing protocol in Section 14 includes specific steps for verifying freeze/resume and discard/restore behavior.

---

## 10. CAMERA_JUMP_TO: instant camera teleport

### The use case

The Controller has preset buttons (or will have them, but even today has "Reset Camera" and potential bookmark-style buttons). When the DM clicks a preset, the camera should snap instantly to the preset's position, not glide there at 30fps over the next few frames. `CAMERA_JUMP_TO` is a single message that says "go here now," bypassing the continuous stream's throttle and epsilon check.

### How it works

The Controller calls `broadcaster.sendJumpTo(centerX, centerY, zoom)`. This posts a `CAMERA_JUMP_TO` message immediately. The receiver's `_handleJumpTo()` calls `_applySharedState()`, which converts to local coordinates and calls `camera.deserialize()`.

The difference from `CAMERA_SYNC` is that `CAMERA_JUMP_TO` has no sequence number. It is a one-shot command, not part of the continuous stream. The receiver does not sequence-check it. This means a delayed `CAMERA_JUMP_TO` arriving after newer `CAMERA_SYNC` messages would snap the camera backward. In practice, BroadcastChannel delivers messages in order within a single browsing context group, so this does not happen. But it is worth noting for Phase 5, which may add a `lastJumpTime` guard if WebSocket transport introduces true out-of-order delivery.

### Replacing CAMERA_RESET with CAMERA_JUMP_TO

The existing `CAMERA_RESET` message tells the Display to call `camera.fitCover()`. In Phase 4, the Controller handles this locally: it calls `camera.fitCover()` on its own camera, and the broadcaster sends the resulting state. The Display applies it via the normal sync stream.

For instant response, the Controller can additionally send a `CAMERA_JUMP_TO` with the fitCover position. This ensures the Display snaps immediately rather than waiting up to 33ms for the next sync tick. The `sendJumpTo()` method updates the broadcaster's `_last*` state, so the next sync tick correctly skips the now-redundant position.

---

## 11. Replacing discrete commands with continuous state

### The old model

Phase 1 through Phase 3 used discrete camera commands sent from the Controller to the Display:

```javascript
// Controller sends:
channel.postMessage(createCameraZoomMsg(1));         // "zoom in one step"
channel.postMessage(createCameraPanMsg(0, -50));     // "pan up by 50"
channel.postMessage(createCameraResetMsg());          // "reset to cover"

// Display handles in handleSyncMessage():
case MSG.CAMERA_ZOOM:
  EventBus.emit('camera:zoom', msg.direction);
  break;
case MSG.CAMERA_PAN:
  EventBus.emit('camera:pan', { dx: msg.dx, dy: msg.dy });
  break;
case MSG.CAMERA_RESET:
  EventBus.emit('camera:reset');
  break;
```

The Display's Camera class listened for these events and executed the corresponding operations (zoom one step, pan by delta, reset to cover).

### The new model

The Controller has its own Camera instance. When the DM clicks "Zoom In," the Controller calls `camera.zoomToCenter(ZOOM_STEP_KEY)` on its local camera. The CameraBroadcaster picks up the change on the next rAF tick and sends it. The Display's CameraReceiver applies it.

This means the Controller needs a Camera instance even though it does not render a full map canvas. The Controller already has a simplified map preview; Phase 4 gives it a real Camera that it manipulates directly. The CameraBroadcaster reads this camera.

### Changes to the Controller

The Controller's UI buttons (`controller/js/controls.js` or equivalent) currently construct and send protocol messages. In Phase 4, they manipulate the local camera instead:

**Zoom buttons (in Controller's button handlers):**

```javascript
// OLD:
zoomInBtn.addEventListener('click', () => {
  channel.postMessage(createCameraZoomMsg(1));
});
zoomOutBtn.addEventListener('click', () => {
  channel.postMessage(createCameraZoomMsg(-1));
});

// NEW:
zoomInBtn.addEventListener('click', () => {
  camera.zoomToCenter(ZOOM_STEP_KEY);
  // CameraBroadcaster sends automatically on next tick
});
zoomOutBtn.addEventListener('click', () => {
  camera.zoomToCenter(-ZOOM_STEP_KEY);
});
```

**Pan buttons:**

```javascript
// OLD:
panUpBtn.addEventListener('click', () => {
  channel.postMessage(createCameraPanMsg(0, -PAN_STEP));
});

// NEW:
panUpBtn.addEventListener('click', () => {
  camera.panBy(0, -PAN_STEP);
});
```

**Reset button:**

```javascript
// OLD:
resetBtn.addEventListener('click', () => {
  channel.postMessage(createCameraResetMsg());
});

// NEW:
resetBtn.addEventListener('click', () => {
  camera.fitCover();
  // For instant Display response, also send a jump:
  const vp = { width: camera.viewportW, height: camera.viewportH };
  const shared = localToShared(camera, vp);
  broadcaster.sendJumpTo(shared.centerX, shared.centerY, shared.zoom);
});
```

### Changes to the Display

The Display's `handleSyncMessage()` cases for `CAMERA_ZOOM`, `CAMERA_PAN`, and `CAMERA_RESET` become dead code. They are left in place for backward compatibility (in case an older Controller is still connected), but the Display no longer depends on them. The `CameraReceiver` handles all camera updates.

The Display's Camera class event listeners for `camera:zoom`, `camera:pan`, and `camera:reset` from EventBus also become dead code. They can be removed or left in place.

### The migration path

The safest approach is to keep the old handlers functioning and add the new system alongside. If the old Controller sends a `CAMERA_ZOOM` message, it still works. If the new Controller sends `CAMERA_SYNC`, the `CameraReceiver` handles it. There is no conflict because the old messages go through the `'vtt-control'` channel and the new messages go through `'vtt-camera'`. Eventually, a cleanup pass in Phase 5 removes the dead code paths.

---

## 12. Wiring it all together: boot sequence and initialization

### The CameraSyncEngine orchestrator

Rather than wiring the broadcaster, receiver, registry, and channel manager independently in each application's main.js, create a single `CameraSyncEngine` class that composes them. Add this to `vtt/js/camera-sync.js`:

```javascript
// ============================================================
// CameraSyncEngine
// ============================================================
//
// Top-level orchestrator that wires CameraBroadcaster, CameraReceiver,
// WindowRegistry, and CameraChannelManager together based on the
// window's role.

export class CameraSyncEngine {
  /**
   * @param {object} config
   * @param {object} config.camera - Camera instance
   * @param {string} config.role - 'controller' | 'display' | 'dm-guide'
   */
  constructor({ camera, role }) {
    this._camera = camera;
    this._role = role;
    this._started = false;

    // Components (created on start)
    this._channelManager = null;
    this._registry = null;
    this._broadcaster = null;
    this._receiver = null;

    // Pending WELCOME state (for collecting multiple WELCOMEs)
    this._bestWelcome = null;
    this._welcomeTimer = null;
  }

  /** Initialize and start the sync engine. */
  start() {
    if (this._started) return;
    this._started = true;

    // Create channel manager (handles BroadcastChannel lifecycle)
    this._channelManager = new CameraChannelManager({
      camera: this._camera,
      role: this._role,
      onMessage: (msg) => this._handleMessage(msg),
    });
    this._channelManager.start();

    const channel = this._channelManager.channel;
    const windowId = this._channelManager.windowId;

    // Create role-specific components
    if (this._role === 'controller') {
      this._broadcaster = new CameraBroadcaster(
        this._camera, channel, windowId
      );
      // Controllers also receive (for multi-controller scenarios and
      // WELCOME hydration), but with the broadcaster reference to
      // suppress ping-pong.
      this._receiver = new CameraReceiver(this._camera, this._broadcaster);
      this._broadcaster.start();
    } else if (this._role === 'display') {
      this._receiver = new CameraReceiver(this._camera, null);
    }
    // dm-guide: no broadcaster, no receiver

    // Create WindowRegistry
    this._registry = new WindowRegistry(windowId, this._role, channel);

    this._registry.onPeerChange({
      onJoin: (peerId, peerRole) => {
        EventBus.emit('camera-sync:peer-join', { peerId, peerRole });
      },
      onLeave: (peerId, peerRole) => {
        EventBus.emit('camera-sync:peer-leave', { peerId, peerRole });
        // Clean up receiver's sequence tracking for departed peer
        if (this._receiver) {
          this._receiver.removeSender(peerId);
        }
      },
    });

    // Listen for WELCOME events to hydrate initial state
    EventBus.on('camera-sync:welcome', (data) => {
      this._handleWelcomeState(data);
    });

    // Listen for reconnect events (bfcache restore)
    EventBus.on('camera-sync:reconnect', () => {
      this._reconnect();
    });

    // Start registry (sends ANNOUNCE, begins heartbeats)
    this._registry.start();
  }

  /** @private Route incoming messages to the appropriate handler. */
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

  /**
   * @private Called when a peer sends ANNOUNCE. Return camera state
   * for the WELCOME response, or null to skip.
   */
  _onAnnounce(announcerId, announcerRole) {
    // The Display responds to any ANNOUNCE with its current camera.
    // The Controller responds to Display ANNOUNCEs with its current camera.
    // This ensures both directions of "who opens first" are handled.
    const cam = this._camera;
    const vp = { width: cam.viewportW, height: cam.viewportH };
    if (vp.width <= 0 || vp.height <= 0) return null;

    return localToShared(cam, vp);
  }

  /**
   * @private Handle WELCOME state. Collect for 150ms, apply best epoch.
   */
  _handleWelcomeState(data) {
    // Track the WELCOME with the highest epoch
    if (!this._bestWelcome || data.epoch > this._bestWelcome.epoch) {
      this._bestWelcome = data;
    }

    // Debounce: wait 150ms for more WELCOMEs to arrive
    if (this._welcomeTimer) clearTimeout(this._welcomeTimer);
    this._welcomeTimer = setTimeout(() => {
      this._applyWelcome();
    }, 150);
  }

  /** @private Apply the best WELCOME camera state. */
  _applyWelcome() {
    if (!this._bestWelcome) return;

    const { camera } = this._bestWelcome;
    if (camera && this._receiver) {
      this._receiver.applyWelcomeState(camera.centerX, camera.centerY, camera.zoom);
    }

    this._bestWelcome = null;
    this._welcomeTimer = null;
  }

  /** @private Reconnect after bfcache restore. */
  _reconnect() {
    const channel = this._channelManager.channel;
    if (!channel) return;

    // Update references (channel was recreated by CameraChannelManager)
    if (this._broadcaster) {
      this._broadcaster.setChannel(channel);
    }
    this._registry.setChannel(channel);

    // Re-announce
    this._registry.start();

    // Restart broadcaster if applicable
    if (this._broadcaster) {
      this._broadcaster.start();
    }
  }

  /** Stop the sync engine. */
  stop() {
    if (this._broadcaster) this._broadcaster.stop();
    if (this._registry) this._registry.stop();
    if (this._channelManager) this._channelManager.stop();
    if (this._welcomeTimer) clearTimeout(this._welcomeTimer);
    this._started = false;
  }

  /** Clean up all resources. */
  destroy() {
    this.stop();
    if (this._broadcaster) this._broadcaster.destroy();
    if (this._receiver) this._receiver.destroy();
    if (this._registry) this._registry.destroy();
    if (this._channelManager) this._channelManager.destroy();
  }

  /** Public access to broadcaster for sendJumpTo(). */
  get broadcaster() { return this._broadcaster; }
}
```

### Initialization in each application

**VTT Display** (`vtt/js/main.js`):

```javascript
import { CameraSyncEngine } from './camera-sync.js';

// After camera is initialized and map is loaded:
const syncEngine = new CameraSyncEngine({
  camera: mapRenderer.camera,
  role: 'display',
});
syncEngine.start();

// Expose for testing
window.__vtt = window.__vtt || {};
window.__vtt.syncEngine = syncEngine;
```

**Controller** (`controller/js/main.js`):

```javascript
import { CameraSyncEngine } from '../../vtt/js/camera-sync.js';
import { localToShared } from '../../shared/protocol.js';

// The Controller needs a Camera instance for local manipulation.
// If it already has one (from a map preview), use that.
// Otherwise, create a headless camera:
import { Camera } from '../../vtt/js/map-camera.js';

const camera = new Camera();
// Set viewport to a nominal size (the Controller's preview area)
camera.setViewportSize(previewWidth, previewHeight);
// Load the same map dimensions as the Display
camera.setMapSize(mapW, mapH);

const syncEngine = new CameraSyncEngine({
  camera: camera,
  role: 'controller',
});
syncEngine.start();

// Expose for button handlers
window.__controller = window.__controller || {};
window.__controller.camera = camera;
window.__controller.syncEngine = syncEngine;
```

**DM Guide** (`dm-guide/js/main.js`):

```javascript
// DM Guide does NOT initialize a CameraSyncEngine.
// Its camera is fully independent.
// If you want the DM Guide to be aware of peer windows
// (e.g., to show a "Controller connected" indicator), you
// can create a WindowRegistry-only setup. This is optional
// and not part of Phase 4's core scope.
```

---

## 13. CSS changes

Phase 4 requires no CSS changes.

The camera sync system is entirely JavaScript. The CameraBroadcaster, CameraReceiver, WindowRegistry, and CameraChannelManager operate on camera state objects, not DOM elements. The Display's rendering pipeline remains unchanged: `camera:changed` events trigger the existing rAF-coalesced redraw in MapRenderer. No new UI elements are added in Phase 4 (the debug overlay is deferred to Phase 5).

---

## 14. Testing protocols

### Unit tests: center-point conversion

These tests verify the `localToShared` and `sharedToLocal` functions are correct inverses. Create `tests/camera-sync.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { localToShared, sharedToLocal } from '../shared/protocol.js';

function assertClose(a, b, msg, tol = 0.001) {
  if (Math.abs(a - b) > tol) throw new Error(`${msg}: expected ${b}, got ${a}`);
}

describe('localToShared / sharedToLocal', () => {
  it('roundtrips correctly at standard viewport', () => {
    const cam = { x: 200, y: 100, zoom: 1.5 };
    const vp = { width: 1920, height: 1080 };

    const shared = localToShared(cam, vp);
    const back = sharedToLocal(shared, vp);

    assertClose(back.x, cam.x, 'roundtrip x');
    assertClose(back.y, cam.y, 'roundtrip y');
    assertClose(back.zoom, cam.zoom, 'roundtrip zoom');
  });

  it('different viewports share the same center', () => {
    const cam1 = { x: 200, y: 100, zoom: 1.5 };
    const vp1 = { width: 1920, height: 1080 };

    const shared = localToShared(cam1, vp1);

    // Larger viewport: different local position, same center
    const vp2 = { width: 3840, height: 2160 };
    const cam2 = sharedToLocal(shared, vp2);

    // Verify cam2's center matches shared
    const shared2 = localToShared(cam2, vp2);
    assertClose(shared2.centerX, shared.centerX, 'center X matches');
    assertClose(shared2.centerY, shared.centerY, 'center Y matches');
    assertClose(shared2.zoom, shared.zoom, 'zoom matches');
  });

  it('handles zoom = 1 identity case', () => {
    const cam = { x: 0, y: 0, zoom: 1.0 };
    const vp = { width: 1920, height: 1080 };

    const shared = localToShared(cam, vp);
    assertClose(shared.centerX, 960, 'center X at zoom 1');
    assertClose(shared.centerY, 540, 'center Y at zoom 1');
  });

  it('handles negative camera positions', () => {
    const cam = { x: -500, y: -300, zoom: 2.0 };
    const vp = { width: 1920, height: 1080 };

    const shared = localToShared(cam, vp);
    const back = sharedToLocal(shared, vp);

    assertClose(back.x, cam.x, 'roundtrip negative x');
    assertClose(back.y, cam.y, 'roundtrip negative y');
  });
});
```

### Unit tests: CameraBroadcaster epsilon detection

```javascript
import { describe, it, expect, vi } from 'vitest';

describe('CameraBroadcaster epsilon detection', () => {
  it('does not send when state is unchanged', () => {
    // Mock camera with static state
    const camera = {
      x: 100, y: 50, zoom: 1.5,
      viewportW: 1920, viewportH: 1080,
    };

    const sentMessages = [];
    const mockChannel = {
      postMessage: (msg) => sentMessages.push(structuredClone(msg)),
    };

    // Manually invoke _sendState twice
    // First send should go through, second should be suppressed
    const { CameraBroadcaster } = require('../vtt/js/camera-sync.js');
    const broadcaster = new CameraBroadcaster(camera, mockChannel, 'test-id');

    broadcaster._sendState(0);
    const firstCount = sentMessages.length;
    expect(firstCount).toBe(1);

    broadcaster._sendState(100);
    expect(sentMessages.length).toBe(firstCount); // no new message
  });

  it('sends when position changes beyond epsilon', () => {
    const camera = {
      x: 100, y: 50, zoom: 1.5,
      viewportW: 1920, viewportH: 1080,
    };

    const sentMessages = [];
    const mockChannel = {
      postMessage: (msg) => sentMessages.push(structuredClone(msg)),
    };

    const { CameraBroadcaster } = require('../vtt/js/camera-sync.js');
    const broadcaster = new CameraBroadcaster(camera, mockChannel, 'test-id');

    broadcaster._sendState(0);
    expect(sentMessages.length).toBe(1);

    // Move camera significantly
    camera.x = 200;
    broadcaster._sendState(100);
    expect(sentMessages.length).toBe(2);
  });

  it('suppresses send when suppressBroadcast is true', () => {
    const camera = {
      x: 100, y: 50, zoom: 1.5,
      viewportW: 1920, viewportH: 1080,
    };

    const sentMessages = [];
    const mockChannel = {
      postMessage: (msg) => sentMessages.push(msg),
    };

    const { CameraBroadcaster } = require('../vtt/js/camera-sync.js');
    const broadcaster = new CameraBroadcaster(camera, mockChannel, 'test-id');

    broadcaster.suppressBroadcast = true;
    broadcaster._sendState(0);
    expect(sentMessages.length).toBe(0);
  });
});
```

### Unit tests: CameraReceiver sequence rejection

```javascript
describe('CameraReceiver sequence numbers', () => {
  it('accepts increasing sequence numbers', () => {
    const deserializeCalls = [];
    const camera = {
      viewportW: 1920, viewportH: 1080,
      deserialize: (data) => deserializeCalls.push(data),
    };

    const { CameraReceiver } = require('../vtt/js/camera-sync.js');
    const receiver = new CameraReceiver(camera);

    receiver.handleMessage({
      type: 'camera:sync',
      senderId: 'a', seq: 1,
      centerX: 100, centerY: 200, zoom: 1.0,
    });
    receiver.handleMessage({
      type: 'camera:sync',
      senderId: 'a', seq: 2,
      centerX: 110, centerY: 200, zoom: 1.0,
    });

    expect(deserializeCalls.length).toBe(2);
  });

  it('rejects stale sequence numbers', () => {
    const deserializeCalls = [];
    const camera = {
      viewportW: 1920, viewportH: 1080,
      deserialize: (data) => deserializeCalls.push(data),
    };

    const { CameraReceiver } = require('../vtt/js/camera-sync.js');
    const receiver = new CameraReceiver(camera);

    receiver.handleMessage({
      type: 'camera:sync',
      senderId: 'a', seq: 5,
      centerX: 100, centerY: 200, zoom: 1.0,
    });
    receiver.handleMessage({
      type: 'camera:sync',
      senderId: 'a', seq: 3, // stale!
      centerX: 110, centerY: 200, zoom: 1.0,
    });

    expect(deserializeCalls.length).toBe(1);
  });

  it('tracks senders independently', () => {
    const deserializeCalls = [];
    const camera = {
      viewportW: 1920, viewportH: 1080,
      deserialize: (data) => deserializeCalls.push(data),
    };

    const { CameraReceiver } = require('../vtt/js/camera-sync.js');
    const receiver = new CameraReceiver(camera);

    receiver.handleMessage({
      type: 'camera:sync',
      senderId: 'a', seq: 1,
      centerX: 100, centerY: 200, zoom: 1.0,
    });
    receiver.handleMessage({
      type: 'camera:sync',
      senderId: 'b', seq: 1, // different sender, seq 1 is fine
      centerX: 110, centerY: 200, zoom: 1.0,
    });

    expect(deserializeCalls.length).toBe(2);
  });
});
```

### Playwright integration tests

```javascript
// tests/camera-sync.spec.js
import { test, expect } from '@playwright/test';

test.describe('Camera sync across windows', () => {

  test('Controller camera change propagates to Display', async ({ browser }) => {
    // Open Display
    const displayPage = await browser.newPage();
    await displayPage.goto('http://localhost:8765/vtt/index.html');
    await displayPage.waitForSelector('#loading[hidden]', { timeout: 10000 });

    // Switch to map mode
    await displayPage.evaluate(() => {
      window.__vtt?.store?.state && (window.__vtt.store.state.mode = 'map');
    });
    await displayPage.waitForTimeout(500);

    // Open Controller
    const controllerPage = await browser.newPage();
    await controllerPage.goto('http://localhost:8765/controller/index.html');
    await controllerPage.waitForTimeout(1000);

    // Get Display camera before
    const displayBefore = await displayPage.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam ? { x: cam.x, y: cam.y, zoom: cam.zoom } : null;
    });

    // Manipulate Controller camera
    await controllerPage.evaluate(() => {
      const cam = window.__controller?.camera;
      if (cam) cam.zoomToCenter(0.4);
    });

    // Wait for sync (33ms throttle + margin)
    await displayPage.waitForTimeout(200);

    // Get Display camera after
    const displayAfter = await displayPage.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam ? { x: cam.x, y: cam.y, zoom: cam.zoom } : null;
    });

    // Zoom should have changed
    expect(displayAfter).not.toBeNull();
    expect(displayBefore).not.toBeNull();
    if (displayAfter && displayBefore) {
      expect(displayAfter.zoom).not.toBeCloseTo(displayBefore.zoom, 2);
    }
  });

  test('CAMERA_JUMP_TO produces instant camera update', async ({ browser }) => {
    const displayPage = await browser.newPage();
    await displayPage.goto('http://localhost:8765/vtt/index.html');
    await displayPage.waitForSelector('#loading[hidden]', { timeout: 10000 });
    await displayPage.evaluate(() => {
      window.__vtt?.store?.state && (window.__vtt.store.state.mode = 'map');
    });
    await displayPage.waitForTimeout(500);

    const controllerPage = await browser.newPage();
    await controllerPage.goto('http://localhost:8765/controller/index.html');
    await controllerPage.waitForTimeout(1000);

    // Send a jump-to command
    await controllerPage.evaluate(() => {
      const engine = window.__controller?.syncEngine;
      if (engine?.broadcaster) {
        engine.broadcaster.sendJumpTo(500, 300, 2.0);
      }
    });

    await displayPage.waitForTimeout(100);

    // Display should now show centerX=500, centerY=300, zoom=2.0
    // (approximately, after constraint clamping)
    const cam = await displayPage.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      if (!cam) return null;
      const cx = cam.x + (cam.viewportW / 2) / cam.zoom;
      const cy = cam.y + (cam.viewportH / 2) / cam.zoom;
      return { centerX: cx, centerY: cy, zoom: cam.zoom };
    });

    expect(cam).not.toBeNull();
    if (cam) {
      // Allow tolerance for constraint clamping
      expect(Math.abs(cam.centerX - 500)).toBeLessThan(50);
      expect(Math.abs(cam.centerY - 300)).toBeLessThan(50);
    }
  });

  test('Display retains camera state when Controller disconnects', async ({ browser }) => {
    const displayPage = await browser.newPage();
    await displayPage.goto('http://localhost:8765/vtt/index.html');
    await displayPage.waitForSelector('#loading[hidden]', { timeout: 10000 });
    await displayPage.evaluate(() => {
      window.__vtt?.store?.state && (window.__vtt.store.state.mode = 'map');
    });
    await displayPage.waitForTimeout(500);

    const controllerPage = await browser.newPage();
    await controllerPage.goto('http://localhost:8765/controller/index.html');
    await controllerPage.waitForTimeout(1000);

    // Manipulate camera
    await controllerPage.evaluate(() => {
      const cam = window.__controller?.camera;
      if (cam) cam.zoomToCenter(0.5);
    });
    await displayPage.waitForTimeout(200);

    // Record Display state
    const stateBefore = await displayPage.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam ? { x: cam.x, y: cam.y, zoom: cam.zoom } : null;
    });

    // Close Controller
    await controllerPage.close();
    await displayPage.waitForTimeout(200);

    // Display should retain its camera state
    const stateAfter = await displayPage.evaluate(() => {
      const cam = window.__vtt?.mapRenderer?.camera;
      return cam ? { x: cam.x, y: cam.y, zoom: cam.zoom } : null;
    });

    expect(stateAfter).toEqual(stateBefore);
  });
});
```

### Manual testing checklist

Run through this by hand after the code changes are in place:

1. **Basic sync: Controller zoom propagates to Display.** Open the Display and switch to map mode. Open the Controller. Click the zoom in button on the Controller. The Display should zoom in within 50ms (visually instant). Click zoom out. The Display should zoom out.

2. **Pan sync.** Click and hold a pan arrow on the Controller. The Display should pan smoothly in the corresponding direction. Release the button. Panning should stop.

3. **Camera reset sync.** Click the Reset Camera button on the Controller. The Display should snap to cover zoom, centered.

4. **CAMERA_JUMP_TO.** If the Controller has preset or bookmark buttons, click one. The Display should snap instantly to that camera position (no visible lag or animation).

5. **Reverse connection order.** Close both windows. Open the Controller first. Then open the Display. The Display should pick up the Controller's current camera position via WELCOME within 200ms.

6. **Normal connection order.** Close both windows. Open the Display first (shows default camera). Then open the Controller. The Controller should pick up the Display's camera via WELCOME, then take over as authority.

7. **Controller disconnect and reconnect.** With both windows open and synced, close the Controller. The Display should continue showing the last camera position. Open a new Controller. The new Controller should pick up from the Display's state and resume syncing.

8. **Tab freeze and resume (Chromium only).** Open both windows. Navigate to `chrome://discards`. Click "Freeze" on the Display tab. Wait 5 seconds. Click "Unfreeze." The Display should resume receiving camera sync from the Controller.

9. **Tab discard and restore (Chromium only).** From `chrome://discards`, click "Urgently Discard" on the Display tab. Click on the Display tab to restore it. The Display should restore its camera state from sessionStorage and reconnect to the Controller.

10. **Boundary clamping on different viewport sizes.** Open the Display at a smaller viewport size than the Controller. Zoom to the Controller's minimum zoom. The Display should show a valid view (not zoomed out past its own cover zoom). If the Display's cover zoom is higher than the Controller's, the Display clamps up.

11. **Multiple Controllers (edge case).** Open two Controller tabs and one Display. Both Controllers should sync to the Display. Manipulating either Controller should update the Display. The Display should show the most recent update from whichever Controller is active.

12. **DM Guide independence.** Open the DM Guide alongside the Controller and Display. Zoom and pan in the DM Guide. The Display should not be affected. Zoom and pan via the Controller. The DM Guide should not be affected.

13. **Page hidden/shown persistence.** Open both windows. Minimize the Display (or switch tabs). Wait 5 seconds. Bring the Display back. It should still be synced with the Controller.

14. **No visible jitter.** With both windows open, rapidly click zoom in/out on the Controller. The Display should zoom smoothly with no visible jitter, snapping, or flickering.

15. **Console error check.** Open DevTools on both windows. Perform all the above tests. There should be no errors or warnings in the console related to camera sync, BroadcastChannel, or message handling.

---

## 15. Migration checklist

This is the ordered list of changes for Claude Code. Each item references the section above that provides the implementation.

1. **Add `localToShared()` and `sharedToLocal()` functions** to `shared/protocol.js` (Section 2). Place after the existing factory functions, before `validateMessage()`.

2. **Add Phase 4 message types** to `shared/protocol.js`: `CAMERA_SYNC`, `CAMERA_JUMP_TO`, `ANNOUNCE`, `WELCOME`, `HEARTBEAT`, `GOODBYE` constants in the MSG object, corresponding REQUIRED_FIELDS entries, and factory functions (Section 3).

3. **Create `vtt/js/camera-sync.js`** with the complete module (Sections 5, 6, 7, 9, 12):
   - Module-level constants (MIN_SEND_INTERVAL, EPSILON_POS, EPSILON_ZOOM)
   - `generateWindowId()` helper function
   - `CameraBroadcaster` class
   - `CameraReceiver` class
   - `WindowRegistry` class (with HEARTBEAT_INTERVAL, HEARTBEAT_TIMEOUT constants)
   - `CameraChannelManager` class (with CAMERA_CHANNEL_NAME, SESSION_KEY, SESSION_MAX_AGE constants)
   - `CameraSyncEngine` orchestrator class

4. **Update `vtt/js/main.js`**: Import `CameraSyncEngine` from `camera-sync.js`. After the camera is initialized and the map is loaded, create and start a `CameraSyncEngine` with `role: 'display'`. Expose on `window.__vtt.syncEngine` for testing (Section 12).

5. **Update the Controller's button handlers**: Replace `createCameraZoomMsg()`, `createCameraPanMsg()`, and `createCameraResetMsg()` calls with direct camera manipulation (`camera.zoomToCenter()`, `camera.panBy()`, `camera.fitCover()`). The CameraBroadcaster handles transmission automatically (Section 11).

6. **Update the Controller's initialization**: Import `CameraSyncEngine` and `Camera`. Create a Camera instance for the Controller (using the preview area dimensions or a nominal 1920x1080). Create and start a `CameraSyncEngine` with `role: 'controller'`. Expose on `window.__controller` for testing (Section 12).

7. **Verify the existing `camera:set-state` EventBus handler** in Camera's `attachTo()` still works for backward compatibility. The Phase 1 handler (`EventBus.on('camera:set-state', ...)`) should remain functional but is no longer the primary sync path. No changes needed; just verify it does not conflict.

8. **Verify the existing `handleSyncMessage()` cases** in `vtt/js/state.js` for `CAMERA_ZOOM`, `CAMERA_PAN`, and `CAMERA_RESET` still work. These handle messages from any remaining old-style Controllers. No changes needed; leave them as dead code for backward compatibility.

9. **Run the test suite** (Section 14): unit tests for center-point conversion, epsilon detection, sequence rejection; Playwright integration tests for cross-window sync; manual testing checklist.

---

## 16. What Phase 5 expects from this foundation

Phase 5 (Advanced features) builds on Phase 4's sync infrastructure. Specifically, it expects:

- **`localToShared()` and `sharedToLocal()` are the canonical conversion functions.** Phase 5's camera presets store positions in shared (center-point) format. When the DM saves a preset, it calls `localToShared()` to convert the current camera to a viewport-independent snapshot. When recalling, it calls `sharedToLocal()` to convert back. The same functions are used for sync, presets, and persistence.

- **`CameraBroadcaster.sendJumpTo()` is the entry point for instant camera moves.** Phase 5's `flyTo` animation runs locally on each window. The Controller sends a single `CAMERA_FLY_TO` message (Phase 5 addition) containing the target position. Each receiver executes the van Wijk & Nuij animation locally at 60fps, converging on the target. The `sendJumpTo()` mechanism from Phase 4 provides the fallback for windows that do not support animated transitions.

- **`WindowRegistry` tracks all connected peers.** Phase 5's authority election protocol queries the registry to find all Controllers, selects the one with the lowest window ID, and broadcasts `AUTHORITY_CLAIM`. The registry's `onPeerChange` callbacks notify the election system when Controllers join or leave.

- **`CameraChannelManager` handles BroadcastChannel lifecycle.** Phase 5's `CompositeTransport` wraps both BroadcastChannel and WebSocket. The channel manager's `_openChannel()`/`_closeChannel()` pattern becomes one implementation of the `ISyncTransport` interface. The Page Lifecycle integration carries over unchanged.

- **The `suppressBroadcast` flag pattern is reusable.** Phase 5 adds interpolation smoothing (exponential decay between 30fps samples). The smoothing loop sets camera state on every display frame (60fps). Without suppression, the broadcaster would re-broadcast the interpolated state. The same flag prevents this.

- **`CameraSyncEngine` is the single initialization point.** Phase 5 adds presets and authority election as optional features within the engine. The `role` parameter drives which features activate. Adding new roles (e.g., `'spectator'` for a read-only player view) requires only a new branch in the engine's constructor.

Phase 5 (Advanced features) also expects:

- **Sequence numbers are per-sender and monotonic.** Phase 5's `CAMERA_FLY_TO` message includes a sequence number so the receiver can reject stale fly-to commands that arrive after a newer one.

- **The WELCOME handshake includes camera state.** Phase 5 extends WELCOME to also include presets and authority state. The `camera` field in the WELCOME payload is already structured for this extension.

- **The DM Guide's independence is preserved.** Phase 5 may optionally add a "follow Controller" toggle to the DM Guide. The architecture supports this: creating a CameraSyncEngine with `role: 'dm-guide'` that has an optional receiver would be straightforward.

The sync engine you build in Phase 4 is the communication backbone of the multi-window VTT. Every subsequent feature that crosses a window boundary uses this infrastructure.

---

## 17. What is explicitly deferred and why

The following features were researched for Phase 4 but deliberately scoped out. Each has a reason:

**Van Wijk & Nuij flyTo algorithm (deferred to Phase 5).** The cinematic camera transition that zooms out, pans, and zooms back in is the marquee feature of Phase 5. It requires frame-rate-independent interpolation, a spring-based interrupt mechanism, and per-window local execution at 60fps. The mathematical foundation (optimal path through (x, y, w) space with ρ ≈ 1.42) is well understood from the research phase, but implementing it cleanly requires the authority election system (so only one window initiates the fly-to) and the preset system (which provides the target positions). Building it before those dependencies exist would produce throwaway integration code.

**Camera presets (deferred to Phase 5).** Full CRUD for saved camera positions, Shift+1..9 hotkey bindings, and `PRESET_SYNC` messages belong together as a feature unit. Presets depend on the center-point model (Phase 4 delivers this) and the flyTo animation (Phase 5). Implementing presets without flyTo means they snap instantly, which is a worse DM experience than waiting for Phase 5's animated transitions.

**ISyncTransport abstraction and CompositeTransport (deferred to Phase 5).** Wrapping BroadcastChannel in an interface before a second transport (WebSocket) exists is premature abstraction. The camera sync classes use `channel.postMessage()` and `channel.onmessage` directly, which is a small surface area that is easy to wrap later. Phase 5 introduces the abstraction alongside the WebSocket implementation.

**Deterministic authority election (deferred to Phase 5).** Phase 4's simple model (Controller always sends, Display always receives) covers the typical use case. Authority election becomes necessary when multiple Controllers need coordinated handoff, which is a Phase 5 multi-user scenario. The WindowRegistry from Phase 4 provides the peer tracking that election needs.

**Debug overlay and performance tracking (deferred to Phase 5).** The `SyncDebugOverlay` showing peer count, messages per second, and latency percentiles is a development tool, not a user feature. It is useful for tuning the sync engine's parameters but not necessary for correct operation. Phase 5 adds it alongside the latency measurement infrastructure (timestamps in messages, `performance.mark()`/`measure()` instrumentation).

**Exponential decay interpolation (deferred to Phase 5).** At 30fps sync rate, the Display updates its camera every 33ms. On a 60Hz display, this means every other frame shows the same camera position, producing a subtle stutter during fast pan/zoom. Exponential decay interpolation (`lerp(current, target, 1 - e^(-dt * rate))`) on the receiver side smooths 30fps updates into 60fps rendering. The visual improvement is real but subtle, and the implementation adds complexity (a continuous render loop on the Display that currently only renders on `camera:changed`). Phase 5 adds this after the core sync is stable and the visual stutter can be measured and compared.
