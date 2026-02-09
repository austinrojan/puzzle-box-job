// VTT Pre-Flight Check — Verify everything before game night

import { SCENES, MAPS, TOKENS, CAMPAIGN, validateCampaignData } from './data.js';

const MAX_ERRORS = 5;

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
    const ch = new BroadcastChannel(CAMPAIGN.broadcastChannel + '-preflight');
    ch.close();
    return { ok: true, errors: [] };
  } catch (err) {
    return { ok: false, errors: ['BroadcastChannel not available: ' + err.message] };
  }
}

function renderCheckErrors(result, list) {
  for (const err of result.errors.slice(0, MAX_ERRORS)) {
    const errRow = document.createElement('div');
    errRow.className = 'preflight__error';
    errRow.textContent = err;
    list.appendChild(errRow);
  }
  if (result.errors.length > MAX_ERRORS) {
    const more = document.createElement('div');
    more.className = 'preflight__error preflight__error--more';
    more.textContent = `\u2026and ${result.errors.length - MAX_ERRORS} more`;
    list.appendChild(more);
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
  list.className = 'preflight__list';

  let allOk = true;

  for (const check of checks) {
    const result = results[check.key];
    const row = document.createElement('div');
    row.className = result.ok ? 'preflight__row preflight__row--pass' : 'preflight__row preflight__row--fail';

    const icon = document.createElement('span');
    icon.textContent = result.ok ? '\u2713' : '\u2717';
    icon.className = 'preflight__icon';

    const label = document.createElement('span');
    label.textContent = check.label;

    row.appendChild(icon);
    row.appendChild(label);
    list.appendChild(row);

    if (!result.ok) {
      allOk = false;
      renderCheckErrors(result, list);
    }
  }

  containerEl.appendChild(list);

  if (!allOk) {
    const warning = document.createElement('div');
    warning.className = 'preflight__warning';
    warning.textContent = 'Some checks failed. The VTT will still load, but you may see placeholders.';
    containerEl.appendChild(warning);
  }

  return allOk;
}
