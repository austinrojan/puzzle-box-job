// VTT Pre-Flight Check — Verify everything before game night

import { SCENES, MAPS, TOKENS, validateCampaignData } from './data.js';

export function runPreflight(preloadResults) {
  const failedSet = new Set(preloadResults.failedSources);

  const results = {
    data:      checkDataIntegrity(),
    scenes:    checkAssets(SCENES.map(s => ({ id: s.id, src: s.art })), failedSet),
    maps:      checkAssets(MAPS.map(m => ({ id: m.id, src: m.image })), failedSet),
    tokens:    checkAssets(Object.entries(TOKENS).map(([id, t]) => ({ id, src: t.image })), failedSet),
    broadcast: checkBroadcastChannel(),
  };

  const allOk = Object.values(results).every(r => r.ok);
  console.log(`[VTT] Preflight: ${allOk ? 'ALL PASS' : 'ISSUES DETECTED'}`, results);
  return results;
}

function checkDataIntegrity() {
  const errors = validateCampaignData();
  return { ok: errors.length === 0, errors };
}

function checkAssets(items, failedSet) {
  const errors = [];
  let loadedCount = 0;

  for (const item of items) {
    if (failedSet.has(item.src)) {
      errors.push(`Missing: ${item.id} (${item.src})`);
    } else {
      loadedCount++;
    }
  }

  return { ok: errors.length === 0, errors, loaded: loadedCount, total: items.length };
}

function checkBroadcastChannel() {
  try {
    const ch = new BroadcastChannel('puzzlebox-vtt-preflight');
    ch.close();
    return { ok: true, errors: [] };
  } catch (err) {
    return { ok: false, errors: ['BroadcastChannel not available: ' + err.message] };
  }
}

export function renderPreflightResults(results, containerEl) {
  const checks = [
    { key: 'data',      label: 'Campaign data integrity' },
    { key: 'scenes',    label: `Scene images (${results.scenes.loaded}/${results.scenes.total})` },
    { key: 'maps',      label: `Map images (${results.maps.loaded}/${results.maps.total})` },
    { key: 'tokens',    label: `Token images (${results.tokens.loaded}/${results.tokens.total})` },
    { key: 'broadcast', label: 'BroadcastChannel' },
  ];

  const list = document.createElement('div');
  list.style.cssText = 'text-align: left; max-width: 400px; margin: 1rem auto 0;';

  let allOk = true;

  for (const check of checks) {
    const result = results[check.key];
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex; align-items: center; gap: 8px;
      font-family: var(--font-mono); font-size: 13px;
      margin-bottom: 4px; color: ${result.ok ? 'var(--heat-green)' : 'var(--red-bright)'};
    `;

    const icon = document.createElement('span');
    icon.textContent = result.ok ? '\u2713' : '\u2717';
    icon.style.fontWeight = 'bold';

    const label = document.createElement('span');
    label.textContent = check.label;

    row.appendChild(icon);
    row.appendChild(label);
    list.appendChild(row);

    if (!result.ok) {
      allOk = false;
      for (const err of result.errors.slice(0, 5)) {
        const errRow = document.createElement('div');
        errRow.style.cssText = `
          font-size: 11px; color: var(--red-bright);
          padding-left: 24px; opacity: 0.8;
          font-family: var(--font-mono);
        `;
        errRow.textContent = err;
        list.appendChild(errRow);
      }
      if (result.errors.length > 5) {
        const more = document.createElement('div');
        more.style.cssText = 'font-size: 11px; color: var(--red-bright); padding-left: 24px; opacity: 0.6; font-family: var(--font-mono);';
        more.textContent = `\u2026and ${result.errors.length - 5} more`;
        list.appendChild(more);
      }
    }
  }

  containerEl.appendChild(list);

  if (!allOk) {
    const warning = document.createElement('div');
    warning.style.cssText = `
      color: var(--heat-amber); font-family: var(--font-read-aloud);
      font-style: italic; margin-top: 0.5rem; font-size: 15px;
      text-align: center;
    `;
    warning.textContent = 'Some checks failed. The VTT will still load, but you may see placeholders.';
    containerEl.appendChild(warning);
  }

  return allOk;
}
