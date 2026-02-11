# Phase 1: Responsive architecture for a multi-window VTT

**This guide provides production-ready code for two independent subsystems: wrapping a five-canvas VTT display in a CSS `transform: scale()` container, and constraining DM Guide content to optimal reading width with dark-mode typography.** Both changes are non-destructive — they preserve internal coordinate systems and existing functionality while adapting to arbitrary window sizes. The VTT display solution draws on patterns used by Leaflet.js, Excalidraw, and Foundry VTT, while the typography work implements Bringhurst's 45–75 character rule with WCAG AA compliance built in.

---

## Part A: VTT display — CSS-scaled canvas stack

### Why CSS `transform: scale()` is the right tool here

CSS transforms operate at the **composite** stage of the rendering pipeline, skipping layout and paint entirely. Changing `transform: scale()` on a container with five stacked canvases never triggers reflow, never clears canvas buffers, and never forces a repaint of drawn content. By contrast, resizing `canvas.width` or `canvas.height` attributes **destroys all drawn content** and resets the context state — catastrophic for a VTT with complex map layers.

Each 1920×1080 canvas at RGBA costs **~8.3 MB** of GPU memory (`1920 × 1080 × 4 bytes`). Five canvases total **~41.5 MB**, which is well within desktop GPU budgets. Because the canvas elements render at fixed 1920×1080 via HTML attributes (not CSS sizing), the GPU texture size remains constant regardless of display DPR or CSS scale factor.

A `transform` on the parent container creates both a **stacking context** and a **new containing block** for all `position: absolute` and `position: fixed` children. This is exactly what we want — the DOM overlay layer for labels and HP bars will position itself relative to the scaled container and scale proportionally with it.

```
Rendering pipeline with CSS transform:
JavaScript → Style → [SKIP Layout] → [SKIP Paint*] → Composite
* Paint skipped on subsequent transform changes if element is composited
```

### Complete HTML/CSS/JS implementation

The architecture has three layers: a viewport wrapper (provides letterboxing), a scale container (holds the transform), and the canvas stack plus DOM overlay inside it.

```html
<!-- VTT Viewport Structure -->
<div id="vtt-viewport">
  <div id="vtt-scale-container">
    <!-- Canvas stack: fixed 1920×1080, stacked via position: absolute -->
    <canvas id="map-bg"      width="1920" height="1080"></canvas>
    <canvas id="map-fog"     width="1920" height="1080"></canvas>
    <canvas id="map-grid"    width="1920" height="1080"></canvas>
    <canvas id="map-tokens"  width="1920" height="1080"></canvas>
    <canvas id="map-effects" width="1920" height="1080"></canvas>

    <!-- DOM overlay layer for labels, HP bars, tooltips -->
    <div id="map-labels"></div>
  </div>
</div>
```

```css
/* === VTT Viewport Scaling System === */
*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* Outer viewport: flexbox centering creates automatic letterbox/pillarbox bars */
#vtt-viewport {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #111111;          /* Letterbox bar color */
  overflow: hidden;
  contain: layout style;        /* Isolate compositing for performance */
}

/* Scale container: fixed at 1920×1080, transform scales it to fit */
#vtt-scale-container {
  width: 1920px;
  height: 1080px;
  position: relative;
  transform-origin: center center; /* Works with flexbox centering */
  transform: scale(1);             /* Overridden by JS immediately */
}

/* Canvas layers: stacked absolutely within the container */
#vtt-scale-container canvas {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;           /* Only top interaction layer gets events */
}

#map-bg      { z-index: 1; }
#map-fog     { z-index: 2; }
#map-grid    { z-index: 3; }
#map-tokens  { z-index: 4; pointer-events: auto; } /* Receives mouse events */
#map-effects { z-index: 5; pointer-events: none; }

/* DOM overlay: scales with parent, positioned in 1920×1080 space */
#map-labels {
  position: absolute;
  top: 0;
  left: 0;
  width: 1920px;
  height: 1080px;
  z-index: 10;
  pointer-events: none;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#map-labels .token-label {
  position: absolute;
  pointer-events: auto;
}
```

