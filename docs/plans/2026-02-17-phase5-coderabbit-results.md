# Phase 5 (Cinematic Camera) CodeRabbit Review Results

**Date:** 2026-02-17
**Scope:** 49 commits (`e563597..cd64673`), 45 files, +4906 / -319 lines
**Reviewers:** 5 parallel CodeRabbit batch agents + full-scope CLI review + cross-cutting synthesis

## Summary

| Category | Count | Fixed |
|----------|-------|-------|
| **Blocking** | 0 | — |
| **Advisory (High)** | 11 | **11** |
| **Advisory** | 23 | **6** (A-1, A-13, A-14, A-15, A-16, A-23) |
| **Low** | 15 | **1** (L-1 debug-transport return value) |
| **Info** | ~20 | — |
| **Total findings** | ~69 | **18 fixed** |

**Verdict: Phase 5 is solid with no blocking bugs.** Zero critical issues across all six review domains (protocol, camera math, feature modules, sync engine, integration/bootstrap, cross-cutting CLI). The van Wijk & Nuij flyTo path, exponential decay interpolator, authority election, and preset sync are all architecturally sound. The 11 Advisory (High) items split into 7 production code defensive gaps (spread-override footgun, division-by-zero, missing guards, stale state) and 4 test quality issues (silent timeout, incomplete assertions, vacuous waits). None cause incorrect behavior in the current call sites, but several could manifest from malformed BroadcastChannel messages or future API misuse.

---

## Review Methodology

Six review passes:

| Batch | Domain | Files | Lines | Agent |
|-------|--------|-------|-------|-------|
| 1 | Protocol & Transport | 7 | 676 | `coderabbit:code-reviewer` |
| 2 | Core Camera Math | 8 | 1,037 | `coderabbit:code-reviewer` |
| 3 | Camera Features | 10 | 1,408 | `coderabbit:code-reviewer` |
| 4 | Sync Engine | 5 | 1,917 | `coderabbit:code-reviewer` |
| 5 | Integration & Bootstrap | 5 | 1,245 | `coderabbit:code-reviewer` |
| 6 | Full Diff (CLI) | 45 | 4,906 | `coderabbit review --plain --base pre-phase5-baseline` |

Batches 1-5 ran in parallel. Batch 6 ran sequentially to catch cross-cutting issues. All findings de-duplicated in triage.

---

## Advisory Issues (High Priority)

### AH-1: `createCameraFlyToMsg` spread can override `senderId`/`seq`; `target` implicit
- **File:** `shared/protocol.js:174-180`
- **Batches:** B1, CLI
- **Issue:** The factory spreads `...payload` *after* `senderId`, `seq`, and `ts`, so a caller's payload containing those keys would silently overwrite explicit parameters. Additionally, the `target` field (required by validation at line 100) is not an explicit parameter — it relies on being present in `payload`. This is inconsistent with all other factories that explicitly name required fields.
- **Impact:** Safe today (sole call site at `camera-sync.js:145` passes `{ target, duration, rho, speed, presetId }`), but a footgun for future callers.
- **Fix:** Either reorder spread to `{ ...payload, senderId, seq, ts }` so trusted fields win, or make `target` an explicit parameter: `createCameraFlyToMsg(senderId, seq, target, payload = {})`.

### AH-2: `CAMERA_FLY_TO` required fields missing `seq`
- **File:** `shared/protocol.js:100`
- **Batch:** B1
- **Issue:** `REQUIRED_FIELDS[MSG.CAMERA_FLY_TO]` is `['target', 'senderId']` but `CameraReceiver._handleFlyTo()` at `camera-sync.js:292` does `if (msg.seq <= this._lastFlyToSeq) return`. If `seq` is missing, `msg.seq` is `undefined`, and `undefined <= 0` is `false` in JS — message passes the dedup guard. Then `_lastFlyToSeq` is set to `undefined`, and *all* subsequent flyTo messages also pass (`msg.seq <= undefined` is always `false`), permanently breaking deduplication.
- **Impact:** A single malformed message with missing `seq` would break flyTo dedup for the session.
- **Fix:** Add `'seq'` to required fields: `[MSG.CAMERA_FLY_TO]: ['target', 'senderId', 'seq']`.

