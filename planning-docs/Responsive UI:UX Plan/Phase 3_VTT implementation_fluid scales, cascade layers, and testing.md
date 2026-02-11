# Phase 3 VTT implementation: fluid scales, cascade layers, and testing

**The core architectural move in Phase 3 is replacing static breakpoint-driven values with Utopia fluid scales, wrapping everything in CSS cascade layers, and consolidating three apps' duplicated tokens into a single shared source of truth — all verified by Playwright visual regression tests.** This report synthesizes deep research across all six Phase 3 topics into actionable technical guidance. Every recommendation accounts for the VTT's specific constraints: desktop-primary viewports, a `--ui-scale` multiplier per window, three separate HTML documents sharing one origin, and an existing three-tier token hierarchy (primitive → semantic → component) built in Phase 2.

---

## Utopia fluid type and space scales: math, config, and integration

### The clamp() formula derives from linear interpolation between two viewport-size pairs

Utopia's fluid type calculator takes a minimum and maximum viewport width, a base font size at each extreme, and a type scale ratio at each extreme. For each step in the scale, it computes `minSize = baseMin × ratioMin^step` and `maxSize = baseMax × ratioMax^step`, then derives a CSS `clamp(min, preferred, max)` via linear interpolation.

The algebra is straightforward. Given two points — font size `Smin` at viewport `Wmin`, and `Smax` at `Wmax` (all converted to rem by dividing by 16):

```
slope = (Smax - Smin) / (Wmax - Wmin)
intercept = Smin - slope × Wmin
preferred = intercept[rem] + (slope × 100)[vw]
```

For a desktop-primary VTT with Minor Third (1.200) at 1024px and Major Third (1.250) at 1920px, using base sizes of 16px→20px, step-0 computes as:

```
slope = (1.25 - 1)[rem] / (120 - 64)[rem] = 0.25/56 ≈ 0.004464
intercept = 1 - 0.004464 × 64 ≈ 0.7143rem
vw coefficient = 0.004464 × 100 = 0.4464vw
Result: clamp(1rem, 0.7143rem + 0.4464vw, 1.25rem)
```

At higher steps the divergence between ratios amplifies dramatically. Step-5 spans from `16 × 1.2⁵ = 39.81px` to `20 × 1.25⁵ = 61.04px` — a **53% range** that makes fluid scaling genuinely meaningful for headings.

### Desktop-primary viewport config: 1024px–1920px, not the mobile-first defaults

Utopia's defaults (320px–1240px) target mobile-first responsive sites. For a desktop-primary VTT, **set the minimum viewport to 1024px** (smallest desktop/tablet-landscape per StatCounter and Google PageSpeed) and **the maximum to 1920px** (Full HD, the most common desktop resolution). This produces gentler slopes since both endpoints are large, which is appropriate — desktop text should not vary as dramatically as mobile-to-desktop text. If your layout uses a max-width container narrower than 1920px, cap the Utopia range at that container width (e.g., 1440px) so font sizes stabilize once the content area stops growing.

### The spacing scale ties directly to the type scale

Utopia's space calculator uses step-0 from the type scale as its base unit (`--space-s`), then applies multipliers for other sizes. This creates **harmonic proportions** between text and whitespace. The "one-up pairs" feature (e.g., `--space-s-l`) creates tokens that jump from one T-shirt size to another across the viewport range — useful for element gaps that should expand dramatically on wider screens:

```css
--space-s-l: clamp(1.125rem, 0.5625rem + 2.5vw, 2.5rem); /* 18px → 40px */
```

### Utopia values slot into the primitive tier of the three-tier hierarchy

Utopia-generated clamp() values are **raw, context-agnostic scale values** and belong at the primitive tier. Semantic tokens alias them with meaningful names, and component tokens reference semantics:

```css
/* Primitive (Utopia output, untouched) */
--step-0: clamp(1rem, 0.7143rem + 0.4464vw, 1.25rem);
--space-m: clamp(1.5rem, 1.0714rem + 0.6696vw, 1.875rem);

/* Semantic (aliases) */
--font-size-body: var(--step-0);
--spacing-element: var(--space-m);

/* Component (references semantics) */
--card-gap: var(--spacing-element);
--button-font-size: var(--font-size-body);
```

**Never reference Utopia step names directly in component CSS.** If the Utopia config changes, only primitives update.