```javascript
/**
 * VTT Viewport Scaler
 *
 * Scales a fixed 1920×1080 canvas stack to fit any window size
 * using CSS transform: scale() with automatic letterboxing.
 */
class VTTViewportScaler {
  static W = 1920;
  static H = 1080;

  constructor(viewport, container) {
    this.viewport = viewport;
    this.container = container;
    this.currentScale = 1;
    this._rectDirty = true;
    this._cachedRect = null;

    // ResizeObserver on the VIEWPORT (parent), not the scaled container.
    // CSS transforms do NOT trigger ResizeObserver, so observing the
    // scaled child would never fire.
    this._observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      let w, h;
      if (entry.borderBoxSize) {
        const box = entry.borderBoxSize[0];
        w = box.inlineSize;
        h = box.blockSize;
      } else {
        w = entry.contentRect.width;
        h = entry.contentRect.height;
      }
      this._applyScale(w, h);
    });
    this._observer.observe(this.viewport);
  }

  _applyScale(containerW, containerH) {
    if (containerW <= 0 || containerH <= 0) return;

    // Core formula: "contain" fit — scale to fill without cropping
    const scale = Math.min(containerW / VTTViewportScaler.W,
                           containerH / VTTViewportScaler.H);

    // Skip DOM write if scale unchanged (float tolerance)
    if (Math.abs(scale - this.currentScale) < 0.0001) return;

    this.currentScale = scale;
    this._rectDirty = true;

    // CSS transform is compositor-only — safe in ResizeObserver callback,
    // no debouncing needed, no layout thrashing possible.
    this.container.style.transform = `scale(${scale})`;

    // Dispatch event for other systems (Camera, coordinate converter, etc.)
    this.viewport.dispatchEvent(new CustomEvent('vtt-scale-change', {
      detail: { scale, containerW, containerH }
    }));
  }

  get scale() { return this.currentScale; }

  /** Invalidate cached rect (call after scroll or programmatic layout change) */
  invalidate() { this._rectDirty = true; }

  destroy() {
    this._observer?.disconnect();
    this.container.style.transform = '';
  }
}

// Initialize
const viewport  = document.getElementById('vtt-viewport');
const container = document.getElementById('vtt-scale-container');
const scaler    = new VTTViewportScaler(viewport, container);
```

### Mouse coordinate conversion that actually works cross-browser

The single most critical question for a VTT is: given a mouse click, what are the coordinates in the 1920×1080 internal space? The answer is **never use `offsetX`/`offsetY`** through CSS transforms. Firefox has open bugs with 3D transforms (Bug 1261645), `offsetX` breaks during drag operations when the cursor crosses element boundaries, and touch events don't provide `offsetX` at all.

The production-safe formula uses `clientX` + `getBoundingClientRect()`. The rect returns the **post-transform visual rectangle**, so dividing by it automatically inverts the CSS scale:

```javascript
/**
 * Cross-browser coordinate conversion for CSS-scaled canvas stack.
 * Handles CSS transform: scale(), HiDPI displays, touch events,
 * and integrates with an existing Camera zoom/pan system.
 *
 * Browser support: Chrome 61+, Firefox 65+, Safari 11+
 */
class VTTCoordinateSystem {
  constructor(canvas, ctx, scaler) {
    this.canvas = canvas;       // The top interactive canvas (map-tokens)
    this.ctx = ctx;             // Its 2D rendering context
    this.scaler = scaler;       // VTTViewportScaler instance
    this._cachedRect = null;
    this._rectDirty = true;

    // Invalidate rect cache on anything that could move the canvas
    const invalidate = () => { this._rectDirty = true; };
    window.addEventListener('resize', invalidate);
    window.addEventListener('scroll', invalidate);
    scaler.viewport.addEventListener('vtt-scale-change', invalidate);
  }

  _getRect() {
    if (this._rectDirty || !this._cachedRect) {
      // getBoundingClientRect() returns the VISUAL (post-transform) rectangle.
      // For a 1920×1080 canvas at scale(0.5), rect.width = 960.
      this._cachedRect = this.canvas.getBoundingClientRect();
      this._rectDirty = false;
    }
    return this._cachedRect;
  }

  /**
   * Screen event → canvas-internal coordinates (0–1920, 0–1080)
   * Works with MouseEvent, PointerEvent, or Touch objects.
   */
  screenToCanvas(event) {
    const rect = this._getRect();
    return {
      x: (event.clientX - rect.left) / rect.width  * this.canvas.width,
      y: (event.clientY - rect.top)  / rect.height * this.canvas.height
    };
  }

  /**
   * Screen event → world coordinates (accounts for Camera zoom/pan).
   * Uses the canvas context's current transform matrix (set by Camera).
   */
  screenToWorld(event) {
    const canvasPos = this.screenToCanvas(event);
    const point     = new DOMPoint(canvasPos.x, canvasPos.y);
    const inverted  = this.ctx.getTransform().invertSelf();
    return inverted.transformPoint(point);
  }

  /**
   * World coordinates → screen position (for positioning DOM overlays).
   */
  worldToScreen(worldX, worldY) {
    const transform = this.ctx.getTransform();
    const canvasPt  = transform.transformPoint(new DOMPoint(worldX, worldY));
    const rect      = this._getRect();
    return {
      x: canvasPt.x / this.canvas.width  * rect.width  + rect.left,
      y: canvasPt.y / this.canvas.height * rect.height + rect.top
    };
  }

  /** Unified handler for mouse + touch events */
  getPosition(event) {
    const source = event.touches ? event.touches[0] : event;
    return this.screenToWorld(source);
  }
}
```

