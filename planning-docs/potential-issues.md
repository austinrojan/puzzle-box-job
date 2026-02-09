# Potential Issues — Deferred Fixes

Low-risk code-quality warnings found during review. None are bugs today, but
worth fixing if we're already touching the surrounding code.

---

## 1. Fragile `escapeHtml` in onclick JSON — `dm-guide/js/renderers.js:29`

```js
const vttJson = escapeHtml(JSON.stringify(block.vtt));
return `<div class="block-vtt-cue" onclick="fireVttActions(${vttJson})">`;
```

`escapeHtml()` converts `"` → `&quot;`. The browser's HTML parser decodes
entities in attribute values before evaluating the JS, so this round-trips
correctly **today**. But the pattern is fragile — if `escapeHtml` is ever
changed (e.g. to also escape single-quotes or backticks), or if the JSON
contains `</`, it could break silently.

**Proper fix:** Replace the inline `onclick` with event delegation in
`main.js`, passing the VTT payload via a `data-*` attribute. This also
eliminates the `window.fireVttActions` global.

---

## 2. `onclick =` assignment vs `addEventListener` — `dm-guide/js/heat-nav.js:24`

```js
seg.onclick = () => setHeatLevel(i);
```

Uses direct `onclick` property assignment instead of `addEventListener`.
Only one handler can exist at a time. Since `renderHeatBar()` is the sole
writer, this works fine — but it's inconsistent with the rest of the
codebase, which uses `addEventListener` exclusively.

**Proper fix:** `seg.addEventListener('click', () => setHeatLevel(i));`
and clear old listeners by cloning the node or using an AbortController.

---

## 3. Asymmetric optional chaining — `dm-guide/js/tooltips.js`

`hideTooltip()` (line 127) uses `_tooltipEl?.classList.remove(...)` but
`showTooltip()` (line 115) does NOT use `?.` on `_tooltipEl`. If
`showTooltip` were called before `initTooltips()`, it would throw. Call
order in `main.js` prevents this today, but the asymmetry is a minor
maintenance hazard.

**Proper fix:** Add `?.` to `showTooltip` as well, or add an early-return
guard at the top of both functions.
