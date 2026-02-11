# Responsive architecture for a multi-window Virtual Tabletop

**The core solution is a three-pronged strategy: CSS `transform: scale()` for the VTT canvas, fluid typography with content-width constraints for the DM Guide, and container-query-driven grid reflow for the Controller.** These three apps share a common CSS token layer but each requires a fundamentally different responsive approach because their content types differ — fixed-ratio graphics, long-form reference text, and dense control surfaces. The critical discovery underlying every recommendation here is that **Chrome applies zoom per-origin, not per-tab**, which means the current architecture (all three apps on one origin) forces a single zoom level across all windows. This report provides the complete technical roadmap for solving every identified problem.

---

## The VTT display needs CSS transform scaling, not canvas resizing

Professional VTTs universally separate logical resolution from display size. Foundry VTT uses PIXI.js with a scene graph where zoom/pan operates on the stage transform, never by resizing the underlying render buffer. Roll20 maintains a fixed **70px-per-grid-unit** baseline and uses resolution-switching for zoom levels. Owlbear Rodeo v2's "Warp Core" engine uses GPU-tiled rendering with spatial indexing. The pattern is consistent: **keep the logical coordinate system fixed, transform the visual output**.

For a vanilla JS multi-canvas stack, the optimal architecture uses `transform: scale()` on a container wrapping all five canvases:

```css
#vtt-viewport {
  width: 100vw;
  height: 100vh;
  background: #000;
  overflow: hidden;
  position: relative;
}
#canvas-stack {
  position: absolute;
  width: 1920px;
  height: 1080px;
  /* transform set by JS */
}
#canvas-stack canvas {
  position: absolute;
  top: 0; left: 0;
  width: 1920px; height: 1080px;
}
```

```javascript
const LOGICAL_W = 1920, LOGICAL_H = 1080;
const stack = document.getElementById('canvas-stack');
const viewport = document.getElementById('vtt-viewport');

function updateLayout() {
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  const scale = Math.min(vw / LOGICAL_W, vh / LOGICAL_H);
  stack.style.transform = `scale(${scale})`;
  stack.style.transformOrigin = 'top left';
  stack.style.left = `${(vw - LOGICAL_W * scale) / 2}px`;
  stack.style.top = `${(vh - LOGICAL_H * scale) / 2}px`;
}

new ResizeObserver(() => updateLayout()).observe(viewport);
```

This approach delivers six critical advantages. Canvas buffers remain at **1920×1080** — no re-rendering on resize, just GPU-accelerated CSS compositing. All five canvases scale together because they share a single transformed container. The coordinate system is always 1920×1080, so **all existing game logic, token positions, and fog coordinates work unchanged**. Letterboxing and pillarboxing happen automatically via the `Math.min(scaleX, scaleY)` calculation. On a 13" MacBook at 1280×800, the scale factor is ~0.667, displaying the content at roughly 1280×720 CSS pixels with 40px letterbox bars — but the canvas buffers still contain full 1920×1080 data.

Mouse coordinate conversion becomes the only new piece of math. Because `getBoundingClientRect()` accounts for CSS transforms, the conversion is straightforward:

```javascript
stack.addEventListener('click', (e) => {
  const rect = stack.getBoundingClientRect();
  const logicalX = (e.clientX - rect.left) * (LOGICAL_W / rect.width);
  const logicalY = (e.clientY - rect.top) * (LOGICAL_H / rect.height);
});
```

Never use `e.offsetX`/`e.offsetY` through a `transform: scale()` — they report inconsistent values across browsers. Always compute from `clientX - rect.left`.

For **Discord screenshare**, this strategy has one nuance: Discord captures the window's rendered pixel content, not the canvas buffer directly. On a window physically sized at 1280×800 pixels, Discord captures at roughly that resolution regardless of the 1920×1080 buffer. For optimal Discord quality, the VTT window should be sized at or above 1920×1080 when possible. On a single small screen, the CSS-scaled output still looks good through Discord's own 720p/1080p encoding, and the `transform: scale()` approach avoids the alternative problem of re-rendering all five canvas layers at a non-native resolution.