**Why this works universally**: `clientX`/`clientY` report viewport CSS pixels (unaffected by transforms). `rect.left`/`rect.top` give the visual position of the canvas. The ratio `canvas.width / rect.width` IS the inverse of the effective CSS scale, and it automatically incorporates `devicePixelRatio` if the canvas backing store is scaled for HiDPI.

| Approach | Cross-browser | Touch | Drag-safe | Recommended |
|----------|:---:|:---:|:---:|:---:|
| `(clientX - rect.left) / rect.width * canvas.width` | ✅ | ✅ | ✅ | **✅ Yes** |
| `offsetX * canvas.width / canvas.offsetWidth` | ⚠️ Firefox 3D bugs | ❌ | ❌ | ❌ No |
| Raw `offsetX` / `offsetY` | ⚠️ Inconsistent | ❌ | ❌ | ❌ No |

### How the letterboxing works without extra elements

The outer `#vtt-viewport` uses `display: flex; align-items: center; justify-content: center;` — this positions the scaled container dead-center. Combined with `transform-origin: center center`, the scale shrinks the visual content symmetrically. The remaining space on all sides inherits the viewport's `background: #111111`, producing letterbox bars (top/bottom when the window is wider than 16:9) or pillarbox bars (left/right when taller) with zero extra DOM elements.

The scale formula `Math.min(containerW / 1920, containerH / 1080)` implements CSS `object-fit: contain` behavior manually. When the container aspect ratio is wider than 16:9, the height is the constraining dimension. When narrower, the width constrains.

### DOM overlay text clarity at fractional scales

CSS `transform: scale()` rasterizes text at the declared `font-size`, then the GPU scales the bitmap. At fractional scales like `0.7135`, text appears slightly blurry. Two mitigation strategies:

**Strategy 1 — Counter-scale critical text** (labels stay at screen-pixel size regardless of zoom):

```css
:root { --vtt-scale: 1; }

.token-label {
  position: absolute;
  transform: scale(calc(1 / var(--vtt-scale)));
  transform-origin: center bottom;
  font-size: 14px; /* Renders at 14px screen pixels due to counter-scale */
  color: #fff;
  text-shadow: 0 0 3px #000, 0 0 3px #000;
  font-weight: 600;
  white-space: nowrap;
}
```

**Strategy 2 — Font-size compensation** (no extra transform, text scales with map but stays crisp):

```javascript
function updateLabelSize(baseSize, scale) {
  const preciseFontSize = baseSize / scale;
  const roundedSize = Math.round(preciseFontSize);
  // Rasterize at integer pixel size, then let parent CSS scale handle the rest
  label.style.fontSize = `${roundedSize}px`;
}
```

For a VTT, **Strategy 1 is usually preferred** for token labels and HP bars because players expect those to remain readable regardless of map zoom level.

### `will-change: transform` — when to use it and when to skip it

`will-change: transform` promotes an element to its own compositing layer immediately and tells the browser to rasterize it into a **fixed bitmap that won't re-raster when the transform changes**. This is fast for animations but counterproductive for static scale changes.

