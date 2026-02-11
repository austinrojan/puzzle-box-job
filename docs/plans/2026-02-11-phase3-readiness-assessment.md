# Phase 3 Readiness Assessment

## Phase 1: PASS (all 5 deliverables)
- viewport-scaler.js: Math.min formula, viewport:scaled event, getViewportScale()
- Layout: #vtt-viewport (flex center) + #vtt-scale-container (1920x1080 absolute)
- Canvas: integer px set via JS (VTT_W/VTT_H constants)
- Camera: subscribes to viewport:scaled + imperative init call
- Typography: max-width 65ch prose, 80ch tables, 40rem welcome

## Phase 2: PASS (all 8 deliverables, after fixes)
- Tokens: three-tier system (primitive, semantic, component)
- UI scaling: --ui-scale on html element in both DM Guide and Controller
- Scale control: full UI in both apps (shared/scale-control.js)
- Container queries: Controller 500px/800px breakpoints
- BEM: all btn--* modifiers use double-hyphen; .input-sm kept single-hyphen (deliberate prior decision)
- Token parity: aligned (5 drift values fixed)
- CodeRabbit: all 9 blocking fixes applied

## VTT CSS Audit (theater.css, scene-navigator.css, tokens.css)
- Colors, font families, z-indices: fully tokenized (use var() references)
- Transition durations: 3 inline values tokenized (--transition-cinematic, --transition-fast)
  - 2 title-card transitions remain hardcoded (800ms ease with staggered delays)
- Hardcoded px values remaining: ~25 in theater.css, ~40 in scene-navigator.css, ~20 in tokens.css
  - ALL are canvas-space dimensions (font-size, padding, width, etc.) in a fixed 1920x1080 VTT
  - These MUST stay as px — CSS transform scaling handles display adaptation
  - Not blocking for Phase 3 (shared tokens extraction targets color/spacing/radii/transitions)
- rgba() alpha variants: ~8 across all 3 files (decorative shadows/overlays, not semantic colors)

## !important Inventory (3 declarations, all VTT)
- layout.css: display:none !important (presentation mode) -> @layer overrides
- player-nav.css: pointer-events:none !important x2 (title hiding) -> @layer components

## WCAG Zoom Testing Results
- **DM Guide** (--ui-scale: 2.0): scrollWidth 1440 = innerWidth 1440, no horizontal overflow. Font scales to 28px (2x 14px base). **PASS**
- **Controller** (--ui-scale: 2.0): scrollWidth 1440 = innerWidth 1440, no horizontal overflow. Font scales to 26px (2x 13px base). **PASS**
- **VTT**: viewport-scaler applies transform: scale(0.601) dynamically. Fixed 1920x1080 canvas adapts to any viewport. **PASS**
- **Note**: True browser-zoom (Cmd+=) testing is a manual step the DM should perform before go-live.

## --ui-scale Migration Strategy for Phase 3
- Current: html { font-size: calc(Xrem * var(--ui-scale)); }
- Phase 3: Remove html font-size. Apply --ui-scale at semantic tier:
  --font-size-body: calc(var(--step-0) * var(--ui-scale, 1));
- Risk: components using raw rem stop scaling; audit needed

## Known Acceptable Differences
- Controller --red (#E74C3C) intentionally brighter than DM Guide/VTT (#C0392B)
- DM Guide base: 14px (0.875rem), Controller base: 13px (0.8125rem)
- App-specific tokens: --nav-width, --vtt-width, --token-dot-size, etc.

## Phase 3 Implementation Status

| Deliverable | Status | Commit |
|-------------|--------|--------|
| Shared tokens extraction (`shared/tokens.css`, 62 tokens) | DONE | `1bf7ed2` |
| @layer introduction (7-layer cascade across all 3 apps) | DONE | `22c8164` |
| !important removal (3 declarations → @layer overrides) | DONE | `22c8164` |
| Playwright tests (45 tests: visual, tokens, layers, a11y, container queries) | DONE | `2f821b1` |
| Fluid typography — DM Guide (14px@1024 → 16px@1920) | DONE | `49ad0b7` |
| Fluid typography — Controller (13px@1024 → 15px@1920) | DONE | `49ad0b7` |
| px-to-rem migration (DM Guide: 4 conversions, Controller: 0 needed) | DONE | `48dbcf8` |

### Not in Phase 3 scope (future enhancements)
- Enhanced Utopia type scale: per-step clamp() tokens for amplified heading scaling
- Utopia fluid spacing: one-up pairs (--space-s-l) for dramatic whitespace scaling
- CUBE CSS methodology: reclassify into Composition/Utility/Block/Exception
- rgba() tokenization: use color-mix(in srgb, ...) for alpha variants
- DM Guide z-index tokenization
- --ui-scale redesign: multiply individual semantic tokens instead of root font-size
- Shared reset.css / base.css extraction

### Pre-existing accessibility issues (documented, not Phase 3 regressions)
- color-contrast: --text-muted (#6b6b78) on dark backgrounds = 3.38:1 (below 4.5:1 AA)
- select-name: Controller <select> elements without accessible labels
- scrollable-region-focusable: DM Guide scrollable panels

### Test infrastructure notes
- Snapshot baselines tagged `darwin` (macOS-generated) — regeneration needed for Linux CI
- Visual regression threshold: maxDiffPixelRatio 0.02 (accommodates sub-pixel font rendering)
- Accessibility tests exclude 3 pre-existing violations (see above)

## Risks
- Theater title-card uses ease vs --transition-scene ease-in-out (documented)
- rgba() colors in VTT are hardcoded alpha variants (acceptable)
- min-width: var(--space-8) on Controller .btn--icon is a gray-area spacing-as-dimension usage (not changed, low risk)
- Presentation diamond offset (--space-5) now scales with fluid root: 17.5px@1024 vs 20px@1920 (decorative, no visual impact)