**For HiDPI/Retina displays**, the standard pattern multiplies canvas buffer dimensions by `devicePixelRatio` and applies `ctx.scale(dpr, dpr)`. However, for this VTT, **skip DPR scaling** — five canvases at 3840×2160 (DPR 2) consume 4× the memory and render cost, and Discord compresses to 1080p anyway. Add `will-change: transform` to the canvas stack for GPU compositing hints, and cap any optional DPR support at 2× maximum.

HTML UI overlays (title cards, cinematic text) should sit **outside** the transform container in a `position: fixed` layer, positioned via JavaScript relative to the scaled canvas bounds. This keeps text rendering crisp at native resolution while the canvas scales freely.

---

## The DM Guide's readability crisis has a one-line fix and a typography overhaul

The single most impactful change is adding a content width constraint. Robert Bringhurst's "The Elements of Typographic Style" establishes **45-75 characters per line** as satisfactory for single-column text, with **66 characters as ideal**. The Baymard Institute's research confirms that lines beyond 80 characters cause readers to lose their place when scanning back to the start of the next line. WCAG Level AAA recommends no more than 80 characters per line. The DM Guide currently allows lines to reach 2500+ pixels — potentially **200+ characters** — making content nearly unreadable on wide displays.

```css
.main-content__inner {
  max-width: min(70ch, 100%);
  margin-inline: auto;
  padding: clamp(0.75rem, 2vw, 2rem);
}
```

Richard Rutter (author of "Web Typography") argues that `rem` is more reliable than `ch` because `ch` measures the width of "0" and varies significantly between typefaces. For variable-width fonts, `max-width: 36rem` approximates 65 characters. Both approaches work; `70ch` communicates intent more clearly in the code.

**Stat blocks, encounter blocks, and data-dense content** can use wider constraints (`max-width: 90ch`) and should employ container queries for internal layout adaptation. The D&D Beyond stat block pattern uses a **280px minimum width** that expands to a two-column internal layout at 560px+, collapsing back at narrow widths. Container queries make this possible without viewport coupling:

```css
.content-block-wrapper { container-type: inline-size; }

@container (min-width: 500px) {
  .stat-block {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
}
```

The typography system should migrate from the current `html { font-size: 14px }` to a **fluid scale generated by Utopia's calculator** (utopia.fyi). Utopia interpolates between two modular type scales — a 1.2 (Minor Third) ratio at small viewports and a 1.25 (Major Third) ratio at large viewports — producing `clamp()` values for every step:

```css
:root {
  --font-size-sm:   clamp(0.8rem, 0.77rem + 0.15vw, 0.875rem);
  --font-size-base: clamp(0.875rem, 0.83rem + 0.23vw, 1rem);
  --font-size-md:   clamp(1.05rem, 0.98rem + 0.37vw, 1.25rem);
  --font-size-lg:   clamp(1.26rem, 1.15rem + 0.58vw, 1.563rem);
  --font-size-xl:   clamp(1.512rem, 1.34rem + 0.86vw, 1.953rem);
  --font-size-2xl:  clamp(1.814rem, 1.57rem + 1.22vw, 2.441rem);
}
```

The clamp formula combines `rem` with `vw` in the preferred value — **never use pure `vw` for font sizing** as it fails WCAG 1.4.4 (text must remain resizable up to 200% via browser zoom). The pattern `0.83rem + 0.23vw` ensures both viewport responsiveness and zoom accessibility.

The three-column grid layout (nav | content | combat panel) should replace fixed pixel widths with flexible tracks using `minmax()`:

```css
.app-layout {
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-areas: "nav content combat";
  height: 100vh;
}
.nav-panel { width: clamp(200px, 20vw, 280px); }
.combat-panel { width: clamp(280px, 25vw, 400px); }

@media (max-width: 1200px) {
  .app-layout {
    grid-template-columns: auto 1fr;
    grid-template-areas: "nav content";
  }
  .combat-panel {
    position: fixed; right: 0; top: 0; bottom: 0;
    width: 360px; transform: translateX(100%);
    transition: transform 0.3s ease;
  }
  .combat-panel.is-open { transform: translateX(0); }
}
```

The sidebar should implement a three-state pattern: **full width** (280px with labels + icons) → **icon bar** (56px, icons only) → **hidden** (overlay on narrow viewports). Transition width with CSS, fade labels with delayed `opacity` transitions, and save state to `localStorage`.

