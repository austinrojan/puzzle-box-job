# Eliminating black bars: a complete guide to viewport-filling VTT maps

**The solution to eliminating letterboxing in a custom VTT is straightforward in principle**: replace the hardcoded 1920×1080 layout with a camera system that calculates a "cover" zoom level — `Math.max(viewportWidth / mapWidth, viewportHeight / mapHeight)` — ensuring the map always fills every pixel of the browser window regardless of aspect ratio. This approach, borrowed from CSS `object-fit: cover` and game engine viewport systems, treats the map as an infinite-scroll surface centered in the viewport, cropping edges rather than adding black bars. The implementation uses CSS transforms on a container div (`transform: scale(z) translate(x, y)`) with GPU acceleration via `will-change: transform`, synced across your three-window architecture through throttled BroadcastChannel messages. What makes this work well is combining insights from six distinct industries — mapping libraries, game engines, whiteboard tools, video players, photo editors, and existing VTTs — into a unified camera model that handles zoom, pan, resize, and cross-window sync with one consistent mathematical framework.

---

## How existing VTTs handle (and mishandle) viewport filling

The current VTT landscape reveals that **no major platform has fully solved the viewport-filling problem**, creating a genuine competitive opportunity. Each platform's approach has instructive strengths and weaknesses.

**Foundry VTT** uses PixiJS (WebGL) to render a canvas with configurable scene padding (default 25%) around the map image. When zoomed out, users see the scene's background color in the padding area. There is no native "fit to fill" mode — users zoom and pan freely. The default zoom centers on the screen center rather than the cursor, which is so universally disliked that the community-built Zoom/Pan Options module became one of the platform's most popular add-ons. The community **Lock View** module adds autoscaling for digital tabletop setups, demonstrating clear demand for viewport-filling behavior.

**Roll20** recently migrated to Babylon.js and implemented texture atlasing and tiled image loading. However, it surrounds the playable area with **hardcoded grey hatched borders** that cannot be removed — the single most common display complaint on their forums. Zoom behavior is imprecise and "jumps all over the place" at extreme zoom levels because Roll20 uses linear zoom increments, which feel enormous at low zoom and imperceptible at high zoom. A controversial pan update removed momentum scrolling, making movement feel "stiff and jarring."

**Owlbear Rodeo** takes the most modern approach with an infinite canvas model and a custom GPU-based "Warp Core" engine. Maps are placed as objects on the canvas rather than defining its boundaries. The viewport reset command animates to fit the map. Its **High Performance mode** shows lower-resolution content during interaction and swaps to full resolution when idle — a clever tradeoff that prevents iPad crashes. The tiled rendering system supports up to **144 megapixels** via automatic mipmap generation.

**Fantasy Grounds** displays maps in resizable floating windows, not a full-screen canvas. Its most notable constraint: **you cannot zoom out past the image edge** in either dimension, which prevents users from ever seeing a map in its entirety if the window aspect ratio doesn't match. The zoom does correctly center on the cursor, demonstrating that this seemingly basic feature differentiates quality implementations.

**Alchemy RPG** takes a cinematic-first approach with full-screen "Story Mode" art and a tactical map layered on top. Its Zen Mode (Ctrl+Shift+Z) hides all UI, dedicating the entire screen to the map surface. This philosophy — **cinematic presentation over tactical precision** — offers a design model worth emulating for a theater/display-focused VTT window.

The most common community complaints across all platforms cluster around five pain points: zoom not centering on cursor position, wasted screen space from borders and letterboxing, performance degradation with large maps, poor trackpad/touch support, and inability to separate the map view from UI controls for multi-monitor setups.

---

## The mathematics of viewport-filling zoom

The core calculation that eliminates black bars is deceptively simple. Two fundamental "fit" modes exist, and understanding both is essential:

**Cover fit** (fills viewport, crops map edges): `coverZoom = Math.max(viewportWidth / mapWidth, viewportHeight / mapHeight)`. This guarantees no black bars by scaling the map so its *shorter* dimension fills the viewport, letting the *longer* dimension extend beyond the visible area. This is equivalent to CSS `object-fit: cover` and what you want as the default behavior.

**Contain fit** (shows entire map, may letterbox): `containZoom = Math.min(viewportWidth / mapWidth, viewportHeight / mapHeight)`. This shows the full map within the viewport, potentially with black bars on two sides. This is equivalent to CSS `object-fit: contain` and represents the state when the DM has intentionally zoomed out far enough to see all map edges.