### Root font-size overrides break Utopia's math — avoid them

Utopia converts px to rem by dividing by 16 (the browser default). If `html { font-size: 0.875rem }` (14px) is set, all rem-based min/max values shrink to 87.5% of intended sizes, but the `vw` component is unaffected — **the linear interpolation curve skews** because the rem and vw components were calibrated assuming 1rem = 16px. The recommended fix: **leave root font-size unset** and let the browser default apply. If your Phase 2 code overrides root font-size, either remove that override or regenerate all Utopia values with the correct rem base.

### The --ui-scale multiplier layers cleanly on top of fluid values

CSS `calc()` can multiply a resolved `clamp()` value by a scalar. The best pattern applies the multiplier at the **semantic tier**, keeping Utopia primitives pure:

```css
:root {
  --ui-scale: 1;
  --step-0: clamp(1rem, 0.7143rem + 0.4464vw, 1.25rem); /* primitive */
  --font-size-body: calc(var(--step-0) * var(--ui-scale)); /* semantic */
}
.ui-scale-lg { --ui-scale: 1.15; }
```

One gotcha: multiplying a clamped value **bypasses the original clamp bounds**. At `--ui-scale: 1.3`, a value clamped to 1.25rem max would compute to 1.625rem. This is usually desired (the user wants larger text), but if hard limits are needed, wrap in an outer clamp: `clamp(0.875rem, calc(var(--step-0) * var(--ui-scale)), 2rem)`.

An alternative — applying `--ui-scale` to the root font-size via `html { font-size: calc(100% * var(--ui-scale)) }` — is simpler but problematic: the vw component in clamp() doesn't scale, distorting the interpolation curve. **Per-property multiplication at the semantic tier is more predictable.**

---

## CSS cascade layers: production-ready architecture for multi-app styling

### Layer mechanics in 90 seconds

`@layer` introduces a new step in the cascade evaluated **before specificity and source order**. Later-declared layers have higher priority. A selector with specificity `(0,0,1)` in a later layer beats `(1,1,1)` in an earlier layer. Layers are ordered by first appearance and cannot be reordered after declaration.

The recommended stack for the VTT system:

```css
@layer reset, tokens, base, layout, components, utilities, overrides;
```

This follows ITCSS (Inverted Triangle CSS) logic: `reset` (lowest priority, browser normalization) through `overrides` (highest priority, escape hatches). The VTT Display, DM Guide, and Controller all declare this same layer order, then populate app-specific styles into the appropriate layers.

### Unlayered styles always beat layered styles — the critical migration fact

**Normal unlayered declarations take precedence over all layered declarations**, even with lower specificity. Unlayered CSS occupies an implicit final layer above all named layers. This means wrapping existing CSS in `@layer` will **lower its priority** relative to any remaining unlayered CSS — including third-party scripts injecting `<style>` tags.

With `!important`, **the order reverses entirely**: `!important` in the earliest layer beats `!important` in later layers, and `!important` in unlayered styles has the *lowest* priority. This reversal mirrors how `!important` works across cascade origins and allows reset layers to enforce accessibility-critical styles (like focus outlines) that nothing can override.

### Incremental migration: declare order first, wrap from the bottom up

The safest migration path:

1. **Add the layer declaration as the very first line** — `@layer reset, tokens, base, layout, components, utilities, overrides;` — without moving any styles. Nothing breaks because all existing CSS remains unlayered and wins.
2. **Wrap third-party CSS into layers** via `@import url('lib.css') layer(framework);` to demote its priority below your existing unlayered styles.
3. **Move your reset/normalize first** — lowest risk since resets should never override anything.
4. **Gradually move styles bottom-up**: tokens → base → layout → components → utilities.
5. **Final cleanup**: any remaining unlayered styles become explicit `@layer overrides`.

Watch for existing `!important` declarations — their behavior changes inside layers. Any `!important` in an early layer becomes *stronger*, not weaker. Audit `!important` usage before migrating.

### Custom properties cascade normally within layers

CSS custom properties participate in the cascade like any other property. A `--brand-color` defined in `@layer tokens` is overridden by the same property in `@layer theme`. The `:where()` pseudo-class provides zero-specificity definitions, making token defaults trivially overridable. `@container` and `@media` queries nest freely inside layers without affecting layer evaluation order.