| Property | Current value | Recommended value |
|---|---|---|
| Base font size | `14px` fixed | `clamp(0.875rem, 0.83rem + 0.23vw, 1rem)` |
| Content max-width | None (2500px+) | `min(70ch, 100%)` |
| Nav width | `280px` fixed | `clamp(200px, 20vw, 280px)` |
| Combat panel width | `360px` fixed | `clamp(280px, 25vw, 400px)` |
| Body line-height | Browser default | `1.5` |
| Content padding | `24px 32px 64px` fixed | `clamp(0.75rem, 2vw, 2rem)` |

---

## The Controller needs container queries and grid area reflow

The Controller's single-column layout wastes space at wider viewports because it uses no responsive logic whatsoever. **CSS container queries** are the right tool here — not media queries — because the Controller runs in a variably-sized browser window whose dimensions bear no predictable relationship to the viewport. Container queries respond to the element's own container width, making components truly portable.

Browser support for container size queries is universal: Chrome 105+, Firefox 110+, Safari 16+ — effectively **97%+ global coverage** as of 2025.

```css
.controller-body {
  container-type: inline-size;
  container-name: controller;
}
.control-sections {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

@container controller (min-width: 500px) {
  .control-sections {
    grid-template-columns: 1fr 1fr;
  }
  .section--full-width { grid-column: 1 / -1; }
}

@container controller (min-width: 800px) {
  .control-sections {
    grid-template-columns: 1fr 1fr 1fr;
  }
}
```

Control grouping should follow functional relationships and usage frequency. **Scene navigation and active combat controls** span full width (they're always needed and benefit from horizontal space). **Mode switching + Map controls** pair together as a constant-use workflow. **Token management + Initiative** pair as a related game-state cluster. **Effects and Overlay text** are lower-frequency and can be collapsed by default using native `<details>`/`<summary>` elements — no JavaScript required, accessible by default.

For touch-target sizing, WCAG 2.2 SC 2.5.8 requires **24×24 CSS pixels minimum** at AA level, while SC 2.5.5 recommends **44×44 CSS pixels** at AAA. Use `@media (pointer: fine)` to detect mouse users and allow smaller targets, scaling up for `(pointer: coarse)`:

```css
.control-btn {
  min-width: 2.75rem;  /* 44px */
  min-height: 2.75rem;
  padding: 0.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
@media (pointer: fine) {
  .control-btn { min-width: 1.5rem; min-height: 1.5rem; }
}
```

OBS Studio's dockable panel pattern offers a useful design reference: panels that can be individually collapsed, stacked in tabs, or hidden entirely. For the Controller, implement this via collapsible sections with saved state, and consider a "compact" vs "comfortable" density toggle (similar to Gmail's density control) that adjusts `--space-*` tokens globally.

---

## Chrome's per-origin zoom is the root cause of the cross-window scaling problem

**Chrome applies zoom settings per-origin (same scheme + host + port), not per-tab.** This is confirmed as intentional behavior in Chromium issue #41118409, marked WontFix. When the VTT Display, DM Guide, and Controller all serve from the same origin, `Ctrl+/-` in any window changes the zoom for all of them simultaneously.

Three solutions exist, in order of recommendation:

**Solution 1: Per-window CSS custom property scaling.** Convert all sizing to `rem` units and add a `--ui-scale` custom property to each app's root:

```css
:root { --ui-scale: 1; }
html { font-size: calc(1rem * var(--ui-scale)); }
```

Add a scale slider to each window's UI. Store the preference per-app in `localStorage` using the pathname as a key: `localStorage.setItem('scale-/controller', '1.2')`. Because everything is in `rem`, changing the root font-size scales the entire interface proportionally. This works without changing the origin setup.

**Solution 2: Serve from different ports.** Run each app on a separate port (`:3000`, `:3001`, `:3002`), making Chrome treat each window's zoom independently. The tradeoff: **BroadcastChannel requires same-origin**, so cross-origin windows would need an alternative messaging strategy. Options include embedding a shared-origin iframe in each window for message relay, using a SharedWorker, or switching to `localStorage` change events (which fire cross-tab for same-origin storage).

