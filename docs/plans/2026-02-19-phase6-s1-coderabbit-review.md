# Phase 6 + S1 + Cleanup CodeRabbit Review Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Comprehensive code review of all Phase 6 (Elastic Overscroll + Trackpad), Phase S1 (Stateful Device Classification), and the post-S1 cleanup pass using CodeRabbit CLI and parallel review agents.

**Context:** Phase 6 introduced the dual-position camera model with elastic overscroll, gesture state machine, smooth zoom animation, trackpad detection, and inertial coast. Phase S1 replaced the stateless `classifyWheelDevice()` with a windowed Bayesian `WheelDeviceClassifier`. The cleanup pass extracted test helpers, removed deprecated code, and polished JSDoc. All 1236+ tests pass. This review covers 19 commits across 10 files with +1623/-225 lines (excluding planning docs).

**Architecture:** Six review passes — five parallel `coderabbit:code-reviewer` Task agents (one per domain) plus one sequential full-diff CLI review. Findings de-duplicated, triaged by severity, and documented in a results file matching the format of previous phase reviews (see `docs/plans/2026-02-17-phase5-coderabbit-results.md`).

**Tech Stack:** CodeRabbit CLI v0.3.5, `coderabbit:code-reviewer` Task agent, vanilla JS ES modules, Playwright tests.

---

## Scope

| Item | Value |
|------|-------|
| Commits | 19 (excluding merge commit `76e30c0`) |
| Base commit | `67b9036` (last Phase 5.5 commit) |
| HEAD | `1ab5754` (cleanup pass final commit) |
| Files changed | 10 (excluding `planning-docs/`) |
| Lines | +1,623 / -225 |

### Files by domain

| Domain | Files | Lines Changed |
|--------|-------|---------------|
| **Core Camera** | `vtt/js/map-camera.js` | +657 (1,353 total) |
| **Gesture & Classification** | `vtt/js/trackpad-gesture.js` | +216 (all new) |
| **Unit Tests** | `tests/phase6-unit.spec.js`, `tests/device-classifier.spec.js` | +525 (all new) |
| **Integration Tests** | `tests/phase6-integration.spec.js` | +296 (all new) |
| **Modified Tests & Helpers** | `tests/camera-clamping.spec.js`, `tests/input-handling.spec.js`, `tests/helpers.js` | +152 / -109 |
| **CSS** | `vtt/css/map.css` | +1 |

---

## Critical Files

| File | Lines | Review Focus |
|------|-------|-------------|
| `vtt/js/map-camera.js` | 1,353 | Dual-position model correctness, elastic overscroll physics, gesture state machine priority logic, inertial coast friction, smooth zoom log-space lerp, memory leaks from rAF/animation loops, `_applyConstraints` always-emit invariant, `_feedElasticOverflow` rubber band formula, boundary detection edge cases |
| `vtt/js/trackpad-gesture.js` | 216 | TrackpadGestureDetector FSM transitions, WheelDeviceClassifier signal scoring, hysteresis threshold correctness, silence reset logic, sliding window eviction, `_scoreWindow()` six-signal independence, delta decay detection ratio |
| `tests/phase6-unit.spec.js` | 283 | Assertion quality, mock correctness, edge case coverage, no vacuous passes |
| `tests/device-classifier.spec.js` | 242 | `__newClassifier` helper correctness, `performance.now` mock/restore lifecycle, timing simulation fidelity |
| `tests/phase6-integration.spec.js` | 296 | Browser-context wheel dispatch realism, `dispatchMouseWheelSequence` helper usage, `waitForFunction` vs `waitForTimeout`, animation timing sensitivity |
| `tests/helpers.js` | 288 | `dispatchMouseWheelSequence` parameter defaults match original hardcoded values, `performance.now` restore safety |
| `tests/camera-clamping.spec.js` | 414 | Dual-position model migration (`_isDragging` → `_gestureActive`), `elasticOffsetX` assertions, backward compat |
| `tests/input-handling.spec.js` | 215 | Stateful classifier migration, existing test correctness preserved |

