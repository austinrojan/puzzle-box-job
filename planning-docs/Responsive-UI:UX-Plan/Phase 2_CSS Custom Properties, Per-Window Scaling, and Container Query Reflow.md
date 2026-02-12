# Phase 2: CSS Custom Properties, Per-Window Scaling, and Container Query Reflow

**This guide provides the complete, production-ready implementation for Phase 2 of the VTT responsive architecture migration.** Phase 1 solved the two most painful user-facing problems: the VTT canvas now scales via CSS `transform: scale()`, and the DM Guide content is constrained to readable line lengths. Phase 2 goes deeper into the infrastructure. It extracts every hardcoded pixel value into CSS custom properties, adds a per-window `--ui-scale` mechanism that works around Chrome's per-origin zoom limitation, and converts the Controller from a rigid single-column layout into a container-query-driven grid that reflows intelligently at any window size.

The three deliverables in this phase are ordered by dependency: you cannot build a meaningful `--ui-scale` slider until the values it controls are expressed as custom properties, and you cannot reflow the Controller's grid until its dimensions are tokenized. Execute them in sequence.

---

## Table of Contents

1. [Deliverable A: Extract Hardcoded Values into CSS Custom Properties](#deliverable-a-extract-hardcoded-values-into-css-custom-properties)
2. [Deliverable B: Per-Window `--ui-scale` Mechanism](#deliverable-b-per-window---ui-scale-mechanism)
3. [Deliverable C: Container-Query-Driven Controller Grid](#deliverable-c-container-query-driven-controller-grid)
4. [Shared Token Architecture](#shared-token-architecture)
5. [Testing Protocols](#testing-protocols)
6. [Migration Roadmap Context](#migration-roadmap-context)
7. [Risk Assessment and Rollback](#risk-assessment-and-rollback)

---

## Deliverable A: Extract Hardcoded Values into CSS Custom Properties

### Why this matters beyond "clean code"

Extracting hardcoded pixel values into CSS custom properties is not a refactoring exercise for its own sake. It is the foundation for three capabilities that follow:

**Per-window scaling** (Deliverable B) works by changing a single CSS custom property on the root element. If your font sizes, paddings, and widths are hardcoded as `13px` and `16px` throughout the stylesheet, changing `--ui-scale` does nothing. The custom properties are the control surface that the scale slider manipulates.

**Responsive breakpoints** (Phase 3) will swap entire sets of token values at different viewport widths. Instead of writing `@media` queries that override dozens of individual rules, you override a handful of tokens and let the cascade propagate. This is the pattern used by every mature design system: Salesforce Lightning, IBM Carbon, GitHub Primer, and Shopify Polaris all follow the same three-tier token hierarchy for exactly this reason.

**The eventual React/TypeScript migration** benefits directly because CSS custom properties map cleanly to a theme context or design token system. Every `var(--space-md)` in your current CSS becomes a `theme.space.md` in your future React code, with the same semantic meaning. The naming conventions you establish now carry forward without translation.

### The three-tier token hierarchy

The token system follows three layers. Understanding the distinction matters because it determines where responsive logic lives and how components stay portable.

**Primitive tokens** define raw values with no semantic meaning. They are the palette:

```css
/* Primitives: raw values, never used directly in components */
:root {
  /* Spacing scale (based on 4px grid) */
  --raw-space-1: 0.25rem;   /* 4px */
  --raw-space-2: 0.5rem;    /* 8px */
  --raw-space-3: 0.75rem;   /* 12px */
  --raw-space-4: 1rem;      /* 16px */
  --raw-space-5: 1.25rem;   /* 20px */
  --raw-space-6: 1.5rem;    /* 24px */
  --raw-space-8: 2rem;      /* 32px */
  --raw-space-10: 2.5rem;   /* 40px */
  --raw-space-12: 3rem;     /* 48px */
  --raw-space-16: 4rem;     /* 64px */

  /* Type scale */
  --raw-font-2xs: 0.5625rem;  /* 9px */
  --raw-font-xs: 0.625rem;    /* 10px */
  --raw-font-sm: 0.6875rem;   /* 11px */
  --raw-font-base: 0.75rem;   /* 12px */
  --raw-font-md: 0.8125rem;   /* 13px */
  --raw-font-lg: 0.875rem;    /* 14px */
  --raw-font-xl: 0.9375rem;   /* 15px */
  --raw-font-2xl: 1rem;       /* 16px */
  --raw-font-3xl: 1.625rem;   /* 26px */
  --raw-font-4xl: 2.625rem;   /* 42px */

  /* Border radii */
  --raw-radius-sm: 0.1875rem; /* 3px */
  --raw-radius-md: 0.25rem;   /* 4px */
  --raw-radius-lg: 0.375rem;  /* 6px */
  --raw-radius-xl: 0.5rem;    /* 8px */

  /* Border widths */
  --raw-border-1: 1px;
  --raw-border-2: 2px;
  --raw-border-3: 3px;
}
```

**Semantic tokens** assign meaning. These are the ones components reference:

```css
/* Semantic: meaningful names, reference primitives */
:root {
  /* Typography */
  --font-size-body: var(--raw-font-md);       /* 13px - standard body text */
  --font-size-body-sm: var(--raw-font-base);  /* 12px - secondary text */
  --font-size-label: var(--raw-font-xs);      /* 10px - section labels, badges */
  --font-size-mono-sm: var(--raw-font-sm);    /* 11px - code, shortcuts */
  --font-size-mono-xs: var(--raw-font-2xs);   /* 9px - micro labels */
  --font-size-heading-sm: var(--raw-font-md); /* 13px - small headings */
  --font-size-heading-md: var(--raw-font-lg); /* 14px - section headings */
  --font-size-heading-lg: var(--raw-font-3xl);/* 26px - hero headings */
  --font-size-loading: var(--raw-font-4xl);   /* 42px - loading screen */

  /* Spacing */
  --space-xs: var(--raw-space-1);   /* 4px - tight gaps */
  --space-sm: var(--raw-space-2);   /* 8px - standard gap */
  --space-md: var(--raw-space-3);   /* 12px - section padding */
  --space-lg: var(--raw-space-4);   /* 16px - generous padding */
  --space-xl: var(--raw-space-6);   /* 24px - content padding */
  --space-2xl: var(--raw-space-8);  /* 32px - large content padding */
  --space-3xl: var(--raw-space-16); /* 64px - bottom scroll space */

  /* Layout */
  --layout-nav-width: 17.5rem;      /* 280px */
  --layout-combat-width: 22.5rem;   /* 360px */
  --layout-tab-height: 2.375rem;    /* 38px */
  --layout-heat-height: 2rem;       /* 32px */
  --layout-initiative-width: 18.75rem; /* 300px */

  /* Interactive */
  --control-height-sm: 1.5rem;     /* 24px - small buttons */
  --control-height-md: 2rem;       /* 32px - standard buttons */
  --control-height-lg: 2.75rem;    /* 44px - touch-friendly buttons */
  --control-radius: var(--raw-radius-md);

  /* Scrollbar */
  --scrollbar-width: 0.5rem;       /* 8px */
  --scrollbar-width-sm: 0.375rem;  /* 6px */
}
```

**Component tokens** scope to specific elements. These are optional for now but will matter more as the system grows:

```css
/* Component tokens (used sparingly, for values that diverge from semantic scale) */
:root {
  --nav-child-indent: 2.75rem;  /* 44px - specific to nav tree indentation */
  --tab-min-width: 7.5rem;      /* 120px */
  --tab-max-width: 12.5rem;     /* 200px */
  --hp-bar-width: 2.5rem;       /* 40px */
  --hp-bar-height: 0.25rem;     /* 4px */
}
```

### The px-to-rem conversion: why and how

Every hardcoded pixel value that participates in the UI scale needs to convert to `rem`. The reason is mechanical: `rem` is relative to the root `font-size`, so when Deliverable B changes `html { font-size: calc(16px * var(--ui-scale)); }`, every `rem` value in the document scales proportionally. Pixel values are immune to this, which is exactly what makes them wrong for a scalable UI.

The conversion factor is straightforward: `1rem = 16px` at the browser default. So `13px = 0.8125rem`, `280px = 17.5rem`, and so on.

**Values that should stay in `px`:**

Not everything should convert. Some values are intentionally pixel-locked:

- **Borders**: `1px` borders should remain `1px`. Scaling a border to `0.8px` causes sub-pixel rendering artifacts. Same for `box-shadow` offsets that reference single-pixel lines.
- **Scrollbar widths**: Browser scrollbar styling uses pixel-specific values.
- **Canvas dimensions**: The VTT's `1920px` and `1080px` canvas dimensions are logical constants, not UI chrome. They must never scale with `--ui-scale`.
- **The `transform: scale()` factor itself**: This is a unitless ratio, not a dimension.

**Values that must convert to `rem`:**

- Font sizes (all of them)
- Padding and margin
- Gap values
- Width/height on UI elements (nav panel, combat panel, tab bar)
- Min-width/max-width/min-height on interactive controls
- Border-radius (debatable, but converting keeps corners proportional at different scales)
- Letter-spacing and word-spacing

### File-by-file extraction: DM Guide (index.html)

The DM Guide has the most CSS to extract because its styles are inlined in `<style>` tags within `index.html`. Here is every hardcoded value that needs extraction, organized by section.

#### Root custom properties (replace existing `:root` block)

The existing `:root` already defines color tokens and a few spacing values. We expand it to include the full token set:

```css
:root {
  /* ---- Existing color tokens (unchanged) ---- */
  --bg-0: #0D0F14;
  --bg-1: #141820;
  --bg-2: #1A1F2B;
  --bg-3: #212738;
  --bg-4: #2A3148;
  --gold-dim: #8B7435;
  --gold: #C9A84C;
  --gold-bright: #E8C55A;
  --gold-glow: #F5D76E;
  --gold-light: #FFE89A;
  --parchment-bg: #2C2518;
  --parchment-text: #E8DCC8;
  --parchment-border: #5C4A2A;
  --red-dark: #5C1A1A;
  --red: #C0392B;
  --red-bright: #E74C3C;
  --red-light: #FF6B6B;
  --blue-dark: #1A3A4A;
  --blue: #2E86AB;
  --blue-bright: #48B5E0;
  --purple: #7E57C2;
  --purple-light: #B39DDB;
  --purple-bright: #CE93D8;
  --heat-green: #27AE60;
  --heat-amber: #E8A84C;
  --heat-red: #E74C3C;
  --brazier-blue: #4A9EFF;
  --brazier-purple: #7B68EE;
  --brazier-amber: #E8A84C;
  --brazier-red: #C0392B;
  --brazier-dead: #3A3A3A;
  --text-primary: #E8E6E3;
  --text-secondary: #A0A0A8;
  --text-muted: #6B6B78;
  --text-heading: #E8C55A;
  --font-heading: 'Cinzel', serif;
  --font-read-aloud: 'Crimson Text', serif;
  --font-body: 'Inter', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;
  --transition-fast: 150ms ease;
  --transition-base: 250ms ease;
  --transition-slow: 400ms ease;

  /* ---- NEW: Spacing tokens ---- */
  --space-1: 0.25rem;    /* 4px */
  --space-2: 0.5rem;     /* 8px */
  --space-3: 0.75rem;    /* 12px */
  --space-4: 1rem;       /* 16px */
  --space-5: 1.25rem;    /* 20px */
  --space-6: 1.5rem;     /* 24px */
  --space-8: 2rem;       /* 32px */
  --space-10: 2.5rem;    /* 40px */
  --space-12: 3rem;      /* 48px */
  --space-16: 4rem;      /* 64px */

  /* ---- NEW: Typography tokens ---- */
  --font-size-2xs: 0.5625rem;   /* 9px */
  --font-size-xs: 0.625rem;     /* 10px */
  --font-size-sm: 0.6875rem;    /* 11px */
  --font-size-base: 0.75rem;    /* 12px */
  --font-size-md: 0.8125rem;    /* 13px */
  --font-size-lg: 0.875rem;     /* 14px */
  --font-size-xl: 0.9375rem;    /* 15px */
  --font-size-2xl: 1rem;        /* 16px */
  --font-size-heading-hero: 2.625rem; /* 42px */

  /* ---- MODIFIED: Layout tokens (now in rem) ---- */
  --nav-width: 17.5rem;         /* 280px */
  --combat-width: 22.5rem;      /* 360px */
  --tab-height: 2.375rem;       /* 38px */
  --heat-height: 2rem;          /* 32px */

  /* ---- NEW: Component tokens ---- */
  --nav-child-indent: 2.75rem;  /* 44px */
  --tab-min-width: 7.5rem;      /* 120px */
  --tab-max-width: 12.5rem;     /* 200px */
  --scrollbar-size: 0.5rem;     /* 8px */
}
```

#### `html` and `body` rules

**Before:**
```css
html { font-size: 14px; }
body {
  font-family: var(--font-body);
  background: var(--bg-0);
  color: var(--text-primary);
  line-height: 1.6;
  overflow: hidden;
  height: 100vh;
  width: 100vw;
}
```

**After:**
```css
html {
  /* Base font size: the foundation for all rem calculations.
     At default --ui-scale of 1, this is 14px (0.875rem of browser default 16px).
     Deliverable B will wrap this in calc() for scaling. */
  font-size: 0.875rem;
}

body {
  font-family: var(--font-body);
  background: var(--bg-0);
  color: var(--text-primary);
  line-height: 1.6;
  overflow: hidden;
  height: 100vh;
  width: 100vw;
}
```

**Why `0.875rem` instead of keeping `14px`:** The DM Guide originally set `html { font-size: 14px }`, which means all `rem` values in that document were calculated relative to 14px, not the browser's 16px default. This is a problem: it breaks user accessibility settings (browser zoom and minimum font size preferences both operate on the 16px baseline). By setting `html { font-size: 0.875rem }`, we get 14px at the default browser setting but preserve the user's ability to override via browser preferences. This is the WCAG 1.4.4 (Resize Text) compliant approach.

The token values in `:root` are calculated relative to 16px (the browser default that `rem` references), so `--font-size-md: 0.8125rem` produces 13px. When the root font-size is `0.875rem` (14px), and you apply `font-size: var(--font-size-md)` to an element, the browser computes `0.8125 * 16px = 13px`. The root font-size scaling does not affect how `rem` values resolve because `rem` always references the *computed* root font-size, not a relative one. This distinction matters: `rem` is absolute relative to root, `em` is relative to parent.

#### Scrollbar rules

**Before:**
```css
::-webkit-scrollbar { width: 8px; height: 8px; }
```

**After:**
```css
::-webkit-scrollbar { width: var(--scrollbar-size); height: var(--scrollbar-size); }
```

#### App grid layout

**Before:**
```css
#app {
  display: grid;
  grid-template-rows: var(--tab-height) var(--heat-height) 1fr;
  grid-template-columns: var(--nav-width) 1fr 0px;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  position: relative;
}
#app.combat-open {
  grid-template-columns: var(--nav-width) 1fr var(--combat-width);
}
#app.nav-collapsed {
  grid-template-columns: 0px 1fr 0px;
}
#app.nav-collapsed.combat-open {
  grid-template-columns: 0px 1fr var(--combat-width);
}
```

**After:** The grid layout itself already uses custom properties for `--nav-width`, `--combat-width`, `--tab-height`, and `--heat-height`. Since those are now in `rem`, this section needs no structural change. The `0px` values for collapsed states stay as `0px` because they represent "zero width," which is the same in any unit:

```css
#app {
  display: grid;
  grid-template-rows: var(--tab-height) var(--heat-height) 1fr;
  grid-template-columns: var(--nav-width) 1fr 0;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  position: relative;
}
#app.combat-open {
  grid-template-columns: var(--nav-width) 1fr var(--combat-width);
}
#app.nav-collapsed {
  grid-template-columns: 0 1fr 0;
}
#app.nav-collapsed.combat-open {
  grid-template-columns: 0 1fr var(--combat-width);
}
```

#### Tab bar

**Before:**
```css
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  min-width: 120px;
  max-width: 200px;
  height: 100%;
  font-size: 12px;
  font-weight: 500;
  /* ... */
}
.tab-close {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  font-size: 14px;
  /* ... */
}
```

**After:**
```css
.tab {
  display: flex;
  align-items: center;
  gap: var(--space-2);          /* was 6px, rounded to 8px (0.5rem) */
  padding: 0 var(--space-3);   /* was 14px, rounded to 12px (0.75rem) */
  min-width: var(--tab-min-width);  /* was 120px */
  max-width: var(--tab-max-width);  /* was 200px */
  height: 100%;
  font-size: var(--font-size-base); /* was 12px */
  font-weight: 500;
  /* ... */
}
.tab-close {
  width: 1.125rem;              /* 18px */
  height: 1.125rem;
  border-radius: var(--raw-radius-sm); /* 3px */
  font-size: var(--font-size-lg);     /* was 14px */
  /* ... */
}
```

**A note on rounding:** Some hardcoded values like `6px` and `14px` don't land exactly on the 4px grid (0.25rem increments). You have two choices: round to the nearest grid point (6px becomes 8px/0.5rem, 14px becomes 12px/0.75rem or 16px/1rem), or use exact conversions (6px = 0.375rem, 14px = 0.875rem). For this migration, I recommend **rounding to the nearest 4px grid point** where the visual difference is negligible (padding, gap), and using **exact conversions** where precision matters (font sizes, explicitly designed dimensions). The 4px grid discipline will pay dividends when you build the fluid spacing scale in Phase 3.

#### Heat bar

**Before:**
```css
#heat-bar {
  /* ... */
  gap: 10px;
  padding: 0 16px;
  font-size: 12px;
  /* ... */
}
.heat-segment {
  width: 48px;
  height: 100%;
  border-radius: 3px;
  /* ... */
}
.heat-gauge { display: flex; gap: 3px; height: 14px; }
```

**After:**
```css
#heat-bar {
  /* ... */
  gap: var(--space-3);          /* was 10px, rounded to 12px */
  padding: 0 var(--space-4);   /* was 16px */
  font-size: var(--font-size-base); /* was 12px */
  /* ... */
}
.heat-segment {
  width: 3rem;                  /* was 48px */
  height: 100%;
  border-radius: var(--raw-radius-sm); /* was 3px */
  /* ... */
}
.heat-gauge { display: flex; gap: var(--space-1); height: var(--font-size-lg); }
/* gap was 3px, rounded to 4px; height was 14px */
```

#### Navigation panel

**Before:**
```css
#nav-panel {
  /* ... */
  padding: 12px 0;
}
.nav-title {
  font-family: var(--font-heading);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  letter-spacing: 0.5px;
}
.nav-section-header {
  /* ... */
  gap: 8px;
  padding: 6px 16px;
  font-size: 13px;
  border-left: 3px solid transparent;
}
.nav-section-header .nav-icon { font-size: 14px; width: 20px; }
.nav-section-header .nav-chevron { font-size: 10px; }
.nav-child {
  padding: 4px 16px 4px 44px;
  font-size: 12px;
}
```

**After:**
```css
#nav-panel {
  /* ... */
  padding: var(--space-3) 0;   /* was 12px */
}
.nav-title {
  font-family: var(--font-heading);
  font-size: var(--font-size-md);       /* was 13px */
  font-weight: 600;
  padding: var(--space-2) var(--space-4); /* was 8px 16px */
  letter-spacing: 0.03125rem;            /* was 0.5px */
}
.nav-section-header {
  /* ... */
  gap: var(--space-2);                   /* was 8px */
  padding: var(--space-2) var(--space-4); /* was 6px 16px, 6 rounded to 8 */
  font-size: var(--font-size-md);        /* was 13px */
  border-left: 3px solid transparent;    /* border stays px */
}
.nav-section-header .nav-icon {
  font-size: var(--font-size-lg);        /* was 14px */
  width: var(--space-5);                 /* was 20px */
}
.nav-section-header .nav-chevron {
  font-size: var(--font-size-xs);        /* was 10px */
}
.nav-child {
  padding: var(--space-1) var(--space-4) var(--space-1) var(--nav-child-indent);
  /* was 4px 16px 4px 44px */
  font-size: var(--font-size-base);      /* was 12px */
}
```

#### Main content area

**Before:**
```css
#main-content {
  grid-column: 2;
  grid-row: 3;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px 32px 64px;
  scroll-behavior: smooth;
}
```

**After:**
```css
#main-content {
  grid-column: 2;
  grid-row: 3;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--space-6) var(--space-8) var(--space-16);
  /* was 24px 32px 64px */
  scroll-behavior: smooth;
}
```

#### Combat panel

**Before:**
```css
.combat-header {
  /* ... */
  padding: 12px 16px;
}
.combat-header h2 {
  font-family: var(--font-heading);
  font-size: 14px;
  /* ... */
}
.combat-close {
  width: 24px; height: 24px;
  border-radius: 4px; font-size: 16px;
}
.combat-section { padding: 12px 16px; }
.combat-section-title {
  font-family: var(--font-heading);
  font-size: 11px;
  letter-spacing: 1px;
  margin-bottom: 10px;
}
```

**After:**
```css
.combat-header {
  /* ... */
  padding: var(--space-3) var(--space-4); /* was 12px 16px */
}
.combat-header h2 {
  font-family: var(--font-heading);
  font-size: var(--font-size-lg);         /* was 14px */
  /* ... */
}
.combat-close {
  width: var(--space-6);                   /* was 24px */
  height: var(--space-6);
  border-radius: var(--raw-radius-md);     /* was 4px */
  font-size: var(--font-size-2xl);         /* was 16px */
}
.combat-section { padding: var(--space-3) var(--space-4); }
.combat-section-title {
  font-family: var(--font-heading);
  font-size: var(--font-size-sm);          /* was 11px */
  letter-spacing: 0.0625rem;               /* was 1px */
  margin-bottom: var(--space-3);           /* was 10px, rounded to 12px */
}
```

#### Block type styles (content blocks)

**Before (selected examples):**
```css
.block-read-aloud {
  padding: 20px 24px;
  margin: 16px 0;
  font-size: 15px;
  line-height: 1.8;
}
.block-read-aloud p { margin-bottom: 12px; }

.block-dm-note {
  margin: 12px 0;
}
.block-dm-note .block-header {
  padding: 10px 14px;
  font-size: 13px;
}

.block-skill-check {
  gap: 12px;
  padding: 10px 14px;
  margin: 10px 0;
}
.dc-badge {
  min-width: 42px; height: 42px;
  border-radius: 6px;
  font-size: 16px;
}

.block-narrative { margin: 10px 0; font-size: 14px; line-height: 1.7; }
.block-narrative p { margin-bottom: 10px; }
```

**After:**
```css
.block-read-aloud {
  padding: var(--space-5) var(--space-6);  /* was 20px 24px */
  margin: var(--space-4) 0;                /* was 16px */
  font-size: var(--font-size-xl);          /* was 15px */
  line-height: 1.8;
}
.block-read-aloud p { margin-bottom: var(--space-3); }

.block-dm-note {
  margin: var(--space-3) 0;                /* was 12px */
}
.block-dm-note .block-header {
  padding: var(--space-3) var(--space-4);  /* was 10px 14px, 10 rounded to 12, 14 to 16 */
  font-size: var(--font-size-md);          /* was 13px */
}

.block-skill-check {
  gap: var(--space-3);                     /* was 12px */
  padding: var(--space-3) var(--space-4);  /* was 10px 14px */
  margin: var(--space-3) 0;               /* was 10px, rounded to 12px */
}
.dc-badge {
  min-width: 2.625rem;                     /* was 42px */
  height: 2.625rem;
  border-radius: var(--raw-radius-lg);     /* was 6px */
  font-size: var(--font-size-2xl);         /* was 16px */
}

.block-narrative {
  margin: var(--space-3) 0;
  font-size: var(--font-size-lg);          /* was 14px */
  line-height: 1.7;
}
.block-narrative p { margin-bottom: var(--space-3); }
```

### File-by-file extraction: VTT Display

The VTT display CSS is split across multiple files. The key principle here is that **canvas-related dimensions stay in `px`** while **UI chrome dimensions convert to `rem`**.

#### theme.css changes

**Before:**
```css
html, body {
  width: var(--vtt-width);
  height: var(--vtt-height);
  /* ... */
}
```

These stay as-is. `--vtt-width: 1920px` and `--vtt-height: 1080px` are canvas constants and must never be rem-based.

Add the spacing/typography tokens to the VTT's `:root` (these can be identical to the DM Guide tokens, which is the seed of the shared token file that Phase 3 will formalize):

```css
:root {
  /* ... existing VTT tokens ... */

  /* NEW: Spacing tokens (shared with DM Guide) */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;

  /* NEW: Typography tokens */
  --font-size-2xs: 0.5625rem;
  --font-size-xs: 0.625rem;
  --font-size-sm: 0.6875rem;
  --font-size-base: 0.75rem;
  --font-size-md: 0.8125rem;
  --font-size-lg: 0.875rem;
  --font-size-2xl: 1rem;
  --font-size-loading: 2.625rem;

  /* MODIFIED: Initiative panel (rem) */
  --initiative-width: 18.75rem;  /* was 300px */
}
```

#### layout.css changes

**Before:**
```css
.loading__title {
  font-size: 42px;
  letter-spacing: 6px;
}
.loading__bar {
  width: 320px;
  height: 3px;
}
.loading__status {
  font-size: 11px;
  letter-spacing: 1px;
}
```

**After:**
```css
.loading__title {
  font-size: var(--font-size-loading);   /* was 42px */
  letter-spacing: 0.375rem;              /* was 6px */
}
.loading__bar {
  width: 20rem;                          /* was 320px */
  height: 3px;                           /* stays px: decorative line */
}
.loading__status {
  font-size: var(--font-size-sm);        /* was 11px */
  letter-spacing: 0.0625rem;             /* was 1px */
}
```

#### controls.css changes

**Before:**
```css
.dm-controls__inner {
  padding: 16px 20px;
  min-width: 260px;
}
.dm-controls__title {
  font-size: 10px;
  letter-spacing: 2px;
  margin-bottom: 12px;
  padding-bottom: 6px;
}
.dm-controls__group { margin-bottom: 10px; }
.dm-controls__group-label {
  font-size: 9px;
  letter-spacing: 1px;
  margin-bottom: 4px;
}
.dm-controls__key {
  min-width: 22px;
  height: 20px;
  padding: 0 5px;
  font-size: 10px;
  border-radius: 3px;
}
.dm-controls__action { font-size: 11px; }
```

**After:**
```css
.dm-controls__inner {
  padding: var(--space-4) var(--space-5);  /* was 16px 20px */
  min-width: 16.25rem;                      /* was 260px */
}
.dm-controls__title {
  font-size: var(--font-size-xs);           /* was 10px */
  letter-spacing: 0.125rem;                 /* was 2px */
  margin-bottom: var(--space-3);            /* was 12px */
  padding-bottom: var(--space-2);           /* was 6px, rounded to 8px */
}
.dm-controls__group { margin-bottom: var(--space-3); }
.dm-controls__group-label {
  font-size: var(--font-size-2xs);          /* was 9px */
  letter-spacing: 0.0625rem;               /* was 1px */
  margin-bottom: var(--space-1);            /* was 4px */
}
.dm-controls__key {
  min-width: 1.375rem;                      /* was 22px */
  height: var(--space-5);                   /* was 20px */
  padding: 0 0.3125rem;                     /* was 5px */
  font-size: var(--font-size-xs);           /* was 10px */
  border-radius: var(--raw-radius-sm);      /* was 3px */
}
.dm-controls__action { font-size: var(--font-size-sm); }
```

#### map.css changes

Token labels and HP bars are part of the canvas overlay system. These are positioned in the 1920x1080 coordinate space, so their positions must stay in `px`. However, their **font sizes and visual styling** should use tokens:

**Before:**
```css
.token-label {
  font-size: 11px;
  font-weight: 600;
}
.token-hp {
  width: 40px;
  height: 4px;
  border-radius: 2px;
}
.grid-info {
  top: 12px;
  right: 12px;
  font-size: 10px;
  padding: 4px 8px;
  border-radius: 3px;
}
```

**After:**
```css
.token-label {
  font-size: var(--font-size-sm);           /* was 11px */
  font-weight: 600;
}
.token-hp {
  width: 2.5rem;                            /* was 40px */
  height: 4px;                              /* stays px: thin decorative bar */
  border-radius: 2px;                       /* stays px: matches height */
}
.grid-info {
  top: var(--space-3);                      /* was 12px */
  right: var(--space-3);
  font-size: var(--font-size-xs);           /* was 10px */
  padding: var(--space-1) var(--space-2);   /* was 4px 8px */
  border-radius: var(--raw-radius-sm);      /* was 3px */
}
```

#### player-nav.css changes

**Before:**
```css
.player-nav {
  height: 64px;
  padding: 0 32px;
}
.pnav-left { gap: 10px; min-width: 240px; }
.pnav-chevron {
  width: 40px; height: 40px;
  border-radius: 6px;
  font-size: 22px;
}
```

**After:**
```css
.player-nav {
  height: 4rem;                             /* was 64px */
  padding: 0 var(--space-8);               /* was 32px */
}
.pnav-left { gap: var(--space-3); min-width: 15rem; }
.pnav-chevron {
  width: var(--space-10);                   /* was 40px */
  height: var(--space-10);
  border-radius: var(--raw-radius-lg);      /* was 6px */
  font-size: 1.375rem;                      /* was 22px */
}
```

### File-by-file extraction: Controller (index.html)

The Controller's CSS is entirely inlined. The same token set applies.

#### Add `:root` tokens to Controller

The Controller needs the same spacing and typography tokens. For now, duplicate them (Phase 3 will extract these into a shared `tokens.css` file). Add to the top of the Controller's `<style>` block:

```css
:root {
  /* Existing color tokens (unchanged) */
  --bg-0: #0D0F14;
  --bg-1: #141820;
  --bg-2: #1A1F2B;
  --bg-3: #212738;
  --bg-4: #2A3144;
  --gold: #C9A84C;
  --gold-dim: #8A7333;
  --text-primary: #E8E6E1;
  --text-secondary: #A0A0A8;
  --text-muted: #6B6B78;
  --red: #E74C3C;
  --green: #27AE60;
  --blue: #2E86AB;
  --purple: #7E57C2;
  --cyan: #48B5E0;
  --amber: #E8A84C;
  --font-heading: 'Cinzel', serif;
  --font-body: 'Inter', sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;

  /* NEW: Spacing tokens */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;

  /* NEW: Typography tokens */
  --font-size-2xs: 0.5625rem;
  --font-size-xs: 0.625rem;
  --font-size-sm: 0.6875rem;
  --font-size-base: 0.75rem;
  --font-size-md: 0.8125rem;
  --font-size-lg: 0.875rem;
  --font-size-2xl: 1rem;

  /* NEW: Control tokens */
  --control-radius: 0.25rem;
  --scrollbar-size: 0.375rem;
}
```

#### Controller body and chrome

**Before:**
```css
body {
  font-size: 13px;
  line-height: 1.4;
}
::-webkit-scrollbar { width: 6px; }
.header {
  padding: 12px 16px;
}
.header__title {
  font-size: 14px;
  letter-spacing: 1px;
}
.header__status {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 10px;
}
.section {
  padding: 10px 16px;
}
.section__label {
  font-size: 10px;
  letter-spacing: 0.8px;
  margin-bottom: 8px;
}
```

**After:**
```css
body {
  font-size: var(--font-size-md);           /* was 13px */
  line-height: 1.4;
}
::-webkit-scrollbar { width: var(--scrollbar-size); }
.header {
  padding: var(--space-3) var(--space-4);   /* was 12px 16px */
}
.header__title {
  font-size: var(--font-size-lg);           /* was 14px */
  letter-spacing: 0.0625rem;               /* was 1px */
}
.header__status {
  font-size: var(--font-size-sm);           /* was 11px */
  padding: var(--space-1) var(--space-3);   /* was 3px 10px */
  border-radius: 0.625rem;                 /* was 10px */
}
.section {
  padding: var(--space-3) var(--space-4);   /* was 10px 16px */
}
.section__label {
  font-size: var(--font-size-xs);           /* was 10px */
  letter-spacing: 0.05rem;                 /* was 0.8px */
  margin-bottom: var(--space-2);            /* was 8px */
}
```

#### Controller buttons and inputs

**Before:**
```css
.btn-row { display: flex; gap: 6px; flex-wrap: wrap; }
.btn {
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
}
.btn--sm { padding: 4px 8px; font-size: 11px; }
.btn--icon { padding: 5px 8px; font-size: 14px; min-width: 32px; }
.ctrl-select {
  padding: 5px 8px;
  border-radius: 4px;
  font-size: 12px;
  max-width: 200px;
}
.ctrl-input {
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
}
```

**After:**
```css
.btn-row { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.btn {
  padding: var(--space-2) var(--space-3);   /* was 6px 12px */
  border-radius: var(--control-radius);     /* was 4px */
  font-size: var(--font-size-base);         /* was 12px */
}
.btn--sm {
  padding: var(--space-1) var(--space-2);   /* was 4px 8px */
  font-size: var(--font-size-sm);           /* was 11px */
}
.btn--icon {
  padding: 0.3125rem var(--space-2);        /* was 5px 8px */
  font-size: var(--font-size-lg);           /* was 14px */
  min-width: var(--space-8);                /* was 32px */
}
.ctrl-select {
  padding: 0.3125rem var(--space-2);        /* was 5px 8px */
  border-radius: var(--control-radius);
  font-size: var(--font-size-base);         /* was 12px */
  max-width: var(--tab-max-width);          /* was 200px, reusing tab token */
}
.ctrl-input {
  padding: var(--space-2) var(--space-3);   /* was 6px 10px */
  border-radius: var(--control-radius);
  font-size: var(--font-size-base);
}
```

#### Controller scene nav and tokens

**Before:**
```css
.scene-nav { gap: 8px; margin-bottom: 8px; }
.scene-nav__label { font-size: 12px; }
.scene-list__toggle { font-size: 11px; }
.active-token__row { gap: 6px; padding: 4px 0; font-size: 12px; }
```

**After:**
```css
.scene-nav { gap: var(--space-2); margin-bottom: var(--space-2); }
.scene-nav__label { font-size: var(--font-size-base); }
.scene-list__toggle { font-size: var(--font-size-sm); }
.active-token__row {
  gap: var(--space-2);
  padding: var(--space-1) 0;
  font-size: var(--font-size-base);
}
```

---

## Deliverable B: Per-Window `--ui-scale` Mechanism

### The problem in full

Chrome (and all Chromium-based browsers) applies zoom settings per-origin: same scheme, same host, same port. This is confirmed as intentional behavior in Chromium issue #41118409, which is marked WontFix. When the VTT Display, DM Guide, and Controller all serve from `http://localhost:8765`, pressing `Ctrl+Plus` in any one of those windows changes the zoom level for all of them simultaneously.

This is the wrong behavior for a multi-window application. The DM might want the Controller at 120% for easier button targets, the DM Guide at 100% for maximum content density, and the VTT Display at its default (which has its own CSS transform scaling). Browser zoom affects all three identically, with no way to differentiate.

### The solution: CSS custom property scaling via `--ui-scale`

The approach converts the root font-size from a fixed value to a `calc()` expression that incorporates a `--ui-scale` multiplier:

```css
:root {
  --ui-scale: 1;
}

html {
  /* For DM Guide: base is 0.875rem (14px at browser default)
     Multiplied by --ui-scale for user preference */
  font-size: calc(0.875rem * var(--ui-scale));
}
```

Because every spacing and typography value is now in `rem` (from Deliverable A), changing `--ui-scale` from `1` to `1.2` scales the entire interface by 20%. The multiplication happens at the root level, so all `rem` calculations cascade automatically.

**Why this works mechanically:** `rem` values are computed relative to the *computed* value of `font-size` on the `<html>` element. When `html { font-size: calc(0.875rem * 1.2); }`, the computed root font-size becomes `16.8px` (0.875 * 16 * 1.2). Every `rem` in the document now resolves against `16.8px` instead of `14px`.

**Why `calc(0.875rem * var(--ui-scale))` instead of `calc(14px * var(--ui-scale))`:** Using `rem` instead of `px` in the base preserves browser zoom compatibility. If the user has set their browser's default font size to 20px (for accessibility), `0.875rem` computes to `17.5px` and `--ui-scale: 1.2` produces `21px`. With `14px`, the user's preference would be ignored.

### The scale slider UI

Each app needs a small, non-intrusive UI control for adjusting the scale. The design follows Gmail's density toggle pattern: a gear icon that opens a small popover with a slider.

#### HTML (add to each app)

For the DM Guide, add inside the `#heat-bar` element (it already has UI controls):

```html
<!-- Scale control: sits in the heat bar, right-aligned -->
<div class="scale-control" id="scale-control">
  <button class="scale-control__toggle" id="scale-toggle"
          aria-label="Adjust UI scale" title="UI Scale">
    <span class="scale-control__icon">&#9881;</span>
    <span class="scale-control__value" id="scale-value">100%</span>
  </button>
  <div class="scale-control__popover" id="scale-popover" hidden>
    <label class="scale-control__label" for="scale-slider">
      UI Scale
    </label>
    <input type="range" id="scale-slider"
           class="scale-control__slider"
           min="0.75" max="1.5" step="0.05" value="1">
    <div class="scale-control__readout">
      <span>75%</span>
      <span id="scale-readout">100%</span>
      <span>150%</span>
    </div>
    <button class="btn btn--sm scale-control__reset" id="scale-reset">
      Reset
    </button>
  </div>
</div>
```

For the Controller, add inside the `.header` element:

```html
<!-- Same structure, placed in header next to connection status -->
<div class="scale-control" id="scale-control">
  <button class="scale-control__toggle" id="scale-toggle"
          aria-label="Adjust UI scale" title="UI Scale">
    <span class="scale-control__icon">&#9881;</span>
    <span class="scale-control__value" id="scale-value">100%</span>
  </button>
  <div class="scale-control__popover" id="scale-popover" hidden>
    <label class="scale-control__label" for="scale-slider">
      UI Scale
    </label>
    <input type="range" id="scale-slider"
           class="scale-control__slider"
           min="0.75" max="1.5" step="0.05" value="1">
    <div class="scale-control__readout">
      <span>75%</span>
      <span id="scale-readout">100%</span>
      <span>150%</span>
    </div>
    <button class="btn btn--sm scale-control__reset" id="scale-reset">
      Reset
    </button>
  </div>
</div>
```

**Note: The VTT Display does NOT get a scale slider.** The VTT Display already has its own scaling mechanism via `transform: scale()` on the canvas stack (Phase 1). Adding `--ui-scale` to the VTT would double-scale text elements and create confusion. The VTT's overlay text (token labels, HP bars) scales with the canvas transform. Any future UI chrome on the VTT (like the player nav bar) can adopt `--ui-scale` independently if needed.

#### CSS for the scale control

```css
/* ---- Scale Control ---- */
.scale-control {
  position: relative;
  margin-left: auto;              /* Push to right side of flex container */
}

.scale-control__toggle {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  background: transparent;
  border: 1px solid var(--bg-3);
  border-radius: var(--control-radius);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: color var(--transition-fast), border-color var(--transition-fast);
}

.scale-control__toggle:hover {
  color: var(--text-secondary);
  border-color: var(--bg-4);
}

.scale-control__icon {
  font-size: var(--font-size-lg);
}

.scale-control__popover {
  position: absolute;
  top: calc(100% + var(--space-2));
  right: 0;
  z-index: 200;
  background: var(--bg-2);
  border: 1px solid var(--bg-4);
  border-radius: var(--raw-radius-lg);
  padding: var(--space-3);
  min-width: 12rem;
  box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.4);
}

.scale-control__popover[hidden] { display: none; }

.scale-control__label {
  display: block;
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05rem;
  color: var(--text-muted);
  margin-bottom: var(--space-2);
}

.scale-control__slider {
  width: 100%;
  accent-color: var(--gold);
  cursor: pointer;
}

.scale-control__readout {
  display: flex;
  justify-content: space-between;
  font-family: var(--font-mono);
  font-size: var(--font-size-2xs);
  color: var(--text-muted);
  margin-top: var(--space-1);
  margin-bottom: var(--space-2);
}

#scale-readout {
  color: var(--gold);
  font-weight: 600;
}

.scale-control__reset {
  width: 100%;
  text-align: center;
}
```

#### JavaScript: scale control logic

This module handles persistence, UI interaction, and the actual CSS variable manipulation:

```javascript
/**
 * UI Scale Controller
 *
 * Manages per-window UI scaling via CSS custom property --ui-scale.
 * Persists scale preference per-app using localStorage keyed by pathname.
 *
 * Usage:
 *   import { initScaleControl } from './scale-control.js';
 *   initScaleControl();
 */

const STORAGE_PREFIX = 'vtt-ui-scale';
const DEFAULT_SCALE = 1;
const MIN_SCALE = 0.75;
const MAX_SCALE = 1.5;
const STEP = 0.05;

/**
 * Get the localStorage key for the current app window.
 * Uses pathname to differentiate: '/controller', '/dm-guide', etc.
 */
function getStorageKey() {
  // Normalize: strip trailing slashes and index.html
  const path = window.location.pathname
    .replace(/\/index\.html$/, '')
    .replace(/\/$/, '') || '/root';
  return `${STORAGE_PREFIX}:${path}`;
}

/**
 * Load persisted scale value, falling back to default.
 */
function loadScale() {
  try {
    const stored = localStorage.getItem(getStorageKey());
    if (stored !== null) {
      const val = parseFloat(stored);
      if (!isNaN(val) && val >= MIN_SCALE && val <= MAX_SCALE) {
        return val;
      }
    }
  } catch (e) {
    // localStorage unavailable (incognito, storage full, etc.)
    console.warn('[ScaleControl] Could not read localStorage:', e);
  }
  return DEFAULT_SCALE;
}

/**
 * Persist the current scale value.
 */
function saveScale(value) {
  try {
    localStorage.setItem(getStorageKey(), String(value));
  } catch (e) {
    console.warn('[ScaleControl] Could not write localStorage:', e);
  }
}

/**
 * Apply the scale to the document.
 */
function applyScale(value) {
  document.documentElement.style.setProperty('--ui-scale', String(value));
}

/**
 * Format scale as percentage for display.
 */
function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

/**
 * Initialize the scale control UI and behavior.
 * Call this after DOM is ready.
 */
export function initScaleControl() {
  const toggle = document.getElementById('scale-toggle');
  const popover = document.getElementById('scale-popover');
  const slider = document.getElementById('scale-slider');
  const readout = document.getElementById('scale-readout');
  const valueDisplay = document.getElementById('scale-value');
  const resetBtn = document.getElementById('scale-reset');

  // Bail gracefully if UI elements aren't present (e.g., VTT display)
  if (!toggle || !slider) return;

  // Load and apply persisted scale
  let currentScale = loadScale();
  applyScale(currentScale);
  slider.value = String(currentScale);
  if (readout) readout.textContent = formatPercent(currentScale);
  if (valueDisplay) valueDisplay.textContent = formatPercent(currentScale);

  // Toggle popover
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = popover.hidden;
    popover.hidden = !isHidden;
  });

  // Close popover on outside click
  document.addEventListener('click', (e) => {
    if (!popover.hidden && !popover.contains(e.target) && e.target !== toggle) {
      popover.hidden = true;
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popover.hidden) {
      popover.hidden = true;
      toggle.focus();
    }
  });

  // Slider input (live preview)
  slider.addEventListener('input', () => {
    currentScale = parseFloat(slider.value);
    applyScale(currentScale);
    if (readout) readout.textContent = formatPercent(currentScale);
    if (valueDisplay) valueDisplay.textContent = formatPercent(currentScale);
  });

  // Slider change (persist on release)
  slider.addEventListener('change', () => {
    saveScale(currentScale);
  });

  // Reset button
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      currentScale = DEFAULT_SCALE;
      slider.value = String(DEFAULT_SCALE);
      applyScale(DEFAULT_SCALE);
      saveScale(DEFAULT_SCALE);
      if (readout) readout.textContent = formatPercent(DEFAULT_SCALE);
      if (valueDisplay) valueDisplay.textContent = formatPercent(DEFAULT_SCALE);
    });
  }

  // Listen for storage events from other tabs of the same app
  // (in case user has two DM Guide windows open)
  window.addEventListener('storage', (e) => {
    if (e.key === getStorageKey() && e.newValue !== null) {
      const newScale = parseFloat(e.newValue);
      if (!isNaN(newScale) && newScale >= MIN_SCALE && newScale <= MAX_SCALE) {
        currentScale = newScale;
        applyScale(newScale);
        slider.value = String(newScale);
        if (readout) readout.textContent = formatPercent(newScale);
        if (valueDisplay) valueDisplay.textContent = formatPercent(newScale);
      }
    }
  });
}
```

#### Updating the root font-size declarations

With Deliverable A complete and the scale control module in place, update each app's `html` rule:

**DM Guide:**
```css
:root { --ui-scale: 1; }

html {
  font-size: calc(0.875rem * var(--ui-scale));
  /* 0.875rem = 14px at browser default.
     At --ui-scale: 1.2, computes to 16.8px.
     All rem values scale proportionally. */
}
```

**Controller:**
```css
:root { --ui-scale: 1; }

html {
  font-size: calc(0.8125rem * var(--ui-scale));
  /* 0.8125rem = 13px at browser default.
     The Controller uses a slightly smaller base than the DM Guide
     because it's a dense control surface. */
}
```

**VTT Display:** No change. The VTT's `html` element keeps its existing sizing. The canvas stack has its own transform-based scaling from Phase 1.

### How `--ui-scale` interacts with browser zoom

This is a subtle but important interaction to understand. When the user presses `Ctrl+Plus` in Chrome, the browser scales **everything**: the computed root font-size, all `rem` values, all `px` values, images, the `transform: scale()` on the VTT canvas, everything. This is the zoom that Chrome applies per-origin.

With `--ui-scale`, we are adding a *second* layer of scaling that only affects `rem`-based values (because it works by changing the root font-size). The two layers compound multiplicatively:

- Browser zoom 100%, `--ui-scale: 1.0`: Everything at default size
- Browser zoom 100%, `--ui-scale: 1.2`: `rem` values 20% larger, `px` values unchanged
- Browser zoom 110%, `--ui-scale: 1.0`: Everything 10% larger (browser does this)
- Browser zoom 110%, `--ui-scale: 1.2`: `rem` values 32% larger (1.1 * 1.2), `px` values 10% larger

This compounding is fine and expected. The user adjusts `--ui-scale` to compensate for whatever browser zoom they're stuck with due to Chrome's per-origin behavior. If all three windows are at 110% browser zoom but the DM wants the Controller larger and the DM Guide at default, they set `--ui-scale: 1.1` on the Controller and leave the DM Guide at `--ui-scale: 0.91` (to counteract the browser zoom).

The `px` values that we intentionally left unconverted (borders, thin lines, canvas dimensions) do not participate in `--ui-scale` but still respond to browser zoom. This is correct: a 1px border should remain a single-pixel line regardless of the UI scale preference.

---

## Deliverable C: Container-Query-Driven Controller Grid

### Why container queries instead of media queries

The Controller runs in a pop-up browser window whose size bears no predictable relationship to the viewport. A user might open it at 520x900, or stretch it to 1200x600, or half-screen it at 960x1080. Media queries reference the viewport (the browser window), but in a multi-window architecture, the viewport IS the window, so this distinction seems academic. However, container queries offer a deeper advantage: **component portability**.

When the Controller's sections are container-query-driven, you can embed one of those sections in a different context (say, a popover in the DM Guide, or a panel in the future React app) and it will reflow correctly based on its container's width, not the viewport's width. This matters for the React migration because React components should be context-independent. Training yourself to write container-query-driven layouts now establishes the pattern that maps directly to responsive React components later.

Container queries also compose better. A `@media (min-width: 500px)` rule fires at 500px viewport width, period. A `@container (min-width: 500px)` rule fires when the container element is 500px wide, which depends on the container's own position in the layout. If the Controller later gets a sidebar or a collapsed panel that reduces the available space, the container queries adapt automatically. Media queries would need manual recalculation.

Browser support is universal for the layouts we need: Chrome 105+, Firefox 110+, Safari 16+. That covers 97%+ of global browser usage as of 2025, and since we only target Chrome for the VTT, support is 100%.

### Current Controller structure analysis

The Controller currently renders as a single scrolling column:

```
+---------------------------+
| HEADER (status)           |
+---------------------------+
| Scene Nav (prev/next)     |
+---------------------------+
| Mode Switch               |
+---------------------------+
| Map Controls              |
+---------------------------+
| Tokens                    |
+---------------------------+
| Effects                   |
+---------------------------+
| Overlay Text              |
+---------------------------+
| Title Card                |
+---------------------------+
| Combat                    |
+---------------------------+
```

The sections have different sizes and usage frequencies:

| Section | Height (approx) | Usage Frequency | Width Need |
|---------|---------|----------------|-----------|
| Scene Nav | Short | Constant | Full width (nav arrows need horizontal space) |
| Mode Switch | Short | Frequent | Compact (3 buttons) |
| Map Controls | Medium | Frequent | Medium (select + buttons) |
| Tokens | Tall (variable) | Frequent during combat | Full width (active tokens list) |
| Effects | Medium | Occasional | Medium (button grid) |
| Overlay Text | Short | Rare | Compact (input + buttons) |
| Title Card | Short | Rare | Compact (select + button) |
| Combat | Medium | During combat only | Medium |

### The reflow strategy

At different container widths, the sections rearrange:

**Narrow (< 500px):** Single column, all sections stacked. This is the current layout and works fine for the default 520px window.

**Medium (500-799px):** Two columns. High-frequency sections get priority positioning:

```
+---------------------------+
| HEADER (status)           |
+---------------------------+
| Scene Nav (full width)    |
+---------------------------+
| Mode Switch | Map Controls|
| ----------- | ----------- |
| Tokens      | Effects     |
| (tall)      |             |
|             | Overlay     |
|             | ----------- |
|             | Title Card  |
+---------------------------+
| Combat (full width)       |
+---------------------------+
```

**Wide (800px+):** Three columns for maximum density:

```
+----------------------------------------+
| HEADER (status)                        |
+----------------------------------------+
| Scene Nav (full width)                 |
+----------------------------------------+
| Mode + Map  | Tokens    | Effects      |
|             |           | ------------ |
|             |           | Overlay      |
|             |           | ------------ |
|             |           | Title Card   |
+----------------------------------------+
| Combat (full width)                    |
+----------------------------------------+
```

### HTML restructuring

The current Controller HTML needs minor restructuring to support grid area assignment. Wrap the sections in a grid container and add semantic classes:

```html
<body>
  <div class="header" id="header">
    <span class="header__title">VTT Controller</span>
    <span class="header__status header__status--waiting" id="conn-status">
      Waiting&hellip;
    </span>
    <!-- Scale control goes here (Deliverable B) -->
    <div class="scale-control" id="scale-control">
      <!-- ... scale control HTML ... -->
    </div>
  </div>

  <!-- NEW: Grid container wrapping all control sections -->
  <div class="controller-body" id="controller-body">
    <div class="control-sections">

      <!-- Scene Nav: always full width -->
      <div class="section section--full-width" id="sec-scene">
        <div class="section__label">Scene</div>
        <div class="scene-nav">
          <button class="btn btn--icon" id="scene-prev">&lsaquo;</button>
          <span class="scene-nav__label" id="scene-label">S01</span>
          <button class="btn btn--icon" id="scene-next">&rsaquo;</button>
        </div>
        <div class="scene-list" id="scene-list"></div>
      </div>

      <!-- Mode Switch: pairs with Map Controls -->
      <div class="section section--mode" id="sec-mode">
        <div class="section__label">Mode</div>
        <div class="btn-row">
          <button class="btn" data-mode="theater">Theater</button>
          <button class="btn" data-mode="map">Map</button>
          <button class="btn" data-mode="initiative">Combat</button>
        </div>
      </div>

      <!-- Map Controls: pairs with Mode Switch -->
      <div class="section section--map" id="sec-map">
        <div class="section__label">Map</div>
        <div class="btn-row" style="margin-bottom:var(--space-2)">
          <select class="ctrl-select" id="map-select"></select>
          <button class="btn btn--sm" id="map-load">Load</button>
        </div>
        <div class="section__label" style="margin-top:var(--space-2)">Camera</div>
        <div class="btn-row">
          <button class="btn btn--icon" data-camera="left">&larr;</button>
          <button class="btn btn--icon" data-camera="up">&uarr;</button>
          <button class="btn btn--icon" data-camera="down">&darr;</button>
          <button class="btn btn--icon" data-camera="right">&rarr;</button>
          <button class="btn btn--sm" data-camera="zoom-in">+</button>
          <button class="btn btn--sm" data-camera="zoom-out">&minus;</button>
          <button class="btn btn--sm" data-camera="reset">Fit</button>
        </div>
        <div class="btn-row" style="margin-top:var(--space-2)">
          <button class="btn btn--sm" id="fog-reveal">Reveal Fog</button>
          <button class="btn btn--sm" id="fog-hide">Hide Fog</button>
          <button class="btn btn--sm" id="grid-toggle">Grid</button>
        </div>
      </div>

      <!-- Tokens: tall, gets its own column at medium+ -->
      <div class="section section--tokens" id="sec-tokens">
        <div class="section__label">Tokens</div>
        <div class="btn-row" style="margin-bottom:var(--space-2)">
          <select class="ctrl-select" id="preset-select"></select>
          <button class="btn btn--sm" id="preset-load">Load Preset</button>
          <button class="btn btn--sm btn--danger" id="clear-tokens">Clear All</button>
        </div>
        <div id="token-buttons"></div>
        <div class="active-tokens">
          <div class="token-group__label">Active Tokens</div>
          <div id="active-tokens-list"></div>
        </div>
      </div>

      <!-- Effects: medium frequency -->
      <div class="section section--effects" id="sec-effects">
        <div class="section__label">Effects</div>
        <div class="btn-row" style="margin-bottom:var(--space-2)">
          <span class="text-xs text-muted" style="white-space:nowrap">Target:</span>
          <select class="ctrl-select" id="effect-target" style="flex:1">
            <option value="">Map Center</option>
          </select>
        </div>
        <div class="effects-grid" id="effects-grid"></div>
      </div>

      <!-- Overlay: low frequency, collapsible -->
      <details class="section section--overlay" id="sec-overlay">
        <summary class="section__label section__label--collapsible">
          Overlay Text
        </summary>
        <div class="section__content">
          <div class="btn-row">
            <input type="text" class="ctrl-input" id="overlay-input"
                   placeholder="Overlay text...">
            <button class="btn btn--sm" id="overlay-send">Send</button>
            <button class="btn btn--sm btn--danger" id="overlay-clear">&#10005;</button>
          </div>
        </div>
      </details>

      <!-- Title Card: low frequency, collapsible -->
      <details class="section section--title" id="sec-title">
        <summary class="section__label section__label--collapsible">
          Title Card
        </summary>
        <div class="section__content">
          <div class="btn-row">
            <select class="ctrl-select" id="title-act-select"></select>
            <button class="btn btn--sm" id="title-send">Show</button>
          </div>
        </div>
      </details>

      <!-- Combat: full width when active -->
      <div class="section section--full-width section--combat" id="sec-combat">
        <div class="section__label">Combat</div>
        <div class="combat-info" id="combat-info"></div>
        <div class="btn-row">
          <button class="btn btn--sm" id="next-turn">Next Turn</button>
        </div>
      </div>

    </div><!-- .control-sections -->
  </div><!-- .controller-body -->

  <div class="cond-popup" id="cond-popup" style="display:none"></div>

  <script type="module" src="js/main.js"></script>
</body>
```

**Key structural changes:**

1. Added `.controller-body` wrapper with `container-type: inline-size` for the container query context.
2. Added `.control-sections` grid container that holds all sections.
3. Added semantic modifier classes: `section--full-width`, `section--mode`, `section--map`, `section--tokens`, `section--effects`, `section--overlay`, `section--title`, `section--combat`.
4. Converted Overlay and Title Card sections from `<div>` to `<details>/<summary>` for native collapsibility. No JavaScript needed, accessible by default, keyboard operable.
5. The `.section__label` on collapsible sections gets a `section__label--collapsible` class for styling the summary marker.

### Container query CSS

```css
/* ============================================
   Controller Layout: Container-Query Grid
   ============================================ */

/* Container context: the body area below the sticky header */
.controller-body {
  container-type: inline-size;
  container-name: controller;
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;  /* Fill remaining space below header */
}

/* Grid container for all sections */
.control-sections {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1px;  /* 1px gap creates visual separator via background color */
  background: var(--bg-3);  /* The "border" color between sections */
}

/* Each section needs its own background to create the bordered effect */
.control-sections > .section {
  background: var(--bg-0);
  padding: var(--space-3) var(--space-4);
}

/* Full-width sections span all columns at every breakpoint */
.section--full-width {
  grid-column: 1 / -1;
}

/* ---- Medium: Two-column layout at 500px+ ---- */
@container controller (min-width: 500px) {
  .control-sections {
    grid-template-columns: 1fr 1fr;
  }

  /* Scene nav and combat always span full width */
  .section--full-width {
    grid-column: 1 / -1;
  }

  /* Mode + Map stack in column 1 */
  .section--mode {
    grid-column: 1;
    grid-row: auto;
  }
  .section--map {
    grid-column: 1;
  }

  /* Tokens + Effects stack in column 2 */
  .section--tokens {
    grid-column: 2;
    grid-row: span 2;  /* Tokens section is tall, spans Mode + Map rows */
  }
  .section--effects {
    grid-column: 2;
  }

  /* Low-frequency sections fill remaining space */
  .section--overlay {
    grid-column: 1;
  }
  .section--title {
    grid-column: 2;
  }
}

/* ---- Wide: Three-column layout at 800px+ ---- */
@container controller (min-width: 800px) {
  .control-sections {
    grid-template-columns: 1fr 1fr 1fr;
  }

  .section--full-width {
    grid-column: 1 / -1;
  }

  /* Column 1: Mode + Map (stacked) */
  .section--mode {
    grid-column: 1;
  }
  .section--map {
    grid-column: 1;
  }

  /* Column 2: Tokens (spans all rows in its area) */
  .section--tokens {
    grid-column: 2;
    grid-row: span 2;
  }

  /* Column 3: Effects, Overlay, Title Card (stacked) */
  .section--effects {
    grid-column: 3;
  }
  .section--overlay {
    grid-column: 3;
  }
  .section--title {
    grid-column: 3;
  }
}
```

### Collapsible sections with `<details>/<summary>`

The Overlay and Title Card sections are low-frequency controls. Converting them to `<details>` elements makes them collapsible with zero JavaScript, fully accessible (keyboard and screen reader operable), and stylistically consistent with the rest of the UI:

```css
/* Collapsible section styles (native <details>/<summary>) */
details.section {
  /* Remove the default disclosure triangle */
}

details.section > summary {
  list-style: none;
  cursor: pointer;
}

details.section > summary::-webkit-details-marker {
  display: none;
}

/* The label acts as the summary header */
.section__label--collapsible {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  user-select: none;
}

/* Custom disclosure indicator */
.section__label--collapsible::after {
  content: '\25B6';  /* Right-pointing triangle */
  font-size: var(--font-size-2xs);
  color: var(--text-muted);
  margin-left: auto;
  transition: transform var(--transition-fast);
}

details.section[open] > .section__label--collapsible::after {
  transform: rotate(90deg);
}

/* Content area with animated reveal */
.section__content {
  padding-top: var(--space-2);
}

/* Smooth open/close animation using grid trick */
details.section > .section__content {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--transition-base);
  overflow: hidden;
}

details.section[open] > .section__content {
  grid-template-rows: 1fr;
}

details.section > .section__content > * {
  overflow: hidden;
}
```

**Note on the `<details>` animation:** The `grid-template-rows: 0fr` to `1fr` animation trick only works for the open transition. The browser's native close is instantaneous. For fully smooth bidirectional animation, you would need the `::details-content` pseudo-element (Chrome 131+) or JavaScript. The one-way animation is acceptable here since the close action is intentional and doesn't need to be gradual.

### Touch target sizing

The Controller is primarily a mouse-driven interface, but it may occasionally be used on tablets or touch-screen laptops. WCAG 2.2 SC 2.5.8 requires 24x24px minimum touch targets at AA level. We use `@media (pointer: fine)` to detect precision input devices and allow the current compact sizes, scaling up for touch:

```css
/* Default: optimized for mouse (pointer: fine) */
.btn {
  min-height: var(--space-6);  /* 24px: WCAG AA minimum */
  /* padding from earlier token extraction */
}

/* Touch devices: larger targets */
@media (pointer: coarse) {
  .btn {
    min-height: 2.75rem;  /* 44px: WCAG AAA recommended */
    min-width: 2.75rem;
    padding: var(--space-3) var(--space-4);
  }

  .btn--sm {
    min-height: 2.75rem;
    padding: var(--space-2) var(--space-3);
  }

  .btn--icon {
    min-height: 2.75rem;
    min-width: 2.75rem;
  }

  .ctrl-select,
  .ctrl-input {
    min-height: 2.75rem;
    font-size: var(--font-size-2xl);  /* Bump to 16px to prevent iOS zoom */
  }
}
```

**The iOS zoom trap:** On iOS Safari, any `<input>` or `<select>` with a font-size below 16px triggers an automatic zoom-in when focused. Setting `font-size: var(--font-size-2xl)` (1rem = 16px) prevents this.

---

## Shared Token Architecture

### Toward a shared `tokens.css` file

Phase 2 introduces the same token values across all three apps, duplicated in each app's styles. Phase 3 will extract these into a single shared file. Here is the preparatory file structure to work toward:

```
shared/
  tokens.css       [Phase 3: extracted from duplicated :root blocks]
  reset.css        [Phase 3: extracted from duplicated resets]
vtt/
  css/
    theme.css      [VTT-specific tokens + shared token overrides]
    layout.css
    map.css
    controls.css
    player-nav.css
    ...
dm-guide/
  (currently index.html inline styles, Phase 3 extracts to files)
controller/
  (currently index.html inline styles, Phase 3 extracts to files)
```

For Phase 2, the token values are duplicated across the three apps' `:root` blocks. This is intentional: it avoids introducing a build step or a `<link>` dependency at a point where you're already making a large number of CSS changes. Keeping the changes contained to each app's existing stylesheet reduces risk.

**Why not extract now?** Because the DM Guide and Controller currently have all their CSS inlined in their HTML files. Extracting to external CSS files is a separate, risky change (it changes load order, introduces network dependencies for local serving, and requires updating the development server). Do one thing at a time.

### Naming conventions that survive the React migration

The token names in this guide are designed to map directly to a JavaScript theme object:

| CSS Token | Future React Theme |
|-----------|-------------------|
| `var(--space-4)` | `theme.space[4]` |
| `var(--font-size-md)` | `theme.fontSize.md` |
| `var(--color-bg-1)` | `theme.color.bg[1]` |
| `var(--control-radius)` | `theme.control.radius` |

The `--raw-*` prefix for primitives corresponds to the lowest tier of the design token taxonomy. In a React context, these become the values in a `primitives` object that semantic tokens reference. The three-tier hierarchy (primitive, semantic, component) is the same pattern used by Chakra UI, Radix Themes, and Tailwind's design token system.

---

## Testing Protocols

### Visual regression strategy

The fundamental challenge of testing a CSS token extraction is that **nothing should visually change**. Every `13px` that becomes `var(--font-size-md)` must still render as 13px. This is a perfect case for visual regression testing.

#### Playwright viewport matrix

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,  // Allow 1% pixel diff for font rendering
    },
  },
  projects: [
    { name: 'dm-1280x800',  use: { viewport: { width: 1280, height: 800 } } },
    { name: 'dm-1920x1080', use: { viewport: { width: 1920, height: 1080 } } },
    { name: 'dm-960x1080',  use: { viewport: { width: 960, height: 1080 } } },
    { name: 'dm-2560x1440', use: { viewport: { width: 2560, height: 1440 } } },
    { name: 'ctrl-520x900', use: { viewport: { width: 520, height: 900 } } },
    { name: 'ctrl-800x600', use: { viewport: { width: 800, height: 600 } } },
    { name: 'ctrl-1200x800', use: { viewport: { width: 1200, height: 800 } } },
    { name: 'vtt-1920x1080', use: { viewport: { width: 1920, height: 1080 } } },
    { name: 'vtt-1280x800',  use: { viewport: { width: 1280, height: 800 } } },
  ],
});
```

#### Baseline capture (run BEFORE any changes)

```typescript
// tests/visual/baseline.spec.ts
import { test, expect } from '@playwright/test';

const APPS = [
  { name: 'dm-guide', url: '/index.html' },
  { name: 'controller', url: '/controller/index.html' },
  { name: 'vtt', url: '/vtt/index.html' },
];

for (const app of APPS) {
  test(`${app.name}: baseline screenshot`, async ({ page }) => {
    await page.goto(app.url);
    await page.waitForTimeout(500);  // Allow fonts and async rendering to settle
    await expect(page).toHaveScreenshot(`${app.name}-full.png`);
  });
}
```

Run this once before starting Deliverable A to capture reference screenshots. After each deliverable, run again and compare. The `maxDiffPixelRatio: 0.01` threshold allows for minor subpixel differences from font rendering changes (rem values may land on slightly different subpixel boundaries than exact px values).

#### Token extraction validation tests

```typescript
// tests/visual/token-extraction.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Deliverable A: Token Extraction', () => {

  test('DM Guide: rem values produce same computed sizes as original px', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForTimeout(300);

    const measurements = await page.evaluate(() => {
      const results: Record<string, { computed: string, expected: string }> = {};

      // Check key elements
      const checks = [
        { sel: '#main-content', prop: 'padding-top', expected: '24px' },
        { sel: '#main-content', prop: 'padding-left', expected: '32px' },
        { sel: '.nav-title', prop: 'font-size', expected: '13px' },
        { sel: '.nav-title', prop: 'padding-top', expected: '8px' },
        { sel: '.nav-section-header', prop: 'font-size', expected: '13px' },
        { sel: '#heat-bar', prop: 'font-size', expected: '12px' },
      ];

      for (const { sel, prop, expected } of checks) {
        const el = document.querySelector(sel);
        if (el) {
          const computed = getComputedStyle(el).getPropertyValue(prop);
          results[`${sel}:${prop}`] = { computed, expected };
        }
      }
      return results;
    });

    for (const [key, { computed, expected }] of Object.entries(measurements)) {
      // Allow 1px tolerance for rounding
      const computedNum = parseFloat(computed);
      const expectedNum = parseFloat(expected);
      expect(Math.abs(computedNum - expectedNum),
        `${key}: expected ~${expected}, got ${computed}`
      ).toBeLessThanOrEqual(1);
    }
  });

  test('Controller: rem values produce same computed sizes', async ({ page }) => {
    await page.goto('/controller/index.html');
    await page.waitForTimeout(300);

    const measurements = await page.evaluate(() => {
      const results: Record<string, { computed: string, expected: string }> = {};

      const checks = [
        { sel: 'body', prop: 'font-size', expected: '13px' },
        { sel: '.header', prop: 'padding-top', expected: '12px' },
        { sel: '.header__title', prop: 'font-size', expected: '14px' },
        { sel: '.section', prop: 'padding-top', expected: '10px' },
        { sel: '.section__label', prop: 'font-size', expected: '10px' },
        { sel: '.btn', prop: 'font-size', expected: '12px' },
      ];

      for (const { sel, prop, expected } of checks) {
        const el = document.querySelector(sel);
        if (el) {
          const computed = getComputedStyle(el).getPropertyValue(prop);
          results[`${sel}:${prop}`] = { computed, expected };
        }
      }
      return results;
    });

    for (const [key, { computed, expected }] of Object.entries(measurements)) {
      const computedNum = parseFloat(computed);
      const expectedNum = parseFloat(expected);
      expect(Math.abs(computedNum - expectedNum),
        `${key}: expected ~${expected}, got ${computed}`
      ).toBeLessThanOrEqual(2);  // 2px tolerance for rounded values
    }
  });
});
```

#### UI Scale tests

```typescript
// tests/visual/ui-scale.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Deliverable B: UI Scale', () => {

  test('DM Guide: --ui-scale 1.2 enlarges all rem-based elements', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForTimeout(300);

    // Capture baseline measurement
    const baseline = await page.evaluate(() => {
      const el = document.querySelector('.nav-title');
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });

    // Apply 1.2 scale
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--ui-scale', '1.2');
    });
    await page.waitForTimeout(100);

    const scaled = await page.evaluate(() => {
      const el = document.querySelector('.nav-title');
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });

    // Font size should increase by ~20%
    const ratio = scaled / baseline;
    expect(ratio).toBeGreaterThan(1.15);
    expect(ratio).toBeLessThan(1.25);
  });

  test('DM Guide: scale persists in localStorage', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForTimeout(300);

    // Set scale via slider
    await page.click('#scale-toggle');
    await page.fill('#scale-slider', '1.3');
    await page.dispatchEvent('#scale-slider', 'input');
    await page.dispatchEvent('#scale-slider', 'change');

    // Check localStorage
    const stored = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      return keys
        .filter(k => k.startsWith('vtt-ui-scale'))
        .map(k => ({ key: k, value: localStorage.getItem(k) }));
    });

    expect(stored.length).toBeGreaterThan(0);
    expect(parseFloat(stored[0].value!)).toBeCloseTo(1.3, 1);
  });

  test('DM Guide: reset button restores scale to 1.0', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForTimeout(300);

    // Set non-default scale
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--ui-scale', '1.3');
    });

    // Click reset
    await page.click('#scale-toggle');
    await page.click('#scale-reset');
    await page.waitForTimeout(100);

    const scale = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim()
    );
    expect(scale).toBe('1');
  });

  test('Controller: independent scale from DM Guide', async ({ page, context }) => {
    // Open DM Guide
    await page.goto('/index.html');
    await page.waitForTimeout(300);

    // Open Controller in new tab
    const controllerPage = await context.newPage();
    await controllerPage.goto('/controller/index.html');
    await controllerPage.waitForTimeout(300);

    // Set different scales
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--ui-scale', '0.8');
    });
    await controllerPage.evaluate(() => {
      document.documentElement.style.setProperty('--ui-scale', '1.3');
    });

    // Verify they're independent
    const dmScale = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim()
    );
    const ctrlScale = await controllerPage.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim()
    );

    expect(dmScale).toBe('0.8');
    expect(ctrlScale).toBe('1.3');
  });
});
```

#### Container query reflow tests

```typescript
// tests/visual/controller-reflow.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Deliverable C: Controller Container Query Reflow', () => {

  test('single column at narrow width', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 });
    await page.goto('/controller/index.html');
    await page.waitForTimeout(300);

    const columns = await page.evaluate(() => {
      const grid = document.querySelector('.control-sections');
      if (!grid) return 'missing';
      return getComputedStyle(grid).gridTemplateColumns;
    });

    // Should be a single column (one value)
    const colCount = columns.split(/\s+/).length;
    expect(colCount).toBe(1);
  });

  test('two columns at medium width', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await page.goto('/controller/index.html');
    await page.waitForTimeout(300);

    const columns = await page.evaluate(() => {
      const grid = document.querySelector('.control-sections');
      if (!grid) return 'missing';
      return getComputedStyle(grid).gridTemplateColumns;
    });

    const colCount = columns.split(/\s+/).length;
    expect(colCount).toBe(2);
  });

  test('three columns at wide width', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('/controller/index.html');
    await page.waitForTimeout(300);

    const columns = await page.evaluate(() => {
      const grid = document.querySelector('.control-sections');
      if (!grid) return 'missing';
      return getComputedStyle(grid).gridTemplateColumns;
    });

    const colCount = columns.split(/\s+/).length;
    expect(colCount).toBe(3);
  });

  test('full-width sections span all columns at every width', async ({ page }) => {
    for (const width of [480, 700, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/controller/index.html');
      await page.waitForTimeout(300);

      const sceneNavWidth = await page.evaluate(() => {
        const el = document.querySelector('.section--full-width');
        const parent = document.querySelector('.control-sections');
        if (!el || !parent) return { el: 0, parent: 0 };
        return {
          el: el.getBoundingClientRect().width,
          parent: parent.getBoundingClientRect().width,
        };
      });

      // Full-width section should be within 2px of the grid container width
      expect(Math.abs(sceneNavWidth.el - sceneNavWidth.parent)).toBeLessThan(2);
    }
  });

  test('collapsible sections toggle correctly', async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 900 });
    await page.goto('/controller/index.html');
    await page.waitForTimeout(300);

    // Overlay section should be collapsed by default (no [open] attribute)
    const isInitiallyClosed = await page.evaluate(() => {
      const details = document.querySelector('#sec-overlay');
      return details ? !details.hasAttribute('open') : null;
    });
    expect(isInitiallyClosed).toBe(true);

    // Click to open
    await page.click('#sec-overlay summary');
    await page.waitForTimeout(200);

    const isNowOpen = await page.evaluate(() => {
      const details = document.querySelector('#sec-overlay');
      return details ? details.hasAttribute('open') : null;
    });
    expect(isNowOpen).toBe(true);

    // Verify content is visible
    const inputVisible = await page.isVisible('#overlay-input');
    expect(inputVisible).toBe(true);
  });

  test('screenshot comparison at all breakpoints', async ({ page }) => {
    for (const { name, width, height } of [
      { name: 'narrow', width: 480, height: 900 },
      { name: 'medium', width: 700, height: 900 },
      { name: 'wide', width: 1000, height: 800 },
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto('/controller/index.html');
      await page.waitForTimeout(500);
      await expect(page).toHaveScreenshot(`controller-${name}.png`);
    }
  });
});
```

### Accessibility audit

```typescript
// tests/visual/accessibility.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const APPS = [
  { name: 'dm-guide', url: '/index.html' },
  { name: 'controller', url: '/controller/index.html' },
];