### Browser support and design system adoption confirm production readiness

**All major browsers have supported `@layer` since early 2022** — Chrome 99, Firefox 97, Safari 15.4. Global support stands at **95.21%**, comparable to CSS Grid. A PostCSS polyfill (`@csstools/postcss-cascade-layers`) exists for edge cases, converting `@layer` to equivalent specificity using `:not(#\#)` selectors.

Among major design systems, **Open Props** is the flagship adopter with a comprehensive `@layer openprops, normalize, utils, theme, components.base` architecture. **Chakra UI v3** enables layers by default (`@layer reset, base, tokens, recipes`). **MUI** supports layers via `enableCssLayer`. Tailwind uses internal layers (`@layer base, components, utilities`). Salesforce SLDS, IBM Carbon, and GitHub Primer have **not yet adopted** `@layer` — SLDS uses Shadow DOM, Carbon uses Sass modules, and Primer uses BEM with SCSS.

---

## Shared token architecture: one source of truth for three apps

### Use :where(html) for zero-specificity token declarations

Following Open Props' proven pattern, shared tokens should use `:where(html)` as their selector — **specificity (0,0,0)** — making any app-specific override trivially win. This is superior to `:root` (specificity 0,1,0) which creates override friction. Each of the three VTT apps links the same `tokens.css` via `<link>`, and since each HTML document's `<html>` is its own scope, custom properties inherit through each document independently.

### data-app attributes provide clean app-specific overrides

Mark each app's `<html>` element with `data-app="controller"`, `data-app="dm-guide"`, or `data-app="vtt-display"`. Override tokens in app-specific files:

```css
/* shared/tokens.css — zero specificity */
:where(html) { --spacing-md: 1rem; }

/* controller/overrides.css — specificity 0,1,1, wins trivially */
[data-app="controller"] { --spacing-md: 0.75rem; }
```

This pattern is semantically clear, won't conflict with component classes, and mirrors approaches used by GitHub Primer (`data-color-mode`), Salesforce SLDS (`body[theme="dark"]`), and IBM Carbon (inline theme classes).

### Recommended file structure

```
css/
├── shared/
│   ├── tokens/
│   │   ├── primitives.css   /* Utopia scales, raw colors, raw sizes */
│   │   ├── semantic.css     /* Meaningful aliases: --font-size-body, --color-surface */
│   │   └── component.css    /* Component defaults: --button-bg, --card-gap */
│   ├── tokens.css           /* Single @import aggregating all token tiers */
│   ├── reset.css
│   └── base.css
├── vtt-display/
│   ├── overrides.css        /* App-specific token values */
│   ├── layout.css
│   └── components.css
├── dm-guide/
│   └── ...
└── controller/
    └── ...
```

Each app's HTML loads: `shared/tokens.css` → `shared/reset.css` → `shared/base.css` → `app/overrides.css` → `app/layout.css` → `app/components.css`. With `@layer` wrapping each file, cascade priority is explicit regardless of load order.

### Naming conventions that map to TypeScript theme types

CSS custom property names using kebab-case with category-first naming (`--color-surface-primary`, `--spacing-md`) split cleanly into nested TypeScript objects: `theme.color.surface.primary`, `theme.spacing.md`. Style Dictionary handles this natively — its hierarchical JSON token structure generates both CSS custom properties and TypeScript type declarations from a single source. GitHub Primer follows a `{property}-{variant}-{modifier}-{state}` pattern (e.g., `--bgColor-accent-emphasis`). For the VTT, the Category-Type-Item convention (`--color-surface-primary`, `--font-size-heading-1`) provides the cleanest CSS↔TS mapping.

### Migration from duplicated :root blocks is a four-phase process

First, **audit** all three apps' custom properties and identify shared values versus conflicts. Second, create `shared/tokens.css` using `:where(html)` with the most common values. Third, migrate **one app at a time**, replacing its `:root` block with a `<link>` to shared tokens plus an app-specific overrides file. Fourth, verify via computed style checks — a JS snippet comparing `getComputedStyle()` values against expected token values catches regressions that screenshots might miss.

---

## Playwright visual regression testing: computed styles, screenshots, and accessibility

### toHaveScreenshot() uses pixelmatch for perceptual comparison