---

## Task 1: Generate review diffs

**Files:** None modified — preparation step.

**Step 1:** Generate the full diff for reference:

```bash
git diff 67b9036..HEAD -- ':(exclude)planning-docs/' > /tmp/phase6-s1-full.diff
```

**Step 2:** Generate per-domain diffs for the parallel agent prompts:

```bash
# Batch 1: Core Camera
git diff 67b9036..HEAD -- vtt/js/map-camera.js > /tmp/batch1-camera.diff

# Batch 2: Gesture & Classification
git diff 67b9036..HEAD -- vtt/js/trackpad-gesture.js > /tmp/batch2-gesture.diff

# Batch 3: Unit Tests
git diff 67b9036..HEAD -- tests/phase6-unit.spec.js tests/device-classifier.spec.js > /tmp/batch3-unit-tests.diff

# Batch 4: Integration Tests
git diff 67b9036..HEAD -- tests/phase6-integration.spec.js > /tmp/batch4-integration-tests.diff

# Batch 5: Modified Tests & Helpers
git diff 67b9036..HEAD -- tests/camera-clamping.spec.js tests/input-handling.spec.js tests/helpers.js vtt/css/map.css tests/phase5.5-unit.spec.js > /tmp/batch5-modified.diff
```

**Step 3:** Verify all diffs are non-empty:

```bash
wc -l /tmp/batch*.diff /tmp/phase6-s1-full.diff
```

**Commit:** None (preparation only).

---

## Task 2: Launch parallel CodeRabbit review agents (Batches 1-5)

**Files:** None modified — review-only.

Launch 5 `coderabbit:code-reviewer` Task agents in parallel with the prompts below. Each agent reads the relevant diff and source files, then produces findings in the standard format (Blocking / Advisory High / Advisory / Low / Info).

### Batch 1: Core Camera Implementation

**Agent prompt:**
```
Review the Phase 6 camera system changes in vtt/js/map-camera.js (1,353 lines, +657/-225 from base).

Read the full file: vtt/js/map-camera.js

This file implements:
1. Dual-position camera model: logical x/y (hard-clamped, synced via BroadcastChannel) + elasticOffsetX/Y (visual-only displacement). Renderer uses visualX/Y getters.
2. Elastic overscroll with Apple rubber band formula (c=0.55 active, c=0.3 momentum) via _feedElasticOverflow()
3. GestureStateMachine with priority levels (IDLE=0 to DRAG_PAN=6)
4. SmoothZoomAnimator for log-space exponential lerp (factor=0.15, ZOOM_PER_NOTCH=1.15)
5. Inertial coast using panBy() with friction=0.96/frame, stopping at 10px/s
6. CameraAnimator with stiffness param (position=200, elastic offset=400)
7. _applyConstraints must always emit camera:changed (critical invariant)
8. WheelDeviceClassifier integration for mouse vs trackpad routing

Focus areas:
- Mathematical correctness of rubber band, log-space zoom, spring physics
- Memory leak risk from rAF loops, animation callbacks, event listeners
- GestureStateMachine priority preemption correctness and edge cases
- _applyConstraints always-emit invariant — any path that could skip emission
- Boundary detection edge cases (zero-size viewport, extreme zoom levels)
- BroadcastChannel sync correctness (localToShared reads camera.x, not visualX)
- Division by zero guards in zoom calculations
- Event listener cleanup in destroy/detach paths

Rate each finding: Blocking, Advisory (High), Advisory, Low, or Info.
Include file path, line numbers, and concrete fix suggestions.
```

### Batch 2: Gesture & Device Classification

