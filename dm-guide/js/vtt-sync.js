import { AppState } from './state.js';

let _channel = null;

export function initVttSync() {
  try { _channel = new BroadcastChannel('puzzlebox-vtt'); } catch (_) { /* not available */ }
}

export function vttSync(msg) {
  _channel?.postMessage(msg);
}

export function fireVttActions(vtt) {
  if (!vtt) return;
  if (vtt.scene)     vttSync({ type: 'scene', sceneId: vtt.scene });
  if (vtt.mode)      vttSync({ type: 'mode:switch', mode: vtt.mode });
  if (vtt.map)       vttSync({ type: 'map', mapId: vtt.map });
  if (vtt.effect)    vttSync({ type: 'effect', effectId: vtt.effect });
  if (vtt.titleCard) vttSync({ type: 'title-card', act: vtt.titleCard });
  if (vtt.combat)    vttSync({ type: 'combat:start' });
  if (vtt.preset)    vttSync({ type: 'token:load-preset', presetId: vtt.preset });
}

export function syncFullInitiative() {
  vttSync({
    type: 'initiative',
    data: {
      active: true,
      round: AppState.combat.round,
      currentTurn: AppState.combat.currentTurn,
      entries: AppState.combat.initiative.map((e) => ({
        name: e.name,
        displayName: nameToDisplayName(e.name),
        init: e.init,
        tokenId: nameToTokenId(e.name),
        hp: e.hp,
        maxHp: e.maxHp,
        conditions: e.conditions ?? [],
        isPC: e.type === 'pc',
      })),
    },
  });
}

export function nameToTokenId(name) {
  const _map = {
    'Martin Storm': 'martin-storm',
    'Lómë': 'lome',
    'Oda (Bearda)': 'oda',
    'Jean LeMarque': 'jean',
    'Kallista': 'kallista',
    'Locke (Rakshasa)': 'locke-rakshasa',
    'Cult Fanatic 1': 'cult-fanatic',
    'Cult Fanatic 2': 'cult-fanatic',
  };
  return _map[name] ?? null;
}

export function nameToDisplayName(name) {
  const _map = {
    'Locke (Rakshasa)': 'Locke',
    'Cult Fanatic 1': 'Cultist 1',
    'Cult Fanatic 2': 'Cultist 2',
    'Lair Action': 'Lair Action',
  };
  return _map[name] ?? name;
}