### AH-3: Division-by-zero in `computeFlyToPath` with `zoom ≤ 0`
- **File:** `vtt/js/fly-to.js:34-35`
- **Batches:** B2, CLI
- **Issue:** `w0 = screenW / start.zoom` and `w1 = screenW / end.zoom` produce `Infinity` if zoom is 0, propagating `NaN` through the hyperbolic path math. `computeFlyToPath` is a public pure function with no input validation.
- **Impact:** Camera system clamps zoom to positive values before reaching this function, but no defensive guard exists.
- **Fix:** Guard at top: `if (start.zoom <= 0 || end.zoom <= 0) return { duration: 0, at: () => ({ ...end }) };`

### AH-4: Interpolator `_hasTarget` never reset — stale `_current` on re-entry
- **File:** `vtt/js/camera-interpolator.js:99-104`
- **Batch:** B2
- **Issue:** When interpolation converges, `_stopLoop()` is called but `_hasTarget` stays `true`. If the camera is externally moved (by animator or user drag) while `_hasTarget` is true, the next `setTarget()` finds `_isRunning === false` and starts the loop, but `_current` is stale (from last convergence). The interpolator lerps from stale `_current` to new `_target`, causing a visual pop.
- **Fix:** In `setTarget()`, always sync `_current` from the live camera before starting: `this._current = { x: this._camera.x, y: this._camera.y, zoom: this._camera.zoom };`

### AH-5: `importAll([])` silently wipes all presets
- **File:** `vtt/js/camera-presets.js:177-184`
- **Batch:** B3
- **Issue:** `importAll([])` clears the entire `_presets` Map and persists an empty array to localStorage. No guard against empty arrays or non-array inputs. A corrupted `PRESET_SYNC` message with `presets: []` would destroy all saved presets. `importAll(null)` would throw TypeError on `for (const p of presets)`.
- **Fix:** `if (!Array.isArray(presets) || presets.length === 0) return;` and validate each preset has an `id` field.

### AH-6: `authority-election.js` `destroy()` doesn't remove transport message handler
- **File:** `vtt/js/authority-election.js:98-104`
- **Batches:** B3, CLI
- **Issue:** Constructor registers `this._boundHandleMessage` via `this._transport.onMessage()` (line 27), but `destroy()` only removes EventBus listeners — never calls a transport unsubscribe. If the transport outlives the election, `_handleMessage` fires on stale state.
- **Fix:** Add `this._transport.offMessage(this._boundHandleMessage)` in `destroy()`. Requires ISyncTransport to expose `offMessage()` (or use the return value from `onMessage()` as an unsubscribe function).

### AH-7: Mutable `_msgTemplate` reused across frames
- **File:** `vtt/js/camera-sync.js:90-98, 198-203`
- **Batch:** B4
- **Issue:** The pre-allocated `_msgTemplate` is mutated in-place at 30fps and passed directly to `transport.send()`. BroadcastChannel's `postMessage` creates a structured clone (safe for cross-window), but any in-process consumer (debug hook, transport interceptor, test capture) that holds a reference would see fields overwritten on the next tick.
- **Impact:** Safe today. Fragile for future in-process observers.
- **Fix:** `this._transport.send({ ...this._msgTemplate });` — one shallow spread per frame, negligible cost.

### AH-8: No `validateMessage()` on receive path
- **File:** `vtt/js/camera-sync.js:599-621`
- **Batches:** B4, CLI
- **Issue:** `_handleMessage(msg)` has a null/type guard but doesn't call `validateMessage()`. A malformed `CAMERA_SYNC` missing `centerX` would flow into `_handleSync`, produce `NaN` via `sharedToLocal()`, and propagate into the camera.
- **Fix:** Add `const { valid } = validateMessage(msg); if (!valid) return;` at entry.

