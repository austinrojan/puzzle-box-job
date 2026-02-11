# Phase 2 CodeRabbit Review Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run a comprehensive CodeRabbit AI review of all Phase 2 work (16 commits, 12 files, 1027 insertions / 455 deletions) to catch bugs, style issues, and architectural concerns before moving to Phase 3.

**Architecture:** Phase 2 spans three apps (DM Guide, VTT, Controller) with changes across CSS token extraction, a new `--ui-scale` JS module, BEM class standardization, and container query grid reflow. The review needs to evaluate each deliverable against its spec and cross-check consistency between the three duplicated token sets.

**Tech Stack:** HTML/CSS/vanilla JS (no build step), BroadcastChannel for IPC, CSS container queries, CSS custom properties.

---

## Background

### Phase 2 Deliverables (from spec)

| Deliverable | Description | Commits | Files |
|-------------|-------------|---------|-------|
| **A: Token Extraction** | Extract all hardcoded px values into CSS custom properties across all 3 apps | 53a8e6b → 4982cbe (7 commits) | index.html, controller/index.html, vtt/css/*.css |
| **B: Per-Window --ui-scale** | Add calc()-based root font scaling + scale control slider UI | b739b68 → 4f435df (2 commits) | index.html, controller/index.html, shared/scale-control.js |
| **C: Container Query Grid** | Reflow Controller from single-column to responsive grid with collapsible sections | 1d553d6 → e17f587 (2 commits) | controller/index.html |
| **Fixes & Cleanup** | Bug fixes, BEM standardization, dead code removal | bb6966f → 8b3b797 (5 commits) | All 12 files |

### Commit Range

```
53a8e6b feat(dm-guide): add CSS custom properties token system
4846a99 refactor(dm-guide): convert app chrome to CSS custom properties
c1b8577 refactor(dm-guide): convert content blocks to CSS custom properties
8536e95 fix(dm-guide): correct token misuse and mixed-unit padding
dbe63c0 refactor(dm-guide): convert overlays and modals to CSS custom properties
83de6e3 refactor(controller): convert all CSS to custom properties
76b1e2d refactor(vtt): add tokens and convert layout.css
4982cbe fix(controller): use component token for indicator dot, add inline style TODOs
ab21835 refactor(vtt): convert all UI chrome CSS to custom properties
b739b68 feat(phase2): add --ui-scale mechanism and scale-control.js module
4f435df feat(phase2): add scale control UI to DM Guide and Controller
1d553d6 feat(controller): add container query grid CSS
e17f587 refactor(controller): restructure HTML for container query grid
bb6966f fix(phase2): add missing transition tokens, fix BEM class, add null guard
11203b2 fix(phase2): revert DM Guide BEM class, fix outside-click dismiss, add details animation TODO
8b3b797 style(phase2): code-simplifier cleanup pass
```

### Files Changed (12 total)

| File | Lines Changed | Deliverables |
|------|--------------|--------------|
| `index.html` | +358 / -242 | A, B, cleanup |
| `controller/index.html` | +313 / -127 | A, B, C |
| `shared/scale-control.js` | +155 / -0 | B (new file) |
| `vtt/css/player-nav.css` | +41 / -41 | A |
| `vtt/css/controls.css` | +26 / -26 | A, cleanup |
| `vtt/css/initiative.css` | +19 / -19 | A |
| `vtt/css/theme.css` | +20 / -9 | A |
| `vtt/css/layout.css` | +14 / -14 | A |
| `dm-guide/js/combat.js` | +13 / -13 | cleanup |
| `vtt/css/effects.css` | +8 / -8 | A |
| `vtt/css/map.css` | +7 / -7 | A |
| `dm-guide/js/renderers.js` | +1 / -1 | cleanup |

---

## Tasks

### Task 1: Generate the diff for CodeRabbit

**Files:** None modified (read-only)

**Step 1: Create the full Phase 2 diff file**

Run:
```bash
git diff 53a8e6b^..HEAD > /tmp/phase2-full-diff.txt
```

This captures the complete diff from the commit before Phase 2 started to the current HEAD. CodeRabbit needs this to understand the full scope of changes.

**Step 2: Verify the diff covers all 12 files**

Run:
```bash
git diff --stat 53a8e6b^..HEAD
```

Expected: 12 files listed, matching the table above.

---

### Task 2: Run CodeRabbit review on DM Guide token extraction + scale control

**Files reviewed:**
- `index.html` (CSS token extraction, BEM renames, scale control HTML/CSS, inline style removal)

**Step 1: Invoke CodeRabbit**

Use the `/coderabbit` skill targeting the DM Guide changes. Provide this context prompt:

> Review the Phase 2 changes to `index.html`. This file contains the DM Guide — a single-file HTML app with all CSS inlined in `<style>` tags and all JS inline.
>
> **What changed:**
> 1. **Deliverable A (Token Extraction):** ~200 hardcoded px values converted to CSS custom properties (`var(--space-*)`, `var(--font-size-*)`, etc.). The `:root` block was expanded with spacing, typography, layout, and component tokens. All conversions follow these rules:
>    - Font sizes use exact token mappings (e.g., 13px → `var(--font-size-md)`)
>    - Spacing values round to 4px grid (e.g., 6px → `var(--space-2)` which is 8px, 14px → `var(--space-3)` which is 12px)
>    - Borders stay in px (1px, 2px, 3px)
>    - Canvas/fixed-layout dimensions stay in px
>    - `html { font-size }` changed from `14px` to `calc(0.875rem * var(--ui-scale))` for WCAG compliance
>
> 2. **Deliverable B (Scale Control):** Added scale control HTML widget in the heat bar area (gear icon + popover with slider), plus CSS for `.scale-control__*` BEM components. The `#vtt-controller-btn` had inline styles extracted to a CSS rule.
>
> 3. **BEM Cleanup:** `.btn-gold` → `.btn--gold`, `.btn-danger` → `.btn--danger`, `.btn-sm` → `.btn--sm` across CSS definitions and HTML class attributes.
>
> **Review focus:**
> - Token consistency: Are any hardcoded px values missed that should be tokens?
> - Token correctness: Are spacing tokens used for spacing (not sizing) and font tokens for fonts (not arbitrary values)?
> - BEM naming: Are all modifier classes consistently double-hyphen?
> - Scale control: Does the CSS correctly inherit from `.btn` base class?
> - Specificity: Any unintended specificity conflicts from the new `#vtt-controller-btn` ID selector?
> - Rounding: Any conversions that visually change the UI beyond the 4px grid rounding tolerance?

**Step 2: Record findings**

Save CodeRabbit output. Categorize issues as:
- **Blocking:** Functional bugs, broken selectors, specificity conflicts
- **Advisory:** Style suggestions, alternative token choices, naming preferences
- **False positive:** Issues that are intentional per the spec

---

### Task 3: Run CodeRabbit review on VTT CSS token extraction

**Files reviewed:**
- `vtt/css/theme.css` (new tokens added to `:root`)
- `vtt/css/controls.css` (DM controls panel tokenized)
- `vtt/css/effects.css` (spell effect overlays tokenized)
- `vtt/css/initiative.css` (initiative tracker tokenized)
- `vtt/css/layout.css` (loading screen tokenized)
- `vtt/css/map.css` (token labels + grid info tokenized)
- `vtt/css/player-nav.css` (player navigation bar tokenized)

**Step 1: Invoke CodeRabbit**

Use the `/coderabbit` skill targeting the VTT CSS files. Provide this context prompt:

> Review the Phase 2 Deliverable A changes to the VTT display CSS files (7 files in `vtt/css/`).
>
> **Architecture context:** The VTT is a 1920x1080 fixed-size canvas app designed for Discord screenshare. It uses ES modules, no build step, 5 stacked `<canvas>` layers plus HTML overlays. The `:root` tokens in `theme.css` are the single source of truth for this app.
>
> **What changed:**
> - `theme.css`: Added spacing tokens (`--space-1` through `--space-10`), typography tokens (`--font-size-2xs` through `--font-size-loading`), converted `--initiative-width` from 300px to 18.75rem
> - All other CSS files: Replaced hardcoded px values with token references
>
> **Critical constraint:** Canvas-related dimensions (1920px, 1080px, grid cell sizes, token positions) MUST stay in px. Only UI chrome (overlays, panels, labels, navigation) should use tokens.
>
> **Review focus:**
> - Are any canvas-space dimensions accidentally tokenized?
> - Token consistency with DM Guide: Do the same token names (`--space-4`, `--font-size-md`) map to the same values? (They should — Phase 3 will extract to shared file)
> - Are borders correctly left in px?
> - `.dm-controls__key height: 1.25rem` — this was intentionally hardcoded (not `var(--space-5)`) because spacing tokens shouldn't be used for element sizing. Is this pattern applied consistently?
> - Any px values that were missed and should have been converted?

**Step 2: Record findings**

Same categorization as Task 2.

---

### Task 4: Run CodeRabbit review on Controller (tokens + grid + collapsible sections)

**Files reviewed:**
- `controller/index.html` (token extraction, container query grid, HTML restructure, collapsible `<details>` sections, scale control)

**Step 1: Invoke CodeRabbit**

Use the `/coderabbit` skill targeting the Controller changes. Provide this context prompt:

> Review the Phase 2 changes to `controller/index.html`. This is a standalone single-file HTML app (zero dependencies) that serves as a remote control dashboard for the VTT via BroadcastChannel.
>
> **What changed (3 deliverables in 1 file):**
>
> 1. **Deliverable A (Token Extraction):** All hardcoded px values converted to CSS custom properties. Duplicated token set in `:root` (intentional — Phase 3 extracts to shared file). Controller uses `0.8125rem` base (13px) vs DM Guide's `0.875rem` (14px).
>
> 2. **Deliverable B (Scale Control):** Scale control widget added to header. `html { font-size: calc(0.8125rem * var(--ui-scale)); }`. Imports `../shared/scale-control.js` via ES module.
>
> 3. **Deliverable C (Container Query Grid):**
>    - Added `.controller-body` wrapper with `container-type: inline-size`
>    - Added `.control-sections` CSS Grid container
>    - Three breakpoints: single-column (<500px), two-column (500-799px), three-column (800px+)
>    - Overlay and Title Card sections converted from `<div>` to `<details>/<summary>` for native collapsibility
>    - Grid sections get semantic modifier classes: `section--full-width`, `section--mode`, `section--tokens`, etc.
>    - Dead `<details>` animation CSS was removed (grid-template-rows trick doesn't work without JS helper)
>
> **Review focus:**
> - Container query correctness: Do `@container controller (min-width: ...)` rules reference the correct container name?
> - Grid layout: Do `grid-column` and `grid-row: span` assignments produce the intended 2-col and 3-col layouts?
> - `<details>/<summary>` accessibility: Is the summary marker properly hidden and replaced with custom chevron?
> - Token duplication: Are token values identical to DM Guide's? (Any drift is a bug)
> - CSS specificity: Does `.control-sections > .section` padding override the base `.section` rule correctly?
> - HTML structure: Are all section IDs preserved (JS references by ID)?
> - Scale control: Does it import the shared module path correctly?

**Step 2: Record findings**

Same categorization as Tasks 2-3.

---

### Task 5: Run CodeRabbit review on shared/scale-control.js

**Files reviewed:**
- `shared/scale-control.js` (new file, 155 lines)

**Step 1: Invoke CodeRabbit**

Use the `/coderabbit` skill targeting the scale control module. Provide this context prompt:

> Review `shared/scale-control.js` — a new ES module (155 lines) that manages per-window UI scaling via CSS custom property `--ui-scale`.
>
> **How it works:**
> - `initScaleControl()` is the only export — called after DOM ready
> - Reads scale from localStorage (keyed by pathname to differentiate apps)
> - Applies scale via `document.documentElement.style.setProperty('--ui-scale', value)`
> - Slider UI: live preview on `input`, persist on `change`
> - Popover: toggle on click, dismiss on outside-click or Escape
> - Cross-tab sync: listens for `storage` events to sync scale across same-app tabs
> - Range: 0.75–1.5, step 0.05, default 1.0
>
> **Integration points:**
> - DM Guide (`index.html`): `<script>` tag imports and calls `initScaleControl()` inline
> - Controller (`controller/index.html`): `<script type="module">` imports from `../shared/scale-control.js`
> - VTT: Does NOT use this module (has its own transform-based scaling)
>
> **Review focus:**
> - Error handling: Is the localStorage try/catch sufficient? Edge cases?
> - Memory leaks: Are event listeners properly scoped? (No cleanup needed — this is a singleton that lives for the page lifetime)
> - Security: Any XSS vectors from localStorage values being applied to DOM?
> - Accessibility: Does the popover handle focus management and keyboard navigation?
> - Outside-click dismiss: The event listener uses `!popover.contains(e.target) && !toggle.contains(e.target)` (fixed in commit 11203b2). Verify this correctly handles clicks on toggle's child spans.
> - Cross-tab sync: Is the `storage` event handler robust against malformed values?

**Step 2: Record findings**

Same categorization as previous tasks.

---

### Task 6: Run CodeRabbit review on JS template string changes

**Files reviewed:**
- `dm-guide/js/combat.js` (BEM class renames in HTML template literals)
- `dm-guide/js/renderers.js` (BEM class rename in HTML template literal)

**Step 1: Invoke CodeRabbit**

Use the `/coderabbit` skill targeting the JS files. Provide this context prompt:

> Review the BEM standardization changes in the DM Guide's JavaScript modules.
>
> **What changed:**
> - `combat.js`: 16 occurrences of `btn-sm` → `btn--sm`, 2 of `btn-danger` → `btn--danger`, 1 of `btn-gold` → `btn--gold` in HTML template literal strings
> - `renderers.js`: 1 occurrence of `btn-danger` → `btn--danger` in the `renderWelcome()` function
>
> **Context:** These files generate HTML via template literals that get injected with `innerHTML`. The class names must match the CSS definitions in `index.html` which were also renamed in this Phase.
>
> **Review focus:**
> - Are there any remaining single-hyphen `btn-*` references that were missed?
> - Do the renamed classes match the CSS definitions exactly?
> - `input-sm` class in combat.js — this was NOT renamed. Is there a corresponding `.input-sm` CSS rule? (There is — it's a separate pattern from `btn--sm`)
> - Any other class names in these template literals that should follow BEM conventions but don't?

**Step 2: Record findings**

Same categorization.

---

### Task 7: Cross-deliverable consistency check

**Files:** All 12 (read-only analysis)

**Step 1: Invoke CodeRabbit with cross-cutting concerns**

Use the `/coderabbit` skill with a holistic review prompt:

> Perform a cross-cutting review of the entire Phase 2 changeset (all 12 files, 16 commits). Focus on inter-file consistency rather than per-file correctness.
>
> **Cross-cutting concerns:**
>
> 1. **Token parity:** The same token names appear in 3 separate `:root` blocks (DM Guide, VTT, Controller). Verify the VALUES are identical across all three. Any value drift is a bug. Specifically check:
>    - `--space-1` through `--space-16`
>    - `--font-size-2xs` through `--font-size-2xl`
>    - Any tokens that exist in one app but not another (expected: VTT has `--font-size-loading`, Controller has `--control-radius` and `--scrollbar-size`)
>
> 2. **BEM consistency:** The DM Guide uses `btn--gold`, `btn--danger`, `btn--sm`. The Controller uses `btn--sm`, `btn--icon`, `btn--active`, `btn--danger`. Are there any single-hyphen modifier classes remaining anywhere in the project?
>
> 3. **Scale control integration:** Both DM Guide and Controller import `shared/scale-control.js`. Verify:
>    - The HTML element IDs referenced by the module (`scale-toggle`, `scale-popover`, `scale-slider`, `scale-readout`, `scale-value`, `scale-reset`) exist in both apps
>    - The CSS class names match between the two apps
>    - The `--ui-scale` custom property is declared in both `:root` blocks
>
> 4. **Spacing token misuse:** Confirm that no `height: var(--space-*)` or `width: var(--space-*)` patterns remain outside of known exceptions. All prior violations (heat gauge, token dots, `.dm-controls__key`) were already fixed. Known acceptable uses: `.combat-close` uses `var(--space-6)` for width/height (24px button — spacing-adjacent). Expected outcome is a clean bill of health.
>
> 5. **Border pixel preservation:** All `border-width`, `box-shadow` offsets, and thin decorative lines should remain in `px`, not tokens. Verify no accidental token conversion of borders.

**Step 2: Compile consolidated findings**

Merge all findings from Tasks 2-7 into a single categorized list:
- **Blocking issues** (must fix before Phase 3)
- **Advisory issues** (should fix, but not blocking)
- **False positives** (intentional per spec, document why)

---

### Task 8: Document review results

**Files:**
- Create: `docs/plans/2026-02-10-phase2-coderabbit-results.md`

**Step 1: Write the review results document**

Structure:
```markdown
# Phase 2 CodeRabbit Review Results

## Summary
- Total issues found: X
- Blocking: X
- Advisory: X
- False positives: X

## Blocking Issues
[Each with file, line, description, and suggested fix]

## Advisory Issues
[Each with file, line, description]

## False Positives (Documented)
[Each with explanation of why it's intentional]

## Cross-Cutting Findings
[Token parity, BEM consistency, etc.]
```

**Step 2: If blocking issues found, create fix tasks**

For each blocking issue, note the exact file and line to fix. These become the input for a follow-up execution plan.

---

## Execution Notes

- **Tasks 2-6 can run in parallel** — they review independent file groups with no dependencies
- **Task 7 depends on Tasks 2-6** — it synthesizes cross-cutting findings
- **Task 8 depends on Task 7** — it compiles the final report
- The `/coderabbit` skill accepts a diff or file list — provide the specific files for each task, not the entire project
- CodeRabbit may flag the duplicated token declarations as DRY violations — this is expected and documented as intentional (Phase 3 will extract to shared file)
- CodeRabbit may flag the `innerHTML` usage in combat.js/renderers.js — this is pre-existing, not introduced by Phase 2, and is out of scope for this review
