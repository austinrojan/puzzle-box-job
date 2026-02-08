# VTT Campaign Simulation QA Playbook

## Overview

Each ralph-loop iteration simulates a phase of a D&D campaign played through the VTT using Chrome browser automation. The VTT is at **http://localhost:8765/vtt/index.html**. Track progress in `vtt/QA-LOG.md`.

**Before each phase**: Load the Chrome browser tools, get tab context, and navigate to the VTT. Read `vtt/QA-LOG.md` to find the next incomplete phase (marked `[ ]`).

**After each phase**: Mark the phase `[x]` in QA-LOG.md. If a bug is found and fixed, mark `[x][fix]`. If blocked, mark `[!]` with notes.

**Screenshot instruction**: Take a screenshot (`mcp__claude-in-chrome__browser_take_screenshot` or `read_page`) at key moments noted below.

---

## Phase 1: Cold Start & Asset Audit

**Goal**: Verify clean cold start with all 50 assets loading.

1. Navigate to `http://localhost:8765/vtt/index.html`
2. Read console messages — check for any 404s, errors, or warnings
3. Verify the VTT title shows "The Puzzle-Box Job"
4. Verify Theater mode is active (S01 "The Rusty Anchor" displayed)
5. Click through first 5 scenes using the Next chevron button (`.pnav-chevron[aria-label="Next"]`)
6. Verify each scene displays art (no broken image placeholders)
7. Switch to Map mode (click `.pnav-mode-btn[data-mode="map"]`)
8. Verify M01 Dock District loads with 5 canvas elements
9. Switch to Combat mode (click `.pnav-mode-btn[data-mode="initiative"]`)
10. Verify initiative panel appears and NEXT button is visible
11. Switch back to Theater mode
12. **Screenshot**: Take screenshot of S01 in Theater mode
13. Check console for any errors accumulated during this phase

**Pass criteria**: Zero 404s, zero JS errors, all 3 modes switch cleanly, scene art visible.

---

## Phase 2: Act 1 — The Rusty Anchor

**Goal**: Test scene navigation, map interaction, and token placement.