**Solution 3: CSS `zoom` property counteraction.** Detect browser zoom via `window.outerWidth / window.innerWidth` and apply compensating CSS `zoom`:

```javascript
function counteractBrowserZoom() {
  const browserZoom = window.outerWidth / window.innerWidth;
  document.documentElement.style.zoom = 1 / browserZoom;
}
window.addEventListener('resize', () =>
  requestAnimationFrame(counteractBrowserZoom)
);
```

CSS `zoom` (now standardized, supported in all browsers including Firefox as of 2024) **affects layout flow** — unlike `transform: scale()`, which leaves the element occupying its original space. Use `zoom` for full-page scaling and `transform: scale()` for visual-only scaling like the VTT canvas. Note that zoom detection via `outerWidth/innerWidth` is heuristic and unreliable when DevTools is docked to the side.

The **Window Management API** (Chrome 100+) can also enhance the multi-window experience by auto-placing windows on specific screens at launch:

```javascript
if ('getScreenDetails' in window) {
  const details = await window.getScreenDetails();
  const secondary = details.screens.find(s => !s.isPrimary);
  if (secondary) {
    window.open('/controller', '_blank',
      `left=${secondary.availLeft},top=${secondary.availTop},` +
      `width=${secondary.availWidth / 2},height=${secondary.availHeight}`);
  }
}
```

This API requires a permission prompt and only works in Chromium browsers, but since Chrome is the primary VTT browser, it's a valuable progressive enhancement.

---

## The CSS architecture should use layered tokens, cascade layers, and incremental refactoring

The three apps should share a common CSS foundation while maintaining separate responsive strategies. Use **CSS `@layer`** (supported in all browsers since March 2022) to manage specificity across the shared and app-specific styles:

```css
@layer reset, tokens, base, layout, components, utilities, overrides;
```

Later layers automatically override earlier ones regardless of selector specificity, eliminating `!important` hacks and specificity wars.

The token system should follow a three-tier hierarchy. **Primitive tokens** define raw values (`--color-gray-900: #1a1a1a`). **Semantic tokens** assign meaning (`--color-text: var(--color-gray-900)`). **Component tokens** scope to specific elements (`--card-padding: var(--space-md)`). All responsive logic lives in token declarations — component styles only reference `var()` values and never contain media queries directly:

```css
/* Responsive logic centralized in token layer */
:root {
  --nav-layout: column;
  --content-columns: 1fr;
}
@media (min-width: 900px) {
  :root {
    --nav-layout: row;
    --content-columns: 250px 1fr;
  }
}

/* Component layer — clean, no media queries */
.nav { flex-direction: var(--nav-layout); }
.content { grid-template-columns: var(--content-columns); }
```

The **fluid spacing scale** should mirror the type scale, generated from Utopia's space calculator:

```css
:root {
  --space-3xs: clamp(0.25rem, 0.23rem + 0.11vw, 0.3125rem);
  --space-2xs: clamp(0.5rem, 0.46rem + 0.23vw, 0.625rem);
  --space-xs:  clamp(0.75rem, 0.69rem + 0.34vw, 0.9375rem);
  --space-s:   clamp(1rem, 0.91rem + 0.45vw, 1.25rem);
  --space-m:   clamp(1.5rem, 1.37rem + 0.68vw, 1.875rem);
  --space-l:   clamp(2rem, 1.82rem + 0.91vw, 2.5rem);
  --space-xl:  clamp(3rem, 2.73rem + 1.36vw, 3.75rem);
}
```

The refactoring process should be **incremental across three phases**. Phase 1: extract all hardcoded pixel values into CSS custom properties (`--nav-width: 280px`). Phase 2: add responsive overrides that change those properties at breakpoints (`@media (max-width: 1200px) { :root { --nav-width: 220px; } }`). Phase 3: convert appropriate tokens to fluid `clamp()` expressions (`--nav-width: clamp(200px, 15vw + 80px, 320px)`). This sequence lets you ship incremental improvements without a monolithic rewrite.