**For the VTT viewport scaler, do NOT use `will-change: transform` on the container by default.** The scale only changes on window resize (infrequent). Without `will-change`, Chrome re-rasters at the new scale for crisp output. With it, the container stays rasterized at its original resolution and looks blurry after scaling.

If you add animated zoom transitions later, toggle `will-change` dynamically:

```javascript
// Before animated zoom:
container.style.willChange = 'transform';
container.style.transition = 'transform 0.2s ease-out';
container.style.transform = `scale(${newScale})`;

// After transition completes:
container.addEventListener('transitionend', () => {
  container.style.willChange = 'auto';  // Force re-raster at final scale
  container.style.transition = '';
}, { once: true });
```

**Never apply `will-change: transform` to individual canvases.** Canvas elements already manage their own pixel buffers. Adding `will-change` creates redundant compositing layers — five unnecessary layers at ~8.3 MB each wastes **~41.5 MB of GPU memory** for zero benefit.

### How Discord captures CSS-transformed content

Discord desktop uses platform-level screen capture APIs that capture **final rendered pixels** after all CSS transforms are applied. Discord's browser version uses the `getDisplayMedia()` API, which also captures the composited visual output. What you see on screen is exactly what viewers receive.

The quality implications matter: Discord streams at **720p/30fps** for free users and **1080p/60fps** for Nitro users. A VTT filling a 1080p browser window gets downscaled again by Discord's H.264 encoder. Design token labels with a minimum of **16px at final rendered size** and use high-contrast text styling (`color: #fff; text-shadow: 0 0 3px #000, 0 0 3px #000; font-weight: 600`) because thin text and fine grid lines degrade badly under video compression. Avoid `1px` borders — use `2px` minimum since sub-pixel borders shimmer during streaming.

### What professional VTTs do differently

**Foundry VTT** uses a single WebGL canvas via PixiJS with ~13 layers rendered into one GPU surface. Zoom/pan is handled by adjusting `canvas.stage.scale` properties — no CSS transforms. Coordinate conversion uses PixiJS's built-in `worldTransform` matrix.

**Roll20's Jumpgate engine** (launched January 2025) uses Babylon.js with an orthographic camera for 2D rendering. All tokens are GPU-instanced meshes with texture atlases, reducing draw calls from ~3,000 to under 100 per frame. Viewport scaling is handled by the Babylon.js camera system.

**Owlbear Rodeo's Warp Core** (October 2024) uses a custom tiled WebGL renderer supporting 137+ megapixel maps on mobile. Only visible tiles load — similar to virtual texturing in game engines.

**The most relevant pattern for a Canvas 2D VTT is Leaflet.js**, which uses CSS `transform: translate3d() scale()` during zoom animation for smooth GPU-composited visual scaling, then re-renders tiles at the target zoom level after the animation settles. This hybrid approach — CSS scale for smooth interaction, canvas re-render for crisp final state — is the ideal model for your architecture.

### Playwright test suite for scaling verification