### AH-9: `_persistToSessionStorage` missing `viewportReady` check
- **File:** `vtt/js/camera-sync.js:709-726`
- **Batches:** B4, CLI
- **Issue:** `localToShared(cam, vp)` is called without checking `viewportReady(vp)`. If viewport is `{width: 0, height: 0}` during page teardown, `centerX` equals `cam.x` (top-left, not center) — corrupt data persisted and applied on next restore.
- **Fix:** Add `if (!viewportReady(vp)) return;` after `const vp = cameraViewport(cam);`.

### AH-10: `injectAnimationWaitHelper` silently resolves on timeout
- **File:** `tests/helpers.js:184-198`
- **Batches:** B5, CLI
- **Issue:** `__waitForAnimComplete()` resolves silently after 3s if `camera:animation-complete` never fires. Tests pass vacuously if animation is broken. Contradicts MEMORY.md "vacuous pass danger" lesson.
- **Fix:** At minimum add `console.warn('[test] animation timed out')` on timeout path. Ideally reject with descriptive error for strict tests.

### AH-11: Authority gating test incomplete — never exercises flyTo
- **File:** `tests/phase5-integration.spec.js:232-248`
- **Batches:** B5, CLI
- **Issue:** Test titled "authority gating prevents non-authority from broadcasting flyTo" only asserts one Controller is non-authority. Never attempts flyTo from non-authority, never verifies Display camera unchanged. The comment mentions clicking "Frame Tokens" but no action is performed. `before` camera state is captured (line 238) but never compared.
- **Fix:** Complete the test: have non-authority attempt flyTo (via UI click or direct call), verify Display position unchanged.

---

## Advisory Issues

### A-1: `msg()` helper allows payload to override `type`
- **File:** `shared/protocol.js:107-110`
- **Batch:** B1
- **Issue:** `{ type, ...payload, _v }` — payload spread after `type` can override it. Root cause of AH-1 footgun.
- **Fix:** Reorder to `{ ...payload, type, _v: PROTOCOL_VERSION }` — fixes AH-1 and this issue simultaneously.

### A-2: `localToShared`/`sharedToLocal` division by `zoom=0`
- **File:** `shared/protocol.js:193-207`
- **Batch:** B1
- **Issue:** Public utility functions with no guard against `zoom=0`. Camera system clamps zoom elsewhere, but these are shared functions.
- **Fix:** Guard or assert at function entry.

### A-3: `createEffectMsg` spread can add arbitrary fields
- **File:** `shared/protocol.js:152`
- **Batch:** B1
- **Issue:** `...target` could override `effectId` or `type`. Pre-Phase-5 pattern.
- **Fix:** Destructure only expected fields: `const { col, row } = target || {};`

### A-4: `validateMessage` doesn't check for `_v` presence
- **File:** `shared/protocol.js:222-225`
- **Batch:** B1
- **Issue:** Missing `_v` passes silently. Intentional forward-compatibility, but hand-crafted messages are indistinguishable from valid ones.

### A-5: `updateViewport` mid-flight uses new viewport for conversion
- **File:** `vtt/js/camera-animator.js:32-34, 147-151`
- **Batch:** B2
- **Issue:** FlyTo path computed with old viewport but rendered with new after resize. VTT locked to 1920x1080, so rarely manifests.

### A-6: Convergence epsilon for zoom may be too coarse
- **File:** `vtt/js/camera-interpolator.js:15`
- **Batch:** B2
- **Issue:** `CONVERGENCE_EPSILON = 0.01` for all axes. At low zoom (0.5), 0.01 = 2% visible area change.

### A-7: Missing `destroy()` mid-animation tests for animator and interpolator
- **Files:** `tests/fly-to-animator.spec.js`, `tests/camera-interpolator.spec.js`
- **Batch:** B2
- **Issue:** `destroy()` called in cleanup but never tested for mid-run behavior (rAF leak, camera stops moving).

### A-8: `_loadFromStorage` no validation of parsed JSON shape
- **File:** `vtt/js/camera-presets.js:216-227`
- **Batch:** B3
- **Issue:** Parsed objects set as presets without checking `id`, `camera`, or `mapId` fields. Corrupt localStorage could propagate.