The critical insight from game engine research, particularly **Godot's stretch mode system**, is a third option called **"expand"**: lock the vertical extent to the map height and let wider viewports simply reveal more horizontal map content (or vice versa). This wastes zero screen real estate and crops nothing, though it means players with different aspect ratios see slightly different amounts of the map. For a DM-controlled display window with a known aspect ratio, this is less relevant, but for player-facing windows it eliminates the contain-vs-cover tradeoff entirely.

**Zoom-toward-cursor** is the single most impactful UX improvement. The algorithm, formalized by Steve Ruiz (creator of tldraw), works in four steps: (1) convert cursor screen position to world coordinates at the old zoom, (2) update the zoom factor, (3) convert cursor screen position to world coordinates at the new zoom, (4) adjust camera offset by the difference. In code:

```javascript
const worldBefore = screenToWorld(cursorX, cursorY);
camera.zoom = clamp(camera.zoom * zoomFactor, minZoom, maxZoom);
const worldAfter = screenToWorld(cursorX, cursorY);
camera.x += worldBefore.x - worldAfter.x;
camera.y += worldBefore.y - worldAfter.y;
```

**Logarithmic zoom interpolation** solves the perceptual unevenness that plagues Roll20. Zoom is inherently multiplicative — doubling from 1× to 2× should feel identical to doubling from 4× to 8×. Linear interpolation breaks this, but `logerp(a, b, t) = a * Math.pow(b / a, t)` preserves it. For scroll wheel zoom, `newZoom = camera.zoom * Math.pow(2, deltaY * -0.01)` ensures each scroll tick produces a consistent perceptual change regardless of the current zoom level.

---

## The camera model: one abstraction to rule everything

Every application surveyed — from Figma to Leaflet to Photoshop to Unity — uses the same fundamental camera abstraction: **`Camera = { x, y, zoom }`** where x and y represent the world-space position of the viewport's top-left corner, and zoom is the scale factor. All viewport behavior derives from two conversion functions:

```javascript
screenToWorld(sx, sy) → { x: sx / zoom + camX, y: sy / zoom + camY }
worldToScreen(wx, wy) → { x: (wx - camX) * zoom, y: (wy - camY) * zoom }
```

This model renders via CSS transforms: `transform: scale(${zoom}) translate(${-x}px, ${-y}px)`. The parent container gets `overflow: hidden` to clip the map at viewport edges. The map image and all overlay layers (grid, fog of war, tokens) are children of the transformed container, so they all move and scale together automatically.

For the three-window architecture, the camera state is the single piece of data that must be synchronized. The Controller manipulates its own camera state, then broadcasts `{ x, y, zoom, timestamp }` to the Display and DM Guide windows via BroadcastChannel. Each receiving window applies the camera state to its own viewport, and because the math is resolution-independent, the same camera state produces correct results at any window size — the Display shows the same world region centered on the same point, with wider windows simply revealing more content at the edges.

**Transform order matters critically.** When using CSS `transform: scale(s) translate(x, y)`, the scale multiplies the translate values during browser interpolation, causing a "swooping" artifact during animated transitions. The fix: pre-multiply translate values by the scale factor, or use the separate CSS `scale` and `translate` properties (which apply translate first automatically).

---

## Window resize: the cover-zoom recalculation

When the browser window resizes, the solution is a ResizeObserver that recalculates the cover zoom floor and re-clamps the camera:

```javascript
const observer = new ResizeObserver(entries => {
  const { inlineSize: w, blockSize: h } = entries[0].contentBoxSize[0];
  const newCoverZoom = Math.max(w / mapWidth, h / mapHeight);
  camera.minZoom = newCoverZoom; // Update the floor
  if (camera.zoom < newCoverZoom) {
    camera.zoom = newCoverZoom; // Enforce the floor
    recenterCamera(); // Keep map centered when zoomed at cover level
  }
  applyTransform();
});
observer.observe(viewportElement);
```

This preserves the current behavior of smooth cropping during resize while eliminating black bars. When the viewport gets narrower, the map crops horizontally instead of adding pillarbox bars. When the viewport gets shorter, it crops vertically instead of adding letterbox bars. The **cover zoom becomes a dynamic floor** that adjusts with every resize event.

The DM can zoom in beyond the cover zoom (seeing less of the map) or zoom out past it (intentionally revealing map edges with a configurable background color). When zoomed at exactly the cover level, panning is constrained so the map edge never enters the viewport. When zoomed beyond cover, the boundary clamping adjusts proportionally.

---

## Boundary clamping with elastic overscroll

The boundary clamping algorithm must handle two distinct regimes. When the visible viewport (at current zoom) is **smaller than the map**, the camera position is clamped so map edges don't enter the viewport. When the visible viewport is **larger than the map** (zoomed out past contain), the map is centered with the DM's chosen background color surrounding it.

