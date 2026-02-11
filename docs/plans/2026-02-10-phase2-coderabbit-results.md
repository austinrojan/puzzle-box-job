# Phase 2 CodeRabbit Review Results

## Summary

| Category | Count |
|----------|-------|
| **Blocking** | 8 |
| **Advisory (High)** | 1 |
| **Advisory** | 27 |
| **False Positive** | 22+ |

**Reviewed:** 12 files, 16 commits (53a8e6b..8b3b797), 1027 insertions / 455 deletions

---

## Blocking Issues

### B1. Spacing token used for icon width (DM Guide)

**File:** `index.html:317`
```css
.nav-section-header .nav-icon { width: var(--space-5); }
```
Original: `width: 20px`. This is a fixed-width icon container, not spacing. If someone adjusts the spacing scale, this icon width changes unintentionally.
**Fix:** Change to `width: 1.25rem`.

### B2. Spacing token used for close button dimensions (DM Guide)

**File:** `index.html:427-428`
```css
.combat-close { width: var(--space-6); height: var(--space-6); }
```
Original: `width: 24px; height: 24px`. This is a clickable button's hit target (WCAG minimum 24px), not spacing.
**Fix:** Change to `width: 1.5rem; height: 1.5rem`.

### B3. Spacing token used for border-radius (DM Guide)

**File:** `index.html:944`
```css
.brazier-bowl { border-radius: 0 0 var(--space-3) var(--space-3); }
```
Original: `border-radius: 0 0 12px 12px`. Spacing tokens shouldn't control visual shape curvature. No radius token covers 12px (max is `--radius-xl: 8px`).
**Fix:** Change to `border-radius: 0 0 0.75rem 0.75rem`.

### B4. `--initiative-width` converted to rem in px-scaled container (VTT)

**File:** `vtt/css/theme.css:104`
```css
--initiative-width: 18.75rem; /* 300px */
```
The initiative panel is positioned absolute inside the 1920x1080 `#vtt-scale-container` which uses `transform: scale()`. Within a scaled container, `rem` resolves against root font-size, not the scaled coordinate space. If user has non-16px browser default, the panel width will mismatch the map.
**Fix:** Revert to `--initiative-width: 300px`. It sits alongside `--vtt-width: 1920px` and `--vtt-height: 1080px` for good reason.

### B5. `.token-hp` width tokenized to rem in canvas coordinate space (VTT)

**File:** `vtt/css/map.css:54`
```css
.token-hp { width: 2.5rem; }
```
Token HP bars are positioned in px by `token-manager.js` using world-to-screen coordinate transforms. A rem-based width won't scale in proportion with the canvas transform.
**Fix:** Revert to `width: 40px`.

### B6. `.init-portrait` rem inside px-scaled panel (VTT)

**File:** `vtt/css/initiative.css:69-70`
```css
.init-portrait { width: 2.5rem; height: 2.5rem; }
```
Inside the initiative panel (which should be px per B4), mixing rem creates inconsistency. Conditional on B4 resolution.
**Fix:** Revert to `width: 40px; height: 40px`.

### B7. Token drift: `--scrollbar-size` (Controller vs DM Guide)

**File:** `controller/index.html:62` vs `index.html:115`
```
Controller: --scrollbar-size: 0.375rem;  /* 6px */
DM Guide:   --scrollbar-size: 0.5rem;    /* 8px */
```
Token sets are supposed to be identical (Phase 3 will extract to shared file). This drift will cause a silent behavior change during extraction.
**Fix:** Reconcile to one value (8px/0.5rem matches the DM Guide original; 6px/0.375rem matches the Controller original). Pick one and document.

### B8. Token drift: `--transition-*` format + missing `--transition-slow` (Controller)

**File:** `controller/index.html:57-58` vs `index.html:118-120`
```
Controller: --transition-fast: 0.15s ease;   --transition-base: 0.25s ease;
DM Guide:   --transition-fast: 150ms ease;   --transition-base: 250ms ease;  --transition-slow: 400ms ease;
```
Format inconsistency (`0.15s` vs `150ms`) and missing `--transition-slow` violate the "identical token set" contract.
**Fix:** Normalize to `ms` format. Add `--transition-slow: 400ms ease` to Controller.

---

## Advisory Issues (High Priority)

### AH1. Scale control applies `font-size` to `body` instead of `html` (Controller)

