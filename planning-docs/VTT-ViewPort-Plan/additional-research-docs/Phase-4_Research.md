# Phase 4: BroadcastChannel camera synchronization layer

**The core architectural shift in Phase 4 is replacing command-based camera messages with a continuous state-streaming protocol built on a center-point camera model, role-based authority, and a transport-agnostic sync engine.** This phase transforms the existing `CAMERA_ZOOM`/`CAMERA_PAN`/`CAMERA_RESET` command pattern into a unified system where windows stream camera state at 30 fps, late-joiners receive full state via an announce-on-connect handshake, and animated transitions like flyTo propagate as target messages that each window executes independently. The design separates canonical (unclamped) shared state from local viewport-constrained rendering state, eliminating clamping ping-pong between differently-sized windows. Every component is built against an `ISyncTransport` interface so the entire protocol can migrate from BroadcastChannel to WebSocket without touching camera logic.

Research draws on Figma's multiplayer architecture (property-level last-writer-wins over WebSocket), tldraw's TLSync CRDT protocol, Excalidraw's version-number conflict resolution, Mapbox GL JS's center+zoom camera model and van Wijk & Nuij flyTo algorithm, deck.gl's viewport-independent ViewState sharing, Leaflet.Sync's cross-viewport synchronization, Unity's distributed authority ownership model, and Chrome's Page Lifecycle API for tab freeze/discard handling.

---

## 1. Transport-agnostic sync engine architecture

Before any camera logic, the protocol needs an abstraction boundary between sync behavior and transport mechanism. This is the single most important architectural decision for future-proofing. Figma runs WebSocket with custom binary serialization. Yjs provides pluggable sync providers (y-webrtc uses BroadcastChannel internally, y-websocket for remote). The VTT should follow this pattern from day one.

**The `ISyncTransport` interface** defines what any transport must provide:

```javascript
// shared/sync/ISyncTransport.js
/**
 * @typedef {Object} SyncMessage
 * @property {string} type
 * @property {string} id       - crypto.randomUUID() per message
 * @property {string} sender   - window ID
 * @property {number} seq      - per-sender monotonic counter
 * @property {number} ts       - performance.timeOrigin + performance.now()
 * @property {*}      payload
 */

class ISyncTransport {
  /** @returns {boolean} */
  get connected() { throw new Error('not implemented'); }
  get type() { throw new Error('not implemented'); }

  /** @param {SyncMessage} msg */
  send(msg) { throw new Error('not implemented'); }

  /** @param {(msg: SyncMessage) => void} handler */
  onMessage(handler) { throw new Error('not implemented'); }

  /** @param {(connected: boolean) => void} handler */
  onConnectionChange(handler) { throw new Error('not implemented'); }

  /** @returns {Promise<void>} */
  connect() { throw new Error('not implemented'); }

  disconnect() { throw new Error('not implemented'); }
  destroy() { throw new Error('not implemented'); }
}
```

**BroadcastChannel transport implementation:**

```javascript
// shared/sync/BroadcastChannelTransport.js
class BroadcastChannelTransport extends ISyncTransport {
  #channel = null;
  #name;
  #messageHandler = null;
  #connectionHandler = null;

  get connected() { return this.#channel !== null; }
  get type() { return 'broadcast-channel'; }

  constructor(channelName) {
    super();
    this.#name = channelName;
  }

  async connect() {
    this.#channel = new BroadcastChannel(this.#name);
    this.#channel.onmessage = (e) => this.#messageHandler?.(e.data);
    this.#channel.onmessageerror = () => console.error('[BC] deserialization failed');
    this.#connectionHandler?.(true);
  }

  send(msg) {
    if (!this.#channel) throw new Error('Transport not connected');
    this.#channel.postMessage(msg);
  }

  onMessage(handler) {
    this.#messageHandler = handler;
    if (this.#channel) this.#channel.onmessage = (e) => handler(e.data);
  }

  onConnectionChange(handler) { this.#connectionHandler = handler; }

  disconnect() {
    this.#channel?.close();
    this.#channel = null;
    this.#connectionHandler?.(false);
  }

  destroy() { this.disconnect(); }
}
```

**Future WebSocket transport** will implement the same interface with JSON serialization, exponential-backoff reconnection, and a heartbeat keep-alive. A `CompositeTransport` wrapping both enables local BroadcastChannel sync alongside remote WebSocket sync, deduplicating messages by `id`:

```javascript
class CompositeTransport extends ISyncTransport {
  #transports;
  #seen = new Set();

  constructor(transports) {
    super();
    this.#transports = transports;
  }

  get connected() { return this.#transports.some(t => t.connected); }
  get type() { return 'composite'; }

  async connect() {
    await Promise.allSettled(this.#transports.map(t => t.connect()));
  }

  send(msg) {
    for (const t of this.#transports) {
      if (t.connected) try { t.send(msg); } catch { /* skip failed */ }
    }
  }

  onMessage(handler) {
    for (const t of this.#transports) {
      t.onMessage((msg) => {
        if (this.#seen.has(msg.id)) return;
        this.#seen.add(msg.id);
        if (this.#seen.size > 5000) this.#seen.clear(); // prevent unbounded growth
        handler(msg);
      });
    }
  }
}
```

**Separate channels by concern.** Use `BroadcastChannel('vtt-camera')` for high-frequency camera state and `BroadcastChannel('vtt-control')` for handshake, authority, and preset messages. This prevents 30 fps camera spam from delaying control messages in the browser's task queue.

---

## 2. The center-point camera model solves cross-viewport adaptation

The existing Phase 1 camera model stores `{ x, y, zoom }` as the top-left offset of the world origin from the viewport's top-left corner. This is **viewport-dependent** — the same `{x, y, zoom}` produces different visible centers on different-sized windows. Mapbox GL JS, Leaflet, deck.gl, and Google Maps all use **center-point + zoom** as their canonical camera representation precisely because it is viewport-independent.

**The mathematical relationship:**

