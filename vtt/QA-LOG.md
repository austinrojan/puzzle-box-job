# VTT Campaign Simulation QA Log

## Campaign Phases

- [x][fix] Phase 1: Cold Start & Asset Audit
- [x] Phase 2: Act 1 — The Rusty Anchor
- [x] Phase 3: Act 2 — Investigation
- [x] Phase 4: Act 3 — Estate Infiltration
- [x] Phase 5: Act 4 — Inside the Mansion
- [x] Phase 6: Act 5 — The Heist
- [x] Phase 7: Act 6 — Warehouse Battle
- [x] Phase 8: Epilogue & Edge Cases

## Routes Tested

| Phase | Route / Randomization | Iteration |
|-------|----------------------|-----------|
| Phase 3 | Deep-tested S05 (Bakery-Pip), S07 (Broken Oar) | 1 |
| Phase 4 | Route B: Servants' Entrance (S08→S10→S12), M02, guard+mastiff tokens, combat mode | 1 |
| Phase 5 | Room order: S15→S13→S17→S14→S16, Maps M03/M04/M05 rapid switch, combat mode | 1 |
| Phase 7 | Braziers 1,3 extinguished, locke→locke-rakshasa swap, 5 turns advanced, M06 | 1 |

## Bugs Found

### Bug 1: Player nav badge/title not updating on scene change [FIXED]
- **Symptom**: Badge and title in bottom nav bar stuck on first scene's info after advancing
- **Root cause**: `onSceneChange()` in `player-controls.js` used `requestAnimationFrame(updateContext)`. Chrome pauses rAF for unfocused/background tabs, so the callback never fired.
- **Secondary cause**: When crossing act boundaries, `theater.js` defers `state.sceneIndex` update until title card callback (3.6s later), but no event was emitted after the update.
- **Fix 1**: Replaced `requestAnimationFrame` with `setTimeout(updateContext, 0)` in `player-controls.js:onSceneChange()`
- **Fix 2**: Added `EventBus.emit('scene:loaded', next)` in `theater.js` after title card callback sets sceneIndex
- **Fix 3**: Added `EventBus.on('scene:loaded', onSceneChange)` listener in `player-controls.js`
- **Files**: `vtt/js/player-controls.js`, `vtt/js/theater.js`
- **Verified**: Same-act (S01→S02) and cross-act (S02→S03) transitions both update correctly

## Phase 8 Edge Case Results

- **S26 Epilogue overlay**: "The first light of dawn breaks over the Dock District..." ✓
- **Rapid scene clicking** (10x next from S03): stopped correctly at S07 (act boundary), badge/title correct ✓
- **Rapid mode switching** (5 switches in sequence): no crash, final mode correct ✓
- **Extreme zoom in**: 303% ✓
- **Extreme zoom out**: 30% ✓
- **Fit-to-map reset**: 75% (correct for M01 dimensions) ✓
- **Console errors across full campaign**: ZERO ✓

## Summary

- **8/8 phases passed** (1 bug found and fixed in Phase 1)
- **1 bug found**: Player nav badge/title not updating (rAF paused in background tabs) — FIXED
- **Zero console errors** across entire campaign simulation
- **All 26 scenes** navigated and verified (badges, titles, overlays)
- **All 6 maps** loaded and verified (M01-M06)
- **Tokens**: placed on M01, M02, M03, M04, M05, M06 — all rendered correctly
- **Brazier tracker**: 5 braziers rendered, extinguish mechanic working, immunity labels correct
- **Combat mode**: initiative panel, NEXT turn button, round counter all working
- **Camera**: zoom in/out, fit-to-map, extreme zoom ranges (30%-303%) all stable
- **Rapid operations**: scene clicking, mode switching, floor switching — no crashes or errors

---

## Click-Through QA Round 2 (Real UI Clicks)

**Date**: 2026-02-05
**Method**: Chrome browser automation with real clicks (no EventBus JS calls)
**URL**: http://localhost:8765/vtt/index.html?v=9

### Phase 1: Cold Start & Scene Navigation (Acts 1-2) ✓
- S01 "The Rusty Anchor" — tavern scene, correct nav badge "Act 1"
- S02 "Locke's Proposition" — booth scene, unique art
- Act 1→2 boundary: Title card "ACT 2: GATHERING INTEL" displayed correctly
- S03 "Dock District" through S07 "The Broken Oar" — all unique art verified
- Back navigation (‹) from S07→S06 works correctly
- Zero console errors

### Phase 2: Map Mode Testing ✓
- **Bug found & fixed**: Clicking MAP showed black canvas — `map:load` never emitted on mode switch
  - Fix: Added auto-load in `player-controls.js:onModeChanged()` when `!state.mapId`