**File:** `controller/index.html:75`
```css
body { font-size: calc(0.8125rem * var(--ui-scale)); }
```
DM Guide correctly sets this on `html` (line 126). Since `rem` resolves against `html` font-size (NOT `body`), the Controller's `--ui-scale` multiplier only scales text inherited from body -- spacing, radii, and all other rem-based tokens will NOT scale. The scale control will appear to partially work (text scales) but layout won't scale proportionally.
**Fix:** Move `font-size` from `body` to `html`, matching DM Guide pattern.

---

## Advisory Issues

### DM Guide

| # | Finding | File:Line |
|---|---------|-----------|
| A1 | Presentation frame decorative pseudo-elements still hardcoded (scrollbar 4px, inset -12px, font-size 16px) | `index.html:817-833` |
| A2 | Dominate switch internal dimensions hardcoded (16px knob coupled to var(--space-5) track) | `index.html:1050-1055` |
| A3 | Brazier flame dimensions and keyframe values remain in px (acceptable for visual effects) | `index.html:951-979` |
| A4 | `.heat-gauge` gap: 3px (doesn't snap to 4px grid, deliberate exception) | `index.html:246` |
| A5 | Rounding: `.block-dm-note .block-header` padding 10px/14px -> 12px/16px (+2px each) | `index.html` |
| A6 | Rounding: `.block-vtt-cue` margin 6px -> 8px (+2px) | `index.html` |
| A7 | Rounding: `.block-dm-note .block-body-inner` padding 14px -> 16px (+2px) | `index.html` |
| A8 | `--font-size-heading-hero: 2.625rem` defined but never used | `index.html:103` |
| A9 | `#vtt-controller-btn` ID specificity silently overrides `btn--sm` padding | `index.html:1139-1142` |
| A10 | `#scale-readout` uses ID selector instead of BEM class | `index.html:1236-1239` |
| A11 | Inline `onclick` on VTT Controller button (pre-existing, not Phase 2 scope) | `index.html:1279` |

### VTT CSS

| # | Finding | File:Line |
|---|---------|-----------|
| A12 | `theater.css` entirely untouched -- 13+ tokenizable UI chrome values | `vtt/css/theater.css` (all) |
| A13 | `scene-navigator.css` entirely untouched -- 30+ tokenizable values | `vtt/css/scene-navigator.css` (all) |
| A14 | `tokens.css` entirely untouched -- 12+ tokenizable values | `vtt/css/tokens.css` (all) |
| A15 | `--font-size-loading` vs DM Guide's `--font-size-heading-hero` naming divergence (same 42px value) | `vtt/css/theme.css:93` |
| A16 | VTT missing `--space-12` and `--space-16` tokens that DM Guide defines | `vtt/css/theme.css:74-82` |
| A17 | CSS-drawn icon geometry left in px (correct, but add `/* decorative */` comment) | `vtt/css/player-nav.css:224-258` |
| A18 | `.pnav-chevron font-size: 1.375rem` (22px) is orphan in type scale | `vtt/css/player-nav.css:52` |

### Controller

| # | Finding | File:Line |
|---|---------|-----------|
| A19 | Missing `::marker` rule for Firefox summary suppression (Chromium-only app) | `controller/index.html:487-492` |
| A20 | `grid-row: auto` on `.section--mode` is a no-op | `controller/index.html:435-437` |
| A21 | `section--tokens span 2` may cause visual gaps depending on content height | `controller/index.html:441-444` |
| A22 | Controller missing `--space-12`, `--space-16`, `--font-size-xl/2xl/heading-hero` tokens | `controller/index.html` |

### scale-control.js

| # | Finding | File:Line |
|---|---------|-----------|
| A23 | Missing `aria-expanded`, `aria-controls`, `role` on popover toggle | `shared/scale-control.js:96-106` |
| A24 | Escape handler missing `e.stopPropagation()` for future-proofing | `shared/scale-control.js:116-121` |
| A25 | `STEP` constant declared but never used (HTML hardcodes `step="0.05"`) | `shared/scale-control.js:16` |
| A26 | `MIN_SCALE`/`MAX_SCALE`/`STEP` duplicated between JS and HTML | `shared/scale-control.js:14-16` |
| A27 | No focus management when popover opens | `shared/scale-control.js:96-121` |

### JS Templates

| # | Finding | File |
|---|---------|------|
| A28 | ~40 component classes use single-hyphen elements (future BEM pass candidate) | `dm-guide/js/combat.js`, `dm-guide/js/renderers.js` |
| A29 | State classes (`active`, `inactive`, `extinguished`, etc.) are bare words, not BEM modifiers | `dm-guide/js/combat.js` |

---

## Cross-Cutting Findings

### 1. Token Parity

| Token | DM Guide | Controller | VTT | Status |
|-------|----------|------------|-----|--------|
| `--space-1` through `--space-10` | Yes | Yes (subset) | Yes (subset) | **OK** (values match where present) |
| `--space-12`, `--space-16` | Yes | Missing | Missing | Advisory (A16, A22) |
| `--scrollbar-size` | `0.5rem` (8px) | `0.375rem` (6px) | N/A | **BLOCKING** (B7) |
| `--transition-fast` | `150ms ease` | `0.15s ease` | `150ms ease` | **BLOCKING** (B8, format drift) |
| `--transition-slow` | Yes | Missing | N/A | **BLOCKING** (B8) |
| `--font-size-heading-hero` | `2.625rem` | Missing | N/A (uses `--font-size-loading`) | Advisory (A15) |

### 2. BEM Consistency

Zero remaining single-hyphen `btn-sm`, `btn-danger`, or `btn-gold` references in the entire project. Clean.

`input-sm` is intentionally single-hyphen -- separate CSS rule exists at `index.html:1151`.

### 3. Scale Control Integration

- Both apps have all required HTML element IDs: `scale-toggle`, `scale-popover`, `scale-slider`, `scale-readout`, `scale-value`, `scale-reset`
- Both apps import `shared/scale-control.js` with correct relative paths
- `--ui-scale` declared in both `:root` blocks
- **Issue:** Controller applies scaled `font-size` on `body`, DM Guide on `html` (AH1)

### 4. Spacing Token Misuse

Three confirmed violations in DM Guide (B1, B2, B3). Three rem-in-canvas-space violations in VTT (B4, B5, B6). All other spacing token usage is correct.

### 5. Border Pixel Preservation

All `border-width`, `box-shadow` offsets, `letter-spacing`, and thin decorative lines correctly remain in `px` across all three apps. Clean.

---

## False Positives (Documented)

| Item | Rationale |
|------|-----------|
| Grid column `0px` values | Intentional zero-width collapsed columns |
| Border widths (1px, 2px, 3px, 4px) | Per spec: borders stay in px |
| `box-shadow` / `text-shadow` px values | Visual effects, px is standard |
| `letter-spacing: 0.5px`, `1px` | Sub-pixel typographic concern |
| Keyframe animation px values | Visual effects where precision matters |
| `#nav-resize` dimensions | Drag handle with tight pixel positioning |
| Noise overlay `background-size: 256px` | Texture tile size, fixed |
| Sub-4px decorative values (2px, 3px margins) | Below grid threshold, rounding would look wrong |
| Canvas dimensions (1920px, 1080px) | Must stay px per spec |
| `.dm-controls__key` raw rem for height | Correct pattern: sizing != spacing |
| `screenShake` keyframe values | Canvas coordinate space animation |
| `localStorage` XSS surface | `parseFloat()` + range validation = safe |
| Outside-click dismiss logic | Correct after commit 11203b2 fix |
| Cross-tab sync validation | `parseFloat()` + `isNaN()` + range checks = sufficient |
| Container query naming (`controller`) | Matches `@container controller` queries |
| Section IDs preserved after HTML restructure | All JS-referenced IDs present |
| `<details>` conversion doesn't break JS | `querySelector('#...')` unaffected by wrapper element type |
| CSS specificity: `.control-sections > .section` | Child combinator correctly overrides base `.section` |
| Scale control import paths | Both resolve correctly |
| Scale control HTML IDs | All 6 IDs present in both apps |
| `input-sm` kept as single-hyphen | Separate CSS rule exists, different pattern from `btn--*` |
| CSS-drawn icons in player-nav | Decorative pixel art, px is correct |

---

## Recommended Fix Priority

### Must fix before Phase 3

1. **B4-B6:** Revert VTT `--initiative-width`, `.token-hp`, `.init-portrait` to px (canvas-space)
2. **AH1:** Move Controller `font-size` from `body` to `html` (scale control broken)
3. **B7-B8:** Reconcile `--scrollbar-size` drift and `--transition-*` format/subset

### Should fix (low risk to defer)

4. **B1-B3:** Replace DM Guide spacing token misuse with raw rem (nav-icon, combat-close, brazier-bowl)

### Phase 3 candidates (no action now)

5. A12-A14: Tokenize `theater.css`, `scene-navigator.css`, `tokens.css`
6. A15-A16, A22: Reconcile token subset differences across apps
7. A23-A27: scale-control.js ARIA + DRY improvements
8. A28-A29: Full BEM element/state pass on combat + renderer templates
