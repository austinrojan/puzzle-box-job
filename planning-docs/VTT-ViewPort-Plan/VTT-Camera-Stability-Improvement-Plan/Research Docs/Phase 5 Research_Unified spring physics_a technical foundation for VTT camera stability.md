# Unified spring physics: a technical foundation for VTT camera stability

**A single damped spring per axis can replace every animation subsystem in a virtual tabletop camera.** This is the central insight shared by React Spring, Framer Motion, Apple's UIKit, Android's DynamicAnimation, and Facebook Pop: you never switch "modes" between snap-back, inertial coast, and smooth zoom. You just change the spring's target and let velocity carry forward. Phase S5's architecture can leverage this pattern alongside battle-tested overscroll formulas from iOS, cooperative gesture handling from Google Maps, and a consolidated `requestAnimationFrame` loop to deliver beyond-parity camera behavior in roughly three spring instances and one tick function.

---

## One spring to rule snap-back, coast, and zoom

Every major animation library converges on the same primitive: **a spring holding `(position, velocity, target)` per axis**, advanced each frame by the damped harmonic oscillator equation. React Spring's `SpringValue<T>` class stores current value, current velocity, a goal, and config parameters (tension, friction, mass). Framer Motion wraps the Wobble library's spring generator internally. Android's `SpringAnimation` pairs with a `SpringForce` object carrying stiffness and damping ratio. Facebook Pop's `POPSpringAnimation` uses bounciness/speed scales that convert internally to tension/friction.

The architectural pattern that emerges—call it **AxisSpring**—eliminates the need for separate animation systems entirely. Snap-back becomes "set target to rest position, velocity to zero." Inertial coast becomes "set target to projected endpoint, velocity to gesture release velocity." Smooth zoom becomes "set target to new zoom level." The same integration loop handles all three because the spring equation's behavior is fully determined by initial conditions and target. No state machine transitions, no animation type switching.

**Interruption is the killer feature.** When you call Android's `animateToFinalPosition(newTarget)` on a running spring, it simply updates the destination while preserving in-flight position and velocity. React Spring's `.start({ to: newTarget })` does the same. Apple's WWDC 2018 "Designing Fluid Interfaces" talk (Session 803) calls this the **"current value, current velocity" handoff**: read the in-progress animation's state, feed it as initial conditions to a new spring aimed at the new target. No discontinuity in position or velocity. The math guarantees this—the ODE solution is uniquely determined by `(x₀, v₀)`, so reading those values at any moment and restarting the solver creates a C¹-continuous trajectory.

Apple's SwiftUI documentation makes the strongest claim: "Springs are the **only** type of animation that maintains continuity both for static cases and cases with initial velocity." The WWDC 2018 talk explicitly recommends springs as THE universal animation primitive because they are interruptible by nature, preserve velocity across interruptions, and don't require explicit duration parameters. For a VTT camera that must respond fluidly to rapid gesture changes, this is essential.

The minimal state for a Phase S5 `AxisSpring` is:

```typescript
interface AxisSpring {
  position: number;   // Current value
  velocity: number;   // Current velocity (units/second)
  target: number;     // Goal value
  stiffness: number;  // Spring constant k
  damping: number;    // Damping coefficient c
  mass: number;       // Mass m (typically 1.0)
}
```

To switch behaviors, update `target` and optionally `velocity`. The integration loop handles everything else.

---

## The mathematics behind seamless camera motion

The spring differential equation derives from Newton's second law with Hooke's law and viscous damping: `mx'' + cx' + kx = 0`, where x is displacement from target. Defining **natural frequency** ω₀ = √(k/m) and **damping ratio** ζ = c/(2√(mk)) yields the standard form `x'' + 2ζω₀x' + ω₀²x = 0`.

**For critically damped springs (ζ = 1)**, the optimal choice for camera motion, the closed-form solution is:

```
x(t) = (A + Bt) · e^(-ω₀t)
where A = x₀,  B = v₀ + ω₀·x₀
```