- All 6 maps verified with unique art: M01 (Dock District), M02 (Estate Grounds), M03 (Mansion Ground), M04 (Mansion Second), M05 (Mansion Third), M06 (Warehouse)
- Zoom in/out via `+`/`−` buttons: 84% → 112% → 84%
- Fit-to-map button works
- Grid toggle: hides/shows grid lines
- Zero console errors

### Phase 3: Scene Navigation (Acts 3-6) ✓
- S08 "Estate at Night" — overlay text: "The Veymar estate blazes with amber light..."
- S09-S12: Main Gate, Servants' Entrance, West Wall, Conservatory — all unique art
- Act 3→4 title card: "ACT 4: THE MANSION — Secrets behind gilded walls"
- S13 "The Ballroom" — overlay text: "Crystal chandeliers scatter light..."
- S14-S17: all unique art verified
- Act 4→5 title card: "ACT 5: THE PUZZLE BOX — The prize within reach"
- S18 "Arcane Ward" — overlay text about blue-white magical energy threads
- S19 "Veymar's Study", S20 "The Puzzle Box", S21 "The Swap" — all unique
- Act 5→6 title card: "ACT 6: THE RITUAL — Betrayal and blood"
- S22 "Warehouse Exterior" — blue light spilling from door, ships in fog
- S23 "The Ritual" — overlay text: "A blood circle on the stone floor..."
- S24 "Rakshasa Revealed" — tiger-headed fiend with purple lightning
- S25 "Braziers Burning" — five blue-flame braziers around ritual circle
- S26 "Epilogue — Dawn" — sunrise over Dock District, overlay text matches data.js
- All 26 scenes show unique art, all overlays on correct scenes, all title cards at act boundaries
- Zero console errors

### Phase 4: Combat Mode ✓
- COMBAT button switches to map with initiative panel
- M06 Warehouse auto-loads (bug fix from Phase 2 working)
- Initiative panel: 7 combatants with init rolls, HP bars, condition badges
- CONCENTRATING badge on Lome, DOMINATED badge on Jean (after update)
- NEXT → button advances turns correctly through all 7 combatants
- Round counter increments from Round 1 → Round 2 on full cycle
- HP updates: Locke wounded (yellow bar ~59%), Cult Fanatic 1 critical (red bar ~24%)
- Locke half-HP marker visible
- Brazier tracker: 2 extinguished, "5th level spells unlocked" label correct
- Zero console errors

### Phase 5: Scene Navigator ✓
- Opens via clicking title group in nav bar
- Shows all 6 acts with icons and scene counts
- Current act (Act 6) auto-expanded with active scene highlighted gold
- Maps section shows M01-M06 with dimensions
- Active map (M06) highlighted
- Click S08 → jumped to Estate at Night, navigator auto-closed
- Mode switch to Theater happened automatically
- Zero console errors

### Phase 6: DM Controls ✓
- Press H → DM Shortcuts panel appears on right side
- All sections present: Modes (F1-F3), Navigation ([]/{}/ Tab), Combat (N/B/F/G), Effects (1-9), Other (H/Esc)
- Press H again → panel hides
- Zero console errors

### Phase 7: Edge Cases ✓
- **Rapid scene clicking** (10x fast ›): Advanced 9 scenes cleanly, 1 absorbed by title card — correct
- **Rapid mode switching** (Theater→Map→Combat→Theater→Map→Theater): Zero errors, state preserved
- **Boundary checks**: ‹ disabled at S01, › disabled at S26 — correct
- **Final console error check**: ZERO errors across entire session

### Round 2 Summary
- **7/7 phases passed**
- **1 bug found & fixed**: Map not loading on mode switch (missing `map:load` emission)
- **Zero console errors** across 50+ interactions
- **All 26 scenes** verified with real clicks
- **All 6 maps** verified with real clicks
- **Combat**: initiative, HP, conditions, braziers, round cycling all working via clicks
- **Scene Navigator**: open/close/jump all working via clicks
- **DM Controls**: show/hide via H key working
- **Edge cases**: rapid clicking, mode switching, boundary checks all stable

## Notes

- VTT URL: http://localhost:8765/vtt/index.html
- Total assets: 50 (26 scenes, 6 maps, 18 tokens)
- Pre-QA smoke test: PASSED (zero errors, all modes working)
- Campaign simulation QA Round 1: PASSED (all 8 phases, 1 bug fixed)
- Click-through QA Round 2: PASSED (all 7 phases, 1 bug fixed)