**Agent prompt:**
```
Review the Phase 6 + S1 trackpad gesture and device classification module: vtt/js/trackpad-gesture.js (216 lines, all new).

Read the full file: vtt/js/trackpad-gesture.js

This file contains:
1. TrackpadGestureDetector: IDLE→ACTIVE→MOMENTUM→IDLE state machine from WheelEvent streams. Delta decay detection (DECAY_RATIO=0.97, streak=3) + timeout (150ms active, 100ms momentum). Spike detection cancels momentum.
2. WheelDeviceClassifier (Phase S1): Sliding window of 6 event summaries, 6 discriminative signals, asymmetric hysteresis (4 mouse to enter, 2 trackpad to leave), 400ms silence reset.

Focus areas:
- FSM transition completeness (all state × input combinations handled)
- Signal scoring independence (signals shouldn't double-count same feature)
- Hysteresis threshold correctness (asymmetric 4/2 logic)
- Silence reset edge cases (400ms boundary, first event after silence)
- Sliding window eviction (FIFO correctness when window full)
- Delta decay ratio sensitivity (0.97 too aggressive? too lenient?)
- Performance: object allocation per classify() call
- Export surface area correctness (only needed symbols exported)

Rate each finding: Blocking, Advisory (High), Advisory, Low, or Info.
Include file path, line numbers, and concrete fix suggestions.
```

### Batch 3: Unit Tests Quality

**Agent prompt:**
```
Review unit test quality for Phase 6 + S1. Read these files:

1. tests/phase6-unit.spec.js (283 lines) — Tests for CameraAnimator, SmoothZoomAnimator, GestureStateMachine, TrackpadGestureDetector, elastic rubber band model, Camera class properties
2. tests/device-classifier.spec.js (242 lines) — 12 tests for WheelDeviceClassifier using __newClassifier() page helper with mocked performance.now

Focus areas:
- Vacuous pass danger: any test where before === after could pass trivially (see MEMORY.md note)
- Mock correctness: performance.now mock/restore lifecycle, memory leak from missed restore()
- Assertion specificity: toBe vs toBeCloseTo for floats, exact vs range assertions
- Edge case coverage gaps: zero deltas, NaN, Infinity, negative values, empty arrays
- Test isolation: shared state leakage between tests via globals or module state
- Helper pattern quality: __newClassifier() factory — is the abstraction correct?
- Missing negative tests: behaviors that should NOT happen
- Timeout sensitivity: any waitForFunction/waitForTimeout that could flake

Rate each finding: Blocking, Advisory (High), Advisory, Low, or Info.
Include file path, line numbers, and concrete fix suggestions.
```

### Batch 4: Integration Tests Quality

**Agent prompt:**
```
Review integration test quality for Phase 6 + S1. Read this file:

tests/phase6-integration.spec.js (296 lines) — 9 browser-based integration tests covering trackpad elastic overscroll, mouse drag elastic, smooth zoom animation, gesture preemption, inertial coast, stateful device classification

Also read the helper: tests/helpers.js (focus on dispatchMouseWheelSequence at the end, plus gotoVTT and enterMapMode)

Focus areas:
- Wheel event dispatch realism: do dispatched WheelEvents match real browser events? Missing properties?
- dispatchMouseWheelSequence helper: parameter defaults match original hardcoded values? performance.now mock/restore timing safe?
- waitForFunction vs waitForTimeout: any remaining hardcoded waits that should be condition-based?
- Animation timing sensitivity: tests depending on specific rAF frame counts
- Camera readiness: tests accessing camera before it's initialized (see MEMORY.md: camera not ready after gotoVTT)
- Mouse position assumptions: tests that move mouse outside #map-container (MEMORY.md: mouseleave cancels drag)
- Wheel direction sign chain: deltaX/deltaY sign → normalizeWheel → panBy(-dx) direction correctness
- Viewport size assumptions: tests assuming 1920x1080 without explicit verification
- Browser context cleanup: leaked contexts on test failure

Rate each finding: Blocking, Advisory (High), Advisory, Low, or Info.
Include file path, line numbers, and concrete fix suggestions.
```

### Batch 5: Modified Tests & Helpers