This reaches equilibrium fastest without oscillation. The underdamped case (ζ < 1) adds sinusoidal oscillation: `x(t) = e^(-ζω₀t)[A·cos(ω_d·t) + B·sin(ω_d·t)]` where ω_d = ω₀√(1-ζ²) and B = (v₀ + ζω₀x₀)/ω_d. The overdamped case (ζ > 1) uses two decaying exponentials with real, distinct roots. Counter-intuitively, stronger damping means *slower* settling in the overdamped regime—which is why ζ = 1 is the sweet spot for camera work.

**Production library defaults reveal consensus.** React Spring's default config (tension: 170, friction: 26, mass: 1) yields ζ ≈ 0.997—nearly critically damped. Android's `DAMPING_RATIO_NO_BOUNCY` is exactly 1.0. Apple's SwiftUI `.spring()` defaults to `dampingFraction: 1.0`. For interactive elements wanting slight bounce, ζ ≈ 0.5–0.7 gives 1–2 oscillations. For VTT camera axes, **ζ = 1.0 with ω₀ ≈ 13 rad/s** (stiffness ~170, mass 1) provides snappy, precise settling.

### Zoom must live in log-space

Zoom is multiplicative: going from 1× to 2× should feel identical to 2× to 4×. Linear spring interpolation fails because equal arithmetic steps produce wildly different perceptual changes at different zoom levels. The fix is to **animate log(z)** with the spring, then recover `z(t) = exp(springValue(t))`. Initial conditions transform as: `s₀ = log(z_current) - log(z_target)` and `v_s = v_z / z_current`. Google Earth Studio uses this "near-logarithmic formula" explicitly. The result is perceptually uniform zoom speed regardless of scale—a 2× zoom-in from 0.5× feels identical to a 2× zoom-in from 50×.

### Settling thresholds stop the loop

Springs theoretically never reach rest. Libraries use dual thresholds: the spring is "settled" when **both** `|position - target| < restDelta` **and** `|velocity| < restSpeed` simultaneously. React Spring uses restDelta = 0.01, restSpeed = 0.01. Android's `MIN_VISIBLE_CHANGE_PIXELS` is 1.0px. When settling occurs, snap position exactly to target and zero velocity—this prevents sub-pixel drift and stops the animation loop.

### Integration method: semi-implicit Euler wins for UI

The industry has converged on two approaches. **Closed-form analytical solutions** (used by Apple's CASpringAnimation, Wobble, Framer Motion, React Native's Animated.spring) evaluate x(t) and v(t) as pure functions of elapsed time—no accumulated numerical error, trivially interruptible, frame-rate independent by construction. **Semi-implicit (symplectic) Euler** (used by React Spring, many game engines) updates velocity first, then position:

```javascript
velocity += (-stiffness * (position - target) - damping * velocity) / mass * dt;
position += velocity * dt;
```

Glenn Fiedler's canonical recommendation: "Semi-implicit Euler is cheap and easy to implement, much more stable than explicit Euler, and tends to preserve energy on average." For Phase S5, either approach works. Closed-form is more elegant; semi-implicit Euler is simpler to implement and extend.

---

## iOS's rubber-band formula and proportional drain for overscroll

The gold standard for elastic overscroll is iOS's UIScrollView formula, reverse-engineered by Grant Paul in 2012 and confirmed across multiple reimplementations:

```
b = (1.0 - (1.0 / ((x * c / d) + 1.0))) * d
```

Here **x** is raw overscroll distance, **c = 0.55** is the damping coefficient, **d** is the viewport dimension, and **b** is the visible displacement. This function is monotonically increasing with diminishing returns—it asymptotically approaches **d** but never reaches it. At typical finger-drag distances, maximum visual displacement is roughly **35% of the viewport**. Apple's WWDC 2018 talk also showed a simplified variant for custom views: `offset = pow(offset, 0.7)`.

**The elastic ceiling is built into the formula.** Because b → d as x → ∞, the viewport dimension `d` acts as the natural cap. For a VTT camera, set `d` to `viewport_dimension × 0.33` for a tighter feel (max ~17% visual displacement) or the full viewport dimension for the classic iOS feel (~35% max). **Screen-space capping is essential for zoomable canvases**—the rubber-band effect must look identical regardless of zoom level, which means measuring max displacement in screen pixels, not world units.