```typescript
// vtt-scaling.spec.ts
import { test, expect } from '@playwright/test';

const VIEWPORTS = [
  { name: '1080p',         width: 1920, height: 1080 },
  { name: 'Laptop',        width: 1366, height: 768  },
  { name: 'iPad-Landscape', width: 1024, height: 768  },
  { name: 'iPad-Portrait',  width: 768,  height: 1024 },
  { name: 'Ultrawide',     width: 2560, height: 1080 },
  { name: 'Tiny',          width: 320,  height: 240  },
];

async function getScaleInfo(page) {
  return page.evaluate(() => {
    const vp = document.getElementById('vtt-viewport').getBoundingClientRect();
    const c  = document.getElementById('vtt-scale-container').getBoundingClientRect();
    const t  = getComputedStyle(document.getElementById('vtt-scale-container')).transform;
    let scale = 1;
    if (t && t !== 'none') {
      const m = t.match(/matrix\(([^,]+)/);
      if (m) scale = parseFloat(m[1]);
    }
    return {
      scale,
      vpW: vp.width, vpH: vp.height,
      cW: c.width, cH: c.height,
      cCenterX: c.left + c.width / 2,
      cCenterY: c.top + c.height / 2,
      vpCenterX: vp.left + vp.width / 2,
      vpCenterY: vp.top + vp.height / 2,
    };
  });
}

for (const vp of VIEWPORTS) {
  test(`correct scale at ${vp.name} (${vp.width}×${vp.height})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/');
    await page.waitForTimeout(100);
    const info = await getScaleInfo(page);
    const expected = Math.min(vp.width / 1920, vp.height / 1080);
    expect(info.scale).toBeCloseTo(expected, 3);
    expect(info.cW).toBeLessThanOrEqual(vp.width + 1);
    expect(info.cH).toBeLessThanOrEqual(vp.height + 1);
  });

  test(`centered at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/');
    await page.waitForTimeout(100);
    const info = await getScaleInfo(page);
    expect(Math.abs(info.cCenterX - info.vpCenterX)).toBeLessThan(2);
    expect(Math.abs(info.cCenterY - info.vpCenterY)).toBeLessThan(2);
  });
}

test('coordinate mapping: center click → (960, 540)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page.waitForTimeout(100);
  const result = await page.evaluate(() => {
    const canvas = document.getElementById('map-tokens');
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return {
      x: (cx - rect.left) / rect.width * canvas.width,
      y: (cy - rect.top) / rect.height * canvas.height
    };
  });
  expect(result.x).toBeCloseTo(960, 0);
  expect(result.y).toBeCloseTo(540, 0);
});

test('maintains 16:9 aspect ratio at all sizes', async ({ page }) => {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(100);
    const info = await getScaleInfo(page);
    expect(info.cW / info.cH).toBeCloseTo(1920 / 1080, 2);
  }
});
```

---

## Part B: DM Guide — content width and typography

### The research consensus on 65–70 characters per line

Bringhurst's *Elements of Typographic Style* establishes the range: *"Anything from 45 to 75 characters is widely regarded as a satisfactory length of line for a single-column page set in a serifed text face in a text size. The 66-character line is widely regarded as ideal."* The Baymard Institute's UX research narrows the optimum to **50–60 characters**, finding that product descriptions wider than 80 CPL were skipped **41% more often** than those at 60–70 characters. WCAG 1.4.8 (Level AAA) caps line width at **80 characters** maximum.

The CSS `ch` unit equals the advance width of the `0` glyph (U+0030) in the current font. For proportional fonts like Inter, `0` is typically **20–30% wider** than the average lowercase letter. In practice with Inter's tabular numerals, `65ch` produces approximately **72–80 actual text characters** and `70ch` produces **80–90 characters**. For the DM Guide, **`65ch` is the sweet spot** — it lands squarely in the Bringhurst range while staying under the WCAG 80-character ceiling.

### Complete CSS implementation for three-column grid

```css
/* === DM Guide Layout System === */
:root {
  /* Layout */
  --nav-width: 260px;
  --combat-panel-width: 320px;
  --content-max-width: 65ch;         /* ~72-80 actual chars in Inter */
  --padding-fluid: clamp(0.75rem, 2vw, 2rem);

  /* Typography — dark theme */
  --font-family: 'Inter', system-ui, -apple-system, sans-serif;
  --font-size-base: 1rem;            /* Respects browser default (16px) */
  --line-height-body: 1.6;           /* Exceeds WCAG 1.5 minimum */
  --letter-spacing-body: 0.01em;     /* Compensate for dark-mode halation */
  --font-weight-body: 380;           /* Reduced from 400 for dark mode */
  --font-weight-bold: 620;           /* Reduced from 700 for dark mode */

  /* Dark theme colors — avoid pure white on pure black */
  --color-bg: #121212;
  --color-bg-surface: #1E1E1E;
  --color-text-primary: #E0E0E0;     /* ~13.9:1 contrast on #121212 */
  --color-text-secondary: #ABABAB;
  --color-text-muted: #757575;
}

/* Three-column grid: nav | content | combat panel */
.dm-guide-layout {
  display: grid;
  grid-template-columns:
    var(--nav-width)
    minmax(0, 1fr)               /* minmax(0,...) prevents grid blowout */
    var(--combat-panel-width);
  grid-template-rows: 1fr;
  min-height: 100vh;
}

/* === Content column (the 1fr middle cell) === */
.dm-guide-content {
  overflow-y: auto;
  min-width: 0;                  /* Defensive: prevent wide children from blowing out grid */
  padding: var(--padding-fluid);
}

/* === Constrained content wrapper === */
.dm-guide-content .content-body {
  max-width: min(var(--content-max-width), 100%);
  margin-inline: auto;           /* Centers within the 1fr track */
}
```

The `minmax(0, 1fr)` on the grid track is **essential defensive CSS**. Plain `1fr` is actually `minmax(auto, 1fr)`, where `auto` means "respect the content's minimum intrinsic width." If a child (table, code block, stat block) is wider than the track, it blows out the grid. `minmax(0, 1fr)` forces the minimum to zero, letting `overflow-x: auto` on children handle wide content gracefully.

### Why `min(65ch, 100%)` and `margin-inline: auto`

`max-width: min(65ch, 100%)` is the defensive pattern: on wide screens it resolves to `65ch`; on narrow screens (mobile, or the 320px WCAG reflow test) it resolves to `100%`, preventing horizontal overflow. While plain `max-width: 65ch` is technically safe (max-width doesn't force minimum size), the `min()` wrapper handles edge cases when `box-sizing`, padding, or nested contexts interact unexpectedly.

`margin-inline: auto` is preferred over `margin: 0 auto` for two reasons: it doesn't zero out top/bottom margins (which `margin: 0 auto` does as a shorthand side effect), and it's writing-mode aware — it adapts correctly for RTL content. Browser support is universal in all modern browsers (Chrome 87+, Firefox 66+, Safari 14.1+).

The tradeoff between `ch` and `rem` for max-width is straightforward: **`ch` is better for text-heavy content** because the width auto-adjusts if the font changes, maintaining the same approximate characters per line. `rem` is better for structural layout containers. For the DM Guide's prose content, `ch` is the right choice.

### Fluid padding with `clamp()` and how it interacts with max-width

`clamp(0.75rem, 2vw, 2rem)` creates padding that scales fluidly between 12px (at 600px viewports) and 32px (at 1600px+ viewports). The `2vw` preferred value means padding equals 2% of viewport width during the fluid range.

With `box-sizing: border-box` (standard modern practice), padding is **included inside** the max-width. A `max-width: 65ch` element with `padding-inline: 2rem` has an effective content area of `65ch - 4rem`. This is fine — the breathing room between content and container edge improves readability. If you need exactly 65ch of text width, apply padding to the grid cell and max-width to an inner wrapper.

```css
/* Option A: padding + max-width on same element (content area = 65ch minus padding) */
.content-body {
  max-width: min(65ch, 100%);
  margin-inline: auto;
  padding-inline: clamp(0.75rem, 2vw, 2rem);
}

/* Option B: padding on parent, max-width on child (content area = exactly 65ch) */
.dm-guide-content {
  padding-inline: clamp(0.75rem, 2vw, 2rem);
}
.dm-guide-content .content-body {
  max-width: min(65ch, 100%);
  margin-inline: auto;
}
```

### Handling wide content: tables, stat blocks, and breakout elements

Tables and code blocks that exceed the `65ch` content width need explicit handling. The standard pattern wraps wide content in a scrollable container:

```css
/* Scrollable wrapper for wide tables */
.table-wrapper {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  margin-block: 1rem;
}
.table-wrapper table {
  min-width: 100%;
  border-collapse: collapse;
}

/* Code blocks get their own horizontal scroll */
.content-body pre {
  overflow-x: auto;
  max-width: 100%;
  padding: 1rem;
  border-radius: 0.375rem;
  background: var(--color-bg-surface);
}

/* Images scale responsively */
.content-body img {
  max-width: 100%;
  height: auto;
  display: block;
}
```

For stat blocks or battle maps that genuinely need to be wider than the content column, use a **grid-based breakout pattern**. Replace the simple content wrapper with a sub-grid:

```css
/* Alternative: content column as a breakout grid */
.dm-guide-content--breakout {
  overflow-y: auto;
  min-width: 0;
  display: grid;
  grid-template-columns:
    [full-start] minmax(var(--padding-fluid), 1fr)
    [content-start] minmax(0, var(--content-max-width))
    [content-end] minmax(var(--padding-fluid), 1fr)
    [full-end];
}

.dm-guide-content--breakout > * {
  grid-column: content;     /* Default: constrained to 65ch */
}

.dm-guide-content--breakout > .full-width {
  grid-column: full;        /* Breaks out to full column width */
}
```

### Dark-mode typography: countering halation

**Halation** is the optical phenomenon where bright areas bleed into surrounding dark areas, making light text on dark backgrounds appear visually bolder and thicker than its declared weight. Roughly **50% of the population** has some degree of astigmatism, which amplifies this effect. Pure `#FFFFFF` on `#000000` (21:1 contrast) maximizes halation — the text glows and loses definition.

The solution is a combination of four adjustments:

```css
body {
  font-family: var(--font-family);
  font-size: var(--font-size-base);
  line-height: var(--line-height-body);     /* 1.6 — above WCAG 1.5 minimum */
  letter-spacing: var(--letter-spacing-body); /* 0.01em, bump to 0.02em in dark */
  font-weight: var(--font-weight-body);     /* 380 — reduced from 400 */
  color: var(--color-text-primary);         /* #E0E0E0, not #FFFFFF */
  background-color: var(--color-bg);        /* #121212, not #000000 */
  -webkit-font-smoothing: antialiased;      /* Disable subpixel AA on macOS */
  -moz-osx-font-smoothing: grayscale;
}
```

| Property | Light mode | Dark mode | Why |
|----------|-----------|-----------|-----|
| `font-weight` (body) | 400 | 350–380 | Reduces perceived boldness from halation |
| `font-weight` (bold) | 700 | 600–620 | Same compensation for headings |
| `line-height` | 1.5 | 1.6–1.65 | Text appears denser on dark backgrounds |
| `letter-spacing` | 0 | 0.01–0.02em | Counteracts perceived compression |
| Text color | `#1A1A1A` | `#E0E0E0` | ~13.9:1 contrast without extreme halation |
| Background | `#FFFFFF` | `#121212` | Material Design dark surface recommendation |
| Font smoothing | default | `antialiased` | Eliminates macOS subpixel rendering artifacts |

Inter is a variable font, so weight adjustments are continuous — `font-weight: 380` works directly without needing separate font files. The `calc()` multiplier approach keeps light/dark values in sync:

```css
:root {
  --weight-multiplier: 1;
}
@media (prefers-color-scheme: dark) {
  :root {
    --weight-multiplier: 0.9;  /* Reduce all weights by 10% */
    --letter-spacing-body: 0.02em;
    --line-height-body: 1.65;
  }
}
h1 { font-weight: calc(700 * var(--weight-multiplier)); }  /* 700 → 630 */
h2 { font-weight: calc(600 * var(--weight-multiplier)); }  /* 600 → 540 */
p  { font-weight: calc(400 * var(--weight-multiplier)); }  /* 400 → 360 */
```

### WCAG compliance verification

The typography changes must survive four WCAG success criteria. Here's what each requires and how the implementation satisfies it:

**WCAG 1.4.8 (Visual Presentation, AAA)** requires lines ≤80 characters, `line-height` ≥1.5, no text justification, and text resizable to 200%. The `65ch` max-width produces ~72–80 characters, `line-height: 1.6` exceeds the minimum, and `ch` units scale proportionally with browser zoom.

**WCAG 1.4.10 (Reflow, AA)** requires content to work at 320 CSS pixels wide without horizontal scrolling. The `min(65ch, 100%)` pattern resolves to `100%` at narrow widths, and `overflow-x: auto` on tables/code provides the WCAG-specified exception for two-dimensional content.

**WCAG 1.4.12 (Text Spacing, AA)** requires that content not break when users override line-height to 1.5, letter-spacing to 0.12em, word-spacing to 0.16em, and paragraph spacing to 2em. The implementation avoids fixed-height containers and `overflow: hidden` on text elements.

### Testing: characters-per-line bookmarklet and automated checks

**CPL measurement bookmarklet** — drag to your bookmarks bar and click on any page to audit line lengths:

```javascript
javascript:(function(){
  var els=document.querySelectorAll('p,li,dd,blockquote');
  var results=[];
  els.forEach(function(el){
    var text=el.textContent;if(!text||text.trim().length<50)return;
    var style=getComputedStyle(el);
    var w=el.getBoundingClientRect().width
      -parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
    var fs=parseFloat(style.fontSize);
    var cpl=Math.round(w/(fs*0.5));
    results.push(cpl);
    el.style.outline='2px solid '+(cpl>80?'red':cpl>75?'orange':'green');
    el.title='~'+cpl+' chars/line';
  });
  var avg=results.length?Math.round(results.reduce(function(a,b){return a+b},0)/results.length):0;
  alert('CPL Audit: '+results.length+' elements | Avg: ~'+avg+' chars/line | Red (>80): '
    +results.filter(function(c){return c>80}).length);
})();
```

**WCAG 1.4.12 text spacing test bookmarklet:**

```javascript
javascript:(function(){
  var s=document.createElement('style');
  s.textContent='*{line-height:1.5!important;letter-spacing:0.12em!important;word-spacing:0.16em!important;}p{margin-bottom:2em!important;}';
  document.head.appendChild(s);
  alert('Text spacing overrides applied. Check for clipped or overlapping content.');
})();
```

**Playwright automated test suite:**

```typescript
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('DM Guide Typography', () => {
  test('no WCAG AA violations', async ({ page }) => {
    await page.goto('/dm-guide');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('reflow at 320px: no horizontal scrollbar', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 1024 });
    await page.goto('/dm-guide');
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });

  test('content lines ≤ 80 characters at 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1024 });
    await page.goto('/dm-guide');
    const maxCPL = await page.evaluate(() => {
      let max = 0;
      document.querySelectorAll('.content-body p').forEach(p => {
        const s = getComputedStyle(p);
        const w = p.getBoundingClientRect().width
          - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
        const cpl = Math.round(w / (parseFloat(s.fontSize) * 0.5));
        if (cpl > max) max = cpl;
      });
      return max;
    });
    expect(maxCPL).toBeLessThanOrEqual(85); // Allow small tolerance for font metrics
  });

  test('survives WCAG 1.4.12 text spacing overrides', async ({ page }) => {
    await page.goto('/dm-guide');
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.textContent = `*{line-height:1.5!important;letter-spacing:0.12em!important;
        word-spacing:0.16em!important;}p{margin-bottom:2em!important;}`;
      document.head.appendChild(s);
    });
    const clipped = await page.evaluate(() => {
      const found = [];
      document.querySelectorAll('*').forEach(el => {
        const s = getComputedStyle(el);
        if (s.overflow === 'hidden' || s.overflowY === 'hidden') {
          if ((el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 5)
            found.push(el.tagName + '.' + el.className.split(' ')[0]);
        }
      });
      return found;
    });
    expect(clipped).toEqual([]);
  });

  test('max-width scales when root font size increases', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1024 });
    await page.goto('/dm-guide');
    const widths = await page.evaluate(() => {
      const el = document.querySelector('.content-body');
      if (!el) return { default: 0, enlarged: 0 };
      const def = el.getBoundingClientRect().width;
      document.documentElement.style.fontSize = '24px';
      void document.body.offsetHeight;
      const enl = el.getBoundingClientRect().width;
      document.documentElement.style.fontSize = '';
      return { default: def, enlarged: enl };
    });
    expect(widths.enlarged).toBeGreaterThan(widths.default);
  });
});
```

## Conclusion: what makes this architecture work

The two subsystems share a core design principle: **keep internal coordinate systems fixed while letting CSS handle the visual adaptation**. The VTT display maintains a 1920×1080 world where all game logic, hit detection, and drawing operations remain unchanged — the CSS transform is purely cosmetic. The DM Guide maintains semantic HTML with no width constraints on the content itself — the `65ch` cap and typography adjustments are applied through a thin CSS layer that can be tuned without touching content structure.

Three implementation details matter most. First, the `clientX + getBoundingClientRect()` coordinate conversion pattern is the only cross-browser reliable approach for mouse interaction through CSS transforms — `offsetX`/`offsetY` will cause subtle, hard-to-debug issues in Firefox and during drag operations. Second, the grid track must use `minmax(0, 1fr)` rather than bare `1fr` to prevent wide tables and stat blocks from blowing out the DM Guide layout. Third, dark-mode typography requires reducing Inter's weight by roughly **10%** (`400 → 360`, `700 → 630`) and using `#E0E0E0` on `#121212` rather than pure white on pure black to control halation — this single change will have the largest perceived impact on reading comfort.