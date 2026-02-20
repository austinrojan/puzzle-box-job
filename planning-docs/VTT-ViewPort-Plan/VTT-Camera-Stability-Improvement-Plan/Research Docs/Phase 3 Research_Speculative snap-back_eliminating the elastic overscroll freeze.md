# Speculative snap-back: eliminating the elastic overscroll freeze

The 1–2 second freeze before elastic snap-back occurs because the system waits for formal momentum detection — a fundamentally flawed sequencing decision. **Speculative execution resolves this entirely**: start the snap-back animation immediately when movement stalls, cancel if wrong. The misprediction penalty is a few invisible wasted frames; the waiting penalty is a perceptible freeze that breaks the action-reaction link. This report covers every technical component needed to implement Phase S3, from the EWMA math that detects stalls to the state machine that prevents race conditions.

The architecture has four layers: an EWMA-based stall detector running at 60Hz, a speculative snap-back launcher, a formal momentum classifier with tightened timeouts (safe because speculation handles false positives), and a state machine coordinating all concurrent animations. Each layer is detailed below with formulas, constants, and code patterns drawn from iOS UIScrollView reverse-engineering, production animation libraries (GSAP, Framer Motion, React Spring), and signal processing literature.

---

## EWMA stall detection at 60Hz: the math and the constants

The Exponentially Weighted Moving Average (Roberts, 1959) is the core signal that triggers speculative snap-back. The recursive formula is **S_t = α · x_t + (1 − α) · S_{t-1}**, where x_t is the per-frame speed (absolute delta of elastic offset) and α controls responsiveness. The effective memory window equals **N = 2/α − 1** samples, meaning α = 0.2 remembers ~9 frames (~150ms at 60Hz) and α = 0.3 remembers ~5.7 frames (~95ms). The half-life — frames for a weight to decay 50% — is ln(0.5)/ln(1−α), giving **3.1 frames (52ms) at α = 0.2** and **1.94 frames (32ms) at α = 0.3**.

The implementation feeds screen-space speed into the EWMA each frame. When `smoothedSpeed` drops below a threshold (0.5 screen pixels/frame), the system declares a stall. The critical question is detection latency: starting from a typical speed of 5 px/frame, how many zero-speed frames until EWMA crosses the 0.5 threshold? The decay follows V · (1−α)^n, so n = ln(T/V) / ln(1−α). For **α = 0.3, this is ~6.5 frames (108ms)**; for **α = 0.2, it is ~10.3 frames (172ms)**. The 0.2–0.3 range thus detects stalls within 100–170ms — below the ~200ms perceptual threshold for noticing a freeze, and well within Google's RAIL model 100ms response budget when combined with speculative launch.

EWMA outperforms raw threshold checking because it acts as a low-pass filter requiring temporal consensus. A single slow frame contributes only α (20–30%) to the smoothed value, preventing false positives from timing jitter or interpolation pauses. It also outperforms CUSUM for this application: Lucas and Saccucci (1990) showed EWMA detects a 1σ shift in 10.9 observations versus Shewhart's 54.6, and unlike CUSUM, EWMA doesn't require a pre-specified reference shift size.

**Initialization matters critically.** Starting the EWMA at zero would trigger immediate false stall detection (speed = 0 on the first frame before movement begins). Initialize at a high value like 10 px/frame. With α = 0.3, this requires ~8.4 frames (140ms) of sustained zero-speed before triggering — an effective warm-up that prevents premature detection. This is the inverse of Roberts' "Fast Initial Response" technique: instead of starting closer to the alarm boundary, start far from it.

The threshold must be in **screen pixels, not world pixels**. In a zoomable VTT canvas, screenDelta = worldDelta × zoomLevel. At 10× zoom, 0.5 world pixels produces 5 screen pixels of movement — clearly not a stall. At 0.1× zoom, 0.5 world pixels produces 0.05 screen pixels — invisible, definitely a stall. Computing speed as |screenPosition_t − screenPosition_{t-1}| gives perceptually correct behavior that naturally adapts to zoom level without threshold adjustments.

## The speculative execution pattern: respond before certainty

Apple's WWDC 2018 "Designing Fluid Interfaces" session crystallized the principle: **"Look for delays everywhere. Everything needs to respond instantly."** Their iPhone X multitasking gesture doesn't wait for velocity to drop below a threshold for "a few amount of time" — that's too slow. Instead, it detects the acceleration spike when your finger pauses. "The faster you stop, the faster we can detect it." This is speculative: responding to an acceleration signature before confirming intent.