**Agent prompt:**
```
Review the modifications to existing test files and helpers during Phase 6 + S1 + cleanup. Read these files:

1. tests/camera-clamping.spec.js (414 lines) — Modified for dual-position model (_isDragging → _gestureActive, elasticOffsetX assertions)
2. tests/input-handling.spec.js (215 lines) — Modified for stateful WheelDeviceClassifier
3. tests/helpers.js (288 lines) — New dispatchMouseWheelSequence helper added, existing helpers unchanged
4. vtt/css/map.css (95 lines) — +1 line (touch-action: none)

Also read the diff for context: git diff 67b9036..HEAD for these files.

Focus areas:
- Migration correctness: _isDragging → _gestureActive replacement complete? Any stale references?
- elasticOffsetX/Y assertion correctness: are expected values mathematically sound?
- Backward compatibility: do modified tests still cover pre-Phase-6 invariants?
- Helper export: is dispatchMouseWheelSequence properly exported and importable?
- CSS touch-action: does touch-action:none break any existing touch interactions?
- Dead code: any test assertions or helpers that are now unreachable

Rate each finding: Blocking, Advisory (High), Advisory, Low, or Info.
Include file path, line numbers, and concrete fix suggestions.
```

**Verify:** All 5 agents complete and return findings.

**Commit:** None (review-only).

---

## Task 3: Run full-diff CodeRabbit CLI review (Batch 6)

**Files:** None modified — review-only.

**Step 1:** Create a review config file with Phase 6 + S1 context:

```bash
cat > /tmp/phase6-review-config.md << 'CFGEOF'
# Phase 6 + S1 Review Context

This review covers the Phase 6 (Elastic Overscroll + Trackpad) and Phase S1 (Stateful Device Classification) implementation for a browser-based Virtual Tabletop (VTT).

## Architecture
- Single-page VTT app with ES modules, no build step, fixed 1920x1080 viewport
- Multi-canvas layer stack (bg, fog, grid, tokens, effects)
- Camera system with dual-position model (logical x/y + elastic offset)
- BroadcastChannel sync between VTT display and controller window
- Playwright browser tests (not Node unit tests)

## Key invariants
1. _applyConstraints must ALWAYS emit camera:changed (never skip for optimization)
2. localToShared() reads camera.x/y, never visualX/Y (elastic offset is local-only)
3. GestureStateMachine: higher priority always preempts lower
4. WheelDeviceClassifier: asymmetric hysteresis (4 mouse signals to enter, 2 trackpad to leave)
5. SmoothZoomAnimator operates in log-space (exponential lerp, not linear)

## Known accepted patterns
- performance.now mocking in tests (mock during synchronous dispatch, restore before async)
- WheelEvent dispatch via el.dispatchEvent(new WheelEvent(...)) for testing
- Elastic offset snap-back via spring physics (stiffness=400)
- Inertial coast via friction decay (0.96/frame) using panBy() for natural boundary interaction

## Review focus
- Correctness of physics/math (rubber band, spring, log-space zoom, decay)
- Memory leaks (rAF loops, event listeners, animation callbacks)
- Race conditions (gesture state transitions, BroadcastChannel timing)
- Test quality (vacuous passes, mock lifecycle, assertion specificity)
- Dead code (deprecated functions, unreachable branches)
CFGEOF
```

**Step 2:** Run CodeRabbit CLI against the full diff:

```bash
coderabbit review --plain --base-commit 67b9036 --config /tmp/phase6-review-config.md 2>&1
```

**Step 3:** Save the CLI output to a file for triage:

```bash
coderabbit review --plain --base-commit 67b9036 --config /tmp/phase6-review-config.md > /tmp/coderabbit-cli-output.txt 2>&1
```

**Verify:** CLI completes with non-empty output.

**Commit:** None (review-only).

---

## Task 4: Triage and de-duplicate findings

**Files:** Create `docs/plans/2026-02-19-phase6-s1-coderabbit-results.md`

**Step 1:** Collect all findings from Batches 1-6 (5 agent results + CLI output).

**Step 2:** De-duplicate — same issue found by multiple batches gets a single entry with batch attribution.

**Step 3:** Categorize each unique finding:

| Category | Criteria |
|----------|----------|
| **Blocking** | Incorrect behavior, data corruption, security vulnerability |
| **Advisory (High)** | Potential bug under edge conditions, missing guards that could manifest, significant test quality gaps |
| **Advisory** | Code quality, defensive improvements, minor test gaps |
| **Low** | Style, naming, documentation |
| **Info** | Observations, architecture notes |
| **False Positive** | Finding is incorrect or not applicable |

**Step 4:** Write the results document with this structure:

```markdown
# Phase 6 + S1 + Cleanup CodeRabbit Review Results

**Date:** 2026-02-19
**Scope:** 19 commits (`67b9036..1ab5754`), 10 files, +1,623 / -225 lines
**Reviewers:** 5 parallel CodeRabbit batch agents + full-scope CLI review

## Summary

| Category | Count | Fixed |
|----------|-------|-------|
| **Blocking** | ? | — |
| **Advisory (High)** | ? | — |
| **Advisory** | ? | — |
| **Low** | ? | — |
| **Info** | ? | — |
| **Total findings** | ? | — |

**Verdict:** [One paragraph assessment]

---

## Review Methodology
[Table of 6 batches with domains, files, lines, agents]

---

## Blocking Issues
[If any]

## Advisory Issues (High Priority)
### AH-1: [Title]
- **File:** path:lines
- **Batches:** which batches found it
- **Issue:** description
- **Impact:** what could go wrong
- **Fix:** concrete suggestion

[Continue for all AH-N]

## Advisory Issues
### A-1: [Title]
[Same format]

## Low Priority
### L-1: [Title]
[Same format]

## Info / Observations
[Bullet list]

## False Positives
[Bullet list with explanation]
```

**Verify:** Results document has all findings categorized, no duplicates, each with file:line and fix suggestion.

**Commit:** `docs(review): Phase 6 + S1 + cleanup CodeRabbit review results`

---

## Task 5: Fix blocking and advisory-high issues

**Files:** Varies based on findings.

**Step 1:** For each **Blocking** finding, apply the fix immediately. These must be resolved.

**Step 2:** For each **Advisory (High)** finding:
- If the fix is safe and clearly correct → apply it
- If the fix is risky or changes behavior → document why it's deferred

**Step 3:** Run the affected test files after each fix:

```bash
npx playwright test tests/phase6-unit.spec.js tests/phase6-integration.spec.js tests/device-classifier.spec.js tests/camera-clamping.spec.js tests/input-handling.spec.js --project=desktop-1920 --reporter=line
```

**Step 4:** Update the results document — mark each fixed finding with checkmark in the "Fixed" column.

**Verify:** All blocking issues resolved, advisory-high issues either fixed or documented.

**Commit:** `fix: address CodeRabbit review findings — [description of fixes]`

---

## Task 6: Full test suite verification

**Step 1:** Kill any stale server:

```bash
lsof -ti:8765 | xargs kill -9 2>/dev/null; sleep 1
```

**Step 2:** Run full suite:

```bash
npx playwright test --reporter=line
```

Expected: 1236+ passed, 0 failed (plus known flaky tests).

**Step 3:** Update the results document with final test counts and verdict.

**Verify:** Full suite green. Results document complete with final summary.

**Commit:** `docs(review): finalize Phase 6 + S1 review results with fix verification`

---

## Summary of Deliverables

| Deliverable | Description |
|-------------|------------|
| `docs/plans/2026-02-19-phase6-s1-coderabbit-results.md` | Full review results with categorized findings |
| Bug fixes (if any) | Blocking and AH issues resolved |
| Test verification | Full suite passing after fixes |

## Review Pass Architecture

```
Batch 1: Core Camera (map-camera.js)          ─┐
Batch 2: Gesture & Classification              │
Batch 3: Unit Tests                            ├─→ Triage & De-dup → Results Doc → Fix → Verify
Batch 4: Integration Tests                     │
Batch 5: Modified Tests & Helpers              ─┘
Batch 6: Full Diff CLI (sequential)            ─→ Cross-cutting findings ─→ Merge into Results
```