For **breakpoint strategy**, use desktop-first `max-width` queries for the page-level layout (these apps are desktop-primary) combined with container queries for component-level responsiveness. Content-driven breakpoints matter more than device-based ones since these apps run in arbitrarily-sized windows. Use each app's natural layout break points: the DM Guide's sidebar collapses when it would compress content below ~500px; the Controller switches from 1→2→3 columns at container widths of 500px and 800px; the VTT display uses aspect-ratio media features rather than width breakpoints.

The shared file structure:

```
shared/
  tokens.css       — Primitives + semantic tokens (@layer tokens)
  reset.css        — Normalize/reset (@layer reset)
  base.css         — Typography, body defaults (@layer base)
vtt-display/
  layout.css       — @media queries, aspect-ratio based (@layer layout)
controller/
  layout.css       — @container-driven (@layer layout)
dm-guide/
  layout.css       — Mixed @media + @container (@layer layout)
  components.css   — Stat blocks, cards (@layer components)
```

---

## Testing requires specific viewport targets and visual regression tooling

**macOS display scaling** means a 13" MacBook Pro's 2560×1600 physical pixels report as **1280×800 CSS pixels** at the default "Looks like" setting (DPR 2). This is the minimum viable viewport. Key testing dimensions:

- **960×1080** — half-screen on a 1920×1080 monitor (DM Guide or Controller in split view)
- **1280×800** — 13" MacBook Pro default (the critical minimum)
- **1440×900** — 15" MacBook Pro default
- **1512×982** — 14" MacBook Pro M-series default
- **1728×1117** — 16" MacBook Pro M-series default
- **1920×1080** — Full HD external monitor
- **2560×1440** — QHD external monitor

**Playwright** is the recommended testing framework for visual regression, with built-in screenshot comparison and multi-viewport project configurations:

```typescript
export default defineConfig({
  projects: [
    { name: 'mbp-13', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'fhd',    use: { viewport: { width: 1920, height: 1080 } } },
    { name: 'half',   use: { viewport: { width: 960, height: 1080 } } },
    { name: 'qhd',    use: { viewport: { width: 2560, height: 1440 } } },
    { name: 'retina',  use: { viewport: { width: 1280, height: 800 },
                               deviceScaleFactor: 2 } },
  ],
});
```

Chrome DevTools now has **full container query debugging** — elements with `container-type` show a "container" badge in the Elements panel, and `@container` rules are editable in the Styles pane with live threshold adjustment. For rapid visual debugging during development, add `*[style*="container-type"] { outline: 1px dashed rebeccapurple; }` to highlight all containers.

For **accessibility validation**, WCAG 2.2 SC 1.4.10 (Reflow) explicitly **exempts content requiring two-dimensional layout**, including maps, games, and interfaces needing toolbars visible during manipulation — the VTT canvas qualifies. However, all surrounding UI (panels, sidebars, menus) must reflow to a single column at 320 CSS pixels width or equivalently function at 400% browser zoom on a 1280px viewport. Test by zooming Chrome to 400% and verifying no horizontal scrolling in non-canvas UI.

---

## Conclusion: a phased implementation roadmap

The research converges on a clear execution sequence. **Phase 1** (highest impact, lowest risk): add `max-width: min(70ch, 100%)` to the DM Guide's content area and wrap the VTT's canvas stack in a `transform: scale()` container — these two changes solve the most painful user problems with minimal code changes and zero risk to existing functionality. **Phase 2**: extract all hardcoded pixel values into CSS custom properties across all three apps, add the per-window `--ui-scale` mechanism with a scale slider, and convert the Controller to a container-query-driven grid layout. **Phase 3**: implement the full Utopia fluid type+space scale, migrate from `px` to `rem` throughout, add cascade layers and the shared token architecture, and set up Playwright visual regression testing.

The architectural insight that makes all of this tractable is that the three apps need fundamentally different responsive strategies despite sharing a codebase: the VTT needs **geometric scaling** (CSS transform on a fixed-resolution canvas), the DM Guide needs **typographic responsiveness** (fluid type, content-width constraints, collapsible panels), and the Controller needs **layout reflow** (container-query-driven grid reorganization). Trying to solve all three with a single responsive approach — as most tutorials assume — would produce compromises everywhere. The shared token layer provides consistency; the per-app responsive logic provides correctness.