Playwright's `toHaveScreenshot()` compares images pixel-by-pixel using the **pixelmatch** library with YIQ color space for perceptual difference. Key options: `threshold` (0–1, default 0.2, per-pixel color tolerance), `maxDiffPixelRatio` (percentage of total pixels allowed to differ), `animations: 'disabled'` (freezes CSS animations), `mask` (array of locators to hide from comparison), and `stylePath` (injects CSS during capture to hide volatile elements).

### Multi-viewport config for desktop breakpoints

```ts
projects: [
  { name: 'desktop-1024', use: { browserName: 'chromium', viewport: { width: 1024, height: 768 } } },
  { name: 'desktop-1440', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
  { name: 'desktop-1920', use: { browserName: 'chromium', viewport: { width: 1920, height: 1080 } } },
]
```

Project names appear in snapshot filenames, so baselines are per-viewport automatically.

### Standardize baselines on Linux Docker to eliminate OS font rendering differences

Font rendering differs between macOS, Windows, and Linux. The only reliable approach: **generate all baselines in CI using the official Playwright Docker image** (`mcr.microsoft.com/playwright:v1.49.0-noble`). Developers update baselines locally via the same Docker command. Use `snapshotPathTemplate` to force a consistent path structure, and store screenshots in Git LFS to avoid bloating the repository.

### Testing clamp(), @layer, and container queries with computed style assertions

For **fluid typography**, set viewport → read computed font-size → verify range:

```ts
await page.setViewportSize({ width: 1024, height: 768 });
const fontSize = await page.locator('h1').evaluate(el =>
  parseFloat(getComputedStyle(el).fontSize)
);
expect(fontSize).toBeGreaterThanOrEqual(28);
expect(fontSize).toBeLessThanOrEqual(36);
```

For **@layer ordering**, verify that the correct layer's value wins by checking computed styles of elements where layers conflict. Playwright's `toHaveCSS()` works for standard properties; for CSS custom properties, use `page.evaluate()` with `getComputedStyle().getPropertyValue('--token-name')` due to a known Playwright limitation with custom property assertions.

For **container queries**, resize the container element (not the viewport) via JavaScript, then assert computed style changes:

```ts
await page.locator('.card-container').evaluate(el => { el.style.width = '400px'; });
const layout = await page.locator('.card-content').evaluate(el =>
  getComputedStyle(el).flexDirection
);
expect(layout).toBe('column');
```

### axe-core integration catches ~57% of WCAG issues automatically

Install `@axe-core/playwright`, create a reusable fixture with `withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])`, and run `expect(results.violations).toEqual([])` per page. Attach results as JSON to test reports for debugging. Exclude known issues per-element with `.exclude()` and `.disableRules()`. A recommended test structure separates `visual/`, `accessibility/`, and `css/` test directories, with shared fixtures for axe and screenshot stabilization (font loading waits, animation disabling, volatile element masking).

---

## px-to-rem migration: the remaining 5% that requires care

### Borders, box-shadows, and outlines should stay as px

**1px borders are visual hairlines** that shouldn't scale with user font preferences — converting to `0.0625rem` produces chunky borders at larger root font sizes. Firefox scales border-width in rem, but Chrome and Safari do not — this **cross-browser inconsistency alone** justifies keeping borders in px. Box-shadow offsets and blur values (small, decorative) and outline widths follow the same logic. Shopify Polaris explicitly recommends small values (1–4px) remain as px.

### rem in CSS transforms works correctly — no gotchas

`translate(1rem, 1rem)` computes from root font-size and works consistently across browsers. The `scale()` function is unitless and does not accept rem. Transform order matters: `translate(1rem) scale(2)` ≠ `scale(2) translate(1rem)` because scale applied first also scales the subsequent translation.

### The critical media query gotcha: rem = browser default, not your CSS root

**Inside `@media` query conditions, 1rem always equals the browser default (16px)**, regardless of any `html { font-size: ... }` declaration. This prevents infinite loops (a media query that changes root font-size based on root font-size). So `@media (min-width: 50rem)` triggers at **800px** even if your CSS sets root font-size to 20px. Inside the styles *applied by* the media query, rem uses your CSS root font-size normally.

For `@container` query conditions, the spec aligns with media queries to avoid circular dependencies. Inside the styles applied by container queries, rem works normally. **Use px for all query conditions** to avoid confusion, and reserve rem for property values.