### A-9: `update()` Object.assign allows internal property override
- **File:** `vtt/js/camera-presets.js:107, 115`
- **Batch:** B3
- **Issue:** Caller can overwrite `id`, `mapId`, `createdAt` via `changes` parameter.
- **Fix:** Whitelist mutable fields.

### A-10: Semantic zoom accesses private `_coverZoom`
- **File:** `vtt/js/semantic-zoom.js:23`
- **Batch:** B3
- **Issue:** Tight coupling to camera internals. If `_coverZoom` is renamed, semantic zoom silently breaks.

### A-11: Authority election missing peer registration on claim
- **File:** `vtt/js/authority-election.js:77-96`
- **Batch:** CLI
- **Issue:** AUTHORITY_CLAIM from unknown peer doesn't add them to `_controllerPeers`. If claim arrives before peer-join event, subsequent `elect()` excludes this peer.

### A-12: WELCOME debounce window may be too narrow
- **File:** `vtt/js/camera-sync.js:34, 641-669`
- **Batch:** B4
- **Issue:** 150ms debounce. Late WELCOME after timer fires and `_bestWelcome` cleared causes double-apply.

### A-13: Interpolator `_current` stalls after WELCOME apply
- **File:** `vtt/js/camera-sync.js:336-338`
- **Batch:** B4
- **Issue:** `applyWelcomeState()` jumps camera directly but doesn't update interpolator's `_current`. Next CAMERA_SYNC causes lerp from stale position — visible snap-back for one cycle.
- **Fix:** Call `interpolator.setTarget(local); interpolator.snapToTarget();` after WELCOME apply.

### A-14: Lifecycle handlers access `_transport` without null guards
- **File:** `vtt/js/camera-sync.js:686-707`
- **Batches:** B4, CLI
- **Issue:** `_onPageHide` calls `_transport.disconnect()`, `_onPageShow` reads `_transport.connected` — no null checks. Could throw if `destroy()` ran earlier.

### A-15: `_reconnect` missing `_transport` null check
- **File:** `vtt/js/camera-sync.js:755-761`
- **Batch:** CLI

### A-16: `opts.gridSize` overrides explicit `cellPx` in `flyToTokens`
- **File:** `vtt/js/fit-to-tokens.js:101`
- **Batch:** CLI
- **Issue:** `{ gridSize: cellPx, ...opts }` — opts spread comes last, so `opts.gridSize` wins over `cellPx`.
- **Fix:** Swap to `{ ...opts, gridSize: cellPx }`.

### A-17: Comment mentions keyboard interruption but no keydown listener
- **File:** `vtt/js/main.js:139-144`
- **Batch:** CLI
- **Issue:** Comment says "wheel, mouse, keyboard" interruption but only wheel and mousedown registered.

### A-18: No null check for `ctrl.flyToAnimator` before `flyToTokens`
- **File:** `controller/js/ui-builders.js:229-252`
- **Batch:** CLI

### A-19: Dynamic import lacks `.catch()` error handling
- **File:** `controller/js/ui-builders.js:486-491`
- **Batch:** CLI
- **Issue:** `import('../../vtt/js/state.js').then(...)` — unhandled rejection if module fails to load.

### A-20: Silent skip if no presets exist in integration test
- **File:** `tests/phase5-integration.spec.js:102-107`
- **Batch:** CLI
- **Issue:** `if (presets.length > 0)` guard silently skips recall — test passes vacuously.
- **Fix:** `if (presets.length === 0) throw new Error('Expected at least one preset');`

### A-21: Hardcoded sleep for election convergence
- **File:** `tests/phase5-integration.spec.js:229-230`
- **Batch:** CLI
- **Issue:** `await new Promise(r => setTimeout(r, 500))` — classic flaky pattern per MEMORY.md.

### A-22: Missing null check on `window.__vtt` in helper
- **File:** `tests/helpers.js:149-152`
- **Batch:** CLI
- **Issue:** Direct access to `window.__vtt.EventBus` without guard (unlike `enterMapMode` which checks).