**Proportional drain beats fixed-rate decay.** When a user reverses direction during overscroll, there are two models: fixed-rate decay (overflow shrinks at a constant rate over time, feeling mechanical) and proportional drain (reverse input is consumed to reduce overflow first, then passes through to normal scrolling). iOS and Android 12 both implement proportional drain. Android 12's `EdgeEffect.onPullDistance(-delta)` consumes the reverse delta and returns the consumed amount; only when `getDistance() == 0` does normal scrolling resume. This creates a 1:1 relationship between gesture and visual change, even while damped.

The recommended implementation tracks raw cumulative overscroll. On reverse direction input, the raw value decreases. When it crosses zero, the remainder passes through to normal scrolling. The rubber-band function is applied continuously to the raw value, so the visual output naturally follows the same diminishing-returns curve in both directions.

---

## Three approaches to scroll-wheel preference, from toggle to auto-detect

Figma, Miro, and tldraw each take a different approach to the scroll-wheel question, and all three inform a good design for Phase S5.

**Figma uses a simple boolean toggle** in Preferences: "Use scroll wheel zoom." Default off (scroll = pan, Ctrl/Cmd+scroll = zoom). When enabled, the behaviors swap. The preference is per-user, not per-file. Figma's Quick Actions search makes it discoverable. This is the simplest viable approach.

**Miro uses named device modes**: Mouse, Trackpad, or Auto-detect. "Mouse" means scroll=zoom; "Trackpad" means scroll=pan. This communicates intent through the device metaphor rather than the action, which is more intuitive for non-technical users. Miro's auto-detect can be unreliable, sometimes getting stuck in trackpad mode.

**tldraw exposes a developer API**: `wheelBehavior: 'pan' | 'zoom' | 'none'` in `TLCameraOptions`. A community PR (#4612) proposed adding `'auto'` mode with trackpad-vs-mouse heuristics, and another PR (#6755) introduced explicit user preference selection. Neither was merged into main, revealing the difficulty of getting auto-detection right.

### Device classification is hard but tractable

The browser `WheelEvent` API does not expose the source device. Detection relies on heuristics: **trackpads produce `deltaX !== 0`** (horizontal scroll), while mouse wheels produce `deltaY`-only events. Firefox uses `deltaMode: DOM_DELTA_LINE` for mouse wheels versus `DOM_DELTA_PIXEL` for trackpads. **Trackpad pinch gestures surface as wheel events with `ctrlKey: true`**—a de-facto standard since Chrome M35. Middle mouse button detection (`pointerdown` with `button === 1`) confirms a mouse is present.

For Phase S5, the recommended architecture layers three concerns: a **user preference** ('pan' | 'zoom' | 'auto'), a **device classifier** using the heuristics above, and a **context layer** that detects embedded-vs-standalone. The user preference takes priority; auto mode falls through to the device classifier; embedded contexts default to cooperative mode.

---

## Cooperative gestures: the Google Maps pattern for embedded VTTs

Google Maps' `gestureHandling: 'cooperative'` is the reference implementation. Scroll events pass through to the page (the map doesn't consume them). **Ctrl/Cmd+scroll zooms the map. Two-finger touch pans it.** When the user scrolls without the modifier key, a semi-transparent overlay appears: "Use ⌘ + scroll to zoom the map" (Mac) or "Use Ctrl + scroll to zoom the map" (Windows). The overlay persists ~1.5–2 seconds, then fades.

The `'auto'` mode makes the cooperative decision contextually: **if the page is scrollable, use cooperative; if not, use greedy; if in an iframe, always cooperative** (because the API can't determine the parent page's scrollability). Detection uses `window.self !== window.top` for iframe detection and `document.body.scrollHeight > window.innerHeight` for page scrollability.

Leaflet's `leaflet-gesture-handling` plugin replicates this with **52 language translations** built in, configurable duration (default 1000ms), and dynamic enable/disable. Mapbox GL JS added native `cooperativeGestures: true` in v2.6. OpenLayers requires manual assembly from conditional interactions—no built-in cooperative mode.

