# Solving VTT camera input: a multi-disciplinary research synthesis

**The five bugs in this camera system share two root causes: per-event device classification and delayed state transitions.** Replacing the per-event `classifyWheelDevice` heuristic with a stateful windowed classifier, and replacing timeout-based momentum detection with speculative snap-back, will resolve all five issues. Research across production canvas applications (Figma, Mapbox GL JS, tldraw), animation frameworks (React Spring, iOS UIKit, Android DynamicAnimation), signal processing, control theory, and game engine patterns converges on a consistent set of proven techniques. The critical finding: no browser exposes trackpad phase information to JavaScript, every production app uses heuristics, and the best heuristics combine multiple weak signals over a sliding window rather than classifying single events.

---

## The per-event classification heuristic is the primary failure

The current `classifyWheelDevice` rule — `maxDelta >= 50 && integer && no deltaX` equals mouse — fails because fast two-finger trackpad scrolls routinely produce deltas of 50–150px with integer values. This is the root cause of bugs #3, #4, and contributes to #5. Every production library that has solved this problem uses **stateful, multi-event classification** rather than per-event heuristics.

**Mapbox GL JS** accumulates wheel deltas over a 40ms window, then classifies: if `|timeDelta × accumulatedDelta| < 200`, it's trackpad; otherwise mouse wheel. This works because trackpads produce many small events (large time × small delta = small product) while mouse wheels produce few large events. Mapbox also applies different zoom rates: **1/100 for trackpad** (direct, fine-grained) and **1/450 for mouse wheel** (slower, compensating for coarse steps).

**Lethargy** (571 stars, 612 bytes) takes a different approach entirely — it doesn't classify the device, only whether events are user-initiated or inertial, using a rolling average of `wheelDelta` values and checking for consistent decay. **tldraw** uses behavioral detection: if `deltaX ≠ 0` appears, it's trackpad; if middle mouse button fires, it's mouse. This sidesteps delta analysis entirely but fails for pure vertical trackpad scrolling.