1. Go to Theater mode, navigate to S01 (The Rusty Anchor)
2. Verify overlay text: "A salt-crusted tavern on the docks..."
3. Advance to S02 (Locke's Proposition) — verify no overlay
4. Switch to Map mode — M01 Dock District should load
5. Test camera controls:
   - Use zoom buttons (`.pnav-zoom-btn`) — zoom in, zoom out
   - Verify zoom label updates (`.pnav-zoom-label`)
   - Click fit-to-map button (`.pnav-icon-btn[aria-label="Fit to map"]`)
   - Verify zoom resets
6. Toggle grid on/off (`.pnav-icon-btn[aria-label="Toggle grid"]`)
7. Verify grid button gets `.toggled` class when active
8. Open the token palette via keyboard shortcut T (or right-click context menu)
9. Place 3 PC tokens: martin-storm, lome, oda
10. Verify tokens appear on the map with circular portraits and colored borders
11. Drag a token to a new position — verify snap-to-grid
12. Right-click a token — verify context menu appears
13. **Screenshot**: Map with 3 PC tokens placed
14. Check console for errors

**Pass criteria**: Scene overlay renders, camera zoom/pan/fit works, grid toggles, tokens place and drag correctly.

---

## Phase 3: Act 2 — Investigation (Randomized)

**Goal**: Test mid-adventure scenes and deep map interaction.

**Randomization**: Pick 2 of these 5 scenes to deep-test (vary each iteration):
- S03 Dock District, S04 Veymar Estate (Distant), S05 The Bakery — Pip, S06 The Undermarket, S07 The Broken Oar

1. Switch to Theater mode
2. Navigate to S03 (first scene of Act 2) — verify Act 2 badge shows
3. Navigate through all Act 2 scenes (S03-S07), verifying each has art
4. For the 2 randomly chosen scenes, pause and verify:
   - Scene title and badge display correctly
   - Art is not the same as another scene (unique images)
5. Switch to Map mode
6. Test extreme zoom: zoom in to 200%+ and zoom out to 50% or less
7. Verify zoom label updates at each level
8. Click fit-to-map to reset
9. Cycle to map M02 using the Next chevron in map mode
10. Verify M02 Estate Grounds loads
11. **Screenshot**: M02 at zoomed-in state showing map detail
12. Check console for errors

**Pass criteria**: All Act 2 scenes have unique art, extreme zoom works, map cycling works.

---

## Phase 4: Act 3 — Estate Infiltration (Randomized Entry)

**Goal**: Test branching entry routes and overlay text.

**Randomization**: Choose one entry route each iteration:
- Route A: S09 Main Gate
- Route B: S10 Servants' Entrance
- Route C: S11 West Wall

1. Switch to Theater mode
2. Navigate to S08 (Estate at Night) — verify overlay: "The Veymar estate blazes with amber light..."
3. **Screenshot**: S08 with overlay text visible
4. Navigate to the randomly chosen entry scene (S09, S10, or S11)
5. Continue to S12 Conservatory
6. Switch to Map mode — cycle to M02 Estate Grounds
7. Open token palette and place:
   - 2 guard tokens at different positions
   - 1 mastiff token
8. Verify NPC tokens have different border colors than PC tokens
9. Drag guard tokens to new positions
10. Switch to Combat mode — verify initiative panel shows
11. **Screenshot**: M02 with guard and mastiff tokens
12. Log which entry route was tested in QA-LOG.md
13. Check console for errors

**Pass criteria**: Overlay text renders on S08, all 3 entry scenes have art, NPC tokens render with correct borders.

---

## Phase 5: Act 4 — Inside the Mansion (Randomized Room Order)

**Goal**: Test multi-floor map switching and dense scene navigation.

**Randomization**: Visit rooms in different order each iteration. Must visit all, but order varies.
Rooms: S13 Ballroom, S14 Servants' Corridor, S15 Rooftop, S16 Third-Floor Hallway, S17 Grand Staircase

1. Switch to Theater mode
2. Navigate to S13 The Ballroom — verify overlay: "Crystal chandeliers scatter light..."
3. Navigate through all Act 4 scenes in randomized order
4. For each scene, verify: unique art, correct act badge ("Act 4"), correct title
5. Switch to Map mode
6. Load M03 Mansion — Ground, verify renders
7. Cycle to M04 Mansion — Second, verify renders
8. Cycle to M05 Mansion — Third, verify renders
9. **Rapid floor switching**: Cycle M03 -> M04 -> M05 -> M03 quickly (click Next chevron rapidly 3 times)
10. Verify no rendering glitches or canvas errors
11. Place tokens on M05: locke token + 2 guard tokens
12. **Screenshot**: M05 with tokens placed
13. Switch back to Theater, verify scene state preserved
14. Check console for errors

**Pass criteria**: All Act 4 scenes render, multi-floor maps load cleanly, rapid switching no errors.

---

## Phase 6: Act 5 — The Heist

**Goal**: Test puzzle box scenes and arcane ward overlay.

1. Switch to Theater mode
2. Navigate to S18 Arcane Ward — verify overlay: "Blue-white threads of magical energy..."
3. **Screenshot**: S18 with arcane ward overlay
4. Navigate to S19 Veymar's Study — verify art shows study interior
5. Navigate to S20 The Puzzle Box — verify unique art
6. Navigate to S21 The Swap — verify art
7. Switch to Map mode, load M05 Mansion — Third
8. Place puzzle-box token and locke token
9. Verify object tokens have different styling from character tokens
10. Test the scene navigator:
    - Click the title group in the nav bar (`.pnav-title-group--clickable`)
    - Verify navigator panel opens (expand icon rotates)
    - Click it again to close
    - Verify it closes (icon rotates back)
11. **Screenshot**: Scene navigator open
12. Check console for errors

**Pass criteria**: Arcane ward overlay renders, puzzle-box object token places, scene navigator opens/closes.

---

## Phase 7: Act 6 — Warehouse Battle (Full Combat Simulation)

**Goal**: Full combat mode stress test with all token types and effects.

1. Switch to Theater mode
2. Navigate to S22 Warehouse Exterior — verify art
3. Navigate to S23 The Ritual — verify overlay: "A blood circle on the stone floor..."
4. Navigate to S24 Rakshasa Revealed — verify art
5. Navigate to S25 Braziers Burning — verify art
6. Switch to Map mode, cycle to M06 Warehouse
7. Switch to Combat mode
8. Place tokens for the warehouse battle:
   - 5 brazier-lit tokens in a pentagonal arrangement
   - 1 ritual-circle token (size 2) in center
   - 1 locke token near ritual circle
   - 2 cult-fanatic tokens flanking
   - 5 PC tokens (martin-storm, lome, oda, jean, rogue) near entrance
9. **Screenshot**: Full battle setup on M06
10. Test initiative advancement:
    - Click NEXT button (`.pnav-next-turn`) 5 times
    - Verify round counter updates in the nav badge
11. Test token swap: remove locke token, place locke-rakshasa token in same position
12. **Randomization**: Pick 2 random braziers to "extinguish" — remove brazier-lit, place brazier-dead
13. **Screenshot**: Battle mid-progress with some braziers extinguished
14. Verify the initiative panel shows turn order
15. Check console for errors

**Pass criteria**: All token types render, NEXT turn advances, token swap works, brazier state changes visible.

---

## Phase 8: Epilogue & Edge Cases

**Goal**: Final scenes plus edge case stress testing.

1. Switch to Theater mode
2. Navigate to S26 Epilogue — Dawn — verify overlay: "The first light of dawn breaks..."
3. **Screenshot**: S26 with dawn overlay
4. **Rapid scene clicking**: Click Next/Prev chevrons rapidly 10 times in alternation
5. Verify no crashes, no duplicate renders, no frozen UI
6. **Rapid mode switching**: Switch Theater -> Map -> Combat -> Theater -> Map rapidly
7. Verify each mode renders correctly after rapid switching
8. **Zoom extremes**: In Map mode, zoom to maximum and minimum
9. Click fit-to-map from extreme zoom — verify smooth reset
10. Test keyboard shortcut H — verify controls help appears
11. Navigate to last scene (S26) — verify Next button is disabled
12. Navigate to first scene (S01) — verify Prev button is disabled
13. **Final console check**: Read ALL console messages, verify zero errors accumulated
14. **Screenshot**: Clean final state
15. If all 8 phases pass, write "CAMPAIGN QA COMPLETE" in QA-LOG.md

**Pass criteria**: Edge cases handled gracefully, zero accumulated errors, all scenes reachable.

---

## Bug Handling

If a bug is found during any phase:
1. Document the bug in QA-LOG.md under "## Bugs Found"
2. Read the relevant source file(s) in `vtt/js/` or `vtt/css/`
3. Fix the bug
4. Re-test the specific failing interaction
5. If fixed, mark bug as `[FIXED]` in log and continue the phase
6. If not fixable, mark phase as `[!]` and describe the blocker

## Files Reference

- **JS modules**: `vtt/js/` — state.js, data.js, player-controls.js, map-renderer.js, map-camera.js, token-manager.js, effects-engine.js, initiative-panel.js, scene-navigator.js, main.js
- **CSS files**: `vtt/css/` — variables.css, base.css, theater.css, map.css, initiative.css, player-nav.css, scene-navigator.css
- **Assets**: `vtt/assets/scenes/*.jpg`, `vtt/assets/maps/*.jpg`, `vtt/assets/tokens/*.png`