for (const app of APPS) {
  test(`${app.name}: no WCAG AA violations`, async ({ page }) => {
    await page.goto(app.url);
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .exclude('#noise-overlay')  // Decorative overlay, not interactive
      .exclude('#vignette-overlay')
      .analyze();

    expect(results.violations).toEqual([]);
  });
}

test('Controller: touch targets meet WCAG 2.5.8 minimum', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 900 });
  await page.goto('/controller/index.html');
  await page.waitForTimeout(300);

  const smallTargets = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button, select, input');
    const violations: string[] = [];
    buttons.forEach(btn => {
      const rect = btn.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) {
        violations.push(
          `${btn.tagName}.${btn.className}: ${rect.width.toFixed(0)}x${rect.height.toFixed(0)}`
        );
      }
    });
    return violations;
  });

  expect(smallTargets).toEqual([]);
});
```

---

## Migration Roadmap Context

### How Phase 2 connects to Phase 3

Phase 3 introduces Utopia fluid type and spacing scales, `@layer` cascade management, and the shared token file. Here is how Phase 2 prepares for each:

**Fluid scales** replace Phase 2's static `--space-*` and `--font-size-*` values with `clamp()` expressions. Because every component already references tokens (not hardcoded values), the migration is a single-file change to the token declarations. No component CSS changes needed.

**Cascade layers** (`@layer reset, tokens, base, layout, components, utilities, overrides`) require all CSS to be organized into layer blocks. Phase 2's token extraction makes this possible by consolidating all custom properties into `:root` blocks that can be wrapped in `@layer tokens { ... }`. Component styles that reference `var()` values are already clean enough to slot into `@layer components { ... }`.

**The shared `tokens.css` file** replaces the duplicated `:root` blocks across the three apps. The Phase 2 token names are designed to be identical across apps so that the Phase 3 extraction is a pure mechanical operation: cut the shared tokens from each app's `:root`, paste into `shared/tokens.css`, and add a `<link>` tag.

### How Phase 2 connects to the React/TypeScript/PixiJS/Zustand migration

The long-term platform migration benefits from Phase 2 in three specific ways:

**Design tokens as a bridge.** The CSS custom property naming convention (`--space-4`, `--font-size-md`, `--color-bg-1`) maps directly to a TypeScript theme type:

```typescript
// Future: theme.ts
interface Theme {
  space: Record<number, string>;
  fontSize: Record<string, string>;
  color: {
    bg: Record<number, string>;
    text: Record<string, string>;
    gold: Record<string, string>;
  };
}
```

Components written against `var(--space-4)` in CSS today will reference `theme.space[4]` in styled-components or a CSS-in-JS solution tomorrow. The mapping is mechanical.

**Container queries as component blueprints.** The Controller's `@container` rules define responsive breakpoints for each section. When those sections become React components, the container query logic translates to responsive props or CSS module rules. A `section--tokens` component that spans two rows at medium width in CSS Grid becomes a React component with a `span` prop or a responsive class.

**The `--ui-scale` mechanism as a theme context preview.** The scale control module stores per-app preferences in localStorage and applies them via CSS custom properties. In the React app, this becomes a Zustand store that provides a `uiScale` value to a ThemeProvider. The behavior is identical; only the plumbing changes.

---

## Risk Assessment and Rollback

### Deliverable A: Token Extraction

**Risk level: Low-Medium.** The extraction is designed to be visually identical. The primary risk is computation rounding: `0.8125rem` at a 14px root computes to `11.375px`, while the original was exactly `11px`. Some browsers round differently (Chrome rounds to nearest pixel, Firefox uses subpixel rendering). The Playwright visual regression tests catch any visible differences.

**Rollback:** Since the original values are documented as comments next to each token (`/* was 13px */`), reverting is straightforward: replace each `var()` reference with its original pixel value. The comments serve as an inline rollback map.

**Execution order within Deliverable A:**

1. Add token declarations to `:root` (additive, no visual change)
2. Replace DM Guide hardcoded values (one file, largest surface area)
3. Run Playwright screenshots and compare
4. Replace Controller hardcoded values
5. Run Playwright screenshots
6. Replace VTT Display hardcoded values (smallest surface area for UI chrome)
7. Full Playwright regression suite

### Deliverable B: UI Scale

**Risk level: Low.** The `--ui-scale` mechanism is opt-in. At the default value of `1`, the `calc(0.875rem * 1)` expression produces the same result as `0.875rem`. The scale control UI is additive DOM. The localStorage persistence is isolated.

**Rollback:** Remove the scale control HTML, remove the `calc()` wrapper from `html { font-size }`, remove the `--ui-scale` custom property. Three small changes.

**Risk factor:** The `calc()` expression introduces a dependency on the browser correctly evaluating `calc(0.875rem * var(--ui-scale))`. This is well-supported (Chrome 49+, Firefox 31+, Safari 9.1+), but if a bug surfaces, the fallback is to remove the `calc()` and provide a fixed `0.875rem` value.

### Deliverable C: Controller Reflow

**Risk level: Medium.** This involves restructuring the Controller's HTML (wrapping sections in a grid container, converting some to `<details>` elements) and replacing the entire layout CSS. The JavaScript that references section elements by ID (`#sec-tokens`, `#sec-effects`, etc.) must still find them after restructuring.