```
Given top-left camera {cam.x, cam.y, cam.zoom} and viewport {vw, vh}:

  centerX = (vw/2 - cam.x) / cam.zoom    // world-space center
  centerY = (vh/2 - cam.y) / cam.zoom

Inverse (shared center → local top-left):

  cam.x = vw/2 - centerX × zoom
  cam.y = vh/2 - centerY × zoom
```

**The shared camera state is always center-based and unclamped:**

```javascript
// shared/protocol.js — add to existing MSG constants
const MSG = {
  // ... existing constants ...
  CAMERA_STATE:     'CAMERA_STATE',
  CAMERA_FLY_TO:    'CAMERA_FLY_TO',
  CAMERA_JUMP_TO:   'CAMERA_JUMP_TO',
  ANNOUNCE:         'ANNOUNCE',
  WELCOME:          'WELCOME',
  HEARTBEAT:        'HEARTBEAT',
  GOODBYE:          'GOODBYE',
  AUTHORITY_CLAIM:  'AUTHORITY_CLAIM',
  AUTHORITY_RELEASE:'AUTHORITY_RELEASE',
  PRESET_SYNC:      'PRESET_SYNC',
};

/**
 * Viewport-independent shared camera state.
 * @typedef {Object} SharedCameraState
 * @property {number} centerX  - world-space X of viewport center
 * @property {number} centerY  - world-space Y of viewport center
 * @property {number} zoom     - scale factor (1 = 100%)
 */

function localToShared(camera, viewport) {
  return {
    centerX: (viewport.width / 2 - camera.x) / camera.zoom,
    centerY: (viewport.height / 2 - camera.y) / camera.zoom,
    zoom: camera.zoom,
  };
}

function sharedToLocal(shared, viewport) {
  return {
    x: viewport.width / 2 - shared.centerX * shared.zoom,
    y: viewport.height / 2 - shared.centerY * shared.zoom,
    zoom: shared.zoom,
  };
}
```

**Why this works:** When the Controller (1920×1080) shares `{centerX: 500, centerY: 300, zoom: 2.0}`, the VTT Display (3840×2160) computes `cam.x = 1920 - 1000 = 920, cam.y = 1080 - 600 = 480`. Both windows show the same world point at center, at the same scale. The Display simply reveals more map around the edges — exactly the behavior a projected display needs.

**Cover zoom changes with viewport dimensions.** For bounds `(boundsW, boundsH)`:

```
coverZoom = max(viewW / boundsW, viewH / boundsH)
```

A 1920×1080 Controller with 1600×900 bounds gets `coverZoom = max(1.2, 1.2) = 1.2`. An 800×600 Display gets `coverZoom = max(0.5, 0.667) = 0.667`. These fundamentally different minimums are central to the clamping ping-pong problem addressed in Section 5.

---

## 3. Continuous 30 fps state streaming with rAF-aligned throttling

The existing command-based approach (`CAMERA_ZOOM` with direction, `CAMERA_PAN` with deltas) cannot express continuous gestures smoothly. Phase 4 replaces this with **full-state broadcasts throttled to ~33ms** using requestAnimationFrame alignment.

**rAF is the correct choice for the sending window** because it aligns with the browser's paint cycle, fires at display refresh rate (skip every other frame for 30 fps), and automatically pauses in background tabs — which is actually desirable since background windows shouldn't be driving camera state. The critical caveat from research: **rAF is throttled or paused in background tabs** across Chrome, Firefox, and Safari. For the VTT, this is acceptable because the active window (where the DM is interacting) is always foreground.

```javascript
// camera/CameraBroadcaster.js
class CameraBroadcaster {
  #transport;
  #windowId;
  #seq = 0;
  #lastBroadcast = 0;
  #lastShared = { centerX: 0, centerY: 0, zoom: 1 };
  #rafId = null;
  #suppressBroadcast = false;

  static MIN_INTERVAL = 33;   // ~30 fps cap
  static EPSILON_POS = 0.5;   // world-space pixels
  static EPSILON_ZOOM = 0.001;

  constructor(transport, windowId) {
    this.#transport = transport;
    this.#windowId = windowId;
  }

  /** Call from the camera's onChange hook — NOT from received state */
  onLocalCameraChange(camera, viewport) {
    if (this.#suppressBroadcast) return;
    // Lazy start the rAF loop
    if (!this.#rafId) this.#startLoop();
    // Stash latest state for next broadcast
    this._pendingShared = localToShared(camera, viewport);
  }

  /** Suppress re-broadcast of received state — prevents ping-pong */
  applyReceivedState(fn) {
    this.#suppressBroadcast = true;
    try { fn(); } finally { this.#suppressBroadcast = false; }
  }

  #startLoop() {
    const tick = (timestamp) => {
      this.#rafId = requestAnimationFrame(tick);
      if (timestamp - this.#lastBroadcast < CameraBroadcaster.MIN_INTERVAL) return;
      if (!this._pendingShared) return;
      if (!this.#hasSignificantChange(this._pendingShared)) return;

      this.#lastBroadcast = timestamp;
      this.#lastShared = this._pendingShared;
      this._pendingShared = null;

      this.#transport.send({
        type: MSG.CAMERA_STATE,
        id: crypto.randomUUID(),
        sender: this.#windowId,
        seq: ++this.#seq,
        ts: performance.timeOrigin + performance.now(),
        payload: this.#lastShared,
      });
    };
    this.#rafId = requestAnimationFrame(tick);
  }

  #hasSignificantChange(next) {
    const prev = this.#lastShared;
    return Math.abs(prev.centerX - next.centerX) > CameraBroadcaster.EPSILON_POS
        || Math.abs(prev.centerY - next.centerY) > CameraBroadcaster.EPSILON_POS
        || Math.abs(prev.zoom - next.zoom) > CameraBroadcaster.EPSILON_ZOOM;
  }

  stop() {
    if (this.#rafId) cancelAnimationFrame(this.#rafId);
    this.#rafId = null;
  }
}
```