### A-23: `_handlePresetSync` doesn't validate `msg.presets` before `importAll`
- **File:** `vtt/js/camera-sync.js:306-310`
- **Batch:** B4
- **Issue:** Non-array `msg.presets` passed to `importAll` could crash.
- **Fix:** `if (this._presetManager && Array.isArray(msg.presets)) { ... }`

---

## Low Priority Issues

### L-1: `debug-transport.js` discards return values from `originalSend` and `originalOnMessage`
- **File:** `shared/sync/debug-transport.js:19-26, 29-39`
- **Batch:** CLI

### L-2: Debug overlay renders "undefinedms" when `median`/`p95` missing
- **File:** `shared/sync/debug-overlay.js:50-52`
- **Batch:** CLI

### L-3: Debug overlay `document.body` could be null before DOM parse
- **File:** `shared/sync/debug-overlay.js:32`
- **Batch:** CLI

### L-4: Orphan overlay missing `pointer-events: auto` in visible state
- **File:** `vtt/css/orphan-overlay.css:3-14`
- **Batch:** CLI

### L-5: Test name/code mismatch: "1.2x" vs `1.25` multiplier
- **File:** `tests/semantic-zoom.spec.js:34-45`
- **Batch:** CLI

### L-6: Test name/code mismatch: "1.8x" vs `1.85` multiplier
- **File:** `tests/semantic-zoom.spec.js:47-58`
- **Batch:** CLI

### L-7: Type inconsistency: hotkey saved as `'1'` (string), recalled with `1` (number)
- **File:** `tests/camera-presets.spec.js:140-145`
- **Batch:** CLI

### L-8: Unused variable `interpRunning` — missing assertion or dead code
- **File:** `tests/interpolation-sync.spec.js:90-94`
- **Batch:** CLI

### L-9: `isAnimating` checked after `destroy()` — unreliable
- **File:** `tests/fly-to-animator.spec.js:82-89`
- **Batch:** CLI

### L-10: `waitForFunction` condition is no-op (always true after boot)
- **File:** `tests/authority-election.spec.js:44-54`
- **Batch:** CLI

### L-11: Dynamic import inside `waitForFunction` may be unreliable
- **File:** `tests/fit-to-tokens-e2e.spec.js:40-43`
- **Batch:** CLI

### L-12: Frame-mode select missing `aria-label`
- **File:** `controller/index.html:601-608`
- **Batch:** CLI

### L-13: Phase 4 results doc cross-reference "(A-8 scope)" may be incorrect
- **File:** `docs/plans/2026-02-15-phase4-coderabbit-results.md:159`
- **Batch:** CLI

### L-14: Magic number duplication (`rho: 1.42`, `speed: 1.2`) across modules
- **Files:** `vtt/js/camera-animator.js:73-74`, `vtt/js/fly-to.js:10-11`
- **Batch:** B2

### L-15: `cosh`/`sinh`/`tanh` reimplemented instead of using `Math.cosh`/`Math.sinh`/`Math.tanh`
- **File:** `vtt/js/fly-to.js:6-8`
- **Batch:** B2

---

## False Positives

### FP-1: `_msgTemplate` mutation before `postMessage`
- **File:** `vtt/js/camera-sync.js:198-203`
- **Rationale:** BroadcastChannel's `postMessage()` creates a structured clone synchronously. Subsequent mutations cannot affect delivered messages. The in-process observer concern (AH-7) is a separate advisory about future-proofing, not a current bug.

### FP-2: Sequence number rollover at `MAX_SAFE_INTEGER`
- **File:** `vtt/js/camera-sync.js:80, 145, 157, 201`
- **Rationale:** At 30fps continuous send, overflow takes ~10 million years. Not a practical concern.

### FP-3: Both Controllers briefly claim authority on simultaneous boot
- **File:** `vtt/js/authority-election.js`
- **Rationale:** Inherent to bully algorithm. AUTHORITY_CLAIM exchange resolves within one heartbeat cycle. Noted for documentation, not a bug.

### FP-4: `election.elect()` called before peers discovered — always wins initially
- **File:** `controller/js/main.js:55`
- **Rationale:** Intended behavior. Peer-join events trigger re-election. Correct steady-state convergence.

