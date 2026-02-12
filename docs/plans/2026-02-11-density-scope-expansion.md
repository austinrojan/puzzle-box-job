# Phase 4 Fix: Density Scope Expansion + Test Stability

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand density coverage from 4 nav/combat selectors to the full DM Guide UI (tab bar, heat bar, nav title, content blocks, combat sub-components) and add test retry stability for local development.

**Architecture:** Inline `calc(var(--space-N) * var(--density-factor))` expressions directly in component CSS (intermediary `--pad-*` tokens don't work — Chromium doesn't reliably re-resolve transitive custom property chains on dynamic attribute changes). Density applies to structural spacing (padding, margin, gap) only — never to font sizes, grid row heights (`--tab-height`, `--heat-height`), or border radii. Where density could shrink elements below WCAG 2.5.8 minimums, use `max(var(--active-floor), ...)` composites.

**Tech Stack:** Vanilla CSS (inline `calc()` with `var(--density-factor)`), Playwright tests.

---

## Task 1: Add Test Retry for Local Stability

Quick config fix to handle flaky tests under heavy concurrent load (4 viewport projects x parallel workers).

**Files:**
- Modify: `playwright.config.js:7`

### Step 1: Write the change

In `playwright.config.js`, line 7, change:

```js
retries: process.env.CI ? 2 : 0,
```

to:

```js
retries: process.env.CI ? 2 : 1,
```

### Step 2: Run full test suite to verify

Run: `npx playwright test`
Expected: All tests pass (any flaky tests now get 1 local retry).

### Step 3: Commit

```bash
git add playwright.config.js
git commit -m "fix(phase4): add 1 local retry to Playwright config for test stability"
```

---

## Task 2: Expand Density to UI Chrome (Tab Bar, Heat Bar, Nav Title)

Applies `--density-factor` to the three UI chrome bands that currently use static spacing.

**Key decision:** Tab bar horizontal padding and gap scale with density. Tab `height: 100%` (set by grid row `--tab-height`) does NOT change — it's a grid row dimension. Heat bar horizontal padding and gap scale. Nav title padding scales.

**Files:**
- Modify: `index.html:187` (`.tab` padding)
- Modify: `index.html:186` (`.tab` gap)
- Modify: `index.html:236-237` (`#heat-bar` gap + padding)
- Modify: `index.html:293` (`.nav-title` padding)
- Modify: `tests/density.spec.js` — add chrome element tests

### Step 1: Write the failing tests

Append to `tests/density.spec.js`, inside the existing `test.describe('Density token system', ...)` block, after the last test:

```js
  test('DM Guide: compact reduces tab horizontal padding', async ({ page }) => {
    await page.goto('/');
    const defaultPad = await page.locator('.tab').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingRight)
    );
    await page.evaluate(() => localStorage.setItem('ui-density', 'compact'));
    await page.reload();
    const compactPad = await page.locator('.tab').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingRight)
    );
    expect(compactPad).toBeLessThan(defaultPad);
  });

  test('DM Guide: compact reduces heat-bar padding', async ({ page }) => {
    await page.goto('/');
    const defaultPad = await page.locator('#heat-bar').evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingRight)
    );
    await page.evaluate(() => localStorage.setItem('ui-density', 'compact'));
    await page.reload();
    const compactPad = await page.locator('#heat-bar').evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingRight)
    );
    expect(compactPad).toBeLessThan(defaultPad);
  });

  test('DM Guide: compact reduces nav-title padding', async ({ page }) => {
    await page.goto('/');
    const defaultPad = await page.locator('.nav-title').evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingTop)
    );
    await page.evaluate(() => localStorage.setItem('ui-density', 'compact'));
    await page.reload();
    const compactPad = await page.locator('.nav-title').evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingTop)
    );
    expect(compactPad).toBeLessThan(defaultPad);
  });
```

> **Note for implementer:** All density padding tests use the `localStorage` + `page.reload()` pattern (not dynamic `page.evaluate(() => dataset.density = 'compact')`) because Chromium defers custom-property recalculation across separate evaluate boundaries. The reload approach applies `data-density` via the blocking `<head>` script before first paint, guaranteeing consistent computed styles.

### Step 2: Run tests to verify they fail

Run: `npx playwright test tests/density.spec.js`
Expected: 3 new tests FAIL (padding values identical in default and compact).

### Step 3: Apply density to `.tab` padding and gap

In `index.html`, line 186-187, change:

```css
  gap: var(--space-2);
  padding: 0 var(--space-3);
```

to:

```css
  gap: calc(var(--space-2) * var(--density-factor));
  padding: 0 calc(var(--space-3) * var(--density-factor));
```

### Step 4: Apply density to `#heat-bar` gap and padding

In `index.html`, lines 236-237, change:

```css
  gap: var(--space-3);
  padding: 0 var(--space-4);
```

to:

```css
  gap: calc(var(--space-3) * var(--density-factor));
  padding: 0 calc(var(--space-4) * var(--density-factor));
```

### Step 5: Apply density to `.nav-title` padding

In `index.html`, line 293, change:

```css
  padding: var(--space-2) var(--space-4);
```

to:

```css
  padding: calc(var(--space-2) * var(--density-factor)) calc(var(--space-4) * var(--density-factor));
```

### Step 6: Run density tests

Run: `npx playwright test tests/density.spec.js`
Expected: All tests pass (11 total: 8 existing + 3 new).

### Step 7: Run full test suite

Run: `npx playwright test`
Expected: All pass.

### Step 8: Commit

```bash
git add index.html tests/density.spec.js
git commit -m "feat(phase4): expand density coverage to tab bar, heat bar, and nav title"
```

---

## Task 3: Expand Density to Content Block Margins

Applies `--density-factor` to the structural vertical margins of content blocks in the center column. This is the largest batch — 8 block types plus the VTT cue.

**Key decisions:**
- **Margins only:** Block vertical margins (`margin: var(--space-N) 0`) get density. These control whitespace between blocks — the main visual effect of compact mode in the content area.
- **Internal padding stays static:** Padding inside blocks (e.g., read-aloud `padding: var(--space-5) var(--space-6)`) does NOT get density — it's readability space for prose content.
- **`#main-content` padding stays static:** The `clamp()` padding at line 410 is viewport-responsive, not density-responsive.
- **Indented left margin on `.block-conditional`:** Only the vertical margins get density, not the horizontal indent (`var(--space-4)`) which serves structural nesting.

**Files:**
- Modify: `index.html` lines 499, 538, 556, 590, 620, 647, 659, 665 (block margin lines)
- Modify: `tests/density.spec.js` — add content block margin test

### Step 1: Write the failing test

Append to `tests/density.spec.js`:

```js
  test('DM Guide: compact reduces block-dm-note margin', async ({ page }) => {
    await page.goto('/');
    // Open Act 1 to ensure a dm-note block exists
    await page.locator('.nav-section-header').first().click();
    await page.locator('.nav-child').first().click();
    await page.waitForSelector('.block-dm-note');
    const defaultMargin = await page.locator('.block-dm-note').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).marginTop)
    );
    await page.evaluate(() => localStorage.setItem('ui-density', 'compact'));
    await page.reload();
    await page.locator('.nav-section-header').first().click();
    await page.locator('.nav-child').first().click();
    await page.waitForSelector('.block-dm-note');
    const compactMargin = await page.locator('.block-dm-note').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).marginTop)
    );
    expect(compactMargin).toBeLessThan(defaultMargin);
  });
```

### Step 2: Run test to verify it fails

Run: `npx playwright test tests/density.spec.js --grep "compact reduces block-dm-note"`
Expected: FAIL (margins identical).

### Step 3: Apply density to block vertical margins

Apply `calc(var(--space-N) * var(--density-factor))` to the **vertical** (top/bottom) margin components of each block type. Leave horizontal margins and internal padding unchanged.

**Line 499** — `.block-read-aloud` margin:
```css
/* Before */ margin: var(--space-4) 0;
/* After  */ margin: calc(var(--space-4) * var(--density-factor)) 0;
```

**Line 538** — `.block-vtt-cue` margin:
```css
/* Before */ margin: var(--space-2) 0;
/* After  */ margin: calc(var(--space-2) * var(--density-factor)) 0;
```

**Line 556** — `.block-dm-note` margin:
```css
/* Before */ margin: var(--space-3) 0;
/* After  */ margin: calc(var(--space-3) * var(--density-factor)) 0;
```

**Line 590** — `.block-dm-tip` margin:
```css
/* Before */ margin: var(--space-3) 0;
/* After  */ margin: calc(var(--space-3) * var(--density-factor)) 0;
```

**Line 620** — `.block-skill-check` margin:
```css
/* Before */ margin: var(--space-3) 0;
/* After  */ margin: calc(var(--space-3) * var(--density-factor)) 0;
```

**Line 647** — `.block-encounter` margin:
```css
/* Before */ margin: var(--space-4) 0;
/* After  */ margin: calc(var(--space-4) * var(--density-factor)) 0;
```

**Line 659** — `.block-narrative` margin:
```css
/* Before */ margin: var(--space-3) 0;
/* After  */ margin: calc(var(--space-3) * var(--density-factor)) 0;
```

**Line 665** — `.block-conditional` vertical margins only:
```css
/* Before */ margin: var(--space-3) 0 var(--space-3) var(--space-4);
/* After  */ margin: calc(var(--space-3) * var(--density-factor)) 0 calc(var(--space-3) * var(--density-factor)) var(--space-4);
```

### Step 4: Run density tests

Run: `npx playwright test tests/density.spec.js`
Expected: All pass (12 total).

### Step 5: Run full test suite

Run: `npx playwright test`
Expected: All pass.

### Step 6: Commit