**Serialization performance is a non-issue.** BroadcastChannel always uses the structured clone algorithm internally. For a 3-property numeric object like `{centerX, centerY, zoom}`, structured clone takes ~1.3µs. At 30 fps the total serialization cost is **~39µs/second** — negligible. The IPC overhead of cross-process messaging (~100–500µs per message) dominates. Pre-serializing to JSON strings provides no measurable benefit for objects this small.

**Reuse the message template object on the sending side** to minimize GC pressure. Structured clone creates a copy on the receiving side regardless, so mutation of the template after `postMessage` is safe:

```javascript
// Pre-allocated template — avoids 30 allocations/sec on sender
const _msgTemplate = {
  type: MSG.CAMERA_STATE, id: '', sender: '', seq: 0, ts: 0, payload: null
};

function sendOptimized(transport, windowId, seq, shared) {
  _msgTemplate.id = crypto.randomUUID();
  _msgTemplate.sender = windowId;
  _msgTemplate.seq = seq;
  _msgTemplate.ts = performance.timeOrigin + performance.now();
  _msgTemplate.payload = shared;
  transport.send(_msgTemplate);
}
```

For the VTT's 30 messages/second of tiny objects, **object pooling is overkill** — V8's young-generation scavenge GC handles short-lived small objects efficiently. Focus optimization effort on the rendering path, not the sync path.

---

## 4. Sequence numbers and stale message rejection

BroadcastChannel provides **no formal cross-process ordering guarantees**. The WHATWG spec is deliberately vague about asynchronous delivery semantics across renderer processes. Messages from the same sender to the same receiver are typically FIFO in practice, but this is not specified.

For camera state, full distributed ordering (Lamport clocks, vector clocks) is unnecessary. Camera position is **last-writer-wins ephemeral state** — you only care about the most recent value. A simple per-sender monotonic sequence number with stale rejection is sufficient:

```javascript
// camera/CameraReceiver.js
class CameraReceiver {
  #lastSeq = new Map(); // senderId → last processed seq
  #onUpdate;

  constructor(onUpdate) {
    this.#onUpdate = onUpdate;
  }

  handleMessage(msg) {
    if (msg.type !== MSG.CAMERA_STATE) return;

    const prevSeq = this.#lastSeq.get(msg.sender) ?? 0;
    if (msg.seq <= prevSeq) return; // stale or duplicate — drop

    this.#lastSeq.set(msg.sender, msg.seq);
    this.#onUpdate(msg.payload, msg.sender, msg.ts);
  }
}
```

**Use integer sequence counters, not timestamps, for ordering.** `performance.now()` has different `timeOrigin` per window, making cross-window comparison require normalization. `Date.now()` is susceptible to NTP adjustments and can go backward. Integer sequence numbers are monotonic by construction and trivially comparable. Include `ts` (as `performance.timeOrigin + performance.now()`) only for staleness/age detection and latency measurement — never for ordering decisions.

---

## 5. Clamping ping-pong prevention through unidirectional flow

The most subtle bug in cross-viewport camera sync is **clamping ping-pong**: Window A broadcasts state, Window B receives and clamps it (different viewport → different constraints), re-broadcasts the clamped version, Window A receives and clamps differently, ad infinitum. Three rules eliminate this entirely:

**Rule 1: Never re-broadcast received state.** Only broadcast state that originates from local user interaction. The `CameraBroadcaster.applyReceivedState()` wrapper above enforces this by setting a suppression flag during application of remote state.

**Rule 2: Share unclamped canonical state.** The center-point camera state broadcast over the wire is never clamped. Each window applies its own viewport-specific constraints locally for rendering only:

```javascript
// In the VTT Display window:
function onRemoteCameraState(shared) {
  // Store canonical unclamped state
  canonicalCamera = { ...shared };

  // Convert to local top-left coordinates
  const local = sharedToLocal(shared, viewport);

  // Apply LOCAL constraints for rendering — different viewport, different bounds
  const myCoverZoom = Math.max(viewport.width / bounds.w, viewport.height / bounds.h);
  let zoom = shared.zoom;
  let cx = shared.centerX, cy = shared.centerY;

  // If zoom is below this viewport's cover zoom, clamp
  if (zoom < myCoverZoom) zoom = myCoverZoom;

  // Recompute local coordinates from (possibly adjusted) zoom
  const constrained = {
    x: viewport.width / 2 - cx * zoom,
    y: viewport.height / 2 - cy * zoom,
    zoom: zoom,
  };

  // Apply pan constraints
  _applyConstraints(constrained, viewport, bounds);

  // Set camera WITHOUT triggering broadcast
  broadcaster.applyReceivedState(() => {
    camera.x = constrained.x;
    camera.y = constrained.y;
    camera.zoom = constrained.zoom;
    requestRender();
  });
}
```

**Rule 3: Epsilon-based change detection.** Even with rules 1 and 2, floating-point arithmetic can cause sub-pixel differences that trigger unnecessary broadcasts. The `EPSILON_POS = 0.5` and `EPSILON_ZOOM = 0.001` thresholds in `CameraBroadcaster` ensure only visually meaningful changes propagate.

**The architectural principle** mirrors tldraw's multiplayer approach: camera is instance state, not shared document state. Each window stores the canonical shared center+zoom, applies its own constraints locally, and renders what fits in its viewport. The authoritative source is always the window where the user is actively interacting.

---

## 6. Announce-on-connect handshake protocol

When a window opens late (the DM opens the Controller after the VTT Display is already running), it has no camera state. BroadcastChannel has no built-in discovery. The announce-on-connect pattern solves this:

```
Window A (running)                  Window B (just opened)
────────────────────                ──────────────────────
                                    → ANNOUNCE {windowId, role, ts}
Receives ANNOUNCE
→ WELCOME {windowId, role,
   camera, presets, epoch,
   targetWindowId: B}
                                    Receives WELCOME
                                    Hydrates camera + presets
                                    → HEARTBEAT (begins periodic)
```

**Message definitions extending shared/protocol.js:**