The CPU branch prediction analogy is precise. Speculative execution starts work before knowing if a branch is taken; if wrong, it rolls back with a small pipeline flush penalty. In animation, the equivalent is starting snap-back before confirming the gesture ended. If wrong (user resumes scrolling), cancel the animation — the "mispredict penalty" is 1–3 invisible wasted frames. The alternative is stalling the pipeline (waiting 100–200ms for formal confirmation), which breaks the RAIL 100ms response threshold. **The cost asymmetry is extreme**: a few wasted frames versus a perceptible freeze.

The cancel-and-restart pattern in JavaScript makes this trivial: `cancelAnimationFrame(oldId); newId = requestAnimationFrame(newCallback)`. The cancelled callback never fires (synchronous guarantee post-2019 spec fix), and the new animation reads current position and velocity rather than a predetermined start state, ensuring seamless visual continuity. Both Framer Motion and React Spring implement this natively — when a new animation target is set mid-flight, they read current value and velocity, using these as initial conditions for the new animation. Framer Motion's `useSpring` hook and React Spring's imperative `api.start()` both exhibit this "from current" behavior by default.

React Native's `Animated.decay()` demonstrates the speculative pattern directly: on gesture end, it takes the last known velocity and immediately begins exponential deceleration with a configurable rate (default 0.997 per frame). If the user touches again mid-decay, the `onPanResponderGrant` fires, the decay stops, and `setOffset()` captures the current position. The newer Reanimated 2 library runs this entirely on the UI thread via "worklets," eliminating bridge latency for frame-accurate interruption.

## Momentum detection without NSEventMomentumPhase

Browsers deliberately withhold the rich gesture phase information that makes iOS scroll behavior trivial to implement. On macOS, AppKit exposes a two-axis state machine: `NSEventPhase` tracks the finger (began → changed → ended) while `NSEventMomentumPhase` tracks synthetic deceleration (began → changed → ended). The full sequence for a flick is: phase.began → phase.changed (repeated) → phase.ended → momentumPhase.began → momentumPhase.changed (repeated) → momentumPhase.ended. **JavaScript wheel events expose none of this** — only deltaX, deltaY, and deltaMode.

W3C UI Events issue #56 (2015) proposed adding `isInertialScrolling` to WheelEvent, noting that "developers have come up with horrible hacks to work around not having this information." Issue #58 split this into a focused proposal with 26+ thumbs-up reactions. As of 2026, **issue #58 remains open with no browser implementation**. This forces JavaScript developers to infer gesture phase from delta patterns.