```javascript
function clampCamera(camera, mapW, mapH, vpW, vpH) {
  const visibleW = vpW / camera.zoom;
  const visibleH = vpH / camera.zoom;
  if (visibleW < mapW) {
    camera.x = clamp(camera.x, 0, mapW - visibleW);
  } else {
    camera.x = (mapW - visibleW) / 2; // Center horizontally
  }
  // Mirror for Y axis
}
```

For polish, **elastic overscroll** using Apple's logarithmic resistance curve (`rubberBand(offset) = maxOverscroll * Math.log10(1 + offset / maxOverscroll)`) lets users drag slightly past boundaries with diminishing returns, then snaps back with a critically damped spring animation on release. The snap-back uses `cubic-bezier(0.23, 1, 0.32, 1)` — an ease-out-quint curve — with approximately **750ms duration**, matching the iOS scrolling feel that users subconsciously expect.

---

## Performance architecture for smooth rendering

The **CSS transform approach is recommended over Canvas 2D or WebGL** for this use case. CSS transforms on a container div give automatic GPU compositing (skipping layout and paint entirely), native DOM event handling on child elements (tokens stay clickable without coordinate math), and the simplest codebase. The Fabric.js community documented cases where CSS transform panning was "dramatically smoother" than Canvas-based `zoomToPoint()`, which sometimes froze the browser.

The viewport container needs three CSS properties for optimal performance:

```css
.map-viewport { overflow: hidden; position: relative; }
.map-world {
  will-change: transform;    /* GPU compositing layer */
  contain: layout style paint; /* Rendering isolation */
}
```

