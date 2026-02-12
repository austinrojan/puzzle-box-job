# VTT responsive architecture: Phase 1–2 completion review

**The project's Phase 1 and Phase 2 specifications describe a well-architected responsive system, but several items require verification against the actual codebase before Phase 3 can begin.** This review synthesizes the detailed deliverable specifications provided, applies technical best-practice analysis to each, identifies nine specific risk areas, and provides a concrete verification checklist. The most critical finding is that the `--ui-scale` multiplier on the `html` element will **conflict with Utopia's clamp() approach in Phase 3** unless the migration strategy is adjusted. Below is the full structured assessment.

> **Note on methodology:** The project codebase was not accessible via Google Drive or public web repositories. This review is constructed from the detailed deliverable specifications provided and validated against current CSS architecture best practices. Each item below includes the exact code pattern to verify and the pass/fail criteria.

---

## Phase 1: foundational responsive architecture

Phase 1 established the viewport scaling system, layout restructuring, camera integration, and typography improvements. Five deliverables require verification.

**1. viewport-scaler.js module (vtt/js/viewport-scaler.js)**
Verify the file exists and exports `initViewportScaler` and `getViewportScale`. The correct pattern keeps a fixed **1920×1080** canvas coordinate space and applies CSS `transform: scale()` to a wrapper element. The scale calculation should be `Math.min(window.innerWidth / 1920, window.innerHeight / 1080)`, producing letterbox-fit behavior. The `transform-origin` must be `top left` (or `0 0`) for predictable coordinate math. The module should listen on `window.resize` (ideally debounced via `requestAnimationFrame`) and emit a `viewport:scaled` event via EventBus with the current scale factor. The `getViewportScale()` export provides synchronous read access for imperative consumers like the camera system.