The most reliable heuristic is **ratio-based momentum detection**: during macOS trackpad momentum, the OS applies exponential decay, producing consecutive deltas that decrease at a predictable ratio. Check if |delta[n] / delta[n-1]| falls in **[0.70, 0.995]** for 3–5 consecutive events. User-initiated scrolls produce irregular ratios (sometimes increasing, frequently varying). Momentum events cluster around 0.85–0.95 because the OS reduces velocity by a factor of ~0.95 per animation tick (time constant ~325ms, per Ariya Hidayat's PastryKit analysis). Three consecutive matching events at 60Hz means **~50ms detection latency**; five events means ~83ms.

The lethargy library (d4nyll/lethargy, 322+ stars) implements a complementary approach: it maintains a rolling window of delta values (default window = 8) and checks for decay patterns. Its TypeScript rewrite (snelsi/lethargy-ts) adds time-gap detection (default 150ms) and increasing-deltas detection (3 consecutive increases confirm user intent). Mapbox GL JS takes a simpler approach: a 40ms debounce window with delta accumulation, classifying input as trackpad when `Math.abs(timeDelta * value) < 200`.

**With speculative snap-back, all these timeouts can be tightened aggressively.** Traditional libraries use conservative values (150ms delay, 100ms debounce, 5 consecutive ratio matches) to minimize false positives. But when false positives trigger a cancellable speculative animation rather than an irreversible action, the cost of misclassification drops to near zero. This allows reducing to **80ms delay, 60ms debounce, 3 consecutive matches** — cutting detection latency from ~83ms to ~50ms and eliminating 40–70ms of perceived lag per scroll interaction.

## Coordinating concurrent rAF loops without conflicts

The speculative snap-back system has potentially three animation loops competing for the same elastic offset value: the EWMA monitoring loop, the snap-back spring animation, and any inertial coast animation. Only one should own the value at a time. The **single rAF dispatcher pattern** — used by both GSAP and Framer Motion — is the gold standard. GSAP's `gsap.ticker` runs exactly one `requestAnimationFrame` that drives all tweens on a single global timeline. Framer Motion splits its single rAF into three phases: `frame.read()`, `frame.update()`, `frame.render()`, preventing layout thrashing by batching reads before writes.

For this system, the recommended approach is a **state machine with exclusive ownership**. Define states IDLE, ELASTIC_DEFORMING, SNAPPING_BACK, and COASTING. Only the active state's update function writes to the elastic offset each frame. Valid transitions are: IDLE → ELASTIC_DEFORMING (user starts overscrolling), ELASTIC_DEFORMING → SNAPPING_BACK (speculative or formal trigger), SNAPPING_BACK → IDLE (animation completes), SNAPPING_BACK → ELASTIC_DEFORMING (user resumes input). **SNAPPING_BACK → SNAPPING_BACK is explicitly invalid** — this prevents the double snap-back problem.

A critical implementation detail: use `null` as the sentinel for "no animation running," not `0`. MDN warns that rAF IDs are per-window incrementing counters that may wrap to 0. The `_rafId` pattern becomes: `if (this._rafId != null) { cancelAnimationFrame(this._rafId); }` before starting any new animation. The guard-and-skip variant (`if (this._snapBackRafId != null) return;`) is appropriate when snap-back should not be interrupted by another snap-back; the cancel-and-restart variant is appropriate when new input should supersede the running animation.

Post-2019, the WHATWG spec guarantees that `cancelAnimationFrame` works correctly even within the same frame. If callbacks A and B are both scheduled for Frame N, and A runs first and cancels B, **B will not run** — the cancellation removes it from the pending list mid-frame. This was inconsistent before 2019 (Firefox didn't cancel pending same-frame callbacks until Bug 1509466), but is now reliable across all modern browsers.

The monitoring rAF loop (checking EWMA each frame) costs under 0.1ms per frame, but **prevents the browser from going idle**, impacting mobile battery life. The Cytoscape.js project documented this as a "deal-breaker" for mobile apps. Best practice: start monitoring only when elastic offset becomes non-zero, stop when the value settles. This allows the browser to enter idle state between interactions.

## How iOS achieves zero-delay bounce-back (and why the web can't)

UIScrollView's bounce-back has **zero perceptible delay** because of three architectural advantages the web lacks. First, `UIPanGestureRecognizer.ended` fires synchronously on the main thread the instant the finger lifts, and the animation starts in the same run loop iteration — no async gap. Second, the gesture recognizer directly provides velocity via `velocityInView:`, eliminating any need for momentum detection. Third, Core Animation's render server runs in a separate process, decoupled from main thread work.

The rubber-band formula used during the drag phase is **f(x, d, c) = (x · d · c) / (d + c · x)** with c = 0.55, where x is raw overscroll distance and d is the scroll view dimension. This produces diminishing returns: at x = 100pt on a 960pt view, only 52pt is visible; at x = 960pt, only 341pt. The formula asymptotically approaches d, meaning you can never rubber-band more than the view's full dimension regardless of how far you drag. This formula applies only during active dragging — snap-back uses a completely different mechanism.

The snap-back itself is a **critically damped spring** (damping ratio = 1.0) with response time ~0.4 seconds. Using the WWDC 2018 conversion formulas: stiffness = (2π/response)² ≈ **246.7**, damping = 4π · dampingRatio / response ≈ **31.4**, with mass = 1.0. The natural frequency ω_n = √(stiffness) ≈ 15.7 rad/s. The position at time t follows x(t) = (x₀ + (v₀ + ω_n · x₀) · t) · e^(−ω_n · t). A critically damped spring has a key property: **settling time is roughly constant regardless of displacement**. A 10× increase in offset adds only ~ln(10)/ω_n ≈ 0.15s to settling time. This means 5px and 100px overscrolls both snap back in approximately 0.4–0.5s, matching user expectations.

The deceleration phase (when momentum carries content toward a boundary) uses exponential decay: `UIScrollView.DecelerationRate.normal` = **0.998** (loses 0.2% velocity per millisecond). The final resting position can be projected as x₀ + v₀ × 0.998/0.002 = x₀ + v₀ × 499. When this projection lands past an edge, the seamless transition to bounce-back captures the exact velocity at the boundary crossing point and uses it as the spring's initial velocity, producing continuous position and velocity across the phase transition — which is why iOS scrolling feels fluid despite having three distinct internal phases.

## Preventing race conditions with defense-in-depth

The most dangerous race condition is the **double snap-back**: the EWMA stall detector calls `_snapBackElastic()` speculatively, then 80ms later the formal `TrackpadGestureDetector.onGestureEnd()` calls it again. Two competing spring animations on the same value produce jittery, oscillating behavior. GSAP documents this precisely — their default `overwrite: false` mode lets tweens "fight each other," which is the anti-pattern. Their recommended `overwrite: "auto"` kills conflicting property animations, matching the guard-and-skip pattern.

The recommended architecture uses five defense layers:

- **Layer 1 — State machine**: The transition SNAPPING_BACK → SNAPPING_BACK is explicitly invalid. When formal gesture end fires while speculative snap-back runs, the state machine rejects the transition. Log the blocked transition for debugging but take no action.
- **Layer 2 — Guard check**: `_snapBackElastic()` is idempotent. If `_isSnappingBack` is true, the function returns immediately. This catches any case the state machine might miss.
- **Layer 3 — rAF debounce**: Using `requestAnimationFrame` as a natural debounce ensures at most one snap-back start per frame. If both speculative and formal triggers fire within the same 16ms frame, only the last one executes.
- **Layer 4 — Value handoff**: When snap-back is interrupted (user resumes input), read `getCurrentValue()` and `getCurrentVelocity()` from the running animator before cancelling. Set the elastic offset to the interrupted value. **Never jump back to a pre-animation value.** This follows Apple's spring retargeting model (WWDC23): "a spring animation uses its speed during the retargeting phase as its initial velocity toward the new destination."
- **Layer 5 — Logging and assertions**: Log every state transition with `performance.now()` timestamp, trigger source (ewma_stall, formal_gesture_end, input_resumed, animation_complete), current elastic offset, and animator running status. Assert valid transitions in development: snap-back requires passing through ELASTIC_DEFORMING first; snap-back with zero elastic offset is a logic error.

The trickiest scenario is: speculative snap-back starts (t=0), user resumes scrolling (t=30ms, snap-back cancelled), elastic offset increases, user lifts finger (t=200ms), formal gesture end fires (t=250ms). This works cleanly: cancellation at t=30ms transitions state back to ELASTIC_DEFORMING and restarts EWMA monitoring. The formal gesture end at t=250ms finds the system in ELASTIC_DEFORMING — a valid transition to SNAPPING_BACK — and proceeds normally. No special handling needed because the state machine ensures correct behavior regardless of the speculative path's outcome.

## Recommended constants and implementation parameters

| Parameter | Value | Rationale |
|---|---|---|
| EWMA α | **0.3** | 95ms effective window, ~108ms detection latency — meets RAIL 100ms budget |
| Stall threshold | **0.5 screen px/frame** | Below human perceptual threshold; zoom-adaptive |
| EWMA initial value | **10** | Prevents false positives for ~140ms warm-up |
| Momentum ratio range | **[0.70, 0.995]** | Captures macOS trackpad exponential decay pattern |
| Consecutive ratio matches | **3** | ~50ms detection latency (aggressive, safe with speculation) |
| Inter-event timeout | **80ms** | Down from 150ms; speculation handles false positives |
| Debounce window | **60ms** | Down from 100ms; same rationale |
| Spring damping ratio | **1.0** | Critically damped — no oscillation |
| Spring response | **0.4s** | Matches iOS UIScrollView feel |
| Rubber-band constant c | **0.55** | Matches iOS UIScrollView |
| Deceleration rate | **0.998** per ms | Matches UIScrollView.normal |
| rAF ID sentinel | **null** | Not 0 — MDN warns IDs may wrap to 0 |

## Conclusion

The 1–2 second freeze is not a missing feature but a sequencing error: the system performs expensive certainty-seeking (formal momentum detection) before initiating a cheap, reversible action (snap-back animation). The fix inverts this: **speculate first, confirm later**. The EWMA stall detector triggers within ~108ms of movement ceasing, launching a spring animation that the user sees as instant response. If the detection was premature, the animation cancels seamlessly on the next input event — the mispredict cost is invisible.

The deeper insight is that speculative execution doesn't just fix the freeze — it fundamentally changes the design space for momentum detection. When misclassification triggers a cancellable animation rather than an irreversible action, aggressive detection becomes safe, allowing timeout constants to be halved without increasing user-visible errors. The formal gesture detector becomes a confirmation mechanism rather than a gate, exactly as branch prediction units in CPUs commit speculatively executed instructions rather than waiting for branch resolution before starting work.