```javascript
function makeAnnounce(windowId, role) {
  return {
    type: MSG.ANNOUNCE,
    id: crypto.randomUUID(),
    sender: windowId,
    seq: 0,
    ts: performance.timeOrigin + performance.now(),
    payload: { role, capabilities: ['camera', 'presets'] },
  };
}

function makeWelcome(windowId, role, targetWindowId, state) {
  return {
    type: MSG.WELCOME,
    id: crypto.randomUUID(),
    sender: windowId,
    seq: 0,
    ts: performance.timeOrigin + performance.now(),
    payload: {
      role,
      targetWindowId,
      camera: state.camera,     // SharedCameraState
      presets: state.presets,    // CameraPreset[]
      authority: state.authorityId,
      epoch: state.epoch,       // monotonic state version
      peers: state.knownPeers,  // [{windowId, role}]
    },
  };
}
```

**The WindowRegistry manages lifecycle:**

```javascript
class WindowRegistry {
  #peers = new Map();   // windowId → {role, lastSeen}
  #myId;
  #myRole;
  #transport;
  #heartbeatTimer;
  #onPeerJoin;
  #onPeerLost;

  static HEARTBEAT_INTERVAL = 3000;
  static HEARTBEAT_TIMEOUT  = 10000;

  constructor(transport, role, { onPeerJoin, onPeerLost }) {
    this.#myId = crypto.randomUUID();
    this.#myRole = role;         // 'display' | 'controller' | 'dm-guide'
    this.#transport = transport;
    this.#onPeerJoin = onPeerJoin;
    this.#onPeerLost = onPeerLost;
  }

  get myId() { return this.#myId; }
  get peers() { return this.#peers; }

  start() {
    this.#transport.onMessage((msg) => this.#handleMessage(msg));
    this.#transport.send(makeAnnounce(this.#myId, this.#myRole));
    this.#heartbeatTimer = setInterval(() => {
      this.#transport.send({
        type: MSG.HEARTBEAT,
        id: crypto.randomUUID(),
        sender: this.#myId,
        seq: 0,
        ts: performance.timeOrigin + performance.now(),
        payload: { role: this.#myRole },
      });
      this.#reapDeadPeers();
    }, WindowRegistry.HEARTBEAT_INTERVAL);
  }

  #handleMessage(msg) {
    if (msg.sender === this.#myId) return;

    switch (msg.type) {
      case MSG.ANNOUNCE:
        this.#peers.set(msg.sender, {
          role: msg.payload.role,
          lastSeen: Date.now(),
        });
        this.#onPeerJoin?.(msg.sender, msg.payload.role);
        // Respond with WELCOME containing full state
        break;

      case MSG.HEARTBEAT:
        if (this.#peers.has(msg.sender)) {
          this.#peers.get(msg.sender).lastSeen = Date.now();
        } else {
          // Unknown peer — they may have missed our ANNOUNCE
          this.#peers.set(msg.sender, {
            role: msg.payload.role,
            lastSeen: Date.now(),
          });
          this.#onPeerJoin?.(msg.sender, msg.payload.role);
        }
        break;

      case MSG.GOODBYE:
        this.#peers.delete(msg.sender);
        this.#onPeerLost?.(msg.sender);
        break;
    }
  }

  #reapDeadPeers() {
    const now = Date.now();
    for (const [id, info] of this.#peers) {
      if (now - info.lastSeen > WindowRegistry.HEARTBEAT_TIMEOUT) {
        this.#peers.delete(id);
        this.#onPeerLost?.(id);
      }
    }
  }

  destroy() {
    clearInterval(this.#heartbeatTimer);
    try {
      this.#transport.send({
        type: MSG.GOODBYE,
        id: crypto.randomUUID(),
        sender: this.#myId,
        seq: 0,
        ts: performance.timeOrigin + performance.now(),
        payload: null,
      });
    } catch { /* transport may already be closed */ }
  }
}
```

**Window roles** are determined at creation time via URL path: `/vtt/display`, `/vtt/controller`, `/vtt/dm-guide`. Multiple windows may respond to an ANNOUNCE — the joining window should collect WELCOMEs for ~150ms, then apply the one with the highest `epoch`.

**The `pagehide` event** fires the GOODBYE message. Chrome also requires `pagehide` (not `beforeunload`) for bfcache compatibility. Heartbeats handle the crash/kill case where GOODBYE never fires — the 10-second timeout reaps dead peers.

---

## 7. Role-based camera authority with deterministic election

Camera authority determines which window drives the shared camera state. Research into Figma (server-authoritative, property-level LWW), Unity's distributed authority (ownership states: None, Distributable, Transferable, RequestRequired), and coherence's input/state authority split all inform this design. For the VTT:

**The Controller is the natural camera authority.** The VTT Display is a follower by default. The DM Guide has independent camera (never synced). This maps directly to the DM/player role split.

```javascript
// camera/CameraAuthority.js
class CameraAuthority {
  #isAuthority = false;
  #authorityId = null;
  #myId;
  #myRole;
  #transport;
  #registry;

  constructor(transport, registry) {
    this.#transport = transport;
    this.#registry = registry;
    this.#myId = registry.myId;
    this.#myRole = registry.role;
  }

  get isAuthority() { return this.#isAuthority; }
  get authorityId() { return this.#authorityId; }

  /** Attempt to claim authority */
  claim() {
    this.#isAuthority = true;
    this.#authorityId = this.#myId;
    this.#transport.send({
      type: MSG.AUTHORITY_CLAIM,
      id: crypto.randomUUID(),
      sender: this.#myId,
      seq: 0,
      ts: performance.timeOrigin + performance.now(),
      payload: { role: this.#myRole },
    });
  }

  /** Release authority (e.g., when closing) */
  release() {
    this.#isAuthority = false;
    this.#transport.send({
      type: MSG.AUTHORITY_RELEASE,
      id: crypto.randomUUID(),
      sender: this.#myId,
      seq: 0,
      ts: performance.timeOrigin + performance.now(),
      payload: null,
    });
  }

  handleAuthorityMessage(msg) {
    if (msg.type === MSG.AUTHORITY_CLAIM) {
      if (this.#isAuthority && msg.sender !== this.#myId) {
        // Conflict: two windows claim authority simultaneously
        // Deterministic resolution: lowest windowId wins
        if (msg.sender < this.#myId) {
          this.#isAuthority = false;
          this.#authorityId = msg.sender;
        }
        // else: we keep authority, other will see our claim
      } else {
        this.#authorityId = msg.sender;
      }
    }

    if (msg.type === MSG.AUTHORITY_RELEASE) {
      if (msg.sender === this.#authorityId) {
        this.#authorityId = null;
        this.#electNewAuthority();
      }
    }
  }

  /** Called when authority peer disconnects */
  onAuthorityLost() {
    this.#authorityId = null;
    this.#electNewAuthority();
  }

  #electNewAuthority() {
    // Deterministic election: lowest windowId among controllers
    const controllers = [...this.#registry.peers.entries()]
      .filter(([_, info]) => info.role === 'controller')
      .map(([id]) => id);
    controllers.push(this.#myId); // include self if controller

    if (this.#myRole !== 'controller') return; // displays don't claim

    controllers.sort();
    if (controllers[0] === this.#myId) {
      this.claim();
    }
  }
}
```