**Rollback:** Keep the original Controller HTML in a backup file. The JavaScript module (`ui-builders.js`) references sections by ID, not by class or structural position, so the HTML restructuring is compatible as long as IDs are preserved.

**Key testing:** After restructuring, run the full QA campaign protocol (QA-CAMPAIGN.md) through the Controller to verify all button clicks, select changes, and dynamic updates still work. The visual layout changes are intentional, so visual regression tests need new baselines at this step.

**Execution order within Deliverable C:**

1. Add the container query CSS alongside existing layout CSS (dual-write period)
2. Restructure HTML with new wrapper elements and classes
3. Convert Overlay and Title Card to `<details>` elements
4. Remove old layout CSS that conflicts with new grid
5. Test at all three breakpoints (narrow, medium, wide)
6. Run QA-CAMPAIGN.md through Controller to verify functionality
7. Capture new visual regression baselines

---

## Execution Summary

| Step | Deliverable | Description | Risk | Estimated Scope |
|------|------------|-------------|------|-----------------|
| 1 | A.1 | Add token declarations to all three `:root` blocks | None | Additive only |
| 2 | A.2 | Replace DM Guide hardcoded values with tokens | Low | ~150 line changes |
| 3 | A.3 | Playwright visual regression: DM Guide | None | Test run |
| 4 | A.4 | Replace Controller hardcoded values with tokens | Low | ~80 line changes |
| 5 | A.5 | Playwright visual regression: Controller | None | Test run |
| 6 | A.6 | Replace VTT Display hardcoded values with tokens | Low | ~60 line changes |
| 7 | A.7 | Full Playwright regression suite | None | Test run |
| 8 | B.1 | Add `--ui-scale` to `:root` and wrap `html font-size` in `calc()` | Low | 3 files, ~6 lines each |
| 9 | B.2 | Add scale control HTML to DM Guide and Controller | Low | Additive DOM |
| 10 | B.3 | Add scale control CSS | Low | ~60 lines |
| 11 | B.4 | Add scale control JavaScript module | Low | ~120 lines |
| 12 | B.5 | Test scale slider at multiple values | None | Test run |
| 13 | C.1 | Add container query CSS alongside existing Controller styles | Low | ~80 lines |
| 14 | C.2 | Restructure Controller HTML | Medium | ~200 line restructure |
| 15 | C.3 | Convert Overlay/Title Card to `<details>` | Low | ~20 lines |
| 16 | C.4 | Remove conflicting old layout CSS | Medium | ~40 lines removed |
| 17 | C.5 | Test reflow at 480/700/1000px widths | None | Test run |
| 18 | C.6 | Full QA campaign through Controller | None | Manual QA |
| 19 | C.7 | Capture new visual regression baselines | None | Test run |
