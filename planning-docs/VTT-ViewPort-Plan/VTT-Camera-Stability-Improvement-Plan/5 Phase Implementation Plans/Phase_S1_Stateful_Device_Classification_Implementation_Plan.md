# Phase S1: Stateful Device Classification
## A comprehensive implementation plan for replacing per-event wheel classification with a windowed, Bayesian, hysteresis-protected classifier

**Fixes:** Bugs #3 (zoom after pinch), #4 (fast scroll triggers zoom), most of #5 (erratic behavior)
**Impact:** Highest. Eliminates the primary source of input misrouting.
**Risk:** Low. Replaces a single function and the routing logic that depends on it.
**Estimated LOC:** ~150 (classifier + routing + deprecation shim)

---

## Table of contents

1. [Why this phase comes first](#why-first)
2. [The philosophical problem: single observation vs. accumulated belief](#philosophy)
3. [A field guide to WheelEvent signals across browsers and hardware](#signal-field-guide)
4. [How production applications solve this problem](#production-approaches)
5. [The W3C gap: a decade of silence](#w3c-gap)
6. [Designing the WheelDeviceClassifier](#classifier-design)
7. [Complete annotated implementation](#implementation)
8. [Restructured wheel handler routing in map-camera.js](#routing)
9. [Import changes and deprecation of classifyWheelDevice](#imports)
10. [Edge cases and exotic hardware](#edge-cases)
11. [Testing protocols](#testing)
12. [Long-term tie-ins to future phases](#long-term)
13. [Migration checklist for Claude Code](#migration)

---

## 1. Why this phase comes first {#why-first}

Of the five reported camera bugs, three trace directly to the same root cause: the `classifyWheelDevice()` function in `vtt/js/trackpad-gesture.js` makes a per-event decision about what hardware produced a `WheelEvent`. It checks a single event's properties, decides "mouse" or "trackpad," and returns. The next event starts from scratch with zero memory of what came before.

This means that every fast two-finger trackpad scroll that happens to produce a delta of 50 or more pixels with an integer value and no horizontal component gets classified as a mouse wheel event. The system then routes it to `SmoothZoomAnimator.onWheelZoom()`, which zooms the camera when the user intended to pan. The user sees the viewport scale change unexpectedly, loses spatial context, and has to manually zoom back out to recover.

Phases S2 through S5 all build on top of whatever routing decisions Phase S1 makes. If the classifier sends trackpad events down the zoom path, then the velocity clamping in S2 operates on zoom velocity instead of pan velocity. The speculative snap-back in S3 never triggers because the gesture detector never sees the trackpad events (they went to zoom). The gesture state machine in S4 oscillates between SCROLL_PAN and ZOOM_ANIMATE because consecutive events flip classification. Fixing the classifier first means every downstream phase operates on correctly classified input from day one.

There is also a practical reason: this phase is low-risk. The `WheelDeviceClassifier` class is a self-contained replacement for a single function. It has no timing dependencies, no animation state, and no interaction with the DOM. It can be unit-tested exhaustively in `page.evaluate()` without touching the browser's rendering pipeline. If something goes wrong, the blast radius is limited to wheel event routing.

---

## 2. The philosophical problem: single observation vs. accumulated belief {#philosophy}

### Why per-event classification is fundamentally wrong

The current classifier treats each wheel event as an independent observation. This is the equivalent of trying to identify a speaker from a single phoneme. You might get lucky, "zh" is a strong signal for Mandarin, but a single "ah" could come from any language on Earth. The correct approach is to listen to a sequence of sounds, build up evidence, and let the pattern emerge.

Device identity is a session-level property. Users do not switch from trackpad to mouse between consecutive wheel events. They switch devices at natural breakpoints: they push the laptop back and pick up a mouse, or they close the lid and use the external trackpad. These transitions happen on the timescale of seconds or minutes, separated by gaps of several hundred milliseconds with no wheel events at all. Within a continuous stream of wheel events, the device identity is constant.

Individual wheel events, on the other hand, are noisy and ambiguous. A single event with `deltaY: 80, deltaX: 0, deltaMode: 0` could be:

- A mouse wheel notch on Chrome (typical deltaY is 100-120, but it varies by mouse and OS settings)
- A fast two-finger trackpad scroll on macOS (easily reaches 80-150px at high velocity)
- A Logitech MX Master in free-spin mode (produces continuous events with large deltas)

No single property of a single event can reliably distinguish these. But a sequence of 4-6 events provides overwhelming evidence. The mouse produces events at 50-200ms intervals with identical deltas. The trackpad produces events at 8-16ms intervals (display refresh rate) with varying deltas. The Logitech free-spin produces events at high frequency with decaying deltas. These patterns are unmistakable when you look at more than one event.

### Bayesian reasoning as the mental model

Think of the classifier as maintaining a belief about which device is active, then updating that belief incrementally as evidence arrives. In Bayesian terms:

- The **prior** is the current device classification (strong: we are fairly confident in what we believe)
- The **evidence** is the latest wheel event's properties (weak: any single event is ambiguous)
- The **posterior** is the updated belief after incorporating the evidence

A strong prior means that a single ambiguous event cannot flip the classification. If the system currently believes "trackpad" based on 5 consecutive events with small deltas at 12ms intervals, one event with `deltaY: 80` should not override that belief. It would take 3-4 events with consistent mouse-like characteristics to overcome the prior.

This is exactly how the Schmitt trigger works in electronics: a noisy signal crossing a threshold does not flip the output unless it crosses a second, higher threshold. The gap between the two thresholds is the hysteresis band, and it prevents the output from oscillating when the input hovers near the boundary. Without hysteresis, the VTT's classifier chatters between "mouse" and "trackpad" on every ambiguous event, which is exactly what bug #5 looks like.

### The "default to pan" principle

When the classifier is genuinely uncertain, there is an asymmetry in the cost of errors. A pan that should have been a zoom is easy to correct: the user just pinches. A zoom that should have been a pan is disorienting: it changes the viewport scale, shifts the apparent position of everything on the map, and requires a deliberate zoom-back-out to recover.

This asymmetry dictates the safe default. When the classifier has not yet accumulated enough evidence to be confident, it should return `'trackpad'`, which routes wheel events to pan. This is what Mapbox GL JS does (their 40ms debounce window defaults to trackpad behavior while accumulating). It is what Google Maps does (non-Ctrl scroll is always pan in cooperative mode). It is what Figma does (scroll is always pan; only Ctrl+scroll and pinch zoom).

The principle extends beyond the initial classification. Even after the classifier has committed to a belief, the threshold for switching from trackpad to mouse should be higher than the threshold for switching from mouse to trackpad. Switching to mouse means wheel events will zoom, which is the riskier behavior. Switching to trackpad means wheel events will pan, which is the safe behavior. The asymmetric thresholds encode the asymmetric costs.

---

## 3. A field guide to WheelEvent signals across browsers and hardware {#signal-field-guide}

Six signals, ordered by discriminative power, combine to form a reliable classification. No single signal is sufficient. The strength of this classifier comes from combining multiple weak signals into a strong conclusion.

### Signal 1: Inter-event timing (strongest universal discriminator)

This is the single most reliable signal because it reflects a fundamental physical difference between the two device types.

**Trackpad events** arrive at the display refresh rate because macOS and Windows both synthesize scroll events on every display frame while the user's fingers are in contact with the trackpad surface. On a 60Hz display, this means events arrive every ~16.67ms. On a 120Hz display, events arrive every ~8.33ms. The practical range is **8ms to 20ms** between consecutive events during active scrolling. During momentum (inertial) scrolling, the interval stays at the display refresh rate because the OS continues synthesizing events frame-by-frame as the deceleration curve plays out.

**Mouse wheel events** arrive at human rotation speed. A standard notched scroll wheel produces one event per physical notch. A typical user scrolls 2-4 notches per second during casual browsing, producing intervals of **250ms to 500ms**. During fast scrolling (the kind that triggers bug #4), a user might hit 8-12 notches per second, producing intervals of **80ms to 125ms**. The critical observation: even during very fast mouse scrolling, the intervals almost never drop below **50ms**, because the physical detent mechanism limits rotation speed.

**The classification boundary** sits at roughly 25ms. An inter-event gap under 25ms is strong trackpad evidence. A gap over 80ms is strong mouse evidence. The zone between 25ms and 80ms is ambiguous, which is exactly the range where fast mouse scrolling and slow trackpad scrolling overlap, and exactly why a single timing measurement is insufficient.

**First-event gap handling:** After a silence reset (or on the very first event), the gap from `_lastEventTime = 0` to `performance.now()` is artificially large (~1000ms+). This would spuriously trigger the >80ms mouse timing signal. The classifier zeros the gap after silence reset (`gap = 0`), so the first event is scored on non-timing signals only. This means the first event defaults to 'trackpad' in most cases (safe), and the timing signal only contributes from the second event onward.

**High refresh rate displays** (120Hz, 144Hz, 240Hz) compress the trackpad interval to 4-8ms but do not change mouse intervals, actually widening the gap and making classification easier. This is a nice property: as displays get faster, the signal gets cleaner.

```
Timing characteristics (approximate):

Trackpad (60Hz):   |--16ms--|--16ms--|--16ms--|--16ms--|
Trackpad (120Hz):  |--8ms-|--8ms-|--8ms-|--8ms-|--8ms-|
Mouse (casual):    |------250ms------|------300ms------|
Mouse (fast):      |---80ms---|---100ms---|---90ms----|
Mouse (very fast): |--50ms--|--60ms--|--50ms--|--70ms--|
```

### Signal 2: Delta consistency (strong mouse indicator)

Mouse wheels with physical notches produce the same delta value for each notch rotation. This value is determined by the OS and driver configuration, not by the speed of rotation. On macOS with Chrome, a standard Apple mouse produces `deltaY: 4.000244140625` per notch (Mapbox GL JS famously uses this as their `wheelZoomDelta` constant). On Windows with Chrome, most mice produce `deltaY: 100` per notch. On Firefox, mice produce `deltaY: 3` with `deltaMode: 1` (line mode).

The key is not the absolute value but the consistency. If the last 4 events all have `|deltaY| === 120`, that is extremely strong mouse evidence. Trackpads produce varying deltas because they reflect finger velocity, which changes continuously.

In the current classifier design, we detect this through the `isFractional` check (Signal 3) and the large-integer-with-no-horizontal check (Signal 6), which together capture the consistency pattern without needing to compare consecutive events directly. A future refinement could add explicit delta-variance tracking across the window.

### Signal 3: Fractional deltas (strong trackpad indicator)

Mouse wheels almost always produce integer deltas. The physical notch mechanism translates each step into a fixed unit value reported by the driver. Even the macOS-specific `4.000244140625` value, while technically non-integer, has a distinctive signature (it is `4 + 1/4096`, a binary fraction arising from fixed-point math in the HID driver).

Trackpad events frequently produce fractional deltas, especially at low velocities where sub-pixel finger movement is translated to values like `deltaY: 2.3333` or `deltaY: 0.7`. This happens because trackpads report at sub-pixel resolution and the OS interpolates between sensor readings.

**Detection:** `(e.deltaY % 1 !== 0) || (e.deltaX % 1 !== 0)`. If either axis has a non-integer value, this is a strong trackpad signal. Note the Mapbox `4.000244140625` edge case: this value satisfies `% 1 !== 0`, so it would register as trackpad. But it only appears on macOS with specific mice, and the timing signal (Signal 1) and delta consistency (Signal 2) for that device will be overwhelmingly mouse-like, easily overcoming this one misleading fractional signal. This is exactly why we combine multiple signals.

### Signal 4: Simultaneous deltaX and deltaY (strong trackpad indicator)

If both `e.deltaX !== 0` and `e.deltaY !== 0` in a single event, the input is almost certainly from a trackpad. Two-finger scrolling naturally produces diagonal movement. A mouse scroll wheel moves on one axis at a time: vertical scroll or horizontal tilt, never both simultaneously.

**Edge case:** Some mice have a tilt wheel that produces horizontal scroll events. These fire as separate events from vertical scroll, not simultaneous. A mouse user could theoretically tilt the wheel and rotate it at exactly the same instant, but this is physically difficult and vanishingly rare.

**Detection:** `e.deltaX !== 0 && e.deltaY !== 0`. When true, count as one trackpad signal.

### Signal 5: deltaMode (Firefox-only, but definitive)

Firefox reports `WheelEvent.deltaMode` as `DOM_DELTA_LINE` (value `1`) for mouse wheel events and `DOM_DELTA_PIXEL` (value `0`) for trackpad events. Chrome and Safari always report `DOM_DELTA_PIXEL` for both device types, making this signal Firefox-only.

But in Firefox, this signal is essentially perfect. A single event with `deltaMode === 1` is a mouse. Period. The classifier treats this as a strong mouse signal that, combined with even one timing signal, will classify as mouse within 2 events on Firefox.

**Detection:** `e.deltaMode === 1`. Count as one mouse signal. Note that `deltaMode === 0` is NOT counted as a trackpad signal because it is ambiguous (both devices report 0 in Chrome and Safari).

### Signal 6: Very small deltas (weak trackpad indicator)

A `|deltaY| < 4` is almost never from a mouse wheel. Mouse wheels have a minimum step size determined by the notch mechanism. Even the smallest mice produce deltas of at least 4 (the Mapbox `4.000244140625` value). Trackpads at low velocity produce deltas of 0.5 to 3.0 routinely.

**Detection:** `maxDelta > 0 && maxDelta < 4 && evt.deltaMode === 0`. Count as one trackpad signal. The `> 0` check prevents counting zero-delta events. The `deltaMode === 0` check restricts this to pixel-mode events only — in Firefox's line mode (`deltaMode: 1`), a `deltaY: 3` means 3 lines (~48-96 pixels), not 3 pixels, so it should NOT trigger the small-delta trackpad signal.

### The legacy check (now a weak signal, not a decision)

The current `classifyWheelDevice` function uses: `maxDelta >= 50 && maxDelta % 1 === 0 && e.deltaX === 0`. In the old system, this is the entire classification. In the new system, it becomes one weak mouse signal among many, with an additional timing guard: `&& evt.gap > 40`. The timing guard prevents fast-arriving trackpad events (gap < 40ms) from triggering this signal, which was essential to fix bug #4. Without it, fast two-finger scrolls accumulate mouse signals from Signal 6 that overwhelm the timing-based trackpad signals. A single event matching this pattern contributes one mouse point to the window score, but it takes 4 mouse points to overcome a trackpad classification.

---

## 4. How production applications solve this problem {#production-approaches}

### Mapbox GL JS: the 40ms debounce window

Mapbox's `ScrollZoomHandler` (in `src/ui/handler/scroll_zoom.js`) uses a time-based approach. When a wheel event arrives, they start a 40ms timer. If no more events arrive within that window, they classify the accumulated delta as a single event and process it. If more events arrive, they accumulate into the same window.

The classification itself checks `|timeDelta * accumulatedDelta| < 200`. Trackpads produce many small events in 40ms (large time accumulation, small delta per event, small product). Mouse wheels produce one large event in 40ms (no accumulation, large single delta, large product). The threshold of 200 separates the two distributions.

They also check for the specific value `4.000244140625` (`wheelZoomDelta`), which identifies macOS mouse wheel events with high confidence.

Once classified, Mapbox applies different zoom rates: `1/100` for trackpad (direct, fine-grained, because the user's fingers provide the smoothing) and `1/450` for mouse wheel (slower, compensating for the coarse notch steps).

**The tradeoff:** Mapbox's approach introduces 40ms of latency on every wheel interaction. For a mapping application where the primary interaction is click-and-drag, this is acceptable. For a VTT where DMs are rapidly panning around during a live session, 40ms of lag on every scroll feels sluggish. Our classifier avoids this by processing events immediately and building up classification confidence incrementally, with a safe default (trackpad/pan) for the first 1-2 events before the window fills.

### Figma: radical simplicity

Figma sidesteps the classification problem almost entirely. Their wheel handler checks one thing: `e.ctrlKey`. If true, zoom to cursor point with `deltaY / 100`. If false, pan by `(deltaX, deltaY)` divided by zoom level. No device classification, no timing analysis, no state machine for wheel events.

For mouse users who want scroll-to-zoom without holding Ctrl, they offer a user preference toggle: "Use scroll wheel zoom." When enabled, non-Ctrl wheel events zoom instead of pan, regardless of device.

This is arguably the most robust approach because it delegates the hardest ambiguity to the user. But it requires a UI for the preference toggle, and it changes the default behavior for mouse users (who expect scroll-to-zoom out of the box in a canvas application). For the VTT, we want the best of both worlds: mouse users get scroll-to-zoom by default, trackpad users get scroll-to-pan, and a preference toggle exists as a fallback for edge cases (Phase S5).

### tldraw: behavioral detection + user preference

tldraw uses `{ x, y, z }` camera coordinates with a configurable `wheelBehavior: 'pan' | 'zoom'`. Their mouse/trackpad detection evolved through multiple pull requests, ultimately landing on a heuristic combining the presence of `deltaX` (strong trackpad signal), pointer event type (if a `pointerType === 'touch'` precedes the wheel events, it is likely a trackpad), and a user preference fallback.

tldraw also provides camera constraints with `'contain'`/`'inside'`/`'outside'` behavior and animated transitions with easing curves, which maps well to our elastic overscroll model.

### The lethargy library: inertial scroll detection

The `lethargy` library (571 stars, 612 bytes minified) takes a complementary approach. It does not classify the device; it classifies whether individual events are user-initiated or inertial. It keeps a rolling average of `wheelDelta` values and checks for consistent decay. If deltas are shrinking over consecutive events, the scroll is inertial; if they are stable or growing, the scroll is user-initiated.

This is useful for our `TrackpadGestureDetector` (which already does decay detection for momentum onset) but not directly for device classification. However, the lethargy-ts rewrite exposes a useful pattern: it tracks `increasingDeltasThreshold` (how many consecutive increasing deltas before declaring user-initiated), which is exactly the kind of multi-event analysis that our windowed classifier does.

### Google Maps: cooperative gesture handling

Google Maps created the industry standard for embedded-context scroll handling with their `gestureHandling: 'cooperative'` option. In cooperative mode, scroll without Ctrl is passed through to the parent page (allowing normal page scrolling), and only Ctrl+scroll is captured for zoom. An overlay message appears: "Use Ctrl + scroll to zoom the map."

This is not a classification solution, but it is a UX solution that eliminates the problem entirely for embedded contexts. Phase S5 of our roadmap considers adding this mode for scenarios where the VTT is embedded in another page.

---

## 5. The W3C gap: a decade of silence {#w3c-gap}

The W3C proposal for `WheelEvent.isInertialScrolling` (issue #56 on the `w3c/uievents` repository, split to issue #58) has been open since November 2015. It proposes adding a boolean `isInertialScrolling` property to `WheelEvent` that would be `true` for events generated by OS momentum scrolling. A companion proposal in issue #57 would add `directionInvertedFromDevice` to indicate whether "natural scrolling" is enabled.

As of early 2026, no major browser has implemented either property. The proposal has 26 thumbs-up reactions on issue #58, indicating developer demand, but zero implementation progress. The `InputDeviceCapabilities` API (Chrome-only) exposes `firesTouchEvents` but cannot distinguish mouse from trackpad.

The Pointer Events specification (Level 4, currently in development) was recently expanded to subsume Mouse and Wheel Events from the UI Events spec. But the Pointer Events working draft does not include `isInertialScrolling` or any device classification properties for wheel events. The `pointerType` property on `PointerEvent` distinguishes `'mouse'`, `'pen'`, and `'touch'`, but wheel events are `WheelEvent` (which extends `MouseEvent`), not `PointerEvent`, so `pointerType` is not available.

Bottom line: the platform will not help us. Heuristics are the only option. The lethargy-ts library's README puts it bluntly: "Sadly, right now there is no easy native way to tell if the wheel event was generated by the user or by inertia. You can change this by leaving an upvote and a comment in the W3C proposal ticket."

---

## 6. Designing the WheelDeviceClassifier {#classifier-design}

### Architecture decisions

**Sliding window, not running average.** The classifier maintains a fixed-size array of the most recent N event summaries. This is preferable to a running average because it forgets old events cleanly (after N new events, the old data is gone entirely) and it allows the scoring function to examine individual events in the window rather than just aggregate statistics. A window size of 6 provides enough events for confident classification (typically 3-4 events show a clear pattern) while being small enough that the classifier adapts quickly when the user switches devices.

**Signal counting, not weighted scoring.** Each signal contributes +1 to either `mouseSignals` or `trackpadSignals`. A weighted approach (where timing might count for 3 points and fractional deltas for 1 point) would be slightly more precise but harder to reason about, tune, and debug. The unweighted approach works because the signals are designed to be approximately equally informative: a single timing observation and a single fractional-delta observation provide roughly the same amount of evidence. If future testing reveals that some signals are much stronger than others, weights can be added.

**Asymmetric thresholds (hysteresis).** The threshold to switch from trackpad to mouse is higher (4 signals) than the threshold to switch from mouse to trackpad (2 signals). This implements the "default to pan" principle: it is harder to enter the zoom-triggering classification than to leave it. The numbers come from the roadmap, but the reasoning is simple. Mouse events produce many signals per event (timing + integer delta + no horizontal = 3 signals), so 4 signals can accumulate in just 2 events. Trackpad events also produce many signals per event (timing + fractional or both-axes = 2-3 signals), so 2 signals appear in the first event. The asymmetry is in the total required, not in the per-event yield.

**Silence resets to unknown.** After 400ms with no wheel events, the classifier resets to `'unknown'`. This handles device switching: if the user puts down the trackpad and picks up the mouse, there will be a natural gap of at least a few hundred milliseconds. After the reset, the first few events from the new device are classified with a lower threshold (2 mouse signals for initial classification from unknown, vs 4 to switch from trackpad to mouse), giving the new device a fair chance to establish itself.

**The first event always returns `'trackpad'` from `'unknown'`.** When the classifier is in the `'unknown'` state and receives an event, it needs at least 2 mouse signals to classify as mouse. Because the gap is zeroed after silence reset, the first event cannot produce a timing signal (Signal 1). It can only contribute non-timing signals: fractional deltas (Signal 2), simultaneous axes (Signal 3), deltaMode LINE (Signal 4), small deltas (Signal 5), or the large-integer-vertical check (Signal 6, but this also requires gap > 40ms, which is 0 after reset). In practice, the first event produces 0-1 mouse signals at most (e.g., deltaMode=1 in Firefox) and defaults to trackpad. This means the first wheel event after a silence period always routes to pan, which is the safe default.

### Constants and their rationale

```javascript
const CLASSIFIER_SILENCE_MS = 400;
```

Why 400ms? This is long enough that it definitely represents a pause in user input (not just a slow mouse wheel rotation, which maxes out around 200ms between notches) but short enough that the classifier resets promptly when the user switches devices. Mapbox uses 40ms for their debounce window, but their window serves a different purpose (accumulating events within a burst). Our silence threshold is about detecting the end of a device session.

```javascript
const CLASSIFIER_WINDOW_SIZE = 6;
```

Why 6 events? At 16ms per event (trackpad at 60Hz), 6 events accumulate in ~96ms, well under the 100ms "feels instantaneous" threshold. At 100ms per event (moderate mouse scrolling), 6 events take 600ms, which is longer but mouse classification typically locks in after 2-3 events. The window needs to be large enough to contain the pattern (3-4 events minimum for confident classification) and small enough to adapt quickly. 6 is the sweet spot identified in the roadmap after analysis of real scroll traces.

```javascript
const CLASSIFIER_MOUSE_THRESHOLD = 4;
const CLASSIFIER_TRACKPAD_THRESHOLD = 2;
```

The 2:1 ratio encodes the asymmetric cost of errors. Requiring 4 mouse signals before switching to mouse classification means the system needs at least 2 events with strong mouse characteristics (each contributing ~2 signals). Requiring only 2 trackpad signals to switch back means a single event with clear trackpad characteristics (fractional delta + fast timing = 2 signals) is sufficient to escape mouse classification. This is the hysteresis band: it takes more evidence to enter the dangerous state (mouse/zoom) than to leave it.

---

## 7. Complete annotated implementation {#implementation}

### The WheelDeviceClassifier class

This goes in `vtt/js/trackpad-gesture.js`, above or below the existing `TrackpadGestureDetector` class.

```javascript
// ============================================================
// Stateful Wheel Device Classifier
// ============================================================
//
// Maintains a running belief about whether the active input device
// is a mouse scroll wheel or a trackpad, updated incrementally as
// WheelEvents arrive. Replaces the stateless classifyWheelDevice()
// function that made per-event decisions.
//
// The classifier works by scoring a sliding window of recent events
// across six discriminative signals, then applying asymmetric
// thresholds (hysteresis) to prevent oscillation near the decision
// boundary.
//
// Design principles:
//   1. Default to 'trackpad' when uncertain (pan is safer than zoom)
//   2. Sticky once classified (require strong evidence to switch)
//   3. Reset to 'unknown' after silence (user may have switched devices)
//   4. Harder to enter mouse classification than to leave it
//
// The six signals, ranked by discriminative power:
//   - Inter-event timing: trackpad < 25ms, mouse > 80ms
//   - Fractional deltas: strong trackpad indicator
//   - Simultaneous deltaX + deltaY: strong trackpad indicator
//   - deltaMode LINE: strong mouse indicator (Firefox only)
//   - Very small deltas (< 4px): weak trackpad indicator
//   - Large integer-only vertical delta: weak mouse indicator
//     (This is the old classifyWheelDevice check, demoted to
//      one signal among six instead of the sole decider.)

// --- Configuration ---
//
// These constants control the classifier's sensitivity and stickiness.
// They were derived from the research synthesis and tuned against
// real-world scroll traces from macOS trackpad and standard mice.

/** Reset classification after this much silence between events. */
const CLASSIFIER_SILENCE_MS = 400;

/**
 * Number of recent events to consider when scoring.
 * 6 events at 16ms = ~96ms of history (well within perception threshold).
 * 6 events at 100ms = ~600ms of mouse history (classification locks
 * in well before the window fills for mouse input).
 */
const CLASSIFIER_WINDOW_SIZE = 6;

/**
 * Number of mouse-like signals required to switch FROM trackpad TO mouse.
 * This is deliberately high: 4 signals typically requires 2+ events
 * with strong mouse characteristics (timing gap > 80ms, integer delta,
 * no horizontal component).
 *
 * The high threshold implements the "default to pan" safety principle:
 * it is harder to enter the zoom-triggering mouse classification than
 * to leave it.
 */
const CLASSIFIER_MOUSE_THRESHOLD = 4;

/**
 * Number of trackpad-like signals required to switch FROM mouse TO trackpad.
 * This is deliberately low: a single event with a fractional delta and
 * fast timing produces 2 signals, enough to escape mouse classification.
 *
 * The low threshold means that if the user switches from mouse to
 * trackpad, the system detects the change on the very first trackpad event.
 */
const CLASSIFIER_TRACKPAD_THRESHOLD = 2;

export class WheelDeviceClassifier {
  constructor() {
    /** @type {'unknown' | 'mouse' | 'trackpad'} */
    this._device = 'unknown';

    /** @type {number} Timestamp of the last event processed */
    this._lastEventTime = 0;

    /**
     * Sliding window of recent event summaries.
     * Each entry captures the discriminative properties of one WheelEvent
     * without retaining a reference to the event itself (which would
     * prevent garbage collection of the DOM event).
     * @type {Array<{absX: number, absY: number, isFractional: boolean,
     *               hasBothAxes: boolean, deltaMode: number,
     *               gap: number, time: number}>}
     */
    this._events = [];
  }

  /**
   * Process a WheelEvent and return the current device classification.
   *
   * This is the main entry point. Call it once per wheel event, passing
   * the raw DOM WheelEvent. The classifier updates its internal state
   * and returns its current best guess.
   *
   * The return value is always 'mouse' or 'trackpad', never 'unknown'.
   * When the internal state is 'unknown' (after a silence reset or on
   * the very first event), the classifier defaults to 'trackpad' unless
   * the evidence for mouse is already strong.
   *
   * @param {WheelEvent} e - The raw DOM wheel event
   * @returns {'mouse' | 'trackpad'} Current device classification
   */
  classify(e) {
    const now = performance.now();
    let gap = now - this._lastEventTime;

    // -------------------------------------------------------
    // Step 1: Check for silence reset
    // -------------------------------------------------------
    // If enough time has passed since the last event, the user
    // may have switched devices. Reset to unknown so the new
    // device gets a fair chance to establish itself.
    //
    // 400ms was chosen because it is:
    //   - Longer than the slowest reasonable mouse wheel interval (~200ms)
    //   - Shorter than a natural device-switching pause (1-2 seconds)
    //   - Long enough to avoid false resets during brief scroll pauses
    //
    // IMPORTANT: After resetting, we zero the gap because the first
    // event after silence has no meaningful predecessor. Without this,
    // the artificial gap (now - 0 = ~1000ms+) would trigger the >80ms
    // mouse timing signal, biasing the very first event toward mouse
    // regardless of actual device type.
    if (gap > CLASSIFIER_SILENCE_MS) {
      this._device = 'unknown';
      this._events = [];
      gap = 0; // First event after silence has no meaningful predecessor
    }

    // -------------------------------------------------------
    // Step 2: Record event summary into the sliding window
    // -------------------------------------------------------
    this._events.push({
      absX: Math.abs(e.deltaX),
      absY: Math.abs(e.deltaY),
      isFractional: (e.deltaY % 1 !== 0) || (e.deltaX % 1 !== 0),
      hasBothAxes: e.deltaX !== 0 && e.deltaY !== 0,
      deltaMode: e.deltaMode,
      gap,
      time: now
    });

    // Trim to window size (FIFO: oldest events fall off)
    if (this._events.length > CLASSIFIER_WINDOW_SIZE) {
      this._events.shift();
    }

    this._lastEventTime = now;

    // -------------------------------------------------------
    // Step 3: Score the entire window
    // -------------------------------------------------------
    // Each signal in each event contributes +1 to the appropriate
    // counter. The totals represent accumulated evidence across
    // the window.
    const scores = this._scoreWindow();

    // -------------------------------------------------------
    // Step 4: Apply Bayesian-style update with hysteresis
    // -------------------------------------------------------
    // The current belief (this._device) acts as the prior.
    // The scores act as likelihood evidence.
    // The thresholds implement the hysteresis band.
    if (this._device === 'unknown') {
      // No prior belief: use a lower threshold for initial classification.
      // 2 mouse signals on the first event is possible but requires
      // strong evidence (e.g., deltaMode LINE + large gap). Most first
      // events produce 0-1 mouse signals and default to trackpad.
      if (scores.mouseSignals >= 2) {
        this._device = 'mouse';
      } else {
        // Safe default: treat as trackpad (routes to pan, not zoom)
        this._device = 'trackpad';
      }
    } else if (this._device === 'trackpad'
               && scores.mouseSignals >= CLASSIFIER_MOUSE_THRESHOLD) {
      // Strong mouse evidence overcomes trackpad prior.
      // Requires 4 signals, typically 2+ consistent mouse events.
      this._device = 'mouse';
    } else if (this._device === 'mouse'
               && scores.trackpadSignals >= CLASSIFIER_TRACKPAD_THRESHOLD) {
      // Even weak trackpad evidence overcomes mouse prior.
      // Requires only 2 signals, can happen on a single event
      // with fractional delta + fast timing.
      this._device = 'trackpad';
    }
    // Otherwise: belief unchanged. The prior holds.

    return this._device;
  }

  /**
   * Score all events in the sliding window, counting mouse-like
   * and trackpad-like signals.
   *
   * Each event is examined independently against six discriminative
   * criteria. A given event can contribute signals to both counters
   * (e.g., a fast event with a large integer delta contributes a
   * trackpad timing signal and a mouse delta signal). This is
   * intentional: ambiguous events contribute to both sides, and
   * the thresholds determine which side wins.
   *
   * @returns {{ mouseSignals: number, trackpadSignals: number }}
   * @private
   */
  _scoreWindow() {
    let mouseSignals = 0;
    let trackpadSignals = 0;

    for (const evt of this._events) {
      const maxDelta = Math.max(evt.absX, evt.absY);

      // ------ Signal 1: Inter-event timing ------
      // Trackpad: events arrive at display refresh rate (8-20ms)
      // Mouse: events arrive at human rotation speed (50-200ms+)
      // The first event after silence has gap === 0 (zeroed during
      // silence reset), so neither timing signal fires. This is
      // intentional: the first event is scored on non-timing signals
      // only, preventing artificial mouse bias from the large
      // time-since-silence gap.
      if (evt.gap > 0 && evt.gap < 25) trackpadSignals++;
      if (evt.gap > 80) mouseSignals++;

      // ------ Signal 2: Fractional deltas ------
      // Mouse wheels produce integers (or the macOS 4.000244140625).
      // Trackpads produce fractional values at low velocities.
      // This is a strong trackpad indicator because mice almost
      // never produce fractional deltas.
      if (evt.isFractional) trackpadSignals++;

      // ------ Signal 3: Simultaneous axes ------
      // Trackpad two-finger scroll naturally produces diagonal movement.
      // Mouse scroll wheels move one axis at a time.
      if (evt.hasBothAxes) trackpadSignals++;

      // ------ Signal 4: deltaMode LINE (Firefox only) ------
      // Firefox reports DOM_DELTA_LINE (1) for mouse wheels and
      // DOM_DELTA_PIXEL (0) for trackpads. This is essentially
      // perfect classification in Firefox, but useless in Chrome
      // and Safari (both always report 0).
      //
      // We only count deltaMode === 1 as a mouse signal; we do NOT
      // count deltaMode === 0 as a trackpad signal because it is
      // ambiguous in Chrome/Safari.
      if (evt.deltaMode === 1) mouseSignals++;

      // ------ Signal 5: Very small deltas (pixel mode only) ------
      // Mouse wheels have a minimum step size (typically >= 4px).
      // Trackpads at low velocity produce tiny deltas (0.5 to 3px).
      // IMPORTANT: Only check in pixel mode (deltaMode === 0).
      // In Firefox's line mode (deltaMode === 1), deltaY: 3 means
      // 3 lines (~48-96px), not 3 pixels. Without this guard, Firefox
      // mouse events with small line-unit values would be miscounted
      // as trackpad evidence.
      if (maxDelta > 0 && maxDelta < 4 && evt.deltaMode === 0) trackpadSignals++;

      // ------ Signal 6: Large integer vertical-only delta ------
      // This is the old classifyWheelDevice() check, now demoted
      // to one weak signal among six. A single event matching this
      // pattern contributes +1 mouse signal, not a classification
      // decision.
      // IMPORTANT: Requires gap > 40ms. Fast-arriving large deltas
      // (gap < 40ms) are trackpad momentum, not mouse wheel notches.
      // Without this timing guard, fast trackpad scrolls producing
      // deltaY: 80 would accumulate mouse signals that overwhelm the
      // timing-based trackpad signals (bug #4's root cause persists).
      if (maxDelta >= 50 && maxDelta % 1 === 0 && evt.absX === 0 && evt.gap > 40) {
        mouseSignals++;
      }
    }

    return { mouseSignals, trackpadSignals };
  }

  /**
   * Get current classification without processing a new event.
   * Returns 'trackpad' when internal state is 'unknown' (safe default).
   * @returns {'mouse' | 'trackpad'}
   */
  get device() {
    return this._device === 'unknown' ? 'trackpad' : this._device;
  }

  /**
   * Force reset to unknown state.
   * Useful when the gesture state machine changes modes (e.g., after
   * a pinch-zoom ends and the system should re-evaluate the next
   * batch of wheel events without bias).
   */
  reset() {
    this._device = 'unknown';
    this._events = [];
    this._lastEventTime = 0;
  }
}
```

### Why no weighted signals?

The roadmap and research discuss weighted scoring, but the implementation uses unweighted +1 per signal. Here is why:

Weighted scoring (e.g., timing = 3 points, fractional = 2 points, small delta = 1 point) would provide slightly more precise classification in edge cases, but it introduces calibration complexity. The weights would need to be tuned against a corpus of real-world scroll traces from multiple hardware configurations, and any weight change ripples through all the threshold constants.

Unweighted scoring works because the signals are designed to be approximately equally informative by construction. The timing check (`gap < 25ms` or `gap > 80ms`) only fires when the evidence is strong. The fractional check only fires for genuinely non-integer values. The simultaneous-axes check only fires when both axes have nonzero movement. Each signal is already thresholded to fire only on clear evidence, so each firing carries roughly the same weight.

If future real-world testing reveals that one signal is dramatically more or less informative than the others, adding weights is a trivial change: multiply each signal by its weight before accumulating. The threshold constants would need corresponding adjustment. But start simple and add complexity only when evidence demands it.

---

## 8. Restructured wheel handler routing in map-camera.js {#routing}

The wheel handler in `_attachWheelHandler()` currently has a structure that mixes device classification into the zoom/pan routing logic. The restructured version separates concerns cleanly: `normalizeWheel()` handles cross-browser normalization, the classifier handles device identification, and the wheel handler handles routing.

### The new _attachWheelHandler

Replace the wheel event listener setup inside `_attachWheelHandler()` in `vtt/js/map-camera.js`:

```javascript
_attachWheelHandler(el) {
  // Create the stateful classifier (replaces per-event classifyWheelDevice).
  // This instance lives for the lifetime of the camera and accumulates
  // evidence across all wheel events.
  this._wheelClassifier = new WheelDeviceClassifier();

  // The trackpad gesture detector handles lifecycle tracking for
  // trackpad scroll gestures (IDLE -> ACTIVE -> MOMENTUM -> IDLE).
  // Its callbacks manage gesture state, elastic overflow reset,
  // and snap-back triggering.
  this._trackpadDetector = new TrackpadGestureDetector({
    onGestureStart: () => {
      this._cancelInertialCoast();
      if (this._elasticAnimator) this._elasticAnimator.cancel();
      if (this._gestures) this._gestures.request('SCROLL_PAN');
      this._gestureActive = true;
      this._momentumScrollActive = false;
      this._cumulativeOverflowX = 0;
      this._cumulativeOverflowY = 0;
    },
    onMomentumStart: () => {
      this._momentumScrollActive = true;
    },
    onGestureEnd: () => {
      this._gestureActive = false;
      this._momentumScrollActive = false;
      if (this._gestures) {
        this._gestures.release('SCROLL_PAN');
        this._gestures.request('SNAP_BACK');
      }
      this._snapBackElastic();
    }
  });

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { dx, dy, dz } = normalizeWheel(e);

    // ==========================================================
    // Path 1: Zoom intent (Ctrl/Meta held, or pinch-to-zoom)
    // ==========================================================
    // normalizeWheel() sets dz !== 0 when ctrlKey or metaKey is
    // true. This covers:
    //   - Explicit Ctrl+scroll from any device
    //   - Trackpad pinch-to-zoom (browsers synthesize ctrlKey: true)
    //
    // Within the zoom path, we still classify the device to choose
    // the appropriate zoom behavior:
    //   - Mouse: smooth animated zoom (log-space lerp via SmoothZoomAnimator)
    //   - Trackpad: direct 1:1 zoom (user's fingers provide smoothing)
    //
    // This distinction matters because mouse wheel notches are coarse
    // and benefit from easing, while trackpad pinch is already smooth
    // and easing would add unwanted lag.
    if (dz !== 0) {
      const device = this._wheelClassifier.classify(e);
      const screen = this.eventToScreen(e);

      if (device === 'mouse') {
        // Mouse wheel + Ctrl: smooth animated zoom
        if (this._gestures) this._gestures.request('ZOOM_ANIMATE');
        this._smoothZoom.onWheelZoom(dz, screen.x, screen.y);
      } else {
        // Trackpad pinch: direct 1:1 zoom (no animation layer)
        if (this._gestures) this._gestures.request('PINCH_ZOOM');
        this.zoomAt(screen.x, screen.y, dz * -ZOOM_SENSITIVITY);
      }
      return;
    }

    // ==========================================================
    // Path 2: No Ctrl/Meta (scroll-only events)
    // ==========================================================
    // This is either:
    //   - Trackpad two-finger scroll (should pan)
    //   - Mouse scroll wheel without modifier (should zoom for mouse)
    //
    // The device classifier determines which path to take.
    if (dx !== 0 || dy !== 0) {
      const device = this._wheelClassifier.classify(e);

      if (device === 'mouse') {
        // Mouse scroll wheel without Ctrl: zoom at cursor.
        // This is the expected behavior for mouse wheel in canvas apps.
        // dy is in normalized pixel units; dividing by 100 gives a
        // zoom delta in the same scale as the dz path (~1.0 per notch).
        const screen = this.eventToScreen(e);
        if (this._gestures) this._gestures.request('ZOOM_ANIMATE');
        this._smoothZoom.onWheelZoom(dy / 100, screen.x, screen.y);
      } else {
        // Trackpad two-finger scroll: always pan.
        // The gesture detector tracks the lifecycle for elastic
        // overscroll and momentum detection.
        this._trackpadDetector.handleWheel(e);
        this.panBy(-dx, -dy);
      }
    }
  }, { passive: false });
}
```

### Key differences from the current implementation

**Before (current code):**
1. `normalizeWheel(e)` produces `{ dx, dy, dz }`
2. If `dz !== 0`: call `classifyWheelDevice(e)` per-event, route to zoom
3. If `dx !== 0 || dy !== 0`: call `classifyWheelDevice(e)` per-event, route based on result

**After (new code):**
1. `normalizeWheel(e)` produces `{ dx, dy, dz }` (unchanged)
2. If `dz !== 0`: call `this._wheelClassifier.classify(e)` (stateful), route to zoom
3. If `dx !== 0 || dy !== 0`: call `this._wheelClassifier.classify(e)` (stateful), route based on result

The structure is nearly identical. The critical change is that `classifyWheelDevice(e)` (stateless, per-event) is replaced by `this._wheelClassifier.classify(e)` (stateful, windowed). Everything downstream of the classification decision is unchanged: `SmoothZoomAnimator.onWheelZoom()` still handles mouse zoom, `panBy()` still handles trackpad pan, and the gesture detector still handles trackpad lifecycle.

This is intentional. The minimal diff makes the change easy to review, easy to test in isolation, and easy to revert if something unexpected surfaces.

---

## 9. Import changes and deprecation of classifyWheelDevice {#imports}

### In map-camera.js

Update the import statement:

```javascript
// OLD:
import { TrackpadGestureDetector, classifyWheelDevice } from './trackpad-gesture.js';

// NEW:
import { TrackpadGestureDetector, WheelDeviceClassifier } from './trackpad-gesture.js';
```

Remove the `classifyWheelDevice` import. The function is no longer called from `map-camera.js`.

### In trackpad-gesture.js

Keep the old `classifyWheelDevice` function exported but mark it deprecated:

```javascript
/**
 * @deprecated Use WheelDeviceClassifier instead. This stateless
 * per-event heuristic is the root cause of bugs #3, #4, and #5.
 * Retained for backward compatibility during Phase S1 transition.
 * Will be removed in Phase S5.
 *
 * Heuristic to classify a wheel event as mouse or trackpad.
 * Mouse wheels produce large integer deltas (>=50, integer, no horizontal).
 * Trackpad produces small/fractional deltas at high frequency.
 */
export function classifyWheelDevice(e) {
  const absY = Math.abs(e.deltaY);
  const absX = Math.abs(e.deltaX);
  const maxDelta = Math.max(absY, absX);
  if (maxDelta >= 50 && maxDelta % 1 === 0 && e.deltaX === 0) {
    return 'mouse';
  }
  return 'trackpad';
}
```

The existing unit tests in `tests/phase6-unit.spec.js` that test `classifyWheelDevice()` should continue to pass as-is (the function is unchanged). New tests for `WheelDeviceClassifier` go in a new test file, `tests/device-classifier.spec.js`.

---

## 10. Edge cases and exotic hardware {#edge-cases}

### Apple Magic Mouse

The Magic Mouse has a touch surface on top of a mouse form factor. When you swipe on it, macOS generates trackpad-like scroll events: fast timing, fractional deltas, simultaneous axes. The classifier will classify it as trackpad, which means swipe gestures pan instead of zoom.

This is actually correct behavior for this device. The Magic Mouse user is swiping with a finger, which is the same physical gesture as trackpad scrolling, and the user expects the same result (pan). If the user wants to zoom, they can hold Ctrl, or the future Phase S5 user preference toggle will let them configure scroll-to-zoom behavior explicitly.

### Logitech MX Master free-spin mode

When the MX Master's scroll wheel is unlocked into free-spin mode, it produces continuous events at high frequency with decaying deltas, mimicking trackpad momentum scroll. The classifier will see fast timing and potentially fractional deltas, likely classifying as trackpad.

Again, this is the safe default. Free-spin scroll produces the same event characteristics as a trackpad, and the user's intent is the same (continuous scrolling). If the user wants zoom, they re-engage the notched mode (which produces clean mouse-like events) or hold Ctrl.

### Microsoft Surface Precision Mouse (and similar gesture mice)

The Surface Precision Mouse has a gesture-sensitive surface. Gestures on the surface produce events that look like trackpad events. The classifier handles this correctly by classifying based on behavior, not device identity. When the user is gesturing, the events look like trackpad events and route to pan. When the user is clicking the scroll wheel notches, the events look like mouse events and route to zoom.

### High-refresh-rate displays (120Hz+)

On a 120Hz display, trackpad events arrive every ~8ms instead of ~16ms. The timing threshold (`gap < 25ms` for trackpad evidence) still captures this correctly because 8ms is well under 25ms. In fact, high refresh rates make the timing signal stronger: trackpad events are more tightly clustered, and the gap between trackpad timing (8ms) and mouse timing (50ms+) is wider.

No constant changes are needed for high-refresh-rate displays.

### Firefox deltaMode quirk

As of 2025/2026, Firefox still reports `deltaMode: DOM_DELTA_LINE` (value 1) for mouse wheel events. This has been stable for years and shows no sign of changing. The classifier treats it as one strong mouse signal, which means Firefox users get faster and more confident classification than Chrome/Safari users. After just one event with `deltaMode: 1`, the classifier has a strong mouse signal; combined with even one timing signal (`gap > 80ms`), the total reaches 2, enough for initial classification from unknown.

### Horizontal scroll wheels and tilt wheels

Some mice have a physical tilt mechanism on the scroll wheel for horizontal scrolling. These produce events with `deltaX !== 0, deltaY === 0`, which does not trigger the simultaneous-axes signal (Signal 4 requires both to be nonzero). They also do not trigger the large-integer-vertical signal (Signal 6 requires `absX === 0`). The classifier will evaluate them based on timing, deltaMode, and fractional checks. Since tilt events come from a mouse, they will have mouse-like timing and integer deltas, producing mouse classification. Correct.

If a user tilts and scrolls simultaneously (extremely rare), both axes will be nonzero from a mouse, triggering one false trackpad signal. This is tolerable because the timing and delta signals will still be mouse-like, producing a net mouse classification from the window scoring.

---

## 11. Testing protocols {#testing}

### Unit tests (new file: `tests/device-classifier.spec.js`)

These tests run inside `page.evaluate()` using dynamic import of the module, following the same pattern as the existing `tests/phase6-unit.spec.js`. They test the classifier's logic without DOM interaction or timing dependencies.

**Important testing pattern:** The classifier uses `performance.now()` for gap calculation, but in `page.evaluate()` the events are dispatched synchronously with no time passing between them. To test timing-dependent behavior, we need to mock `performance.now()` or feed pre-computed gap values. The cleanest approach: override `performance.now` inside `page.evaluate()` with a controllable clock.

```javascript
import { test, expect } from '@playwright/test';
import { gotoVTT, enterMapMode } from './helpers.js';

// Helper: create a mock wheel event with specific properties
function mockWheel(overrides = {}) {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    ...overrides
  };
}

test.describe('WheelDeviceClassifier', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/vtt/', { waitUntil: 'load' });
  });

  // ===========================================================
  // Test 1: Rapid small-delta events classify as trackpad
  // ===========================================================
  // Simulates slow trackpad scrolling: small fractional deltas
  // arriving at display refresh rate. This is the most common
  // trackpad pattern and should classify immediately.
  test('rapid small fractional deltas classify as trackpad', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const classifier = new WheelDeviceClassifier();

      // Mock performance.now to simulate 12ms intervals
      let mockTime = 1000;
      const originalNow = performance.now;
      performance.now = () => mockTime;

      const results = [];
      for (let i = 0; i < 5; i++) {
        mockTime += 12; // 12ms between events (trackpad at ~83Hz)
        const device = classifier.classify({
          deltaX: 0.5, deltaY: 3.5, deltaMode: 0
        });
        results.push(device);
      }

      performance.now = originalNow;
      return results;
    });

    // Every event should classify as trackpad
    for (const device of result) {
      expect(device).toBe('trackpad');
    }
  });

  // ===========================================================
  // Test 2: Large integer deltas with long gaps classify as mouse
  // ===========================================================
  // Simulates mouse wheel scrolling: large integer vertical deltas
  // arriving at human rotation speed. Should classify as mouse
  // after 2-3 events.
  test('large integer deltas with long gaps classify as mouse', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const classifier = new WheelDeviceClassifier();

      let mockTime = 1000;
      const originalNow = performance.now;
      performance.now = () => mockTime;

      const results = [];
      for (let i = 0; i < 3; i++) {
        mockTime += 150; // 150ms between events (casual mouse scrolling)
        const device = classifier.classify({
          deltaX: 0, deltaY: 120, deltaMode: 0
        });
        results.push(device);
      }

      performance.now = originalNow;
      return results;
    });

    // After 3 events with strong mouse signals, should be mouse
    expect(result[result.length - 1]).toBe('mouse');
  });

  // ===========================================================
  // Test 3: THE CRITICAL REGRESSION TEST
  // Fast large-delta trackpad events stay trackpad
  // ===========================================================
  // This is the exact scenario that causes bugs #3 and #4.
  // Fast two-finger trackpad scrolling on macOS produces integer
  // deltas of 80+ with no horizontal component, which the OLD
  // classifier misidentifies as mouse. The new classifier must
  // correctly identify these as trackpad based on fast timing.
  test('fast large-delta trackpad events stay trackpad', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const classifier = new WheelDeviceClassifier();

      let mockTime = 1000;
      const originalNow = performance.now;
      performance.now = () => mockTime;

      const results = [];
      for (let i = 0; i < 8; i++) {
        mockTime += 12; // 12ms intervals (fast trackpad)
        const device = classifier.classify({
          deltaX: 0, deltaY: 80, deltaMode: 0 // Large integer! Old bug trigger.
        });
        results.push(device);
      }

      performance.now = originalNow;
      return results;
    });

    // Despite large integer deltas, fast timing keeps it trackpad.
    // This is THE bug fix. The old classifier would return 'mouse'
    // for every one of these events.
    for (const device of result) {
      expect(device).toBe('trackpad');
    }
  });

  // ===========================================================
  // Test 4: Hysteresis prevents single ambiguous event from flipping
  // ===========================================================
  // After establishing trackpad classification with 5 clear events,
  // a single ambiguous event should not flip to mouse.
  test('hysteresis: single ambiguous event does not flip classification', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const classifier = new WheelDeviceClassifier();

      let mockTime = 1000;
      const originalNow = performance.now;
      performance.now = () => mockTime;

      // Establish trackpad with 5 clear events
      for (let i = 0; i < 5; i++) {
        mockTime += 12;
        classifier.classify({ deltaX: 2, deltaY: 5.5, deltaMode: 0 });
      }
      const beforeAmbiguous = classifier.device;

      // Feed one ambiguous event: large integer delta, but with
      // fast timing from the previous event
      mockTime += 14; // Still fast timing
      const afterAmbiguous = classifier.classify({
        deltaX: 0, deltaY: 100, deltaMode: 0
      });

      performance.now = originalNow;
      return { beforeAmbiguous, afterAmbiguous };
    });

    expect(result.beforeAmbiguous).toBe('trackpad');
    expect(result.afterAmbiguous).toBe('trackpad');
  });

  // ===========================================================
  // Test 5: Silence resets classification
  // ===========================================================
  // After classifying as mouse, a gap > 400ms followed by
  // trackpad-like events should result in trackpad classification.
  test('silence resets classification', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const classifier = new WheelDeviceClassifier();

      let mockTime = 1000;
      const originalNow = performance.now;
      performance.now = () => mockTime;

      // Establish mouse classification
      for (let i = 0; i < 3; i++) {
        mockTime += 150;
        classifier.classify({ deltaX: 0, deltaY: 120, deltaMode: 0 });
      }
      const beforeSilence = classifier.device;

      // Wait 500ms (exceeds CLASSIFIER_SILENCE_MS of 400ms)
      mockTime += 500;

      // Feed trackpad events
      const afterSilence = [];
      for (let i = 0; i < 3; i++) {
        mockTime += 12;
        afterSilence.push(classifier.classify({
          deltaX: 1, deltaY: 3.5, deltaMode: 0
        }));
      }

      performance.now = originalNow;
      return { beforeSilence, afterSilence };
    });

    expect(result.beforeSilence).toBe('mouse');
    // After silence + trackpad events, should be trackpad
    expect(result.afterSilence[result.afterSilence.length - 1]).toBe('trackpad');
  });

  // ===========================================================
  // Test 6: Fractional deltas are strong trackpad indicators
  // ===========================================================
  // Even with large magnitude, fractional deltas signal trackpad.
  test('fractional deltas override large magnitude', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const classifier = new WheelDeviceClassifier();

      let mockTime = 1000;
      const originalNow = performance.now;
      performance.now = () => mockTime;

      const results = [];
      for (let i = 0; i < 5; i++) {
        mockTime += 14;
        results.push(classifier.classify({
          deltaX: 0, deltaY: 75.5, deltaMode: 0
        }));
      }

      performance.now = originalNow;
      return results;
    });

    // Fractional delta + fast timing = always trackpad, despite
    // large magnitude (75.5 exceeds the old 50-threshold)
    for (const device of result) {
      expect(device).toBe('trackpad');
    }
  });

  // ===========================================================
  // Test 7: Simultaneous deltaX and deltaY are strong trackpad
  // ===========================================================
  test('simultaneous axes classify as trackpad despite large deltas', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const classifier = new WheelDeviceClassifier();

      let mockTime = 1000;
      const originalNow = performance.now;
      performance.now = () => mockTime;

      const results = [];
      for (let i = 0; i < 5; i++) {
        mockTime += 14;
        results.push(classifier.classify({
          deltaX: 30, deltaY: 100, deltaMode: 0
        }));
      }

      performance.now = originalNow;
      return results;
    });

    // Both axes + fast timing = trackpad
    for (const device of result) {
      expect(device).toBe('trackpad');
    }
  });

  // ===========================================================
  // Test 8: Firefox deltaMode LINE provides fast mouse classification
  // ===========================================================
  // Note: Requires 3 events (not 2) because the first event after
  // silence has gap=0 (silence reset zeroing), so it only contributes
  // Signal 4 (deltaMode=1) = 1 mouse signal. Events 2-3 each add
  // Signal 1 (gap>80) + Signal 4 (deltaMode=1) = 2 mouse signals.
  // Total after 3 events: 5 mouse signals, well above threshold.
  test('Firefox deltaMode LINE classifies mouse quickly', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const classifier = new WheelDeviceClassifier();

      let mockTime = 1000;
      const originalNow = performance.now;
      performance.now = () => mockTime;

      // Firefox mouse: deltaMode 1, integer deltas, long gaps
      mockTime += 200;
      classifier.classify({ deltaX: 0, deltaY: 3, deltaMode: 1 });
      mockTime += 150;
      classifier.classify({ deltaX: 0, deltaY: 3, deltaMode: 1 });
      mockTime += 150;
      const third = classifier.classify({
        deltaX: 0, deltaY: 3, deltaMode: 1
      });

      performance.now = originalNow;
      return { third };
    });

    // deltaMode LINE + large gap = mouse by third event
    expect(result.third).toBe('mouse');
  });

  // ===========================================================
  // Test 9: reset() clears state
  // ===========================================================
  test('reset clears classification to unknown/trackpad', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const classifier = new WheelDeviceClassifier();

      let mockTime = 1000;
      const originalNow = performance.now;
      performance.now = () => mockTime;

      // Establish mouse
      for (let i = 0; i < 3; i++) {
        mockTime += 150;
        classifier.classify({ deltaX: 0, deltaY: 120, deltaMode: 0 });
      }
      const beforeReset = classifier.device;

      classifier.reset();
      const afterReset = classifier.device;

      performance.now = originalNow;
      return { beforeReset, afterReset };
    });

    expect(result.beforeReset).toBe('mouse');
    // After reset, device getter returns 'trackpad' (safe default from unknown)
    expect(result.afterReset).toBe('trackpad');
  });

  // ===========================================================
  // Test 10: Device getter returns safe default when unknown
  // ===========================================================
  test('device getter returns trackpad when no events processed', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const classifier = new WheelDeviceClassifier();
      return classifier.device;
    });

    expect(result).toBe('trackpad');
  });

  // ===========================================================
  // Test 11: Window correctly discards old events
  // ===========================================================
  test('window slides: old mouse events are forgotten', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { WheelDeviceClassifier } = await import('/vtt/js/trackpad-gesture.js');
      const classifier = new WheelDeviceClassifier();

      let mockTime = 1000;
      const originalNow = performance.now;
      performance.now = () => mockTime;

      // Feed 3 mouse-like events
      for (let i = 0; i < 3; i++) {
        mockTime += 120;
        classifier.classify({ deltaX: 0, deltaY: 100, deltaMode: 0 });
      }
      const afterMouse = classifier.device;

      // Now feed 8 trackpad events (more than WINDOW_SIZE of 6,
      // pushing all mouse events out of the window)
      for (let i = 0; i < 8; i++) {
        mockTime += 12;
        classifier.classify({ deltaX: 1.5, deltaY: 4.2, deltaMode: 0 });
      }
      const afterTrackpad = classifier.device;

      performance.now = originalNow;
      return { afterMouse, afterTrackpad };
    });

    expect(result.afterMouse).toBe('mouse');
    expect(result.afterTrackpad).toBe('trackpad');
  });
});
```

### Integration tests (add to `tests/phase6-integration.spec.js`)

These tests verify the full pipeline: wheel event dispatch through normalization, classification, routing, and camera state change.

```javascript
// ===========================================================
// Integration Test: Fast trackpad scroll does NOT zoom
// ===========================================================
// This is the primary regression test for bugs #3 and #4.
// It dispatches rapid wheel events that mimic fast two-finger
// trackpad scrolling and verifies that the camera pans (position
// changes) without zooming (zoom stays constant).
test('fast trackpad scroll does not trigger zoom', async ({ page }) => {
  await gotoVTT(page);
  await enterMapMode(page);
  await injectTestAccessors(page);

  // Zoom in to create room to pan
  await page.evaluate(() => {
    const cam = __cam();
    cam.zoom = 2.0;
    cam._applyConstraints();
  });

  const before = await page.evaluate(() => {
    const cam = __cam();
    return { x: cam.x, y: cam.y, zoom: cam.zoom };
  });

  // Dispatch 10 rapid wheel events mimicking fast trackpad scroll.
  // These have large integer deltaY (80) with no horizontal,
  // which the OLD classifier would misidentify as mouse.
  // Dispatched with minimal delay to simulate real trackpad cadence.
  await page.evaluate(() => {
    const el = document.getElementById('map-container');
    for (let i = 0; i < 10; i++) {
      el.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -80,
        deltaX: 0,
        deltaMode: 0,
        ctrlKey: false,
        bubbles: true,
        cancelable: true
      }));
    }
  });

  // Small wait for any async processing
  await page.waitForTimeout(50);

  const after = await page.evaluate(() => {
    const cam = __cam();
    return { x: cam.x, y: cam.y, zoom: cam.zoom };
  });

  // Zoom should be unchanged (trackpad scroll = pan, not zoom)
  expect(after.zoom).toBeCloseTo(before.zoom, 4);

  // Position should have changed (we panned)
  const moved = Math.abs(after.y - before.y) > 1;
  expect(moved).toBe(true);
});

// ===========================================================
// Integration Test: Ctrl+wheel from trackpad does zoom
// ===========================================================
// Verifies that the zoom path still works correctly when Ctrl
// is held (trackpad pinch-to-zoom synthesizes ctrlKey: true).
test('ctrl+wheel from trackpad zooms correctly', async ({ page }) => {
  await gotoVTT(page);
  await enterMapMode(page);
  await injectTestAccessors(page);

  const before = await page.evaluate(() => __cam().zoom);

  // Dispatch wheel events with ctrlKey: true (pinch-to-zoom)
  await page.evaluate(() => {
    const el = document.getElementById('map-container');
    for (let i = 0; i < 5; i++) {
      el.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -5,
        deltaX: 0,
        deltaMode: 0,
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      }));
    }
  });

  await page.waitForTimeout(50);
  const after = await page.evaluate(() => __cam().zoom);

  // Zoom should have changed (Ctrl+wheel = zoom)
  expect(after).not.toBeCloseTo(before, 4);
});

// ===========================================================
// Integration Test: Mouse wheel without Ctrl zooms
// ===========================================================
// Verifies that actual mouse wheel events (long gaps, large
// integer deltas) still trigger zoom without requiring Ctrl.
test('mouse wheel without ctrl triggers zoom', async ({ page }) => {
  await gotoVTT(page);
  await enterMapMode(page);
  await injectTestAccessors(page);

  const before = await page.evaluate(() => __cam().zoom);

  // Dispatch mouse-like wheel events with realistic timing.
  // We use page.evaluate with setTimeout to introduce gaps.
  await page.evaluate(async () => {
    const el = document.getElementById('map-container');
    for (let i = 0; i < 3; i++) {
      el.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -100,
        deltaX: 0,
        deltaMode: 0,
        ctrlKey: false,
        bubbles: true,
        cancelable: true
      }));
      // Simulate mouse-like gap between events
      await new Promise(r => setTimeout(r, 120));
    }
  });

  // Wait for smooth zoom animation to settle
  await page.waitForFunction(() => {
    return !window.__vtt?.mapRenderer?.camera?._smoothZoom?._animating;
  }, { timeout: 2000 });

  const after = await page.evaluate(() => __cam().zoom);

  // Mouse wheel should zoom in (negative deltaY = zoom in after normalization)
  expect(after).toBeGreaterThan(before);
});
```

### Manual testing checklist

Because trackpad gesture handling is deeply tied to physical hardware behavior that cannot be perfectly simulated in Playwright, manual testing remains essential for this phase.

1. **Slow two-finger scroll on trackpad:** Camera pans smoothly in the direction of finger movement. No zoom changes.

2. **Fast two-finger scroll on trackpad (THE CRITICAL TEST):** Camera pans. Does NOT zoom. This is the bug that Phase S1 fixes. Test this aggressively: scroll as fast as you can with two fingers and verify the zoom indicator does not change.

3. **Pinch to zoom on trackpad:** Camera zooms at the cursor position. Smooth, proportional to finger spread.

4. **Pinch then immediately scroll:** Transitions cleanly from zoom to pan. No erratic behavior, no lingering zoom.

5. **Mouse scroll wheel (no modifier):** Camera zooms smoothly at the cursor position. Each notch produces a visible, consistent zoom step.

6. **Ctrl+mouse scroll wheel:** Camera zooms smoothly (same as above but with Ctrl held).

7. **Trackpad scroll with diagonal movement:** Camera pans diagonally. No misclassification to zoom.

8. **Very slow trackpad scroll (tiny deltas):** Camera pans with small, precise movements. No mistaken zoom.

---

## 12. Long-term tie-ins to future phases {#long-term}

### Phase S2 (Velocity-clamped spring snap-back)

Phase S1 ensures that trackpad scroll events reach `panBy()` and the elastic overscroll system instead of being misrouted to `SmoothZoomAnimator`. This means Phase S2's velocity clamping operates on the correct velocity values. If fast scrolls were misrouted to zoom (the pre-S1 bug), the elastic offset velocity would be zero (no overscroll occurred because no pan happened), and Phase S2's clamp would have nothing to clamp.

### Phase S3 (Speculative snap-back)

The speculative snap-back system monitors elastic offset growth rate. It depends on elastic offset values being generated by actual trackpad pan events. With the S1 fix, fast trackpad scrolls correctly produce elastic offset at the map boundary, and the speculative snap-back system has real data to monitor. Without S1, fast scrolls would zoom instead of pan, the camera would never reach the boundary, and the elastic system would never activate.

### Phase S4 (Hierarchical gesture coordination)

The `GestureStateMachine` tracks which gesture is active. Correct classification feeds the correct gesture type into the state machine: trackpad scroll feeds `SCROLL_PAN`, mouse wheel feeds `ZOOM_ANIMATE`. With S1's correct classification, the state machine stops oscillating between these states on consecutive events, which is the root cause of the "chattering" described in bug #5.

Phase S4 adds dwell time and cooldown to the gesture state machine. These mechanisms assume that the underlying classification is stable (the classifier is not flipping between mouse and trackpad on every event). S1's hysteresis provides that stability, making S4's dwell time effective rather than fighting against classification noise.

### Phase S5 (Unified spring physics)

Phase S5 adds a user preference toggle for scroll-wheel behavior (matching Figma's approach). The toggle will override the classifier entirely: if the user sets "scroll wheel = zoom," all non-Ctrl wheel events zoom regardless of classification. If the user sets "scroll wheel = pan," all non-Ctrl wheel events pan. The classifier continues to run (it is useful for choosing between smooth animated zoom and direct 1:1 zoom within the zoom path), but it no longer gates the zoom vs. pan routing decision.

This means Phase S1's classifier is not the final word on input routing. It is the intelligent default that works correctly for the majority of users without configuration. The Phase S5 preference toggle is the escape hatch for users with exotic hardware or unusual preferences.

### Phase 7 (Touch support)

Touch input arrives through `PointerEvent`, not `WheelEvent`, so it bypasses the wheel classifier entirely. But the architectural pattern established in S1, maintaining a stateful belief about input modality and updating it incrementally, is directly applicable to the multi-pointer tracker that Phase 7 will need. The same Bayesian reasoning applies: is this a two-finger pan or a two-finger pinch? Accumulate evidence across frames, default to the less disruptive interpretation, and use hysteresis to prevent oscillation.

### Camera presets (Phase 8)

No direct connection to Phase S1, but worth noting: correct input classification is a prerequisite for camera presets working smoothly. If the user scrolls to a location and saves a preset, and the scroll was misclassified as zoom (zooming to the wrong place), the preset captures the wrong camera state. Clean input routing means presets capture the intended state.

---

## 13. Migration checklist for Claude Code {#migration}

This is the ordered list of changes, each referencing the section above. Execute in order.

1. **Add the `WheelDeviceClassifier` class to `vtt/js/trackpad-gesture.js`.**
   - Add the four constants (`CLASSIFIER_SILENCE_MS`, `CLASSIFIER_WINDOW_SIZE`, `CLASSIFIER_MOUSE_THRESHOLD`, `CLASSIFIER_TRACKPAD_THRESHOLD`) above the class.
   - Add the class with `classify()`, `_scoreWindow()`, `device` getter, and `reset()`.
   - Add `export` to the class declaration.
   - Keep the existing `classifyWheelDevice()` function and its export. Add a `@deprecated` JSDoc tag.
   - See: [Section 7, Complete annotated implementation](#implementation)

2. **Update the import in `vtt/js/map-camera.js`.**
   - Change `classifyWheelDevice` to `WheelDeviceClassifier` in the import statement.
   - See: [Section 9, Import changes](#imports)

3. **Add `this._wheelClassifier` instantiation in `_attachWheelHandler()`.**
   - Create `new WheelDeviceClassifier()` at the top of the method.
   - See: [Section 8, Restructured wheel handler routing](#routing)

4. **Replace `classifyWheelDevice(e)` calls with `this._wheelClassifier.classify(e)`.**
   - Two call sites in the wheel event listener: the `dz !== 0` path and the `dx/dy !== 0` path.
   - See: [Section 8, Restructured wheel handler routing](#routing)

5. **Create `tests/device-classifier.spec.js`.**
   - Add all 11 unit tests from Section 11.
   - See: [Section 11, Testing protocols](#testing)

6. **Add integration tests to `tests/phase6-integration.spec.js`.**
   - Add the 3 integration tests from Section 11.
   - See: [Section 11, Testing protocols](#testing)

7. **Run all existing tests and verify no regressions.**
   - The existing `classifyWheelDevice` tests in `tests/phase6-unit.spec.js` should still pass (the function is unchanged).
   - The existing trackpad elastic overscroll tests should still pass (the elastic system is unchanged; only the routing into it changed).
   - The gesture preemption tests should still pass.

8. **Manual testing with real hardware.**
   - Follow the manual testing checklist in Section 11.
   - The critical test: fast two-finger trackpad scroll must pan, not zoom.