**Authority flow:** The first Controller to open claims authority via `AUTHORITY_CLAIM`. If a second Controller opens, it detects the existing authority from the WELCOME message and operates as a passive observer. When the authority window closes (GOODBYE or heartbeat timeout), the remaining Controller with the lowest `windowId` is deterministically elected. Display windows never claim authority — they enter an "orphan mode" overlay ("Waiting for DM…") if no controllers remain.

**Camera updates from the authority use fire-and-forget LWW.** Camera state is ephemeral — incorrect positions are immediately overwritten by the next frame. No acknowledgments, no rollback. This matches Figma's approach: "Figma's multiplayer servers keep track of the latest value that any client has sent for a given property."

The VTT Display can optionally have local camera controls for player-driven panning. These operate in an **optimistic local mode**: the display applies input locally and renders immediately, but does not broadcast. When the next authority camera update arrives, it smoothly interpolates to the authority's state using the spring system, creating a "soft follow" feel rather than a hard snap.

---

## 8. The van Wijk & Nuij flyTo algorithm for animated transitions

When the DM clicks "fly to Boss Room," the VTT Display should execute a cinematic zoom-pan that first zooms out to reveal the path, pans smoothly, then zooms in to the target. This is the van Wijk & Nuij (2003) optimal path through `(x, y, w)` space, where `w` represents visible width (inversely related to zoom). Mapbox GL JS and MapLibre implement this as `map.flyTo()`.

**The core equations.** A camera view is `(u, w)` where `u` is position along the straight line from start to end, and `w` is visible width. The **perceived velocity metric** is:

```
V_perceived = √((du/ds)² + (dw/ds)²) × (ρ²/w)
```

The parameter **ρ ≈ 1.42** (from user studies) controls the zoom-to-pan tradeoff. The optimal path minimizes total perceived distance `S` and follows a geodesic in this metric space:

```
r(b) = ln(-b + √(b² + 1))     // = arcsinh(-b)

b₀ = (w₁² - w₀² + ρ⁴u₁²) / (2w₀ρ²u₁)
b₁ = (w₁² - w₀² - ρ⁴u₁²) / (2w₁ρ²u₁)

r₀ = r(b₀),  r₁ = r(b₁)
S  = (r₁ - r₀) / ρ

Position:  u(s) = (w₀/ρ²) · cosh(r₀) · tanh(ρs + r₀) - (w₀/ρ²) · sinh(r₀)
Width:     w(s) = w₀ · cosh(r₀) / cosh(ρs + r₀)
```

**Complete implementation:**

```javascript
// camera/flyTo.js
const cosh = (x) => (Math.exp(x) + Math.exp(-x)) / 2;
const sinh = (x) => (Math.exp(x) - Math.exp(-x)) / 2;
const tanh = (x) => sinh(x) / cosh(x);

/**
 * Compute a van Wijk & Nuij optimal camera path.
 * @param {{centerX, centerY, zoom}} start
 * @param {{centerX, centerY, zoom}} end
 * @param {Object} [opts]
 * @param {number} [opts.curve=1.42]   ρ parameter
 * @param {number} [opts.speed=1.2]    screenfulls/sec
 * @param {number} [opts.screenWidth]  for w↔zoom conversion
 * @returns {{ duration: number, at: (t: number) => SharedCameraState }}
 */
function computeFlyToPath(start, end, opts = {}) {
  const rho = opts.curve ?? 1.42;
  const V = opts.speed ?? 1.2;
  const rho2 = rho * rho;
  const rho4 = rho2 * rho2;
  const screenW = opts.screenWidth ?? 1920;

  // Convert zoom to visible width: w = screenWidth / zoom
  const w0 = screenW / start.zoom;
  const w1 = screenW / end.zoom;

  const dx = end.centerX - start.centerX;
  const dy = end.centerY - start.centerY;
  const u1 = Math.sqrt(dx * dx + dy * dy);

  let S, uFn, wFn;

  if (u1 < 1e-6) {
    // Pure zoom — no pan
    if (Math.abs(w0 - w1) < 1e-6) return { duration: 0, at: () => ({ ...start }) };
    const k = w1 < w0 ? -1 : 1;
    S = Math.abs(Math.log(w1 / w0)) / rho;
    uFn = () => 0;
    wFn = (s) => w0 * Math.exp(k * rho * s);
  } else {
    // General case: combined zoom + pan
    const b0 = (w1*w1 - w0*w0 + rho4 * u1*u1) / (2 * w0 * rho2 * u1);
    const b1 = (w1*w1 - w0*w0 - rho4 * u1*u1) / (2 * w1 * rho2 * u1);

    const r = (b) => Math.log(-b + Math.sqrt(b * b + 1));
    const r0 = r(b0);
    const r1 = r(b1);

    S = (r1 - r0) / rho;

    const a = w0 / rho2;
    const coshr0 = cosh(r0);
    const sinhr0 = sinh(r0);

    uFn = (s) => a * coshr0 * tanh(rho * s + r0) - a * sinhr0;
    wFn = (s) => w0 * coshr0 / cosh(rho * s + r0);
  }

  const duration = opts.duration ?? (1000 * S / V);

  return {
    duration: Math.max(duration, 200), // minimum 200ms
    at(t) {
      const s = t * S;
      const uNorm = u1 > 1e-6 ? uFn(s) / u1 : 0;
      const w = wFn(s);
      return {
        centerX: start.centerX + dx * uNorm,
        centerY: start.centerY + dy * uNorm,
        zoom: screenW / w,
      };
    },
  };
}
```