**2. Layout structure (#vtt-viewport and #vtt-scale-container)**
In `vtt/css/layout.css`, verify that `#vtt-viewport` wraps the entire VTT display and `#vtt-scale-container` sits inside it with explicit `width: 1920px; height: 1080px` and `position: absolute`. The CSS transform from viewport-scaler.js is applied to `#vtt-scale-container`. The viewport wrapper should handle centering (typically via `display: flex; justify-content: center; align-items: center` or `position/translate` pattern).

**3. Canvas dimensions remain in px**
The `<canvas>` element's `width` and `height` attributes must be **integer pixel values** (1920 and 1080), never percentages or rem. This is non-negotiable: the Canvas 2D API operates in a pixel-based coordinate system. All `fillRect`, `drawImage`, `moveTo`, and `ctx.font` calls use px values. The CSS transform handles display scaling without altering the canvas coordinate space.

**4. Camera system integration with viewport scale**
The camera should subscribe to the EventBus `viewport:scaled` event for reactive updates AND call `getViewportScale()` imperatively at initialization to avoid race conditions where the camera initializes before the first event fires. The camera needs the scale factor for two operations: converting screen-space mouse/touch events to canvas-space coordinates (`screenX / viewportScale`) and composing viewport scale with camera zoom for rendering. Verify that `screenToCanvas` or equivalent coordinate conversion divides by the viewport scale factor.

**5. DM Guide typography constraints**
In the DM Guide's `index.html`, verify that text content areas have `max-width` constraints for readable line lengths. The standard is **45–75 characters per line** (approximately `65ch` or `40rem` max-width). Check for `max-width` on main content containers, not just on the body element.

---

## Phase 2: tokens, per-window scaling, and container queries

Phase 2 introduced the design token system, per-window UI scaling, container query grid, and BEM naming. Eight deliverables require verification.

**1. Three-tier CSS design token system**
Verify `:root` blocks in all three apps contain tokens organized in three tiers: **primitive** (raw values like `--color-blue-500`), **semantic** (context-aware mappings like `--color-primary: var(--color-blue-500)`), and **component** (element-specific like `--button-bg: var(--color-primary)`). Required token categories: spacing (4px grid: `--space-1: 0.25rem` through `--space-8: 2rem`), typography (font sizes, weights, families), border radii (`--radius-sm`, `--radius-md`, `--radius-lg`), transitions (`--transition-fast`, `--transition-normal`, `--transition-slow` in ms format), colors, elevation/backgrounds, and z-indices.

**2. Per-window UI scaling**
Verify `shared/scale-control.js` exists and exports `initScaleControl`. The critical CSS rule `font-size: calc(0.8125rem * var(--ui-scale, 1))` **must be on the `html` element, NOT `body`**, in both DM Guide and Controller. This is because `rem` is defined relative to the root element (`<html>`). Placing it on `body` would leave all rem-based values unaffected — only `em`-based children of body would scale, creating an inconsistent, partially-scaled UI. The formula `0.8125rem` equals 13px at the default 16px root (`13/16 = 0.8125`). When `font-size` on `html` uses `rem`, the `rem` in that declaration refers to the browser's initial value (16px), so this is well-defined and non-circular.

**3. Scale control UI elements**
Both DM Guide and Controller must contain these HTML elements: `scale-toggle` (button to show/hide the scale popover), `scale-popover` (container for the control), `scale-slider` (range input), `scale-readout`/`scale-value` (display of current scale), and `scale-reset` (button to reset to default). Verify the slider sets `--ui-scale` on `document.documentElement` (not `document.body`).

**4. Controller container query grid**
Verify `controller/index.html` CSS includes `container-type: inline-size` and `container-name: controller` on the main layout container. The `@container` queries should fire at **500px** and **800px** breakpoints for a responsive 1→2→3 column layout. The container element must get its size from its layout context (not from its own content), and it must use `container-type: inline-size` (not `size`, which can collapse height). Container queries and cascade layers are fully compatible — they operate at different levels.

**5. BEM double-hyphen modifiers**
Search for stale single-hyphen patterns: `btn-sm`, `btn-danger`, `btn-gold` should all be replaced with `btn--sm`, `btn--danger`, `btn--gold`. The double-hyphen convention eliminates ambiguity — `btn-danger` could be a block named "btn-danger," while `btn--danger` is unambiguously block `btn` with modifier `danger`. Run a search for `\.btn-[a-z]` in all CSS files, filtering out lines containing `--`, to find any remaining stale patterns.

**6. Token parity across apps**
The three `:root` blocks in `index.html` (DM Guide), `controller/index.html`, and `vtt/css/theme.css` must share identical values for overlapping tokens. Tokens requiring cross-app parity include spacing scale, typography scale, radii, transitions, and `--scrollbar-size`. To audit, extract all `--variable: value` declarations from each file, sort alphabetically, and diff. Any discrepancy constitutes token drift.

---

## CodeRabbit blocking fixes: verification checklist

These nine fixes address incorrect unit usage and token misapplication. Each fix follows a specific pattern rule.

| Fix | File | Property | Required Value | Rule |
|-----|------|----------|---------------|------|
| **B4** | vtt/css/theme.css | `--initiative-width` | `300px` (not rem) | Canvas-space dimension stays px |
| **B5** | vtt/css/map.css | `.token-hp` width | `40px` (not rem) | Canvas-overlay element stays px |
| **B6** | vtt/css/initiative.css | `.init-portrait` width/height | `40px` (not rem) | Canvas-overlay element stays px |
| **B1** | index.html | `.nav-icon` width | `1.25rem` (not `var(--space-5)`) | Spacing tokens are for margin/padding/gap only, not width |
| **B2** | index.html | `.combat-close` width/height | `1.5rem` (not `var(--space-6)`) | Same principle: width/height need size tokens, not spacing tokens |
| **B3** | index.html | `.brazier-bowl` border-radius | `0.75rem` (not `var(--space-3)`) | Border-radius needs radii tokens, not spacing tokens |
| **B7** | controller/index.html | `--scrollbar-size` | `0.5rem` (matching DM Guide) | Cross-app token parity |
| **B8** | controller/index.html | Transitions | ms format, `--transition-slow` present | Consistent transition token format |
| **AH1** | controller/index.html | `font-size` | On `html` element, not `body` | rem references root element only |

The pattern behind B1–B3 is architecturally important: **spacing tokens (`--space-N`) should never control width, height, or border-radius**. These are fundamentally different design concerns. Spacing evolves independently from sizing and radii. If `--space-5` changes from 1.25rem to 1rem for tighter padding, you don't want every nav icon to shrink. Major design systems (Chakra UI, Panda CSS, EightShapes) all enforce this separation with distinct token categories for spacing, sizes, and radii.

The pattern behind B4–B6 enforces the **canvas/UI boundary**: elements that exist in canvas coordinate space (initiative panel, token HP indicators, portraits) use absolute px values because the canvas operates in a fixed 1920×1080 pixel grid. CSS transform scaling handles display adaptation. Converting these to rem would cause them to scale twice — once via the CSS transform and again via the rem-based font-size multiplier.

---

## Token parity audit framework

Without direct codebase access, here is the exact comparison to perform across the three `:root` blocks. This table lists every token category that should match.

| Token category | Tokens to compare | Expected format | Known risk areas |
|---|---|---|---|
| Spacing scale | `--space-1` through `--space-8` | rem (4px grid: 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5) | Values may differ between Controller and DM Guide |
| Typography | `--font-size-sm`, `--font-size-base`, `--font-size-lg`, etc. | rem | Font scale may have drifted during Phase 2 |
| Border radii | `--radius-sm`, `--radius-md`, `--radius-lg` | rem | B3 fix may not have been applied to all apps |
| Transitions | `--transition-fast`, `--transition-normal`, `--transition-slow` | ms | B8 fix: Controller may still use s format or lack `--transition-slow` |
| Scrollbar | `--scrollbar-size` | rem | B7 fix: Controller may have different value than DM Guide |
| Colors | All color tokens | hex/rgb/hsl | Different apps may have app-specific colors that should remain different |
| Z-indices | `--z-*` tokens | unitless integers | Must be consistent to prevent stacking context conflicts |

**Key principle for the audit:** Tokens should be identical where they represent shared design decisions. App-specific tokens (like VTT's `--initiative-width: 300px`) are expected to differ. The goal is to identify **unintentional drift** in shared tokens.

---

## Phase 3 readiness: five critical prerequisites

**1. The --ui-scale multiplier will conflict with Utopia's clamp() — this is the biggest risk**

Utopia's clamp() formulas are pre-computed assuming `1rem = 16px` (the browser default). The formula `font-size: calc(0.8125rem * var(--ui-scale))` on `html` changes the rem baseline, which **distorts Utopia's interpolation curve**. The rem components of clamp() scale correctly, but the `vw` component is viewport-relative and doesn't scale with root font-size. This means the breakpoints where fluid interpolation starts and stops will shift unpredictably.

**Recommended migration path:** Don't set `font-size` on `html` when using Utopia. Instead, apply `--ui-scale` as a multiplier on the Utopia custom properties themselves: `font-size: calc(var(--step-1) * var(--ui-scale, 1))`. This preserves Utopia's interpolation curve while adding app-level scaling. This requires restructuring how `--ui-scale` works, which is a Phase 3 task but should be planned now.

**2. Token values in rem — mostly ready, with exceptions**

B4, B5, and B6 confirm that canvas-space values correctly stay in px. Other UI tokens should already be in rem per the Phase 2 specification. Verify that no other canvas-space values were accidentally converted to rem. Check `vtt/css/theme.css`, `vtt/css/map.css`, and `vtt/css/initiative.css` for any px values that *should* be rem but weren't converted, and vice versa.

**3. CSS specificity landscape for @layer introduction**

Introducing `@layer` requires understanding the current specificity landscape. Key rules: styles outside any `@layer` always override layered styles (regardless of specificity), and `!important` within layers has **reversed precedence** (lowest-priority layer's `!important` wins). During migration, leave unlayered code in place and progressively wrap new code in layers. The recommended layer order for this project:

```css
@layer reset, tokens, base, layouts, components, utilities, overrides;
```

**Risk areas:** If any CSS currently uses `!important` to override specificity, layer introduction will reverse that behavior. Audit all three apps for `!important` usage before beginning Phase 3.

**4. Three untokenized CSS files flagged by CodeRabbit**

`theater.css`, `scene-navigator.css`, and `tokens.css` were flagged as untouched by the tokenization pass. These files need to be tokenized before Phase 3's shared tokens extraction, or they'll reference hardcoded values that won't update when tokens change. This is a prerequisite task that should be completed before beginning the shared `tokens.css` extraction.

**5. VTT Display canvas-space isolation is correct**

The architecture correctly keeps canvas-space values in px and UI values in rem, with the viewport scaler's CSS transform bridging the two worlds. This boundary must be preserved through Phase 3. When introducing Utopia fluid scales, the clamp() values apply only to the UI layer — canvas drawing operations (`ctx.fillRect`, `ctx.drawImage`, `ctx.font`) must continue using px constants.

---

## Open issues to resolve before Phase 3

1. **Utopia compatibility:** Redesign the `--ui-scale` strategy to multiply Utopia tokens rather than the html font-size. This is an architectural decision that affects all Phase 3 work.

2. **Untokenized CSS files:** Complete tokenization of `theater.css`, `scene-navigator.css`, and any `tokens.css` file before extracting shared tokens.

3. **`!important` audit:** Search all CSS files across all three apps for `!important` declarations. Document each one and determine whether it can be removed before introducing `@layer`.

4. **BEM migration completeness:** Verify no stale single-hyphen modifiers remain anywhere in the codebase (HTML class attributes and CSS selectors).

5. **WCAG zoom testing:** The `--ui-scale` pattern and any future clamp() values must be tested with browser zoom at 200% to ensure WCAG 1.4.4 compliance. clamp() with vw units can prevent users from zooming text sufficiently.

6. **Verify all nine CodeRabbit fixes** are actually applied in the current codebase — these were identified as blocking, and any that remain unfixed will carry forward as Phase 3 blockers.

7. **Token drift audit:** Run the diff-based token audit described above to identify any values that have drifted between the three apps since Phase 2 implementation.

---

## Recommended Phase 3 starting point

**Begin with the shared tokens extraction (`shared/tokens.css`), not with Utopia or cascade layers.** Here's the reasoning:

The shared tokens file is a prerequisite for everything else in Phase 3. It eliminates the duplicated `:root` blocks (the primary source of token drift), establishes the single source of truth that Utopia values will replace, and creates the file that will eventually live in `@layer tokens`. Starting with Utopia before tokens extraction means you'd be updating clamp() values in three separate files. Starting with `@layer` before tokens extraction means layering code that still has duplication.

The recommended Phase 3 sequence is: **(1)** tokenize the three untouched CSS files → **(2)** extract `shared/tokens.css` from the three `:root` blocks → **(3)** introduce `@layer` with the recommended ordering → **(4)** redesign `--ui-scale` to multiply individual tokens rather than root font-size → **(5)** replace static rem values with Utopia clamp() scales → **(6)** set up Playwright visual regression tests to catch regressions from steps 3–5 → **(7)** apply CUBE CSS methodology to the now-layered, tokenized codebase.

Steps 1–2 are low-risk refactors. Steps 3–5 are the high-risk architectural changes that benefit from visual regression testing (step 6) being in place. If timeline pressure exists, consider moving step 6 earlier — visual regression tests after step 2 would catch any breakage from the remaining migration steps.