---

## Phase 4 Carry-Forward Status

| ID | Phase 4 Issue | Phase 5 Status |
|----|---------------|----------------|
| CF-1 | `sendNow()` / `sendImmediate()` needs test coverage | **Still untested** — no new tests added |
| CF-2 | Null guard on `_channel` in `_sendState()` | **Resolved** — Phase 5 refactored to transport abstraction (no direct `_channel`) |
| CF-3 | Cross-window tests need `afterEach` cleanup | **Still present** — tests create contexts without try/finally |
| CF-4 | Replace `waitForTimeout(200)` with condition-based waits | **Partially resolved** — some waits replaced, 2 remain |
| CF-5 | Viewport-independence E2E test | **Still missing** |
| CF-6 | NaN guard in receiver | **FIXED** — validateMessage() on receive path (AH-8) |
| CF-7 | Add `_v` to `_msgTemplate` | **Resolved** (line 97 now includes `_v`) |
| CF-8 | Mark superseded camera messages `@deprecated` | **Still open** |
| CF-9 | Remove unused imports | **Partially resolved** — `validateMessage` import removed, `createCameraSyncMsg` still unused |

---

## Phase 6 Carry-Forward Items

### From Phase 5 Review

| ID | Issue | Priority | Source |
|----|-------|----------|--------|
| CF5-1 | Fix `msg()` spread order to prevent `type` override | High | AH-1, A-1 | **FIXED** (Batch 1) |
| CF5-2 | Add `seq` to `CAMERA_FLY_TO` required fields | High | AH-2 | **FIXED** (Batch 1) |
| CF5-3 | Guard `computeFlyToPath` against zoom ≤ 0 | High | AH-3 | **FIXED** (Batch 1) |
| CF5-4 | Sync interpolator `_current` from live camera in `setTarget()` | High | AH-4 | **FIXED** (Batch 2) |
| CF5-5 | Guard `importAll()` against empty/invalid input | High | AH-5 | **FIXED** (Batch 3) |
| CF5-6 | Clean up transport handler in `election.destroy()` | High | AH-6 | **FIXED** (Batch 3) |
| CF5-7 | Add `viewportReady` check before `_persistToSessionStorage` | High | AH-9 | **FIXED** (Batch 4) |
| CF5-8 | Add `validateMessage()` on receive path or NaN guards | High | AH-8 | **FIXED** (Batch 4) |
| CF5-9 | Make `__waitForAnimComplete` reject (or warn) on timeout | Medium | AH-10 | **FIXED** (Batch 5) |
| CF5-10 | Complete authority gating test | Medium | AH-11 | **FIXED** (Batch 5) |
| CF5-11 | Sync interpolator `_current` after WELCOME apply | Medium | A-13 | **FIXED** (Batch 2) |
| CF5-12 | Fix `opts` spread order in `flyToTokens` | Medium | A-16 | **FIXED** (Batch 2) |
| CF5-13 | `sendNow()` / `sendImmediate()` test coverage (carried from P4) | Medium | CF-1 | Carry-forward |
| CF5-14 | Cross-window test `afterEach` cleanup (carried from P4) | Medium | CF-3 | Carry-forward |
| CF5-15 | Viewport-independence E2E test (carried from P4) | Medium | CF-5 | Carry-forward |

### From Phase 4 Lessons (Pre-Existing)

| Item | Status |
|------|--------|
| Expose `sendNow()` public API | **DONE** (commit `e563597`) |
| Cover zoom gap 0.664–1.0 | Not addressed in Phase 5 |
| "Fit to Display viewport" needs real dimensions | Not addressed — needs VIEWPORT_QUERY protocol |
| WELCOME handshake timing fallback | Partially addressed — debounce pattern works but has edge cases (A-12) |
| `panBy()` viewportScale (Phase 2 A-7) | Still deferred |

---

## Test Coverage Matrix