The **W3C proposal for `WheelEvent.isInertialScrolling`** (issues #56 and #58) has been open since 2015 with no browser implementation. The `InputDeviceCapabilities` API (Chrome-only) only exposes `firesTouchEvents` and cannot distinguish mouse from trackpad. Firefox's `deltaMode = DOM_DELTA_LINE` is the single most reliable per-event signal — mice report LINE mode, trackpads report PIXEL — but Chrome and Safari always use PIXEL mode, making this Firefox-only.

The strongest universal discriminator is **inter-event timing**. Trackpad events arrive at display refresh rate (<16ms apart); mouse wheel events arrive at human speed (>50ms apart). Combined with delta consistency (mouse produces identical deltas per notch; trackpad produces varying deltas), a windowed classifier achieves high accuracy in 3–5 events.

### The recommended stateful classifier

The optimal approach combines six signals over a sliding window of 8 events:

- **Inter-event interval** (<20ms → trackpad; >80ms → mouse) — strongest signal
- **Delta consistency** (constant large deltas → mouse; varying deltas → trackpad)
- **Fractional deltas** (mouse wheels produce integers; trackpads often produce fractions)
- **Simultaneous deltaX + deltaY** (strong trackpad indicator)
- **deltaMode** (LINE = mouse in Firefox; PIXEL = ambiguous)
- **Very small deltas** (<4px almost never from mouse wheels)

Each signal contributes a weighted score. Classification requires a confidence threshold rather than a binary cutoff. This handles edge cases: **Apple Magic Mouse** (touch surface, trackpad-like events from a mouse — correctly treated as trackpad since the user is swiping), **Logitech MX Master free-spin** (continuous scroll mimicking trackpad — correctly treated as trackpad), and **mouse horizontal tilt wheel** (non-zero deltaX from a mouse — only weak trackpad evidence, insufficient alone to override).

A critical design decision: **always default to trackpad/pan when uncertain**. A pan that should have been a zoom is easily corrected by the user; a zoom that should have been a pan is disorienting and loses the user's viewport position.

---

## Gesture disambiguation requires hysteresis, not faster classification

The fundamental tension — distinguishing fast scroll from zoom within one 16ms frame — cannot be solved by faster classification alone. Instead, the proven approach across iOS, Android, and Flutter is **not to choose early, but to make the choice sticky once made**.

**iOS UIGestureRecognizer** runs multiple recognizers simultaneously and coordinates them through `shouldRecognizeSimultaneouslyWith:` and `require(toFail:)`. Apple's key insight: for continuous gestures like pan and pinch, **don't pick a winner early — let both run and blend their outputs**. UIScrollView's pan and pinch recognizers operate simultaneously, with the scroll view applying both translation and scale from each frame's events. Only discrete gestures (tap vs double-tap) use exclusion with an explicit ~300ms delay.

**Flutter's gesture arena** uses evidence accumulation with slop thresholds. A gesture must exceed **18 logical pixels of movement** (kTouchSlop) before it can claim victory. Until then, events are buffered and no gesture is committed. If only one recognizer survives elimination, it wins by default.

**The hysteresis pattern** — requiring stronger evidence to switch modes than to stay in the current mode — appears across electronics (Schmitt trigger), computer architecture (2-bit branch predictor), and Apple's own documentation: "Scroll and swipe gestures, once begun, are locked to that gesture until the gesture ends." This directly addresses bugs #3 and #4: after a pinch-zoom ends, the system should require **80ms of cooldown or 3 consecutive non-ctrlKey events** before allowing reclassification as scroll-pan. During cooldown, ambiguous events continue as the previous gesture type.

**Control theory's bumpless transfer** provides the mathematical framework for smooth mode transitions. When switching from gesture mode A to mode B, interpolate outputs over a **50ms blend period**: `output = lerp(modeA_output, modeB_output, easeOut(progress))`. This eliminates the visual discontinuity that causes bug #5's erratic behavior. Control theory also specifies a **minimum dwell time** — the system must remain in a mode for a minimum period before switching is allowed. This prevents "chattering," the control-theory equivalent of the VTT's rapid mode-switching oscillation.

### The hierarchical state machine architecture

Replace the flat priority-based state machine with a hierarchical design:

```
IDLE
├── UNDECIDED (buffer 2-3 events, speculative execution)
├── ACTIVE_GESTURE (superstate)
│   ├── PAN_MODE
│   │   ├── DRAG_PAN (mouse drag — unambiguous)
│   │   └── SCROLL_PAN (trackpad two-finger)
│   └── ZOOM_MODE
│       ├── PINCH_ZOOM (ctrlKey events — unambiguous)
│       └── WHEEL_ZOOM (mouse wheel)
└── ANIMATION (superstate, preemptible)
    ├── ZOOM_ANIMATE
    ├── INERTIA
    └── SNAP_BACK
```

The UNDECIDED state buffers 2–3 events (~32–48ms) while speculatively executing the most likely interpretation. If classification changes, smooth correction via interpolation costs at most 1–2 frames — **below the 50ms perception threshold**. User gestures (ACTIVE_GESTURE) always immediately preempt animations. Within ACTIVE_GESTURE, mode switching requires passing through UNDECIDED with hysteresis. `ctrlKey: true` events bypass UNDECIDED entirely and route straight to PINCH_ZOOM.

---

## Spring overshoot is solved by velocity clamping at a known threshold

Bug #2 — the spring snap-back overshooting past the boundary — has a precise mathematical solution. For a critically damped spring with natural frequency ω, initial displacement x₀ from target, and initial velocity v₀, **overshoot occurs when `v₀ < -ω · x₀`** (for positive displacement). With ω = 20 (stiffness 400, mass 1) and 50px of overscroll, any velocity more negative than **-1000 px/s** causes overshoot.

The fix is direct:

```javascript
function clampVelocityForSpring(v0, x0, omega) {
  const vCritical = -omega * x0;
  if (x0 > 0 && v0 < vCritical) return vCritical;
  if (x0 < 0 && v0 > -vCritical) return -vCritical;
  return v0;
}
```

This guarantees zero overshoot. For a slightly softer feel that allows **controlled overshoot** of at most N pixels, use `vLimit = vCritical - N * omega * e` as the clamp threshold instead.

**Apple's UIScrollView** handles this transition cleanly by running exponential deceleration (`v(t) = v₀ · 0.998^(1000t)`) until the position crosses the boundary, then switching to a critically damped spring seeded with the current velocity. This is a hard switch, not a blend, and it works because both phases share velocity continuity — the transition is C1-continuous (both position and velocity are continuous at the switching instant).

The **universal pattern** across React Spring, Framer Motion, iOS UIViewPropertyAnimator, Android SpringAnimation, and Facebook's Pop and Rebound libraries is **"current value, current velocity" handoff**: when starting any new animation, read the current animated position and velocity from the running animation, and use those as initial conditions for the new animation. This eliminates discontinuities regardless of what the previous animation was doing. React Spring's `clamp: true` option stops the animation entirely when it first crosses the target. Android's `SpringAnimation.setMinValue/setMaxValue` constrains the range. Either approach works as a safety net alongside velocity clamping.

For the VTT specifically, a layered defense works best:

- **Primary**: Velocity clamp at spring start (prevents overshoot analytically)
- **Secondary**: Position clamp in the animation loop as a safety net
- **Tertiary**: Cap maximum coast velocity to 3000 px/s before it reaches the spring
- **Optional refinement**: Dynamic damping ratio — increase ζ from 1.0 to 1.1–1.3 when the velocity-to-displacement ratio exceeds 2.0, making the spring slightly overdamped at extreme velocities

---

## Speculative snap-back eliminates the freeze entirely

Bug #1 — the 1–2 second freeze before snap-back — stems from waiting for formal momentum detection before starting the snap-back animation. The solution is to **not wait at all**.

Browsers expose zero phase information from trackpad events. macOS internally provides `NSEventPhase` and `NSEventMomentumPhase` with explicit began/changed/ended states, but **no major browser passes these to JavaScript WheelEvent**. The W3C proposal has stalled for a decade. All detection must be heuristic.

The momentum scroll decay on macOS follows exponential deceleration with a per-frame ratio of approximately **0.95 at 60fps** (time constant τ ≈ 325ms). Active scrolling deltas are erratic — consecutive ratios range from 0.3 to 3.0+. This makes ratio-based detection effective: **2 consecutive decaying ratios** (each between 0.70 and 0.995) signals momentum onset with ~32ms latency.

But the breakthrough insight from human perception research is that **you don't need to detect momentum to start snap-back**. Jakob Nielsen's thresholds place 100ms as the "feels instantaneous" boundary and 1000ms as the "flow of thought" limit. The current 1–2 second freeze is perceived as broken. Google's RAIL model requires visible feedback within 100ms of user action.

**The speculative snap-back strategy**: on every animation frame where the camera is overscrolled, check if the exponentially-weighted moving average (EWMA) of delta magnitudes has dropped below a low threshold (~2px). If so, start a **gentle elastic snap-back animation**. If a new active scroll event arrives, cancel the snap-back and follow the input. If momentum is later confirmed, transition to full snap-back physics. The key research finding: **a wrong animation is better than a freeze**. A gentle snap-back that gets cancelled by continued scrolling is imperceptible; a 1-second freeze is glaring.

This reduces perceived snap-back latency to **~16ms** (one frame) from the current 1–2 seconds. The momentum detector still runs in parallel for formal state management, but it no longer gates the visual response.

---

## How Figma, Mapbox, and tldraw actually handle it

**Figma** sidesteps the classification problem almost entirely. Their wheel handler checks one thing: `ctrlKey`. If true, zoom to cursor point with `deltaY / 100`. If false, pan by `(deltaX, deltaY)` divided by zoom level. That's it — no device classification, no timing analysis, no state machine for wheel events. They offer a user preference toggle ("Use scroll wheel zoom") for mouse users who want wheel-to-zoom without Ctrl. This is arguably the most robust approach because it delegates the hardest ambiguity to the user.

**Mapbox GL JS** takes the heuristic path with its 40ms debounce + `|timeDelta × value| < 200` classification. They apply **different animation strategies per device type**: mouse wheel events trigger bezier-eased zoom animations (each tick sets a new target zoom, and the animation merges smoothly with running animations); trackpad events apply zoom directly without transitions, since the user's fingers provide continuous control. Their magic number `wheelZoomDelta = 4.000244140625` identifies characteristic mouse wheel delta values.

**tldraw** uses a `{ x, y, z }` camera model with configurable `wheelBehavior: 'pan' | 'zoom'`, camera constraints with `'contain'`/`'inside'`/`'outside'` behavior, and animated transitions with easing curves. Their mouse/trackpad detection evolved through multiple PRs, ultimately landing on a heuristic combining wheel and pointer events with a user preference fallback.

**Google Maps** created the industry standard with its `gestureHandling` option — `'cooperative'` mode requires Ctrl+scroll to zoom and shows an overlay prompt. This approach has been replicated by Leaflet (via plugin), OpenLayers, and Mapbox, and is worth considering for the VTT, especially for embedded scenarios where accidental zoom-while-scrolling is frustrating.

---

## Five deep dives: synthesized findings

### Device classification must be stateful and multi-signal

Every production approach that works well uses multiple events, not single events. The failure mode of per-event classification (the VTT's current approach) is well-documented across Mapbox GitHub issues, OpenLayers bug reports (#9564, #6030), and the W3C pointerevents discussion (#462). The 3D app developer who filed the W3C issue proposed checking whether a window of deltas contains fractional values, consistent magnitudes, or simple integer ratios — all stateful, multi-event checks. The recommended classifier uses 6 weighted signals over 8 events, with inter-event timing as the strongest universal discriminator.

### Disambiguation without delay uses speculative execution and hysteresis

The two-pronged approach: (1) speculative execution on the first event using prior context as a strong Bayesian prior, then correction within 2–3 frames if wrong; (2) hysteresis requiring **80ms or 3 events** to switch between modes. Apple's own documentation confirms that scroll gestures, once begun, are locked until the gesture ends. Fighting game input buffering provides a useful analogy — a 3–5 event buffer (50–80ms) is standard for disambiguating similar input sequences, well below the **100ms perception threshold**.

### Springs can't overshoot when velocity is clamped to -ω·x₀

The analytical solution is exact: for a critically damped spring, the velocity that produces zero overshoot is `v₀ = -ω · x₀`. Clamping to this value is the primary fix. For a softer feel, allow controlled overshoot by setting the clamp to `vCritical - maxOvershoot · ω · e`. Apple's UIScrollView uses this implicitly — the deceleration phase naturally reduces velocity before the boundary, so by the time the spring starts, velocity is rarely extreme. The VTT's bug occurs because momentum from a fast swipe is unclamped.

### Concurrent animations use "current value, current velocity" handoff

The universal pattern across all major animation frameworks: any new animation reads current position and velocity from whatever is currently running, then starts from those values. No explicit cancellation, no blending period, no state cleanup. Spring physics makes this natural — you just change the target and the spring resolves the transition. Facebook's Pop library codified this: animations keyed by the same string replace each other with state continuity. For the VTT, maintain one animation state per axis (x, y, zoom), and when starting a new animation, always seed it from the current animated values.

### Change-point detection uses ratio-based analysis with 32ms latency

The optimal momentum detector checks whether `|delta[n] / delta[n-1]|` falls in [0.70, 0.995] for 2+ consecutive events. This achieves ~32ms detection latency. CUSUM (cumulative sum) provides a more sophisticated alternative with tunable sensitivity. The speculative snap-back strategy makes formal detection latency less critical — the visual response happens on the first frame regardless.

---

## A complete fix for each bug

**Bug #1 (Freeze before snap-back)**: Replace timeout-based gesture end detection with speculative snap-back. On each frame, if overscrolled and EWMA velocity < 2px, start a gentle snap-back. Cancel on new active input. This reduces visual latency from **1–2 seconds to ~16ms**.

**Bug #2 (Overshoot on fast release)**: Clamp velocity at spring start: `v₀ = max(v₀, -ω · x₀)` for positive displacement. Add position clamping as a safety net. Cap coast velocity to 3000 px/s. This makes overshoot **mathematically impossible**.

**Bug #3 and #4 (Zoom instead of pan)**: Replace `classifyWheelDevice` with a stateful windowed classifier using 6 signals over 8 events. Add 80ms hysteresis after gesture type changes. Default to pan when uncertain. Route `ctrlKey: true` events directly to zoom without classification. This eliminates misclassification of **fast trackpad scrolls as mouse wheel**.

**Bug #5 (Erratic behavior)**: Implement hierarchical state machine with UNDECIDED state. Add bumpless transfer (50ms interpolation) during mode switches. Enforce minimum dwell time per mode. Use "current value, current velocity" handoff for all animation transitions. This provides **smooth, continuous behavior** even during rapid gesture switching.

---

## Roadmap to a camera system better than Figma

**Phase 1 — Fix the classifier (Days 1–3)**: Replace `classifyWheelDevice` with the stateful windowed classifier. This alone fixes bugs #3, #4, and much of #5. Add a user preference toggle for scroll-wheel behavior as a fallback.

**Phase 2 — Fix the spring (Days 3–4)**: Add velocity clamping at spring start. Add position clamping as safety net. This fixes bug #2 completely.

**Phase 3 — Fix the freeze (Days 4–6)**: Implement speculative snap-back with EWMA velocity tracking. Reduce momentum detection requirements to 2 consecutive decays with 4-event minimum. This fixes bug #1.

**Phase 4 — Architecture upgrade (Days 6–10)**: Implement hierarchical state machine with UNDECIDED state and hysteresis. Add bumpless transfer for mode transitions. Implement "current value, current velocity" handoff for all animations. Consider a unified physics model (friction + boundary spring in one integrator) to eliminate explicit state transitions between coast and snap-back.

**Phase 5 — Beyond Figma (Days 10–15)**: Figma has no inertial scrolling, no elastic boundaries, and no spring animations on camera. The VTT can surpass it by combining Figma's simple `ctrlKey`-based routing with Apple's fluid interface principles: momentum-preserving springs, rubber-band overscroll (the formula is already correct), and seamlessly interruptible animations. Add cooperative gesture handling (Ctrl+scroll overlay prompt) for embedded contexts. Add camera constraints with configurable behavior per axis. Add smooth animated zoom-to-fit and token-follow with spring-based camera transitions.

The key insight from Apple's WWDC 2018 "Designing Fluid Interfaces": **spring physics unifies everything**. A spring with no tension models inertia (friction-only deceleration). A spring with tension models snap-back. A spring with high stiffness models direct manipulation. By expressing all camera animations as spring configurations rather than separate systems (exponential coast, critically damped snap-back, bezier zoom), the entire animation layer reduces to a single spring integrator per axis that simply changes parameters when the interaction mode changes. No state machine for animations, no explicit handoff — the spring continuously resolves toward its current target with its current parameters, always preserving velocity continuity.