**Integration with Phase 3's CameraAnimator spring system.** The flyTo algorithm computes a fixed parametric path. The critically-damped spring system from Phase 3 handles interactive, interruptible animation. The integration uses a **layered approach**: flyTo feeds waypoints as the spring's moving target each frame. The spring provides natural smoothing and handles interruptions (user grabs camera mid-flight):

```javascript
// camera/CameraAnimator.js — extend Phase 3's existing CameraAnimator
class CameraAnimator {
  #spring;          // Phase 3's critically-damped spring
  #currentFlyTo;    // active flyTo animation or null
  #rafId;

  flyTo(target, opts) {
    this.#currentFlyTo?.cancel?.();
    const current = localToShared(this.camera, this.viewport);
    this.#currentFlyTo = {
      path: computeFlyToPath(current, target, opts),
      startTime: performance.now(),
      cancel() { this.cancelled = true; },
    };
  }

  /** Called on user interaction — cancels flyTo, spring takes over */
  interrupt() {
    this.#currentFlyTo?.cancel();
    this.#currentFlyTo = null;
  }

  update(now) {
    if (this.#currentFlyTo && !this.#currentFlyTo.cancelled) {
      const elapsed = now - this.#currentFlyTo.startTime;
      const t = Math.min(elapsed / this.#currentFlyTo.path.duration, 1.0);
      const eased = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
      const waypoint = this.#currentFlyTo.path.at(eased);

      // Feed waypoint as spring target
      this.#spring.setTarget(waypoint);

      if (t >= 1.0) this.#currentFlyTo = null;
    }

    // Spring always updates — handles interruptions gracefully
    return this.#spring.update(now);
  }
}
```

**Broadcast animated transitions as target messages, not continuous state.** When the DM triggers "fly to Boss Room," broadcast a single `CAMERA_FLY_TO` message. Each receiving window independently executes the flyTo algorithm locally at 60 fps. This produces perfectly smooth animation regardless of sync latency:

```javascript
// Sent once when DM triggers preset
transport.send({
  type: MSG.CAMERA_FLY_TO,
  id: crypto.randomUUID(),
  sender: windowId,
  seq: ++seq,
  ts: performance.timeOrigin + performance.now(),
  payload: {
    target: { centerX: 2400, centerY: 1800, zoom: 2.5 },
    duration: 2000,
    curve: 1.42,
    easing: 'ease-in-out',
    presetId: 'boss-room',
  },
});

// Receiver handles it:
function onFlyToMessage(msg) {
  animator.flyTo(msg.payload.target, {
    duration: msg.payload.duration,
    curve: msg.payload.curve,
  });
}
```

**Frame-rate-independent exponential decay** for spring-like following (when the display follows continuous controller panning, interpolating between 30 fps updates to achieve 60 fps rendering):

```javascript
function expDecay(current, target, halfLife, dt) {
  return target + (current - target) * Math.pow(0.5, dt / halfLife);
}

// In render loop — smooths 30fps updates to 60fps display
const HALF_LIFE = 0.05; // 50ms — fast convergence
camera.x = expDecay(camera.x, targetCamera.x, HALF_LIFE, dt);
camera.y = expDecay(camera.y, targetCamera.y, HALF_LIFE, dt);
camera.zoom = expDecay(camera.zoom, targetCamera.zoom, HALF_LIFE, dt);
```

---

## 9. Camera presets with animated recall

Camera presets store named positions the DM can recall with animated transitions. Research into Tabletop Simulator (`Ctrl+1..9` to save, `Shift+1..9` to recall), Foundry VTT's scene default views, and Figma's viewport bookmark plugins informs this design.

```javascript
// camera/CameraPresetManager.js

/**
 * @typedef {Object} CameraPreset
 * @property {string} id
 * @property {string} name
 * @property {SharedCameraState} camera
 * @property {{duration: number, curve: number}} transition
 * @property {string} [icon]       - emoji identifier
 * @property {string} [hotkey]     - '1'..'9'
 * @property {number} sortOrder
 * @property {number} createdAt
 * @property {number} updatedAt
 */

class CameraPresetManager {
  #presets = new Map();
  #transport;
  #animator;
  #broadcaster;
  #isAuthority;

  constructor(transport, animator, broadcaster, authorityFn) {
    this.#transport = transport;
    this.#animator = animator;
    this.#broadcaster = broadcaster;
    this.#isAuthority = authorityFn;
  }

  save(name, camera) {
    const preset = {
      id: crypto.randomUUID(),
      name,
      camera: camera ?? this.#animator.getCurrentShared(),
      transition: { duration: 2000, curve: 1.42 },
      icon: '📍',
      hotkey: null,
      sortOrder: this.#presets.size,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.#presets.set(preset.id, preset);
    this.#syncPresets();
    return preset;
  }

  recall(presetId, { broadcast = true } = {}) {
    const preset = this.#presets.get(presetId);
    if (!preset) return;

    this.#animator.flyTo(preset.camera, preset.transition);

    if (broadcast && this.#isAuthority()) {
      this.#transport.send({
        type: MSG.CAMERA_FLY_TO,
        id: crypto.randomUUID(),
        sender: this.#broadcaster.windowId,
        seq: 0,
        ts: performance.timeOrigin + performance.now(),
        payload: {
          target: preset.camera,
          duration: preset.transition.duration,
          curve: preset.transition.curve,
          presetId: preset.id,
        },
      });
    }
  }

  update(presetId, changes) {
    const preset = this.#presets.get(presetId);
    if (!preset) return;
    Object.assign(preset, changes, { updatedAt: Date.now() });
    this.#syncPresets();
  }

  delete(presetId) {
    this.#presets.delete(presetId);
    this.#syncPresets();
  }

  list() {
    return [...this.#presets.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /** Hydrate from WELCOME message */
  loadFromState(presets) {
    this.#presets.clear();
    for (const p of presets) this.#presets.set(p.id, p);
  }

  /** Broadcast full preset list (infrequent — only on CRUD) */
  #syncPresets() {
    this.#transport.send({
      type: MSG.PRESET_SYNC,
      id: crypto.randomUUID(),
      sender: this.#broadcaster.windowId,
      seq: 0,
      ts: performance.timeOrigin + performance.now(),
      payload: { presets: [...this.#presets.values()] },
    });
  }

  /** Bind keyboard shortcuts: Shift+1..9 to recall */
  bindHotkeys() {
    document.addEventListener('keydown', (e) => {
      if (!e.shiftKey || e.ctrlKey || e.altKey) return;
      const num = parseInt(e.key);
      if (isNaN(num) || num < 1 || num > 9) return;

      const presets = this.list();
      if (num <= presets.length) {
        e.preventDefault();
        this.recall(presets[num - 1].id);
      }
    });
  }
}
```