### Scrollbar styling has a standards gap

`::-webkit-scrollbar` width/height accepts rem with no known issues. However, the **standard `scrollbar-width` property only accepts keywords** (`auto`, `thin`, `none`) — no length units at all. You cannot set a precise rem-based scrollbar width using the standard API. Chrome 121+ supports `scrollbar-color` and `scrollbar-width`, which override webkit pseudo-element styles when present. Wrap webkit styles in `@supports not selector(::-webkit-scrollbar)` for progressive enhancement.

### SVG attributes and canvas dimensions are additional gotchas

SVG `width`/`height` **attributes** (not CSS properties) have inconsistent rem support — Firefox historically rejected rem in SVG attributes. Set SVG dimensions via CSS (`svg.icon { width: 2rem; }`) instead. Canvas element dimensions must be set via HTML attributes or JavaScript in device pixels; CSS width/height on canvas affects only display size, not drawing surface resolution.

---

## CUBE CSS and intrinsic design: the architecture that fits token-driven systems

### CUBE CSS embraces the cascade instead of fighting it

Andy Bell's **CUBE CSS** (Composition, Utility, Block, Exception) is purpose-built for design-token-driven systems. Unlike BEM, which treats each component as self-contained, CUBE does most work via **global styles and design tokens first**, then adds contextual deviations through four thin layers:

- **Composition**: macro layout primitives (`.flow > * + * { margin-top: var(--flow-space) }`)
- **Utility**: single-responsibility classes generated from tokens (`.bg-primary`, `.text-center`)
- **Block**: minimal component styles — typically 80–100 lines max, since composition and utilities handle the rest
- **Exception**: state deviations via `data-` attributes (`[data-state="reversed"]`)

CUBE is **exceptionally well-suited** for the VTT because it naturally integrates with the three-tier token hierarchy, reduces component CSS size dramatically, and uses the cascade intentionally rather than fighting specificity wars. Exceptions via `data-` attributes align perfectly with the `data-app` pattern for app-specific overrides.

### Fluid tokens replace most breakpoint-driven changes; layout breakpoints remain

The expert consensus is a **hybrid approach**: use Utopia fluid tokens (`clamp()`) for typography and spacing — these scale smoothly without any media queries — while retaining `@media` breakpoints for **structural layout changes** (sidebar visibility, grid column counts, navigation patterns). This means most `:root` token values become single fluid declarations, eliminating the duplicated `@media` blocks that override tokens at breakpoints. Layout-specific tokens that represent discrete states (sidebar shown/hidden) still change at breakpoints.

### Intrinsic web design principles suit complex desktop applications

Jen Simmons' "intrinsic web design" — mixing fluid and fixed sizing, using `min()`, `max()`, `clamp()`, `auto-fit`/`auto-fill` grids, and container queries — is **highly applicable to the VTT**. Panel-based layouts benefit from `grid-template-columns: minmax(200px, 280px) 1fr minmax(0, 320px)`. Resizable panels benefit from container queries over media queries. `clamp()` for spacing reduces media query counts dramatically. The VTT Display's canvas may need pixel-perfect sizing, but the Controller's dense grid and the DM Guide's text layout are ideal candidates for intrinsic approaches.

---

## Conclusion: a unified Phase 3 implementation sequence

The research reveals a natural implementation order. **Start with cascade layers** — declare the layer order as the very first line of each app's CSS, then incrementally wrap existing styles bottom-up. This is non-breaking and establishes the architectural foundation. **Next, consolidate tokens** into `shared/tokens.css` using `:where(html)` at zero specificity, migrated one app at a time with computed-style verification scripts. **Then introduce Utopia fluid scales** as new primitive tokens, configured for 1024px–1920px viewports, with the `--ui-scale` multiplier applied at the semantic tier. **Complete the px-to-rem migration** simultaneously, keeping borders and shadows in px, using px for all query conditions, and fixing any SVG attribute issues. **Finally, build the Playwright test suite** — visual regression at three viewport widths, computed-style assertions for clamp() values and layer ordering, container query resize tests, and axe-core accessibility scans — all baselined in Linux Docker for CI consistency. CUBE CSS provides the organizing methodology throughout, with intrinsic design principles reducing the media query surface area and making each window genuinely responsive to its own context rather than just the viewport.