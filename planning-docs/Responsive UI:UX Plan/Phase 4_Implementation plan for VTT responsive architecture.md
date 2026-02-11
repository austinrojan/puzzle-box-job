# Phase 4 implementation plan for VTT responsive architecture

**The five Phase 4 deliverables — sidebar collapse, combat drawer, density toggle, window management, and touch targets — share a common architectural spine: CSS custom properties gated by `data-*` attributes, `max()` floor clamping for accessibility, and progressive enhancement through feature detection.** Each deliverable can be implemented independently, but they interact through the token hierarchy. The density toggle and touch-target system form a tightly coupled pair that must be designed together, while the Window Management API stands alone as an optional enhancement for Chromium users. This report provides concrete CSS patterns, JavaScript architecture, accessibility requirements, and integration guidance for each deliverable.

## Three-state sidebar via animated grid tracks

The DM Guide sidebar should transition through three discrete states — **expanded (280px), icon-bar (56px), and hidden (off-screen overlay)** — driven by a `data-sidebar` attribute on the parent grid container. The critical technical finding: **`grid-template-columns` is now animatable in all major browsers** (Chrome 107+, Firefox 66+, Safari 16.1+), making it the preferred approach over animating `width` directly, which triggers expensive layout reflows every frame.

The pattern uses a CSS custom property `--sidebar-w` that switches between values per state, with the grid container transitioning `grid-template-columns` over 280ms. A crucial implementation detail: when collapsing to the hidden state, the column must be set to `0px` or `0fr` rather than removing the track entirely — CSS transitions require interpolating between matching track lists, so changing the number of columns kills the animation. The sidebar element itself needs `overflow: hidden` and `min-width: 0` to allow its grid track to shrink to zero.

```css
.app-layout {
  display: grid;
  grid-template-columns: [sidebar] var(--sidebar-w, clamp(240px, 12rem + 5vw, 320px)) [content] 1fr;
  transition: grid-template-columns 280ms ease-in-out;
}
.app-layout[data-sidebar="collapsed"] { --sidebar-w: 3.5rem; }
.app-layout[data-sidebar="hidden"]    { --sidebar-w: 0px; }
```

Text labels should fade independently using **bidirectional `transition-delay`**: labels fade out immediately (0ms delay) before the width shrinks, then fade in after a 200ms delay when the width expands. This works because CSS re-evaluates transition properties when classes or data attributes change, so each direction can have different timing. On mobile (below 768px), the hidden state should switch the sidebar to `position: fixed` with `transform: translateX(-100%)` — this runs on the GPU compositor with zero layout cost, unlike the grid animation approach.

VS Code's architecture is instructive but architecturally different: its Activity Bar is a **separate persistent element** (48px icon strip), not a collapsed state of the sidebar itself. The shadcn/ui Sidebar component is the closest open-source reference, implementing exactly three states via a `collapsible` prop (`"offcanvas" | "icon" | "none"`). Discord is an anti-pattern here — it has no sidebar collapse at all, which is their users' most-requested feature. Slack offers a two-state collapse with `Cmd+Shift+D`, plus drag-to-resize.

For **accessibility**, the sidebar toggle button needs `aria-expanded` (true/false), `aria-controls` pointing to the sidebar's `id`, and a dynamic `aria-label` that changes per state ("Collapse sidebar" → "Expand sidebar" → "Open sidebar"). In icon-bar mode, each nav icon needs `aria-label` or `title` since text labels are hidden with `opacity: 0`. The standard keyboard shortcut is **`Ctrl+B`** (matching VS Code and shadcn/ui). The mobile overlay state requires focus trapping and `Escape` to close. All animations must be gated behind `prefers-reduced-motion: no-preference`.

**localStorage persistence** should use a path-keyed storage pattern (`dmguide:sidebar:/encounters`) with a **blocking inline script in `<head>`** that reads the saved state and sets `data-sidebar` on `<html>` before first paint, preventing a flash of wrong layout. Always wrap localStorage access in try/catch for private browsing mode, and use the `storage` event for cross-tab sync.

## Combat panel as a responsive inline-to-overlay drawer

The combat panel occupies the third column of the DM Guide's CSS Grid at wide viewports and converts to a `position: fixed` slide-over drawer below **1200px**. This inline-to-overlay transition is fundamentally a page-level layout decision, so **`@media` queries are correct** — not container queries. In a multi-window VTT, each browser window is its own viewport, so media queries respond independently per window. Container queries should be reserved for component-level responsiveness *within* the panel (e.g., reflowing stat blocks based on the panel's own width).