```bash
git add index.html tests/density.spec.js
git commit -m "feat(phase4): expand density coverage to content block margins"
```

---

## Task 4: Expand Density to Combat Sub-Components

Applies `--density-factor` to combat panel sub-components: initiative items, braziers row, dominate toggle, and combat section title margin.

**Files:**
- Modify: `index.html:982` (`.braziers-row` gap + margin)
- Modify: `index.html:1067` (`.init-item` padding)
- Modify: `index.html:1086` (`.dominate-toggle` padding + margin)
- Modify: `index.html:486` (`.combat-section-title` margin-bottom)
- Modify: `tests/density.spec.js` — add combat sub-component test

### Step 1: Write the failing test

Append to `tests/density.spec.js`:

```js
  test('DM Guide: compact reduces init-item padding', async ({ page }) => {
    await page.goto('/');
    // Open combat panel
    await page.keyboard.press('b');
    await page.waitForSelector('.init-item');
    const defaultPad = await page.locator('.init-item').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingTop)
    );
    await page.evaluate(() => localStorage.setItem('ui-density', 'compact'));
    await page.reload();
    await page.keyboard.press('b');
    await page.waitForSelector('.init-item');
    const compactPad = await page.locator('.init-item').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingTop)
    );
    expect(compactPad).toBeLessThan(defaultPad);
  });
```

### Step 2: Run test to verify it fails

Run: `npx playwright test tests/density.spec.js --grep "compact reduces init-item"`
Expected: FAIL.

### Step 3: Apply density to combat sub-components

**Line 982** — `.braziers-row` gap and margin:
```css
/* Before */ .braziers-row { display: flex; gap: var(--space-3); justify-content: center; margin: var(--space-2) 0 var(--space-4); }
/* After  */ .braziers-row { display: flex; gap: calc(var(--space-3) * var(--density-factor)); justify-content: center; margin: calc(var(--space-2) * var(--density-factor)) 0 calc(var(--space-4) * var(--density-factor)); }
```

**Line 1067** — `.init-item` padding:
```css
/* Before */ padding: var(--space-2) var(--space-2);
/* After  */ padding: calc(var(--space-2) * var(--density-factor)) calc(var(--space-2) * var(--density-factor));
```

**Line 1086** — `.dominate-toggle` padding and margin:
```css
/* Before */ padding: var(--space-3); ... margin: var(--space-2) 0;
/* After  */ padding: calc(var(--space-3) * var(--density-factor)); ... margin: calc(var(--space-2) * var(--density-factor)) 0;
```

**Line 486** — `.combat-section-title` margin-bottom:
```css
/* Before */ margin-bottom: var(--space-3);
/* After  */ margin-bottom: calc(var(--space-3) * var(--density-factor));
```

### Step 4: Run density tests

Run: `npx playwright test tests/density.spec.js`
Expected: All pass (13 total).

### Step 5: Run full test suite

Run: `npx playwright test`
Expected: All pass.

### Step 6: Commit

```bash
git add index.html tests/density.spec.js
git commit -m "feat(phase4): expand density coverage to combat sub-components"
```

---

## Task 5: Manual Visual Review + Final Verification

Manual smoke test at 1440px viewport to confirm the density toggle produces a visually cohesive whole-app shift.

### Step 1: Run full test suite

Run: `npx playwright test`
Expected: All pass across 4 viewports.

### Step 2: Manual smoke test at 1440px

Open `http://localhost:8765` at 1440×900 in a browser. Verify:

1. **Default density:** All spacing looks normal, no visual regressions.
2. **Toggle to compact:** Click density button. Verify:
   - Tab bar tabs are tighter (less horizontal padding)
   - Heat bar is tighter
   - Nav title has less padding
   - Nav sections/children are tighter (already worked)
   - Content blocks have reduced vertical margins between them
   - Combat panel: initiative items, braziers, dominate toggle are all tighter
   - **No element smaller than 24px** (touch-target floor holds)
3. **Toggle back to default:** All spacing restores.
4. **Reload persistence:** Set compact, reload — stays compact without flash.
5. **Controller:** Open controller popup, verify density toggle works there too.

### Step 3: If any visual issues found, fix and re-test

### Step 4: Final commit if any visual fixes were needed

---

## Verification Summary

After all tasks:

1. **Test count:** ~13 density tests + existing suite (~200+ total across 4 viewports)
2. **Density coverage:**
   - UI chrome: tab bar, heat bar, nav title
   - Nav panel: section headers, children (already done)
   - Content blocks: 8 block types vertical margins
   - Combat panel: header, sections (already done), braziers, initiative, dominate, section titles
3. **What's NOT density-affected (by design):**
   - `--tab-height`, `--heat-height` (grid row dimensions)
   - Font sizes
   - `#main-content` padding (viewport-responsive via `clamp()`)
   - Internal block padding (readability space)
   - Border radii
   - Horizontal structural indents (`.block-conditional` left margin)