**Memory implications are significant.** Each GPU compositing layer costs `width × height × 4 bytes`. A 4K map image consumes approximately **33MB of GPU memory** as a compositing layer. An 8K map at 132MB can crash mobile browsers. The recommendation is to keep map images at or below 4K resolution for the CSS transform approach, switching to tile-based rendering (à la Leaflet or Owlbear Rodeo's Warp Core) only for very large maps.

Input handling requires careful attention to browser differences. Trackpad pinch-to-zoom fires `wheel` events with `ctrlKey: true` on Chrome, Firefox, and Edge. Firefox reports `deltaMode: DOM_DELTA_LINE` with deltaY of ±1, while Chrome reports `DOM_DELTA_PIXEL` with deltaY of ±100+. All wheel listeners must use `{ passive: false }` to allow `preventDefault()`, and the viewport element needs `touch-action: none` in CSS to prevent browser-level gesture interference. State updates from input handlers should be batched into a single `requestAnimationFrame` callback to avoid rendering multiple times per frame.

For the multi-layer stack (map image, grid overlay, fog of war, token layer), all layers sit as children of the single transformed container. The map image should be a CSS `background-image` or `<img>` element with `decoding="async"`. The grid can be an SVG or `<canvas>`. Fog of war works best as an `<canvas>` element drawn once per update. Tokens are absolutely-positioned `<div>` elements that automatically transform with their parent.

---

## BroadcastChannel synchronization between windows

The three-window architecture requires a well-defined synchronization protocol. The Controller is the authority for camera state; Display and DM Guide are consumers. The recommended pattern:

**Throttle broadcasts to ~30fps** (every 33ms) during continuous interaction. Camera state serializes trivially as `{ x, y, zoom }` — three numbers. An **announce-on-connect** pattern handles window opening order: when the Display window opens, it sends `{ type: 'window-ready', role: 'display' }`, and the Controller responds with a full state snapshot including camera, fog, and token positions.

When the Controller and Display windows have **different dimensions** (which they almost always will), the same camera `{ x, y, zoom }` state produces correct but visually different results — both windows show the same center point at the same zoom level, but the wider window reveals more content at the edges. This is usually the desired behavior. If the DM wants the Display to show exactly a specific viewport rectangle, the Controller should send world-space bounds (`{ centerX, centerY, zoom }`) rather than its own camera position, and the Display calculates its own camera position from those bounds.

For animated viewport transitions (e.g., the DM clicking "jump to this location"), the Controller broadcasts a target state with animation parameters, and each receiving window independently animates its camera toward that target using exponential decay interpolation: `camera.x += (target.x - camera.x) * (1 - Math.exp(-speed * deltaTime))`. This is frame-rate independent and produces smooth results regardless of each window's refresh rate.

---

## Competitive edge opportunities no VTT implements well

Research across six industries reveals several features that could differentiate a custom VTT:

**Automatic content framing** is standard in design tools (Figma's "Zoom to Selection," AutoCAD's "Zoom Extents") but absent from VTTs. A "frame the action" button that calculates the bounding box of all active tokens and animates the camera to show them — using Mapbox's van Wijk & Nuij smooth zoom algorithm — would be genuinely novel. The fit-to-content math is straightforward: compute the token bounding box, add padding, then `fitZoom = Math.min(vpW / boundsW, vpH / boundsH)`.

**Cinematic camera transitions** borrowing from Mapbox's `flyTo` (which smoothly zooms out, pans, and zooms in along a mathematically optimal path) could enable DMs to create dramatic scene transitions. No VTT currently offers smooth, eased camera movements between locations — they all use instant teleportation or basic linear pans.

**The "expand" viewport model** from Godot game engine, where wider screens simply see more map rather than letterboxing, eliminates the cover-vs-contain compromise entirely. For a DM-controlled Display window, this means the DM could design encounters knowing the display will show at minimum a certain area, with bonus visibility at the edges for wider aspect ratios. tldraw's camera constraints system implements this exact pattern with per-axis `contain`, `inside`, or `outside` behavior options.

**Theater mode vs exploration mode** could offer distinct viewport behaviors: Theater mode locks the viewport to the DM's control (cover-fit, no player pan/zoom, cinematic transitions) while Exploration mode gives players independent viewport control within map boundaries. Alchemy RPG's Zen Mode demonstrates the appeal of a distraction-free, fully immersive display.

**Spectator-optimized layouts** for streaming could leverage the multi-window architecture by adding a fourth "Stream" window that composites the map with overlaid character portraits, initiative tracker, and dynamic health bars — all positioned to avoid occluding the action, using automatic content-area detection to find empty map regions for UI placement.

---

## Implementation roadmap for the three-window VTT

**Phase 1: Camera system foundation.** Replace the hardcoded 1920×1080 layout with the `Camera = { x, y, zoom }` model. Implement `screenToWorld`/`worldToScreen` conversions. Apply camera state via `transform: scale(z) translate(-x, -y)` on a `.map-world` container with `will-change: transform` and `contain: layout paint`. Add a ResizeObserver that recalculates cover zoom on window resize. This single change eliminates all black bars.

**Phase 2: Input handling.** Implement zoom-toward-cursor using the four-step algorithm. Normalize wheel events across browsers (deltaMode, ctrlKey for trackpad pinch). Use exponential zoom steps (`zoom *= Math.pow(2, delta * -0.01)`) for perceptually uniform zoom. Batch input updates to a single rAF callback. Prevent browser default zoom with `{ passive: false }` listeners.

**Phase 3: Boundary clamping and polish.** Implement the dual-regime clamping algorithm (constrain pan when zoomed in, center map when zoomed out). Add elastic overscroll with logarithmic resistance and spring snap-back. Set the minimum zoom to cover zoom (no black bars) by default, with the DM option to zoom past it.

**Phase 4: BroadcastChannel sync.** Broadcast camera state from Controller at 30fps throttle. Implement announce-on-connect for late-joining windows. Handle different window dimensions by sharing world-space camera state. Add animated transitions with frame-rate-independent exponential interpolation.

**Phase 5: Advanced features.** Add fit-to-tokens (auto-frame action). Implement Mapbox-style `flyTo` for cinematic camera movements. Add DM presets for saved camera positions. Consider tiled rendering for maps exceeding 4K resolution. Implement semantic zoom (show/hide grid labels, token names based on zoom level).

The entire Phase 1-3 implementation requires approximately **200-300 lines of JavaScript** for the camera system, input handling, and boundary clamping — with no framework dependencies. The mathematical foundations are well-established across every application surveyed, and the CSS transform approach avoids the rendering complexity of Canvas or WebGL while delivering GPU-accelerated 60fps performance for maps up to 4K resolution.

## Conclusion

The viewport-filling problem has been solved independently by mapping libraries, game engines, design tools, and whiteboard applications — all converging on the same camera abstraction and coordinate transformation math. The VTT industry has largely failed to adopt these solutions, with most platforms still shipping zoom-to-center-of-screen, linear zoom increments, and unconfigurable letterboxing. The gap between what browser technology enables and what VTTs deliver represents a genuine opportunity. By implementing a cover-fit camera system with logarithmic zoom, cursor-centered scaling, elastic boundary clamping, and ResizeObserver-driven viewport adaptation, a vanilla JS VTT can achieve viewport behavior that exceeds every commercial competitor — using approximately 300 lines of framework-free code and the same mathematical principles that power Google Maps, Figma, and every modern game engine.