Presets are serialized as part of the scene document and included in WELCOME payloads. Preset CRUD operations broadcast the full preset list via `PRESET_SYNC` — this is infrequent (only on create/update/delete) so full-state sync is simpler and more reliable than delta patching.

---

## 10. Page Lifecycle API integration for tab freeze and discard

Chrome 133+ (February 2025) aggressively freezes CPU-intensive background tabs hidden for more than 5 minutes under Energy Saver mode. **When frozen, all JavaScript execution stops** — timers, promises, event listeners, and BroadcastChannel message processing are suspended. Messages posted to a frozen window are queued but may be dropped if the tab is discarded.

**Critical finding: an open BroadcastChannel with registered listeners prevents bfcache eligibility in Chrome.** This means navigation away and back will trigger a full page reload rather than instant restore. The fix is to close the channel on `pagehide` and recreate on `pageshow`:

```javascript
// shared/sync/LifecycleManager.js
class SyncLifecycleManager {
  #syncEngine;
  #transportFactory;
  #wasFrozen = false;

  constructor(syncEngine, transportFactory) {
    this.#syncEngine = syncEngine;
    this.#transportFactory = transportFactory;
    this.#setup();
  }

  #setup() {
    // Primary cross-browser signal
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.#syncEngine.persistToSessionStorage();
        this.#syncEngine.reduceBroadcastRate();
      } else {
        this.#syncEngine.restoreBroadcastRate();
        this.#syncEngine.reannounce(); // may have missed messages
      }
    });

    // Chromium-only freeze/resume (use PageLifecycle.js polyfill)
    document.addEventListener('freeze', () => {
      this.#wasFrozen = true;
      sessionStorage.setItem('vtt-camera-state', JSON.stringify({
        camera: this.#syncEngine.getCanonicalCamera(),
        presets: this.#syncEngine.getPresets(),
        timestamp: Date.now(),
      }));
    });

    document.addEventListener('resume', () => {
      this.#wasFrozen = false;
      this.#syncEngine.reannounce();
      this.#syncEngine.requestFullState();
    });

    // bfcache-aware channel management
    window.addEventListener('pagehide', (e) => {
      if (e.persisted) {
        // Going into bfcache — close channel to allow caching
        this.#syncEngine.closeTransport();
      } else {
        this.#syncEngine.broadcastGoodbye();
      }
    });

    window.addEventListener('pageshow', (e) => {
      if (e.persisted) {
        // Restored from bfcache — recreate channel and resync
        this.#syncEngine.reconnectTransport();
        this.#syncEngine.reannounce();
      }
    });

    // Handle discarded tab reload
    if (document.wasDiscarded) {
      const saved = sessionStorage.getItem('vtt-camera-state');
      if (saved) {
        const { camera, timestamp } = JSON.parse(saved);
        if (Date.now() - timestamp < 300000) { // 5 min staleness limit
          this.#syncEngine.restoreFromSaved(camera);
        }
      }
    }
  }
}
```

**Cross-browser behavior summary:** Firefox does not implement `freeze`/`resume` events. Safari has no equivalent. The `visibilitychange` event is the universal signal across all browsers. Google's **PageLifecycle.js polyfill** (<1KB gzipped) normalizes lifecycle states using `visibilitychange`, `focus`/`blur`, and `pagehide`/`pageshow` as fallbacks. Always listen to `visibilitychange` as the primary signal and treat `freeze`/`resume` as Chromium enhancements.

**Testing:** Navigate to `chrome://discards` to manually freeze and discard tabs. This lets you verify the full freeze → resume → resync flow and the discard → reload → `document.wasDiscarded` recovery path.

---

## 11. Debugging and observability for multi-window sync

Chrome DevTools has **no dedicated BroadcastChannel inspector**. Debugging requires custom instrumentation. Three layers provide complete observability:

**Layer 1: Console debug wrapper** — wrap the transport with color-coded logging:

```javascript
function createDebugTransport(transport, label) {
  if (!localStorage.getItem('debug-sync')) return transport;

  const original = transport.send.bind(transport);
  transport.send = (msg) => {
    console.log(`%c[${label}] ⬆ ${msg.type}`, 'color:#4CAF50;font-weight:bold',
      msg.payload);
    original(msg);
  };

  const originalOnMsg = transport.onMessage.bind(transport);
  transport.onMessage = (handler) => {
    originalOnMsg((msg) => {
      console.log(`%c[${label}] ⬇ ${msg.type} from ${msg.sender.slice(0,6)}`,
        'color:#2196F3;font-weight:bold', msg.payload);
      handler(msg);
    });
  };

  return transport;
}
```

**Layer 2: Performance tracking** — use `performance.mark()`/`performance.measure()` for latency metrics visible in DevTools Performance panel:

```javascript
class SyncLatencyTracker {
  #measures = [];

  trackSend(msgId) {
    performance.mark(`sync:send:${msgId}`);
  }

  trackReceive(msgId, senderTimestamp) {
    performance.mark(`sync:recv:${msgId}`);
    // Cross-window latency (requires absolute timestamps)
    const latency = (performance.timeOrigin + performance.now()) - senderTimestamp;
    this.#measures.push(latency);
    if (this.#measures.length > 300) this.#measures.shift();
  }

  getStats() {
    if (!this.#measures.length) return null;
    const sorted = [...this.#measures].sort((a, b) => a - b);
    return {
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: sorted[sorted.length - 1],
    };
  }
}
```

**Layer 3: Visual debug overlay** — toggled via `localStorage.setItem('debug-sync', 'true')`:

```javascript
class SyncDebugOverlay {
  #el;
  #engine;
  #timer;

  constructor(syncEngine) {
    this.#engine = syncEngine;
    if (localStorage.getItem('debug-sync') !== 'true') return;

    this.#el = document.createElement('div');
    Object.assign(this.#el.style, {
      position: 'fixed', top: '8px', right: '8px', zIndex: '99999',
      background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '12px',
      borderRadius: '8px', fontFamily: 'monospace', fontSize: '11px',
      minWidth: '220px', pointerEvents: 'none',
    });
    document.body.appendChild(this.#el);
    this.#timer = setInterval(() => this.#render(), 250);
  }

  #render() {
    const s = this.#engine.getDebugState();
    const statusColors = {
      connected: '#4CAF50', syncing: '#FFC107',
      frozen: '#9E9E9E', disconnected: '#F44336',
    };
    this.#el.innerHTML = `
      <div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;
        background:${statusColors[s.status] ?? '#fff'};margin-right:6px"></span>
        <b>${s.role}</b> | ${s.status}</div>
      <div>Peers: ${s.peerCount} | Authority: ${s.isAuthority ? '✓' : '—'}</div>
      <div>Camera: ${s.camera?.centerX?.toFixed(0)}, ${s.camera?.centerY?.toFixed(0)}
        z:${s.camera?.zoom?.toFixed(2)}</div>
      <div>Msgs/s: ↑${s.sentRate} ↓${s.recvRate}</div>
      ${s.latency ? `<div>Latency: ${s.latency.median?.toFixed(1)}ms
        (p95: ${s.latency.p95?.toFixed(1)}ms)</div>` : ''}
      <div style="font-size:9px;opacity:0.6">${document.visibilityState}
        | seq:${s.seq}</div>`;
  }

  destroy() {
    clearInterval(this.#timer);
    this.#el?.remove();
  }
}
```

---

## 12. Complete protocol message catalog

The full message protocol extends `shared/protocol.js` with factory functions and validation, matching the existing codebase patterns:

```javascript
// shared/protocol.js — Phase 4 additions
const MSG = Object.freeze({
  // Phase 4: Camera sync
  CAMERA_STATE:      'CAMERA_STATE',       // continuous 30fps state stream
  CAMERA_FLY_TO:     'CAMERA_FLY_TO',      // animated transition target
  CAMERA_JUMP_TO:    'CAMERA_JUMP_TO',     // instant teleport

  // Phase 4: Lifecycle
  ANNOUNCE:          'ANNOUNCE',
  WELCOME:           'WELCOME',
  HEARTBEAT:         'HEARTBEAT',
  GOODBYE:           'GOODBYE',

  // Phase 4: Authority
  AUTHORITY_CLAIM:   'AUTHORITY_CLAIM',
  AUTHORITY_RELEASE: 'AUTHORITY_RELEASE',

  // Phase 4: Presets
  PRESET_SYNC:       'PRESET_SYNC',
});

function validateSyncMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (typeof msg.type !== 'string') return false;
  if (typeof msg.sender !== 'string') return false;
  if (typeof msg.id !== 'string') return false;
  return true;
}

function validateCameraState(payload) {
  return payload
    && typeof payload.centerX === 'number' && isFinite(payload.centerX)
    && typeof payload.centerY === 'number' && isFinite(payload.centerY)
    && typeof payload.zoom === 'number' && payload.zoom > 0 && isFinite(payload.zoom);
}
```

**The hybrid protocol pattern:** continuous `CAMERA_STATE` for real-time DM panning at **30 fps**, single-shot `CAMERA_FLY_TO` for animated preset recalls (each window animates independently at 60 fps), and `CAMERA_JUMP_TO` for instant teleports. This trio handles all camera synchronization scenarios with minimal bandwidth while maximizing animation smoothness.

---

## Conclusion

Phase 4's architecture rests on five load-bearing decisions that emerged from this research. **First**, the center-point camera model (`{centerX, centerY, zoom}`) is the mathematically correct representation for cross-viewport sharing — all major mapping libraries converge on this for good reason. **Second**, the strict unidirectional flow rule (never re-broadcast received state, share unclamped canonical state, apply constraints locally) eliminates clamping ping-pong without complex distributed consensus. **Third**, the hybrid broadcast protocol (continuous state stream for interactive control, target messages for animated transitions) optimally balances bandwidth against animation quality. **Fourth**, the transport-agnostic `ISyncTransport` interface means the WebSocket migration in Phase 5 becomes a transport swap rather than a protocol rewrite. **Fifth**, the bfcache-aware channel lifecycle (close on `pagehide`, recreate on `pageshow`) prevents the subtle performance regression that has bitten Supabase, Nuxt, and others who hold BroadcastChannel references across navigations.

The flyTo implementation based on van Wijk & Nuij's hyperbolic metric space geodesic — feeding waypoints into Phase 3's critically-damped spring as a moving target — provides cinematic camera transitions that remain interruptible at any point. The **ρ = 1.42** parameter from user studies produces the optimal zoom-out-then-in curve that makes spatial transitions legible. Combined with the preset system's `Shift+1..9` hotkeys and the authority model's deterministic election, the DM gains a production-grade camera control system that scales from local multi-window BroadcastChannel to future multi-device WebSocket with zero protocol changes.