**Passive event listeners are a critical implementation detail.** Chrome 73+ makes wheel listeners on window/document/body passive by default, silently ignoring `preventDefault()`. For a VTT canvas, attach the wheel listener to the **canvas element itself** (non-root targets are not passive by default) with `{ passive: false }`. When in cooperative mode and the user scrolls without Ctrl, don't call `preventDefault()`—let the page scroll naturally and show the overlay. When the user holds Ctrl, call `preventDefault()` and handle the zoom.

```javascript
canvas.addEventListener('wheel', (event) => {
  if (cooperativeMode && !event.ctrlKey && !event.metaKey) {
    showOverlayPrompt(); // Don't preventDefault — page scrolls
    return;
  }
  event.preventDefault(); // Canvas handles this event
  handleCameraInput(event);
}, { passive: false });
```

---

## One rAF loop, three springs, zero allocations

Every production animation library uses a **single consolidated `requestAnimationFrame` loop**. React Spring's `rafz` ("One loop to frame them all") provides read/update/write phases in a ~1KB package. Framer Motion's `frame` scheduler separates `frame.read()`, `frame.update()`, and `frame.render()` to prevent layout thrashing. Multiple independent rAF loops cause coordination problems—separate loops can't batch DOM reads and writes together, leading to forced synchronous layouts.

For a VTT camera, the architecture is minimal: a global singleton loop that auto-starts when the first spring becomes active and auto-stops when all springs settle. The tick function advances all three springs (panX, panY, zoom), composes a single `translate3d(...) scale(...)` transform string, and writes it once per frame.

**Variable timestep with dt clamping is sufficient for UI springs.** At 60Hz, dt ≈ 16.67ms—well within stability bounds for typical spring parameters. Clamp dt to ~64ms maximum to handle tab-backgrounding gracefully (prevents the spring from "exploding" on a 2-second resume delta). Fixed-timestep subdivision is only necessary for very stiff springs (stiffness > 1000) or if deterministic replay is needed for networked VTT sessions.

**Zero-allocation design** in the hot path prevents GC pauses from causing frame drops. Pre-bind the tick method. Store spring state as flat numeric properties, not objects created per frame. Compose the transform string directly. Use `Set` for subscriber management (O(1) add/delete). Apply `will-change: transform` to the animated element for compositor promotion.

```javascript
// The complete tick — three spring advances, one DOM write
tick = (dt) => {
  this.panX.advance(dt);
  this.panY.advance(dt);
  this.zoom.advance(dt);
  this.el.style.transform =
    `translate3d(${this.panX.position}px,${this.panY.position}px,0) scale(${this.zoom.position})`;
  if (this.panX.settled && this.panY.settled && this.zoom.settled) {
    loop.unsubscribe(this.tick);
  }
};
```

---

## Conclusion: what Phase S5 should build

The research points to a remarkably simple architecture. **Three `AxisSpring` instances** (panX, panY, logZoom) replace all existing animation subsystems—snap-back, inertial coast, and smooth zoom collapse into "change the target." The zoom spring operates in log-space for perceptually uniform behavior. Interruption is free: updating the target mid-flight preserves velocity by construction.

Overscroll uses iOS's rubber-band formula with `c = 0.55` and screen-space capping at ~33% of viewport dimension. Proportional drain on direction reversal—consuming reverse input against the overscroll before allowing normal scrolling—matches the behavior users expect from native platforms.

The scroll-wheel preference should follow Figma's approach: a boolean toggle that swaps default and Ctrl-modified behaviors, with an 'auto' option backed by a device classifier using horizontal-scroll and deltaMode heuristics. Cooperative gesture handling follows Google Maps' pattern exactly: detect embedded context via `window.self !== window.top`, require Ctrl+scroll for zoom, show a platform-aware overlay prompt on unmodified scroll, and use `{ passive: false }` on the canvas element's wheel listener.

The entire system runs in one `requestAnimationFrame` loop that auto-starts and auto-stops, uses semi-implicit Euler or closed-form integration, and writes a single CSS transform per frame. The result is a camera that feels native on every platform—because it uses the same physics that every platform uses.