The `@media` breakpoint switches `grid-template-columns` from three tracks to two, and the combat panel gains `position: fixed; transform: translateX(100%)`. The slide animation uses `transform: translateX()` exclusively — it runs entirely on the GPU compositor thread, skipping Layout and Paint phases. This is dramatically faster than animating `right`, `left`, or `width`, which trigger full layout recalculations. Apply `will-change: transform` permanently on the panel since it may be opened at any time, and use `cubic-bezier(0.4, 0, 0.2, 1)` (Material Design's standard easing) for natural motion.

```css
@media (max-width: 1199px) {
  .app-layout { grid-template-columns: var(--nav-w, 240px) 1fr; }
  .combat-panel {
    position: fixed; top: 0; right: 0;
    width: min(320px, 85vw); height: 100dvh;
    transform: translateX(100%);
    transition: transform 300ms cubic-bezier(0.4, 0, 0.2, 1);
    z-index: var(--z-drawer, 500);
  }
  .combat-panel.is-open { transform: translateX(0); }
}
```

The **backdrop scrim** should be a sibling `<div>` with `position: fixed; inset: 0`, using `opacity` and `pointer-events: none/auto` toggling. Material Design 3 specifies `rgba(0, 0, 0, 0.32)` for the scrim — transparent enough to let the DM see the VTT map underneath. Close-on-backdrop-click is cleanest as a simple click handler on the backdrop element itself, rather than a document-level listener that could interfere with Canvas events.

For **z-index management**, establish a token-based layer system using CSS custom properties: `--z-content: 1`, `--z-dropdown: 100`, `--z-drawer-backdrop: 400`, `--z-drawer: 500`, `--z-modal: 700`, `--z-tooltip: 900`. Use `isolation: isolate` on major layout sections to create stacking context boundaries that prevent z-index leakage between the Canvas controls and the drawer system.

**Accessibility** in overlay mode requires the `role="dialog"` and `aria-modal="true"` attributes, which must be removed when the panel returns to inline mode. The modern best practice for background inertness is the **`inert` attribute** — setting `inert` on the main content area handles focus trapping, screen reader hiding, pointer event blocking, and text selection blocking in a single attribute, replacing the old manual approach of setting `aria-hidden` on every sibling. Focus must move to the drawer's first focusable element on open and return to the trigger button on close. `Escape` must close the drawer. An alternative worth considering: using the native `<dialog>` element with `showModal()` for the overlay mode, which provides focus trapping, Escape-to-close, and `::backdrop` for free.

## Density toggle decoupled from UI scale

The density toggle adjusts **only spacing tokens** (padding, margin, gap) without changing font size, icon size, or overall scale — the key distinction from the existing `--ui-scale` slider. The recommended mechanism is a **unitless `--density-factor` multiplier** applied via `calc()` to semantic spacing tokens in the existing three-tier hierarchy.

| Aspect | `--ui-scale` | `--density-factor` |
|--------|-------------|-------------------|
| Font size | Scales | Unchanged |
| Icon size | Scales | Unchanged |
| Spacing | Scales | Scales |
| Touch targets | Scale proportionally | Can shrink — needs floor clamping |
| Use case | Display/accessibility zoom | Information density preference |

Set `--density-factor: 1` for comfortable mode and `--density-factor: 0.625` for compact mode, applied via `[data-density="compact"]` on the root element. Semantic spacing tokens multiply their primitive base values by this factor: `--space-pad-md: calc(var(--space-xs) * var(--density-factor))`. Font sizes reference Utopia fluid steps directly, bypassing the density multiplier entirely.

Among the design systems surveyed, **Material Design 3** uses a numeric density scale from 0 to -3 where each step subtracts 4px from component height, while **Atlassian** treats density as a theme that swaps spacing token values, and **Ant Design** uses an algorithm function (`compactAlgorithm`) that derives compact tokens from seed tokens — though Ant's approach also reduces font sizes, which the VTT should avoid. AWS Cloudscape offers a two-level comfortable/compact system where compact is selectively applied — informational components and small-target components are excluded to protect readability and interactivity. **Two levels (comfortable and compact) are sufficient** for a VTT Controller; a third "spacious" level adds complexity without clear benefit in a control-panel context.

Every major app that implements density (Gmail, Salesforce, Cloudscape, Material demos) applies the change **instantly rather than animating it**. This is the safest default: transitioning `padding`, `margin`, and `gap` triggers layout recalculation on every animation frame, which is expensive in a dense control panel with many elements. If a subtle transition is desired, use a temporary `data-density-transitioning` attribute that enables 150ms transitions and is removed after the animation completes.

For **localStorage persistence**, use the same blocking inline `<head>` script pattern as the sidebar: read `localStorage.getItem('ui-density')` and set `data-density` on `<html>` before CSS renders to prevent a flash of wrong density. The `storage` event enables cross-tab sync if the Controller and DM Guide should share the density preference.

**The density toggle's most critical interaction is with WCAG 2.5.8 touch target requirements.** Compact mode at `--density-factor: 0.625` can shrink a 36px button to 22.5px — below the 24px AA minimum. The solution is `max()` floor clamping on all interactive elements: `min-height: max(24px, calc(32px * var(--density-factor)))`. On `any-pointer: coarse` devices, the floor rises to 44px. This is detailed further in the touch target section below.

## Window Management API requires Chromium and creative popup handling

The Window Management API (`window.getScreenDetails()`) enables the VTT's "arrange windows" feature — automatically placing the Display, DM Guide, and Controller across multiple monitors. The API returns a `ScreenDetails` object containing an array of `ScreenDetailed` objects, each with `availLeft`, `availTop`, `availWidth`, `availHeight`, `isPrimary`, `isInternal`, and a human-readable `label` (e.g., "Built-in Retina Display"). The object is live — it updates automatically as screens connect or disconnect, with `screenschange` and `currentscreenchange` events.

**Browser support is Chromium-only**: Chrome 100+, Edge 100+, Opera 86+. Firefox and Safari have shown no implementation signals, and the spec is a W3C Community Group Report rather than a standards-track document. Effective desktop coverage is roughly **82%** of users. The API requires the `"window-management"` permission (renamed from the deprecated `"window-placement"`), which triggers a browser permission prompt on first call to `getScreenDetails()`. Permission state is queryable via `navigator.permissions.query({ name: "window-management" })` before requesting, enabling a graceful educational UI for first-time users.

The **single biggest implementation challenge is the popup blocker**. Modern Chromium requires a separate user gesture (transient activation) for each `window.open()` call — opening three VTT windows from a single button click will have the second and third blocked. Four viable workarounds exist: a sequential flow where each button opens one window then reveals the next button; advising users to allow popups for the VTT origin in site settings (which lifts the one-per-gesture restriction); reusing existing named windows (`window.open(url, 'vtt-display')` navigates an existing window rather than opening a new one); or installing as a PWA, which may have more lenient popup rules.

For **progressive enhancement**, feature-detect with `'getScreenDetails' in window` and check `window.screen.isExtended` (available without full permission) to determine multi-monitor status. The "Arrange Windows" button should only appear when both conditions are met. The tiered fallback strategy: full API with multi-screen placement → API available but single screen → API unavailable, offering manual "Open Display" / "Open DM Guide" / "Open Controller" buttons.

```javascript
async function arrangeVTTWindows() {
  const details = await window.getScreenDetails();
  const screens = [...details.screens].sort((a, b) =>
    (b.availWidth * b.availHeight) - (a.availWidth * a.availHeight)
  );
  if (screens.length >= 2) {
    openWindow('/vtt-display', screens[0]); // Largest screen for canvas
    openWindow('/dm-guide', screens[1]);    // Second screen for DM tools
  }
}
function openWindow(url, screen) {
  return window.open(url, url,
    `left=${screen.availLeft},top=${screen.availTop},width=${screen.availWidth},height=${screen.availHeight}`
  );
}
```

The API **cannot interact with macOS Spaces, Stage Manager, or Windows virtual desktops** — it only reports physical/extended displays. Coordinates use CSS pixels (accounting for DPR), so a 4K monitor at 200% scaling reports its available dimensions in logical pixels. Screen arrangement uses the OS's virtual coordinate system, where the primary screen's top-left is typically (0,0) and adjacent screens have `left` values equal to or greater than the primary's width.

For **cross-window communication** between the three VTT apps, use `BroadcastChannel` — it works across same-origin windows regardless of whether they were opened with `noopener`, and enables real-time synchronization of initiative updates, map changes, and coordinated shutdown.

## Touch targets and pointer queries form the accessibility floor

The `@media (pointer: fine)` and `@media (pointer: coarse)` media features test the accuracy of the **primary** pointing device — not all available inputs. This distinction matters enormously for hybrid devices. On a Surface with Type Cover attached, `pointer: fine` is true (trackpad is primary) even though the user might touch the screen. On an iPad with Bluetooth mouse, `pointer: coarse` remains true (touchscreen is primary) even though a fine pointer is available. Browser support is **96.3% globally** — safe for production.

The critical recommendation: **use `any-pointer: coarse` rather than `pointer: coarse`** for touch-friendly sizing. This catches all devices where touch input is available, including desktops with touchscreens and tablets with keyboard covers. Patrick H. Lauke's widely-cited guidance is definitive: "If any of the pointer inputs is coarse, make the controls bigger. Even if the user is using a mouse at that moment, no harm done — larger targets benefit everyone."

**WCAG 2.2 defines two target size criteria.** SC 2.5.8 (Target Size Minimum, Level AA) requires **24×24 CSS pixels** — this is the universal floor that applies regardless of input type. SC 2.5.5 (Target Size Enhanced, Level AAA) requires **44×44 CSS pixels**. Both measure the interactive hit area, not the visual size — a 16×16px icon with 4px padding on each side creates a 24×24px target. The 24px threshold allows a spacing exception: undersized targets pass if a 24px-diameter circle centered on each target's bounding box doesn't intersect adjacent targets.

The **interaction between density, UI scale, and touch targets** is the most complex cross-cutting concern in Phase 4. Three scaling forces affect target size simultaneously: `--ui-scale` (proportional zoom), `--density-factor` (spacing only), and pointer capability (minimum floors). The unified solution uses nested `max()` clamping:

```css
:root {
  --active-floor: 24px; /* WCAG AA default */
}
@media (any-pointer: coarse) {
  :root { --active-floor: 44px; }
}

.controller-btn {
  --scaled: calc(36px * var(--ui-scale));
  --dense: calc(var(--scaled) + (var(--density-factor) - 1) * 8px);
  min-height: max(var(--active-floor), var(--dense));
  min-width: max(var(--active-floor), var(--dense));
}
```

This guarantees that no interactive element ever drops below 24px (or 44px on touch devices), regardless of how aggressively `--ui-scale` or `--density-factor` shrink it. Material Design uses a complementary technique: **invisible external padding** that extends the touch area to 48dp even when the visual component shrinks to 24dp at maximum density.

For pure touch-only devices (`pointer: coarse` AND NOT `any-pointer: fine`), consider **locking density to comfortable** and disabling the compact toggle entirely — this is the SAP Fiori approach, and it eliminates the possibility of users accidentally creating inaccessible layouts. Listen to `matchMedia('(any-pointer: coarse)').addEventListener('change', ...)` to handle dynamic pointer changes from dock/undock events and Bluetooth device pairing.

## Cross-cutting integration across all five deliverables

All five deliverables share the same CSS architecture: primitive tokens → semantic tokens → component tokens, organized in cascade layers. The density factor and pointer-based floors should be defined in the **semantic token layer**, making them available to all components across all three apps. State persistence follows a uniform pattern: blocking `<head>` script reads localStorage, sets `data-*` attributes on `<html>`, CSS responds via attribute selectors, JavaScript manages state changes and re-persists. The `storage` event synchronizes preferences across windows.

The z-index system should be defined once in the primitive token layer and shared across apps. The sidebar (z-10), drawer backdrop (z-400), drawer panel (z-500), and modal (z-700) occupy non-overlapping ranges with room for Canvas controls (z-50) and tooltips (z-900) between them.

All animations must respect `prefers-reduced-motion: reduce` — sidebar grid transitions, drawer transforms, and any optional density transition should all be disabled. The simplest approach is a single rule in the base layer: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: 0s !important; animation-duration: 0s !important; } }`.

## Conclusion

Phase 4's five deliverables resolve around three architectural principles that emerged from this research. First, **CSS Grid track animation is now the correct approach** for sidebar and panel transitions — it's natively supported across browsers and eliminates the old choice between animating `width` (expensive) and using transforms (doesn't reflow siblings). Second, **`max()` floor clamping is the universal safety mechanism** that makes density, scale, and touch targets composable without conflict — it ensures accessibility constraints are always honored regardless of user preferences. Third, **progressive enhancement with feature detection** applies not just to the Window Management API but to the entire system: pointer queries gate touch targets, `prefers-reduced-motion` gates animations, and localStorage availability gates persistence, all with sensible defaults when features are absent. The `inert` attribute deserves special attention as a modernization opportunity — it replaces complex manual focus-trapping and aria-hidden management with a single attribute, and now has universal browser support.