| Feature | Unit | Integration | E2E | Gap? |
|---------|:----:|:-----------:|:---:|------|
| Easing functions (4 curves) | 8 | — | — | Out-of-range inputs untested |
| computeFlyToPath (van Wijk & Nuij) | 9 | — | — | — (zoom=0 guard added) |
| FlyToAnimator lifecycle | 8 | — | — | `destroy()` mid-flight untested |
| FlyToAnimator reduced-motion | 1 | — | — | — |
| CameraInterpolator convergence | 5 | — | — | `destroy()` mid-run untested |
| CameraInterpolator frame-rate independence | 2 | — | — | — |
| CameraPresetManager CRUD | 11 | — | — | — (`importAll` edge cases added) |
| CameraPresetManager hotkeys | 3 | — | — | — |
| CameraPresetManager persistence | 2 | — | — | No `afterEach` localStorage cleanup |
| computeFitToTokens (pure) | 5 | — | — | — |
| flyToTokens (orchestration) | — | — | 3 | — |
| SemanticZoomController | 7 | — | — | Hysteresis band not tested in integration |
| AuthorityElection convergence | 3 | — | — | `setTimeout` flaky wait, no-op `waitForFunction` |
| AuthorityElection cleanup | — | — | — | — (transport unsubscribe added) |
| CameraBroadcaster 30fps + epsilon | 4 | — | — | — |
| CameraBroadcaster suppressBroadcast | 1 | — | — | — |
| CameraReceiver flyTo sync | — | 2 | — | — |
| CameraReceiver preset sync | — | 4 | — | — |
| CameraReceiver interpolation sync | — | 2 | — | — |
| WindowRegistry lifecycle | 4 | — | — | — |
| CameraSyncEngine role wiring | 5 | — | — | — |
| Cross-window flyTo | — | — | 1 | — |
| Cross-window preset sync | — | — | 1 | — |
| Authority gating | — | — | 1 | — (test completed, verifies no flyTo sent) |
| Semantic zoom integration | — | — | 1 | No hysteresis test |
| Orphan overlay | — | — | 1 | Hardcoded 3s coupling |
| Camera clamping (full suite) | 15 | — | 2 | — |
| `sendNow()` / `sendImmediate()` | — | — | — | **No test** (carried from P4) |
| `_persistToSessionStorage` guard | — | — | — | **No test** |

---

## Architectural Notes (Informational)

### Transport Abstraction Is Clean
The `ISyncTransport` → `BroadcastChannelTransport` abstraction separates concerns well. Adding a WebSocket transport for remote DM would only require implementing the interface. The sync engine is fully transport-agnostic.

### Three-Level Broadcast Suppression
The `_isBroadcastSuppressed()` OR of animator, interpolator, and receiver flags is trivially correct — multiple concurrent `true` values just mean "extra suppressed." The flags cannot stick due to try/finally and convergence cleanup. No race conditions.

### 30fps→60fps Interpolation Pipeline
Broadcaster rate-limits at 33ms (~30fps) with epsilon filtering. Interpolator smooths to 60fps via exponential decay (50ms half-life). The `MAX_DT` cap (100ms) prevents snap after tab background. Well-tuned bandwidth/smoothness tradeoff.

### Van Wijk & Nuij "Zoom Out Then In" Behavior
The flyTo path correctly implements the optimal smooth camera transition — zooming out at midpoint to reveal context, then back in at destination. Tested explicitly for the same-zoom pan case.

### Authority Election String Comparison
`allIds.sort()` uses lexicographic sort on `crypto.randomUUID()` strings — deterministic and safe for fixed-format UUIDs. Would break with variable-length numeric IDs.

### Controller Camera Before WELCOME
Controller's rAF loop starts immediately with hardcoded 1920x1080 viewport. If button pressed before WELCOME handshake provides map dimensions, Display receives camera state without map constraints. Mitigated: rAF throttled in background tabs, `sendNow()` only fires on explicit presses.

---

## Baseline Verification

```
953 passed (12.1m)
3 flaky (pre-existing: easing midpoint, 2x semantic zoom integration)
12 skipped
0 failures
```

All tests pass. Review was read-only — no code changes made.
